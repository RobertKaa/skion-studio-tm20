import type { ReliefGeometry, ReliefVariant } from './types';

interface GlbJson {
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[]; sparse?: unknown }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { byteLength: number; uri?: string }[];
  materials?: { name?: string }[];
}

function parseGlb(source: Uint8Array): { json: GlbJson; bin: Uint8Array } {
  if (source.byteLength < 28 || source.byteLength > 64 * 1024 * 1024) throw new Error('Aperçu du relief invalide.');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== source.byteLength) throw new Error('En-tête GLB du relief invalide.');
  const jsonLength = view.getUint32(12, true), binHeader = 20 + jsonLength;
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength % 4 || binHeader + 8 > source.byteLength) throw new Error('Structure GLB du relief invalide.');
  const binLength = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== 0x004e4942 || binLength % 4 || binHeader + 8 + binLength !== source.byteLength) throw new Error('Buffer GLB du relief invalide.');
  const json = JSON.parse(new TextDecoder().decode(source.subarray(20, binHeader))) as GlbJson;
  if (!Array.isArray(json.accessors) || !Array.isArray(json.bufferViews) || json.buffers?.length !== 1 || json.buffers[0].uri || json.buffers[0].byteLength > binLength) throw new Error('Ressources GLB du relief invalides.');
  return { json, bin: source.slice(binHeader + 8) };
}

export function patchReliefPreview(source: Uint8Array, geometries: readonly ReliefGeometry[], positions: readonly Float32Array[], normals: readonly Float32Array[], variant: ReliefVariant = 'standard'): ArrayBuffer {
  const { json, bin } = parseGlb(source);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), used = new Set<number>();
  function write(accessorIndex: number, values: Float32Array, original: readonly number[], bounds: boolean) {
    if (!Number.isInteger(accessorIndex) || used.has(accessorIndex)) throw new Error('Accesseur GLB de relief dupliqué ou invalide.');
    used.add(accessorIndex);
    const accessor = json.accessors[accessorIndex], buffer = json.bufferViews[accessor?.bufferView];
    if (!accessor || !buffer || accessor.type !== 'VEC3' || accessor.componentType !== 5126 || accessor.count * 3 !== values.length || accessor.sparse || buffer.buffer !== 0) throw new Error('Géométrie GLB du relief incompatible.');
    const offset = (buffer.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = buffer.byteStride ?? 12;
    if (!Number.isInteger(offset) || offset < 0 || offset % 4 || !Number.isInteger(stride) || stride < 12 || stride % 4
      || offset + (accessor.count - 1) * stride + 12 > bin.byteLength
      || (accessor.byteOffset ?? 0) + (accessor.count - 1) * stride + 12 > buffer.byteLength) throw new Error('Plage GLB du relief invalide.');
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let vertex = 0; vertex < accessor.count; vertex++) for (let axis = 0; axis < 3; axis++) {
      const target = offset + vertex * stride + axis * 4, current = view.getFloat32(target, true);
      if (!Number.isFinite(current) || Math.abs(current - original[vertex * 3 + axis]) > .00002) throw new Error('Le modèle d’aperçu ne correspond pas au modèle de relief.');
      const value = values[vertex * 3 + axis];
      view.setFloat32(target, value, true);
      min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    }
    if (bounds) { accessor.min = min; accessor.max = max; }
  }
  geometries.forEach((geometry, i) => {
    if (geometry.positionAccessor === undefined || geometry.normalAccessor === undefined) return;
    write(geometry.positionAccessor, positions[i], geometry.positions, true); write(geometry.normalAccessor, normals[i], geometry.normals, false);
  });
  if (variant === 'normal') for (const material of json.materials ?? []) if (material.name === '_SkinDmg_Skin') material.name = '_DetailsDmgNormal_Skin';
  const encoded = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(encoded.length / 4) * 4;
  const result = new Uint8Array(28 + jsonLength + bin.length), output = new DataView(result.buffer);
  output.setUint32(0, 0x46546c67, true); output.setUint32(4, 2, true); output.setUint32(8, result.byteLength, true);
  output.setUint32(12, jsonLength, true); output.setUint32(16, 0x4e4f534a, true);
  result.fill(32, 20, 20 + jsonLength); result.set(encoded, 20);
  output.setUint32(20 + jsonLength, bin.length, true); output.setUint32(24 + jsonLength, 0x004e4942, true); result.set(bin, 28 + jsonLength);
  return result.buffer;
}
