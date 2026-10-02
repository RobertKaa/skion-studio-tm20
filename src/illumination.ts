import { ILLUM_ROLES, type IllumRole } from './maps';
import type { PixelSource } from './three/decalProjection';

export interface ImageLight { role: IllumRole; strength: number }

/** Original DDS alpha values, run-length encoded independently of image opacity. */
export interface IllumCodes { width: number; height: number; runs: number[] }

export function encodeIllumCodes(width: number, height: number, codes: Uint8Array): IllumCodes {
  const runs: number[] = [];
  for (let start = 0; start < codes.length;) {
    let end = start + 1;
    while (end < codes.length && codes[end] === codes[start]) end++;
    runs.push(end - start, codes[start]); start = end;
  }
  return { width, height, runs };
}

export function validIllumCodes(value: unknown): value is IllumCodes {
  if (!value || typeof value !== 'object') return false;
  const c = value as IllumCodes;
  if (!Number.isInteger(c.width) || !Number.isInteger(c.height) || c.width < 1 || c.height < 1 || c.width > 1024 || c.height > 1024 || !Array.isArray(c.runs) || c.runs.length % 2 || c.runs.length > c.width * c.height * 2) return false;
  let pixels = 0;
  for (let i = 0; i < c.runs.length; i += 2) {
    if (!Number.isInteger(c.runs[i]) || c.runs[i] < 1 || !Number.isInteger(c.runs[i + 1]) || c.runs[i + 1] < 0 || c.runs[i + 1] > 255) return false;
    pixels += c.runs[i]; if (pixels > c.width * c.height) return false;
  }
  return pixels === c.width * c.height;
}

export function decodeIllumCodes(codes: IllumCodes): Uint8Array {
  if (!validIllumCodes(codes)) throw new Error('Masque de comportement lumineux invalide.');
  const result = new Uint8Array(codes.width * codes.height); let offset = 0;
  for (let i = 0; i < codes.runs.length; i += 2) { result.fill(codes.runs[i + 1], offset, offset + codes.runs[i]); offset += codes.runs[i]; }
  return result;
}

/** Decode before Canvas premultiplies alpha: alpha zero is a light role, never transparency. */
export function importLightPixels(source: PixelSource, size: number): { pixels: PixelSource; codes: Uint8Array } {
  const data = new Uint8ClampedArray(size * size * 4); const codes = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * size + x; const s = (Math.min(source.height - 1, Math.floor((y + .5) * source.height / size)) * source.width + Math.min(source.width - 1, Math.floor((x + .5) * source.width / size))) * 4;
    data.set(source.data.subarray(s, s + 3), p * 4); data[p * 4 + 3] = 255; codes[p] = source.data[s + 3];
  }
  return { pixels: { width: size, height: size, data }, codes };
}

/** L'émission garde les couleurs et la transparence du logo, sans modifier son original. */
export function imageLightBitmap(source: PixelSource, strength: number): Uint8ClampedArray {
  const amount = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  const data = new Uint8ClampedArray(source.data);
  for (let i = 0; i < data.length; i += 4) for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round(data[i + channel] * amount);
  return data;
}

export const roleAlpha = (role: IllumRole) => ILLUM_ROLES.find((item) => item.id === role)?.alpha ?? 255;

export function roleFromAlpha(alpha: number): IllumRole {
  return alpha < 53 ? 'brake' : alpha < 179 ? 'head' : 'always';
}

/** The speed display is independent of headlight and brake simulations. */
export function lightIsOn(role: IllumRole, night: boolean, braking: boolean, speed = false): boolean {
  return speed || role === 'always' || (role === 'head' ? night : braking);
}
