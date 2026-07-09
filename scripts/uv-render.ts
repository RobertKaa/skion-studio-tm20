/**
 * Throwaway: rend la disposition UV du mesh Skin_01 en images PNG inspectables.
 *  - scripts/out/uv-wire.png  : wireframe des triangles (bordures d'îlots)
 *  - scripts/out/uv-parts.png : sommets colorés par partie (capot/toit/flancs…)
 * Repère image = repère éditeur (origine haut-gauche, comme l'overlay .uv-guide).
 * Lancer: npx.cmd tsx scripts/uv-render.ts
 */
const fakeImg = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, set src(_v: string) {} });
(globalThis as unknown as { document: unknown }).document = {
  createElementNS: () => fakeImg(),
  createElement: () => fakeImg(),
};

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
root.traverse((o) => { if (o instanceof THREE.Mesh && /skin/i.test(o.name)) mesh = o; });
if (!mesh) throw new Error('Skin mesh introuvable');
const m = mesh as THREE.Mesh;
const geo = m.geometry as THREE.BufferGeometry;
const pos = geo.attributes.position;
const nor = geo.attributes.normal;
const uv = geo.attributes.uv;
const world = m.matrixWorld;
const nmat = new THREE.Matrix3().getNormalMatrix(world);

const W = 1024;
const H = 1024;

// coord image (origine haut-gauche) depuis UV (v=0 en bas côté FBX)
const px = (u: number) => Math.round(u * (W - 1));
const py = (v: number) => Math.round((1 - v) * (H - 1));

function newImg(): Uint8Array {
  const a = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) a[i * 4 + 3] = 255; // opaque noir
  return a;
}
function setPx(img: Uint8Array, x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255;
}
function line(img: Uint8Array, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    setPx(img, x0, y0, c[0], c[1], c[2]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

// -------- wireframe
const wire = newImg();
const idx = geo.index;
const triCount = idx ? idx.count / 3 : pos.count / 3;
const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
for (let t = 0; t < triCount; t++) {
  const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
  const pa = [px(uv.getX(a)), py(uv.getY(a))] as const;
  const pb = [px(uv.getX(b)), py(uv.getY(b))] as const;
  const pc = [px(uv.getX(c)), py(uv.getY(c))] as const;
  line(wire, pa[0], pa[1], pb[0], pb[1], [80, 200, 120]);
  line(wire, pb[0], pb[1], pc[0], pc[1], [80, 200, 120]);
  line(wire, pc[0], pc[1], pa[0], pa[1], [80, 200, 120]);
}
writeFileSync(resolve(outDir, 'uv-wire.png'), encodePng(W, H, wire));

// -------- points colorés par partie
const v = new THREE.Vector3();
const nrm = new THREE.Vector3();
const bb = new THREE.Box3();
for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(world); bb.expandByPoint(v); }
const size = bb.getSize(new THREE.Vector3());
const dims = [{ a: 'x' as const, l: size.x }, { a: 'y' as const, l: size.y }, { a: 'z' as const, l: size.z }].sort((p, q) => q.l - p.l);
const LONG = dims[0].a, WIDE = dims[1].a, UP = dims[2].a;
const g = (vec: THREE.Vector3, a: 'x' | 'y' | 'z') => vec[a];
const frac = (val: number, a: 'x' | 'y' | 'z') => (val - g(bb.min, a)) / (g(size, a) || 1);

const COLORS: Record<string, [number, number, number]> = {
  roof: [255, 80, 80], hood: [255, 180, 40], front: [80, 160, 255], rear: [180, 80, 255],
  left: [40, 220, 120], right: [220, 220, 40], spoiler: [255, 40, 200], floor: [60, 60, 60], other: [120, 120, 120],
};
const parts = newImg();
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i).applyMatrix4(world);
  nrm.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize();
  const fLong = frac(g(v, LONG), LONG), fUp = frac(g(v, UP), UP);
  const nUp = g(nrm, UP), nLong = g(nrm, LONG), nWide = g(nrm, WIDE);
  let part: string;
  if (nUp > 0.55 && fUp > 0.45) part = fLong > 0.55 ? 'hood' : 'roof';
  else if (nUp < -0.55 && fUp < 0.4) part = 'floor';
  else if (Math.abs(nLong) > 0.5 && Math.abs(nLong) >= Math.abs(nWide)) part = nLong > 0 ? 'front' : 'rear';
  else if (Math.abs(nWide) > 0.4) part = nWide > 0 ? 'left' : 'right';
  else part = 'other';
  const c = COLORS[part];
  const x = px(uv.getX(i)), y = py(uv.getY(i));
  setPx(parts, x, y, c[0], c[1], c[2]);
}
writeFileSync(resolve(outDir, 'uv-parts.png'), encodePng(W, H, parts));

console.log('axes long/wide/up =', LONG, WIDE, UP);
console.log('écrit:', resolve(outDir, 'uv-wire.png'));
console.log('écrit:', resolve(outDir, 'uv-parts.png'));
console.log('légende parties:', Object.keys(COLORS).join(', '));
