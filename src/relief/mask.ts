import type { RGBAImage } from '../dds';
import type { PreparedReliefTemplate, ReliefScope } from './types';
import { validateReliefAtlas } from './height';

const masks = new WeakMap<PreparedReliefTemplate, Map<string, RGBAImage>>();

/** The vehicle test covers all UV atlases, including details and wheels. */
export function createReliefMask(template: PreparedReliefTemplate, width: number, height = width, scope: ReliefScope = 'hood'): RGBAImage {
  if (!['hood', 'vehicle'].includes(scope)) throw new Error('Zone de relief invalide.');
  if (scope === 'hood') return createHoodMask(template, width, height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Résolution du masque de relief invalide.');
  const key = `vehicle:${width}x${height}`, cached = masks.get(template)?.get(key);
  if (cached) return cached;
  const data = new Uint8ClampedArray(width * height * 4); data.fill(255);
  const result = { width, height, data }, entries = masks.get(template) ?? new Map<string, RGBAImage>();
  if (entries.size >= 2) entries.delete(entries.keys().next().value!);
  entries.set(key, result); masks.set(template, entries); return result;
}

/** Rasterise native UV triangles with feathered hood weights, including mirrored UVs. */
export function createHoodMask(template: PreparedReliefTemplate, width: number, height = width): RGBAImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Résolution du masque de capot invalide.');
  const key = `${width}x${height}`, cached = masks.get(template)?.get(key);
  if (cached) return cached;
  const coverage = new Float32Array(width * height);
  for (const geometry of template.manifest.geometries) {
    const { uv, indices, hoodWeights } = geometry;
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const a = indices[triangle], b = indices[triangle + 1], c = indices[triangle + 2];
      if (Math.max(hoodWeights[a], hoodWeights[b], hoodWeights[c]) <= 0) continue;
      const ax = uv[a * 2] * (width - 1), ay = (1 - uv[a * 2 + 1]) * (height - 1);
      const bx = uv[b * 2] * (width - 1), by = (1 - uv[b * 2 + 1]) * (height - 1);
      const cx = uv[c * 2] * (width - 1), cy = (1 - uv[c * 2 + 1]) * (height - 1);
      const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(determinant) < .0000001) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / determinant;
        const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / determinant;
        const wc = 1 - wa - wb;
        if (wa < -.00001 || wb < -.00001 || wc < -.00001) continue;
        const value = Math.max(0, Math.min(1, wa * hoodWeights[a] + wb * hoodWeights[b] + wc * hoodWeights[c]));
        const pixel = y * width + x;
        coverage[pixel] = Math.max(coverage[pixel], value);
      }
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < coverage.length; pixel++) data.set([255, 255, 255, coverage[pixel] * 255], pixel * 4);
  const result = { width, height, data }, entries = masks.get(template) ?? new Map<string, RGBAImage>();
  // Bound retained masks; callers treating returned arrays as immutable can reuse them.
  if (entries.size >= 2) entries.delete(entries.keys().next().value!);
  entries.set(key, result); masks.set(template, entries); return result;
}

/** RGB stays linear and unchanged; multiply the source alpha by selected coverage. */
export function maskReliefAtlas(template: PreparedReliefTemplate, image: RGBAImage, scope: ReliefScope = 'hood'): RGBAImage {
  validateReliefAtlas(image);
  if (!['hood', 'vehicle'].includes(scope)) throw new Error('Zone de relief invalide.');
  // A full vehicle test keeps all texture alpha; no full-sized white mask needed.
  if (scope === 'vehicle') return { width: image.width, height: image.height, data: image.data.slice() };
  const mask = createReliefMask(template, image.width, image.height, scope), data = image.data.slice();
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = data[offset] * mask.data[offset] / 255;
  return { width: image.width, height: image.height, data };
}
