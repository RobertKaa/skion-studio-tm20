import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEnv } from 'fabric/node';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ensureWheelTangentFrame } from '../src/three/wheelTangentFrame';

function buffers(geometry: THREE.BufferGeometry) {
  return Object.fromEntries(['position', 'normal', 'uv'].map(name => {
    const attribute = geometry.getAttribute(name);
    return [name, attribute ? { attribute, data: Array.from(attribute.array) } : null];
  }));
}
function assertFrame(geometry: THREE.BufferGeometry, label: string) {
  const before = buffers(geometry), originalIndex = geometry.getIndex(), indexBytes = originalIndex ? Array.from(originalIndex.array) : null;
  ensureWheelTangentFrame(geometry);
  assert.equal(geometry.getIndex(), originalIndex, `${label}: index identity remains intact`);
  if (originalIndex) assert.deepEqual(Array.from(originalIndex.array), indexBytes, `${label}: index bytes remain intact`);
  for (const [name, saved] of Object.entries(before)) if (saved) {
    assert.equal(geometry.getAttribute(name), saved.attribute, `${label}: original ${name} attribute remains attached`);
    assert.deepEqual(Array.from(geometry.getAttribute(name).array), saved.data, `${label}: original ${name} values stay unchanged`);
  }
  const tangent = geometry.getAttribute('tangent'), normal = geometry.getAttribute('normal');
  assert.equal(tangent.count, geometry.getAttribute('position').count);
  const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
  for (let vertex = 0; vertex < tangent.count; vertex++) {
    t.fromBufferAttribute(tangent, vertex);
    n.set(0, 0, 1);
    if (normal && normal.count > vertex) n.fromBufferAttribute(normal, vertex);
    if (!n.toArray().every(Number.isFinite) || n.lengthSq() < 1e-20) n.set(0, 0, 1);
    else n.normalize();
    const handedness = tangent.getW(vertex);
    assert(t.toArray().every(Number.isFinite), `${label}: no generated NaN tangents`);
    assert(Math.abs(t.length() - 1) < 2e-6, `${label}: tangent is unit length`);
    assert(Math.abs(t.dot(n)) < 2e-6, `${label}: tangent stays perpendicular to the original normal`);
    assert(handedness === 1 || handedness === -1, `${label}: handedness is a finite sign`);
    b.crossVectors(n, t).multiplyScalar(handedness);
    assert(Math.abs(b.length() - 1) < 2e-6, `${label}: bitangent is unit length`);
    const mapped = t.clone().multiplyScalar(.3).addScaledVector(b, .4).addScaledVector(n, Math.sqrt(.75));
    assert(Math.abs(mapped.dot(t) - .3) < 2e-6, `${label}: physical normal X amplitude survives the UV metric`);
    assert(Math.abs(mapped.dot(b) - .4) < 2e-6, `${label}: physical normal Y amplitude survives the UV metric`);
    assert(Math.abs(mapped.length() - 1) < 2e-6, `${label}: tangent-space shading remains a unit normal`);
  }
  return tangent;
}

// The wheel atlas has roughly five times more physical distance per V unit.
// That aspect must change texture placement, never attenuate either normal axis.
function plane(indexed: boolean, mirror = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, .283, 0, 0, .283, 2.289, 0, 0, 2.289, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mirror ? [.811564, 0, .200728, 0, .200728, 1, .811564, 1] : [.200728, 0, .811564, 0, .811564, 1, .200728, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return indexed ? geometry : geometry.toNonIndexed();
}
for (const indexed of [true, false]) for (const mirror of [true, false]) {
  const geometry = plane(indexed, mirror), tangent = assertFrame(geometry, `${indexed ? 'indexed' : 'non-indexed'} ${mirror ? 'mirrored' : 'regular'} strip`);
  for (let vertex = 0; vertex < tangent.count; vertex++) {
    assert(Math.abs(tangent.getX(vertex) - (mirror ? -1 : 1)) < 1e-6);
    assert.equal(tangent.getW(vertex), mirror ? -1 : 1, 'Mirrored UVs preserve their opposite handedness');
  }
  geometry.dispose();
}

Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const bytes = readFileSync(new URL('../src/assets/model/car/StadiumCAR2020_OffsetFix.fbx', import.meta.url));
const model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
let realWheel: THREE.Mesh | undefined;
model.traverse(object => { if (object instanceof THREE.Mesh && object.name === 'Wheels_01') realWheel = object; });
assert(realWheel, 'The actual Stadium wheel validates all moulded sidewall and tread frames');
assertFrame(realWheel.geometry, 'real FBX wheel');
assert(realWheel.geometry.getAttribute('tangent').count > 5_000, 'The geometry proof covers the full native wheel mesh');
const nativeUV = realWheel.geometry.getAttribute('uv'), nativeNormal = realWheel.geometry.getAttribute('normal'), nativeTangent = realWheel.geometry.getAttribute('tangent');
let treadVertices = 0, physicallyAligned = 0;
for (let vertex = 0; vertex < nativeUV.count; vertex++) {
  if (nativeUV.getX(vertex) <= .22 || nativeUV.getX(vertex) >= .79 || Math.abs(nativeNormal.getX(vertex)) >= .1) continue;
  treadVertices++;
  if (Math.abs(nativeTangent.getX(vertex)) > .98) physicallyAligned++;
}
assert(treadVertices > 2_000 && physicallyAligned / treadVertices > .99,
  'On the real radial tread, texture U tangents follow the physical wheel axle rather than an arbitrary perpendicular axis');

for (const kind of ['collapsed UV', 'missing UV', 'nonfinite UV', 'nonfinite position', 'nonfinite normal', 'missing normal', 'invalid index']) {
  const geometry = plane(true);
  if (kind === 'collapsed UV') geometry.getAttribute('uv').array.fill(0);
  if (kind === 'missing UV') geometry.deleteAttribute('uv');
  if (kind === 'nonfinite UV') geometry.getAttribute('uv').setXY(0, NaN, Infinity);
  if (kind === 'nonfinite position') geometry.getAttribute('position').setXYZ(0, NaN, 0, 0);
  if (kind === 'nonfinite normal') geometry.getAttribute('normal').setXYZ(0, 0, NaN, 0);
  if (kind === 'missing normal') geometry.deleteAttribute('normal');
  if (kind === 'invalid index') geometry.setIndex([0, 1, 200, 0, 2, 3]);
  assertFrame(geometry, kind);
  geometry.dispose();
}
const empty = new THREE.BufferGeometry(); ensureWheelTangentFrame(empty); assert.equal(empty.getAttribute('tangent'), undefined);
console.log('✓ Wheel tangent frames: real FBX, physical X/Y normal amplitude, orthonormal axes, mirrored handedness, indexed/non-indexed immutable sources and finite degenerate fallbacks');
