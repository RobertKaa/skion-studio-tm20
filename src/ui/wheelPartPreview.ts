import type { ProjectionTriangle } from '../three/decalProjection';
import { getWheelCoordinates } from '../materials/wheelCoordinates';
import type { UvPartEntry } from '../uvParts';

/** Show a real sidewall as a ring, and the tread as a physical strip. Source
 * texels stay in the game's UV atlas; only this thumbnail is unfolded. */
export function drawWheelPart(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement, part: UvPartEntry, geometry: readonly ProjectionTriangle[]): boolean {
  if (!/^tyres:(tread|inner|outer)$/.test(part.parent.key)) return false;
  let coordinates: ReturnType<typeof getWheelCoordinates>;
  const tread = part.parent.key === 'tyres:tread';
  try { coordinates = getWheelCoordinates(geometry, !tread); } catch { return false; }
  const triangles: { from: number[][]; to: number[][] }[] = [], used = new Set<string>();
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  let left=Infinity,right=-Infinity;
  for(const t of geometry)if(t.family==='wheels')for(const p of t.points){left=Math.min(left,p[0]);right=Math.max(right,p[0]);}
  const centerX=(left+right)/2;
  geometry.forEach((t, f) => {
    if (t.family !== 'wheels') return;
    // Axle-bound helper faces in the native preview are not tyre sidewalls.
    if(t.points.some(p=>Math.abs(p[0]-centerX)<(right-left)*.18))return;
    const u = t.uv.reduce((sum, uv) => sum + uv[0], 0) / 3;
    if (u < part.bounds.x - 1e-6 || u > part.bounds.x + part.bounds.w + 1e-6) return;
    const key = t.uv.map(p => p.map(v => Math.round(v * 1e6)).join(':')).sort().join('/');
    if (used.has(key)) return; used.add(key);
    const to = t.uv.map((_, c) => {
      const node = coordinates.triangleNodes[f * 3 + c];
      const x = tread ? coordinates.longitudinal[node] : coordinates.transverse[node];
      const y = tread ? coordinates.transverse[node] : coordinates.longitudinal[node];
      min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); return [x, y];
    });
    triangles.push({ from: t.uv.map(([u, v]) => [u * texture.width, (1 - v) * texture.height]), to });
  });
  if (!triangles.length || max[0] <= min[0] || max[1] <= min[1]) return false;
  const { width, height } = ctx.canvas, scale = Math.min((width - 16) / (max[0] - min[0]), (height - 16) / (max[1] - min[1]));
  const ox = (width - (max[0] - min[0]) * scale) / 2, oy = (height - (max[1] - min[1]) * scale) / 2;
  ctx.clearRect(0, 0, width, height);
  for (const triangle of triangles) {
    const [p, q, r] = triangle.from, to = triangle.to.map(p => [(p[0] - min[0]) * scale + ox, (p[1] - min[1]) * scale + oy]);
    const det = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]); if (Math.abs(det) < 1e-9) continue;
    const d = [0, 1].map(axis => {
      const a = ((to[1][axis] - to[0][axis]) * (r[1] - p[1]) - (to[2][axis] - to[0][axis]) * (q[1] - p[1])) / det;
      const b = ((to[2][axis] - to[0][axis]) * (q[0] - p[0]) - (to[1][axis] - to[0][axis]) * (r[0] - p[0])) / det;
      return [a, b, to[0][axis] - a * p[0] - b * p[1]];
    });
    ctx.save(); ctx.beginPath(); ctx.moveTo(...to[0] as [number, number]); ctx.lineTo(...to[1] as [number, number]); ctx.lineTo(...to[2] as [number, number]); ctx.closePath(); ctx.clip();
    ctx.setTransform(d[0][0], d[1][0], d[0][1], d[1][1], d[0][2], d[1][2]); ctx.drawImage(texture, 0, 0); ctx.restore();
  }
  return true;
}
