/**
 * Génère un GUIDE UV PRÉCIS des DÉTAILS (mesh « Details_01 » du Stadium Car
 * TM2020), sur le même principe que scripts/uv-guide-gen.ts pour la carrosserie.
 *
 * La texture des détails est très fragmentée (>100 petits îlots UV : aileron,
 * diffuseur, entrées d'air, châssis, cockpit…). On regroupe donc les îlots en
 * ZONES sémantiques à partir de leur position 3D (repère monde : +Z avant, +Y
 * haut, +X gauche) et de leur normale moyenne, puis pour chaque zone on :
 *   1. trace le contour exact de chaque îlot (edge-walking + simplification RDP) ;
 *   2. calcule la bounding-box union (→ DETAILS_REGIONS de maps.ts) ;
 *   3. calcule l'orientation « voiture » (angle fabric + miroir, → REGION_ORIENTATION).
 *
 * Sorties :
 *   - src/uvGuideData.ts              : ré-écrit avec skin (préservé) + details
 *   - scripts/out/details-uv-verify.png : vérification (wireframe + contours + libellés)
 *   - scripts/out/details-regions.json  : DETAILS_REGIONS + orientation (données brutes)
 *   - console                           : blocs TS prêts à coller dans maps.ts
 *
 * Lancer : npx.cmd tsx scripts/uv-details-gen.ts
 */
const fakeImg = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, set src(_v: string) {} });
(globalThis as unknown as { document: unknown }).document = {
  createElementNS: () => fakeImg(),
  createElement: () => fakeImg(),
};

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createCanvas } from 'canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { UV_GUIDE_ISLANDS, type UvGuideIsland } from '../src/uvGuideData.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- chargement FBX
const fbxPath = resolve(__dirname, '../public/models/car/StadiumCAR2020_OffsetFix.fbx');
const buf = readFileSync(fbxPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const root = new FBXLoader().parse(ab as ArrayBuffer, '');
root.updateWorldMatrix(true, true);

let mesh: THREE.Mesh | null = null;
root.traverse((o) => { if (o instanceof THREE.Mesh && /detail/i.test(o.name)) mesh = o; });
if (!mesh) throw new Error('Details mesh introuvable');
const m = mesh as THREE.Mesh;
const geo = m.geometry as THREE.BufferGeometry;
const pos = geo.attributes.position;
const nor = geo.attributes.normal;
const uv = geo.attributes.uv;
const world = m.matrixWorld;
const nmat = new THREE.Matrix3().getNormalMatrix(world);

const bb = new THREE.Box3();
{
  const w = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { w.fromBufferAttribute(pos, i).applyMatrix4(world); bb.expandByPoint(w); }
}
const size = bb.getSize(new THREE.Vector3());

// ------------------------------------------------ rasterisation (repère éditeur)
const N = 1024;
const grid = new Uint8Array(N * N);
const idx = geo.index;
const triCount = idx ? idx.count / 3 : uv.count / 3;
const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
const ex = (i: number) => uv.getX(i) * N;
const ey = (i: number) => (1 - uv.getY(i)) * N;

function fillTri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)));
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(d) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d;
      const l2 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -0.02 && l2 >= -0.02 && l3 >= -0.02) grid[y * N + x] = 1;
    }
  }
}
for (let t = 0; t < triCount; t++) {
  const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
  fillTri(ex(a), ey(a), ex(b), ey(b), ex(c), ey(c));
}

// --------------------------------------------------------------- flood-fill îlots
const label = new Int32Array(N * N).fill(-1);
let next = 0;
for (let s = 0; s < N * N; s++) {
  if (grid[s] === 0 || label[s] !== -1) continue;
  const id = next++;
  const st = [s]; label[s] = id;
  while (st.length) {
    const c = st.pop()!; const cx = c % N, cy = (c / N) | 0;
    const nb = [c - 1, c + 1, c - N, c + N];
    const okx = [cx > 0, cx < N - 1, true, true];
    for (let k = 0; k < 4; k++) {
      if (!okx[k]) continue;
      const nc = nb[k];
      if (nc < 0 || nc >= N * N) continue;
      if (grid[nc] === 1 && label[nc] === -1) { label[nc] = id; st.push(nc); }
    }
  }
}

// -------------------------------- collecte des sommets par îlot (monde + uv)
interface Vtx { wx: number; wy: number; wz: number; nx: number; ny: number; nz: number; u: number; v: number; }
interface Isl {
  id: number; cells: number; verts: Vtx[];
  x0: number; y0: number; x1: number; y1: number;
}
const islands = new Map<number, Isl>();
const wv = new THREE.Vector3();
const wn = new THREE.Vector3();
for (let i = 0; i < uv.count; i++) {
  const gx = Math.min(N - 1, Math.max(0, Math.floor(uv.getX(i) * N)));
  const gy = Math.min(N - 1, Math.max(0, Math.floor((1 - uv.getY(i)) * N)));
  const id = label[gy * N + gx];
  if (id < 0) continue;
  wv.fromBufferAttribute(pos, i).applyMatrix4(world);
  wn.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize();
  let o = islands.get(id);
  if (!o) { o = { id, cells: 0, verts: [], x0: 1, y0: 1, x1: 0, y1: 0 }; islands.set(id, o); }
  o.verts.push({ wx: wv.x, wy: wv.y, wz: wv.z, nx: wn.x, ny: wn.y, nz: wn.z, u: uv.getX(i), v: uv.getY(i) });
}
const cellCount = new Map<number, number>();
for (let s = 0; s < N * N; s++) { const l = label[s]; if (l >= 0) cellCount.set(l, (cellCount.get(l) ?? 0) + 1); }
for (const [id, o] of islands) o.cells = cellCount.get(id) ?? 0;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const l = label[y * N + x]; if (l < 0) continue; const o = islands.get(l); if (!o) continue;
  const fx = x / N, fy = y / N;
  if (fx < o.x0) o.x0 = fx; if (fx > o.x1) o.x1 = fx;
  if (fy < o.y0) o.y0 = fy; if (fy > o.y1) o.y1 = fy;
}

// ------------------------------------------------------- classification par ZONE
// Regroupe les îlots par sémantique 3D. Repère monde : +Z avant, +Y haut, +X gauche.
const frac = (val: number, min: number, s: number) => (val - min) / (s || 1);

interface Zone { key: string; label: string; }
const ZONES: Zone[] = [
  { key: 'd_front', label: 'AVANT / SPLITTER' },
  { key: 'd_hood', label: "ENTRÉES D'AIR / CAPOT" },
  { key: 'd_cockpit', label: 'ENTOURAGE COCKPIT' },
  { key: 'd_wing', label: 'AILERON' },
  { key: 'd_rear', label: 'DIFFUSEUR / ARRIÈRE' },
  { key: 'd_side', label: 'FLANCS / CARÉNAGE' },
  { key: 'd_floor', label: 'CHÂSSIS / DESSOUS' },
];

function classifyZone(fLong: number, fUp: number, n: THREE.Vector3): string {
  // Aileron : partie arrière ET surélevée.
  if (fLong < 0.32 && fUp > 0.55) return 'd_wing';
  // Diffuseur / bloc arrière.
  if (fLong < 0.24) return 'd_rear';
  // Avant : splitter / nez.
  if (fLong > 0.72) return 'd_front';
  // Châssis / dessous : surfaces tournées vers le bas ou très basses.
  if (n.y < -0.35 || fUp < 0.22) return 'd_floor';
  // Entourage cockpit : central-haut.
  if (fUp > 0.52 && fLong < 0.60) return 'd_cockpit';
  // Entrées d'air / capot : avant-central, plutôt vers le haut.
  if (fLong >= 0.55) return 'd_hood';
  // Reste : flancs / carénage latéral.
  return 'd_side';
}

const MIN_CELL_REGION = 0.0002; // îlots comptés dans la bbox de zone (~0.02 %)
const MIN_CELL_OUTLINE = 0.0009; // îlots tracés en contour (~0.09 %, silhouettes lisibles)

interface ZoneAgg {
  islands: Isl[];        // pour la bbox (petits inclus)
  outlineIslands: Isl[]; // pour les contours (assez gros)
  verts: Vtx[];          // pour l'orientation
}
const zoneAgg = new Map<string, ZoneAgg>();
for (const z of ZONES) zoneAgg.set(z.key, { islands: [], outlineIslands: [], verts: [] });

for (const o of islands.values()) {
  if (o.cells < N * N * MIN_CELL_REGION) continue;
  const c = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (const v of o.verts) { c.x += v.wx; c.y += v.wy; c.z += v.wz; nrm.x += v.nx; nrm.y += v.ny; nrm.z += v.nz; }
  c.multiplyScalar(1 / o.verts.length);
  nrm.normalize();
  const fLong = frac(c.z, bb.min.z, size.z);
  const fUp = frac(c.y, bb.min.y, size.y);
  const key = classifyZone(fLong, fUp, nrm);
  const agg = zoneAgg.get(key)!;
  agg.islands.push(o);
  agg.verts.push(...o.verts);
  if (o.cells >= N * N * MIN_CELL_OUTLINE) agg.outlineIslands.push(o);
}

// ------------------------------------------------------- contour (edge-walking)
type Pt = [number, number];
function traceIsland(islandId: number): Pt[][] {
  const cid = (x: number, y: number) => y * (N + 1) + x;
  const startMap = new Map<number, number[]>();
  const addEdge = (sx: number, sy: number, tx: number, ty: number) => {
    const s = cid(sx, sy), t = cid(tx, ty);
    const arr = startMap.get(s); if (arr) arr.push(t); else startMap.set(s, [t]);
  };
  const isIsl = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && label[y * N + x] === islandId;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (label[y * N + x] !== islandId) continue;
    if (!isIsl(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!isIsl(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!isIsl(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!isIsl(x - 1, y)) addEdge(x, y + 1, x, y);
  }
  const loops: Pt[][] = [];
  const decode = (id: number): Pt => [ (id % (N + 1)) / N, Math.floor(id / (N + 1)) / N ];
  for (const [start, ends] of startMap) {
    while (ends.length) {
      const loop: number[] = [start];
      let cur = ends.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < N * 8) {
        loop.push(cur);
        const arr = startMap.get(cur);
        if (!arr || arr.length === 0) break;
        cur = arr.pop()!;
      }
      if (cur === start && loop.length >= 4) loops.push(loop.map(decode));
    }
  }
  return loops;
}

function rdp(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return points;
  const d2line = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const simplify = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    let maxD = 0, maxI = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = d2line(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps) {
      const left = simplify(pts.slice(0, maxI + 1));
      const right = simplify(pts.slice(maxI));
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
  };
  return simplify(points);
}

function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}

// ------------------------------------------------------- orientation par zone
function fitLinear(verts: Vtx[], target: (v: Vtx) => number): { a: number[] } {
  const XtX = new Array(16).fill(0);
  const Xty = new Array(4).fill(0);
  for (const v of verts) {
    const r = [v.wx, v.wy, v.wz, 1];
    const y = target(v);
    for (let i = 0; i < 4; i++) { Xty[i] += r[i] * y; for (let j = 0; j < 4; j++) XtX[i * 4 + j] += r[i] * r[j]; }
  }
  const beta = solve4(XtX, Xty);
  return { a: [beta[0], beta[1], beta[2]] };
}
function solve4(A: number[], b: number[]): number[] {
  const M = A.slice(); const y = b.slice(); const n = 4;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r * n + col]) > Math.abs(M[piv * n + col])) piv = r;
    if (piv !== col) {
      for (let k = 0; k < n; k++) { const t = M[col * n + k]; M[col * n + k] = M[piv * n + k]; M[piv * n + k] = t; }
      const t = y[col]; y[col] = y[piv]; y[piv] = t;
    }
    const d = M[col * n + col] || 1e-9;
    for (let r = 0; r < n; r++) { if (r === col) continue; const f = M[r * n + col] / d; for (let k = 0; k < n; k++) M[r * n + k] -= f * M[col * n + k]; y[r] -= f * y[col]; }
  }
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = y[i] / (M[i * n + i] || 1e-9);
  return out;
}

interface ZoneResult {
  key: string; label: string;
  polygons: Pt[][];
  region: { x: number; y: number; w: number; h: number };
  angle: number; flipX: boolean;
  centroid: [number, number, number]; normal: [number, number, number];
  islandCount: number; cellFrac: number;
}

const EPS = 0.0035;
const results: ZoneResult[] = [];
for (const z of ZONES) {
  const agg = zoneAgg.get(z.key)!;
  if (agg.verts.length < 8) continue;

  // bbox union (repère éditeur 0..1) sur tous les îlots de la zone
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  let cells = 0;
  for (const o of agg.islands) { x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0); x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1); cells += o.cells; }

  // contours des îlots assez gros (les plus grands d'abord)
  const outline = agg.outlineIslands.length ? agg.outlineIslands : agg.islands;
  const polys: Pt[][] = [];
  for (const o of [...outline].sort((a, b) => b.cells - a.cells)) {
    for (const loop of traceIsland(o.id)) {
      if (loop.length < 4) continue;
      if (polyArea(loop) < 0.0004) continue;
      const simp = rdp(loop, EPS);
      if (simp.length >= 3) polys.push(simp);
    }
  }
  polys.sort((a, b) => polyArea(b) - polyArea(a));

  // centroïde + normale moyenne
  const c = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (const v of agg.verts) { c.x += v.wx; c.y += v.wy; c.z += v.wz; nrm.x += v.nx; nrm.y += v.ny; nrm.z += v.nz; }
  c.multiplyScalar(1 / agg.verts.length);
  nrm.normalize();

  // orientation « voiture » (même méthode que uv-orient pour la carrosserie)
  const fx = fitLinear(agg.verts, (v) => v.u);
  const fy = fitLinear(agg.verts, (v) => 1 - v.v);
  const Ax = new THREE.Vector3(fx.a[0], fx.a[1], fx.a[2]);
  const Ay = new THREE.Vector3(fy.a[0], fy.a[1], fy.a[2]);
  const horizontal = Math.abs(nrm.y) > 0.6;
  let upRef = horizontal ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  upRef = upRef.clone().addScaledVector(nrm, -upRef.dot(nrm));
  if (upRef.lengthSq() < 1e-6) upRef = new THREE.Vector3(0, 0, 1).addScaledVector(nrm, -nrm.z);
  upRef.normalize();
  const right = upRef.clone().cross(nrm).normalize();
  const cu: [number, number] = [Ax.dot(upRef), Ay.dot(upRef)];
  const cr: [number, number] = [Ax.dot(right), Ay.dot(right)];
  let angle = (Math.atan2(cu[0], -cu[1]) * 180) / Math.PI;
  angle = ((angle % 360) + 360) % 360;
  const det = cr[0] * cu[1] - cr[1] * cu[0];
  const flipX = det > 0;

  results.push({
    key: z.key, label: z.label,
    polygons: polys,
    region: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    angle: Math.round(angle), flipX,
    centroid: [c.x, c.y, c.z], normal: [nrm.x, nrm.y, nrm.z],
    islandCount: agg.islands.length, cellFrac: cells / (N * N),
  });
}

// ordre stable selon ZONES
results.sort((a, b) => ZONES.findIndex((z) => z.key === a.key) - ZONES.findIndex((z) => z.key === b.key));

// ---------------------------------------------------------- écriture uvGuideData.ts
// On PRÉSERVE les îlots existants (skin/wheels) et on remplace la famille details.
const kept = UV_GUIDE_ISLANDS.filter((i) => i.family !== 'details');
const detailIslands: UvGuideIsland[] = results
  .filter((r) => r.polygons.length > 0)
  .map((r) => ({
    key: r.key,
    label: r.label,
    family: 'details' as const,
    polygons: r.polygons.map((poly) => poly.map((p) => ({ x: +p[0].toFixed(4), y: +p[1].toFixed(4) }))),
  }));
const allIslands = [...kept, ...detailIslands];

const serializeIsland = (i: UvGuideIsland) => {
  const polyStr = i.polygons.map((poly) => {
    const pts = poly.map((p) => `{ x: ${p.x.toFixed(4)}, y: ${p.y.toFixed(4)} }`).join(', ');
    return `      [${pts}]`;
  }).join(',\n');
  return `  {\n    key: ${JSON.stringify(i.key)},\n    label: ${JSON.stringify(i.label)},\n    family: ${JSON.stringify(i.family)},\n    polygons: [\n${polyStr},\n    ],\n  }`;
};

const dataTs = `/**
 * Guide UV vectoriel PRÉCIS des meshes du Stadium Car TM2020.
 *
 * GÉNÉRÉ automatiquement :
 *   - famille 'skin'    → scripts/uv-guide-gen.ts   (mesh « Skin_01 »)
 *   - famille 'details' → scripts/uv-details-gen.ts (mesh « Details_01 »)
 * NE PAS ÉDITER À LA MAIN.
 *
 * Chaque îlot correspond à une pièce/zone nommée (mêmes clés que SKIN_REGIONS /
 * DETAILS_REGIONS de maps.ts) et fournit un/des polygone(s) de contour en
 * coordonnées UV 0..1, origine EN HAUT À GAUCHE (repère de l'éditeur, cohérent
 * avec flipY = true). Un îlot peut avoir plusieurs polygones.
 */

export type UvGuideFamily = 'skin' | 'details' | 'wheels';

export interface UvGuideIsland {
  /** Clé de pièce (identique aux clés de SKIN_REGIONS / DETAILS_REGIONS). */
  key: string;
  /** Libellé affiché (FR). */
  label: string;
  /** Famille de map concernée. */
  family: UvGuideFamily;
  /** Contours : chaque polygone est une liste de points {x, y} en UV 0..1. */
  polygons: { x: number; y: number }[][];
}

export const UV_GUIDE_ISLANDS: UvGuideIsland[] = [
${allIslands.map(serializeIsland).join(',\n')},
];

/** Îlots regroupés par famille de map. */
export const UV_GUIDE_BY_FAMILY: Record<UvGuideFamily, UvGuideIsland[]> = {
  skin: UV_GUIDE_ISLANDS.filter((i) => i.family === 'skin'),
  details: UV_GUIDE_ISLANDS.filter((i) => i.family === 'details'),
  wheels: UV_GUIDE_ISLANDS.filter((i) => i.family === 'wheels'),
};
`;
writeFileSync(resolve(__dirname, '../src/uvGuideData.ts'), dataTs);
console.log('écrit: src/uvGuideData.ts —', detailIslands.length, 'zones details,',
  detailIslands.reduce((s, r) => s + r.polygons.length, 0), 'polygones (skin préservé)');

// -------------------------------------------------- blocs TS pour maps.ts + JSON
const round4 = (v: number) => +v.toFixed(4);
console.log('\n=== Bloc TS: DETAILS_REGIONS (à coller dans maps.ts) ===');
console.log('export const DETAILS_REGIONS: Record<string, UVRegion> = {');
for (const r of results) {
  console.log(`  ${r.key}: { x: ${round4(r.region.x)}, y: ${round4(r.region.y)}, w: ${round4(r.region.w)}, h: ${round4(r.region.h)}, label: ${JSON.stringify(r.label)} },`);
}
console.log('};');

console.log('\n=== Bloc TS: orientation details (à fusionner dans REGION_ORIENTATION) ===');
for (const r of results) {
  console.log(`  ${r.key}: { angle: ${r.angle}, flipX: ${r.flipX} },`);
}

writeFileSync(resolve(outDir, 'details-regions.json'), JSON.stringify(results.map((r) => ({
  key: r.key, label: r.label, region: r.region, angle: r.angle, flipX: r.flipX,
  centroid: r.centroid, normal: r.normal, islandCount: r.islandCount, cellFrac: r.cellFrac,
  polygonCount: r.polygons.length,
})), null, 2));
console.log('\nécrit: scripts/out/details-regions.json');

// --------------------------------------------------------------- rendu PNG verif
const COLORS: Record<string, string> = {
  d_front: '#ff9a28', d_hood: '#ff5a5a', d_cockpit: '#b45aff', d_wing: '#ff40c8',
  d_rear: '#28dcdc', d_side: '#3ad884', d_floor: '#e0e02a',
};
const S = 1024;
const canvas = createCanvas(S, S);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, S, S);
// wireframe
ctx.strokeStyle = 'rgba(150,170,190,0.16)'; ctx.lineWidth = 0.5; ctx.beginPath();
for (let t = 0; t < triCount; t++) {
  const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
  const ax = uv.getX(a) * S, ay = (1 - uv.getY(a)) * S;
  const bx = uv.getX(b) * S, by = (1 - uv.getY(b)) * S;
  const cx = uv.getX(c) * S, cy = (1 - uv.getY(c)) * S;
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath();
}
ctx.stroke();

ctx.lineJoin = 'round';
ctx.font = 'bold 18px sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
for (const r of results) {
  const col = COLORS[r.key] ?? '#ffffff';
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  for (const poly of r.polygons) {
    ctx.beginPath();
    poly.forEach((p, i) => { const X = p[0] * S, Y = p[1] * S; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath();
    ctx.save(); ctx.globalAlpha = 0.12; ctx.fillStyle = col; ctx.fill(); ctx.restore();
    ctx.stroke();
  }
  // libellé au centre du plus grand polygone de la zone (comme l'overlay React)
  const big = r.polygons[0] ?? [[r.region.x + r.region.w / 2, r.region.y + r.region.h / 2]];
  let mx = 0, my = 0;
  for (const p of big) { mx += p[0]; my += p[1]; }
  mx = (mx / big.length) * S; my = (my / big.length) * S;
  const txt = `${r.label} ${r.angle}°${r.flipX ? ' ⇋' : ''}`;
  const w = ctx.measureText(txt).width;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(mx - w / 2 - 6, my - 13, w + 12, 26);
  ctx.fillStyle = col;
  ctx.fillText(txt, mx, my);
}
writeFileSync(resolve(outDir, 'details-uv-verify.png'), canvas.toBuffer('image/png'));
console.log('écrit: scripts/out/details-uv-verify.png');

console.log('\n=== Zones details ===');
for (const r of results) {
  console.log(`  ${r.key.padEnd(10)} "${r.label}"  îlots=${r.islandCount} contours=${r.polygons.length} surf=${(r.cellFrac * 100).toFixed(1)}% angle=${r.angle}° flipX=${r.flipX}`);
}
