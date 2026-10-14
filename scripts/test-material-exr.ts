import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { decodeMaterialExr, decodeMaterialExrWithParser, inspectMaterialExr, MATERIAL_EXR_LIMITS } from '../src/materials/exr';

const encoder = new TextEncoder();
function join(parts: Uint8Array[]) { const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes; }
function uint32(value: number) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); return bytes; }
function attr(name: string, type: string, value: Uint8Array) { return join([encoder.encode(`${name}\0${type}\0`), uint32(value.length), value]); }
function fixture(options: { width?: number; height?: number; channels?: string[]; pixels?: number[][]; compression?: number; half?: boolean; origin?: number; payload?: Uint8Array } = {}) {
  const { width = 2, height = 2, channels = ['A', 'B', 'G', 'R'], pixels = [[0.25, 0.5, 0.75, 1], [0.125, 0.25, 0.5, 0.5], [0, 1, 0.5, 0.25], [1, 0, 0.25, 1]], compression = 0, half = false, origin = 0 } = options;
  const window = join([uint32(origin), uint32(origin), uint32(width + origin - 1), uint32(height + origin - 1)]);
  const channelList = join([...channels.map((name) => join([encoder.encode(`${name}\0`), uint32(half ? 1 : 2), uint32(0), uint32(1), uint32(1)])), new Uint8Array([0])]);
  const header = join([new Uint8Array([118, 47, 49, 1, 2, 0, 0, 0]), attr('channels', 'chlist', channelList), attr('compression', 'compression', new Uint8Array([compression])),
    attr('dataWindow', 'box2i', window), attr('displayWindow', 'box2i', window), attr('lineOrder', 'lineOrder', new Uint8Array([0])),
    attr('pixelAspectRatio', 'float', uint32(0x3f800000)), attr('screenWindowCenter', 'v2f', new Uint8Array(8)), attr('screenWindowWidth', 'float', uint32(0x3f800000)), new Uint8Array([0])]);
  const blockHeight = [1, 1, 1, 16, 32, 16, 32, 32, 32, 256][compression] || 1;
  const chunks: Uint8Array[] = [];
  for (let line = 0; line < height; line += blockHeight) {
    const lines = Math.min(blockHeight, height - line), bytesPerSample = half ? 2 : 4;
    const raw = new Uint8Array(width * lines * channels.length * bytesPerSample); const view = new DataView(raw.buffer); let offset = 0;
    for (let y = line; y < line + lines; y++) for (const name of channels) for (let x = 0; x < width; x++) {
      const value = pixels[y * width + x]?.[['R', 'G', 'B', 'A'].indexOf(name) < 0 ? 0 : ['R', 'G', 'B', 'A'].indexOf(name)] ?? 0.5;
      if (half) { const table = new Map([[0, 0], [0.125, 0x3000], [0.25, 0x3400], [0.5, 0x3800], [0.75, 0x3a00], [1, 0x3c00]]); assert(table.has(value)); view.setUint16(offset, table.get(value)!, true); }
      else view.setFloat32(offset, value, true);
      offset += bytesPerSample;
    }
    let payload = options.payload || raw;
    if ((compression === 2 || compression === 3) && !options.payload) {
      const reordered = new Uint8Array(raw.length); let even = 0, odd = Math.ceil(raw.length / 2);
      for (let index = 0; index < raw.length; index++) reordered[index % 2 ? odd++ : even++] = raw[index];
      for (let index = reordered.length - 1; index > 0; index--) reordered[index] = reordered[index] - reordered[index - 1] + 128;
      const compressed = new Uint8Array(deflateSync(reordered)); payload = compressed.length < raw.length ? compressed : raw;
    }
    chunks.push(join([uint32(line + origin), uint32(payload.length), payload]));
  }
  const table = new Uint8Array(chunks.length * 8); let position = header.length + table.length;
  chunks.forEach((chunk, index) => { new DataView(table.buffer).setUint32(index * 8, position, true); position += chunk.length; });
  return { bytes: join([header, table, ...chunks]), headerSize: header.length, chunksOffset: header.length + table.length };
}

const simple = fixture();
assert.deepEqual(inspectMaterialExr(simple.bytes), { width: 2, height: 2, pixels: 4, mime: 'image/x-exr', compression: 0, channels: ['A', 'B', 'G', 'R'] });
const numeric = await decodeMaterialExr(simple.bytes, 'data');
assert.deepEqual([...numeric.data], [64, 128, 191, 255, 32, 64, 128, 128, 0, 255, 128, 64, 255, 0, 64, 255], 'Numeric maps preserve channel values, alpha and top-to-bottom image orientation');
assert.equal(numeric.clamped, false);
const color = await decodeMaterialExr(simple.bytes, 'color');
assert.deepEqual([...color.data.slice(0, 4)], [137, 188, 225, 255], 'Linear EXR color converts to sRGB');
assert.equal(color.data[7], 128, 'Alpha is never gamma transformed');
assert.deepEqual((await decodeMaterialExr(fixture({ origin: 7 }).bytes, 'data')).data, numeric.data, 'Nonzero data windows retain alignment');
assert.deepEqual((await decodeMaterialExr(fixture({ half: true }).bytes, 'data')).data, numeric.data, 'HALF maps retain the same normalized values');
const yOnly = await decodeMaterialExr(fixture({ channels: ['Y'], pixels: [[0], [0.5], [1], [0.25]], half: true }).bytes, 'data');
assert.deepEqual([...yOnly.data], [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 64, 64, 64, 255], 'Y scalar maps expand without gamma');
const rle = fixture({ width: 16, height: 1, channels: ['Y'], half: true, compression: 1, pixels: Array.from({ length: 16 }, () => [0]), payload: new Uint8Array([0, 0, 30, 128]) });
const rlePixels = await decodeMaterialExr(rle.bytes, 'data');
assert(rlePixels.data.every((value, index) => value === (index % 4 === 3 ? 255 : 0)), 'Bounded RLE restores numeric samples');
for (const compression of [2, 3]) {
  const zipped = fixture({ compression });
  assert.deepEqual((await decodeMaterialExr(zipped.bytes, 'data')).data, numeric.data, 'Bounded ZIPS/ZIP keep numeric maps intact');
}
const hdr = fixture({ pixels: [[-1, 2, NaN, 0.5], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]] });
const clamped = await decodeMaterialExr(hdr.bytes, 'data');
assert.equal(clamped.clamped, true); assert.deepEqual([...clamped.data.slice(0, 4)], [0, 255, 0, 128]);

assert.throws(() => inspectMaterialExr(new Uint8Array(8)), /vide|invalide/);
assert.throws(() => inspectMaterialExr(new Uint8Array(MATERIAL_EXR_LIMITS.fileBytes + 1)), /64 Mo/);
for (const flag of [0x200, 0x800, 0x1000]) {
  const bytes = simple.bytes.slice(); new DataView(bytes.buffer).setUint32(4, 2 | flag, true);
  assert.throws(() => inspectMaterialExr(bytes), /multicouche, tiled ou deep/);
}
const windowOffset = simple.bytes.findIndex((_, index) => index + 11 < simple.bytes.length && decoderString(simple.bytes.subarray(index, index + 11)) === 'dataWindow\0');
function decoderString(bytes: Uint8Array) { return new TextDecoder().decode(bytes); }
const oversized = simple.bytes.slice(); new DataView(oversized.buffer).setInt32(windowOffset + 11 + 6 + 4 + 8, 8192, true);
assert.throws(() => inspectMaterialExr(oversized), /trop grand/);
assert.throws(() => inspectMaterialExr(simple.bytes.subarray(0, simple.bytes.length - 1)), /tronqué/);
const badOffset = simple.bytes.slice(); new DataView(badOffset.buffer).setUint32(simple.headerSize, 0, true);
assert.throws(() => inspectMaterialExr(badOffset), /tronqué/);
const hugeOffset = simple.bytes.slice(); new DataView(hugeOffset.buffer).setUint32(simple.headerSize + 4, 1, true);
assert.throws(() => inspectMaterialExr(hugeOffset), /offset/);
const badChannels = fixture({ channels: ['beauty.R', 'beauty.G', 'beauty.B'] });
assert.throws(() => inspectMaterialExr(badChannels.bytes), /multicouche/);
let parserCalled = false;
// Keep a size-valid compressed chunk, then catch its true inflate output before parsing.
const bombSmall = fixture({ width: 16, height: 1, compression: 3, payload: new Uint8Array(deflateSync(new Uint8Array(100_000))) });
await assert.rejects(decodeMaterialExrWithParser(bombSmall.bytes, 'data', () => { parserCalled = true; return { width: 16, height: 1, data: new Float32Array(64) }; }), /décompressé trop volumineux|taille falsifiée/);
assert.equal(parserCalled, false, 'The decoder never sees a ZIP inflation bomb');
const rleBomb = fixture({ width: 16, height: 1, channels: ['Y'], half: true, compression: 1, payload: new Uint8Array([127, 0]) });
await assert.rejects(decodeMaterialExrWithParser(rleBomb.bytes, 'data', () => { parserCalled = true; return {}; }), /RLE invalides ou trop volumineuses/);
assert.equal(parserCalled, false, 'The decoder never sees an RLE expansion bomb');
const dwaPayload = new Uint8Array(90); const dwaView = new DataView(dwaPayload.buffer);
dwaView.setUint32(0, 2, true); dwaView.setUint32(64, 0xffffffff, true); dwaView.setUint16(88, 2, true);
const dwaBomb = fixture({ width: 16, height: 8, channels: ['Y'], half: true, compression: 8, payload: dwaPayload });
await assert.rejects(decodeMaterialExrWithParser(dwaBomb.bytes, 'data', () => { parserCalled = true; return {}; }), /tailles ou une compression DWA/);
assert.equal(parserCalled, false, 'The decoder never sees unbounded DWA coefficient allocations');
const unknownDwa = dwaBomb.bytes.slice(); new DataView(unknownDwa.buffer).setUint32(dwaBomb.chunksOffset + 8 + 64, 0, true); new DataView(unknownDwa.buffer).setUint32(dwaBomb.chunksOffset + 8 + 8, 1, true);
await assert.rejects(decodeMaterialExr(unknownDwa, 'data'), /tailles ou une compression DWA/);
await assert.rejects(decodeMaterialExrWithParser(simple.bytes, 'data', () => ({ width: 1, height: 1, data: new Float32Array(4) })), /pixels incohérentes/);

// Optional real-world fixtures remain outside the repository (user assets).
for (const path of process.argv.slice(2)) {
  const bytes = new Uint8Array(await readFile(path)); const metadata = inspectMaterialExr(bytes);
  const started = Date.now(); const result = await decodeMaterialExr(bytes, 'data');
  assert.equal(result.width, metadata.width); assert.equal(result.height, metadata.height); assert.equal(result.data.length, metadata.pixels * 4);
  assert(result.data.some((value, index) => index % 4 !== 3 && value > 0 && value < 255), 'The real-world image contains nonuniform numeric values');
  console.log(`✓ EXR réel : ${path} (${metadata.width} × ${metadata.height}, compression ${metadata.compression}, ${Date.now() - started} ms, clamp ${result.clamped})`);
}
console.log('✓ EXR : HALF/FLOAT, RGB(A)/Y, couleur/data distincts, alpha/orientation, ZIP borné, en-têtes et quotas sûrs');
