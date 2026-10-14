import { decodeDDS, encodeDDS, type RGBAImage } from './dds';
import { baseName, type Skin3DFile } from './skin3d';
import { getWheelTreadNormal, getWheelTreadOcclusion, isWheelTreadPreset, type WheelTreadPresetMode } from './wheelTreads';

export { getWheelTreadNormal, getWheelTreadSwatch, isWheelTreadPreset, type WheelTreadPresetMode } from './wheelTreads';
export type WheelSurfaceMode = 'smooth' | 'relief' | WheelTreadPresetMode;

/** A real skin setting: the same normal is used by the preview and game ZIP. */
export interface WheelSurfaceSettings {
  mode: WheelSurfaceMode;
  /** Normal strength, from a smooth tyre to the source's full relief. */
  strength: number;
}

export const DEFAULT_WHEEL_SURFACE: Readonly<WheelSurfaceSettings> = Object.freeze({ mode: 'smooth', strength: 1 });
export const WHEEL_NORMAL_FILE = 'Wheels_N.dds';
export const WHEEL_OCCLUSION_FILE = 'Wheels_AO.dds';
const nativeWheelUrl = new URL('./assets/model/car/Wheels_N.dds', import.meta.url);

export const WHEEL_SURFACE_PRESETS: readonly Readonly<{ id: WheelSurfaceMode; label: string; description: string }>[] = Object.freeze([
  { id: 'smooth', label: 'Lisse / slick', description: 'Sans sculpture, pour les pneus de compétition sur piste sèche.' },
  { id: 'relief', label: 'Relief d’origine / importé', description: 'Conserve la texture de relief du skin, ou celle du modèle officiel.' },
  { id: 'semi-slick', label: 'Semi-slick circuit', description: 'Trois canaux inégaux, nervures continues et large épaule extérieure peu entaillée. Inspiration pneus de trackday.' },
  { id: 'road', label: 'Routier sportif', description: 'Quatre canaux, épaulements asymétriques et petites encoches décalées. Inspiration pneus routiers haute performance.' },
  { id: 'rain', label: 'Pluie compétition', description: 'Larges canaux de drainage, sorties courbes sur les épaules et rainures de pavés décalées. Inspiration rallye sur asphalte mouillé.' },
  { id: 'gravel', label: 'Rallye terre', description: 'Pavés imbriqués à arêtes obliques, épaules ouvertes et rainures profondes. Inspiration pneus de rallye sur terre.' },
]);

export function isWheelSurfaceMode(value: unknown): value is WheelSurfaceMode {
  return value === 'smooth' || value === 'relief' || isWheelTreadPreset(value);
}

/** Old projects and malformed optional settings safely start with smooth tyres. */
export function normalizeWheelSurface(value: unknown): WheelSurfaceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_WHEEL_SURFACE };
  const settings = value as Partial<WheelSurfaceSettings>;
  return {
    mode: isWheelSurfaceMode(settings.mode) ? settings.mode : 'smooth',
    strength: typeof settings.strength === 'number' && Number.isFinite(settings.strength)
      ? Math.max(0, Math.min(1, settings.strength)) : DEFAULT_WHEEL_SURFACE.strength,
  };
}

/** Trackmania BC5 normals encode X/Y in logical R/G, with OpenGL Y+. */
export function decodeNormalVectors(buffer: ArrayBuffer): RGBAImage | null {
  if (buffer.byteLength < 128 || buffer.byteLength > 32 * 1024 * 1024) return null;
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x20534444 || !header.getUint32(12, true) || !header.getUint32(16, true) ||
    header.getUint32(12, true) > 4096 || header.getUint32(16, true) > 4096) return null;
  const image = decodeDDS(buffer);
  if (!image) return null;
  for (let i = 0; i < image.data.length; i += 4) {
    const x = image.data[i] / 127.5 - 1;
    const y = image.data[i + 1] / 127.5 - 1;
    image.data[i + 2] = Math.round((Math.sqrt(Math.max(0, 1 - x * x - y * y)) + 1) * 127.5);
    image.data[i + 3] = 255;
  }
  return image;
}

function flatNormal(): RGBAImage {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([128, 128, 255, 255], i);
  return { width: 4, height: 4, data };
}

/** Constant across calls so slider/UI updates do not allocate GPU textures. */
export const SMOOTH_WHEEL_NORMAL = flatNormal();
const RELIEF_TRANSFORMS = new WeakMap<RGBAImage, { strength: number; image: RGBAImage }>();

/** Pure transform: never modifies the original imported or native normal atlas. */
export function applyWheelRelief(image: RGBAImage, strength: number): RGBAImage {
  strength = Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1));
  if (strength === 0) return SMOOTH_WHEEL_NORMAL;
  if (strength === 1) return image;
  const cached = RELIEF_TRANSFORMS.get(image);
  if (cached?.strength === strength) return cached.image;
  const data = image.data.slice();
  for (let i = 0; i < data.length; i += 4) {
    const x = (data[i] / 127.5 - 1) * strength;
    const y = (data[i + 1] / 127.5 - 1) * strength;
    data[i] = Math.round((x + 1) * 127.5);
    data[i + 1] = Math.round((y + 1) * 127.5);
    data[i + 2] = Math.round((Math.sqrt(Math.max(0, 1 - x * x - y * y)) + 1) * 127.5);
    data[i + 3] = 255;
  }
  const transformed = { width: image.width, height: image.height, data };
  RELIEF_TRANSFORMS.set(image, { strength, image: transformed });
  return transformed;
}

let nativeWheelBytes: Promise<Uint8Array> | undefined;
async function loadNativeWheelBytes(): Promise<Uint8Array> {
  nativeWheelBytes ??= (async () => {
    const response = await fetch(nativeWheelUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Relief des pneus indisponible : HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  })().catch((error: unknown) => { nativeWheelBytes = undefined; throw error; });
  return nativeWheelBytes;
}

const decodedNormals = new WeakMap<Uint8Array, RGBAImage>();
function normalFromBytes(bytes: Uint8Array): RGBAImage {
  let image = decodedNormals.get(bytes);
  if (!image) {
    image = decodeNormalVectors(bytes.slice().buffer) ?? undefined;
    if (!image) throw new Error('La texture de relief des pneus est invalide.');
    decodedNormals.set(bytes, image);
  }
  return image;
}

function importedWheelNormal(files: readonly Skin3DFile[]): Uint8Array | undefined {
  let source: Uint8Array | undefined;
  for (const entry of files) if (baseName(entry.name).toLowerCase() === WHEEL_NORMAL_FILE.toLowerCase()) source = entry.data;
  return source;
}

/** The same uncompressed normal source is used by the 2D guide, 3D and ZIP. */
export async function resolveWheelNormalImage(
  value: WheelSurfaceSettings,
  importedFiles: readonly Skin3DFile[] = [],
  officialModel = true,
  loadNative: () => Promise<Uint8Array> = loadNativeWheelBytes,
): Promise<RGBAImage> {
  const settings = normalizeWheelSurface(value);
  if (settings.mode === 'smooth' || settings.strength === 0) return SMOOTH_WHEEL_NORMAL;
  if (isWheelTreadPreset(settings.mode)) {
    if (!officialModel) return SMOOTH_WHEEL_NORMAL;
    const native = normalFromBytes(await loadNative());
    return applyWheelRelief(getWheelTreadNormal(settings.mode, native), settings.strength);
  }
  const source = importedWheelNormal(importedFiles) ?? (officialModel ? await loadNative() : undefined);
  return source ? applyWheelRelief(normalFromBytes(source), settings.strength) : SMOOTH_WHEEL_NORMAL;
}

const WHITE_WHEEL_AO: RGBAImage = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };

/** Explicit prelight prevents the game from restoring the old native grooves. */
export function buildWheelOcclusionFile(value: WheelSurfaceSettings, officialModel = true): Skin3DFile | null {
  const settings = normalizeWheelSurface(value);
  if (settings.mode === 'relief' && settings.strength > 0) return null;
  let image = WHITE_WHEEL_AO;
  if (isWheelTreadPreset(settings.mode) && officialModel && settings.strength > 0) {
    image = getWheelTreadOcclusion(settings.mode);
    if (settings.strength < 1) {
      const data = image.data.slice();
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i + 1] = data[i + 2] = Math.round(255 - (255 - data[i]) * settings.strength);
      }
      image = { width: image.width, height: image.height, data };
    }
  }
  return { name: WHEEL_OCCLUSION_FILE, data: new Uint8Array(encodeDDS(image, 'BC4')) };
}

/**
 * Emit an explicit BC5 override: omitting Wheels_N would restore the game's
 * native tread. Full source strength reuses the original DDS, without another
 * lossy compression pass. Custom UVs never inherit the Stadium native atlas.
 */
export async function buildWheelNormalFile(
  value: WheelSurfaceSettings,
  importedFiles: readonly Skin3DFile[] = [],
  officialModel = true,
  loadNative: () => Promise<Uint8Array> = loadNativeWheelBytes,
): Promise<Skin3DFile | null> {
  const settings = normalizeWheelSurface(value);
  if (settings.mode === 'relief' && settings.strength === 1) {
    const source = importedWheelNormal(importedFiles) ?? (officialModel ? await loadNative() : undefined);
    if (source) {
      normalFromBytes(source); // Validate without altering the original compressed bytes.
      return { name: WHEEL_NORMAL_FILE, data: source };
    }
  }
  const image = await resolveWheelNormalImage(settings, importedFiles, officialModel, loadNative);
  return { name: WHEEL_NORMAL_FILE, data: new Uint8Array(encodeDDS(image, 'BC5')) };
}

/** Replace case-insensitively; the ZIP must contain only one wheel normal. */
export function withWheelNormalFile(files: readonly Skin3DFile[], normal: Skin3DFile | null, value?: WheelSurfaceSettings, occlusion?: Skin3DFile | null): Skin3DFile[] {
  if (!normal) return [...files];
  const settings = value ? normalizeWheelSurface(value) : undefined;
  const dropWheelAO = settings && (settings.mode !== 'relief' || settings.strength === 0);
  return [...files.filter((entry) => {
    const name = baseName(entry.name).toLowerCase();
    return name !== WHEEL_NORMAL_FILE.toLowerCase() && !((dropWheelAO || occlusion) && name === 'wheels_ao.dds');
  }), normal, ...(occlusion ? [occlusion] : [])];
}
