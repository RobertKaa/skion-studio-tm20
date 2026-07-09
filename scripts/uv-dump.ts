/**
 * Throwaway: charge le FBX Stadium Car en Node et analyse la disposition UV du
 * (ou des) mesh « Skin ». Dump des bounding boxes d'îlots UV pour dériver
 * SKIN_REGIONS. Lancer: npx.cmd tsx scripts/uv-dump.ts
 */
// Stub DOM minimal pour que FBXLoader (TextureLoader/ImageLoader) ne crashe pas
// en Node : on ne s'intéresse qu'à la géométrie/UV, pas aux textures.
const fakeImg = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, set src(_v: string) {} });
(globalThis as unknown as { document: unknown }).document = {
  createElementNS: () => fakeImg(),
  createElement: () => fakeImg(),
};

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fbxPath = resolve(__dirname, '../public/models/car/StadiumCAR2020_OffsetFix.fbx');

const buf = readFileSync(fbxPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const loader = new FBXLoader();
const root = loader.parse(ab as ArrayBuffer, '');

interface MeshInfo {
  name: string;
  matName: string;
  vertCount: number;
  uvMin: [number, number];
  uvMax: [number, number];
  islands: { min: [number, number]; max: [number, number]; count: number }[];
}

const meshes: MeshInfo[] = [];

root.traverse((obj) => {
  if (!(obj instanceof THREE.Mesh)) return;
  const geo = obj.geometry as THREE.BufferGeometry;
  const uv = geo.attributes.uv;
  const mat = obj.material;
  const matName = (Array.isArray(mat) ? mat.map((m) => m?.name).join(',') : mat?.name) ?? '';
  if (!uv) {
    meshes.push({
      name: obj.name,
      matName,
      vertCount: 0,
      uvMin: [NaN, NaN],
      uvMax: [NaN, NaN],
      islands: [],
    });
    return;
  }
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < minU) minU = u;
    if (v < minV) minV = v;
    if (u > maxU) maxU = u;
    if (v > maxV) maxV = v;
  }

  // Détection grossière d'îlots via grille 32x32 puis regroupement connexe.
  const N = 64;
  const grid = new Uint8Array(N * N);
  const cell = (u: number, v: number) => {
    const cu = Math.min(N - 1, Math.max(0, Math.floor(u * N)));
    const cv = Math.min(N - 1, Math.max(0, Math.floor(v * N)));
    return cv * N + cu;
  };
  for (let i = 0; i < uv.count; i++) {
    grid[cell(uv.getX(i), uv.getY(i))] = 1;
  }
  // flood fill des cellules occupées
  const label = new Int32Array(N * N).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < N * N; s++) {
    if (grid[s] === 0 || label[s] !== -1) continue;
    const id = next++;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % N;
      const cy = (c / N) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const nc = ny * N + nx;
          if (grid[nc] === 1 && label[nc] === -1) {
            label[nc] = id;
            stack.push(nc);
          }
        }
      }
    }
  }
  const islandsMap = new Map<number, { minU: number; minV: number; maxU: number; maxV: number; count: number }>();
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const id = label[cell(u, v)];
    let isl = islandsMap.get(id);
    if (!isl) {
      isl = { minU: Infinity, minV: Infinity, maxU: -Infinity, maxV: -Infinity, count: 0 };
      islandsMap.set(id, isl);
    }
    isl.minU = Math.min(isl.minU, u);
    isl.minV = Math.min(isl.minV, v);
    isl.maxU = Math.max(isl.maxU, u);
    isl.maxV = Math.max(isl.maxV, v);
    isl.count++;
  }
  const islands = [...islandsMap.values()]
    .filter((i) => i.count > uv.count * 0.005) // ignore le bruit
    .sort((a, b) => b.count - a.count)
    .map((i) => ({
      min: [round(i.minU), round(i.minV)] as [number, number],
      max: [round(i.maxU), round(i.maxV)] as [number, number],
      count: i.count,
    }));

  meshes.push({
    name: obj.name,
    matName,
    vertCount: uv.count,
    uvMin: [round(minU), round(minV)],
    uvMax: [round(maxU), round(maxV)],
    islands,
  });
});

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

console.log(`Total meshes: ${meshes.length}`);
for (const m of meshes) {
  console.log('\n=====================================');
  console.log(`mesh: "${m.name}"  material: "${m.matName}"`);
  console.log(`  verts(uv): ${m.vertCount}`);
  console.log(`  uv bounds: min(${m.uvMin}) max(${m.uvMax})`);
  console.log(`  islands (${m.islands.length}):`);
  for (const isl of m.islands) {
    const w = round(isl.max[0] - isl.min[0]);
    const h = round(isl.max[1] - isl.min[1]);
    console.log(
      `    min(${isl.min[0].toFixed(3)}, ${isl.min[1].toFixed(3)}) ` +
        `max(${isl.max[0].toFixed(3)}, ${isl.max[1].toFixed(3)}) ` +
        `wh(${w.toFixed(3)}, ${h.toFixed(3)}) verts=${isl.count}`,
    );
  }
}
