/**
 * Throwaway: sépare les îlots UV du mesh Skin_01 (flood-fill) puis, pour chaque
 * îlot notable, calcule sa bbox UV (repère éditeur haut-gauche) ET le centroïde
 * 3D de ses faces pour déduire la partie de voiture correspondante.
 * Lancer: npx.cmd tsx scripts/uv-islands.ts
 */
const fakeImg = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, set src(_v: string) {} });
(globalThis as unknown as { document: unknown }).document = { createElementNS: () => fakeImg(), createElement: () => fakeImg() };

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { encodePng } from './png.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'out');
mkdirSync(outDir, { recursive: true });
const fbxPath = resolve(__dirname, '../public/models/car/StadiumCAR2020_OffsetFix.fbx');
const buf = readFileSync(fbxPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const root = new FBXLoader().parse(ab as ArrayBuffer, '');
root.updateWorldMatrix(true, true);

let mesh: THREE.Mesh | null = null;
let glassCentroidZ = 0, glassN = 0;
const glassBox = new THREE.Box3();
root.traverse((o) => {
  if (o instanceof THREE.Mesh && /skin/i.test(o.name)) mesh = o;
  if (o instanceof THREE.Mesh && /glass/i.test(o.name)) {
    const p = (o.geometry as THREE.BufferGeometry).attributes.position;
    const w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); glassBox.expandByPoint(w); glassCentroidZ += w.z; glassN++; }
  }
});
if (!mesh) throw new Error('Skin mesh introuvable');
const m = mesh as THREE.Mesh;
const geo = m.geometry as THREE.BufferGeometry;
const pos = geo.attributes.position;
const uv = geo.attributes.uv;
const world = m.matrixWorld;

const bb = new THREE.Box3();
const w = new THREE.Vector3();
for (let i = 0; i < pos.count; i++) { w.fromBufferAttribute(pos, i).applyMatrix4(world); bb.expandByPoint(w); }
const size = bb.getSize(new THREE.Vector3());
console.log('skin bbox min', fmt(bb.min), 'max', fmt(bb.max), 'size', fmt(size));
console.log('glass bbox min', fmt(glassBox.min), 'max', fmt(glassBox.max), 'glassCentroidZ', (glassCentroidZ / glassN).toFixed(1));

// flood-fill grille UV (repère UV natif, v en bas). On RASTERISE les triangles
// (remplissage plein) pour que chaque panneau soit solide avant séparation.
const N = 256;
const grid = new Uint8Array(N * N);
const cell = (u: number, v: number) => {
  const cu = Math.min(N - 1, Math.max(0, Math.floor(u * N)));
  const cv = Math.min(N - 1, Math.max(0, Math.floor(v * N)));
  return cv * N + cu;
};
const gidx = geo.index;
const gTri = gidx ? gidx.count / 3 : uv.count / 3;
const gvi = (t: number, k: number) => (gidx ? gidx.getX(t * 3 + k) : t * 3 + k);
const fillTri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
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
};
for (let t = 0; t < gTri; t++) {
  const a = gvi(t, 0), b = gvi(t, 1), c = gvi(t, 2);
  fillTri(
    uv.getX(a) * N, uv.getY(a) * N,
    uv.getX(b) * N, uv.getY(b) * N,
    uv.getX(c) * N, uv.getY(c) * N,
  );
}
const label = new Int32Array(N * N).fill(-1);
let next = 0;
for (let s = 0; s < N * N; s++) {
  if (grid[s] === 0 || label[s] !== -1) continue;
  const id = next++;
  const st = [s]; label[s] = id;
  while (st.length) {
    const c = st.pop()!; const cx = c % N, cy = (c / N) | 0;
    const nb = [ [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1] ];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nc = ny * N + nx;
      if (grid[nc] === 1 && label[nc] === -1) { label[nc] = id; st.push(nc); }
    }
  }
}

interface Isl { count: number; uMin: number; uMax: number; vMin: number; vMax: number; cx: number; cy: number; cz: number; }
const isl = new Map<number, Isl>();
const wv = new THREE.Vector3();
for (let i = 0; i < uv.count; i++) {
  const u = uv.getX(i), v = uv.getY(i);
  const id = label[cell(u, v)];
  wv.fromBufferAttribute(pos, i).applyMatrix4(world);
  let o = isl.get(id);
  if (!o) { o = { count: 0, uMin: 1, uMax: 0, vMin: 1, vMax: 0, cx: 0, cy: 0, cz: 0 }; isl.set(id, o); }
  o.count++; o.uMin = Math.min(o.uMin, u); o.uMax = Math.max(o.uMax, u); o.vMin = Math.min(o.vMin, v); o.vMax = Math.max(o.vMax, v);
  o.cx += wv.x; o.cy += wv.y; o.cz += wv.z;
}

const frac = (val: number, min: number, s: number) => (val - min) / (s || 1);
const list = [...isl.values()].filter((o) => o.count > uv.count * 0.004).sort((a, b) => b.count - a.count);
console.log(`\n${list.length} îlots notables (bbox en repère éditeur: y=0 en haut) :`);
console.log('idx  verts   uX[min..max]   yTop..yBot(=1-vMax..1-vMin)  centroïde3D(fLong z, fWide x, fUp y)');
list.forEach((o, i) => {
  const cx = o.cx / o.count, cy = o.cy / o.count, cz = o.cz / o.count;
  const fLong = frac(cz, bb.min.z, size.z); // z = avant/arrière
  const fWide = frac(cx, bb.min.x, size.x); // x = gauche/droite
  const fUp = frac(cy, bb.min.y, size.y);   // y = haut/bas
  // repère éditeur : yTop = 1 - vMax, yBot = 1 - vMin
  const yTop = 1 - o.vMax, yBot = 1 - o.vMin;
  console.log(
    `${String(i).padStart(2)}  ${String(o.count).padStart(6)}  ` +
      `u[${o.uMin.toFixed(3)}..${o.uMax.toFixed(3)}]  y[${yTop.toFixed(3)}..${yBot.toFixed(3)}]  ` +
      `(fLong=${fLong.toFixed(2)} fWide=${fWide.toFixed(2)} fUp=${fUp.toFixed(2)})`,
  );
});

// image annotée : îlots colorés + index
const W = 1024, H = 1024;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) img[i * 4 + 3] = 255;
const palette: [number, number, number][] = [
  [255,80,80],[255,180,40],[80,160,255],[180,80,255],[40,220,120],[220,220,40],[255,40,200],[40,220,220],
  [255,120,120],[120,255,120],[120,120,255],[255,200,120],[200,120,255],[120,255,200],[255,255,120],[200,200,200],
];
const idToRank = new Map<number, number>();
list.forEach((o, i) => { for (const [id, x] of isl) if (x === o) idToRank.set(id, i); });
for (let i = 0; i < uv.count; i++) {
  const u = uv.getX(i), v = uv.getY(i);
  const id = label[cell(u, v)];
  const rank = idToRank.get(id);
  if (rank === undefined) continue;
  const c = palette[rank % palette.length];
  const x = Math.round(u * (W - 1)), y = Math.round((1 - v) * (H - 1));
  const p = (y * W + x) * 4; img[p] = c[0]; img[p + 1] = c[1]; img[p + 2] = c[2];
}
writeFileSync(resolve(outDir, 'uv-islands.png'), encodePng(W, H, img));
console.log('\nécrit:', resolve(outDir, 'uv-islands.png'));

// carte pleine des îlots (upscale de la grille floodfill) + numéro d'îlot
const filled = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) filled[i * 4 + 3] = 255;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const gx = Math.min(N - 1, Math.floor((x / W) * N));
    const gy = Math.min(N - 1, Math.floor(((H - 1 - y) / H) * N)); // repère éditeur (haut-gauche)
    const id = label[gy * N + gx];
    if (id < 0) continue;
    const rank = idToRank.get(id);
    if (rank === undefined) continue;
    const c = palette[rank % palette.length];
    const p = (y * W + x) * 4; filled[p] = c[0]; filled[p + 1] = c[1]; filled[p + 2] = c[2];
  }
}
writeFileSync(resolve(outDir, 'uv-islands-filled.png'), encodePng(W, H, filled));
console.log('écrit:', resolve(outDir, 'uv-islands-filled.png'));

function fmt(v: THREE.Vector3) { return `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`; }
