import { getEnv } from 'fabric/node';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Regenerate the compact projection topology from the checked-in official
 * model: npx tsx scripts/generate-livery-surface.ts (run at repository root).
 * Source hash and quantization precision are emitted alongside the data. */
mkdirSync('work/generator-surface', { recursive: true });

Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const source = readFileSync('public/models/car/StadiumCAR2020_OffsetFix.fbx');
const root = new FBXLoader().parse(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), '');
root.updateMatrixWorld(true);
let skin!: THREE.Mesh;
root.traverse((object) => { if (object instanceof THREE.Mesh && /^Skin/i.test(object.name)) skin = object; });
const geometry = skin.geometry;
const position = geometry.attributes.position;
const uv = geometry.attributes.uv;
const normal = geometry.attributes.normal;
const index = geometry.index;
const normalMatrix = new THREE.Matrix3().getNormalMatrix(skin.matrixWorld);
const triangleCount = (index ? index.count : position.count) / 3;
const vi = (triangle: number, corner: number) => index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
const worlds: THREE.Vector3[] = [];
const worldIds: number[] = [];
const worldLookup = new Map<string, number>();
const originalWorld: THREE.Vector3[] = [];
for (let i = 0; i < position.count; i++) {
  const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(skin.matrixWorld);
  originalWorld.push(point);
  const key = point.toArray().map((value) => Math.round(value * 1000)).join(',');
  let id = worldLookup.get(key);
  if (id === undefined) { id = worlds.length; worlds.push(point); worldLookup.set(key, id); }
  worldIds.push(id);
}
const parents = worlds.map((_, i) => i);
function find(i: number): number { return parents[i] === i ? i : (parents[i] = find(parents[i])); }
function union(a: number, b: number) { parents[find(a)] = find(b); }
for (let t = 0; t < triangleCount; t++) {
  const a = worldIds[vi(t, 0)], b = worldIds[vi(t, 1)], c = worldIds[vi(t, 2)];
  union(a, b); union(b, c);
}
const components = new Map<number, { triangles: number; box: THREE.Box3 }>();
for (let t = 0; t < triangleCount; t++) {
  const ids = [0, 1, 2].map((corner) => vi(t, corner));
  const id = find(worldIds[ids[0]]);
  let component = components.get(id);
  if (!component) { component = { triangles: 0, box: new THREE.Box3() }; components.set(id, component); }
  component.triangles++;
  for (const i of ids) component.box.expandByPoint(originalWorld[i]);
}
const bodyComponents = new Set<number>();
const bodyBounds = new THREE.Box3();
for (const [id, component] of components) {
  const size = component.box.getSize(new THREE.Vector3());
  const mainBody = component.triangles > 5000 && size.z > 300;
  const intakeOuterBody = component.triangles === 428 && size.z > 60 && size.z < 63 && size.y > 33;
  const rearCowling = component.triangles === 528 && component.box.max.z < -120 && size.x > 100;
  if (mainBody || intakeOuterBody || rearCowling) { bodyComponents.add(id); bodyBounds.union(component.box); }
}
if (bodyComponents.size !== 4) throw new Error(`Unexpected connected body components: ${bodyComponents.size}`);
const vertices: number[][] = [];
const vertexLookup = new Map<string, number>();
const triangles: number[][] = [];
const masks: number[] = [];
const min = bodyBounds.min.toArray(), max = bodyBounds.max.toArray();
const normalAverage = new THREE.Vector3();
const uvCanonical = new Map<number, { x: number; y: number }[]>();
for (let t = 0; t < triangleCount; t++) {
  const ids = [0, 1, 2].map((corner) => vi(t, corner));
  if (!bodyComponents.has(find(worldIds[ids[0]]))) continue;
  normalAverage.set(0, 0, 0);
  let centerX = 0, centerY = 0;
  for (const i of ids) {
    normalAverage.add(new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix));
    centerX += originalWorld[i].x / 3; centerY += originalWorld[i].y / 3;
  }
  normalAverage.normalize();
  // Side vinyles may wrap around a sloping sidewall, but never the floor or
  // inward-facing cockpit walls. The topology already excludes wheels,
  // the intake bezels, mirrors, mechanical accessories and rear undertray.
  const aboveFloor = normalAverage.y > -.5;
  let mask = 0;
  if (aboveFloor && centerX > .2 && normalAverage.x > .025) mask |= 1;
  if (aboveFloor && centerX < -.2 && normalAverage.x < -.025) mask |= 2;
  if (normalAverage.y > .05 && centerY > 30) mask |= 4;
  if (!mask) continue;
  const coords = ids.map((i) => [uv.getX(i), 1 - uv.getY(i)]);
  const area = (coords[1][0] - coords[0][0]) * (coords[2][1] - coords[0][1]) - (coords[1][1] - coords[0][1]) * (coords[2][0] - coords[0][0]);
  if (Math.abs(area) < 1e-10) continue;
  const row: number[] = [];
  for (let corner = 0; corner < 3; corner++) {
    const i = ids[corner];
    // FBX repeats a shared vertex at material/normal seams with minute float
    // differences. Use one world point and one UV point within the same chart
    // before packing, so projected shared edges have exactly identical ends.
    const worldId = worldIds[i];
    let copies = uvCanonical.get(worldId);
    if (!copies) { copies = []; uvCanonical.set(worldId, copies); }
    const existing = copies.find((copy) => Math.hypot(copy.x - coords[corner][0], copy.y - coords[corner][1]) < 2e-6);
    const canonical = existing ?? { x: coords[corner][0], y: coords[corner][1] };
    if (!existing) copies.push(canonical);
    const values = [canonical.x, canonical.y, ...worlds[worldId].toArray().map((value, axis) => (value - min[axis]) / (max[axis] - min[axis]))];
    const words = values.map((value) => Math.max(0, Math.min(65535, Math.round(value * 65535))));
    const key = words.join(',');
    let id = vertexLookup.get(key);
    if (id === undefined) { id = vertices.length; vertices.push(words); vertexLookup.set(key, id); }
    row.push(id);
  }
  triangles.push(row); masks.push(mask);
}
if (vertices.length >= 65536) throw new Error('Surface index exceeds 16-bit packing');
const buffer = Buffer.alloc(vertices.length * 10 + triangles.length * 7);
let offset = 0;
for (const vertex of vertices) for (const word of vertex) { buffer.writeUInt16LE(word, offset); offset += 2; }
for (const triangle of triangles) for (const word of triangle) { buffer.writeUInt16LE(word, offset); offset += 2; }
for (const mask of masks) buffer.writeUInt8(mask, offset++);
const hash = createHash('sha256').update(source).digest('hex');
const data = `/** Generated from the official Stadium FBX; do not edit the packed topology.\n * Regenerate: npx tsx scripts/generate-livery-surface.ts\n * World-space components, not named UV regions, exclude all wheel geometry.\n * Quantized UV precision: <= 0.016 px at 2048; world error <= 0.003 FBX units.\n */\nexport const GENERATOR_SURFACE_SOURCE_SHA256 = '${hash}';\nexport const GENERATOR_SURFACE_MIN = ${JSON.stringify(min)} as const;\nexport const GENERATOR_SURFACE_MAX = ${JSON.stringify(max)} as const;\nexport const GENERATOR_SURFACE_VERTEX_COUNT = ${vertices.length};\nexport const GENERATOR_SURFACE_TRIANGLE_COUNT = ${triangles.length};\nexport const GENERATOR_SURFACE_PACKED = '${buffer.toString('base64')}';\n`;
writeFileSync('src/generatorSurfaceData.ts', data);
const stats = { sourceHash: hash, vertices: vertices.length, triangles: triangles.length, packedBytes: buffer.length, sourceBytes: Buffer.byteLength(data), bounds: { min, max }, masks: Object.fromEntries([1, 2, 4].map((bit) => [bit, masks.filter((mask) => mask & bit).length])) };
writeFileSync('work/generator-surface/stats.json', JSON.stringify(stats, null, 2));
console.log(stats);
