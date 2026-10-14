import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { decodeDDS, encodeDDS, type RGBAImage } from '../src/dds';
import { PreviewSurfaceTextures, decodeNormalTexture, normalTextureFile, resolveNormalTexture } from '../src/three/previewSurfaceTextures';
import { getWheelTreadNormal } from '../src/wheelSurface';

function solid(r: number, g: number): RGBAImage {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, 0, 255], i);
  return { width: 4, height: 4, data };
}
function bytes(file: string) {
  const data = readFileSync(new URL(`../src/assets/model/car/${file}`, import.meta.url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
const sources = new Map(['Details_N.dds', 'Wheels_N.dds'].map((file) => [file, bytes(file)]));
// Frozen native samples come directly from the physical R/G BC4 endpoints,
// independently of decodeDDS. Their header's A2XY marker reverses ATI2's swap.
const nativeSamples = new Map([
  ['Details_N.dds', { x: 811, y: 43, r: 118, g: 146 }],
  ['Wheels_N.dds', { x: 1, y: 0, r: 21, g: 128 }],
]);
const expected = new Map();
for (const [file, buffer] of sources) {
  const before = new Uint8Array(buffer).slice();
  const raw = decodeDDS(buffer)!;
  const normal = decodeNormalTexture(buffer)!;
  assert.equal(new DataView(buffer).getUint32(88, true), 0x59583241, `${file} retains the native A2XY swizzle marker`);
  const sample = nativeSamples.get(file)!;
  const sampleOffset = (sample.y * normal.width + sample.x) * 4;
  assert.deepEqual([...normal.data.subarray(sampleOffset, sampleOffset + 2)], [sample.r, sample.g], `${file} preserves the native tangent X/Y direction`);
  assert(normal.width > 4 && normal.height > 4, `${file} loads the real native normal atlas`);
  let sloped = 0;
  for (let i = 0; i < normal.data.length; i += 4) {
    assert.equal(normal.data[i], raw.data[i], 'Tangent X is preserved');
    assert.equal(normal.data[i + 1], raw.data[i + 1], 'OpenGL tangent Y is preserved');
    const x = normal.data[i] / 127.5 - 1; const y = normal.data[i + 1] / 127.5 - 1;
    const z = normal.data[i + 2] / 127.5 - 1;
    assert(Math.abs(z - Math.sqrt(Math.max(0, 1 - x * x - y * y))) <= 1 / 255 + .00001, 'BC5 Z is reconstructed, not left black');
    if (Math.abs(x) > .2 || Math.abs(y) > .2) sloped++;
  }
  assert(sloped > 100, `${file} contains visible relief rather than a flat placeholder`);
  assert.deepEqual(new Uint8Array(buffer), before, 'Preview decoding preserves the original export bytes');
  expected.set(file, normal);
}
const directional = decodeNormalTexture(encodeDDS(solid(204, 153), 'BC5'))!;
assert.equal(directional.data[0], 204); assert.equal(directional.data[1], 153);
assert(directional.data[1] > 128, 'A +Y normal remains +Y, matching Nadeo OpenGL car normals');
assert(directional.data[2] > 220, 'A sloped normal still points out from the surface');
assert.equal(decodeNormalTexture(new ArrayBuffer(12)), null);
assert.equal(normalTextureFile('SKIN/WhEeLs_N.DDS'), 'Wheels_N.dds');
assert.equal(normalTextureFile('..\\Details_N.dds'), 'Details_N.dds');
assert.equal(normalTextureFile('Wheels_R.dds'), null);

const native = new Map([['Wheels_N.dds', expected.get('Wheels_N.dds')]] as const);
const flat = decodeNormalTexture(encodeDDS(solid(128, 128), 'BC5'))!;
const imported = new Map([['Wheels_N.dds', flat]] as const);
assert.equal(resolveNormalTexture('Wheels_N.dds', imported, native, true), flat, 'A deliberate smooth wheel overrides native tread');
assert.equal(resolveNormalTexture('Wheels_N.dds', imported, native, false), flat, 'Custom models use their own supplied normal');
assert.equal(resolveNormalTexture('Wheels_N.dds', new Map(), native, false), null, 'Unknown custom UVs do not inherit Stadium normals');
assert.equal(resolveNormalTexture('Wheels_N.dds', new Map(), native, true), native.get('Wheels_N.dds'));

const materials = { details: new THREE.MeshStandardMaterial(), wheels: new THREE.MeshStandardMaterial() };
const manager = new PreviewSurfaceTextures(materials, 8);
await manager.loadNativeTextures(async (url) => sources.get(url.pathname.split('/').pop()!)!);
const smoothWheels = materials.wheels.normalMap! as THREE.DataTexture;
assert.equal(smoothWheels.image.width, 4, 'The default wheel setting is explicitly smooth, matching the export');
manager.setWheelSurface({ mode: 'relief', strength: 1 });
const nativeWheels = materials.wheels.normalMap!;
assert(nativeWheels instanceof THREE.DataTexture);
assert.equal(nativeWheels.colorSpace, THREE.NoColorSpace, 'Normal vectors are linear data, never sRGB');
assert.equal(nativeWheels.flipY, true, 'Normals follow the same image UV convention as color canvases');
assert.equal(nativeWheels.generateMipmaps, true);
assert.equal(nativeWheels.minFilter, THREE.LinearMipmapLinearFilter);
assert.equal(nativeWheels.anisotropy, 8);
assert(materials.details.normalMap, 'Both supported material families receive their native relief');
let disposed = 0; nativeWheels.addEventListener('dispose', () => disposed++);
manager.setOfficialModel(false);
assert.equal(materials.wheels.normalMap, null); assert.equal(materials.details.normalMap, null);
assert.equal(disposed, 1, 'Leaving the official model releases its GPU normal texture');
manager.setFiles([{ name: 'Wheels_N.dds', data: new Uint8Array(encodeDDS(solid(128, 128), 'BC5')) }]);
assert(materials.wheels.normalMap, 'Imported normals work on a custom model');
assert.equal(materials.details.normalMap, null, 'A missing custom normal remains unset');
manager.setFiles([]);
assert.equal(materials.wheels.normalMap, null, 'Clearing an imported skin clears its normal');
manager.setOfficialModel(true);
assert(materials.wheels.normalMap, 'Resetting to the official car restores native tread');
manager.setWheelSurface({ mode: 'smooth', strength: 1 });
assert.equal((materials.wheels.normalMap as THREE.DataTexture).image.width, 4, 'Smooth overrides a native or imported tread');
manager.setOfficialModel(false);
assert.equal((materials.wheels.normalMap as THREE.DataTexture).image.width, 4, 'Smooth also overrides custom wheels without assuming native UVs');
manager.dispose();
assert.equal(materials.wheels.normalMap, null); assert.equal(materials.details.normalMap, null);
await manager.loadNativeTextures(async (url) => sources.get(url.pathname.split('/').pop()!)!);
assert.equal(materials.wheels.normalMap, null, 'Late fetch completion cannot resurrect disposed GPU textures');
materials.details.dispose(); materials.wheels.dispose();

// Presets replace the rolling band while preserving the official moulded
// flanks. Imported grooves must not bleed back into the band or flank source,
// and settings/UI refreshes must not churn GPU resources.
const presetMaterials = { details: new THREE.MeshStandardMaterial(), wheels: new THREE.MeshStandardMaterial() };
const presetManager = new PreviewSurfaceTextures(presetMaterials, 4);
await presetManager.loadNativeTextures(async (url) => sources.get(url.pathname.split('/').pop()!)!);
const importedWheel = { name: 'Wheels_N.dds', data: new Uint8Array(encodeDDS(solid(204, 153), 'BC5')) };
presetManager.setFiles([importedWheel]);
for (const mode of ['semi-slick', 'road', 'rain', 'gravel'] as const) {
  presetManager.setWheelSurface({ mode, strength: 1 });
  const texture = presetMaterials.wheels.normalMap! as THREE.DataTexture;
  const expectedNormal = getWheelTreadNormal(mode, expected.get('Wheels_N.dds'));
  assert.deepEqual([texture.image.width, texture.image.height], [1024, 2048]);
  assert(Buffer.from(texture.image.data as Uint8Array).equals(Buffer.from(expectedNormal.data)), `${mode} uses the same generated band and native moulded flanks as export, independent of imported grooves`);
  assert.equal(texture.colorSpace, THREE.NoColorSpace, 'Generated normals stay linear');
  presetManager.setWheelSurface({ mode, strength: 1 });
  presetManager.setFiles([importedWheel]);
  presetManager.setOfficialModel(true);
  assert.equal(presetMaterials.wheels.normalMap, texture, 'Identical settings and imported resource refresh reuse the GPU texture');
}
const fullPreset = presetMaterials.wheels.normalMap!;
let fullPresetDisposals = 0;
fullPreset.addEventListener('dispose', () => fullPresetDisposals++);
presetManager.setWheelSurface({ mode: 'gravel', strength: .4 });
const reducedPreset = presetMaterials.wheels.normalMap! as THREE.DataTexture;
assert.notEqual(reducedPreset, fullPreset, 'Changing normal strength updates the sculpted surface');
assert.equal(fullPresetDisposals, 1, 'Replacing a generated normal releases exactly one old GPU texture');
presetManager.setOfficialModel(true);
presetManager.setFiles([importedWheel]);
assert.equal(presetMaterials.wheels.normalMap, reducedPreset, 'The transformed preset is cached across unrelated syncs');
let reducedDisposals = 0;
reducedPreset.addEventListener('dispose', () => reducedDisposals++);
presetManager.setOfficialModel(false);
const customFlat = presetMaterials.wheels.normalMap! as THREE.DataTexture;
assert.equal(customFlat.image.width, 4, 'Unknown custom UVs use the same explicit flat preset fallback as export');
assert.equal(reducedDisposals, 1);
presetManager.setFiles([importedWheel]);
assert.equal(presetMaterials.wheels.normalMap, customFlat, 'A saved preset never maps Stadium grooves onto imported custom UVs');
presetManager.setWheelSurface({ mode: 'relief', strength: 1 });
assert.equal((presetMaterials.wheels.normalMap as THREE.DataTexture).image.data[0], 204, 'Returning to imported relief restores the original custom normal');
presetManager.setOfficialModel(true);
presetManager.setWheelSurface({ mode: 'rain', strength: 0 });
assert.equal((presetMaterials.wheels.normalMap as THREE.DataTexture).image.width, 4, 'A preset at zero strength is explicitly smooth');
const finalPreset = presetMaterials.wheels.normalMap!;
let finalPresetDisposals = 0;
finalPreset.addEventListener('dispose', () => finalPresetDisposals++);
presetManager.dispose(); presetManager.dispose();
assert.equal(finalPresetDisposals, 1);
assert.equal(presetMaterials.wheels.normalMap, null);
presetMaterials.details.dispose(); presetMaterials.wheels.dispose();

// A preset can be selected before the shared native request finishes. Once
// loaded, its flat temporary flanks must be replaced with the real moulding.
const lateMaterials = { details: new THREE.MeshStandardMaterial(), wheels: new THREE.MeshStandardMaterial() };
const lateManager = new PreviewSurfaceTextures(lateMaterials, 4);
lateManager.setWheelSurface({ mode: 'semi-slick', strength: 1 });
const pendingTexture = lateMaterials.wheels.normalMap! as THREE.DataTexture;
assert(pendingTexture);
let pendingDisposals = 0;
pendingTexture.addEventListener('dispose', () => pendingDisposals++);
await lateManager.loadNativeTextures(async (url) => sources.get(url.pathname.split('/').pop()!)!);
const loadedTexture = lateMaterials.wheels.normalMap! as THREE.DataTexture;
assert.notEqual(loadedTexture, pendingTexture, 'Native sidewall completion updates an already-selected preset');
assert.equal(pendingDisposals, 1, 'Replacing temporary flanks releases their GPU texture');
const loadedNormal = getWheelTreadNormal('semi-slick', expected.get('Wheels_N.dds'));
assert(Buffer.from(loadedTexture.image.data as Uint8Array).equals(Buffer.from(loadedNormal.data)), 'Late native completion resolves the same band/flank composition');
lateManager.dispose(); lateMaterials.details.dispose(); lateMaterials.wheels.dispose();
console.log('✓ Normales natives réelles, Z BC5, orientation OpenGL, overrides importés, modèle custom, reset et libération GPU');
