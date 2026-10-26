import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEnv } from 'fabric/node';
import { CanvasTexture, Group, MeshPhysicalMaterial, MeshStandardMaterial, Scene } from 'three';
import { loadSkinImportPreview } from '../src/skinImportPreview';
import { CarPreview } from '../src/three/CarPreview';
import { PreviewSurfaceTextures } from '../src/three/previewSurfaceTextures';
import { PreviewAmbientOcclusion } from '../src/three/previewAmbientOcclusion';
import { encodeDDS } from '../src/dds';
import type { MapId } from '../src/maps';
import type { Skin3DProject } from '../src/skin3d';

// Minimal embedded geometry fixtures exercise GLTFLoader and real model replacement.
function glb(name: string): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], buffers: [{ byteLength: positions.byteLength }],
  });
  const bytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const buffer = new ArrayBuffer(28 + bytes.length + positions.byteLength);
  const view = new DataView(buffer);
  [0x46546c67, 2, buffer.byteLength, bytes.length, 0x4e4f534a].forEach((n, i) => view.setUint32(i * 4, n, true));
  new Uint8Array(buffer, 20, bytes.length).set(bytes);
  view.setUint32(20 + bytes.length, positions.byteLength, true); view.setUint32(24 + bytes.length, 0x004e4942, true);
  new Uint8Array(buffer, 28 + bytes.length).set(new Uint8Array(positions.buffer));
  return buffer;
}

Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const bytes = readFileSync(new URL('../public/models/car/StadiumCAR2020_OffsetFix.fbx', import.meta.url));
const official = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const carRoot = new Group();
const materials = { skin: new MeshPhysicalMaterial(), details: new MeshStandardMaterial(), wheels: new MeshStandardMaterial() };
const glass = new MeshPhysicalMaterial();
const surfaceTextures = new PreviewSurfaceTextures(materials, 1);
const ambientOcclusion = new PreviewAmbientOcclusion(materials, 1);
const pixels = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
const nativeNormal = encodeDDS(pixels, 'BC5', { colorSpace: 'linear' });
const nativeAO = encodeDDS(pixels, 'BC1', { colorSpace: 'linear' });
await surfaceTextures.loadNativeTextures(async () => nativeNormal);
await ambientOcclusion.loadNativeTextures(async () => nativeAO);
surfaceTextures.setWheelSurface({ mode: 'relief', strength: 1 });
ambientOcclusion.setWheelSurface({ mode: 'relief', strength: 1 });
const textures = new Map<MapId, CanvasTexture>();
const rmPacks = new Map<MapId, { canvas: HTMLCanvasElement; texture: CanvasTexture }>();
const preview = Object.create(CarPreview.prototype) as CarPreview;
Object.assign(preview, {
  disposed: false, loadGeneration: 0, officialModelBuffer: null, carRoot, modelRoot: null,
  importedMaterials: [], scene: new Scene(), vehicleRig: null, pendingView: null,
  controls: {}, skinMat: materials.skin, detailsMat: materials.details,
  wheelsMat: materials.wheels, glassMat: glass, surfaceTextures, ambientOcclusion,
  renderer: { capabilities: { getMaxAnisotropy: () => 1 } },
  textures, rmPacks, baseSources: new Map(), dirtMasks: new Map(), dirtCanvases: new Map(),
  illumination: new Map(), wheelAppearanceCanvases: new Map(), wheelRoughnessSource: null,
  coatIntensity: 1, emissiveIntensity: 1.4, dirtAmount: 0, dirtEnabled: true,
  uvFocus: null, exportPreviewActive: false,
  fetchModelBuffer: async () => official, applyHomeFraming: () => {}, hideLoadingOverlay: () => {}, showLoadingError: () => {},
});
const lifecycle = preview as unknown as { initDefaultRoughnessPack(): void; detachModel(): void };
lifecycle.initDefaultRoughnessPack();
const paint = document.createElement('canvas'); paint.width = paint.height = 4;
paint.getContext('2d')!.fillStyle = '#7395ad'; paint.getContext('2d')!.fillRect(0, 0, 4, 4);
const finish = document.createElement('canvas'); finish.width = finish.height = 4;
finish.getContext('2d')!.fillStyle = '#531c00'; finish.getContext('2d')!.fillRect(0, 0, 4, 4);
preview.setMapCanvas('Wheels_B', paint); preview.setMapCanvas('Wheels_R', finish);
const originalPaint = paint.toDataURL(), originalFinish = finish.toDataURL();
const customLoads: { buffer: ArrayBuffer; options: Parameters<CarPreview['loadCustomPreview']>[1] }[] = [];
const importPreview = {
  async loadCustomPreview(buffer: ArrayBuffer, options?: Parameters<CarPreview['loadCustomPreview']>[1]) {
    customLoads.push({ buffer, options }); await preview.loadCustomPreview(buffer, options);
  },
  loadOfficialModel: () => preview.loadOfficialModel(),
};
const mesh = new Uint8Array([1, 2, 3]);
const passthrough = [{ name: 'MainBody.Anim.Gbx', data: new Uint8Array([4, 5]) }];
const project = (name: string, buffer: ArrayBuffer | null): Skin3DProject => ({
  name, mesh, passthrough, preview: buffer,
  parts: [{ key: 'part', mesh: name, label: name, family: 'skin', fillRule: 'evenodd', polygons: [] }],
});
const hat = project('WitchHat', glb('WitchHat'));
try {
await loadSkinImportPreview(hat, importPreview);
assert(carRoot.getObjectByName('WitchHat'));
assert.equal(materials.wheels.normalMap, null, 'Custom UVs do not inherit native tyre normals');
assert.equal(materials.wheels.aoMap, null, 'Custom UVs do not inherit native tyre prelight');

const gameOnly = project('SteelBalls', null);
const fallback = await loadSkinImportPreview(gameOnly, importPreview);
assert(!carRoot.getObjectByName('WitchHat'), 'Game ZIP without GLB must remove the previous hat');
assert.equal(carRoot.children.length, 1);
assert.equal(fallback.model?.mesh, mesh, 'Game mesh bytes must survive the generic preview');
assert.equal(fallback.model?.passthrough, passthrough, 'Animation files must survive');
assert.equal(fallback.model?.parts, undefined, 'Custom UV guides do not describe the official fallback');
assert(gameOnly.parts, 'Import source is not mutated');
assert.match(fallback.warning!, /skin3d-project.zip/);

await loadSkinImportPreview(hat, importPreview);
const spheres = project('SteelBalls', glb('SteelBalls'));
const loaded = await loadSkinImportPreview(spheres, importPreview);
assert(carRoot.getObjectByName('SteelBalls'), 'Full app ZIP installs its actual custom geometry');
assert(!carRoot.getObjectByName('WitchHat'));
assert.equal(loaded.model, spheres); assert.equal(loaded.warning, null);
assert.equal(loaded.model.parts, spheres.parts);

const tyreModel: Skin3DProject = { ...project('NativeTyres', glb('NativeTyres')), surfaceTemplate: 'tyres' };
const nativeLoaded = await loadSkinImportPreview(tyreModel, importPreview);
assert.equal(customLoads.at(-1)?.buffer, tyreModel.preview);
assert.equal(customLoads.at(-1)?.options?.nativeSurfaceLayout, true, 'The tyre topology marker restores its native surface layout');
assert.equal(nativeLoaded.model, tyreModel); assert.equal(nativeLoaded.warning, null);
assert(carRoot.getObjectByName('NativeTyres'));
assert(materials.wheels.normalMap && materials.wheels.aoMap, 'Real normal and prelight controllers rebind native tyre maps after model replacement');
assert.equal(materials.wheels.map?.image, paint, 'Replacing tyre geometry retains the editable colour source');
assert.equal(paint.toDataURL(), originalPaint); assert.equal(finish.toDataURL(), originalFinish);
assert.deepEqual([...rmPacks.get('Wheels_R')!.canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data], [255, 83, 28, 255], 'Model replacement preserves the exact painted roughness/metalness pack');
await loadSkinImportPreview(spheres, importPreview);
assert.equal(materials.wheels.normalMap, null, 'Returning to custom UVs releases native tyre normals again');
assert.equal(materials.wheels.aoMap, null, 'Returning to custom UVs releases native tyre prelight again');

const bad = await loadSkinImportPreview(project('Broken', new ArrayBuffer(8)), importPreview);
assert(!carRoot.getObjectByName('SteelBalls'), 'Broken GLB also removes stale geometry');
assert.equal(bad.model?.preview, null, 'Broken preview must not be saved as loaded');
assert.equal(bad.model?.parts, undefined); assert.equal(bad.model?.mesh, mesh);
assert.match(bad.warning!, /illisible/);

await loadSkinImportPreview(hat, importPreview);
assert.equal((await loadSkinImportPreview(null, importPreview)).model, null);
assert(!carRoot.getObjectByName('WitchHat'), 'Texture-only import restores the official model');

await loadSkinImportPreview(hat, importPreview);
Object.assign(preview, { officialModelBuffer: null, fetchModelBuffer: async () => { throw new Error('Hors ligne'); } });
const report = console.error; console.error = () => {};
try {
  await assert.rejects(loadSkinImportPreview(gameOnly, importPreview), /Hors ligne/, 'Failed fallback aborts before the app commits imported state');
  assert(carRoot.getObjectByName('WitchHat'), 'Failed fallback leaves the previous project display intact');
} finally { console.error = report; }
console.log('PASS: ZIP preview transitions, native tyre normal/prelight lifecycle, paint preservation, missing/broken GLB and failed fallback.');
} finally {
  lifecycle.detachModel(); surfaceTextures.dispose(); ambientOcclusion.dispose();
  for (const texture of textures.values()) texture.dispose();
  for (const { texture } of rmPacks.values()) texture.dispose();
  for (const material of [...Object.values(materials), glass]) material.dispose();
}
