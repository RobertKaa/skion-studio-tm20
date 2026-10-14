import JSZip from 'jszip';
import { getEnv } from 'fabric';
import { createMaterialDefinition, isValidMaterialDefinition, MATERIAL_CHANNELS, type MaterialChannel, type MaterialDefinition, type MaterialTexture } from './types';
import { loadMaterialSources, getMaterialSourceCanvas } from './render';
import { decodeMaterialExr, inspectMaterialExr } from './exr';

export const MATERIAL_IMPORT_LIMITS = { files: 10, fileBytes: 64 * 1024 * 1024, totalBytes: 128 * 1024 * 1024,
  pixels: 16 * 1024 * 1024, totalPixels: 64 * 1024 * 1024, dimension: 8192, manifestBytes: 256 * 1024 } as const;
export const MATERIAL_ARCHIVE_LIMITS = { entries: 256, archiveBytes: 256 * 1024 * 1024, expandedBytes: 512 * 1024 * 1024 } as const;
export interface MaterialImportOptions { maxTextureSize?: 1024 | 2048 | 4096; targetChannel?: MaterialChannel }
export interface MaterialImportResult { definition: MaterialDefinition; notices: string[] }
const PACK_FORMAT = 'skion-material';
const IMAGE_PATH = /^textures\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.(?:png|jpe?g|webp)$/i;
const DATA_PNG = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function fail(message: string): never { throw new Error(`Matériau non importé : ${message}`); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export interface MaterialTextureRole { channel: MaterialChannel; component: MaterialTexture['component']; invert: boolean }
/** Packed maps retain their numeric channels; they are never converted to a grayscale picture. */
export function detectMaterialTextureRoles(name: string): MaterialTextureRole[] {
  const stem = name.replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  const tokens = stem.split(/[^a-z0-9]+/).filter(Boolean);
  const directXNormal = /(?:normal|normals|nrm|nor|n)(?:dx|directx)(?:\d+k|\d{3,4})?$/.test(stem.replace(/[^a-z0-9]/g, ''));
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === 'direct' && tokens[index + 1] === 'x') tokens.splice(index, 2, 'directx');
    if (tokens[index] === 'open' && tokens[index + 1] === 'gl') tokens.splice(index, 2, 'opengl');
    const packed = /^(normal|normals|nrm|nor)(dx|directx|gl|opengl)$/.exec(tokens[index]);
    if (packed) tokens.splice(index, 1, packed[1], packed[2]);
  }
  while (tokens.length > 1 && /^(?:\d+k|\d{3,4}|gl|dx|opengl|directx|map|texture)$/.test(tokens.at(-1)!)) tokens.pop();
  const joined = tokens.join('');
  const has = (...words: string[]) => words.some((word) => tokens.at(-1) === word || word.length >= 5 && joined.endsWith(word));
  const role = (channel: MaterialChannel, component: MaterialTexture['component'] = 'luminance', invert = false): MaterialTextureRole => ({ channel, component, invert });
  if (has('orm', 'arm', 'occlusionroughnessmetallic', 'occlusionroughnessmetalness')) return [role('ao', 'r'), role('roughness', 'g'), role('metalness', 'b')];
  if (has('rma', 'roughnessmetallicao', 'roughnessmetalnessao')) return [role('roughness', 'r'), role('metalness', 'g'), role('ao', 'b')];
  if (has('roughmetal', 'roughnessmetallic', 'roughnessmetalness') || /^(?:skin|details|wheels)_r$/.test(stem)) return [role('roughmetal')];
  if (has('dirtmask', 'dirt', 'grime', 'wear')) return [role('dirt')];
  if (has('coatr', 'coat', 'clearcoat', 'varnish')) return [role('coat')];
  if (has('normal', 'normals', 'nrm', 'nor') || /(?:^|_)n$/.test(stem)) return [role('normal', 'luminance', directXNormal)];
  if (has('disp', 'displace', 'displacement', 'height', 'bump')) return [role('height')];
  if (has('ambientocclusion', 'occlusion', 'ao')) return [role('ao')];
  if (has('roughness', 'rough', 'rgh')) return [role('roughness')];
  if (has('glossiness', 'gloss', 'smoothness')) return [role('roughness', 'luminance', true)];
  if (has('metallic', 'metalness', 'metal', 'met')) return [role('metalness')];
  if (has('emission', 'emissive', 'emit', 'illumination', 'illum') || /^(?:skin|details|wheels)_i$/.test(stem)) return [role('emission')];
  if (has('basecolor', 'basecolour', 'albedo', 'diffuse', 'diff', 'color', 'colour', 'col', 'bc') || /^(?:skin|details|wheels)_b$/.test(stem)) return [role('color')];
  return [role('color')];
}

function validatePixels(width: number, height: number) {
  if (!width || !height || width > MATERIAL_IMPORT_LIMITS.dimension || height > MATERIAL_IMPORT_LIMITS.dimension ||
    width * height > MATERIAL_IMPORT_LIMITS.pixels) fail('image trop grande (8192 px et 16 millions de pixels maximum).');
  return { width, height, pixels: width * height };
}

/** Inspect dimensions before asking the browser to decode potentially hostile images. */
export function inspectMaterialImage(bytes: Uint8Array): { width: number; height: number; pixels: number; mime: string } {
  if (!bytes.length || bytes.length > MATERIAL_IMPORT_LIMITS.fileBytes) fail('image vide ou trop volumineuse (64 Mo maximum).');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) &&
    view.getUint32(8) === 13 && ascii(12, 4) === 'IHDR') {
    const dimensions = validatePixels(view.getUint32(16), view.getUint32(20));
    if (![0, 2, 3, 4, 6].includes(bytes[25]) || ![1, 2, 4, 8, 16].includes(bytes[24]) || bytes[26] || bytes[27] || bytes[28] > 1) fail('en-tête PNG invalide.');
    let offset = 8; let hasData = false; let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset); const end = offset + length + 12;
      if (end > bytes.length) fail('image PNG tronquée.');
      const kind = ascii(offset + 4, 4);
      if (!/^[A-Za-z]{4}$/.test(kind)) fail('image PNG invalide.');
      if (kind === 'IDAT') hasData = true;
      if (kind === 'IEND') { if (length || end !== bytes.length) fail('fin PNG invalide.'); ended = true; break; }
      offset = end;
    }
    if (!hasData || !ended) fail('image PNG incomplète.');
    return { ...dimensions, mime: 'image/png' };
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) fail('image JPEG invalide.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) fail('image JPEG tronquée.');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) fail('en-tête JPEG invalide.');
        return { ...validatePixels(view.getUint16(offset + 5), view.getUint16(offset + 3)), mime: 'image/jpeg' };
      }
      offset += length;
    }
    fail('dimensions JPEG absentes.');
  }
  if (bytes.length >= 25 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length) {
    const kind = ascii(12, 4); const length = view.getUint32(16, true);
    if (length + 20 > bytes.length) fail('image WebP tronquée.');
    if (kind === 'VP8X' && length >= 10) {
      if (bytes[20] & 2) fail('les textures WebP animées ne sont pas prises en charge.');
      const uint24 = (offset: number) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
      return { ...validatePixels(uint24(24) + 1, uint24(27) + 1), mime: 'image/webp' };
    }
    if (kind === 'VP8L' && length >= 5 && bytes[20] === 47) {
      const bits = view.getUint32(21, true);
      return { ...validatePixels((bits & 0x3fff) + 1, (bits >>> 14 & 0x3fff) + 1), mime: 'image/webp' };
    }
    if (kind === 'VP8 ' && length >= 10 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return { ...validatePixels(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff), mime: 'image/webp' };
    }
  }
  fail('utilisez une image PNG, JPEG ou WebP (SVG exclu).');
}

function bytesToDataPng(bytes: Uint8Array, mime = 'image/png') {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return `data:${mime};base64,${btoa(binary)}`;
}

export function materialPngBytes(source: string): Uint8Array {
  const match = DATA_PNG.exec(source);
  if (!match || match[1].length > Math.ceil(MATERIAL_IMPORT_LIMITS.fileBytes / 3) * 4 || match[1].length % 4) fail('texture locale PNG invalide. Réimportez son image.');
  let binary: string;
  try { binary = atob(match[1]); } catch { fail('texture PNG invalide.'); }
  const bytes = Uint8Array.from(binary!, (character) => character.charCodeAt(0));
  if (inspectMaterialImage(bytes).mime !== 'image/png') fail('texture PNG invalide.');
  return bytes;
}

async function imageToPng(bytes: Uint8Array, metadata = inspectMaterialImage(bytes), maxSize?: number): Promise<string> {
  // PNG originals keep all channel values and color metadata byte for byte.
  const blob = new Blob([bytes.slice().buffer], { type: metadata.mime });
  let image: ImageBitmap | HTMLImageElement | undefined;
  try {
    if (typeof createImageBitmap === 'function') image = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    else if (typeof document !== 'undefined') {
      const element = getEnv().document.createElement('img');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { element.onload = element.onerror = null; element.src = ''; reject(new Error('Image indisponible.')); }, 15_000);
        element.onload = () => { clearTimeout(timer); element.onload = element.onerror = null; resolve(); };
        element.onerror = () => { clearTimeout(timer); element.onload = element.onerror = null; reject(new Error('Image illisible.')); };
        element.src = bytesToDataPng(bytes, metadata.mime);
      });
      image = element;
    }
    if (image) {
      const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
      const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
      if (width !== metadata.width || height !== metadata.height) fail('dimensions de texture incohérentes.');
    }
    const ratio = maxSize ? Math.min(1, maxSize / Math.max(metadata.width, metadata.height)) : 1;
    if (metadata.mime === 'image/png' && ratio === 1) return bytesToDataPng(bytes);
    if (!image || typeof document === 'undefined') fail('le navigateur ne peut pas convertir cette image en PNG.');
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(metadata.width * ratio)); canvas.height = Math.max(1, Math.round(metadata.height * ratio));
    const context = canvas.getContext('2d'); if (!context) fail('conversion PNG indisponible.');
    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const source = canvas.toDataURL('image/png'); materialPngBytes(source); return source;
    } finally { canvas.width = canvas.height = 0; }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Matériau non importé :')) throw error;
    return fail('image illisible ou endommagée.');
  } finally {
    if (image && 'close' in image) image.close();
  }
}

async function textureToPng(bytes: Uint8Array, name: string, roles: MaterialTextureRole[], notices: string[], maxSize?: number, targetChannel?: MaterialChannel, remainingPixels = MATERIAL_IMPORT_LIMITS.totalPixels) {
  const exr = /\.exr$/i.test(name);
  const metadata = exr ? inspectMaterialExr(bytes) : inspectMaterialImage(bytes);
  const ratio = maxSize ? Math.min(1, maxSize / Math.max(metadata.width, metadata.height)) : 1;
  const outputPixels = Math.max(1, Math.round(metadata.width * ratio)) * Math.max(1, Math.round(metadata.height * ratio));
  if (outputPixels > remainingPixels) fail('trop d’images en haute résolution. Choisissez une qualité plus basse.');
  let src: string;
  if (exr) {
    const mode = (targetChannel ? targetChannel === 'color' || targetChannel === 'emission' : roles.some(role => role.channel === 'color' || role.channel === 'emission')) ? 'color' : 'data';
    const decoded = await decodeMaterialExr(bytes, mode);
    const full = document.createElement('canvas'); full.width = decoded.width; full.height = decoded.height;
    const result = document.createElement('canvas'); result.width = Math.max(1, Math.round(decoded.width * ratio)); result.height = Math.max(1, Math.round(decoded.height * ratio));
    try {
      const context = full.getContext('2d'); const output = result.getContext('2d');
      if (!context || !output) fail('conversion EXR indisponible.');
      const image = context.createImageData(decoded.width, decoded.height); image.data.set(decoded.data); context.putImageData(image, 0, 0);
      output.drawImage(full, 0, 0, result.width, result.height);
      src = result.toDataURL('image/png'); materialPngBytes(src);
      notices.push(`« ${name} » : EXR converti en PNG 8 bits${mode === 'data' ? ', valeurs de la carte conservées sans correction de couleur' : ', couleur linéaire convertie en sRGB'}.`);
      if (decoded.clamped) notices.push(`« ${name} » : les valeurs hors de 0 à 1 ont été limitées au domaine du skin.`);
    } finally { full.width = full.height = result.width = result.height = 0; }
  } else src = await imageToPng(bytes, metadata, maxSize);
  if (ratio < 1) notices.push(`« ${name} » : ${metadata.width} × ${metadata.height} → ${Math.round(metadata.width * ratio)} × ${Math.round(metadata.height * ratio)} px pour la qualité choisie.`);
  return { src, pixels: outputPixels };
}

interface ZipEntry { name: string; compressed: number; expanded: number; dataStart: number; method: number; crc: number }
/** Central-directory limits are checked before any decompression buffer is allocated. */
export function inspectMaterialZip(bytes: Uint8Array, mode: 'pack' | 'textures' = 'pack'): ZipEntry[] {
  if (bytes.length < 22 || bytes.length > (mode === 'pack' ? MATERIAL_IMPORT_LIMITS.totalBytes : MATERIAL_ARCHIVE_LIMITS.archiveBytes)) fail('archive vide ou trop volumineuse.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('archive ZIP invalide ou multidisque.');
  const count = view.getUint16(end + 10, true); const size = view.getUint32(end + 12, true); const start = view.getUint32(end + 16, true);
  if (!count || count > (mode === 'pack' ? MATERIAL_IMPORT_LIMITS.files + 2 : MATERIAL_ARCHIVE_LIMITS.entries) || count !== view.getUint16(end + 8, true) || start + size !== end) fail('archive trop complexe ou ZIP64 non pris en charge.');
  const entries: ZipEntry[] = []; const names = new Set<string>(); const ranges: [number, number][] = [];
  let offset = start; let expandedTotal = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) fail('annuaire ZIP invalide.');
    const flags = view.getUint16(offset + 8, true); const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true); const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true); const extraLength = view.getUint16(offset + 30, true); const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength; const local = view.getUint32(offset + 42, true);
    if (next > end || flags & 1 || ![0, 8].includes(method) || view.getUint16(offset + 34, true) || expanded === 0xffffffff || compressed === 0xffffffff) fail('archive chiffrée ou format ZIP non pris en charge.');
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { fail('nom de fichier ZIP invalide.'); }
    if (mode === 'pack' ? name !== 'material.json' && name !== 'textures/' && !IMAGE_PATH.test(name!) : !safeArchivePath(name!)) fail('chemin ou fichier inattendu dans le pack.');
    if (names.has(name!.toLowerCase())) fail('fichier dupliqué dans le pack.'); names.add(name!.toLowerCase());
    const max = mode === 'pack' ? name === 'material.json' ? MATERIAL_IMPORT_LIMITS.manifestBytes : name === 'textures/' ? 0 : MATERIAL_IMPORT_LIMITS.fileBytes : MATERIAL_ARCHIVE_LIMITS.expandedBytes;
    if (expanded > max || (expandedTotal += expanded) > (mode === 'pack' ? MATERIAL_IMPORT_LIMITS.totalBytes : MATERIAL_ARCHIVE_LIMITS.expandedBytes)) fail('archive décompressée trop volumineuse.');
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50) fail('entrée ZIP invalide.');
    const localNameLength = view.getUint16(local + 26, true); const localExtraLength = view.getUint16(local + 28, true);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    if (dataStart + compressed > start || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
      localNameLength !== nameLength || !bytes.subarray(local + 30, local + 30 + localNameLength).every((byte, i) => byte === bytes[offset + 46 + i])) fail('entrée ZIP incohérente.');
    if (ranges.some(([begin, finish]) => local < finish && dataStart + compressed > begin)) fail('entrées ZIP superposées.');
    ranges.push([local, dataStart + compressed]); entries.push({ name: name!, compressed, expanded, dataStart, method, crc: view.getUint32(offset + 16, true) }); offset = next;
  }
  if (offset !== end || mode === 'pack' && !names.has('material.json')) fail('manifeste material.json absent.');
  return entries;
}

function safeArchivePath(name: string): boolean {
  if (!name || name.length > 512 || /[\\:]/.test(name) || Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || name.startsWith('/')) return false;
  const segments = name.replace(/\/$/, '').split('/');
  return segments.length <= 12 && segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

/** Do not trust declared sizes: stop streaming as soon as actual output exceeds them. */
async function readZipEntry(bytes: Uint8Array, entry: ZipEntry) {
  const input = bytes.slice(entry.dataStart, entry.dataStart + entry.compressed);
  let output: Uint8Array;
  if (entry.method === 0) output = input;
  else {
    if (typeof DecompressionStream !== 'function') fail('la décompression ZIP est indisponible dans ce navigateur. Importez les images directement.');
    const reader = new Blob([input.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        if ((length += chunk.value.length) > entry.expanded) {
          await reader.cancel(); fail('archive décompressée trop volumineuse ou taille falsifiée.');
        }
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Matériau non importé :')) throw error;
      fail('données ZIP illisibles ou endommagées.');
    } finally { reader.releaseLock(); }
    output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  }
  if (output.length !== entry.expanded || crc32(output) !== entry.crc) fail('taille ou somme de contrôle ZIP incohérente.');
  return output;
}

function safeManifest(value: unknown) {
  let nodes = 0;
  const walk = (node: unknown, depth: number) => {
    if (++nodes > 200 || depth > 5) fail('manifeste trop complexe.');
    if (Array.isArray(node)) fail('structure de manifeste invalide.');
    if (!record(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (forbidden.has(key)) fail('propriété interdite dans le manifeste.');
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
}

async function importMaterialPack(file: File, preparedBytes?: Uint8Array): Promise<MaterialDefinition> {
  const bytes = preparedBytes ?? new Uint8Array(await file.arrayBuffer()); const entries = inspectMaterialZip(bytes);
  const manifestEntry = entries.find((entry) => entry.name === 'material.json')!;
  const manifestBytes = await readZipEntry(bytes, manifestEntry);
  let manifest: unknown;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)); } catch { fail('manifeste JSON invalide.'); }
  safeManifest(manifest);
  if (!record(manifest) || Object.keys(manifest).some((key) => !['format', 'version', 'material'].includes(key)) || manifest.format !== PACK_FORMAT || manifest.version !== 1 ||
    !isValidMaterialDefinition(manifest.material, (source) => IMAGE_PATH.test(source) && entries.some((entry) => entry.name === source))) fail('format, version ou réglages du pack invalides.');
  const definition = structuredClone(manifest.material as MaterialDefinition);
  const sources = new Map<string, string>(); let pixels = 0;
  for (const texture of Object.values(definition.textures)) {
    if (!texture) continue;
    if (!sources.has(texture.src)) {
      const entry = entries.find((entry) => entry.name === texture.src)!;
      const imageBytes = await readZipEntry(bytes, entry);
      const metadata = inspectMaterialImage(imageBytes);
      if ((pixels += metadata.pixels) > MATERIAL_IMPORT_LIMITS.totalPixels) fail('trop d’images en haute résolution dans le pack.');
      sources.set(texture.src, await imageToPng(imageBytes, metadata));
    }
    texture.src = sources.get(texture.src)!;
  }
  if (entries.some((entry) => entry.name !== 'material.json' && entry.name !== 'textures/' && !sources.has(entry.name))) fail('image non utilisée dans le pack.');
  if (!isValidMaterialDefinition(definition)) fail('matériau invalide après conversion.');
  return definition;
}

const ARCHIVE_IMAGE = /\.(?:png|jpe?g|webp|exr)$/i;
const PBR_SUFFIX = /(?:^|_)(?:occlusion_roughness_metallic|occlusion_roughness_metalness|roughness_metallic|roughness_metalness|ambient_occlusion|ambientocclusion|base_color|base_colour|basecolor|basecolour|normal(?:s)?(?:_?(?:gl|dx|opengl|directx))?|nrm|nor(?:_?(?:gl|dx))?|disp|displace|displacement|height|bump|albedo|diffuse|diff|color|colour|col|bc|roughness|rough|rgh|metallic|metalness|metal|met|glossiness|gloss|smoothness|occlusion|ao|orm|arm|rma|roughmetal|roughnessmetallic|roughnessmetalness|coat|clearcoat|varnish|coatr|emission|emissive|emit|illumination|illum|dirtmask|dirt|grime|wear|n)$/i;
const UNSUPPORTED_SUFFIX = /(?:^|_)(spec(?:ular)?|alpha|opacity|mask)(?:_map)?$/i;
function archiveTextureName(name: string) {
  const base = name.split('/').at(-1)!;
  const stem = base.replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s.-]+/g, '_')
    .replace(/(^|_)(direct_x|open_gl|rough_metal|clear_coat|coat_r|dirt_mask)(?=_|$)/gi, (_match, prefix: string, words: string) => prefix + words.replace('_', ''))
    .replace(/_(?:\d+k|\d{3,5}(?:x\d{3,5})?|map|texture)$/i, '').replace(/_(?:\d+k|\d{3,5}(?:x\d{3,5})?|map|texture)$/i, '');
  const unsupported = UNSUPPORTED_SUFFIX.exec(stem);
  const known = PBR_SUFFIX.test(stem) || /^(?:skin|details|wheels)_[bri]$/i.test(stem);
  const native = /^(skin|details|wheels)_[bri]$/i.exec(stem);
  return { base, stem, unsupported: unsupported?.[1], known,
    group: native?.[1].toLowerCase() ?? (stem.replace(PBR_SUFFIX, '').replace(/[_-]+$/, '').toLowerCase() || 'materiau') };
}

async function importTextureArchive(file: File, bytes: Uint8Array, entries: ZipEntry[], maxSize: number): Promise<MaterialImportResult> {
  const notices: string[] = [];
  const candidates: { entry: ZipEntry; roles: MaterialTextureRole[]; group: string; base: string }[] = [];
  const unknown: ZipEntry[] = [];
  let ignoredOther = 0;
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    if (entry.name.split('/').some(segment => segment.startsWith('.') || segment === '__MACOSX')) { ignoredOther++; continue; }
    if (/\.blend\d*$/i.test(entry.name)) { notices.push(`« ${entry.name} » ignoré : les réglages et nœuds Blender ne sont pas importés.`); continue; }
    if (!ARCHIVE_IMAGE.test(entry.name)) { ignoredOther++; continue; }
    const info = archiveTextureName(entry.name);
    if (info.unsupported) {
      notices.push(`« ${entry.name} » ignoré : ce canal ne correspond pas à une finition prise en charge.`);
      continue;
    }
    if (/(?:^|_)(preview|render|thumbnail|thumb|sphere)(?:_|$)/i.test(info.stem)) { ignoredOther++; continue; }
    if (!info.known) { unknown.push(entry); continue; }
    candidates.push({ entry, roles: detectMaterialTextureRoles(info.base), group: info.group, base: info.base });
  }
  if (!candidates.length && unknown.length === 1) {
    const entry = unknown.pop()!; const info = archiveTextureName(entry.name);
    candidates.push({ entry, roles: detectMaterialTextureRoles(info.base), group: info.group, base: info.base });
  }
  if (!candidates.length) fail('aucune texture couleur ou PBR reconnue dans ce ZIP. Importez ses images PNG, JPEG, WebP ou EXR directement.');
  if (candidates.length > MATERIAL_IMPORT_LIMITS.files) fail('ce ZIP contient trop de variantes. Importez un seul matériau et une image par canal.');
  if (new Set(candidates.map(candidate => candidate.group)).size > 1) fail('ce ZIP contient plusieurs matériaux. Importez les images d’un seul matériau à la fois pour conserver des canaux cohérents.');
  const assigned = new Set<MaterialChannel>();
  let sourceBytes = 0;
  for (const candidate of candidates) {
    if (candidate.roles.some(role => assigned.has(role.channel))) fail(`plusieurs images correspondent au même canal dans « ${candidate.base} ». Choisissez une seule résolution et un seul format par canal puis importez ces images directement.`);
    for (const role of candidate.roles) assigned.add(role.channel);
    if (!candidate.entry.expanded || candidate.entry.expanded > MATERIAL_IMPORT_LIMITS.fileBytes || candidate.entry.compressed > MATERIAL_IMPORT_LIMITS.fileBytes || (sourceBytes += candidate.entry.expanded) > MATERIAL_IMPORT_LIMITS.totalBytes) fail('textures du ZIP trop volumineuses (64 Mo par image, 128 Mo au total).');
  }
  const definition = createMaterialDefinition('solid');
  definition.name = candidates[0].group === 'materiau' ? file.name.replace(/(?:\.blend)?\.zip$/i, '').slice(0, 120) : candidates[0].group.slice(0, 120);
  definition.textures = {}; definition.coat = 0;
  let pixels = 0;
  for (const candidate of candidates) {
    const imageBytes = await readZipEntry(bytes, candidate.entry);
    const converted = await textureToPng(imageBytes, candidate.base, candidate.roles, notices, maxSize, undefined, MATERIAL_IMPORT_LIMITS.totalPixels - pixels);
    if ((pixels += converted.pixels) > MATERIAL_IMPORT_LIMITS.totalPixels) fail('trop d’images en haute résolution dans le ZIP. Choisissez une qualité plus basse.');
    for (const role of candidate.roles) definition.textures[role.channel] = { src: converted.src, name: candidate.base.slice(0, 120), component: role.component, invert: role.invert };
  }
  if (definition.textures.height) notices.push('Carte de hauteur conservée. Ouvrez Textures et relief pour l’appliquer au modèle 3D.');
  if (unknown.length) notices.push(`${unknown.length} image${unknown.length > 1 ? 's' : ''} ignorée${unknown.length > 1 ? 's' : ''} : affectation non reconnue. Vous pouvez les importer séparément et choisir leur canal.`);
  if (ignoredOther) notices.push(`${ignoredOther} fichier${ignoredOther > 1 ? 's' : ''} annexe${ignoredOther > 1 ? 's' : ''} ignoré${ignoredOther > 1 ? 's' : ''}.`);
  return { definition: finishImportedDefinition(definition), notices };
}

function finishImportedDefinition(definition: MaterialDefinition): MaterialDefinition {
  // A texture set displays its original colors; tint remains an explicit user choice.
  if (definition.textures.color) definition.color = '#ffffff';
  if (definition.textures.roughness || definition.textures.roughmetal) definition.roughness = 255;
  if (definition.textures.metalness || definition.textures.roughmetal) definition.metalness = 255;
  if (definition.textures.coat) definition.coat = 255;
  if (definition.textures.dirt) definition.dirt = 255;
  if (definition.textures.emission) definition.emissionStrength = 1;
  if (!isValidMaterialDefinition(definition)) fail('réglages du matériau invalides.');
  return definition;
}

export async function importMaterialFilesDetailed(files: File[], options: MaterialImportOptions = {}): Promise<MaterialImportResult> {
  const maxSize = options.maxTextureSize ?? 2048;
  if (![1024, 2048, 4096].includes(maxSize)) fail('qualité d’import invalide.');
  if (options.targetChannel && !MATERIAL_CHANNELS.includes(options.targetChannel)) fail('canal d’import invalide.');
  if (!files.length || files.length > MATERIAL_IMPORT_LIMITS.files) fail('sélectionnez de 1 à 10 images ou un pack ZIP.');
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    const file = files[0];
    if (!file.size || file.size > MATERIAL_ARCHIVE_LIMITS.archiveBytes) fail('archive vide ou trop volumineuse (256 Mo maximum).');
    const bytes = new Uint8Array(await file.arrayBuffer()); const entries = inspectMaterialZip(bytes, 'textures');
    if (entries.some(entry => entry.name === 'material.json')) return { definition: await importMaterialPack(file, bytes), notices: [] };
    return importTextureArchive(file, bytes, entries, maxSize);
  }
  if (files.some(file => !file.size || file.size > MATERIAL_IMPORT_LIMITS.fileBytes) || files.reduce((sum, file) => sum + file.size, 0) > MATERIAL_IMPORT_LIMITS.totalBytes) fail('sélection trop volumineuse (64 Mo par image, 128 Mo au total).');
  if (files.some(file => !ARCHIVE_IMAGE.test(file.name))) fail('utilisez des images PNG, JPEG ou WebP, des textures EXR, ou un seul pack ZIP.');
  const definition = createMaterialDefinition('solid');
  definition.name = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-](?:albedo|basecolor|color|roughness|metallic|normal|orm|rma)$/i, '').slice(0, 120) || 'Matériau importé';
  definition.textures = {};
  const notices: string[] = [];
  let pixels = 0;
  for (const file of files) {
    if (archiveTextureName(file.name).unsupported && (!options.targetChannel || options.targetChannel === 'normal')) fail(`« ${file.name.slice(0, 80)} » correspond à un canal non pris en charge. Choisissez son affectation avant de l’importer.`);
    const roles = detectMaterialTextureRoles(file.name);
    if (roles.some(({ channel }) => definition.textures[channel])) fail(`plusieurs images correspondent au même canal dans « ${file.name.slice(0, 80)} ». Importez-les séparément puis choisissez leur rôle.`);
    const converted = await textureToPng(new Uint8Array(await file.arrayBuffer()), file.name, roles, notices, /\.exr$/i.test(file.name) ? maxSize : undefined, options.targetChannel, MATERIAL_IMPORT_LIMITS.totalPixels - pixels);
    if ((pixels += converted.pixels) > MATERIAL_IMPORT_LIMITS.totalPixels) fail('trop d’images en haute résolution dans cette sélection.');
    for (const role of roles) definition.textures[role.channel] = { src: converted.src, name: file.name.slice(0, 120), component: role.component, invert: role.invert };
  }
  if (definition.textures.height) notices.push('Carte de hauteur conservée. Ouvrez Textures et relief pour l’appliquer au modèle 3D.');
  return { definition: finishImportedDefinition(definition), notices };
}

export async function importMaterialFiles(files: File[], options?: MaterialImportOptions): Promise<MaterialDefinition> {
  return (await importMaterialFilesDetailed(files, options)).definition;
}

interface MaterialSourceReader {
  loadMaterialSources(definition: MaterialDefinition): Promise<void>;
  getMaterialSourceCanvas(source: string): Pick<HTMLCanvasElement, 'width' | 'height' | 'toDataURL'> | undefined;
}

/** Project hydration uses temporary URLs; personal materials and packs embed durable PNGs. */
export async function portableMaterialDefinition(definition: MaterialDefinition, sourceReader?: MaterialSourceReader): Promise<MaterialDefinition> {
  if (!isValidMaterialDefinition(definition)) throw new Error('Matériau invalide : réimportez ses textures locales avant de l’enregistrer ou de l’exporter.');
  const snapshot = structuredClone(definition);
  const temporary = new Set(Object.values(snapshot.textures).filter((texture) => texture!.src.startsWith('blob:')).map((texture) => texture!.src));
  if (!temporary.size) return snapshot;
  const reader = sourceReader ?? { loadMaterialSources, getMaterialSourceCanvas };
  await reader.loadMaterialSources(snapshot);
  const sources = new Map<string, string>();
  for (const source of temporary) {
    const image = reader.getMaterialSourceCanvas(source);
    if (!image) throw new Error('La texture locale est indisponible. Rechargez le projet puis réessayez.');
    validatePixels(image.width, image.height);
    const data = image.toDataURL('image/png');
    const metadata = inspectMaterialImage(materialPngBytes(data));
    if (metadata.width !== image.width || metadata.height !== image.height) throw new Error('Les dimensions de la texture locale ont changé.');
    sources.set(source, data);
  }
  for (const texture of Object.values(snapshot.textures)) if (texture && sources.has(texture.src)) texture.src = sources.get(texture.src)!;
  if (!isValidMaterialDefinition(snapshot)) throw new Error('La texture locale ne peut pas être conservée.');
  return snapshot;
}

export async function exportMaterialPack(definition: MaterialDefinition): Promise<Blob> {
  let material: MaterialDefinition;
  try { material = await portableMaterialDefinition(definition); }
  catch (error) { throw new Error(`Matériau non exporté : ${error instanceof Error ? error.message : 'texture locale invalide.'}`); }
  if (!isValidMaterialDefinition(material, (source) => DATA_PNG.test(source))) throw new Error('Matériau non exporté : réimportez les textures locales avant de créer le pack.');
  const zip = new JSZip(); const paths = new Map<string, string>();
  let total = 0; let pixels = 0;
  for (const texture of Object.values(material.textures)) {
    if (!texture) continue;
    if (!paths.has(texture.src)) {
      const bytes = materialPngBytes(texture.src);
      if ((total += bytes.length) > MATERIAL_IMPORT_LIMITS.totalBytes || (pixels += inspectMaterialImage(bytes).pixels) > MATERIAL_IMPORT_LIMITS.totalPixels) throw new Error('Matériau non exporté : pack trop volumineux.');
      const path = `textures/texture-${paths.size}.png`; paths.set(texture.src, path); zip.file(path, bytes);
    }
    texture.src = paths.get(texture.src)!;
  }
  zip.file('material.json', JSON.stringify({ format: PACK_FORMAT, version: 1, material }));
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return new Blob([bytes], { type: 'application/zip' });
}
