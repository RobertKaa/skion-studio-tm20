import type { RGBAImage } from '../dds';

/** A bounded display aid; the editable texture and normal atlas are never changed. */
export const WHEEL_RELIEF_OVERLAY_MAX_SIZE = 2048;

function writeShading(data: Uint8ClampedArray, i: number, nx: number, ny: number, nz: number) {
  // Image Y runs downwards; the light comes from the upper left of the atlas.
  const shade = Math.max(-1, Math.min(1, (-.55 * nx - .55 * ny + .63 * nz) / 127));
  const color = shade > 0 ? 255 : 0;
  data[i] = data[i + 1] = data[i + 2] = color;
  // Ignore BC5's one-unit neutral quantisation noise rather than adding haze.
  data[i + 3] = Math.abs(shade) < .012 ? 0 : Math.round(Math.abs(shade) * 145);
}

/**
 * Shade tangent normals with a neutral oblique light. A flat surface is fully
 * transparent, so this reveals grooves and sidewall moulding without tinting
 * the paint. The complete UV domain is retained, including imported sidewalls.
 */
export function createWheelReliefOverlay(normal: RGBAImage): RGBAImage {
  const scale = Math.min(1, WHEEL_RELIEF_OVERLAY_MAX_SIZE / Math.max(normal.width, normal.height));
  const width = Math.max(1, Math.floor(normal.width * scale));
  const height = Math.max(1, Math.floor(normal.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  // Native and preset atlases need no resampling. Avoid per-pixel UV/division
  // work on this frequent path, especially while changing relief strength.
  if (width === normal.width && height === normal.height) {
    for (let i = 0; i < data.length; i += 4) {
      writeShading(data, i, normal.data[i] - 128, normal.data[i + 1] - 128, normal.data[i + 2] - 255);
    }
    return { width, height, data };
  }
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * normal.height / height), y1 = Math.floor((y + 1) * normal.height / height);
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * normal.width / width), x1 = Math.floor((x + 1) * normal.width / width);
      let nx = 0, ny = 0, nz = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * normal.width + sx) * 4;
        nx += normal.data[i] - 128;
        ny += normal.data[i + 1] - 128;
        nz += normal.data[i + 2] - 255;
      }
      const samples = (x1 - x0) * (y1 - y0);
      writeShading(data, (y * width + x) * 4, nx / samples, ny / samples, nz / samples);
    }
  }
  return { width, height, data };
}
