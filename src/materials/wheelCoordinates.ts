import type { ProjectionTriangle, Vec3 } from '../three/decalProjection';
import type { SurfaceCoordinates } from './surfaceCoordinates';

export interface WheelCoordinates extends SurfaceCoordinates { circumference: number }
const cache = new WeakMap<readonly ProjectionTriangle[], { wrap: WheelCoordinates; face: WheelCoordinates }>();
const TAU = Math.PI * 2;
const fail = () => { throw new Error('Les roues de ce modèle ne permettent pas cet enroulement. Choisissez une projection depuis une vue.'); };
const keyOf = (u: number, v: number) => `${Math.round(u * 1e6)}:${Math.round(v * 1e6)}`;
type Sample = { p: Vec3; u: number; v: number; r: number; x: number };

/** A tyre has its own meridian and circumference. A body-wide cloth chart
 * cannot flatten a complete revolution and collapses at the axle. Derive the
 * metric from each wheel, then share coordinates where the game shares UVs. */
export function getWheelCoordinates(geometry: readonly ProjectionTriangle[], face = false): WheelCoordinates {
  const saved = cache.get(geometry); if (saved) return face ? saved.face : saved.wrap;
  if (!geometry.length || geometry.length > 500_000) return fail();
  const wheels = geometry.filter(t => t.family === 'wheels'); if (!wheels.length) return fail();
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (const t of wheels) for (const p of t.points) for (let a = 0; a < 3; a++) {
    if (!Number.isFinite(p[a]) || Math.abs(p[a]) > 1e6) return fail();
    low[a] = Math.min(low[a], p[a]); high[a] = Math.max(high[a], p[a]);
  }
  const mid = low.map((v, i) => (v + high[i]) / 2);
  const groups = new Map<number, ProjectionTriangle[]>();
  for (const t of wheels) {
    const x = t.points.reduce((s, p) => s + p[0], 0) / 3, z = t.points.reduce((s, p) => s + p[2], 0) / 3;
    const id = (x > mid[0] ? 1 : 0) + (z > mid[2] ? 2 : 0), group = groups.get(id) ?? [];
    group.push(t); groups.set(id, group);
  }
  const shared = new Map<string, { u: number; turn: number; radius: number; count: number; core:boolean }>();
  let period = 0, frames = 0;
  for (const group of groups.values()) {
    const bounds = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const t of group) for (const p of t.points) for (let a = 0; a < 3; a++) {
      bounds[0][a] = Math.min(bounds[0][a], p[a]); bounds[1][a] = Math.max(bounds[1][a], p[a]);
    }
    const center = bounds[0].map((v, i) => (v + bounds[1][i]) / 2);
    const dy=bounds[1][1]-bounds[0][1],dz=bounds[1][2]-bounds[0][2];
    // Native GBX previews also contain a few wheel-bound helper faces close
    // to the axle. They must not turn a tyre's width into half the car width.
    const xs=group.flatMap(t=>t.points.map(p=>p[0])).sort((a,b)=>a-b),left=xs[Math.floor(xs.length*.05)],right=xs[Math.floor(xs.length*.95)];
    if (dy < 1e-6 || dz < 1e-6 || dy/dz<.7 || dy/dz>1.3 || right-left>Math.min(dy,dz)*.9) return fail();
    const samples = new Map<string, Sample>();
    for (const t of group) {
      for (let c = 0; c < 3; c++) {
        const p = t.points[c], [u, v] = (t.sourceUv??t.uv)[c];
        if (!Number.isFinite(u) || !Number.isFinite(v) || Math.abs(u) > 4 || Math.abs(v) > 4) return fail();
        const k = `${keyOf(u, v)}:${p.map(n => Math.round(n * 1e6)).join(':')}`;
        samples.set(k, { p, u, v, r: Math.hypot(p[1] - center[1], p[2] - center[2]), x: (p[0] - center[0]) * (center[0] >= mid[0] ? 1 : -1) });
        if(samples.size>200_000)return fail();
      }
    }
    const rows = [...samples.values()];
    const profile = new Map<number, { u: number; x: number; r: number; count: number }>();
    for (const s of rows) {
      if(s.p[0]<left-dy*.05||s.p[0]>right+dy*.05)continue;
      const bin = Math.round(s.u * 2048), row = profile.get(bin) ?? { u: 0, x: 0, r: 0, count: 0 };
      row.u += s.u; row.x += s.x; row.r += s.r; row.count++; profile.set(bin, row);
    }
    const maxCount = Math.max(...[...profile.values()].map(p => p.count));
    // Moulded lettering has its own tiny UV offsets; it must not inflate the
    // length of the tyre profile. The structural rings carry the meridian.
    const rings = [...profile.values()].filter(p => p.count >= Math.max(2, maxCount * .15))
      .map(p => ({ u: p.u / p.count, x: p.x / p.count, r: p.r / p.count, arc: 0 })).sort((a, b) => a.u - b.u);
    if (rings.length < 3) return fail();
    for (let i = 1; i < rings.length; i++) rings[i].arc = rings[i - 1].arc + Math.hypot(rings[i].x - rings[i - 1].x, rings[i].r - rings[i - 1].r);
    const length = rings.at(-1)!.arc, radius = Math.max(...rings.map(p => p.r));
    if (length < 1e-6 || radius < 1e-6) return fail();
    period += TAU * radius; frames++;
    for (const s of rows) {
      let i = 1; while (i < rings.length - 1 && rings[i].u < s.u) i++;
      const a = rings[i - 1], b = rings[i], t = Math.max(0, Math.min(1, (s.u - a.u) / Math.max(1e-10, b.u - a.u)));
      // V already supplies a coherent revolution shared by the four wheels.
      // Re-averaging world angles across mirrored wheel phases folds the
      // native chart in half. Keep its turn, and replace its square metric.
      let turn = s.v;
      if (Math.abs(s.v) < 1e-5) turn = 0;
      if (Math.abs(s.v - 1) < 1e-5) turn = 1;
      const core=s.p[0]>=left-dy*.05&&s.p[0]<=right+dy*.05,key=keyOf(s.u,s.v),previous=shared.get(key);
      if(previous?.core&&!core)continue;
      const old=previous&&(!core||previous.core)?previous:{u:0,turn:0,radius:0,count:0,core};
      old.u += a.arc + (b.arc - a.arc) * t - length / 2; old.turn += turn; old.radius += s.r; old.count++; shared.set(key, old);
      if(shared.size>200_000)return fail();
    }
  }
  const circumference = period / frames, triangleNodes = new Uint32Array(geometry.length * 3), ids = new Map<string, number>();
  const wrapU: number[] = [], wrapV: number[] = [], faceU: number[] = [], faceV: number[] = [];
  geometry.forEach((t, index) => (t.sourceUv??t.uv).forEach(([u, v], c) => {
    if (t.family !== 'wheels') return;
    const key = keyOf(u, v); let id = ids.get(key);
    if (id === undefined) {
      const s = shared.get(key); if (!s) return fail();
      id = ids.size; ids.set(key, id);
      const turn = s.turn / s.count, angle = turn * TAU, r = s.radius / s.count;
      wrapU.push(s.u / s.count); wrapV.push((.5 - turn) * circumference);
      faceU.push(r * Math.cos(angle)); faceV.push(r * Math.sin(angle));
    }
    triangleNodes[index * 3 + c] = id;
  }));
  const make = (u: number[], v: number[]): WheelCoordinates => ({ triangleNodes, transverse: Float64Array.from(u), longitudinal: Float64Array.from(v),
    min: [u.reduce((a,b)=>Math.min(a,b),Infinity), v.reduce((a,b)=>Math.min(a,b),Infinity)], max: [u.reduce((a,b)=>Math.max(a,b),-Infinity), v.reduce((a,b)=>Math.max(a,b),-Infinity)], circumference });
  const result = { wrap: make(wrapU, wrapV), face: make(faceU, faceV) }; cache.set(geometry, result); return face ? result.face : result.wrap;
}
