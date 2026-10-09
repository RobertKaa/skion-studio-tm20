/** Continuous livery projection from the car frame to the real Stadium UVs.
 * Side: x=longitudinal (0 nose, 1 rear), y=height (0 floor, 1 roof).
 * Top: x=lateral (-1 right, +1 left), y=longitudinal (0 nose, 1 rear).
 * The geometry contains the connected outer body and intake shells, never
 * wheels, intake bezels, accessories or the underside. No named UV rectangle
 * is used to establish continuity between separate texture islands.
 */
import {
  GENERATOR_SURFACE_MIN, GENERATOR_SURFACE_MAX, GENERATOR_SURFACE_PACKED,
  GENERATOR_SURFACE_VERTEX_COUNT, GENERATOR_SURFACE_TRIANGLE_COUNT,
} from './generatorSurfaceData';

export type SurfacePoint = { x: number; y: number } | readonly [number, number];
export interface SurfaceUVPoint { x: number; y: number }
export interface SurfaceProjectionOptions {
  plane: 'side' | 'top';
  side?: 'left' | 'right' | 'both';
  /** With bounds, input artwork uses 0..1 locally; this rectangle is in the
   * canonical side/top frame above. Without bounds, input is already canonical. */
  bounds?: { x: number; y: number; w: number; h: number };
}

export const GENERATOR_SURFACE_BOUNDS = {
  front: GENERATOR_SURFACE_MAX[2], rear: GENERATOR_SURFACE_MIN[2],
  bottom: GENERATOR_SURFACE_MIN[1], roof: GENERATOR_SURFACE_MAX[1],
  halfWidth: GENERATOR_SURFACE_MAX[0],
} as const;

interface SurfaceData {
  uv: Float64Array;
  side: Float64Array;
  top: Float64Array;
  indices: Uint16Array;
  masks: Uint8Array;
}
let decoded: SurfaceData | undefined;
const metrics = { calls: 0, fallbackMerges: 0, clippedParts: 0, contours: 0, points: 0, maxPoints: 0 };
export function getSurfaceProjectionMetrics() { return { ...metrics }; }
function data(): SurfaceData {
  if (decoded) return decoded;
  const bytes = Uint8Array.from(atob(GENERATOR_SURFACE_PACKED), (value) => value.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const uv = new Float64Array(GENERATOR_SURFACE_VERTEX_COUNT * 2);
  const side = new Float64Array(uv.length);
  const top = new Float64Array(uv.length);
  let offset = 0;
  for (let vertex = 0; vertex < GENERATOR_SURFACE_VERTEX_COUNT; vertex++) {
    const values: number[] = [];
    for (let field = 0; field < 5; field++) { values.push(view.getUint16(offset, true) / 65535); offset += 2; }
    const i = vertex * 2;
    uv[i] = values[0]; uv[i + 1] = values[1];
    side[i] = 1 - values[4]; side[i + 1] = values[3];
    top[i] = values[2] * 2 - 1; top[i + 1] = 1 - values[4];
  }
  const indices = new Uint16Array(GENERATOR_SURFACE_TRIANGLE_COUNT * 3);
  for (let i = 0; i < indices.length; i++) { indices[i] = view.getUint16(offset, true); offset += 2; }
  const masks = bytes.slice(offset);
  decoded = { uv, side, top, indices, masks };
  return decoded;
}

type Point = SurfaceUVPoint;
function area(poly: readonly Point[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return sum / 2;
}
function cross(a: Point, b: Point, c: Point): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

/** Sutherland-Hodgman clips an arbitrary simple, possibly concave subject
 * against a convex triangle. Disconnected pieces are joined by opposite
 * zero-area edges on the clipping boundary; contour extraction removes them.
 * This avoids triangulating every decorative flame/dragon into extra shapes. */
function clipTriangle(subject: readonly Point[], triangle: readonly Point[]): Point[] {
  let output = [...subject];
  const sign = cross(triangle[0], triangle[1], triangle[2]) >= 0 ? 1 : -1;
  for (let edge = 0; edge < 3 && output.length; edge++) {
    const a = triangle[edge], b = triangle[(edge + 1) % 3];
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    let previousDistance = cross(a, b, previous) * sign;
    for (const point of input) {
      const distance = cross(a, b, point) * sign;
      const inside = distance >= -1e-12, previousInside = previousDistance >= -1e-12;
      if (inside !== previousInside) {
        const t = previousDistance / (previousDistance - distance);
        output.push({ x: previous.x + (point.x - previous.x) * t, y: previous.y + (point.y - previous.y) * t });
      }
      if (inside) output.push(point);
      previous = point; previousDistance = distance;
    }
  }
  return output;
}

function clean(poly: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of poly) {
    const previous = result[result.length - 1];
    if (!previous || Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y) > 1e-10) result.push(point);
  }
  if (result.length > 1 && Math.abs(result[0].x - result[result.length - 1].x) + Math.abs(result[0].y - result[result.length - 1].y) < 1e-10) result.pop();
  return result;
}

function segmentDistanceSquared(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2;
}

/** A quarter working-resolution pixel keeps curved outlines while removing
 * hundreds of collinear tessellation points from editable, serialized paths. */
function simplifyClosed(polygon: Point[], tolerance: number): Point[] {
  if (polygon.length <= 3) return polygon;
  let opposite = 1, farthest = 0;
  for (let i = 1; i < polygon.length; i++) {
    const distance = (polygon[i].x - polygon[0].x) ** 2 + (polygon[i].y - polygon[0].y) ** 2;
    if (distance > farthest) { farthest = distance; opposite = i; }
  }
  const simplify = (points: Point[]) => {
    const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop()!;
      let split = -1, maximum = tolerance * tolerance;
      for (let i = start + 1; i < end; i++) {
        const distance = segmentDistanceSquared(points[i], points[start], points[end]);
        if (distance > maximum) { maximum = distance; split = i; }
      }
      if (split !== -1) { keep[split] = 1; stack.push([start, split], [split, end]); }
    }
    return points.filter((_, i) => keep[i]);
  };
  const first = simplify(polygon.slice(0, opposite + 1));
  const second = simplify([...polygon.slice(opposite), polygon[0]]);
  const result = [...first.slice(0, -1), ...second.slice(0, -1)];
  // Tiny contours still need three points to remain valid, and holes must
  // retain their winding; never replace either with a made-up triangle.
  return result.length >= 3 && area(result) * area(polygon) > 0 ? result : polygon;
}

/** Cancel shared tessellation edges: output only the actual UV artwork border.
 * One compound Canvas/Fabric path therefore has no antialiasing grid between
 * triangles. Opposite winding is retained for holes inside a contour. Edge
 * multiplicity matters on folded or overlapping UV faces: deduplication would
 * unbalance an otherwise closed boundary and force a huge triangle fallback. */
function contours(polygons: readonly Point[][]): Point[][] {
  interface Edge { a: string; b: string; count: number }
  const points = new Map<string, Point>();
  const edges = new Map<string, Edge>();
  const keyOf = (point: Point) => {
    const x = Math.round(point.x * 1e7), y = Math.round(point.y * 1e7);
    const key = `${x},${y}`;
    if (!points.has(key)) points.set(key, { x: x / 1e7, y: y / 1e7 });
    return key;
  };
  for (const polygon of polygons) {
    const poly = area(polygon) < 0 ? [...polygon].reverse() : polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = keyOf(poly[i]), b = keyOf(poly[(i + 1) % poly.length]);
      if (a === b) continue;
      const forward = `${a}>${b}`, reverse = `${b}>${a}`;
      const opposite = edges.get(reverse);
      if (opposite) {
        if (--opposite.count === 0) edges.delete(reverse);
      } else {
        const existing = edges.get(forward);
        if (existing) existing.count++;
        else edges.set(forward, { a, b, count: 1 });
      }
    }
  }
  const outgoing = new Map<string, Set<string>>();
  for (const [key, edge] of edges) {
    let list = outgoing.get(edge.a);
    if (!list) { list = new Set(); outgoing.set(edge.a, list); }
    list.add(key);
  }
  const output: Point[][] = [];
  while (edges.size) {
    const firstKey = edges.keys().next().value!;
    const first = edges.get(firstKey)!;
    const polygon: Point[] = [];
    let key: string | undefined = firstKey;
    let closed = false;
    while (key) {
      const edge: Edge = edges.get(key)!;
      polygon.push(points.get(edge.a)!);
      if (--edge.count === 0) { edges.delete(key); outgoing.get(edge.a)!.delete(key); }
      if (edge.b === first.a) { closed = true; break; }
      key = outgoing.get(edge.b)?.values().next().value;
    }
    // A numerical mismatch should retain exact tessellation instead of making
    // up a closing diagonal and silently dropping a section of the design.
    if (!closed) {
      metrics.fallbackMerges++;
      return polygons.map((polygon) => clean(polygon));
    }
    const cleaned = simplifyClosed(clean(polygon), .25 / 2048);
    if (cleaned.length >= 3 && Math.abs(area(cleaned)) > 1e-11) output.push(cleaned);
  }
  return output;
}

export function projectSurfacePolygons(
  polygons: readonly (readonly SurfacePoint[])[],
  options: SurfaceProjectionOptions,
): SurfaceUVPoint[][] {
  if (options.plane !== 'side' && options.plane !== 'top') return [];
  metrics.calls++;
  const surface = data();
  const coordinates = options.plane === 'side' ? surface.side : surface.top;
  const mask = options.plane === 'top' ? 4 : options.side === 'left' ? 1 : options.side === 'right' ? 2 : 3;
  const bounds = options.bounds;
  if (bounds && (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) || bounds.w <= 0 || bounds.h <= 0)) return [];
  const result: Point[][] = [];
  for (const source of polygons) {
    if (source.length < 3 || source.length > 1024) continue;
    const artwork = clean(source.map((point) => {
      const x = Array.isArray(point) ? point[0] : (point as Point).x;
      const y = Array.isArray(point) ? point[1] : (point as Point).y;
      return bounds ? { x: bounds.x + x * bounds.w, y: bounds.y + y * bounds.h } : { x, y };
    }));
    if (artwork.length < 3 || artwork.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) || Math.abs(area(artwork)) < 1e-12) continue;
    const minX = Math.min(...artwork.map((point) => point.x)), maxX = Math.max(...artwork.map((point) => point.x));
    const minY = Math.min(...artwork.map((point) => point.y)), maxY = Math.max(...artwork.map((point) => point.y));
    const parts: Point[][] = [];
    for (let t = 0; t < surface.masks.length; t++) {
      if (!(surface.masks[t] & mask)) continue;
      const ids = [surface.indices[t * 3], surface.indices[t * 3 + 1], surface.indices[t * 3 + 2]];
      const projected = ids.map((id) => ({ x: coordinates[id * 2], y: coordinates[id * 2 + 1] }));
      if (Math.max(...projected.map((point) => point.x)) < minX || Math.min(...projected.map((point) => point.x)) > maxX ||
          Math.max(...projected.map((point) => point.y)) < minY || Math.min(...projected.map((point) => point.y)) > maxY) continue;
      const denominator = cross(projected[0], projected[1], projected[2]);
      if (Math.abs(denominator) < 1e-12) continue;
      const clipped = clean(clipTriangle(artwork, projected));
      if (clipped.length < 3 || Math.abs(area(clipped)) < 1e-12) continue;
      const mapped = clipped.map((point) => {
        const b = cross(projected[0], point, projected[2]) / denominator;
        const c = cross(projected[0], projected[1], point) / denominator;
        const a = 1 - b - c;
        return {
          x: surface.uv[ids[0] * 2] * a + surface.uv[ids[1] * 2] * b + surface.uv[ids[2] * 2] * c,
          y: surface.uv[ids[0] * 2 + 1] * a + surface.uv[ids[1] * 2 + 1] * b + surface.uv[ids[2] * 2 + 1] * c,
        };
      });
      parts.push(mapped);
    }
    metrics.clippedParts += parts.length;
    result.push(...contours(parts));
  }
  const pointCount = result.reduce((sum, polygon) => sum + polygon.length, 0);
  metrics.contours += result.length; metrics.points += pointCount; metrics.maxPoints = Math.max(metrics.maxPoints, pointCount);
  return result;
}
