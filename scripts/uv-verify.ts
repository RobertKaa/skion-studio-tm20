/**
 * Throwaway: superpose les nouveaux SKIN_REGIONS sur le wireframe UV réel pour
 * vérifier visuellement l'alignement. Lancer: npx.cmd tsx scripts/uv-verify.ts
 */
const fakeImg = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, set src(_v: string) {} });
(globalThis as unknown as { document: unknown }).document = { createElementNS: () => fakeImg(), createElement: () => fakeImg() };

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { encodePng } from './png.ts';
import { SKIN_REGIONS } from '../src/maps.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buf = readFileSync(resolve(__dirname, '../public/models/car/StadiumCAR2020_OffsetFix.fbx'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const root = new FBXLoader().parse(ab as ArrayBuffer, '');
let mesh: THREE.Mesh | null = null;
root.traverse((o) => { if (o instanceof THREE.Mesh && /skin/i.test(o.name)) mesh = o; });
const geo = (mesh as unknown as THREE.Mesh).geometry as THREE.BufferGeometry;
const uv = geo.attributes.uv;
const idx = geo.index;

const W = 1024, H = 1024;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) img[i * 4 + 3] = 255;
const px = (u: number) => Math.round(u * (W - 1));
const py = (v: number) => Math.round((1 - v) * (H - 1));
const set = (x: number, y: number, r: number, g: number, b: number) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = (y * W + x) * 4; img[p] = r; img[p + 1] = g; img[p + 2] = b;
};
const line = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) { set(x0, y0, c[0], c[1], c[2]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x0 += sx; } if (e2 < dx) { err += dx; y0 += sy; } }
};

const tri = idx ? idx.count / 3 : uv.count / 3;
const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
for (let t = 0; t < tri; t++) {
  const a = vi(t, 0), b = vi(t, 1), c = vi(t, 2);
  const pa: [number, number] = [px(uv.getX(a)), py(uv.getY(a))];
  const pb: [number, number] = [px(uv.getX(b)), py(uv.getY(b))];
  const pc: [number, number] = [px(uv.getX(c)), py(uv.getY(c))];
  line(pa[0], pa[1], pb[0], pb[1], [50, 90, 60]);
  line(pb[0], pb[1], pc[0], pc[1], [50, 90, 60]);
  line(pc[0], pc[1], pa[0], pa[1], [50, 90, 60]);
}

// rectangles des régions (repère éditeur : x,y depuis le haut-gauche)
for (const [, r] of Object.entries(SKIN_REGIONS)) {
  const x0 = Math.round(r.x * W), y0 = Math.round(r.y * H);
  const x1 = Math.round((r.x + r.w) * W), y1 = Math.round((r.y + r.h) * H);
  const c: [number, number, number] = [255, 80, 80];
  line(x0, y0, x1, y0, c); line(x1, y0, x1, y1, c); line(x1, y1, x0, y1, c); line(x0, y1, x0, y0, c);
  line(x0, y0 + 1, x1, y0 + 1, c); line(x0, y1 - 1, x1, y1 - 1, c);
}
writeFileSync(resolve(__dirname, 'out/uv-verify.png'), encodePng(W, H, img));
console.log('écrit: scripts/out/uv-verify.png');
