import assert from 'node:assert/strict';
import type { ReliefGeometry } from '../src/relief/types';
import { createWheelTreadPattern, type TreadPoint } from '../src/wheelTreadPatterns';
import { TYRE_CIRCUMFERENCE, TYRE_TREAD_WIDTH } from '../src/wheelTreadRaster';
import { WHEEL_TREAD_DEPTH_MM, WHEEL_TREAD_UV } from '../src/wheelTreads';

/** Signed distance to the actual authored polygon union, in physical metres. */
function polygonDistance(x: number, y: number, polygon: readonly TreadPoint[]): number {
  let inside = false, distance = Infinity;
  for (let i = 0, previous = polygon.length - 1; i < polygon.length; previous = i++) {
    const [ax, ay] = polygon[previous], [bx, by] = polygon[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return inside ? distance : -distance;
}

/** A coarse height grid can have deep grooves while still melting every edge.
 * Require coincident crown/wall and floor/wall vertices at the real mould lines,
 * with independently oriented native normals on the two sides of each crease. */
export function assertNativeTreadEdges(mode: 'gravel' | 'mud', geometry: Pick<ReliefGeometry, 'positions' | 'normals' | 'uv' | 'indices' | 'bindings'>,
  positions: ArrayLike<number>, normals: ArrayLike<number>, strength = 1): { crownEdges: number; floorEdges: number } {
  const blocks = createWheelTreadPattern(mode).blocks!;
  const bounds = blocks.map(block => ({ points: block.points, minY: Math.min(...block.points.map(p => p[1])), maxY: Math.max(...block.points.map(p => p[1])) }));
  const used = new Set(geometry.indices), crown = new Map<string, number[]>(), floor = new Map<string, number[]>();
  for (let i = 0; i < geometry.positions.length / 3; i++) {
    if (!used.has(i)) continue;
    const across = (geometry.uv[i * 2] - WHEEL_TREAD_UV.minU) / (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU);
    if (across <= .015 || across >= .985) continue;
    const x = across * TYRE_TREAD_WIDTH, y = ((1 - geometry.uv[i * 2 + 1]) % 1 + 1) % 1 * TYRE_CIRCUMFERENCE;
    let signed = -Infinity;
    for (const shift of [-TYRE_CIRCUMFERENCE, 0, TYRE_CIRCUMFERENCE]) for (const block of bounds) {
      const py = y + shift;
      if (py < block.minY - .003 || py > block.maxY + .003) continue;
      signed = Math.max(signed, polygonDistance(x, py, block.points));
    }
    const radial = geometry.normals.slice(i * 3, i * 3 + 3), radialLength = Math.hypot(...radial);
    const height = radial.reduce((sum, n, axis) => sum + (positions[i * 3 + axis] - geometry.positions[i * 3 + axis]) * n / radialLength, 0);
    const isCrown = Math.abs(signed - .002) <= .00012 && Math.abs(height) <= .00010;
    const isFloor = Math.abs(signed) <= .00012 && height <= -WHEEL_TREAD_DEPTH_MM[mode] / 1000 * strength * .9;
    if (!isCrown && !isFloor) continue;
    const normal = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]], length = Math.hypot(...normal);
    const dot = radial.reduce((sum, n, axis) => sum + n / radialLength * normal[axis] / length, 0);
    const key = `${geometry.bindings?.[i] ?? 0}:${[...geometry.positions.slice(i * 3, i * 3 + 3), ...geometry.uv.slice(i * 2, i * 2 + 2)].map(n => Math.round(n * 1e6)).join(',')}`;
    const groups = isCrown ? crown : floor, group = groups.get(key) ?? []; group.push(dot); groups.set(key, group);
  }
  const sharp = (groups: Map<string, number[]>) => [...groups.values()].filter(dots => Math.max(...dots) > .998 && Math.min(...dots) < .98 && Math.min(...dots) > 0).length;
  const crownEdges = sharp(crown), floorEdges = sharp(floor);
  assert(crownEdges > 150, `${mode}: many real 2 mm crown edges keep separate radial tops and tilted walls (${crownEdges})`);
  assert(floorEdges > 150, `${mode}: groove floors keep their own radial normals at the wall junction (${floorEdges})`);
  return { crownEdges, floorEdges };
}
