import type { PixelSource } from './three/decalProjection';

/** Simplified colour overlay for the editor; the game controls the actual dirt shader. */
export function previewDirtPixels(base: PixelSource, mask: PixelSource, amount: number): Uint8ClampedArray {
  const strength = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
  const result = new Uint8ClampedArray(base.data);
  const dirt = [152, 96, 55];
  for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
    const i = (y * base.width + x) * 4;
    const m = (Math.min(mask.height - 1, Math.floor((y + .5) * mask.height / base.height)) * mask.width +
      Math.min(mask.width - 1, Math.floor((x + .5) * mask.width / base.width))) * 4;
    const opacity = strength * mask.data[m] / 255;
    for (let c = 0; c < 3; c++) result[i + c] = Math.round(base.data[i + c] * (1 - opacity) + dirt[c] * opacity);
  }
  return result;
}
