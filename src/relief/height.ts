import type { RGBAImage } from '../dds';

export const STANDARD_RELIEF_MAX_MM = 8;
export const DIAGNOSTIC_RELIEF_MAX_MM = 80;

/** The larger range must be deliberately enabled; neither path accepts non-finite values. */
export function validReliefAmplitude(strengthMm: number, diagnostic = false): boolean {
  return typeof diagnostic === 'boolean' && Number.isFinite(strengthMm) && strengthMm >= 0
    && strengthMm <= (diagnostic ? DIAGNOSTIC_RELIEF_MAX_MM : STANDARD_RELIEF_MAX_MM);
}

export function validateReliefAtlas(image: RGBAImage): void {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > 4096 || image.height > 4096
    || image.width * image.height > 16 * 1024 * 1024
    || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new Error('La texture de relief est invalide (4K maximum).');
  }
}

function index(image: RGBAImage, x: number, y: number): number {
  return (Math.max(0, Math.min(image.height - 1, y)) * image.width + Math.max(0, Math.min(image.width - 1, x))) * 4;
}

function signedHeight(value: number): number { return (value - 128) / (value >= 128 ? 127 : 128); }

/** Bilinear sampling: image rows run downward, native UV V runs upward. */
export function sampleReliefHeight(image: RGBAImage, u: number, v: number): number {
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error('Coordonnées UV du relief invalides.');
  const x = Math.max(0, Math.min(1, u)) * (image.width - 1), y = (1 - Math.max(0, Math.min(1, v))) * (image.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const value = (px: number, py: number) => {
    const offset = index(image, px, py);
    // A transparent region has no displacement, regardless of its RGB bytes.
    return signedHeight(image.data[offset]) * image.data[offset + 3] / 255;
  };
  return value(x0, y0) * (1 - tx) * (1 - ty) + value(x0 + 1, y0) * tx * (1 - ty)
    + value(x0, y0 + 1) * (1 - tx) * ty + value(x0 + 1, y0 + 1) * tx * ty;
}

/** Derive OpenGL tangent normals from linear height; scale is in metres. */
export function deriveReliefNormals(image: RGBAImage, strengthMm = 3, spanMeters = 1.8, diagnostic = false): RGBAImage {
  validateReliefAtlas(image);
  if (!validReliefAmplitude(strengthMm, diagnostic) || !Number.isFinite(spanMeters) || spanMeters <= 0 || spanMeters > 10) {
    throw new Error(`Amplitude du relief invalide (0 à ${diagnostic === true ? DIAGNOSTIC_RELIEF_MAX_MM : STANDARD_RELIEF_MAX_MM} mm).`);
  }
  const data = new Uint8ClampedArray(image.data.length);
  const height = (x: number, y: number) => {
    const offset = index(image, x, y);
    return signedHeight(image.data[offset]) * image.data[offset + 3] / 255;
  };
  const scaleX = image.width * strengthMm / 1000 / spanMeters, scaleY = image.height * strengthMm / 1000 / spanMeters;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const target = (y * image.width + x) * 4;
    const nx = -(height(x + 1, y) - height(x - 1, y)) * scaleX / 2;
    // UV V points upward, while PNG row Y increases downward.
    const ny = (height(x, y + 1) - height(x, y - 1)) * scaleY / 2;
    const length = Math.hypot(nx, ny, 1);
    data.set([127.5 + nx / length * 127.5, 127.5 + ny / length * 127.5, 127.5 + 127.5 / length, image.data[target + 3]], target);
  }
  return { width: image.width, height: image.height, data };
}

/** A repeatable, broad-height example when no imported source is selected. */
export function createDiagnosticReliefAtlas(size = 512): RGBAImage {
  if (!Number.isInteger(size) || size < 4 || size > 4096) throw new Error('Résolution du relief de démonstration invalide.');
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    // Broad crossed ridges survive native LOD sampling; finer waves show normals.
    const height = .5 + .25 * Math.cos(u * Math.PI * 24) * Math.cos(v * Math.PI * 20)
      + .12 * Math.sin((u + v) * Math.PI * 64);
    const value = Math.max(0, Math.min(255, Math.round(height * 255)));
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  return { width: size, height: size, data };
}

/** Large, smooth domes/ridges make real mesh movement readable without painted details. */
export function createVolumeDiagnosticAtlas(size = 512): RGBAImage {
  if (!Number.isInteger(size) || size < 4 || size > 4096) throw new Error('Résolution du relief de diagnostic invalide.');
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    // Two by three wide domes survive sparse native LODs; a broad diagonal wave
    // breaks symmetry while keeping an exactly bounded, smooth signed height.
    const signed = .8 * Math.cos(u * Math.PI * 4) * Math.cos(v * Math.PI * 6)
      + .2 * Math.cos((u - v) * Math.PI * 2);
    const value = Math.round(128 + signed * (signed >= 0 ? 127 : 128));
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  return { width: size, height: size, data };
}
