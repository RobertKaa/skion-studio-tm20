import { getEnv } from 'fabric';
import type { ProjectionTriangle } from '../three/decalProjection';
import { createMaterialProjector } from './projection';
import { drawRealAtlas, drawSourceAtlas, realAtlasLayout, sourceAtlasGeometry, organizedAtlasGeometry } from '../realUvAtlas';
import { canonicalDetailsMaterial, detailsSideOffset } from '../detailsSides';
import { panelFrame, panelReferenceMaterial, panelCanvasRegion, panelGuide } from '../underbodyPanel';
import {
  isLocalMaterialSource, isValidMaterialDefinition, isValidMaterialLayer,
  type MaterialDefinition, type MaterialLayer, type MaterialRegion, type MaterialRenderChannel, type MaterialTexture,
} from './types';

const REFERENCE_SIZE = 2048;
const MAX_SOURCE_PIXELS = 64 * 1024 * 1024;
const MAX_CONVERTED_PIXELS = 24 * 1024 * 1024;
interface MaterialRenderCache {
  sources: Map<string, HTMLCanvasElement>;
  loading: Map<string, Promise<HTMLCanvasElement>>;
  converted: Map<HTMLCanvasElement, Map<string, HTMLCanvasElement>>;
  owned: Set<HTMLCanvasElement>;
  sourcePixels: number;
  convertedPixels: number;
  pinned: Set<string>;
  disposed: boolean;
}
const newCache = (): MaterialRenderCache => ({ sources: new Map(), loading: new Map(), converted: new Map(), owned: new Set(), sourcePixels: 0, convertedPixels: 0, pinned: new Set(), disposed: false });
const defaultCache = newCache();
// Rendering is synchronous. Async source decoding always receives its cache explicitly.
let renderCache = defaultCache;
function assertOpen(cache: MaterialRenderCache) {
  if (cache.disposed) throw new Error('Cette session de matériau est fermée.');
}

function sourcePixelCount(src: string, cache: MaterialRenderCache): number {
  const cached = cache.sources.get(src);
  if (cached) return cached.width * cached.height;
  if (!src.startsWith('data:image/png;base64,')) return 0;
  const bytes = Uint8Array.from(atob(src.slice(22, 66)), value => value.charCodeAt(0));
  const header = new DataView(bytes.buffer);
  return header.getUint32(16) * header.getUint32(20);
}

function checkSourceBudget(sources: Iterable<string>, cache: MaterialRenderCache) {
  let pixels = 0;
  for (const src of new Set(sources)) {
    pixels += sourcePixelCount(src, cache);
    if (pixels > MAX_SOURCE_PIXELS) throw new Error('Les matériaux utilisent trop de textures : réduisez leur résolution (64 millions de pixels maximum).');
  }
}

/** Keep active project textures alive while library thumbnails use the bounded cache. */
export function pinMaterialSources(sources: readonly string[]): void {
  if (sources.some(src => !isLocalMaterialSource(src))) throw new Error('Une texture du projet est invalide.');
  checkSourceBudget(sources, defaultCache);
  defaultCache.pinned = new Set(sources);
}

function dropSource(src: string, image: HTMLCanvasElement, cache: MaterialRenderCache) {
  cache.sources.delete(src); cache.sourcePixels -= image.width * image.height;
  const derived = cache.converted.get(image);
  if (derived) {
    for (const entry of derived.values()) cache.convertedPixels -= entry.width * entry.height;
    cache.converted.delete(image);
  }
  cache.owned.delete(image);
  // Do not zero originals: a caller may be serializing one of them.
}

function canvas(width: number, height = width): HTMLCanvasElement {
  const result = getEnv().document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}
function context(source: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = source.getContext('2d');
  if (!result) throw new Error('Le navigateur ne permet pas de préparer ce matériau.');
  return result;
}
function release(source: HTMLCanvasElement) { source.width = source.height = 0; }
const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const rgb = (hex: string): number[] => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));

async function loadSource(src: string, cache: MaterialRenderCache): Promise<HTMLCanvasElement> {
  assertOpen(cache);
  const cached = cache.sources.get(src);
  if (cached) { cache.sources.delete(src); cache.sources.set(src, cached); return cached; }
  const pending = cache.loading.get(src);
  if (pending) return pending;
  if (!isLocalMaterialSource(src)) throw new Error('Une texture doit être une image PNG locale.');
  // Project originals are immutable: an isolated preview can borrow them safely.
  const borrowed = cache !== defaultCache ? defaultCache.sources.get(src) : undefined;
  if (borrowed) { cache.sources.set(src, borrowed); cache.sourcePixels += borrowed.width * borrowed.height; return borrowed; }
  const promise = new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = getEnv().document.createElement('img');
    const timer = setTimeout(() => { image.onload = image.onerror = null; image.src = ''; reject(new Error('La texture ne répond pas.')); }, 15_000);
    image.onerror = () => { clearTimeout(timer); image.onload = image.onerror = null; image.src = ''; reject(new Error('Cette image PNG est illisible.')); };
    image.onload = () => {
      clearTimeout(timer);
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) {
        image.onload = image.onerror = null; image.src = '';
        reject(new Error('La texture dépasse la taille prise en charge (16 millions de pixels).')); return;
      }
      try {
        assertOpen(cache);
        const source = canvas(width, height); context(source).drawImage(image, 0, 0);
        image.onload = image.onerror = null; image.src = '';
        cache.sources.set(src, source); cache.owned.add(source); cache.sourcePixels += width * height;
        resolve(source);
      } catch (error) { image.onload = image.onerror = null; image.src = ''; reject(error); }
    };
    image.src = src;
  });
  cache.loading.set(src, promise);
  try { return await promise; } finally { cache.loading.delete(src); }
}

async function loadIntoCache(definition: MaterialDefinition, cache: MaterialRenderCache): Promise<void> {
  assertOpen(cache);
  if (!isValidMaterialDefinition(definition)) throw new Error('Le matériau contient des réglages invalides.');
  const sources = [...new Set(Object.values(definition.textures).map(texture => texture!.src))];
  checkSourceBudget([...cache.pinned, ...sources], cache);
  const alreadyCached = new Set(cache.sources.keys());
  let pixels = 0, succeeded = false;
  try {
    for (const src of sources) {
      const image = await loadSource(src, cache); assertOpen(cache); pixels += image.width * image.height;
      if (pixels > MAX_SOURCE_PIXELS) throw new Error('Ce matériau contient trop de textures : réduisez leur résolution.');
      checkSourceBudget([...cache.pinned, ...sources], cache);
    }
    succeeded = true;
  } finally {
    if (!succeeded) for (const src of sources) {
      const image = cache.sources.get(src);
      if (image && !alreadyCached.has(src)) dropSource(src, image, cache);
    }
    const protectedSources = new Set([...cache.pinned, ...(succeeded ? sources : [])]);
    for (const [src, image] of cache.sources) {
      if (cache.sourcePixels <= MAX_SOURCE_PIXELS) break;
      if (protectedSources.has(src)) continue;
      dropSource(src, image, cache);
    }
  }
}

/** Only local PNGs are decoded. Project asset references must be hydrated first. */
export async function loadMaterialSources(definition: MaterialDefinition): Promise<void> { await loadIntoCache(definition, defaultCache); }

/** Bounded preview cache independent of the current project's pinned textures. */
export function createMaterialRenderSession() {
  const cache = newCache();
  let loadQueue: Promise<void> = Promise.resolve();
  return {
    load(definition: MaterialDefinition): Promise<void> {
      const pending = loadQueue.then(async () => {
        assertOpen(cache);
        if (!isValidMaterialDefinition(definition)) throw new Error('Le matériau contient des réglages invalides.');
        const sources = new Set(Object.values(definition.textures).map(texture => texture!.src));
        checkSourceBudget(sources, cache);
        // One source material per session; do not retain previous packs during a 4K import.
        for (const [src, image] of cache.sources) if (!sources.has(src)) {
          const owned = cache.owned.has(image), derived = cache.converted.get(image);
          dropSource(src, image, cache);
          if (owned) release(image);
          if (derived) for (const entry of derived.values()) release(entry);
        }
        await loadIntoCache(definition, cache);
      });
      // Superseded preview builds can still finish decoding. Keep packs sequential
      // so an older decode cannot evict a newer pack or exceed the cache budget.
      loadQueue = pending.catch(() => {});
      return pending;
    },
    render(layer: MaterialLayer, size: number, geometry?: readonly ProjectionTriangle[]) {
      assertOpen(cache);
      const previous = renderCache;
      renderCache = cache;
      try { return renderMaterialLayer(layer, size, geometry); } finally { renderCache = previous; }
    },
    dispose() {
      if (cache.disposed) return;
      cache.disposed = true;
      for (const source of cache.owned) release(source);
      for (const entries of cache.converted.values()) for (const entry of entries.values()) release(entry);
      cache.sources.clear(); cache.owned.clear(); cache.converted.clear(); cache.pinned.clear();
      cache.sourcePixels = cache.convertedPixels = 0;
    },
  };
}

/** Native dimensions are preserved for editable project serialization. Do not mutate this canvas. */
export function getMaterialSourceCanvas(src: string): HTMLCanvasElement | undefined { return defaultCache.sources.get(src); }

function sourceFor(texture: MaterialTexture): HTMLCanvasElement {
  const source = renderCache.sources.get(texture.src);
  if (!source) throw new Error('Chargez les textures avant de dessiner le matériau.');
  return source;
}

function converted(source: HTMLCanvasElement, key: string, convert: (data: Uint8ClampedArray, offset: number) => void, maxSize = 4096): HTMLCanvasElement {
  const cache = renderCache;
  const ratio = Math.min(1, maxSize / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * ratio)), height = Math.max(1, Math.round(source.height * ratio));
  key = `${width}x${height}:${key}`;
  const cached = cache.converted.get(source)?.get(key);
  if (cached) return cached;
  const result = canvas(width, height), ctx = context(result);
  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, result.width, result.height);
  for (let i = 0; i < image.data.length; i += 4) convert(image.data, i);
  ctx.putImageData(image, 0, 0);
  // Large originals are processed without retaining a second native-size copy.
  if (result.width * result.height <= MAX_CONVERTED_PIXELS) {
    while (cache.convertedPixels + result.width * result.height > MAX_CONVERTED_PIXELS && cache.converted.size) {
      const [oldSource, oldEntries] = cache.converted.entries().next().value!;
      for (const old of oldEntries.values()) cache.convertedPixels -= old.width * old.height;
      cache.converted.delete(oldSource);
    }
    const entries = cache.converted.get(source) ?? new Map<string, HTMLCanvasElement>();
    entries.set(key, result); cache.converted.set(source, entries); cache.convertedPixels += result.width * result.height;
  }
  return result;
}

function scalar(texture: MaterialTexture, target: 'red' | 'green' | 'gray', amount = 1, maxSize = 4096, grayMode: 'ao' | 'multiply' = 'ao'): HTMLCanvasElement {
  return converted(sourceFor(texture), `scalar:${texture.component}:${texture.invert}:${target}:${amount}:${grayMode}`, (data, i) => {
    const index = texture.component === 'r' ? 0 : texture.component === 'g' ? 1 : 2;
    let value = texture.component === 'luminance'
      ? data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722 : data[i + index];
    if (texture.invert) value = 255 - value;
    value = target === 'gray' && grayMode === 'ao' ? 255 * (1 - amount) + value * amount : value * amount;
    data[i] = target === 'green' ? 0 : clamp(value);
    data[i + 1] = target === 'red' ? 0 : clamp(value);
    data[i + 2] = target === 'gray' ? clamp(value) : 0;
    data[i + 3] = 255;
  }, maxSize);
}

function colorImage(texture: MaterialTexture, tint: string, strength = 1, maxSize = 4096): HTMLCanvasElement {
  const channels = rgb(tint);
  return converted(sourceFor(texture), `color:${tint}:${strength}`, (data, i) => {
    for (let c = 0; c < 3; c++) data[i + c] = clamp(data[i + c] * channels[c] / 255 * strength);
    data[i + 3] = 255;
  }, maxSize);
}

function orientNormal(data: Uint8ClampedArray, i: number, definition: MaterialDefinition, invertY = false): void {
  const { normalStrength: strength, transform } = definition;
  let x = (data[i] / 127.5 - 1) * strength;
  let y = (data[i + 1] / 127.5 - 1) * strength;
  if (invertY) y = -y;
  const z = strength === 0 ? 1 : Math.max(.000001, data[i + 2] / 127.5 - 1);
  if (transform.flipX) x = -x;
  if (transform.flipY) y = -y;
  // Canvas Y points downward; tangent OpenGL +Y points upward.
  const angle = -transform.angle * Math.PI / 180;
  const nextX = x * Math.cos(angle) - y * Math.sin(angle);
  y = x * Math.sin(angle) + y * Math.cos(angle); x = nextX;
  const length = Math.hypot(x, y, z) || 1;
  data[i] = clamp((x / length + 1) * 127.5);
  data[i + 1] = clamp((y / length + 1) * 127.5);
  data[i + 2] = clamp((z / length + 1) * 127.5);
  data[i + 3] = 255;
}

function normalImage(texture: MaterialTexture, definition: MaterialDefinition, maxSize: number): HTMLCanvasElement {
  const { normalStrength: strength, transform } = definition;
  return converted(sourceFor(texture), `normal:${strength}:${texture.invert}:${transform.angle}:${transform.flipX}:${transform.flipY}`,
    (data, i) => orientNormal(data, i, definition, texture.invert), maxSize);
}

function hash(x: number, y: number): number {
  let value = Math.imul(x + 71, 374761393) ^ Math.imul(y + 31, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

/** Smooth periodic grain remains continuous where the 256px procedural tile repeats. */
function tileNoise(x: number, y: number, step: number): number {
  const cells = 256 / step;
  const left = Math.floor(x / step), top = Math.floor(y / step);
  const ease = (value: number) => value * value * (3 - 2 * value);
  const u = ease(x / step - left), v = ease(y / step - top);
  const sample = (column: number, row: number) => hash(column % cells, row % cells) - .5;
  const upper = sample(left, top) * (1 - u) + sample(left + 1, top) * u;
  const lower = sample(left, top + 1) * (1 - u) + sample(left + 1, top + 1) * u;
  return upper * (1 - v) + lower * v;
}

/** Older carbon definitions gain numeric weave relief without any schema migration. */
export function hasProceduralMaterialRelief(definition: MaterialDefinition): boolean { return definition.preset === 'carbon'; }

/** The same strand crown used by the existing colour/roughness pattern. */
function carbonCrown(x: number, y: number): number {
  const vertical = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0;
  const fiber = (vertical ? x : y) % 16;
  return Math.sin(fiber / 16 * Math.PI);
}

function carbonRelief(definition: MaterialDefinition, result: Map<MaterialRenderChannel, HTMLCanvasElement>): void {
  const size = 256, heights = new Uint8ClampedArray(size * size);
  // Physical strand cross-section, independent of tint and painted brightness.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) heights[y * size + x] = 48 + 160 * carbonCrown(x, y);
  const sample = (x: number, y: number) => heights[((y + size) % size) * size + (x + size) % size];
  for (const channel of ['height', 'normal'] as const) {
    if (definition.textures[channel]) continue;
    const image = canvas(size), ctx = context(image), pixels = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (channel === 'height') {
        const value = heights[y * size + x]; pixels.data.set([value, value, value, 255], i);
      } else {
        // Periodic height slopes in OpenGL tangent coordinates; +Y runs upward.
        const nx = (sample(x - 1, y) - sample(x + 1, y)) * 2.5 / 255;
        const ny = (sample(x, y + 1) - sample(x, y - 1)) * 2.5 / 255;
        const length = Math.hypot(nx, ny, 1);
        pixels.data.set([(nx / length + 1) * 127.5, (ny / length + 1) * 127.5, (1 / length + 1) * 127.5, 255], i);
        orientNormal(pixels.data, i, definition);
      }
    }
    ctx.putImageData(pixels, 0, 0); result.set(channel, image);
  }
}

function procedural(definition: MaterialDefinition): Map<MaterialRenderChannel, HTMLCanvasElement> {
  const result = new Map<MaterialRenderChannel, HTMLCanvasElement>();
  const base = rgb(definition.color);
  for (const channel of ['color', 'roughmetal', 'coat', 'dirt'] as const) {
    const image = canvas(256), ctx = context(image), pixels = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4, noise = hash(x, y) - .5;
      let shade = 1, roughness = 0, metalness = definition.metalness;
      if (definition.preset === 'carbon') {
        shade = .58 + .32 * carbonCrown(x, y) + noise * .08;
        roughness = (shade - .7) * -42;
      } else if (definition.preset === 'brushed') {
        shade = .88 + (hash(0, y) - .5) * .2 + noise * .035;
        roughness = (hash(0, y) - .5) * 35;
      } else if (definition.preset === 'rubber') {
        // Single-pixel noise disappears in the 3D preview. Keep fine grain plus
        // broader variations so this dark material still reads as textured.
        const broad = tileNoise(x, y, 64), grain = tileNoise(x, y, 16);
        shade = .92 + broad * .24 + grain * .12 + noise * .06;
        roughness = broad * 30 + grain * 16 + noise * 10;
      } else if (definition.preset === 'fabric') {
        shade = .74 + (x % 8 < 3 ? .13 : 0) + (y % 8 < 3 ? .13 : 0) + noise * .06;
        roughness = (1 - shade) * 25;
      } else if (definition.preset === 'scratched') {
        const scratch = y % 37 === 0 && hash(Math.floor(x / 29), Math.floor(y / 37)) > .35;
        shade = scratch ? 1.4 : .94 + noise * .08;
        roughness = scratch ? 48 : noise * 15;
        metalness = scratch ? Math.max(150, metalness) : metalness;
      }
      if (channel === 'color') {
        pixels.data[i] = clamp(base[0] * shade); pixels.data[i + 1] = clamp(base[1] * shade); pixels.data[i + 2] = clamp(base[2] * shade);
      } else if (channel === 'roughmetal') { pixels.data[i] = clamp(definition.roughness + roughness); pixels.data[i + 1] = metalness; }
      else { const value = channel === 'coat' ? definition.coat : definition.dirt; pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; }
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0); result.set(channel, image);
  }
  if (hasProceduralMaterialRelief(definition)) carbonRelief(definition, result);
  return result;
}

function regionPath(ctx: CanvasRenderingContext2D, region: MaterialRegion, size: number) {
  ctx.beginPath();
  for (const polygon of region.polygons) {
    ctx.moveTo(polygon[0].x * size, polygon[0].y * size);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x * size, polygon[i].y * size);
    ctx.closePath();
  }
  ctx.fill(region.fillRule ?? 'nonzero');
}

function bounds(layer: MaterialLayer) {
  if (!layer.regions.length) return { x: 0, y: 0, width: REFERENCE_SIZE, height: REFERENCE_SIZE };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const region of layer.regions) for (const polygon of region.polygons) for (const point of polygon) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { x: minX * REFERENCE_SIZE, y: minY * REFERENCE_SIZE, width: Math.max(1, (maxX - minX) * REFERENCE_SIZE), height: Math.max(1, (maxY - minY) * REFERENCE_SIZE) };
}

function placed(target: HTMLCanvasElement, source: HTMLCanvasElement, layer: MaterialLayer, frame: { width: number; height: number }) {
  const ctx = context(target), area = bounds(layer), transform = layer.definition.transform;
  const scale = target.width / REFERENCE_SIZE;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(area.x + area.width / 2 + transform.offsetX, area.y + area.height / 2 + transform.offsetY);
  ctx.rotate(transform.angle * Math.PI / 180);
  ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
  if (transform.mode === 'repeat') {
    const tileScaleX = transform.size / source.width;
    const tileScaleY = transform.size * frame.height / frame.width / source.height;
    ctx.scale(tileScaleX, tileScaleY);
    const pattern = ctx.createPattern(source, 'repeat');
    if (pattern) {
      const extent = REFERENCE_SIZE * 8 + Math.abs(transform.offsetX) + Math.abs(transform.offsetY) + Math.abs(area.x) + Math.abs(area.y);
      ctx.fillStyle = pattern; ctx.fillRect(-extent / tileScaleX, -extent / tileScaleY, 2 * extent / tileScaleX, 2 * extent / tileScaleY);
    }
  } else {
    const ratio = transform.mode === 'cover' ? Math.max(area.width / frame.width, area.height / frame.height)
      : Math.min(area.width / frame.width, area.height / frame.height);
    const zoom = transform.size / 256;
    const width = (transform.mode === 'stretch' ? area.width : frame.width * ratio) * zoom;
    const height = (transform.mode === 'stretch' ? area.height : frame.height * ratio) * zoom;
    ctx.drawImage(source, -width / 2, -height / 2, width, height);
  }
  ctx.restore();
}

function solid(width: number, height: number, color: string): HTMLCanvasElement {
  const image = canvas(width, height); const ctx = context(image); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height); return image;
}

/** Draw all maps with one UV mask, one image frame and one transform. No network calls or async work. */
export function renderMaterialLayer(layer: MaterialLayer, size: number, geometry?: readonly ProjectionTriangle[]): Map<MaterialRenderChannel, HTMLCanvasElement> {
  if (!isValidMaterialLayer(layer)) throw new Error('Ce calque de matériau est invalide.');
  if (!Number.isInteger(size) || size < 1 || size > 4096) throw new Error('La résolution du matériau doit être comprise entre 1 et 4096.');
  if(layer.nativeAtlas){
    const {nativeAtlas,...source}=layer,maps=renderMaterialLayer(source,size,geometry?sourceAtlasGeometry(geometry):geometry),layout=realAtlasLayout(layer.family,nativeAtlas);
    for(const [channel,image]of maps){const target=canvas(size);drawRealAtlas(context(target),image,layout);maps.set(channel,target);release(image);}return maps;
  }
  if(layer.organizedAtlas){
    const {organizedAtlas,...source}=layer;
    const charts=geometry?organizedAtlasGeometry(geometry,organizedAtlas):geometry;
    const maps=renderMaterialLayer(source,size,charts),layout=realAtlasLayout(layer.family,organizedAtlas);
    for(const [channel,image]of maps){const target=canvas(size);drawSourceAtlas(context(target),image,layout);maps.set(channel,target);release(image);}return maps;
  }
  if(layer.atlasFrame&&(!layer.definition.transform.projection||layer.definition.transform.projection==='uv')){
    const maps=renderMaterialLayer(panelReferenceMaterial(layer),size,geometry),frame=panelFrame(layer.atlasFrame.placement);
    const temporary=canvas(Math.ceil(size*frame.scale),Math.ceil(size*frame.scale)),mask=canvas(size),maskCtx=context(mask);
    maskCtx.fillStyle='#fff';for(const region of layer.regions.length?layer.regions:[panelCanvasRegion(layer.atlasFrame.placement)])regionPath(maskCtx,region,size);
    maskCtx.globalCompositeOperation='destination-out';for(const region of layer.exclusions)regionPath(maskCtx,region,size);
    if(layer.atlasFrame.placement==='right'){
      const limit=canvas(size);regionPath(context(limit),panelGuide('right'),size);maskCtx.globalCompositeOperation='destination-in';maskCtx.drawImage(limit,0,0);release(limit);
    }
    for(const image of maps.values()){
      const ctx=context(temporary);ctx.clearRect(0,0,temporary.width,temporary.height);ctx.drawImage(image,0,0,temporary.width,temporary.height);
      const target=context(image);target.clearRect(0,0,size,size);target.drawImage(temporary,frame.x*size,frame.y*size,size*frame.scale,size*frame.scale);
      target.globalCompositeOperation='destination-in';target.globalAlpha=layer.definition.opacity;target.drawImage(mask,0,0);target.globalAlpha=1;target.globalCompositeOperation='source-over';
    }
    release(temporary);release(mask);return maps;
  }
  if (layer.atlasSide && (!layer.definition.transform.projection || layer.definition.transform.projection === 'uv')) {
    const maps = renderMaterialLayer(canonicalDetailsMaterial(layer), size, geometry);
    const half = canvas(Math.ceil(size/2), size), ctx = context(half);
    for (const image of maps.values()) {
      ctx.clearRect(0,0,half.width,size); ctx.drawImage(image,0,0,half.width,size);
      const target=context(image);target.clearRect(0,0,size,size);
      target.drawImage(half,detailsSideOffset(layer.atlasSide)*size,0,size/2,size);
    }
    half.width=half.height=0;
    return maps;
  }
  const { definition } = layer, textures = definition.textures;
  const reference = textures.color ?? textures.roughmetal ?? Object.values(textures)[0];
  const original = reference ? sourceFor(reference) : null;
  const frame = original ?? { width: 256, height: 256 };
  const projector = createMaterialProjector(layer, geometry ?? [], size, frame);
  const place = (target: HTMLCanvasElement, source: HTMLCanvasElement, normal = false, coverage = false) => {
    if (projector) projector.place(target, source, normal, !coverage);
    else placed(target, source, layer, frame);
  };
  const mask = canvas(size), maskCtx = context(mask);
  maskCtx.fillStyle = '#ffffff';
  if (!layer.regions.length) maskCtx.fillRect(0, 0, size, size);
  else for (const region of layer.regions) regionPath(maskCtx, region, size);
  maskCtx.globalCompositeOperation = 'destination-out';
  for (const region of layer.exclusions) regionPath(maskCtx, region, size);
  maskCtx.globalCompositeOperation = 'source-over';
  if(layer.atlasFrame?.placement==='right'){
    const limit=canvas(size);regionPath(context(limit),panelGuide('right'),size);maskCtx.globalCompositeOperation='destination-in';maskCtx.drawImage(limit,0,0);release(limit);maskCtx.globalCompositeOperation='source-over';
  }
  const coverage = canvas(size);
  const coverageSource = original ?? solid(1, 1, '#ffffff');
  place(coverage, coverageSource, false, true);
  maskCtx.globalCompositeOperation = 'destination-in'; maskCtx.drawImage(coverage, 0, 0); release(coverage);
  if (!original) release(coverageSource);
  const generated = procedural(definition), output = new Map<MaterialRenderChannel, HTMLCanvasElement>();
  for (const channel of ['color', 'roughmetal', 'coat', 'dirt', 'emission', 'normal', 'ao', 'height'] as const) {
    if (channel === 'emission' && !textures.emission && definition.emissionStrength === 0) continue;
    if ((channel === 'normal' || channel === 'ao' || channel === 'height') && !textures[channel] && !generated.has(channel)) continue;
    const target = canvas(size), ctx = context(target);
    if (channel === 'color') place(target, textures.color ? colorImage(textures.color, definition.color, 1, size) : generated.get(channel)!);
    else if (channel === 'roughmetal') {
      const packed = textures.roughmetal;
      const base = packed ? converted(sourceFor(packed), `packed:${packed.invert}:${definition.roughness}:${definition.metalness}`, (data, i) => {
        if (packed.invert) { data[i] = 255 - data[i]; data[i + 1] = 255 - data[i + 1]; }
        data[i] = clamp(data[i] * definition.roughness / 255);
        data[i + 1] = clamp(data[i + 1] * definition.metalness / 255);
        data[i + 2] = 0; data[i + 3] = 255;
      }, size) : generated.get(channel)!;
      if (!textures.roughness && !textures.metalness) place(target, base);
      else {
        for (const [name, targetChannel] of [['roughness', 'red'], ['metalness', 'green']] as const) {
          const texture = textures[name];
          const separate = texture ? scalar(texture, targetChannel, definition[name] / 255, size) : converted(base, targetChannel, (data, i) => {
            data[i + (targetChannel === 'red' ? 1 : 0)] = 0; data[i + 2] = 0;
          }, size);
          const part = canvas(size); place(part, separate);
          ctx.globalCompositeOperation = name === 'roughness' ? 'source-over' : 'screen'; ctx.drawImage(part, 0, 0); release(part);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (channel === 'normal') place(target, textures.normal ? normalImage(textures.normal, definition, size) : generated.get(channel)!, true);
    else if (channel === 'ao') place(target, scalar(textures.ao!, 'gray', definition.aoStrength, size));
    else if (channel === 'height') place(target, textures.height ? scalar(textures.height, 'gray', 1, size, 'multiply') : generated.get(channel)!);
    else if (channel === 'emission') {
      const image = textures.emission ? colorImage(textures.emission, definition.emissionColor, definition.emissionStrength, size)
        : solid(1, 1, `rgb(${rgb(definition.emissionColor).map(value => clamp(value * definition.emissionStrength)).join(',')})`);
      place(target, image); if (!textures.emission) release(image);
    } else place(target, textures[channel] ? scalar(textures[channel]!, 'gray', definition[channel] / 255, size, 'multiply') : generated.get(channel)!);
    // All outputs receive the exact same coverage; opaque channel maps cannot leak past the color image.
    ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = definition.opacity; ctx.drawImage(mask, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; output.set(channel, target);
  }
  for (const image of generated.values()) release(image);
  release(mask);
  return output;
}
