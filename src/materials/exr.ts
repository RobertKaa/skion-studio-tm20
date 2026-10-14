/** Browser-only EXR import. Float images are converted to the editor's RGBA8 maps. */
import { FloatType } from 'three';
export const MATERIAL_EXR_LIMITS = { fileBytes: 64 * 1024 * 1024, dimension: 8192, pixels: 16 * 1024 * 1024,
  headerBytes: 256 * 1024, attributes: 128, workerTimeoutMs: 60_000 } as const;

export interface MaterialExrMetadata {
  width: number; height: number; pixels: number; mime: 'image/x-exr'; compression: number; channels: string[];
}
export interface MaterialExrPixels { width: number; height: number; data: Uint8ClampedArray; clamped: boolean }
export type MaterialExrMode = 'color' | 'data';
interface Channel { name: string; pixelType: number; pLinear: number }
interface Chunk { start: number; size: number; line: number; lines: number; rawBytes: number }
interface Inspected { metadata: MaterialExrMetadata; channels: Channel[]; chunks: Chunk[]; channelBytes: Uint8Array }
type ExrParser = (buffer: ArrayBuffer) => { width?: number; height?: number; data?: ArrayBufferView<ArrayBufferLike> | null };
const lineCounts = [1, 1, 1, 16, 32, 16, 32, 32, 32, 256];
function fail(message: string): never { throw new Error(`Matériau non importé : EXR ${message}`); }
const decoder = new TextDecoder('ascii', { fatal: true });

function inspect(bytes: Uint8Array): Inspected {
  if (bytes.length < 9 || bytes.length > MATERIAL_EXR_LIMITS.fileBytes) fail('vide ou trop volumineux (64 Mo maximum).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 20_000_630) fail('invalide ou endommagé.');
  const version = view.getUint32(4, true);
  if ((version & 255) !== 2 || version & ~0x1fff) fail('de version non prise en charge.');
  if (version & (0x200 | 0x800 | 0x1000)) fail('multicouche, tiled ou deep non pris en charge. Utilisez ses textures PNG/JPEG ou un EXR simple.');
  if (version & 0x100) fail('avec indicateurs invalides.');
  let offset = 8;
  function string(end: number) {
    const start = offset; const limit = Math.min(end, start + (version & 0x400 ? 256 : 32));
    while (offset < limit && bytes[offset]) offset++;
    if (offset >= limit) fail('avec un en-tête tronqué ou un nom trop long.');
    const value = decoder.decode(bytes.subarray(start, offset++));
    if (/[^\x20-\x7e]/.test(value)) fail('avec un nom de canal ou de métadonnée invalide.');
    return value;
  }
  const attributes = new Map<string, { type: string; start: number; size: number }>();
  while (true) {
    const name = string(Math.min(bytes.length, MATERIAL_EXR_LIMITS.headerBytes));
    if (!name) break;
    if (attributes.size >= MATERIAL_EXR_LIMITS.attributes || ['__proto__', 'constructor', 'prototype'].includes(name) || attributes.has(name)) fail('avec des métadonnées invalides.');
    const type = string(Math.min(bytes.length, MATERIAL_EXR_LIMITS.headerBytes));
    if (!type || offset + 4 > bytes.length) fail('avec un en-tête tronqué.');
    const size = view.getInt32(offset, true); offset += 4;
    if (size < 0 || offset + size > Math.min(bytes.length, MATERIAL_EXR_LIMITS.headerBytes)) fail('avec des métadonnées trop volumineuses ou tronquées.');
    attributes.set(name, { type, start: offset, size }); offset += size;
  }
  const attr = (name: string, type: string, size?: number) => {
    const value = attributes.get(name);
    if (!value || value.type !== type || size !== undefined && value.size !== size) fail(`avec l'attribut ${name} absent ou invalide.`);
    return value;
  };
  const window = attr('dataWindow', 'box2i', 16);
  const xMin = view.getInt32(window.start, true), yMin = view.getInt32(window.start + 4, true);
  const width = view.getInt32(window.start + 8, true) - xMin + 1, height = view.getInt32(window.start + 12, true) - yMin + 1;
  if (width < 1 || height < 1 || width > MATERIAL_EXR_LIMITS.dimension || height > MATERIAL_EXR_LIMITS.dimension || width * height > MATERIAL_EXR_LIMITS.pixels) fail('trop grand (8192 px et 16 millions de pixels maximum).');
  const compression = bytes[attr('compression', 'compression', 1).start];
  if (compression >= lineCounts.length) fail('avec une compression non prise en charge. Utilisez un EXR ZIP/DWAA ou ses textures PNG/JPEG.');
  const order = bytes[attr('lineOrder', 'lineOrder', 1).start];
  if (order > 1) fail('avec un ordre de lignes non pris en charge.');
  const list = attr('channels', 'chlist');
  const end = list.start + list.size; const tableStart = offset; offset = list.start;
  const channels: Channel[] = [];
  while (offset < end && bytes[offset]) {
    const name = string(end);
    if (channels.length >= 4 || !['R', 'G', 'B', 'A', 'Y'].includes(name) || channels.some((channel) => channel.name === name)) fail('multicouche ou avec des canaux non pris en charge. Utilisez des textures RGB(A) ou Y simples.');
    if (offset + 16 > end) fail('avec une liste de canaux tronquée.');
    const pixelType = view.getInt32(offset, true), pLinear = bytes[offset + 4];
    if (![1, 2].includes(pixelType) || pLinear > 1 || bytes.subarray(offset + 5, offset + 8).some(Boolean) ||
      view.getInt32(offset + 8, true) !== 1 || view.getInt32(offset + 12, true) !== 1) fail('avec des canaux sous-échantillonnés ou un type de pixel non pris en charge.');
    channels.push({ name, pixelType, pLinear }); offset += 16;
  }
  if (offset + 1 !== end || bytes[offset] !== 0 || !channels.length || channels.some((channel) => channel.pixelType !== channels[0].pixelType) ||
    !(channels.length === 1 && channels[0].name === 'Y' || [3, 4].includes(channels.length) && ['R', 'G', 'B'].every((name) => channels.some((channel) => channel.name === name)))) fail('avec des canaux incompatibles. Utilisez des textures RGB(A) ou Y simples, HALF ou FLOAT.');
  const blockHeight = lineCounts[compression], blockCount = Math.ceil(height / blockHeight);
  const tableEnd = tableStart + blockCount * 8;
  if (tableEnd > bytes.length) fail('avec une table de lignes tronquée.');
  const chunks: Chunk[] = [];
  for (let index = 0; index < blockCount; index++) {
    const position = tableStart + index * 8;
    if (view.getUint32(position + 4, true)) fail('avec un offset de ligne invalide.');
    const start = view.getUint32(position, true);
    if (start < tableEnd || start + 8 > bytes.length) fail('avec un bloc de pixels tronqué.');
    const line = view.getInt32(start, true) - yMin, size = view.getUint32(start + 4, true);
    const lines = Math.min(blockHeight, height - line), rawBytes = width * lines * channels.length * channels[0].pixelType * 2;
    if (line !== index * blockHeight || !size || size > rawBytes || start + 8 + size > bytes.length || compression === 0 && size !== rawBytes) fail('avec un bloc de pixels incohérent ou tronqué.');
    chunks.push({ start: start + 8, size, line, lines, rawBytes });
  }
  const ranges = [...chunks].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index++) if (ranges[index].start - 8 < ranges[index - 1].start + ranges[index - 1].size) fail('avec des blocs de pixels superposés.');
  return { metadata: { width, height, pixels: width * height, mime: 'image/x-exr', compression, channels: channels.map((channel) => channel.name) },
    channels, chunks, channelBytes: bytes.slice(list.start, end) };
}

/** Bounds dimensions, headers, channel counts and scanline chunks before decoding. */
export function inspectMaterialExr(bytes: Uint8Array): MaterialExrMetadata { return inspect(bytes).metadata; }

/** Bound the actual inflate output before EXRLoader's synchronous inflater sees it. */
async function inflateBounded(bytes: Uint8Array, limit: number, exact = true): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') fail('indisponible dans ce navigateur. Utilisez ses textures PNG/JPEG.');
  const reader = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      if ((length += chunk.value.length) > limit) { await reader.cancel(); fail('décompressé trop volumineux ou taille falsifiée.'); }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Matériau non importé :')) throw error;
    fail('avec des données compressées endommagées.');
  }
  if (exact && length !== limit) fail('avec une taille décompressée incohérente.');
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function inspectRle(bytes: Uint8Array, expected: number) {
  let offset = 0, expanded = 0;
  while (offset < bytes.length) {
    const code = bytes[offset++] << 24 >> 24; const count = code < 0 ? -code : code + 1;
    const consumed = code < 0 ? count : 1;
    if (offset + consumed > bytes.length || (expanded += count) > expected) fail('avec des données RLE invalides ou trop volumineuses.');
    offset += consumed;
  }
  if (expanded !== expected) fail('avec une taille RLE incohérente.');
}

function inspectHuffman(bytes: Uint8Array) {
  if (bytes.length < 20) fail('avec un bloc Huffman tronqué.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) > 65_536 || view.getUint32(4, true) > 65_536 || view.getUint32(0, true) > view.getUint32(4, true) ||
    view.getUint32(8, true) > bytes.length - 20 || view.getUint32(12, true) > (bytes.length - 20) * 8) fail('avec un bloc Huffman invalide.');
}

async function inspectDwa(bytes: Uint8Array, chunk: Chunk, inspected: Inspected) {
  if (bytes.length < 90) fail('avec un bloc DWA tronqué.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = Array.from({ length: 11 }, (_, index) => {
    if (view.getUint32(index * 8 + 4, true)) fail('avec une taille DWA falsifiée.');
    return view.getUint32(index * 8, true);
  });
  const [version, unknownRaw, unknownSize, acSize, dcSize, rleSize, rleExpanded, rleRaw, acCount, dcCount, acCompression] = values;
  const dctBlocks = Math.ceil(inspected.metadata.width / 8) * Math.ceil(chunk.lines / 8);
  if (version !== 2 || unknownRaw || unknownSize || acCompression !== 0 || acCount > dctBlocks * inspected.channels.length * 64 ||
    dcCount > dctBlocks * inspected.channels.length || rleRaw > chunk.rawBytes || rleExpanded > chunk.rawBytes * 2 + 128 ||
    [acSize, dcSize, rleSize].some((size) => size > bytes.length)) fail('avec des tailles ou une compression DWA non prises en charge.');
  const rulesSize = view.getUint16(88, true); const rulesEnd = 88 + rulesSize;
  if (rulesSize < 2 || rulesEnd > bytes.length || rulesSize > 256) fail('avec des règles DWA invalides.');
  let offset = 90; const seen = new Set<string>(); let lossyChannels = 0; let rleChannels = 0;
  while (offset < rulesEnd) {
    const start = offset;
    while (offset < rulesEnd && bytes[offset]) offset++;
    if (offset === rulesEnd || offset - start > 31 || offset + 3 > rulesEnd) fail('avec des règles DWA tronquées.');
    const name = decoder.decode(bytes.subarray(start, offset++)); const value = bytes[offset++], type = bytes[offset++];
    const compression = value >> 2 & 3, cscIndex = (value >> 4) - 1;
    const channel = inspected.channels.find((channel) => channel.name === name);
    if (!channel || seen.has(name) || type !== channel.pixelType || cscIndex > 2 || ![1, 2].includes(compression) ||
      cscIndex >= 0 && (compression !== 1 || name !== ['R', 'G', 'B'][cscIndex]) || type !== 1) fail('avec des règles DWA incompatibles.');
    seen.add(name); if (compression === 1) lossyChannels++; else rleChannels++;
  }
  if (seen.size !== inspected.channels.length || acCount > dctBlocks * lossyChannels * 64 || dcCount !== dctBlocks * lossyChannels ||
    rleRaw !== inspected.metadata.width * chunk.lines * rleChannels * 2 || rulesEnd + acSize + dcSize + rleSize !== bytes.length) fail('avec des tailles DWA incohérentes.');
  offset = rulesEnd;
  if (acSize) { inspectHuffman(bytes.subarray(offset, offset + acSize)); offset += acSize; }
  else if (acCount) fail('sans données AC DWA.');
  if (dcSize) { await inflateBounded(bytes.subarray(offset, offset + dcSize), dcCount * 2); offset += dcSize; }
  else if (dcCount) fail('sans données DC DWA.');
  if (rleSize) {
    const expanded = await inflateBounded(bytes.subarray(offset, offset + rleSize), rleExpanded);
    inspectRle(expanded, rleRaw);
  } else if (rleRaw || rleExpanded) fail('sans données RLE DWA.');
}

async function validateCompressedChunks(bytes: Uint8Array, inspected: Inspected) {
  for (const chunk of inspected.chunks) {
    if (chunk.size === chunk.rawBytes) continue;
    const input = bytes.subarray(chunk.start, chunk.start + chunk.size), compression = inspected.metadata.compression;
    if (compression === 1) inspectRle(input, chunk.rawBytes);
    else if (compression === 2 || compression === 3) await inflateBounded(input, chunk.rawBytes);
    else if (compression === 5) {
      const pxrBytes = inspected.metadata.width * chunk.lines * inspected.channels.length * (inspected.channels[0].pixelType === 1 ? 2 : 3);
      await inflateBounded(input, pxrBytes);
    } else if (compression === 4) {
      if (input.length < 8) fail('avec un bloc PIZ tronqué.');
      const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
      const min = view.getUint16(0, true), max = view.getUint16(2, true);
      if (max >= 8192) fail('avec une table PIZ invalide.');
      const offset = 4 + (min <= max ? max - min + 1 : 0);
      if (offset + 4 > input.length || view.getUint32(offset, true) !== input.length - offset - 4) fail('avec un bloc PIZ invalide.');
      inspectHuffman(input.subarray(offset + 4));
    } else if (compression === 8 || compression === 9) await inspectDwa(input, chunk, inspected);
    // B44/A output and work buffers depend only on checked dimensions/channels.
  }
}

const encoder = new TextEncoder();
function concatenate(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function attribute(name: string, type: string, value: Uint8Array) {
  const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, value.length, true);
  return concatenate([encoder.encode(`${name}\0${type}\0`), size, value]);
}

/** Only a canonical header reaches the third-party decoder; arbitrary metadata never does. */
function sanitizedExr(bytes: Uint8Array, inspected: Inspected): ArrayBuffer {
  const { width, height, compression } = inspected.metadata;
  const window = new Uint8Array(16), windowView = new DataView(window.buffer);
  windowView.setInt32(8, width - 1, true); windowView.setInt32(12, height - 1, true);
  const one = new Uint8Array(4); new DataView(one.buffer).setFloat32(0, 1, true);
  const header = concatenate([new Uint8Array([118, 47, 49, 1, 2, 0, 0, 0]),
    attribute('channels', 'chlist', inspected.channelBytes), attribute('compression', 'compression', new Uint8Array([compression])),
    attribute('dataWindow', 'box2i', window), attribute('displayWindow', 'box2i', window),
    attribute('lineOrder', 'lineOrder', new Uint8Array([0])), attribute('pixelAspectRatio', 'float', one),
    attribute('screenWindowCenter', 'v2f', new Uint8Array(8)), attribute('screenWindowWidth', 'float', one), new Uint8Array([0])]);
  const size = header.length + inspected.chunks.length * 8 + inspected.chunks.reduce((total, chunk) => total + 8 + chunk.size, 0);
  const output = new Uint8Array(size); output.set(header); const view = new DataView(output.buffer);
  let offset = header.length + inspected.chunks.length * 8;
  inspected.chunks.forEach((chunk, index) => {
    view.setUint32(header.length + index * 8, offset, true);
    view.setInt32(offset, chunk.line, true); view.setUint32(offset + 4, chunk.size, true);
    output.set(bytes.subarray(chunk.start, chunk.start + chunk.size), offset + 8); offset += 8 + chunk.size;
  });
  return output.buffer;
}

/** Shared by the worker and Node tests; the parser receives only validated buffers. */
export async function decodeMaterialExrWithParser(bytes: Uint8Array, mode: MaterialExrMode, parse: ExrParser): Promise<MaterialExrPixels> {
  if (mode !== 'color' && mode !== 'data') fail('avec un mode de conversion invalide.');
  const inspected = inspect(bytes); await validateCompressedChunks(bytes, inspected);
  let parsed: ReturnType<ExrParser>;
  try { parsed = parse(sanitizedExr(bytes, inspected)); } catch { fail('illisible ou endommagé. Utilisez ses textures PNG/JPEG.'); }
  const { width, height } = inspected.metadata;
  if (parsed.width !== width || parsed.height !== height || !(parsed.data instanceof Float32Array) || parsed.data.length !== width * height * 4) fail('avec des données de pixels incohérentes.');
  const data = new Uint8ClampedArray(width * height * 4); let clamped = false;
  const convert = (value: number, color: boolean) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) clamped = true;
    const normalized = Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value));
    const output = color ? normalized <= 0.0031308 ? normalized * 12.92 : 1.055 * normalized ** (1 / 2.4) - 0.055 : normalized;
    return Math.round(output * 255);
  };
  // EXRLoader's float buffer starts at the bottom row; canvas images start at the top.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = ((height - y - 1) * width + x) * 4, target = (y * width + x) * 4;
    data[target] = convert(parsed.data[source], mode === 'color'); data[target + 1] = convert(parsed.data[source + 1], mode === 'color');
    data[target + 2] = convert(parsed.data[source + 2], mode === 'color'); data[target + 3] = convert(parsed.data[source + 3], false);
  }
  return { width, height, data, clamped };
}

export async function decodeMaterialExr(bytes: Uint8Array, mode: MaterialExrMode): Promise<MaterialExrPixels> {
  inspectMaterialExr(bytes);
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./exr.worker.ts', import.meta.url), { type: 'module' });
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Matériau non importé : le décodage EXR a dépassé le délai. Utilisez ses textures PNG/JPEG.')); }, MATERIAL_EXR_LIMITS.workerTimeoutMs);
      const finish = () => { clearTimeout(timeout); worker.terminate(); };
      worker.onmessage = (event: MessageEvent<{ result?: MaterialExrPixels; error?: string }>) => {
        finish(); if (event.data.result) resolve(event.data.result); else reject(new Error(event.data.error || 'Matériau non importé : EXR illisible.'));
      };
      worker.onerror = () => { finish(); reject(new Error('Matériau non importé : le navigateur ne peut pas décoder cet EXR. Utilisez ses textures PNG/JPEG.')); };
      const copy = bytes.slice(); worker.postMessage({ bytes: copy, mode }, [copy.buffer]);
    });
  }
  const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
  const loader = new EXRLoader().setDataType(FloatType);
  return decodeMaterialExrWithParser(bytes, mode, (buffer) => loader.parse(buffer));
}
