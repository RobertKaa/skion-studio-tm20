/**
 * Analyse d'ORIENTATION des îlots UV du mesh « Skin_01 » (Stadium Car TM2020).
 *
 * Pour chaque îlot nommé (mêmes clés que SKIN_REGIONS) on calcule, à partir de la
 * vraie géométrie FBX :
 *   1. le centroïde 3D + la normale moyenne (monde) → sémantique de la pièce
 *      (avant/arrière, flanc gauche/droit, toit…) ;
 *   2. la carte linéaire monde→canvas (moindres carrés) → comment une direction
 *      du monde (haut +Y, avant +Z) se projette dans le canvas d'édition ;
 *   3. l'ANGLE (fabric, sens horaire) + le MIROIR (flipX) à appliquer à un décalque
 *      dessiné « droit » dans le canvas pour qu'il apparaisse DROIT SUR LA VOITURE.
 *
 * Convention monde vérifiée : +Z = avant (nez), +Y = haut, +X = flanc GAUCHE
 * (repère main droite, gauche = up × forward = Y × Z = +X).
 *
 * Sorties :
 *   - scripts/out/uv-orient.png       : wireframe + « F » orienté voiture par îlot
 *   - scripts/out/uv-orient.json      : données brutes (angle/flip/centroïde/normale)
 *   - console                          : rapport lisible + bloc TS prêt à coller
 *
 * Lancer : npx.cmd tsx scripts/uv-orient.ts
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
let glassBox = new THREE.Box3();
let glassN = 0;
const gc = new THREE.Vector3();
root.traverse((o) => {
  if (o instanceof THREE.Mesh && /skin/i.test(o.name)) mesh = o;
  if (o instanceof THREE.Mesh && /glass/i.test(o.name)) {
    const p = (o.geometry as THREE.BufferGeometry).attributes.position;
    for (let i = 0; i < p.count; i++) { gc.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); glassBox.expandByPoint(gc); glassN++; }
  }
});
if (!mesh) throw new Error('Skin mesh introuvable');
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
console.log('skin bbox min', fmt(bb.min), 'max', fmt(bb.max), 'size', fmt(size));
if (glassN) console.log('glass centroid z =', (glassBox.getCenter(new THREE.Vector3()).z).toFixed(1),
  '(repère: +Z attendu = avant/nez ; la verrière est plutôt centrale)');

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

// ------------------------------------------------------- classification par pièce
const regionEntries = Object.entries(SKIN_REGIONS) as [string, UVRegion][];
const MIN_CELL_FRAC = 0.0009;
function classify(o: Isl): string | null {
  const cxu = (o.x0 + o.x1) / 2, cyu = (o.y0 + o.y1) / 2;
  const islArea = (o.x1 - o.x0) * (o.y1 - o.y0);
  let best: string | null = null; let bestScore = Infinity;
  for (const [key, r] of regionEntries) {
    const inside = cxu >= r.x - 0.02 && cxu <= r.x + r.w + 0.02 && cyu >= r.y - 0.02 && cyu <= r.y + r.h + 0.02;
    if (!inside) continue;
    const rArea = r.w * r.h;
    if (islArea > rArea * 1.8) continue;
    if (rArea < bestScore) { bestScore = rArea; best = key; }
  }
  return best;
}

const notable = [...islands.values()].filter((o) => o.cells >= N * N * MIN_CELL_FRAC).sort((a, b) => b.cells - a.cells);
const regionIslands = new Map<string, Isl[]>();
for (const o of notable) {
  const key = classify(o);
  if (!key) continue;
  const arr = regionIslands.get(key) ?? [];
  arr.push(o); regionIslands.set(key, arr);
}

// ------------------------------------------------------- calcul d'orientation
/** Résout le système normal 3x3 (moindres carrés) A·[wx,wy,wz]+a0 = target. */
function fitLinear(verts: Vtx[], target: (v: Vtx) => number): { a: number[]; a0: number } {
  // matrice de conception X = [wx, wy, wz, 1]; on résout (XᵀX) β = Xᵀy
  const XtX = new Array(16).fill(0);
  const Xty = new Array(4).fill(0);
  for (const v of verts) {
    const r = [v.wx, v.wy, v.wz, 1];
    const y = target(v);
    for (let i = 0; i < 4; i++) {
      Xty[i] += r[i] * y;
      for (let j = 0; j < 4; j++) XtX[i * 4 + j] += r[i] * r[j];
    }
  }
  const beta = solve4(XtX, Xty);
  return { a: [beta[0], beta[1], beta[2]], a0: beta[3] };
}
/** Élimination de Gauss 4x4 avec pivot partiel. */
function solve4(A: number[], b: number[]): number[] {
  const M = A.slice();
  const y = b.slice();
  const n = 4;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r * n + col]) > Math.abs(M[piv * n + col])) piv = r;
    if (piv !== col) {
      for (let k = 0; k < n; k++) { const t = M[col * n + k]; M[col * n + k] = M[piv * n + k]; M[piv * n + k] = t; }
      const t = y[col]; y[col] = y[piv]; y[piv] = t;
    }
    const d = M[col * n + col] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r * n + col] / d;
      for (let k = 0; k < n; k++) M[r * n + k] -= f * M[col * n + k];
      y[r] -= f * y[col];
    }
  }
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = y[i] / (M[i * n + i] || 1e-9);
  return out;
}

const frac = (val: number, min: number, s: number) => (val - min) / (s || 1);

interface Orient {
  key: string; label: string;
  centroid: THREE.Vector3; normal: THREE.Vector3;
  fLong: number; fWide: number; fUp: number; // z, x, y fractions (0..1)
  upRef: THREE.Vector3;         // direction monde qui doit apparaître « en haut »
  angle: number;                // degrés fabric (sens horaire), à appliquer au décalque
  flipX: boolean;               // miroir horizontal requis
  cu: [number, number]; cr: [number, number]; // images canvas de up/right
  faceGuess: string;
}

const results: Orient[] = [];
for (const [key, isls] of regionIslands) {
  const verts = isls.flatMap((o) => o.verts);
  if (verts.length < 8) continue;
  const centroid = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (const v of verts) {
    centroid.x += v.wx; centroid.y += v.wy; centroid.z += v.wz;
    normal.x += v.nx; normal.y += v.ny; normal.z += v.nz;
  }
  centroid.multiplyScalar(1 / verts.length);
  normal.normalize();

  // carte monde -> canvas normalisé (cx = u, cy = 1 - v, y vers le bas)
  const fx = fitLinear(verts, (v) => v.u);
  const fy = fitLinear(verts, (v) => 1 - v.v);
  const Ax = new THREE.Vector3(fx.a[0], fx.a[1], fx.a[2]); // ∂cx/∂monde
  const Ay = new THREE.Vector3(fy.a[0], fy.a[1], fy.a[2]); // ∂cy/∂monde

  // Choix de la référence « haut » selon l'orientation de la pièce.
  // Panneau ~horizontal (normale surtout verticale) : « haut » = avant (+Z),
  //   le décalque se lit depuis l'avant. Sinon (flancs, avant/arrière) : « haut » = +Y.
  const horizontal = Math.abs(normal.y) > 0.6;
  let upRef = horizontal ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  // projette dans le plan tangent
  upRef = upRef.clone().addScaledVector(normal, -upRef.dot(normal));
  if (upRef.lengthSq() < 1e-6) upRef = new THREE.Vector3(0, 0, 1).addScaledVector(normal, -normal.z);
  upRef.normalize();
  // right = up × n  (repère vu de l'extérieur)
  const right = upRef.clone().cross(normal).normalize();

  const cu: [number, number] = [Ax.dot(upRef), Ay.dot(upRef)];
  const cr: [number, number] = [Ax.dot(right), Ay.dot(right)];
  // angle pour que le « haut » du décalque (0,-1) s'aligne sur cu
  let angle = (Math.atan2(cu[0], -cu[1]) * 180) / Math.PI;
  angle = ((angle % 360) + 360) % 360;
  // miroir si le repère (right, up) projeté est inversé (det > 0 = miroir)
  const det = cr[0] * cu[1] - cr[1] * cu[0];
  const flipX = det > 0;

  const fLong = frac(centroid.z, bb.min.z, size.z);
  const fWide = frac(centroid.x, bb.min.x, size.x);
  const fUp = frac(centroid.y, bb.min.y, size.y);

  // devinette de face indépendante des libellés existants
  let faceGuess: string;
  const an = new THREE.Vector3(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
  if (an.y >= an.x && an.y >= an.z) faceGuess = fLong > 0.5 ? 'DESSUS avant (capot)' : 'DESSUS arrière (toit)';
  else if (an.z >= an.x && an.z >= an.y) faceGuess = normal.z > 0 ? 'FACE avant (+Z nez)' : 'FACE arrière (-Z)';
  else faceGuess = normal.x > 0 ? 'FLANC +X (gauche)' : 'FLANC -X (droit)';

  results.push({ key, label: SKIN_REGIONS[key].label, centroid, normal, fLong, fWide, fUp, upRef, angle, flipX, cu, cr, faceGuess });
}

results.sort((a, b) => regionEntries.findIndex(([k]) => k === a.key) - regionEntries.findIndex(([k]) => k === b.key));

// --------------------------------------------------------------- rapport console
console.log('\n=== Orientation par îlot (repère monde: +Z avant, +Y haut, +X flanc gauche) ===');
for (const r of results) {
  console.log(
    `  ${r.key.padEnd(8)} "${r.label}"\n` +
    `      centroïde monde=${fmt(r.centroid)}  normale=${fmt(r.normal)}\n` +
    `      fLong(z av=1)=${r.fLong.toFixed(2)} fWide(x gauche=1)=${r.fWide.toFixed(2)} fUp(y haut=1)=${r.fUp.toFixed(2)}\n` +
    `      face détectée: ${r.faceGuess}\n` +
    `      upRef monde=${fmt(r.upRef)}  →  canvas up=(${r.cu[0].toFixed(3)},${r.cu[1].toFixed(3)}) right=(${r.cr[0].toFixed(3)},${r.cr[1].toFixed(3)})\n` +
    `      ⇒ ANGLE=${r.angle.toFixed(1)}°  flipX=${r.flipX}`,
  );
}

// bloc TS prêt à coller dans maps.ts
console.log('\n=== Bloc TS (REGION_ORIENTATION) ===');
console.log('export const REGION_ORIENTATION: Record<string, { angle: number; flipX: boolean }> = {');
for (const r of results) {
  const a = Math.round(r.angle);
  console.log(`  ${r.key}: { angle: ${a}, flipX: ${r.flipX} },`);
}
console.log('};');

// JSON brut
writeFileSync(resolve(outDir, 'uv-orient.json'), JSON.stringify(
  results.map((r) => ({ key: r.key, label: r.label, centroid: r.centroid.toArray(), normal: r.normal.toArray(), fLong: r.fLong, fWide: r.fWide, fUp: r.fUp, angle: r.angle, flipX: r.flipX, faceGuess: r.faceGuess })),
  null, 2));
console.log('\nécrit: scripts/out/uv-orient.json');

// --------------------------------------------------------------- rendu PNG
const S = 1024;
const canvas = createCanvas(S, S);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, S, S);
// wireframe
ctx.strokeStyle = 'rgba(150,170,190,0.20)'; ctx.lineWidth = 0.6; ctx.beginPath();
for (let t = 0; t < triCount; t++) {
  const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
  const ax = uv.getX(a) * S, ay = (1 - uv.getY(a)) * S;
  const bx = uv.getX(b) * S, by = (1 - uv.getY(b)) * S;
  const cx = uv.getX(c) * S, cy = (1 - uv.getY(c)) * S;
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath();
}
ctx.stroke();

const COLORS: Record<string, string> = {
  top: '#ff5a5a', left: '#40dc78', right: '#dcdc28', archL: '#4aa0ff', archR: '#b450ff',
  front: '#ff9a28', rear: '#28dcdc', spoiler: '#ff40c8',
};

for (const r of results) {
  const col = COLORS[r.key] ?? '#ffffff';
  // centre canvas de l'îlot = centre de la bbox uv de ses cellules
  const isls = regionIslands.get(r.key)!;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const o of isls) { x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0); x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1); }
  const cx = ((x0 + x1) / 2) * S, cy = ((y0 + y1) / 2) * S;
  const glyphSize = Math.min(x1 - x0, y1 - y0) * S * 0.55;

  // dessine un « F » avec la transform (flipX puis rotation) → orientation d'un décalque droit-voiture
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((r.angle * Math.PI) / 180);
  if (r.flipX) ctx.scale(-1, 1);
  ctx.fillStyle = col;
  ctx.font = `bold ${Math.max(24, glyphSize).toFixed(0)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('F', 0, 0);
  ctx.restore();

  // flèche montrant le « haut voiture » projeté (cu) au centre de l'îlot
  const norm = (v: [number, number]) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l] as [number, number]; };
  const up = norm(r.cu);
  const len = glyphSize * 0.9;
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(cx, cy); ctx.lineTo(cx + up[0] * len, cy + up[1] * len); ctx.stroke();
  // pointe
  ctx.beginPath(); ctx.arc(cx + up[0] * len, cy + up[1] * len, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();

  // libellé
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const txt = `${r.label} ${r.angle.toFixed(0)}°${r.flipX ? ' ⇋' : ''}`;
  ctx.font = 'bold 15px sans-serif';
  const w = ctx.measureText(txt).width;
  ctx.fillRect(cx - w / 2 - 5, cy + glyphSize * 0.72, w + 10, 20);
  ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, cx, cy + glyphSize * 0.72 + 10);
}
writeFileSync(resolve(outDir, 'uv-orient.png'), canvas.toBuffer('image/png'));
console.log('écrit: scripts/out/uv-orient.png');

function fmt(v: THREE.Vector3) { return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`; }
