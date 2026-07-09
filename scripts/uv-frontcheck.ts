/**
 * Throwaway: vérifie objectivement quel bout en Z est le NEZ de la voiture.
 * Un nez de voiture est plus étroit (largeur X) et plus bas que l'arrière.
 * On mesure aussi la position des roues (essieux) pour recouper.
 * Lancer: npx.cmd tsx scripts/uv-frontcheck.ts
 */
const fakeImg = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {}, set src(_v: string) {} });
(globalThis as unknown as { document: unknown }).document = { createElementNS: () => fakeImg(), createElement: () => fakeImg() };

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buf = readFileSync(resolve(__dirname, '../public/models/car/StadiumCAR2020_OffsetFix.fbx'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const root = new FBXLoader().parse(ab as ArrayBuffer, '');
root.updateWorldMatrix(true, true);

let skin: THREE.Mesh | null = null;
const wheelBoxes: { name: string; c: THREE.Vector3 }[] = [];
root.traverse((o) => {
  if (o instanceof THREE.Mesh && /skin/i.test(o.name)) skin = o;
  if (o instanceof THREE.Mesh && /wheel/i.test(o.name)) {
    const p = (o.geometry as THREE.BufferGeometry).attributes.position;
    const b = new THREE.Box3(); const w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { w.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); b.expandByPoint(w); }
    wheelBoxes.push({ name: o.name, c: b.getCenter(new THREE.Vector3()) });
  }
});
const geo = (skin as unknown as THREE.Mesh).geometry as THREE.BufferGeometry;
const pos = geo.attributes.position;
const world = (skin as unknown as THREE.Mesh).matrixWorld;
console.log('world matrix determinant =', new THREE.Matrix4().extractRotation(world).determinant().toFixed(3),
  '(>0 = pas de miroir, repère main droite conservé)');

const bb = new THREE.Box3(); const v = new THREE.Vector3();
for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(world); bb.expandByPoint(v); }
const zMin = bb.min.z, zMax = bb.max.z, zR = zMax - zMin;

// tranches en z : largeur X et hauteur Y moyenne
const NB = 10;
const wide = new Array(NB).fill(0).map(() => ({ xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity, n: 0 }));
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i).applyMatrix4(world);
  const k = Math.min(NB - 1, Math.max(0, Math.floor(((v.z - zMin) / zR) * NB)));
  const s = wide[k];
  s.xMin = Math.min(s.xMin, v.x); s.xMax = Math.max(s.xMax, v.x);
  s.yMin = Math.min(s.yMin, v.y); s.yMax = Math.max(s.yMax, v.y); s.n++;
}
console.log('\nTranche z (0 = -Z … 9 = +Z) : largeur X et hauteur Y');
wide.forEach((s, k) => {
  const z0 = zMin + (k / NB) * zR, z1 = zMin + ((k + 1) / NB) * zR;
  console.log(`  z[${z0.toFixed(0)}..${z1.toFixed(0)}] largeurX=${(s.xMax - s.xMin).toFixed(1)} hauteurY=${(s.yMax - s.yMin).toFixed(1)} bas=${s.yMin.toFixed(1)} n=${s.n}`);
});
const w0 = wide[0].xMax - wide[0].xMin, w9 = wide[NB - 1].xMax - wide[NB - 1].xMin;
console.log(`\n  Bout -Z largeur=${w0.toFixed(1)}  |  Bout +Z largeur=${w9.toFixed(1)}`);
console.log(`  => le NEZ (plus étroit) est du côté ${w9 < w0 ? '+Z' : '-Z'}`);

console.log('\nRoues (centroïde monde) :');
for (const w of wheelBoxes) console.log(`  ${w.name.padEnd(18)} x=${w.c.x.toFixed(1)} y=${w.c.y.toFixed(1)} z=${w.c.z.toFixed(1)}`);
