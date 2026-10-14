import { encodeDDS, type RGBAImage } from '../dds';
import { patchReliefPreview } from './glb';
import { deriveReliefNormals, sampleReliefHeight, validateReliefAtlas, validReliefAmplitude } from './height';
import { maskReliefAtlas } from './mask';
import { loadPreparedReliefTemplate, verifyPreparedReliefTemplate } from './template';
import type { BuildReliefOptions, PreparedReliefTemplate, ReliefGeometry, ReliefPrototypeResult, ReliefScope, ReliefVariant } from './types';

export { createDiagnosticReliefAtlas, createVolumeDiagnosticAtlas, deriveReliefNormals, STANDARD_RELIEF_MAX_MM, DIAGNOSTIC_RELIEF_MAX_MM } from './height';
export { createHoodMask, createReliefMask, maskReliefAtlas } from './mask';
export { loadPreparedReliefTemplate } from './template';
export type { BuildReliefOptions, PreparedReliefTemplate, ReliefPrototypeResult, ReliefScope, ReliefTextureResolution } from './types';

const wholeBodyWeights = new WeakMap<PreparedReliefTemplate, Float32Array[]>();
const positionKey = (position: readonly number[]) => position.map(value => Math.round(value * 1_000_000)).join(',');

/** Keep connections to undeformed articulated parts closed and feather nearby volume. */
function vehicleWeights(template: PreparedReliefTemplate): Float32Array[] {
  const cached = wholeBodyWeights.get(template); if (cached) return cached;
  const geometries = template.manifest.geometries, fixedPositions = new Set<string>(), anchors = new Map<string, number[]>();
  for (const geometry of geometries) for (let vertex = 0; vertex < geometry.bodyVertices.length; vertex++) {
    if (!geometry.bodyVertices[vertex]) fixedPositions.add(positionKey(geometry.positions.slice(vertex * 3, vertex * 3 + 3)));
  }
  for (const geometry of geometries) for (let vertex = 0; vertex < geometry.bodyVertices.length; vertex++) {
    if (!geometry.bodyVertices[vertex]) continue;
    const position = geometry.positions.slice(vertex * 3, vertex * 3 + 3), key = positionKey(position);
    if (fixedPositions.has(key)) anchors.set(key, position);
  }
  for (const geometry of geometries) {
    const points = geometry.boundaryPoints ?? [];
    for (let point = 0; point < points.length; point += 3) {
      const position = points.slice(point, point + 3); anchors.set(positionKey(position), position);
    }
  }
  const featherMeters = .03, buckets = new Map<string, number[][]>();
  for (const anchor of anchors.values()) {
    const key = anchor.map(value => Math.floor(value / featherMeters)).join(',');
    const bucket = buckets.get(key) ?? []; bucket.push(anchor); buckets.set(key, bucket);
  }
  const result = geometries.map(geometry => Float32Array.from(geometry.bodyVertices, (isBody, vertex) => {
    if (!isBody) return 0;
    const position = geometry.positions.slice(vertex * 3, vertex * 3 + 3);
    if (anchors.has(positionKey(position))) return 0;
    const cell = position.map(value => Math.floor(value / featherMeters));
    let nearestSquared = featherMeters ** 2;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      for (const anchor of buckets.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) ?? []) {
        nearestSquared = Math.min(nearestSquared, (position[0] - anchor[0]) ** 2 + (position[1] - anchor[1]) ** 2 + (position[2] - anchor[2]) ** 2);
      }
    }
    const t = Math.sqrt(nearestSquared) / featherMeters;
    return t * t * (3 - 2 * t);
  }));
  wholeBodyWeights.set(template, result); return result;
}

/** Nadeo's DEC3N stores signed 10-bit X/Y/Z; the top two bits are preserved. */
export function packReliefNormal(normal: readonly number[], previous = 0): number {
  return ((previous & 0xc0000000)
    | (Math.trunc(Math.max(-1, Math.min(1, normal[0])) * 511) & 1023)
    | ((Math.trunc(Math.max(-1, Math.min(1, normal[1])) * 511) & 1023) << 10)
    | ((Math.trunc(Math.max(-1, Math.min(1, normal[2])) * 511) & 1023) << 20)) >>> 0;
}

export function unpackReliefNormal(value: number): [number, number, number] {
  return [0, 10, 20].map(shift => { const n = (value >>> shift) & 1023; return (n >= 512 ? n - 1024 : n) / 511; }) as [number, number, number];
}

function faceNormals(positions: ArrayLike<number>, indices: readonly number[]): Float64Array {
  const result = new Float64Array(positions.length);
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle] * 3, b = indices[triangle + 1] * 3, c = indices[triangle + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c]) { result[vertex] += nx; result[vertex + 1] += ny; result[vertex + 2] += nz; }
  }
  for (let vertex = 0; vertex < result.length; vertex += 3) {
    const length = Math.hypot(result[vertex], result[vertex + 1], result[vertex + 2]);
    if (length > 1e-12) for (let axis = 0; axis < 3; axis++) result[vertex + axis] /= length;
  }
  return result;
}

function updateNormals(geometry: ReliefGeometry, positions: Float32Array): Float32Array {
  const before = faceNormals(geometry.positions, geometry.indices), after = faceNormals(positions, geometry.indices);
  const result = Float32Array.from(geometry.normals);
  for (let vertex = 0; vertex < result.length; vertex += 3) {
    if (!geometry.bodyVertices[vertex / 3]) continue;
    const dx = after[vertex] - before[vertex], dy = after[vertex + 1] - before[vertex + 1], dz = after[vertex + 2] - before[vertex + 2];
    if (Math.hypot(dx, dy, dz) < 1e-9) continue;
    // Preserve the authored smoothing: add the face-normal change to its base.
    const nx = geometry.normals[vertex] + dx, ny = geometry.normals[vertex + 1] + dy, nz = geometry.normals[vertex + 2] + dz;
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-12) result.set([nx / length, ny / length, nz / length], vertex);
  }
  return result;
}

function checkNativeStreams(template: PreparedReliefTemplate, variant: ReliefVariant): void {
  const data = template.variants[variant], view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const geometry of template.manifest.geometries) {
    const offsets = geometry.offsets[variant], count = geometry.positions.length / 3;
    for (let vertex = 0; vertex < count; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = view.getFloat32(offsets.positionOffset + vertex * 12 + axis * 4, true);
        if (!Number.isFinite(value) || Math.abs(value - geometry.positions[vertex * 3 + axis]) > .000001) throw new Error('Le modèle GBX ne correspond pas à ses offsets de relief.');
      }
      const native = geometry.normalEncoding === 'dec3n'
        ? unpackReliefNormal(view.getUint32(offsets.normalOffset + vertex * 4, true))
        : [0, 1, 2].map(axis => view.getFloat32(offsets.normalOffset + vertex * 12 + axis * 4, true));
      for (let axis = 0; axis < 3; axis++) if (!Number.isFinite(native[axis]) || Math.abs(native[axis] - geometry.normals[vertex * 3 + axis]) > .005) throw new Error('Les normales GBX ne correspondent pas au modèle de relief.');
      if (geometry.tangents && offsets.tangentOffset !== undefined) {
        const tangent = unpackReliefNormal(view.getUint32(offsets.tangentOffset + vertex * 4, true));
        for (let axis = 0; axis < 3; axis++) if (Math.abs(tangent[axis] - geometry.tangents[vertex * 3 + axis]) > .005) throw new Error('Les tangentes GBX ne correspondent pas au modèle de relief.');
      }
    }
  }
}

function prepareNormalAtlas(template: PreparedReliefTemplate, image: RGBAImage, strength: number, scope: ReliefScope): RGBAImage {
  const masked = scope === 'vehicle' ? image : maskReliefAtlas(template, image, scope), data = new Uint8ClampedArray(image.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = masked.data[offset + 3] / 255;
    const nx = Math.max(-1, Math.min(1, (image.data[offset] - 128) / 127)) * strength * alpha;
    const ny = Math.max(-1, Math.min(1, (image.data[offset + 1] - 128) / 127)) * strength * alpha;
    const sourceZ = Math.max(0, (image.data[offset + 2] - 128) / 127);
    const nz = 1 + (sourceZ - 1) * alpha, length = Math.hypot(nx, ny, nz);
    data.set(strength === 0 || length < 1e-8 ? [128, 128, 255, 255]
      : [128 + nx / length * 127, 128 + ny / length * 127, 128 + nz / length * 127, 255], offset);
  }
  return { width: image.width, height: image.height, data };
}

/** Build an isolated preview/game prototype; all source project arrays remain intact. */
export async function buildReliefPrototype(options: BuildReliefOptions): Promise<ReliefPrototypeResult> {
  const { strengthMm, heightAtlas, mode } = options, normalStrength = options.normalStrength ?? 1;
  const scope = options.scope ?? 'hood', textureResolution = options.textureResolution ?? 1024;
  const diagnostic = options.diagnostic ?? false;
  const template = options.template ?? await loadPreparedReliefTemplate();
  const dense = template.manifest.surfaceMethod === 'dense-heightfield-v1';
  const validAmplitude = dense && !diagnostic ? Number.isFinite(strengthMm) && strengthMm >= 0 && strengthMm <= 30 : validReliefAmplitude(strengthMm, diagnostic);
  if (!['normal', 'geometry', 'combined'].includes(mode) || !validAmplitude || typeof diagnostic !== 'boolean'
    || !Number.isFinite(normalStrength) || normalStrength < 0 || normalStrength > 2) throw new Error(`Réglages du relief invalides (0 à ${diagnostic === true ? 80 : 8} mm).`);
  if (!['hood', 'vehicle'].includes(scope)) throw new Error('Zone de relief invalide.');
  if (![1024, 2048, 4096].includes(textureResolution)) throw new Error('Résolution du relief invalide (1K, 2K ou 4K).');
  if (heightAtlas) validateReliefAtlas(heightAtlas);
  if (options.normalAtlas) validateReliefAtlas(options.normalAtlas);
  // Hash again for caller-supplied templates, so modifying a known buffer is rejected.
  if (options.template) await verifyPreparedReliefTemplate(template);
  if ((scope === 'vehicle' || diagnostic) && template.manifest.interfaceProtectionVersion !== 1) throw new Error('Le modèle du prototype doit être rechargé pour protéger les interfaces du relief étendu.');
  const variant: ReliefVariant = mode === 'geometry' ? 'standard' : 'normal';
  checkNativeStreams(template, variant);
  const geometries = template.manifest.geometries;
  const protectedWeights = scope === 'vehicle' || diagnostic || dense ? vehicleWeights(template) : undefined;
  const scopeWeights = scope === 'vehicle' ? protectedWeights!
    : geometries.map((geometry, i) => diagnostic || dense ? geometry.hoodWeights.map((value, vertex) => value * protectedWeights![i][vertex]) : geometry.hoodWeights);
  const positions = geometries.map(geometry => Float32Array.from(geometry.positions));
  let affectedVertices = 0, maxDisplacementMm = 0;
  if (mode !== 'normal' && heightAtlas && strengthMm > 0) {
    // UV seam duplicates share one displacement to avoid opening the original mesh.
    const groups = new Map<string, { members: [number, number][]; amount: number; count: number; normal: number[] }>();
    geometries.forEach((geometry, groupIndex) => {
      for (let vertex = 0; vertex < geometry.hoodWeights.length; vertex++) {
        // A Body vertex may coincide with an articulated air-brake panel. It must
        // never transfer displacement across their different skeleton bindings.
        if (!geometry.bodyVertices[vertex]) continue;
        const p = geometry.positions.slice(vertex * 3, vertex * 3 + 3), key = positionKey(p);
        const group = groups.get(key) ?? { members: [], amount: 0, count: 0, normal: [0, 0, 0] };
        group.members.push([groupIndex, vertex]);
        const weight = scopeWeights[groupIndex][vertex];
        if (weight > 0) {
          const sample = (options.heightSample ?? ((u: number, v: number) => sampleReliefHeight(heightAtlas, u, v)))(geometry.uv[vertex * 2], geometry.uv[vertex * 2 + 1]);
          if (!Number.isFinite(sample) || sample < -1.000001 || sample > 1.000001) throw new Error('Échantillon de hauteur invalide.');
          group.amount += sample * weight * strengthMm / 1000;
          group.count++;
          for (let axis = 0; axis < 3; axis++) group.normal[axis] += geometry.normals[vertex * 3 + axis];
        }
        groups.set(key, group);
      }
    });
    for (const group of groups.values()) {
      if (!group.count) continue;
      const amount = group.amount / group.count, length = Math.hypot(...group.normal);
      if (Math.abs(amount) < 1e-10 || length < 1e-8) continue;
      for (const [geometryIndex, vertex] of group.members) {
        const destination = positions[geometryIndex], geometry = geometries[geometryIndex];
        let distanceSquared = 0;
        for (let axis = 0; axis < 3; axis++) {
          destination[vertex * 3 + axis] += group.normal[axis] / length * amount;
          distanceSquared += (destination[vertex * 3 + axis] - geometry.positions[vertex * 3 + axis]) ** 2;
        }
        // Tiny sampled amounts can disappear when native float32 coordinates
        // round them; report vertices whose written position actually changes.
        if (distanceSquared > 1e-18) affectedVertices++;
        maxDisplacementMm = Math.max(maxDisplacementMm, Math.sqrt(distanceSquared) * 1000);
      }
    }
  }
  const normals = geometries.map((geometry, i) => affectedVertices ? updateNormals(geometry, positions[i]) : Float32Array.from(geometry.normals));
  const mesh = template.variants[variant].slice(), meshView = new DataView(mesh.buffer);
  geometries.forEach((geometry, geometryIndex) => {
    const offsets = geometry.offsets[variant], output = positions[geometryIndex], outputNormals = normals[geometryIndex];
    for (let vertex = 0; vertex < geometry.hoodWeights.length; vertex++) {
      for (let axis = 0; axis < 3; axis++) if (output[vertex * 3 + axis] !== geometry.positions[vertex * 3 + axis]) meshView.setFloat32(offsets.positionOffset + vertex * 12 + axis * 4, output[vertex * 3 + axis], true);
      const normal = [...outputNormals.subarray(vertex * 3, vertex * 3 + 3)];
      if (normal.every((value, axis) => value === Math.fround(geometry.normals[vertex * 3 + axis]))) continue;
      if (geometry.normalEncoding === 'dec3n') {
        const offset = offsets.normalOffset + vertex * 4;
        meshView.setUint32(offset, packReliefNormal(normal, meshView.getUint32(offset, true)), true);
      } else for (let axis = 0; axis < 3; axis++) meshView.setFloat32(offsets.normalOffset + vertex * 12 + axis * 4, normal[axis], true);
      if (geometry.tangents && offsets.tangentOffset !== undefined) {
        const source = geometry.tangents.slice(vertex * 3, vertex * 3 + 3);
        const dot = source.reduce((sum, value, axis) => sum + value * normal[axis], 0);
        const tangent = source.map((value, axis) => value - dot * normal[axis]), length = Math.hypot(...tangent);
        if (length > 1e-8) {
          const offset = offsets.tangentOffset + vertex * 4;
          meshView.setUint32(offset, packReliefNormal(tangent.map(value => value / length), meshView.getUint32(offset, true)), true);
        }
      }
    }
  });
  const sourceNormal = mode === 'geometry' ? undefined : options.normalAtlas ?? (heightAtlas ? deriveReliefNormals(heightAtlas, strengthMm || 3, 1.8, diagnostic || dense) : undefined);
  const normalAtlas = mode === 'geometry' || !sourceNormal ? null : prepareNormalAtlas(template, sourceNormal, normalStrength, scope);
  const passthrough = template.dependencies.map(entry => ({ name: entry.name, data: entry.data.slice() }));
  if (normalAtlas) {
    const dds = new Uint8Array(encodeDDS(normalAtlas, 'BC5', { colorSpace: 'linear' }));
    for (const name of scope === 'vehicle' ? ['Skin_N.dds', 'Details_N.dds', 'Wheels_N.dds'] : ['Skin_N.dds']) {
      passthrough.push({ name, data: name === 'Skin_N.dds' ? dds : dds.slice() });
    }
  }
  return {
    options: { mode, strengthMm, normalStrength, scope, textureResolution, diagnostic, ...(dense ? { surfaceMethod: 'dense-heightfield-v1' as const } : {}), ...(options.heightSourceBits ? { heightSourceBits: options.heightSourceBits } : {}) },
    project: { name: scope === 'vehicle' ? 'Relief · voiture entière' : 'Relief · capot', mesh, preview: patchReliefPreview(template.preview, geometries, positions, normals, variant), passthrough },
    normalAtlas,
    stats: { affectedVertices, maxDisplacementMm, hoodVertices: geometries.reduce((count, geometry) => count + geometry.hoodWeights.filter(value => value > 0).length, 0), eligibleVertices: scopeWeights.reduce((count, weights) => count + Array.from(weights).filter(value => value > 0).length, 0), triangleCount: geometries.reduce((count, geometry) => count + geometry.indices.length / 3, 0), templateVariant: variant },
  };
}
