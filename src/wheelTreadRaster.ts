import type { TreadPattern, TreadPoint } from './wheelTreadPatterns';

export const TYRE_TREAD_WIDTH = .283;
export const TYRE_CIRCUMFERENCE = 2.289;

export interface TreadRasterGrid {
  width: number; height: number;
  minX: number; minY: number;
  stepX: number; stepY: number;
}

function smooth(lo: number, hi: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Rasterize physical mould contours, rather than joining repeated square UV slots. */
export function rasterizeTread(pattern: TreadPattern, grid: TreadRasterGrid): Float32Array {
  const { width, height, minX, minY, stepX, stepY } = grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 9 * 1024 * 1024
    || ![minX, minY, stepX, stepY, pattern.depth].every(Number.isFinite) || stepX <= 0 || stepY <= 0 || stepX > TYRE_TREAD_WIDTH || stepY > TYRE_CIRCUMFERENCE
    || Math.abs(minX) > TYRE_TREAD_WIDTH * 2 || Math.abs(minY) > TYRE_CIRCUMFERENCE * 2 || pattern.depth <= 0 || pattern.depth > .025
    || pattern.strokes.length > 20000 || (pattern.blocks?.length ?? 0) > 4000) throw new Error('Sculpture de pneu invalide ou trop volumineuse.');
  const validPoints = (points: readonly TreadPoint[], minimum: number) => Array.isArray(points) && points.length >= minimum && points.length <= 2048
    && points.every(point => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
      && point[0] >= -TYRE_TREAD_WIDTH && point[0] <= 2 * TYRE_TREAD_WIDTH && point[1] >= -TYRE_CIRCUMFERENCE && point[1] <= 2 * TYRE_CIRCUMFERENCE);
  if (pattern.strokes.some(stroke => !validPoints(stroke.points, 2) || !Number.isFinite(stroke.width) || stroke.width <= 0 || stroke.width > .04
    || !Number.isFinite(stroke.depth) || stroke.depth < 0 || stroke.depth > .025
    || stroke.endWidth !== undefined && (!Number.isFinite(stroke.endWidth) || stroke.endWidth < 0 || stroke.endWidth > .04)
    || stroke.bevel !== undefined && (!Number.isFinite(stroke.bevel) || stroke.bevel <= 0 || stroke.bevel > .005))
    || pattern.blocks?.some(block => !validPoints(block.points, 3) || block.points.length > 32
      || block.bevel !== undefined && (!Number.isFinite(block.bevel) || block.bevel <= 0 || block.bevel > .005))) throw new Error('Contours de sculpture invalides.');
  const values = new Float32Array(width * height);
  let work = 0;
  const account = (left: number, right: number, top: number, bottom: number, edges = 1) => {
    work += Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1) * edges;
    if (work > 250_000_000) throw new Error('La sculpture de pneu dépasse le budget de calcul.');
  };
  const antialias = Math.min(stepX, stepY) * .3;
  const maxY = minY + (height - 1) * stepY;
  const bounds = (points: readonly TreadPoint[], margin: number, shift: number) => {
    let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
    for (const [x, y] of points) { loX = Math.min(loX, x); hiX = Math.max(hiX, x); loY = Math.min(loY, y + shift); hiY = Math.max(hiY, y + shift); }
    return [Math.max(0, Math.floor((loX - margin - minX) / stepX)), Math.min(width - 1, Math.ceil((hiX + margin - minX) / stepX)),
      Math.max(0, Math.floor((loY - margin - minY) / stepY)), Math.min(height - 1, Math.ceil((hiY + margin - minY) / stepY))];
  };
  const shifts = (points: readonly TreadPoint[], margin: number) => {
    let low = Infinity, high = -Infinity;
    for (const point of points) { low = Math.min(low, point[1]); high = Math.max(high, point[1]); }
    const start = Math.ceil((minY - margin - high) / TYRE_CIRCUMFERENCE), end = Math.floor((maxY + margin - low) / TYRE_CIRCUMFERENCE);
    const result: number[] = [];
    for (let repeat = start; repeat <= end; repeat++) result.push(repeat * TYRE_CIRCUMFERENCE);
    return result;
  };
  const segmentDistanceSquared = (x: number, y: number, a: TreadPoint, b: TreadPoint, shift: number) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1] - shift) * dy) / length)) : 0;
    return (x - a[0] - t * dx) ** 2 + (y - a[1] - shift - t * dy) ** 2;
  };
  if (pattern.blocks?.length) {
    values.fill(-pattern.depth);
    for (const block of pattern.blocks) {
      const bevel = block.bevel ?? .00065, points = block.points;
      for (const shift of shifts(points, antialias)) {
        const [left, right, top, bottom] = bounds(points, antialias, shift);
        account(left, right, top, bottom, points.length);
        for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
          const x = minX + column * stepX, y = minY + row * stepY;
          let inside = false, distanceSquared = Infinity;
          for (let i = 0, previous = points.length - 1; i < points.length; previous = i++) {
            const a = points[previous], b = points[i], ay = a[1] + shift, by = b[1] + shift;
            if ((ay > y) !== (by > y) && x < (b[0] - a[0]) * (y - ay) / (by - ay) + a[0]) inside = !inside;
            distanceSquared = Math.min(distanceSquared, segmentDistanceSquared(x, y, a, b, shift));
          }
          const distance = Math.sqrt(distanceSquared) * (inside ? 1 : -1);
          const h = -pattern.depth * (1 - smooth(-antialias, bevel, distance));
          const index = row * width + column;
          values[index] = Math.max(values[index], h);
        }
      }
    }
  }
  for (const stroke of pattern.strokes) {
    const points = stroke.points, lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; const length = Math.hypot(b[0] - a[0], b[1] - a[1]); lengths.push(length); total += length; }
    if (!total) continue;
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = lengths[i - 1];
      if (!length) continue;
      const startWidth = stroke.width + ((stroke.endWidth ?? stroke.width) - stroke.width) * travelled / total;
      travelled += length;
      const endWidth = stroke.width + ((stroke.endWidth ?? stroke.width) - stroke.width) * travelled / total;
      const margin = Math.max(startWidth, endWidth) / 2 + antialias;
      for (const shift of shifts([a, b], margin)) {
        const [left, right, top, bottom] = bounds([a, b], margin, shift);
        account(left, right, top, bottom);
        for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
          const x = minX + column * stepX, y = minY + row * stepY;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1] - shift) * dy) / (length * length)));
          const halfWidth = (startWidth + (endWidth - startWidth) * t) / 2;
          if (halfWidth <= 0) continue;
          const distance = Math.hypot(x - a[0] - t * dx, y - a[1] - shift - t * dy);
          // A thin sipe keeps a thin wall. A fixed millimetre bevel used to inflate every cut.
          const bevel = Math.max(.00008, Math.min(stroke.bevel ?? .00055, halfWidth * .35));
          const h = -stroke.depth * smooth(-antialias, bevel, halfWidth - distance);
          const index = row * width + column;
          values[index] = Math.min(values[index], h);
        }
      }
    }
  }
  for (let column = 0; column < width; column++) {
    const x = minX + column * stepX, shoulder = smooth(0, .0035, Math.min(x, TYRE_TREAD_WIDTH - x));
    if (shoulder === 1) continue;
    for (let row = 0; row < height; row++) values[row * width + column] *= shoulder;
  }
  return values;
}
