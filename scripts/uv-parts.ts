/**
 * Throwaway: corrèle position 3D + normale des sommets du mesh « Skin_01 » avec
 * leurs UV pour dériver quelle zone de la texture correspond à quelle partie de
 * la voiture (capot, toit, flancs, avant, arrière, aileron).
 * Lancer: npx.cmd tsx scripts/uv-parts.ts
 */
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

let skin: THREE.Mesh | null = null;
root.updateWorldMatrix(true, true);
root.traverse((o) => {
  if (o instanceof THREE.Mesh && /skin/i.test(o.name)) skin = o;
});
if (!skin) throw new Error('Skin mesh introuvable');
const mesh = skin as THREE.Mesh;

const geo = mesh.geometry as THREE.BufferGeometry;
const pos = geo.attributes.position;
const nor = geo.attributes.normal;
const uv = geo.attributes.uv;
const world = mesh.matrixWorld;

// bbox monde
const v = new THREE.Vector3();
const bb = new THREE.Box3();
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i).applyMatrix4(world);
  bb.expandByPoint(v);
}
const size = bb.getSize(new THREE.Vector3());
const ctr = bb.getCenter(new THREE.Vector3());
console.log('World bbox size:', fmt(size), 'center:', fmt(ctr));

// Identifier les axes : le plus grand = longueur (avant/arrière), le plus petit
// = hauteur (haut/bas), l'intermédiaire = largeur (gauche/droite).
const dims = [
  { axis: 'x' as const, len: size.x },
  { axis: 'y' as const, len: size.y },
  { axis: 'z' as const, len: size.z },
].sort((a, b) => b.len - a.len);
const LONG = dims[0].axis; // avant/arrière
const WIDE = dims[1].axis; // gauche/droite
const UP = dims[2].axis; // haut/bas
console.log(`axes -> long(av/ar)=${LONG}  wide(g/d)=${WIDE}  up(h/b)=${UP}`);

type Part = 'roof' | 'hood' | 'front' | 'rear' | 'spoiler' | 'left' | 'right' | 'floor' | 'other';
const boxes = new Map<Part, THREE.Box2>();
const counts = new Map<Part, number>();
const add = (p: Part, u: number, w: number) => {
  let b = boxes.get(p);
  if (!b) {
    b = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
    boxes.set(p, b);
  }
  b.expandByPoint(new THREE.Vector2(u, w));
  counts.set(p, (counts.get(p) ?? 0) + 1);
};

const g = (vec: THREE.Vector3, a: 'x' | 'y' | 'z') => vec[a];
const nrm = new THREE.Vector3();
const nmat = new THREE.Matrix3().getNormalMatrix(world);

// fractions le long de chaque axe
const frac = (val: number, a: 'x' | 'y' | 'z') => (val - g(bb.min, a)) / (g(size, a) || 1);

for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i).applyMatrix4(world);
  nrm.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize();
  const u = uv.getX(i);
  const w = uv.getY(i);

  const fLong = frac(g(v, LONG), LONG); // 0 = arrière-ext, 1 = avant-ext (orientation à confirmer)
  const fUp = frac(g(v, UP), UP);
  const nUp = g(nrm, UP);
  const nLong = g(nrm, LONG);
  const nWide = g(nrm, WIDE);
  const fWide = frac(g(v, WIDE), WIDE);

  let part: Part;
  if (nUp > 0.55 && fUp > 0.45) {
    // surface tournée vers le haut : capot (avant) ou toit (arrière)
    part = fLong > 0.55 ? 'hood' : 'roof';
  } else if (nUp < -0.55 && fUp < 0.4) {
    part = 'floor';
  } else if (Math.abs(nLong) > 0.5 && Math.abs(nLong) >= Math.abs(nWide)) {
    part = nLong > 0 ? 'front' : 'rear';
  } else if (Math.abs(nWide) > 0.4) {
    // flanc : haut = aileron si tout à l'arrière et haut
    part = nWide > 0 ? 'left' : 'right';
  } else if (fUp > 0.6 && fLong < 0.25) {
    part = 'spoiler';
  } else {
    part = 'other';
  }
  add(part, u, w);
}

console.log('\nUV bounds par partie (u,v en repère FBX, v=0 en bas) :');
for (const [p, b] of boxes) {
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  console.log(
    `  ${p.padEnd(7)} verts=${String(counts.get(p)).padStart(6)}  ` +
      `u[${b.min.x.toFixed(3)}..${b.max.x.toFixed(3)}] v[${b.min.y.toFixed(3)}..${b.max.y.toFixed(3)}] ` +
      `wh(${w.toFixed(3)},${h.toFixed(3)})`,
  );
}

// Concentration : centroïde + plage inter-percentile (10..90) par partie.
const samples = new Map<Part, { us: number[]; vs: number[] }>();
{
  const nrm2 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(world);
    nrm2.fromBufferAttribute(nor, i).applyMatrix3(nmat).normalize();
    const u = uv.getX(i);
    const w = uv.getY(i);
    const fLong = frac(g(v, LONG), LONG);
    const fUp = frac(g(v, UP), UP);
    const nUp = g(nrm2, UP);
    const nLong = g(nrm2, LONG);
    const nWide = g(nrm2, WIDE);
    let part: Part;
    if (nUp > 0.55 && fUp > 0.45) part = fLong > 0.55 ? 'hood' : 'roof';
    else if (nUp < -0.55 && fUp < 0.4) part = 'floor';
    else if (Math.abs(nLong) > 0.5 && Math.abs(nLong) >= Math.abs(nWide)) part = nLong > 0 ? 'front' : 'rear';
    else if (Math.abs(nWide) > 0.4) part = nWide > 0 ? 'left' : 'right';
    else if (fUp > 0.6 && fLong < 0.25) part = 'spoiler';
    else part = 'other';
    let s = samples.get(part);
    if (!s) { s = { us: [], vs: [] }; samples.set(part, s); }
    s.us.push(u); s.vs.push(w);
  }
}
const pct = (arr: number[], q: number) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * a.length)))];
};
const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
console.log('\nConcentration (centroïde + plage p10..p90) :');
for (const [p, s] of samples) {
  console.log(
    `  ${p.padEnd(7)} centroïde(u=${mean(s.us).toFixed(3)}, v=${mean(s.vs).toFixed(3)}) ` +
      `u[p10=${pct(s.us, 0.1).toFixed(3)} p50=${pct(s.us, 0.5).toFixed(3)} p90=${pct(s.us, 0.9).toFixed(3)}] ` +
      `v[p10=${pct(s.vs, 0.1).toFixed(3)} p50=${pct(s.vs, 0.5).toFixed(3)} p90=${pct(s.vs, 0.9).toFixed(3)}]`,
  );
}

function fmt(vec: THREE.Vector3) {
  return `(${vec.x.toFixed(2)}, ${vec.y.toFixed(2)}, ${vec.z.toFixed(2)})`;
}
