import type { RGBAImage } from '../dds';

export interface MaterialSurfaceOverlay {
  family: 'skin' | 'details' | 'wheels';
  normal?: RGBAImage;
  ao?: RGBAImage;
}
const aoAttenuations = new WeakMap<RGBAImage, { strength: number; image: RGBAImage }>();
function validateSurfaceImage(image: RGBAImage) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 4096 ||
    !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new Error('Texture de surface invalide.');
}
export function attenuateMaterialAO(source: RGBAImage | null, strength: number): RGBAImage | null {
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('Intensité d’ombre invalide.');
  if (source) validateSurfaceImage(source);
  if (!source || strength === 1) return source;
  const saved = aoAttenuations.get(source);
  if (saved?.strength === strength) return saved.image;
  const data = source.data.slice();
  for (let p = 0; p < data.length; p += 4) data[p] = data[p + 1] = data[p + 2] = 255 - (255 - data[p]) * strength;
  const image = { width: source.width, height: source.height, data };
  aoAttenuations.set(source, { strength, image }); return image;
}

/** Compose the same masked data for the GPU preview and game export. */
export function composeMaterialSurface(base: RGBAImage | null, overlays: readonly RGBAImage[], normal: boolean, size?: number): RGBAImage | null {
  if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 4096)) throw new Error('Résolution de surface invalide.');
  if (overlays.length > 128) throw new Error('Trop de matériaux de relief sur cette surface.');
  if (base) validateSurfaceImage(base);
  for (const overlay of overlays) validateSurfaceImage(overlay);
  if (!overlays.length) return base;
  const width = size ?? Math.max(base?.width ?? 1, ...overlays.map(image => image.width));
  const height = size ?? Math.max(base?.height ?? 1, ...overlays.map(image => image.height));
  const data = new Uint8ClampedArray(width * height * 4);
  const sample = (image: RGBAImage, x: number, y: number) => (Math.min(image.height - 1, Math.floor(y * image.height / height)) * image.width
    + Math.min(image.width - 1, Math.floor(x * image.width / width))) * 4;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const target = (y * width + x) * 4;
    const from = base ? sample(base, x, y) : 0;
    data[target] = base ? base.data[from] : normal ? 128 : 255;
    data[target + 1] = base ? base.data[from + 1] : normal ? 128 : 255;
    data[target + 2] = base ? base.data[from + 2] : 255;
    data[target + 3] = 255;
  }
  for (const overlay of overlays) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = sample(overlay, x, y), target = (y * width + x) * 4;
    const alpha = overlay.data[from + 3] / 255;
    if (!alpha) continue;
    if (normal) {
      const ox = data[target] / 127.5 - 1, oy = data[target + 1] / 127.5 - 1;
      const nx = overlay.data[from] / 127.5 - 1, ny = overlay.data[from + 1] / 127.5 - 1;
      const vx = ox * (1 - alpha) + nx * alpha, vy = oy * (1 - alpha) + ny * alpha;
      const vz = Math.sqrt(Math.max(0, 1 - ox * ox - oy * oy)) * (1 - alpha) + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * alpha;
      const length = Math.hypot(vx, vy, vz) || 1;
      data[target] = (vx / length + 1) * 127.5;
      data[target + 1] = (vy / length + 1) * 127.5;
      data[target + 2] = (vz / length + 1) * 127.5;
    } else {
      const value = data[target] * (1 - alpha + overlay.data[from] / 255 * alpha);
      data[target] = data[target + 1] = data[target + 2] = value;
    }
  }
  return { width, height, data };
}
