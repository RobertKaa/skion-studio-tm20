/**
 * Génère un GUIDE UV PRÉCIS pour l'éditeur à partir du vrai FBX Stadium Car.
 *
 * Contrairement aux simples bounding-box (SKIN_REGIONS), ce script extrait la
 * SILHOUETTE réelle de chaque îlot UV du mesh « Skin_01 » :
 *   1. rasterise les triangles UV dans une grille (repère éditeur, y=0 en haut) ;
 *   2. sépare les îlots par flood-fill ;
 *   3. classe chaque îlot dans une pièce nommée (toit/capot, flancs, ailes,
 *      avant, arrière, aileron) par recouvrement avec les rectangles connus ;
 *   4. trace le contour exact de chaque îlot (edge-walking + simplification RDP) ;
 *   5. écrit :
 *        - src/uvGuideData.ts   (polygones vectoriels 0..1, prêts pour l'overlay)
 *        - public/uv/skin-uv-guide.png (wireframe + contours + libellés)
 *        - scripts/out/uv-guide-verify.png (vérification: contours sur le wireframe)
 *        - scripts/out/skin-zones-audit.png (audit : chaque îlot coloré + libellé)
 *
 * Lancer: npx.cmd tsx scripts/uv-guide-gen.ts
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
import { SKIN_REGIONS, type UVRegion } from '../src/maps.ts';
import { UV_GUIDE_ISLANDS as EXISTING_GUIDE } from '../src/uvGuideData.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'out');
mkdirSync(outDir, { recursive: true });
const publicUvDir = resolve(__dirname, '../public/uv');
mkdirSync(publicUvDir, { recursive: true });

// ---------------------------------------------------------------- chargement FBX
const fbxPath = resolve(__dirname, '../public/models/car/StadiumCAR2020_OffsetFix.fbx');
const buf = readFileSync(fbxPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const root = new FBXLoader().parse(ab as ArrayBuffer, '');
root.updateWorldMatrix(true, true);

let mesh: THREE.Mesh | null = null;
root.traverse((o) => { if (o instanceof THREE.Mesh && /skin/i.test(o.name)) mesh = o; });
if (!mesh) throw new Error('Skin mesh introuvable');
const m = mesh as THREE.Mesh;
const geo = m.geometry as THREE.BufferGeometry;
const pos = geo.attributes.position;
const uv = geo.attributes.uv;
const world = m.matrixWorld;

// bbox monde (pour classer les îlots par centroïde 3D)
const bb = new THREE.Box3();
{
  const w = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { w.fromBufferAttribute(pos, i).applyMatrix4(world); bb.expandByPoint(w); }
}
const size = bb.getSize(new THREE.Vector3());

// ------------------------------------------------ rasterisation (repère éditeur)
// Grille en repère ÉDITEUR : x = u, y = 1 - v (origine haut-gauche).
const N = 1024;
const grid = new Uint8Array(N * N);
const idx = geo.index;
const triCount = idx ? idx.count / 3 : uv.count / 3;
const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
const ex = (i: number) => uv.getX(i) * N;            // -> x grille
const ey = (i: number) => (1 - uv.getY(i)) * N;      // -> y grille (éditeur)

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

interface Isl {
  id: number; cells: number;
  x0: number; y0: number; x1: number; y1: number; // bbox éditeur (0..1)
  cx3: number; cy3: number; cz3: number; verts: number; // centroïde 3D
}
const islands = new Map<number, Isl>();
const wv = new THREE.Vector3();
for (let i = 0; i < uv.count; i++) {
  const gx = Math.min(N - 1, Math.max(0, Math.floor(uv.getX(i) * N)));
  const gy = Math.min(N - 1, Math.max(0, Math.floor((1 - uv.getY(i)) * N)));
  const id = label[gy * N + gx];
  if (id < 0) continue;
  wv.fromBufferAttribute(pos, i).applyMatrix4(world);
  let o = islands.get(id);
  if (!o) { o = { id, cells: 0, x0: 1, y0: 1, x1: 0, y1: 0, cx3: 0, cy3: 0, cz3: 0, verts: 0 }; islands.set(id, o); }
  o.verts++;
  o.cx3 += wv.x; o.cy3 += wv.y; o.cz3 += wv.z;
}
// nombre de cellules par îlot (surface UV réelle)
const cellCount = new Map<number, number>();
for (let s = 0; s < N * N; s++) { const l = label[s]; if (l >= 0) cellCount.set(l, (cellCount.get(l) ?? 0) + 1); }
for (const [id, o] of islands) o.cells = cellCount.get(id) ?? 0;
// bbox éditeur par îlot depuis la grille
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const l = label[y * N + x]; if (l < 0) continue; const o = islands.get(l); if (!o) continue;
  const fx = x / N, fy = y / N;
  if (fx < o.x0) o.x0 = fx; if (fx > o.x1) o.x1 = fx;
  if (fy < o.y0) o.y0 = fy; if (fy > o.y1) o.y1 = fy;
}

// ------------------------------------------------------- classification par pièce
// On réutilise les rectangles connus (SKIN_REGIONS) comme "aimants" : un îlot est
// attribué à la pièce dont le rectangle contient son centre ET dont l'aire est la
// plus proche (évite d'aspirer un petit îlot par le grand rectangle « TOIT »).
const regionEntries = Object.entries(SKIN_REGIONS) as [string, UVRegion][];
const MIN_CELL_FRAC = 0.0009; // ignore les micro-îlots (< ~0.09% de la texture)
function classify(o: Isl): string | null {
  const cxu = (o.x0 + o.x1) / 2, cyu = (o.y0 + o.y1) / 2;
  const islArea = (o.x1 - o.x0) * (o.y1 - o.y0);
  let best: string | null = null; let bestScore = Infinity;
  for (const [key, r] of regionEntries) {
    const inside = cxu >= r.x - 0.02 && cxu <= r.x + r.w + 0.02 && cyu >= r.y - 0.02 && cyu <= r.y + r.h + 0.02;
    if (!inside) continue;
    const rArea = r.w * r.h;
    if (islArea > rArea * 1.8) continue; // trop gros pour cette pièce
    // score = aire du rectangle (on préfère l'ajustement le plus serré)
    if (rArea < bestScore) { bestScore = rArea; best = key; }
  }
  return best;
}

const notable = [...islands.values()]
  .filter((o) => o.cells >= N * N * MIN_CELL_FRAC)
  .sort((a, b) => b.cells - a.cells);

const regionIslands = new Map<string, number[]>();
const unassigned: Isl[] = [];
for (const o of notable) {
  const key = classify(o);
  if (!key) { unassigned.push(o); continue; }
  const arr = regionIslands.get(key) ?? [];
  arr.push(o.id); regionIslands.set(key, arr);
}

// ------------------------------------------------------- contour (edge-walking)
type Pt = [number, number];
/** Trace les boucles frontières du masque d'un îlot (repère éditeur, coords 0..1). */
function traceIsland(islandId: number): Pt[][] {
  // arêtes dirigées entre coins de cellules ; îlot rempli à droite de l'arête.
  const cid = (x: number, y: number) => y * (N + 1) + x;
  const startMap = new Map<number, number[]>(); // coin départ -> coins arrivée
  const addEdge = (sx: number, sy: number, tx: number, ty: number) => {
    const s = cid(sx, sy), t = cid(tx, ty);
    const arr = startMap.get(s); if (arr) arr.push(t); else startMap.set(s, [t]);
  };
  const isIsl = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && label[y * N + x] === islandId;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (label[y * N + x] !== islandId) continue;
    if (!isIsl(x, y - 1)) addEdge(x, y, x + 1, y);         // haut : ->
    if (!isIsl(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1); // droite : v
    if (!isIsl(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1); // bas : <-
    if (!isIsl(x - 1, y)) addEdge(x, y + 1, x, y);         // gauche : ^
  }
  const loops: Pt[][] = [];
  const decode = (id: number): Pt => [ (id % (N + 1)) / N, Math.floor(id / (N + 1)) / N ];
  for (const [start, ends] of startMap) {
    while (ends.length) {
      // suit une boucle en consommant les arêtes
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

// simplification Douglas-Peucker
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

const EPS = 0.0035; // tolérance de simplification (en unités UV 0..1)
interface OutIsland { key: string; label: string; family: 'skin'; polygons: Pt[][]; }
const result: OutIsland[] = [];
for (const [key, ids] of regionIslands) {
  const label0 = SKIN_REGIONS[key].label;
  const polys: Pt[][] = [];
  for (const id of ids) {
    for (const loop of traceIsland(id)) {
      if (loop.length < 4) continue;
      if (polyArea(loop) < 0.0004) continue; // ignore les trous/résidus minuscules
      const simp = rdp(loop, EPS);
      if (simp.length >= 3) polys.push(simp);
    }
  }
  // ne conserve que les contours externes notables (plus grande aire par îlot déjà gérée)
  polys.sort((a, b) => polyArea(b) - polyArea(a));
  if (polys.length) result.push({ key, label: label0, family: 'skin', polygons: polys });
}

// ordre stable selon SKIN_REGIONS
result.sort((a, b) => regionEntries.findIndex(([k]) => k === a.key) - regionEntries.findIndex(([k]) => k === b.key));

// ---------------------------------------------------------- écriture uvGuideData.ts
// On PRÉSERVE les familles non-skin déjà générées (details via uv-details-gen.ts).
interface OutSerial { key: string; label: string; family: UvGuideFamily; polygons: { x: number; y: number }[][]; }
type UvGuideFamily = 'skin' | 'details' | 'wheels';
const skinSerial: OutSerial[] = result.map((r) => ({
  key: r.key, label: r.label, family: 'skin',
  polygons: r.polygons.map((poly) => poly.map((p) => ({ x: +p[0].toFixed(4), y: +p[1].toFixed(4) }))),
}));
const keptSerial: OutSerial[] = (EXISTING_GUIDE as OutSerial[]).filter((i) => i.family !== 'skin');
const allSerial = [...skinSerial, ...keptSerial];

const serializeIsland = (i: OutSerial) => {
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
${allSerial.map(serializeIsland).join(',\n')},
];

/** Îlots regroupés par famille de map. */
export const UV_GUIDE_BY_FAMILY: Record<UvGuideFamily, UvGuideIsland[]> = {
  skin: UV_GUIDE_ISLANDS.filter((i) => i.family === 'skin'),
  details: UV_GUIDE_ISLANDS.filter((i) => i.family === 'details'),
  wheels: UV_GUIDE_ISLANDS.filter((i) => i.family === 'wheels'),
};
`;
writeFileSync(resolve(__dirname, '../src/uvGuideData.ts'), dataTs);
console.log('écrit: src/uvGuideData.ts —', skinSerial.length, 'îlots skin,',
  keptSerial.length, 'îlots préservés (details/wheels)');

// --------------------------------------------------------------- rendu PNG guide
const COLORS: Record<string, string> = {
  top: '#ff5a5a', left: '#40dc78', right: '#dcdc28', archL: '#4aa0ff', archR: '#b450ff',
  front: '#ff9a28', rear: '#28dcdc', spoiler: '#ff40c8',
  sillL: '#6ae0c8', sillR: '#e0a86a', shoulderL: '#9a6aff', shoulderR: '#ff8060',
  rearLow: '#60b0ff', rearSideL: '#c8e040',
};
const UNASSIGNED_COLOR = '#ff3030';
const S = 1024;
function drawGuide(withWire: boolean, background: string | null): Buffer {
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, S, S); }
  else ctx.clearRect(0, 0, S, S);

  // wireframe fin de tous les triangles
  if (withWire) {
    ctx.strokeStyle = 'rgba(150,170,190,0.22)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let t = 0; t < triCount; t++) {
      const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
      const ax = uv.getX(a) * S, ay = (1 - uv.getY(a)) * S;
      const bx = uv.getX(b) * S, by = (1 - uv.getY(b)) * S;
      const cx = uv.getX(c) * S, cy = (1 - uv.getY(c)) * S;
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath();
    }
    ctx.stroke();
  }

  // contours des pièces + libellés
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of result) {
    const col = COLORS[r.key] ?? '#ffffff';
    ctx.strokeStyle = col;
    ctx.fillStyle = col.replace(')', ', 0.10)').replace('#', '');
    for (const poly of r.polygons) {
      ctx.beginPath();
      poly.forEach((p, i) => { const X = p[0] * S, Y = p[1] * S; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath();
      ctx.save();
      ctx.globalAlpha = 0.10; ctx.fillStyle = col; ctx.fill();
      ctx.restore();
      ctx.stroke();
    }
    // libellé au centre du plus grand polygone
    const big = r.polygons[0];
    let mx = 0, my = 0; big.forEach((p) => { mx += p[0]; my += p[1]; });
    mx = (mx / big.length) * S; my = (my / big.length) * S;
    const txt = r.label;
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(mx - w / 2 - 6, my - 13, w + 12, 26);
    ctx.fillStyle = col;
    ctx.fillText(txt, mx, my);
  }
  return canvas.toBuffer('image/png');
}

writeFileSync(resolve(publicUvDir, 'skin-uv-guide.png'), drawGuide(true, null));
console.log('écrit: public/uv/skin-uv-guide.png (fond transparent)');
writeFileSync(resolve(outDir, 'uv-guide-verify.png'), drawGuide(true, '#0e1116'));
console.log('écrit: scripts/out/uv-guide-verify.png (vérification sur fond sombre)');

// ------------------------------------------------ audit : chaque îlot notable coloré
const islandToRegion = new Map<number, string>();
for (const [key, ids] of regionIslands) for (const id of ids) islandToRegion.set(id, key);

function drawAudit(): Buffer {
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e1116';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(150,170,190,0.18)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
    const ax = uv.getX(a) * S, ay = (1 - uv.getY(a)) * S;
    const bx = uv.getX(b) * S, by = (1 - uv.getY(b)) * S;
    const cx = uv.getX(c) * S, cy = (1 - uv.getY(c)) * S;
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath();
  }
  ctx.stroke();
  ctx.lineJoin = 'round';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const o of notable) {
    const key = islandToRegion.get(o.id);
    const col = key ? (COLORS[key] ?? '#ffffff') : UNASSIGNED_COLOR;
    const loops = traceIsland(o.id);
    for (const loop of loops) {
      if (loop.length < 4 || polyArea(loop) < 0.0004) continue;
      ctx.beginPath();
      loop.forEach((p, i) => { const X = p[0] * S, Y = p[1] * S; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath();
      ctx.fillStyle = col + '33';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const cx = ((o.x0 + o.x1) / 2) * S;
    const cy = ((o.y0 + o.y1) / 2) * S;
    const txt = key ? `${key} (#${o.id})` : `? #${o.id}`;
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(cx - w / 2 - 3, cy - 8, w + 6, 16);
    ctx.fillStyle = col;
    ctx.fillText(txt, cx, cy);
  }
  return canvas.toBuffer('image/png');
}
writeFileSync(resolve(outDir, 'skin-zones-audit.png'), drawAudit());
console.log('écrit: scripts/out/skin-zones-audit.png (audit îlots Skin_01)');

// --------------------------------------------------------------- rapport console
console.log('\n=== Pièces extraites ===');
for (const r of result) {
  console.log(`  ${r.key.padEnd(8)} "${r.label}"  polygones=${r.polygons.length}  pts=${r.polygons.map((p) => p.length).join('+')}`);
}
if (unassigned.length) {
  console.log('\n=== Îlots notables NON classés (à vérifier) ===');
  for (const o of unassigned) {
    console.log(`  id=${o.id} cells=${o.cells} bbox x[${o.x0.toFixed(3)}..${o.x1.toFixed(3)}] y[${o.y0.toFixed(3)}..${o.y1.toFixed(3)}]`);
  }
} else {
  console.log('\n✓ Tous les îlots notables Skin_01 sont classés.');
}
