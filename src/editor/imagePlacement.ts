import { UV_GUIDE_ISLANDS, type UvGuideFamily } from '../uvGuideData';

function insidePolygon(points: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** UV de Three.js : origine en bas. Les guides et Fabric ont leur origine en haut. */
export function imageIslandAt(family: UvGuideFamily, u: number, v: number): string | undefined {
  const y = 1 - v;
  return UV_GUIDE_ISLANDS.find((island) => island.family === family && island.polygons.some((points) => insidePolygon(points, u, y)))?.key;
}

/** Distance du centre aux bords de sa pièce ; -1 s'il est hors du masque. */
export function imageIslandClearance(family: UvGuideFamily, key: string, u: number, v: number): number {
  const island = UV_GUIDE_ISLANDS.find((entry) => entry.family === family && entry.key === key);
  const y = 1 - v;
  let clearance = -1;
  for (const points of island?.polygons ?? []) {
    if (!insidePolygon(points, u, y)) continue;
    let nearest = Infinity;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i]; const b = points[j];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((u - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      nearest = Math.min(nearest, Math.hypot(u - a.x - t * dx, y - a.y - t * dy));
    }
    clearance = Math.max(clearance, nearest);
  }
  return clearance;
}

export function continuousImageUV(previous: { u: number; v: number }, next: { u: number; v: number }): boolean {
  return Number.isFinite(next.u) && Number.isFinite(next.v) &&
    Math.hypot(next.u - previous.u, next.v - previous.v) <= 0.12;
}
