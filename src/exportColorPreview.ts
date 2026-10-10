import { decodeDDS, encodeDDS, type RGBAImage } from './dds';
import type { BCFormat } from './maps';

export type ExportColorMapId = 'Skin_B' | 'Details_B' | 'Wheels_B';
export interface ExportColorImage { id: ExportColorMapId; levels: RGBAImage[] }
export type ExportMaterialMapId = ExportColorMapId | 'Skin_R' | 'Details_R' | 'Wheels_R' | 'Skin_CoatR';
export interface ExportMaterialImage { id: ExportMaterialMapId; levels: RGBAImage[] }

const FORMAT_FOURCC = new Map<number, { format: BCFormat; blockBytes: number }>([
  [0x31545844, { format: 'BC1', blockBytes: 8 }], // DXT1
  [0x31495441, { format: 'BC4', blockBytes: 8 }], // ATI1
  [0x55344342, { format: 'BC4', blockBytes: 8 }], // BC4U
  [0x32495441, { format: 'BC5', blockBytes: 16 }], // ATI2 (DDS R/G convention handled by decodeDDS)
  [0x59583241, { format: 'BC5', blockBytes: 16 }], // A2XY
  [0x55354342, { format: 'BC5', blockBytes: 16 }], // BC5U
]);

/** Decode the original export mip payloads; material data remains in DDS R/G channels. */
function decodeExportMips(encoded: ArrayBuffer, expected?: BCFormat): RGBAImage[] {
  if (encoded.byteLength < 128) throw new Error('Texture DDS invalide.');
  const header = new DataView(encoded);
  const info = FORMAT_FOURCC.get(header.getUint32(84, true));
  if (header.getUint32(0, true) !== 0x20534444 || !info || (expected && info.format !== expected)) throw new Error('Texture DDS invalide.');
  let width = header.getUint32(16, true), height = header.getUint32(12, true), offset = 128;
  const count = header.getUint32(28, true);
  if (!width || !height || width > 8192 || height > 8192 || count < 1 || count > Math.floor(Math.log2(Math.max(width, height))) + 1) throw new Error('Dimensions DDS invalides.');
  const levels: RGBAImage[] = [];
  for (let i = 0; i < count; i++) {
    const size = Math.ceil(width / 4) * Math.ceil(height / 4) * info.blockBytes;
    if (offset + size > encoded.byteLength) throw new Error('Texture DDS tronquée.');
    const mip = new Uint8Array(128 + size);
    mip.set(new Uint8Array(encoded, 0, 128));
    mip.set(new Uint8Array(encoded, offset, size), 128);
    const view = new DataView(mip.buffer);
    view.setUint32(12, height, true); view.setUint32(16, width, true); view.setUint32(28, 1, true);
    const image = decodeDDS(mip.buffer);
    if (!image) throw new Error('Texture DDS non décodable.');
    levels.push(image);
    offset += size; width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
  }
  return levels;
}

/** Decode each actual BC1 export mip, instead of creating new GPU mips from mip zero. */
export function decodeColorMips(encoded: ArrayBuffer): RGBAImage[] {
  return decodeExportMips(encoded, 'BC1');
}

/** Supports the BC1 colors, BC5 roughness/metalness and BC4 varnish used in the ZIP. */
export function decodeMaterialMips(encoded: ArrayBuffer): RGBAImage[] { return decodeExportMips(encoded); }

/** Same RGB format and gamma-aware mip generation as buildSkinZipFromImages. */
export function compressExportColor(id: ExportColorMapId, source: RGBAImage): ExportColorImage {
  return { id, levels: decodeColorMips(encodeDDS(source, 'BC1', { colorSpace: 'srgb' })) };
}

/** Uses the same formats and color-space-aware mip filtering as the actual exporter. */
export function compressExportMaterial(id: ExportMaterialMapId, source: RGBAImage): ExportMaterialImage {
  if (id.endsWith('_B')) return compressExportColor(id as ExportColorMapId, source);
  const format = id === 'Skin_CoatR' ? 'BC4' : 'BC5';
  return { id, levels: decodeMaterialMips(encodeDDS(source, format, { colorSpace: 'linear' })) };
}
