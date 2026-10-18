import type { RGBAImage } from '../dds';
import { isLocalMaterialSource, type MaterialLayer, type MaterialTexture } from '../materials/types';
import { createMaterialProjector } from '../materials/projection';
import { canonicalDetailsMaterial, detailsSideOffset } from '../detailsSides';
import { panelFrame, panelReferenceMaterial, insidePanel } from '../underbodyPanel';
import type { ProjectionTriangle } from '../three/decalProjection';
import { atlasCoordinateMap, organizedAtlasGeometry } from '../realUvAtlas';

export interface HeightSource { width: number; height: number; bits: 8 | 16; values: Float32Array }
const fail = () => { throw new Error('La carte de hauteur PNG est invalide ou dépasse les limites (4K, 64 Mo).'); };
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
}

/** Read numeric PNG samples, deliberately ignoring colour gamma for height.
 * Inflation is streamed and capped at the exact scanline size, before allocation.
 * Palette/interlaced PNGs use the existing bounded canvas renderer instead.
 */
export async function decodeHeightPNG(bytes: Uint8Array, component: MaterialTexture['component'] = 'luminance'): Promise<HeightSource | null> {
  if (bytes.length < 45 || bytes.length > 64 * 1024 * 1024 || !signature.every((v, i) => bytes[i] === v)) return fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return fail();
  const width = view.getUint32(16), height = view.getUint32(20), bits = bytes[24], color = bytes[25];
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16 * 1024 * 1024 || bytes[26] || bytes[27] || bytes[28] > 1) return fail();
  if (![8, 16].includes(bits) || ![0, 2, 4, 6].includes(color) || bytes[28]) return null;
  const channels = color === 0 ? 1 : color === 2 ? 3 : color === 4 ? 2 : 4, pixelBytes = channels * bits / 8;
  const rowBytes = width * pixelBytes, expected = height * (rowBytes + 1), parts: Uint8Array[] = [];
  let at = 8, ended = false, dataEnded = false;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) return fail();
    const length = view.getUint32(at), end = at + 12 + length;
    if (end > bytes.length || length > 64 * 1024 * 1024) return fail();
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (crc(bytes.subarray(at + 4, at + 8 + length)) !== view.getUint32(at + 8 + length)) return fail();
    if (type === 'IHDR' && at !== 8 || type === 'acTL') return fail();
    if (type === 'IDAT') { if (dataEnded) return fail(); parts.push(bytes.slice(at + 8, at + 8 + length)); }
    else if (parts.length) dataEnded = true;
    if (type === 'IEND') { if (length || end !== bytes.length) return fail(); ended = true; break; }
    at = end;
  }
  if (!ended || !parts.length) return fail();
  const reader = new Blob(parts.map(p => new Uint8Array(p).buffer)).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const scanlines = new Uint8Array(expected); let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      if (received + value.length > expected) return fail();
      scanlines.set(value, received); received += value.length;
    }
  } catch { return fail(); }
  finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
  if (received !== expected) return fail();
  const values = new Float32Array(width * height), rows = [new Uint8Array(rowBytes), new Uint8Array(rowBytes)];
  const denominator = bits === 16 ? 65535 : 255;
  for (let y = 0; y < height; y++) {
    const row = rows[y % 2], before = rows[(y + 1) % 2], filter = scanlines[y * (rowBytes + 1)];
    if (filter > 4) return fail();
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= pixelBytes ? row[x - pixelBytes] : 0, b = y ? before[x] : 0, c = y && x >= pixelBytes ? before[x - pixelBytes] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      row[x] = (scanlines[y * (rowBytes + 1) + 1 + x] + prediction) & 255;
    }
    const channel = (x: number, c: number) => { const i = x * pixelBytes + c * bits / 8; return (bits === 16 ? row[i] * 256 + row[i + 1] : row[i]) / denominator; };
    for (let x = 0; x < width; x++) values[y * width + x] = color === 0 || color === 4 ? channel(x, 0)
      : component === 'luminance' ? .2126 * channel(x, 0) + .7152 * channel(x, 1) + .0722 * channel(x, 2)
      : channel(x, ['r', 'g', 'b'].indexOf(component));
  }
  return { width, height, bits: bits as 8 | 16, values };
}

/** Local asset URLs only: no remote image fetching or script execution. */
export async function loadHeightSource(texture: MaterialTexture): Promise<HeightSource | null> {
  if (!isLocalMaterialSource(texture.src)) return fail();
  const response = await fetch(texture.src, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return fail();
  const reader = response.body?.getReader(); if (!reader) return fail();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 64 * 1024 * 1024) return fail(); parts.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  return decodeHeightPNG(bytes, texture.component);
}

export async function localPNGAspect(src: string): Promise<number> {
  if (!isLocalMaterialSource(src)) return fail();
  const response = await fetch(src, { signal: AbortSignal.timeout(20_000) });
  const reader = response.body?.getReader(); if (!response.ok || !reader) return fail();
  const header = new Uint8Array(24); let at = 0;
  try {
    while (at < header.length) {
      const {done,value} = await reader.read(); if (done) return fail();
      const count = Math.min(value.length, header.length-at); header.set(value.subarray(0,count),at); at += count;
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const view = new DataView(header.buffer), width = view.getUint32(16), height = view.getUint32(20);
  if (!signature.every((v,i)=>header[i]===v) || !width || !height || width>8192 || height>8192) return fail();
  return height/width;
}

/** Inverse of the material renderer's repeat placement. Preserve source samples
 * independently of export quality; the rendered alpha retains region masks.
 */
function heightMaskAlpha(mask: RGBAImage) {
  return (u: number, v: number) => {
    const x = Math.max(0, Math.min(1, u)) * (mask.width - 1), y = (1 - Math.max(0, Math.min(1, v))) * (mask.height - 1);
    const a = Math.floor(x), b = Math.floor(y), tx = x - a, ty = y - b;
    const pixel = (px: number, py: number) => mask.data[(Math.min(py, mask.height - 1) * mask.width + Math.min(px, mask.width - 1)) * 4 + 3] / 255;
    return pixel(a,b)*(1-tx)*(1-ty)+pixel(a+1,b)*tx*(1-ty)+pixel(a,b+1)*(1-tx)*ty+pixel(a+1,b+1)*tx*ty;
  };
}

export function createProjectedHeightSampler(source: HeightSource, layer: MaterialLayer, mask: RGBAImage, geometry: readonly ProjectionTriangle[], aspect = source.height/source.width): (u:number,v:number)=>number {
  if(layer.organizedAtlas){const {organizedAtlas,...authored}=layer,map=atlasCoordinateMap(layer.family,organizedAtlas),sample=createProjectedHeightSampler(source,authored,{width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])},organizedAtlasGeometry(geometry,organizedAtlas),aspect),alpha=heightMaskAlpha(mask);return(u,v)=>sample(...map(u,v))*alpha(u,v);}
  const projector=createMaterialProjector(layer,geometry,2048,{width:1,height:aspect});
  if(!projector) return createHeightSampler(source,layer,mask,aspect);
  const sample=projector.scalarSampler(source),alpha=heightMaskAlpha(mask),invert=layer.definition.textures.height!.invert;
  return (u,v)=>{const value=sample(u,v);return (2*(invert?1-value:value)-1)*alpha(u,v);};
}

export function createHeightSampler(source: HeightSource, layer: MaterialLayer, mask: RGBAImage, aspect = source.height / source.width): (u: number, v: number) => number {
  if(layer.organizedAtlas){const {organizedAtlas,...authored}=layer,map=atlasCoordinateMap(layer.family,organizedAtlas),sample=createHeightSampler(source,authored,{width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])},aspect),alpha=heightMaskAlpha(mask);return(u,v)=>sample(...map(u,v))*alpha(u,v);}
  const canonical=layer.atlasFrame?panelReferenceMaterial(layer):layer.atlasSide?canonicalDetailsMaterial(layer):layer;
  const transform = canonical.definition.transform, texture = canonical.definition.textures.height!;
  const points = canonical.regions.flatMap(region => region.polygons.flat());
  const centerX = points.length ? (Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))*1024 : 1024;
  const centerY = points.length ? (Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))*1024 : 1024;
  const angle = -transform.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const wrap = (x: number, n: number) => ((x % n) + n) % n;
  const alpha=heightMaskAlpha(mask);
  return (u, v) => {
    const coverage=alpha(u,v);
    if(layer.atlasFrame){const frame=panelFrame(layer.atlasFrame.placement);u=(u-frame.x)/frame.scale;v=1-((1-v-frame.y)/frame.scale);if(u<0||u>1||v<0||v>1||(layer.atlasFrame.placement==='right'&&!insidePanel(u,1-v)))return 0;}
    if(layer.atlasSide){const offset=detailsSideOffset(layer.atlasSide);if(u<offset||u>offset+.5)return 0;u=(u-offset)*2;}
    // The validated 2K reference is stable across export qualities. Only the
    // alpha mask is rasterized at output quality; numeric height never is.
    const x = Math.max(0, Math.min(1,u)) * 2047 - centerX - transform.offsetX;
    const y = (1 - Math.max(0, Math.min(1,v))) * 2047 - centerY - transform.offsetY;
    const px = (x*cos-y*sin) * (transform.flipX ? -1 : 1), py = (x*sin+y*cos) * (transform.flipY ? -1 : 1);
    const sx = wrap(px * source.width / transform.size - .5, source.width), sy = wrap(py * source.height / (transform.size * aspect) - .5, source.height);
    const a = Math.floor(sx), b = Math.floor(sy), tx = sx-a, ty = sy-b;
    const value = (px: number, py: number) => source.values[wrap(py,source.height)*source.width+wrap(px,source.width)];
    let h = value(a,b)*(1-tx)*(1-ty)+value(a+1,b)*tx*(1-ty)+value(a,b+1)*(1-tx)*ty+value(a+1,b+1)*tx*ty;
    if (texture.invert) h = 1-h;
    return (2*h-1)*coverage;
  };
}
