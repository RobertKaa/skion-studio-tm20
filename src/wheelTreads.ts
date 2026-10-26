import type { RGBAImage } from './dds';
import { createWheelTreadPattern } from './wheelTreadPatterns';
import { rasterizeTread, TYRE_CIRCUMFERENCE, TYRE_TREAD_WIDTH } from './wheelTreadRaster';

export const WHEEL_TREAD_PRESET_MODES = ['semi-slick', 'road', 'rain', 'gravel', 'touring', 'winter', 'mud', 'classic'] as const;
export type WheelTreadPresetMode = typeof WHEEL_TREAD_PRESET_MODES[number];
/** Authored height-field depth. Normal maps reproduce shading, not silhouette displacement. */
export const WHEEL_TREAD_DEPTH_MM: Readonly<Record<WheelTreadPresetMode, number>> = Object.freeze({
  'semi-slick': 5.2, road: 7.5, rain: 9, gravel: 10.5, touring: 8, winter: 9.5, mud: 14, classic: 6.5,
});
export function isWheelTreadPreset(value: unknown): value is WheelTreadPresetMode {
  return WHEEL_TREAD_PRESET_MODES.some((mode) => mode === value);
}

/** Measured on the official FBX: U runs from inner to outer sidewall on all tyres. */
export const WHEEL_TREAD_UV = Object.freeze({ minU: 0.200728, maxU: 0.811564 });
export const WHEEL_SIDEWALL_UV = Object.freeze({ inner: 0.170099, outer: 0.852508 });
// Four times native resolution resolves fine sipes and the narrow chamfers of moulded rubber.
export const WHEEL_TREAD_SIZE = Object.freeze({ width: 2048, height: 4096 });
const TREAD_WIDTH = TYRE_TREAD_WIDTH, CIRCUMFERENCE = TYRE_CIRCUMFERENCE;
const SURFACES = new Map<string, { normal: RGBAImage; occlusion: RGBAImage }>();
const COMPOSITES = new WeakMap<RGBAImage, Map<string, RGBAImage>>();

function smoothstep(lo: number, hi: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}
interface HeightField { width: number; height: number; firstX: number; dx: number; values: Float32Array }
let heightCache: { mode: WheelTreadPresetMode; field: HeightField } | undefined;
let blockCache: { mode: WheelTreadPresetMode; field: HeightField } | undefined;
let detailCache: { mode: WheelTreadPresetMode; field: HeightField } | undefined;
let volumeCache: { mode: WheelTreadPresetMode; field: HeightField } | undefined;

/** One physical construction field is retained; thumbnails never allocate a full atlas. */
function heightField(mode: WheelTreadPresetMode, part: 'all' | 'blocks' | 'details' | 'volume' = 'all'): HeightField {
  if (!isWheelTreadPreset(mode)) throw new Error('Profil de pneu inconnu.');
  const cached = part === 'blocks' ? blockCache : part === 'details' ? detailCache : part === 'volume' ? volumeCache : heightCache;
  if (cached?.mode === mode) return cached.field;
  const atlas = WHEEL_TREAD_SIZE;
  const firstX = Math.floor(WHEEL_TREAD_UV.minU * atlas.width);
  const width = Math.ceil(WHEEL_TREAD_UV.maxU * atlas.width) - firstX;
  const height = atlas.height - 1;
  const dx = TREAD_WIDTH / (atlas.width * (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU));
  const minX = ((firstX + .5) / atlas.width - WHEEL_TREAD_UV.minU) / (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU) * TREAD_WIDTH;
  const pattern = createWheelTreadPattern(mode);
  if (part === 'blocks' || part === 'volume') {
    if (part === 'blocks') pattern.strokes = [];
    // A mould draft resolves the wall on the native game mesh, without inflated normal-map edges.
    pattern.blocks = pattern.blocks?.map(block => ({ ...block, bevel: .002 }));
  } else if (part === 'details') pattern.blocks = undefined;
  const values = rasterizeTread(pattern, { width, height, minX, minY: 0, stepX: dx, stepY: CIRCUMFERENCE / height });
  const field = { width, height, firstX, dx, values };
  if (part === 'blocks') blockCache = { mode, field };
  else if (part === 'details') detailCache = { mode, field };
  else if (part === 'volume') volumeCache = { mode, field };
  else heightCache = { mode, field };
  return field;
}

/** Physical recess in metres, bilinearly sampled from the same mould as the normal and cavity maps. */
export function sampleWheelTreadHeight(mode: WheelTreadPresetMode, across: number, turn: number): number {
  return sampleField(heightField(mode), across, turn);
}

/** Major lugs only: fine sipes remain in the residual normal map, never counted twice. */
export function sampleWheelTreadBlockHeight(mode: 'gravel' | 'mud', across: number, turn: number): number {
  return sampleField(heightField(mode, 'blocks'), across, turn);
}

function sampleField(field: HeightField, across: number, turn: number): number {
  if (!Number.isFinite(across) || !Number.isFinite(turn) || across <= 0 || across >= 1) return 0;
  const x = Math.max(0, Math.min(field.width - 1, (WHEEL_TREAD_UV.minU + across * (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU)) * WHEEL_TREAD_SIZE.width - .5 - field.firstX));
  const y = ((turn % 1) + 1) % 1 * field.height;
  const left = Math.floor(x), right = Math.min(field.width - 1, left + 1), top = Math.floor(y), bottom = (top + 1) % field.height;
  const tx = x - left, ty = y - top;
  return (field.values[top * field.width + left] * (1 - tx) + field.values[top * field.width + right] * tx) * (1 - ty)
    + (field.values[bottom * field.width + left] * (1 - tx) + field.values[bottom * field.width + right] * tx) * ty;
}

/** Deterministic micrometre-scale rubber grain, closed at one physical revolution. */
function grain(x: number, y: number): number {
  let hash = Math.imul(x + 17, 374761393) ^ Math.imul(y + 29, 668265263);
  hash = Math.imul(hash ^ hash >>> 13, 1274126177);
  return ((hash ^ hash >>> 16) >>> 0) / 4294967295 - .5;
}

/** Two-profile LRU bounds working memory; slider updates reuse the same source. */
function surfaces(mode: WheelTreadPresetMode, detailOnly = false, volume = false) {
  if (!isWheelTreadPreset(mode)) throw new Error('Profil de pneu inconnu.');
  const key = `${mode}:${detailOnly}:${volume}`;
  let cached = SURFACES.get(key);
  if (cached) { SURFACES.delete(key); SURFACES.set(key, cached); return cached; }
  const { width, height } = WHEEL_TREAD_SIZE;
  const normal = new Uint8ClampedArray(width * height * 4), ao = new Uint8ClampedArray(width * height * 4);
  const field = heightField(mode, volume ? 'volume' : detailOnly ? 'details' : 'all'), cycle = field.height;
  const dx = field.dx, dy = CIRCUMFERENCE / cycle, depth = WHEEL_TREAD_DEPTH_MM[mode] / 1000;
  const read = (x: number, y: number) => x < 0 || x >= field.width ? 0 : field.values[y * field.width + x];
  for (let y = 0; y < height; y++) {
    const row = y % cycle, above = (row + cycle - 1) % cycle, below = (row + 1) % cycle;
    for (let x = 0; x < width; x++) {
      const column = x - field.firstX, i = (y * width + x) * 4;
      const h = read(column, row), cavity = Math.max(0, Math.min(1, -h / depth));
      const shade = Math.round(255 * (1 - (volume ? .52 : .72) * Math.pow(cavity, .62)));
      // Only recesses occlude: neutral sidewalls and flat rubber stay white.
      ao[i] = ao[i + 1] = ao[i + 2] = shade; ao[i + 3] = 255;
      if (column <= 0 || column >= field.width - 1) { normal.set([128, 128, 255, 255], i); continue; }
      const micro = .000009 * (1 - cavity * .8);
      const nx = -(read(column + 1, row) - read(column - 1, row) + micro * (grain(x + 1, row) - grain(x - 1, row))) / (2 * dx);
      const ny = (read(column, below) - read(column, above) + micro * (grain(x, below) - grain(x, above))) / (2 * dy);
      const scale = 127.5 / Math.hypot(nx, ny, 1);
      normal[i] = Math.round(127.5 + nx * scale); normal[i + 1] = Math.round(127.5 + ny * scale);
      normal[i + 2] = Math.round(127.5 + scale); normal[i + 3] = 255;
    }
  }
  cached = { normal: { width, height, data: normal }, occlusion: { width, height, data: ao } };
  SURFACES.set(key, cached);
  if (SURFACES.size > 2) SURFACES.delete(SURFACES.keys().next().value!);
  return cached;
}

/** Keep moulded sidewalls while fading out the old shoulder/tread grooves. */
export function getWheelTreadNormal(mode: WheelTreadPresetMode, sidewallSource?: RGBAImage | null, detailOnly = false): RGBAImage {
  const base = surfaces(mode, detailOnly).normal, key = `${mode}:${detailOnly}`;
  if (!sidewallSource) return base;
  let cache = COMPOSITES.get(sidewallSource);
  if (!cache) { cache = new Map(); COMPOSITES.set(sidewallSource, cache); }
  const old = cache.get(key);
  if (old) { cache.delete(key); cache.set(key, old); return old; }
  const data = base.data.slice(), { width, height } = base;
  for (let x = 0; x < width; x++) {
    const u = (x + .5) / width;
    const weight = u < WHEEL_TREAD_UV.minU ? 1 - smoothstep(WHEEL_SIDEWALL_UV.inner, WHEEL_TREAD_UV.minU, u) : smoothstep(WHEEL_TREAD_UV.maxU, WHEEL_SIDEWALL_UV.outer, u);
    if (!weight) continue;
    const sx = Math.max(0, Math.min(sidewallSource.width - 1, u * sidewallSource.width - .5));
    const x0 = Math.floor(sx), x1 = Math.min(sidewallSource.width - 1, x0 + 1), tx = sx - x0;
    for (let y = 0; y < height; y++) {
      const sy = y / (height - 1) * (sidewallSource.height - 1);
      const y0 = Math.floor(sy), y1 = Math.min(sidewallSource.height - 1, y0 + 1), ty = sy - y0;
      const i = (y * width + x) * 4, a = (y0 * sidewallSource.width + x0) * 4, b = (y0 * sidewallSource.width + x1) * 4;
      const c = (y1 * sidewallSource.width + x0) * 4, d = (y1 * sidewallSource.width + x1) * 4;
      const sample = (channel: number) => (sidewallSource.data[a + channel] * (1 - tx) + sidewallSource.data[b + channel] * tx) * (1 - ty)
        + (sidewallSource.data[c + channel] * (1 - tx) + sidewallSource.data[d + channel] * tx) * ty;
      const nx = (sample(0) / 127.5 - 1) * weight, ny = (sample(1) / 127.5 - 1) * weight;
      data[i] = Math.round((nx + 1) * 127.5); data[i + 1] = Math.round((ny + 1) * 127.5);
      data[i + 2] = Math.round((Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) + 1) * 127.5);
    }
  }
  const image = { width, height, data };
  cache.set(key, image);
  if (cache.size > 2) cache.delete(cache.keys().next().value!);
  return image;
}

export function getWheelTreadOcclusion(mode: WheelTreadPresetMode, volume = false): RGBAImage { return surfaces(mode, false, volume).occlusion; }

/** Physical-size sample of the same design, without generating its full atlas. */
export function getWheelTreadSwatch(mode: WheelTreadPresetMode, width = 72, height = 96): RGBAImage {
  if (!isWheelTreadPreset(mode)) throw new Error('Profil de pneu inconnu.');
  width = Number.isFinite(width) ? Math.max(32, Math.min(192, Math.round(width))) : 72;
  height = Number.isFinite(height) ? Math.max(32, Math.min(256, Math.round(height))) : 96;
  const data = new Uint8ClampedArray(width * height * 4);
  // Render a supersampled physical crop: even the gallery preserves tapered cuts and fine sipes.
  const supersample = 3, columns = width * supersample, rows = height * supersample;
  const dx = TREAD_WIDTH / columns, minY = CIRCUMFERENCE * .137;
  const values = rasterizeTread(createWheelTreadPattern(mode), { width: columns + 2, height: rows + 2, minX: -dx / 2, minY: minY - dx, stepX: dx, stepY: dx });
  const stride = columns + 2, depth = WHEEL_TREAD_DEPTH_MM[mode] / 1000;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let sy = 0; sy < supersample; sy++) for (let sx = 0; sx < supersample; sx++) {
      const column = x * supersample + sx + 1, row = y * supersample + sy + 1, index = row * stride + column;
      const h = values[index], cavity = Math.max(0, Math.min(1, -h / depth));
      const nx = -(values[index + 1] - values[index - 1]) / (2 * dx);
      const ny = (values[index + stride] - values[index - stride]) / (2 * dx);
      const light = Math.max(0, (-.55 * nx + .35 * ny + .76) / Math.hypot(nx, ny, 1));
      const crown = Math.sin(Math.PI * ((column - .5) / columns));
      sum += (34 + light * 48) * (.75 + .25 * crown) * (1 - cavity * .82);
    }
    const shade = Math.round(Math.max(5, sum / (supersample * supersample)));
    data.set([shade, shade + 2, shade + 3, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
