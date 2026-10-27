import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { getEnv } from 'fabric/node';
import { previewMeshMaterialSlot } from '../src/three/materialSlots';
import { createWheelVisibleArea } from '../src/wheelDesignArea';
import { createMaterialDefinition, type MaterialLayer, type MaterialRegion } from '../src/materials/types';
import { embeddedGlbData } from '../src/blenderParts';
import { mappedMaterialRegions } from '../src/realUvAtlas';
import type { ProjectionTriangle } from '../src/three/decalProjection';

Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const loadTexture = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
const raw = readFileSync('public/models/car/StadiumCAR2020_OffsetFix.fbx');
let model: THREE.Group;
try { model = new FBXLoader().parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), ''); }
finally { THREE.TextureLoader.prototype.load = loadTexture; }
let box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3()); model.scale.setScalar(4.2 / Math.max(size.x, size.y, size.z));
box = new THREE.Box3().setFromObject(model); const center = box.getCenter(new THREE.Vector3());
model.position.set(-center.x, -box.min.y, -center.z); model.updateMatrixWorld(true);
const geometry: ProjectionTriangle[] = [];
model.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  const family = previewMeshMaterialSlot(material.name, object.name);
  if (family !== 'skin' && family !== 'details' && family !== 'wheels') return;
  const position = object.geometry.getAttribute('position'), uv = object.geometry.getAttribute('uv'), normal = object.geometry.getAttribute('normal'), indices = object.geometry.index;
  if (!position || !uv) return;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
  for (let i = 0; i + 2 < (indices?.count ?? position.count); i += 3) {
    const ids = [0, 1, 2].map(offset => indices?.getX(i + offset) ?? i + offset);
    geometry.push({ family,
      points: ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id).applyMatrix4(object.matrixWorld).toArray()) as ProjectionTriangle['points'],
      uv: ids.map(id => [uv.getX(id), uv.getY(id)]) as ProjectionTriangle['uv'],
      ...(normal ? { normals: ids.map(id => new THREE.Vector3().fromBufferAttribute(normal, id).applyNormalMatrix(normalMatrix).toArray()) as ProjectionTriangle['normals'] } : {}),
    });
  }
});
const before = JSON.stringify(geometry), wheels = geometry.filter(t => t.family === 'wheels');
const image = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
const count = (data: Uint8ClampedArray) => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) n++; return n; };
const started = performance.now(), outer = createWheelVisibleArea(geometry, 'outer', { size: 256 })!;
assert(outer, 'A supported real FBX produces a visible-area mask');
const pixels = image(outer), total = count(pixels), visible = (x: number, y: number) => pixels[(y * 256 + x) * 4 + 3];
assert(total > 1000 && total < 20000, 'The tyre occupies an annulus with a limited paintable surface');
assert.equal(visible(128, 128), 0, 'The hole or rim center is never reported as printable');
const rawTyre = createWheelVisibleArea(wheels, 'outer', { size: 256 })!; assert(rawTyre);
const tyrePixels = image(rawTyre); let added = 0;
for (let i = 3; i < pixels.length; i += 4) if (pixels[i] && !tyrePixels[i]) added++;
assert.equal(added, 0, 'Actual rim triangles cannot create newly printable rubber');
// A known piece placed in front of the actual rubber must create an actual
// hole in the source-space mask, rather than producing an idealized annulus.
const chosen = wheels.filter(t => t.points.reduce((sum, point) => sum + point[0], 0) > 0
  && t.points.reduce((sum, point) => sum + point[2], 0) > 0);
const yPositions = chosen.flatMap(t => t.points.map(p => p[1])), zPositions = chosen.flatMap(t => t.points.map(p => p[2]));
const xs = chosen.flatMap(t => t.points.map(p => p[0])).sort((a, b) => a - b);
const loY = Math.min(...yPositions), hiY = Math.max(...yPositions), loZ = Math.min(...zPositions), hiZ = Math.max(...zPositions);
const x = xs[Math.floor(xs.length * .95)] + (hiY - loY) * .04;
const y0 = loY + (hiY - loY) * .83, y1 = loY + (hiY - loY) * .93;
const z0 = loZ + (hiZ - loZ) * .43, z1 = loZ + (hiZ - loZ) * .57;
const cover: ProjectionTriangle[] = [
  { family: 'skin', points: [[x,y0,z0],[x,y1,z0],[x,y1,z1]], uv: [[0,0],[0,0],[0,0]] },
  { family: 'skin', points: [[x,y0,z0],[x,y1,z1],[x,y0,z1]], uv: [[0,0],[0,0],[0,0]] },
];
const coveredMask = createWheelVisibleArea([...geometry, ...cover], 'outer', { size: 256 })!; assert(coveredMask);
const coveredPixels = image(coveredMask); let syntheticHole = 0, holeY = 0;
for (let i = 3; i < pixels.length; i += 4) if (pixels[i] && !coveredPixels[i]) { syntheticHole++; holeY += Math.floor(i / 4 / 256); }
assert(syntheticHole > 100, 'A real 3D obstruction creates a matching local hole in artwork space');
assert(holeY / syntheticHole < 80, 'An obstruction at the physical top is shown at the top of the artwork');
const otherWheel = createWheelVisibleArea([...geometry, ...cover], 'outer', { size: 256, center: [-1, center.y, 1] })!;
const otherClear = createWheelVisibleArea(geometry, 'outer', { size: 256, center: [-1, center.y, 1] })!;
assert(otherWheel && otherClear); assert.deepEqual(image(otherWheel), image(otherClear), 'Only the selected wheel occurrence receives its own obstruction');
const inner = createWheelVisibleArea(geometry, 'inner', { size: 256 })!; assert(inner);
assert(count(image(inner)) > 1000, 'The inner side is computed independently');
assert.notDeepEqual(image(inner), pixels, 'Inner and outer sidewall geometry are not assumed to match');
const transform = createMaterialDefinition(); transform.transform = { ...transform.transform, projection: 'wheel-face', mode: 'contain', size: 256, angle: 90 };
const rotated = createWheelVisibleArea(geometry, 'outer', { size: 256, definition: transform })!; assert(rotated);
const rotatedPixels = image(rotated); let same = 0, compared = 0;
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
  const a = rotatedPixels[(y * 256 + x) * 4 + 3] > 0, b = pixels[(x * 256 + 255 - y) * 4 + 3] > 0;
  if (a === b) same++; compared++;
}
assert(same / compared > .985, 'The material rotation is reflected in the construction-area mask');
assert.equal(createWheelVisibleArea([], 'outer'), null);
assert.equal(createWheelVisibleArea(geometry, 'outer', { size: 2048 }), null);
assert.equal(createWheelVisibleArea(geometry, 'outer', { center: [Number.NaN, 0, 0] }), null);
assert.equal(createWheelVisibleArea(geometry, 'outer', { pose: { steering: 10, spin: 0, reactor: 'off' } }), null);
const unsafe = [{ family: 'wheels', points: [[Infinity,0,0],[0,0,0],[0,0,0]], uv: [[0,0],[1,0],[0,1]] }] as ProjectionTriangle[];
assert.equal(createWheelVisibleArea(unsafe, 'outer'), null, 'Non-finite untrusted geometry is refused');
const organized = geometry.map(t => t.family === 'wheels'
  ? { ...t, sourceUv: t.uv, uv: t.uv.map(([u, v]) => [.1 + u * .4, .2 + v * .6]) as ProjectionTriangle['uv'] } : t);
const organizedMask = createWheelVisibleArea(organized, 'outer', { size: 256 });
assert(organizedMask); assert.deepEqual(image(organizedMask), pixels, 'Reorganized atlas keeps the actual source UV sidewall and its physical mask');
const rectangle = (key: string, left: number, right: number, top: number, bottom: number): MaterialRegion => ({ key, label: key,
  polygons: [[{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]] });
const layer: MaterialLayer = { definition: { ...transform, transform: { ...transform.transform, angle: 0 } }, family: 'wheels',
  regions: [rectangle('included', .8, 1, 0, .7)], exclusions: [rectangle('excluded', .8, 1, .2, .4)] };
const clippedMask = createWheelVisibleArea(geometry, 'outer', { size: 256, layer }); assert(clippedMask);
const clippedPixels = image(clippedMask); let removed = 0, kept = 0;
for (let i = 3; i < pixels.length; i += 4) {
  if (pixels[i] && !clippedPixels[i]) removed++;
  if (pixels[i] && clippedPixels[i]) kept++;
  assert(!clippedPixels[i] || pixels[i], 'Layer masks never create printable pixels outside visible rubber');
}
assert(removed > 1000 && kept > 1000, 'Real region inclusion and exclusions both modify the printable region');
const asNative: MaterialLayer = { ...layer, nativeAtlas: 'stock' };
const nativeAtlasMask = createWheelVisibleArea(organized, 'outer', { size: 256, layer: asNative });
assert(nativeAtlasMask); assert.deepEqual(image(nativeAtlasMask), clippedPixels, 'Native material masks use source UV after atlas reorganization');
const asOrganized: MaterialLayer = { ...layer, organizedAtlas: 'stock',
  regions: mappedMaterialRegions(layer.regions, 'wheels', 'stock'), exclusions: mappedMaterialRegions(layer.exclusions, 'wheels', 'stock') };
const organizedLayerMask = createWheelVisibleArea(geometry, 'outer', { size: 256, layer: asOrganized });
assert(organizedLayerMask);
const mappedPixels = image(organizedLayerMask); let equal = 0;
for (let i = 3; i < pixels.length; i += 4) if (!!mappedPixels[i] === !!clippedPixels[i]) equal++;
assert(equal / (256 * 256) > .97, 'Organized material regions retain their physical coverage when mapped from native UV');
const glbBytes = readFileSync('public/models/relief/preview.glb');
const glb = embeddedGlbData(glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength));
const read = (id: number) => {
  const accessor = glb.gltf.accessors[id], bufferView = glb.gltf.bufferViews[accessor.bufferView];
  const axes = accessor.type === 'VEC3' ? 3 : accessor.type === 'VEC2' ? 2 : 1;
  const offset = glb.binStart + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = bufferView.byteStride ?? axes * 4;
  return (i: number, c = 0) => accessor.componentType === 5126 ? glb.view.getFloat32(offset + i * stride + c * 4, true) : glb.view.getUint32(offset + i * stride, true);
};
const native: ProjectionTriangle[] = [];
for (const mesh of glb.gltf.meshes) for (const primitive of mesh.primitives) {
  const material = glb.gltf.materials[primitive.material].name;
  const family = material.endsWith('_Wheels') ? 'wheels' : material.endsWith('_Skin') ? 'skin' : material.endsWith('_Details') ? 'details' : null;
  if (!family || primitive.attributes.POSITION === undefined || primitive.attributes.TEXCOORD_0 === undefined) continue;
  const position = read(primitive.attributes.POSITION), uv = read(primitive.attributes.TEXCOORD_0), index = read(primitive.indices);
  for (let at = 0; at + 2 < glb.gltf.accessors[primitive.indices].count; at += 3) {
    const ids = [0, 1, 2].map(offset => index(at + offset));
    native.push({ family, points: ids.map(id => [position(id), position(id,1), position(id,2)]) as ProjectionTriangle['points'],
      uv: ids.map(id => [uv(id), uv(id,1)]) as ProjectionTriangle['uv'] });
  }
}
const nativeMask = createWheelVisibleArea(native, 'outer', { size: 256 });
assert(nativeMask && count(image(nativeMask)) > 1000, 'The native GLB provides an actual paintable sidewall');
assert.equal(JSON.stringify(geometry), before, 'Mask calculations never mutate geometry, UVs or the car');
console.log(`✓ Zone 2D réelle : FBX, deux flancs, trous, jante, projection, sécurité et pose (${Math.round(performance.now() - started)} ms)`);
