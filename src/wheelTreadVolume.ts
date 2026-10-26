import type { RGBAImage } from './dds';
import { buildReliefPrototype, packReliefNormal, unpackReliefNormal } from './relief/engine';
import { patchReliefPreview } from './relief/glb';
import { retainOtherLayerVolumes } from './relief/layerVolume';
import { loadPreparedReliefTemplate, verifyPreparedReliefTemplate } from './relief/template';
import type { PreparedReliefTemplate, ReliefGeometry, ReliefPrototypeResult, ReliefVariant } from './relief/types';
import { normalizeWheelSurface, type WheelSurfaceSettings } from './wheelSurface';
import { sampleWheelTreadBlockHeight, WHEEL_TREAD_DEPTH_MM, WHEEL_TREAD_UV } from './wheelTreads';

const HEIGHT_SOURCE: RGBAImage = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) };
const EMPTY_MASK: RGBAImage = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
const outsideTread = (u: number) => u < WHEEL_TREAD_UV.minU || u > WHEEL_TREAD_UV.maxU;

function uniqueUv(bytes: Uint8Array, needle: Uint8Array, optional = false): number {
  let found = -1;
  for (let at = bytes.indexOf(needle[0]); at >= 0 && at + needle.length <= bytes.length; at = bytes.indexOf(needle[0], at + 1)) {
    let same = true;
    for (let i = 1; i < Math.min(16, needle.length); i++) if (bytes[at + i] !== needle[i]) { same = false; break; }
    if (!same) continue;
    for (let i = 16; i < needle.length; i++) if (bytes[at + i] !== needle[i]) { same = false; break; }
    if (!same) continue;
    if (found >= 0) throw new Error('Le modèle de relief précédent est ambigu.');
    found = at;
  }
  if (found < 0 && !optional) throw new Error('Le modèle précédent ne correspond pas à la surface de relief.');
  return found;
}

interface PreviousSurface { geometry: ReliefGeometry; shift: number }
interface SurfacePoint { surface: PreviousSurface; vertex: number }
interface SurfaceTriangle { surface: PreviousSurface; vertices: [number, number, number] }

/** Keep painted sidewall volumes when the four native tread visuals are rebuilt.
 * Old full-template vertices match by joint, original position and native UV;
 * conforming edge subdivisions interpolate the previous displacement in UV. */
async function preserveWheelSidewalls(template: PreparedReliefTemplate, result: ReliefPrototypeResult,
  base: { mesh: Uint8Array; variant: ReliefVariant }, suppliedLegacy?: PreparedReliefTemplate): Promise<ReliefPrototypeResult> {
  const previous = new DataView(base.mesh.buffer, base.mesh.byteOffset, base.mesh.byteLength), mesh = result.project.mesh.slice(), out = new DataView(mesh.buffer);
  const variant = result.stats.templateVariant, originalBase = base.mesh === template.variants[base.variant];
  const locate = (source: PreparedReliefTemplate, geometry: ReliefGeometry, optional = false): PreviousSurface | null => {
    if (base.mesh === source.variants[base.variant]) return { geometry, shift: 0 };
    const uv = new Uint8Array(Float32Array.from(geometry.uv).buffer), oldUv = uniqueUv(base.mesh, uv, optional);
    if (oldUv < 0) return null;
    return { geometry, shift: oldUv - uniqueUv(source.variants[base.variant], uv) };
  };
  const key = (g: ReliefGeometry, i: number) => `${g.bindings?.[i] ?? 0}:${[...g.positions.slice(i * 3, i * 3 + 3), ...g.uv.slice(i * 2, i * 2 + 2)].map(n => Math.round(n * 1e6)).join(',')}`;
  const bucketKey = (binding: number, u: number, v: number) => `${binding}:${Math.floor(u * 64)}:${Math.floor(v * 64)}`;
  let legacy: PreparedReliefTemplate | undefined, points: Map<string, SurfacePoint[]> | undefined, triangles: Map<string, SurfaceTriangle[]> | undefined;
  const prepareLegacy = async () => {
    if (points && triangles) return;
    legacy = suppliedLegacy ?? await loadPreparedReliefTemplate('full');
    if (suppliedLegacy) await verifyPreparedReliefTemplate(legacy);
    points = new Map(); triangles = new Map();
    for (const g of legacy.manifest.geometries.filter(g => g.family === 'wheels' && g.positionAccessor !== undefined)) {
      const surface = locate(legacy, g)!;
      for (let i = 0; i < g.bodyVertices.length; i++) { const id = key(g, i), rows = points.get(id) ?? []; rows.push({ surface, vertex: i }); points.set(id, rows); }
      for (let f = 0; f < g.indices.length; f += 3) {
        const vertices = g.indices.slice(f, f + 3) as [number, number, number], [a] = vertices;
        const binding = g.bindings?.[a] ?? 0;
        if (vertices.some(i => (g.bindings?.[i] ?? 0) !== binding)) continue;
        const us = vertices.map(i => g.uv[i * 2]), vs = vertices.map(i => g.uv[i * 2 + 1]);
        if (Math.abs((us[1] - us[0]) * (vs[2] - vs[0]) - (us[2] - us[0]) * (vs[1] - vs[0])) < 1e-12) continue;
        const triangle = { surface, vertices };
        for (let x = Math.floor(Math.min(...us) * 64); x <= Math.floor(Math.max(...us) * 64); x++) for (let y = Math.floor(Math.min(...vs) * 64); y <= Math.floor(Math.max(...vs) * 64); y++) {
          const id = `${binding}:${x}:${y}`, rows = triangles.get(id) ?? []; rows.push(triangle); triangles.set(id, rows);
        }
      }
    }
  };
  const read = (surface: PreviousSurface, i: number) => {
    const g = surface.geometry, from = g.offsets[base.variant], normalStride = g.normalEncoding === 'dec3n' ? 4 : 12;
    const pAt = from.positionOffset + surface.shift + i * 12, nAt = from.normalOffset + surface.shift + i * normalStride;
    if (pAt < 0 || nAt < 0 || pAt + 12 > base.mesh.length || nAt + normalStride > base.mesh.length) throw new Error('Géométrie précédente invalide.');
    const position = [0, 1, 2].map(axis => previous.getFloat32(pAt + axis * 4, true));
    const normal = g.normalEncoding === 'dec3n' ? unpackReliefNormal(previous.getUint32(nAt, true)) : [0, 1, 2].map(axis => previous.getFloat32(nAt + axis * 4, true));
    if (position.some(n => !Number.isFinite(n)) || Math.hypot(...position.map((n, axis) => n - g.positions[i * 3 + axis])) > .081) throw new Error('Volume précédent hors des limites.');
    if (normal.some(n => !Number.isFinite(n)) || Math.abs(Math.hypot(...normal) - 1) > .02) throw new Error('Normales précédentes invalides.');
    return { position, normal, pAt, nAt, normalStride };
  };
  for (const g of template.manifest.geometries.filter(g => g.family === 'wheels')) {
    const direct = locate(template, g, true), to = g.offsets[variant];
    if (!direct) await prepareLegacy();
    for (let i = 0; i < g.bodyVertices.length; i++) {
      if (!g.bodyVertices[i] || !outsideTread(g.uv[i * 2])) continue;
      let exact = direct ? { surface: direct, vertex: i } : undefined;
      if (!exact) exact = points?.get(key(g, i))?.reduce((best, row) => {
        const difference = (point: SurfacePoint) => point.surface.geometry.normals.slice(point.vertex * 3, point.vertex * 3 + 3).reduce((sum, n, axis) => sum + (n - g.normals[i * 3 + axis]) ** 2, 0);
        return !best || difference(row) < difference(best) ? row : best;
      }, undefined as SurfacePoint | undefined);
      let position: number[], normal: number[], copiedNormal = false, copiedTangent = false;
      if (exact) {
        const old = read(exact.surface, exact.vertex); position = old.position; normal = old.normal;
        if (g.normalEncoding === exact.surface.geometry.normalEncoding) { mesh.set(base.mesh.subarray(old.nAt, old.nAt + old.normalStride), to.normalOffset + i * old.normalStride); copiedNormal = true; }
        const from = exact.surface.geometry.offsets[base.variant];
        if (from.tangentOffset !== undefined && to.tangentOffset !== undefined) {
          const at = from.tangentOffset + exact.surface.shift + exact.vertex * 4;
          if (at < 0 || at + 4 > base.mesh.length) throw new Error('Tangentes précédentes invalides.');
          mesh.set(base.mesh.subarray(at, at + 4), to.tangentOffset + i * 4); copiedTangent = true;
        }
      } else {
        const u = g.uv[i * 2], v = g.uv[i * 2 + 1], candidates = triangles!.get(bucketKey(g.bindings?.[i] ?? 0, u, v)) ?? [];
        let nearest: { triangle: SurfaceTriangle; weights: number[]; distance: number } | undefined;
        for (const triangle of candidates) {
          const source = triangle.surface.geometry, [a, b, c] = triangle.vertices, au = source.uv[a * 2], av = source.uv[a * 2 + 1];
          const bu = source.uv[b * 2] - au, bv = source.uv[b * 2 + 1] - av, cu = source.uv[c * 2] - au, cv = source.uv[c * 2 + 1] - av, det = bu * cv - cu * bv;
          const wb = ((u - au) * cv - (v - av) * cu) / det, wc = (bu * (v - av) - bv * (u - au)) / det, weights = [1 - wb - wc, wb, wc];
          if (weights.some(w => w < -1e-5 || w > 1.00001)) continue;
          const distance = Math.hypot(...[0, 1, 2].map(axis => triangle.vertices.reduce((sum, vertex, k) => sum + source.positions[vertex * 3 + axis] * weights[k], 0) - g.positions[i * 3 + axis]));
          if (!nearest || distance < nearest.distance) nearest = { triangle, weights, distance };
        }
        if (!nearest || nearest.distance > .002) throw new Error('Les anciens flancs ne correspondent pas au gabarit natif.');
        const source = nearest.triangle.surface.geometry, old = nearest.triangle.vertices.map(vertex => read(nearest!.triangle.surface, vertex));
        position = [0, 1, 2].map(axis => g.positions[i * 3 + axis] + old.reduce((sum, point, k) => sum + (point.position[axis] - source.positions[nearest!.triangle.vertices[k] * 3 + axis]) * nearest!.weights[k], 0));
        normal = [0, 1, 2].map(axis => g.normals[i * 3 + axis] + old.reduce((sum, point, k) => sum + (point.normal[axis] - source.normals[nearest!.triangle.vertices[k] * 3 + axis]) * nearest!.weights[k], 0));
        const length = Math.hypot(...normal); normal = normal.map(n => n / length);
      }
      for (let axis = 0; axis < 3; axis++) out.setFloat32(to.positionOffset + i * 12 + axis * 4, position[axis], true);
      if (!copiedNormal) {
        if (g.normalEncoding === 'dec3n') out.setUint32(to.normalOffset + i * 4, packReliefNormal(normal, out.getUint32(to.normalOffset + i * 4, true)), true);
        else for (let axis = 0; axis < 3; axis++) out.setFloat32(to.normalOffset + i * 12 + axis * 4, normal[axis], true);
      }
      if (!copiedTangent && g.tangents && to.tangentOffset !== undefined) {
        const tangent = g.tangents.slice(i * 3, i * 3 + 3), dot = tangent.reduce((sum, n, axis) => sum + n * normal[axis], 0), projected = tangent.map((n, axis) => n - dot * normal[axis]), length = Math.hypot(...projected);
        if (length > 1e-8) out.setUint32(to.tangentOffset + i * 4, packReliefNormal(projected.map(n => n / length), out.getUint32(to.tangentOffset + i * 4, true)), true);
      }
    }
  }
  const positions = template.manifest.geometries.map(g => Float32Array.from({ length: g.positions.length }, (_, i) => out.getFloat32(g.offsets[variant].positionOffset + i * 4, true)));
  const normals = template.manifest.geometries.map(g => Float32Array.from({ length: g.normals.length }, (_, i) => g.normalEncoding === 'dec3n' ? unpackReliefNormal(out.getUint32(g.offsets[variant].normalOffset + Math.floor(i / 3) * 4, true))[i % 3] : out.getFloat32(g.offsets[variant].normalOffset + i * 4, true)));
  if (originalBase) template.manifest.geometries.forEach((g, index) => {
    for (let i = 0; i < g.bodyVertices.length; i++) if (g.family !== 'wheels' || outsideTread(g.uv[i * 2])) normals[index].set(g.normals.slice(i * 3, i * 3 + 3), i * 3);
  });
  return { ...result, project: { ...result.project, mesh, preview: patchReliefPreview(template.preview, template.manifest.geometries, positions, normals, variant) } };
}

/** Use the normal-capable native shader when earlier body relief requires it. */
function preserveVariant(template: PreparedReliefTemplate, result: ReliefPrototypeResult, variant: ReliefVariant): ReliefPrototypeResult {
  if (variant === result.stats.templateVariant) return result;
  const mesh = template.variants[variant].slice(), source = result.project.mesh;
  for (const geometry of template.manifest.geometries) {
    const from = geometry.offsets[result.stats.templateVariant], to = geometry.offsets[variant];
    const count = geometry.bodyVertices.length, normalStride = geometry.normalEncoding === 'dec3n' ? 4 : 12;
    mesh.set(source.subarray(from.positionOffset, from.positionOffset + count * 12), to.positionOffset);
    mesh.set(source.subarray(from.normalOffset, from.normalOffset + count * normalStride), to.normalOffset);
    if (from.tangentOffset !== undefined && to.tangentOffset !== undefined) {
      mesh.set(source.subarray(from.tangentOffset, from.tangentOffset + count * 4), to.tangentOffset);
    }
  }
  return { ...result, project: { ...result.project, mesh }, stats: { ...result.stats, templateVariant: variant } };
}

/** Rebuild the complete wheel family from the trusted native template.
 * Paint atlases stay separate; grooves change the preview and game mesh alike. */
export async function buildWheelTreadVolume(
  value: WheelSurfaceSettings,
  base?: { mesh: Uint8Array; variant: ReliefVariant },
  suppliedTemplate?: PreparedReliefTemplate,
  legacyTemplate?: PreparedReliefTemplate,
): Promise<ReliefPrototypeResult> {
  if (base && !['standard', 'normal'].includes(base.variant)) throw new Error('Modèle précédent incompatible avec le volume du calque.');
  const settings = normalizeWheelSurface(value), template = suppliedTemplate ?? await loadPreparedReliefTemplate('tyres');
  const sculpted = settings.volume === true && (settings.mode === 'gravel' || settings.mode === 'mud');
  const mode = sculpted ? settings.mode as 'gravel' | 'mud' : null;
  const depthMm = mode ? WHEEL_TREAD_DEPTH_MM[mode] : 0;
  let result = await buildReliefPrototype({
    template, family: 'wheels', mode: 'geometry', scope: 'vehicle', textureResolution: 2048,
    strengthMm: depthMm * settings.strength, heightAtlas: HEIGHT_SOURCE,
    heightSample: (u, v) => {
      const across = (u - WHEEL_TREAD_UV.minU) / (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU);
      return mode && across >= 0 && across <= 1
        ? sampleWheelTreadBlockHeight(mode, across, 1 - v) / (depthMm / 1000) : 0;
    },
  });
  if (base) {
    result = preserveVariant(template, result, base.variant);
    result = retainOtherLayerVolumes(template, result, base, EMPTY_MASK, undefined, { replaceFamilies: ['wheels'] });
  }
  result = await preserveWheelSidewalls(template, result, base ?? { mesh: template.variants[result.stats.templateVariant], variant: result.stats.templateVariant }, legacyTemplate);
  return { ...result, project: { ...result.project, surfaceTemplate: 'tyres' } };
}
