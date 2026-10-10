import type { RGBAImage } from './dds';

export type WheelTreadPresetMode = 'semi-slick' | 'road' | 'rain' | 'gravel';
export const WHEEL_TREAD_PRESET_MODES = ['semi-slick', 'road', 'rain', 'gravel'] as const;
export function isWheelTreadPreset(value: unknown): value is WheelTreadPresetMode {
  return WHEEL_TREAD_PRESET_MODES.some((mode) => mode === value);
}

/** Measured on the official FBX: U runs from inner to outer sidewall on all tyres. */
export const WHEEL_TREAD_UV = Object.freeze({ minU: 0.200728, maxU: 0.811564 });
export const WHEEL_SIDEWALL_UV = Object.freeze({ inner: 0.170099, outer: 0.852508 });
// Twice native resolution retains narrow shoulder notches and rounded walls.
export const WHEEL_TREAD_SIZE = Object.freeze({ width: 1024, height: 2048 });
const TREAD_WIDTH = 0.283, CIRCUMFERENCE = 2.289;
const SURFACES = new Map<WheelTreadPresetMode, { normal: RGBAImage; occlusion: RGBAImage }>();
const COMPOSITES = new WeakMap<RGBAImage, Map<WheelTreadPresetMode, RGBAImage>>();

function smoothstep(lo: number, hi: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}
function periodicDistance(position: number, period: number): number {
  const phase = ((position / period + 0.5) % 1 + 1) % 1 - 0.5;
  return Math.abs(phase * period);
}
/** Rounded walls and a recessed floor, without razors on top of the rubber. */
function groove(distance: number, halfWidth: number, bevel = 0.0012): number {
  return 1 - smoothstep(Math.max(0, halfWidth - bevel), halfWidth + bevel, Math.abs(distance));
}
function bandWindow(x: number, lo: number, hi: number): number {
  return smoothstep(lo, lo + .002, x) * (1 - smoothstep(hi - .002, hi, x));
}
/** Pitch variation closes at one revolution and breaks the old uniform grid. */
function slots(y: number, count: number, offset: number, curve: number, halfWidth: number, variation: number): number {
  const pitch = CIRCUMFERENCE / count;
  const varied = y + pitch * .075 * variation;
  return groove(periodicDistance(varied + offset + curve, pitch), halfWidth);
}

function slotBand(x: number, lo: number, hi: number, y: number, count: number, offset: number, curve: number, halfWidth: number, variation: number): number {
  // Most texels belong to only one rib. Do not evaluate every other rib's pattern.
  if (x <= lo || x >= hi) return 0;
  return slots(y, count, offset, curve, halfWidth, variation) * bandWindow(x, lo, hi);
}

/**
 * Recessed tread in metres. Asymmetric inner/outer shoulders are valid on stock
 * UVs; arrow/V patterns are avoided because left-wheel V is reversed.
 */
export function sampleWheelTreadHeight(mode: WheelTreadPresetMode, across: number, turn: number): number {
  if (!Number.isFinite(across) || !Number.isFinite(turn) || across <= 0 || across >= 1) return 0;
  const cycle = ((turn % 1) + 1) % 1;
  return sampleHeight(mode, across, cycle * CIRCUMFERENCE, Math.sin(cycle * Math.PI * 10), Math.sin(cycle * Math.PI * 64));
}

/** Row-invariant trigonometry is supplied once for all 1024 texels. */
function sampleHeight(mode: WheelTreadPresetMode, across: number, y: number, variation: number, lugWave: number): number {
  if (across <= 0 || across >= 1) return 0;
  const x = (across - .5) * TREAD_WIDTH;
  const shoulder = smoothstep(0, .0035, Math.min(across, 1 - across) * TREAD_WIDTH);
  let cut = 0, depth = 0;
  if (mode === 'semi-slick') {
    // Three unequal channels, continuous ribs, and a wide nearly solid outer shoulder.
    cut = Math.max(groove(x + .078, .0024), groove(x + .023, .003), groove(x - .050, .0022));
    const inner = slotBand(x, -.143, -.079, y, 46, .013, (x + .080) * .48, .0015, variation);
    const outer = slotBand(x, .108, .143, y, 42, .027, (x - .11) * -.4, .0011, variation);
    const rib = slotBand(x, -.075, -.041, y, 46, .013, (x + .060) * .35, .0008, variation);
    cut = Math.max(cut, inner, outer * .65, rib * .45); depth = .0048;
  } else if (mode === 'road') {
    // Separate shoulder/rib cuts and offset blocks, rather than crosshatching.
    cut = Math.max(groove(x + .094, .0028), groove(x + .035, .0035), groove(x - .029, .0032), groove(x - .088, .0026));
    const inner = slotBand(x, -.143, -.097, y, 54, .009, (x + .1) * .65, .0019, variation);
    const innerRib = slotBand(x, -.091, -.038, y, 54, .029, (x + .06) * -.5, .0014, variation);
    const outerRib = slotBand(x, .033, .085, y, 48, .012, (x - .056) * .5, .0014, variation);
    const outer = slotBand(x, .091, .143, y, 48, .035, (x - .1) * -.6, .0021, variation);
    const sipe = slotBand(x, -.027, .011, y, 54, .018, x * .32, .00065, variation);
    cut = Math.max(cut, inner, innerRib, outerRib, outer, sipe * .35); depth = .0065;
  } else if (mode === 'rain') {
    // Open longitudinal channels with broad curved outlets. Cuts stop at their
    // own ribs: there is no all-over diamond lattice or rotation arrow.
    cut = Math.max(groove(x + .089, .004), groove(x + .030, .0046), groove(x - .031, .0046), groove(x - .090, .004));
    const inner = slotBand(x, -.143, -.094, y, 40, .008, (x + .09) * .65 + (x + .09) ** 2 * 3, .0034, variation);
    const innerRib = slotBand(x, -.084, -.035, y, 40, .032, (x + .05) * -.65, .0026, variation);
    const outerRib = slotBand(x, .036, .085, y, 40, .009, (x - .05) * .65, .0026, variation);
    const outer = slotBand(x, .095, .143, y, 40, .038, (x - .09) * -.65 - (x - .09) ** 2 * 3, .0034, variation);
    const sipe = slotBand(x, -.022, .022, y, 40, .020, x * .2, .001, variation);
    cut = Math.max(cut, inner, innerRib, outerRib, outer, sipe * .45); depth = .008;
  } else {
    // Interlocking central lugs, offset shoulder blocks, deep open voids.
    const innerBoundary = -.084 + .004 * lugWave;
    const outerBoundary = .084 - .004 * lugWave;
    cut = Math.max(groove(x - innerBoundary, .0055, .0018), groove(x + .027, .0042, .0018), groove(x - .027, .0042, .0018), groove(x - outerBoundary, .0055, .0018));
    const inner = slotBand(x, -.143, -.079, y, 32, .008, (x + .108) * .4, .006, variation);
    const left = slotBand(x, -.089, -.022, y, 32, .043, (x + .05) * -.28, .0048, variation);
    const centre = slotBand(x, -.032, .032, y, 32, .012, x * .12, .0045, variation);
    const right = slotBand(x, .022, .089, y, 32, .043, (x - .05) * .28, .0048, variation);
    const outer = slotBand(x, .079, .143, y, 32, .008, (x - .108) * -.4, .006, variation);
    cut = Math.max(cut, inner, left, centre, right, outer); depth = .009;
  }
  return -cut * depth * shoulder;
}

/** Two-profile LRU bounds working memory; slider updates reuse the same source. */
function surfaces(mode: WheelTreadPresetMode) {
  if (!isWheelTreadPreset(mode)) throw new Error('Profil de pneu inconnu.');
  let cached = SURFACES.get(mode);
  if (cached) { SURFACES.delete(mode); SURFACES.set(mode, cached); return cached; }
  const { width, height } = WHEEL_TREAD_SIZE;
  const normal = new Uint8ClampedArray(width * height * 4), ao = new Uint8ClampedArray(width * height * 4);
  const band = WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU, acrossPixel = 1 / (width * band), cycle = height - 1;
  const dx = acrossPixel * TREAD_WIDTH, dy = CIRCUMFERENCE / cycle;
  const heights = new Float32Array(width * cycle);
  const minX = Math.floor(WHEEL_TREAD_UV.minU * width), maxX = Math.ceil(WHEEL_TREAD_UV.maxU * width);
  for (let y = 0; y < cycle; y++) {
    const turn = y / cycle, variation = Math.sin(turn * Math.PI * 10), lugWave = Math.sin(turn * Math.PI * 64);
    for (let x = minX; x < maxX; x++) {
      heights[y * width + x] = sampleHeight(mode, ((x + .5) / width - WHEEL_TREAD_UV.minU) / band, turn * CIRCUMFERENCE, variation, lugWave);
    }
  }
  for (let y = 0; y < height; y++) {
    const row = y % cycle, above = ((row + cycle - 1) % cycle) * width, below = ((row + 1) % cycle) * width;
    for (let x = 0; x < width; x++) {
      const across = ((x + .5) / width - WHEEL_TREAD_UV.minU) / band, i = (y * width + x) * 4;
      const h = heights[row * width + x], shade = Math.round(255 * (1 - Math.min(.48, -h * 55)));
      // Only recesses occlude: neutral sidewalls and flat rubber stay white.
      ao.set([shade, shade, shade, 255], i);
      if (across <= acrossPixel || across >= 1 - acrossPixel) { normal.set([128, 128, 255, 255], i); continue; }
      const nx = -(heights[row * width + x + 1] - heights[row * width + x - 1]) / (2 * dx);
      const ny = (heights[below + x] - heights[above + x]) / (2 * dy);
      const scale = 127.5 / Math.hypot(nx, ny, 1);
      normal[i] = Math.round(127.5 + nx * scale); normal[i + 1] = Math.round(127.5 + ny * scale);
      normal[i + 2] = Math.round(127.5 + scale); normal[i + 3] = 255;
    }
  }
  cached = { normal: { width, height, data: normal }, occlusion: { width, height, data: ao } };
  SURFACES.set(mode, cached);
  if (SURFACES.size > 2) SURFACES.delete(SURFACES.keys().next().value!);
  return cached;
}

/** Keep moulded sidewalls while fading out the old shoulder/tread grooves. */
export function getWheelTreadNormal(mode: WheelTreadPresetMode, sidewallSource?: RGBAImage | null): RGBAImage {
  const base = surfaces(mode).normal;
  if (!sidewallSource) return base;
  let cache = COMPOSITES.get(sidewallSource);
  if (!cache) { cache = new Map(); COMPOSITES.set(sidewallSource, cache); }
  const old = cache.get(mode);
  if (old) { cache.delete(mode); cache.set(mode, old); return old; }
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
  cache.set(mode, image);
  if (cache.size > 2) cache.delete(cache.keys().next().value!);
  return image;
}

export function getWheelTreadOcclusion(mode: WheelTreadPresetMode): RGBAImage { return surfaces(mode).occlusion; }

/** Physical-size sample of the same design, without generating its full atlas. */
export function getWheelTreadSwatch(mode: WheelTreadPresetMode, width = 72, height = 96): RGBAImage {
  if (!isWheelTreadPreset(mode)) throw new Error('Profil de pneu inconnu.');
  width = Number.isFinite(width) ? Math.max(32, Math.min(192, Math.round(width))) : 72;
  height = Number.isFinite(height) ? Math.max(32, Math.min(256, Math.round(height))) : 96;
  const data = new Uint8ClampedArray(width * height * 4), dx = TREAD_WIDTH / width, dy = dx;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const across = (x + .5) / width, turn = (y + .5) * dy / CIRCUMFERENCE;
    const h = sampleWheelTreadHeight(mode, across, turn);
    const nx = -(sampleWheelTreadHeight(mode, across + 1 / width, turn) - sampleWheelTreadHeight(mode, across - 1 / width, turn)) / (2 * dx);
    const ny = (sampleWheelTreadHeight(mode, across, turn + dy / CIRCUMFERENCE) - sampleWheelTreadHeight(mode, across, turn - dy / CIRCUMFERENCE)) / (2 * dy);
    const light = Math.max(0, (-.48 * nx + .55 * ny + .68) / Math.hypot(nx, ny, 1));
    const shade = Math.round(Math.max(14, (37 + light * 63) * (1 - Math.min(.48, -h * 55))));
    data.set([shade, shade + 3, shade + 5, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
