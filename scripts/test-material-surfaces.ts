import assert from 'node:assert/strict';
import * as THREE from 'three';
import { decodeDDS, encodeDDS, type RGBAImage } from '../src/dds';
import { attenuateMaterialAO, composeMaterialSurface, type MaterialSurfaceOverlay } from '../src/materials/surfaceMaps';
import { exportMaterialSurfaces } from '../src/materials/exportSurfaces';
import { PreviewSurfaceTextures, decodeNormalTexture } from '../src/three/previewSurfaceTextures';
import { PreviewAmbientOcclusion, decodeAmbientOcclusion } from '../src/three/previewAmbientOcclusion';
import { buildWheelNormalFile, buildWheelOcclusionFile, withWheelNormalFile, type WheelSurfaceSettings } from '../src/wheelSurface';
import type { Skin3DFile } from '../src/skin3d';

function solid(r: number, g = r, b = r, alpha = 255, width = 4, height = width): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set([r, g, b, alpha], index);
  return { width, height, data };
}
function pixel(image: RGBAImage, x = 0, y = 0) { return [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]; }
const near = (actual: number, expected: number, tolerance = 1) => assert(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
function normalsAreUnit(image: RGBAImage) {
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const components = [0, 1, 2].map((channel) => image.data[offset + channel] / 127.5 - 1);
    near(Math.hypot(...components), 1, .015); assert.equal(image.data[offset + 3], 255);
  }
}
const neutralNormal = solid(128, 128, 255);
const sourceAO = solid(192); const sourceBefore = sourceAO.data.slice();
assert.equal(attenuateMaterialAO(sourceAO, 1), sourceAO, 'Full AO strength retains source identity');
assert.equal(attenuateMaterialAO(null, .5), null);
const fadedAO = attenuateMaterialAO(sourceAO, .4)!;
near(fadedAO.data[0], 255 - (255 - 192) * .4);
assert.equal(attenuateMaterialAO(sourceAO, .4), fadedAO, 'AO strength caches its transformed image');
assert.equal(attenuateMaterialAO(sourceAO, 0)!.data[0], 255, 'Zero strength becomes a neutral white AO');
for (const strength of [NaN, Infinity, -1, 2]) assert.throws(() => attenuateMaterialAO(sourceAO, strength), /Intensité/);
for (const size of [NaN, Infinity, -1, 0, 1.5, 4097]) assert.throws(() => composeMaterialSurface(sourceAO, [], false, size), /Résolution/);
for (const invalid of [{ ...sourceAO, width: 4097 }, { ...sourceAO, height: -1 }, { ...sourceAO, width: 1.5 }, { ...sourceAO, data: new Uint8ClampedArray(3) }]) {
  assert.throws(() => composeMaterialSurface(invalid, [], true), /invalide/);
  assert.throws(() => composeMaterialSurface(null, [invalid], false), /invalide/);
}
assert.throws(() => composeMaterialSurface(null, Array(129).fill(sourceAO), false), /Trop de matériaux/);
assert.equal(composeMaterialSurface(sourceAO, [], false, 8), sourceAO, 'No overlays return the unchanged imported image by identity');
assert.equal(composeMaterialSurface(null, [], true), null, 'An absent surface stays absent');
assert.deepEqual(composeMaterialSurface(sourceAO, [solid(0, 0, 0, 0)], false)!.data, sourceAO.data, 'Transparent masks preserve every source pixel');
const partialAO = composeMaterialSurface(sourceAO, [solid(64, 64, 64, 128)], false)!;
near(partialAO.data[0], 192 * (1 - 128 / 255 + 64 / 255 * 128 / 255));
const stackedAO = composeMaterialSurface(sourceAO, [solid(128), solid(64)], false)!;
near(stackedAO.data[0], 192 * 128 / 255 * 64 / 255);
assert.deepEqual(stackedAO.data, composeMaterialSurface(sourceAO, [solid(64), solid(128)], false)!.data, 'AO layers multiply independently of stacking order');
assert.deepEqual(sourceAO.data, sourceBefore, 'Composition never modifies imported image buffers');
assert.equal(composeMaterialSurface(null, [solid(128)], false)!.data[0], 128, 'A custom model without AO starts from white');

const positiveNormal = solid(204, 128, 230); const negativeNormal = solid(51, 128, 230);
const halfNormal = composeMaterialSurface(positiveNormal, [{ ...negativeNormal, data: solid(51, 128, 230, 128).data }], true)!;
near(halfNormal.data[0], 128); near(halfNormal.data[2], 255); normalsAreUnit(halfNormal);
const fullNormal = composeMaterialSurface(neutralNormal, [positiveNormal], true)!;
near(fullNormal.data[0], 204); near(fullNormal.data[1], 128); normalsAreUnit(fullNormal);
const diagonal = composeMaterialSurface(neutralNormal, [solid(255, 255, 0)], true)!;
normalsAreUnit(diagonal); near(diagonal.data[0], 218); near(diagonal.data[1], 218);
const ordered = composeMaterialSurface(neutralNormal, [solid(204, 128, 230, 128), solid(51, 128, 230, 128)], true)!;
const reversed = composeMaterialSurface(neutralNormal, [solid(51, 128, 230, 128), solid(204, 128, 230, 128)], true)!;
assert(ordered.data[0] < reversed.data[0], 'Normal stacking honors the last painted layer');
normalsAreUnit(ordered); normalsAreUnit(reversed);
const wideAO = solid(128, 128, 128, 255, 2, 1); wideAO.data.set([255, 255, 255, 0], 4);
const resized = composeMaterialSurface(solid(200, 200, 200, 255, 1), [wideAO], false, 8)!;
assert.deepEqual([resized.width, resized.height], [8, 8]); near(pixel(resized, 0, 0)[0], 100); assert.equal(pixel(resized, 7, 7)[0], 200);

const bases: Skin3DFile[] = [
  { name: 'Details_N.dds', data: new Uint8Array(encodeDDS(positiveNormal, 'BC5', { colorSpace: 'linear' })) },
  { name: 'Wheels_N.dds', data: new Uint8Array(encodeDDS(neutralNormal, 'BC5', { colorSpace: 'linear' })) },
  ...['Skin_AO.dds', 'Details_AO.dds', 'Wheels_AO.dds'].map((name) => ({ name, data: new Uint8Array(encodeDDS(sourceAO, 'BC4', { colorSpace: 'linear' })) })),
  { name: 'fakeshad.dds', data: new Uint8Array([1, 2, 3]) },
];
const copies = bases.map((file) => file.data.slice());
const beforeFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async () => { fetches++; throw new Error('Tests must provide all native source files'); };
try {
  const unchanged = await exportMaterialSurfaces(bases, [], 8, true);
  unchanged.forEach((file, index) => assert.equal(file, bases[index], 'A skin without material surfaces retains original DDS and file objects'));
  const skinNormalIgnored = await exportMaterialSurfaces(bases, [{ family: 'skin', normal: negativeNormal }], 8, true);
  assert.deepEqual(skinNormalIgnored, bases); assert(!skinNormalIgnored.some((file) => file.name === 'Skin_N.dds'), 'Unsupported skin normal never creates an extra game texture');
  const maskNormal = solid(51, 128, 230); const maskAO = solid(128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
    maskNormal.data[(y * 4 + x) * 4 + 3] = 0; maskAO.data[(y * 4 + x) * 4 + 3] = 0;
  }
  const layers: MaterialSurfaceOverlay[] = [{ family: 'details', normal: maskNormal, ao: maskAO }, { family: 'skin', ao: solid(64) }];
  const output = await exportMaterialSurfaces(bases, layers, 8, true);
  const detailsNormal = decodeNormalTexture(output.find((file) => file.name === 'Details_N.dds')!.data.slice().buffer)!;
  const detailsAO = decodeAmbientOcclusion(output.find((file) => file.name === 'Details_AO.dds')!.data.slice().buffer)!;
  assert.deepEqual([detailsNormal.width, detailsNormal.height, detailsAO.width, detailsAO.height], [8, 8, 8, 8]);
  near(pixel(detailsNormal, 0, 0)[0], 204, 2); near(pixel(detailsNormal, 7, 7)[0], 51, 2); normalsAreUnit(detailsNormal);
  near(pixel(detailsAO, 0, 0)[0], 192, 2); near(pixel(detailsAO, 7, 7)[0], 96, 2);
  near(decodeDDS(output.find((file) => file.name === 'Skin_AO.dds')!.data.slice().buffer)!.data[0], 48, 2);
  for (const name of ['Wheels_N.dds', 'Wheels_AO.dds', 'fakeshad.dds']) assert.equal(output.find((file) => file.name === name), bases.find((file) => file.name === name), 'Unpainted imported channels remain byte-identical');
  const custom = await exportMaterialSurfaces([], [{ family: 'details', normal: positiveNormal, ao: solid(128) }], 4, false);
  assert.equal(custom.length, 2); near(decodeDDS(custom.find((file) => file.name === 'Details_AO.dds')!.data.slice().buffer)!.data[0], 128);
  await assert.rejects(exportMaterialSurfaces([{ name: 'Details_AO.dds', data: new Uint8Array(12) }], [{ family: 'details', ao: maskAO }], 4, true), /illisible/);
  await assert.rejects(exportMaterialSurfaces([{ name: 'Details_AO.dds', data: bases[0].data }], [{ family: 'details', ao: maskAO }], 4, true), /illisible/, 'A BC5 normal cannot masquerade as an AO base at export');

  const materials = { skin: new THREE.MeshStandardMaterial(), details: new THREE.MeshStandardMaterial(), wheels: new THREE.MeshStandardMaterial() };
  const normalManager = new PreviewSurfaceTextures(materials, 4); const aoManager = new PreviewAmbientOcclusion(materials, 4);
  try {
    normalManager.setFiles(bases); aoManager.setFiles(bases);
    normalManager.setWheelSurface({ mode: 'relief', strength: 1 }); aoManager.setWheelSurface({ mode: 'relief', strength: 1 });
    normalManager.setMaterialOverlays(layers); aoManager.setMaterialOverlays(layers);
    const normalPreview = materials.details.normalMap as THREE.DataTexture; const aoPreview = materials.details.aoMap as THREE.DataTexture;
    const exactNormal = composeMaterialSurface(decodeNormalTexture(bases[0].data.slice().buffer), [maskNormal], true)!;
    const exactAO = composeMaterialSurface(decodeAmbientOcclusion(bases[3].data.slice().buffer), [maskAO], false)!;
    assert.deepEqual(normalPreview.image.data, exactNormal.data); assert.deepEqual(aoPreview.image.data, exactAO.data);
    assert.equal(normalPreview.colorSpace, THREE.NoColorSpace); assert.equal(aoPreview.colorSpace, THREE.NoColorSpace);
    assert.equal(aoPreview.channel, 0); assert.equal(normalPreview.flipY, true); assert.equal(aoPreview.flipY, true);
    let normalDisposals = 0; normalPreview.addEventListener('dispose', () => normalDisposals++);
    normalManager.setMaterialOverlays(layers); assert.equal(materials.details.normalMap, normalPreview, 'Unchanged surface array reuses the GPU normal');
    normalManager.setMaterialOverlays([]); assert.equal(normalDisposals, 1, 'Removing a material surface releases exactly one composite texture');
    assert.deepEqual((materials.details.normalMap as THREE.DataTexture).image.data, decodeNormalTexture(bases[0].data.slice().buffer)!.data, 'Removing overlays restores the original source normal');
    aoManager.setMaterialOverlays([]); assert.deepEqual((materials.details.aoMap as THREE.DataTexture).image.data, decodeAmbientOcclusion(bases[3].data.slice().buffer)!.data);
    const wheelSettings: WheelSurfaceSettings = { mode: 'relief', strength: .4 };
    normalManager.setWheelSurface(wheelSettings); const wheelLayer: MaterialSurfaceOverlay[] = [{ family: 'wheels', normal: positiveNormal }];
    normalManager.setMaterialOverlays(wheelLayer);
    const wheelNormal = await buildWheelNormalFile(wheelSettings, bases, true, async () => bases[1].data);
    const wheelFiles = withWheelNormalFile(bases, wheelNormal, wheelSettings, buildWheelOcclusionFile(wheelSettings, true));
    const wheelOutput = await exportMaterialSurfaces(wheelFiles, wheelLayer, 4, true);
    const wheelGame = decodeNormalTexture(wheelOutput.find((file) => file.name === 'Wheels_N.dds')!.data.slice().buffer)!;
    const wheelPreview = (materials.wheels.normalMap as THREE.DataTexture).image.data as Uint8ClampedArray;
    for (let index = 0; index < wheelPreview.length; index++) near(wheelGame.data[index], wheelPreview[index], 2);

    // Tyre strength applies to its existing grooves, while material AO retains its own strength.
    // Applying a GPU intensity to the final composite would incorrectly fade the material too.
    const wheelAOLayer: MaterialSurfaceOverlay[] = [{ family: 'wheels', ao: solid(128) }];
    for (const settings of [{ mode: 'smooth', strength: 1 }, { mode: 'relief', strength: .4 }, { mode: 'road', strength: .4 }] satisfies WheelSurfaceSettings[]) {
      aoManager.setWheelSurface(settings); aoManager.setMaterialOverlays(wheelAOLayer);
      const prepared = withWheelNormalFile(bases, bases[1], settings, buildWheelOcclusionFile(settings, true));
      const game = await exportMaterialSurfaces(prepared, wheelAOLayer, 4, true, settings, true);
      const gameAO = decodeAmbientOcclusion(game.find((file) => file.name === 'Wheels_AO.dds')!.data.slice().buffer)!;
      const previewAO = (materials.wheels.aoMap as THREE.DataTexture).image;
      assert.equal(materials.wheels.aoMapIntensity, 1, 'The composite already encodes tyre strength before material AO is multiplied');
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const from = (Math.floor(y * previewAO.height / 4) * previewAO.width + Math.floor(x * previewAO.width / 4)) * 4;
        near(pixel(gameAO, x, y)[0], (previewAO.data as Uint8ClampedArray)[from], 5);
      }
      if (settings.mode === 'relief') near(gameAO.data[0], 115, 1);
    }
    aoManager.setFiles([bases[1]]); aoManager.setWheelSurface({ mode: 'relief', strength: .4 }); aoManager.setMaterialOverlays(wheelAOLayer);
    const onlyNormalGame = await exportMaterialSurfaces([bases[1]], wheelAOLayer, 4, true, { mode: 'relief', strength: .4 }, true);
    const onlyNormalAO = decodeAmbientOcclusion(onlyNormalGame.find((file) => file.name === 'Wheels_AO.dds')!.data.slice().buffer)!;
    assert.equal(onlyNormalAO.data[0], 128, 'Imported tyre normals without matching AO never inherit incompatible official groove shading');
    assert.equal((materials.wheels.aoMap as THREE.DataTexture).image.data[0], onlyNormalAO.data[0]);
  } finally { normalManager.dispose(); aoManager.dispose(); Object.values(materials).forEach((material) => material.dispose()); }
} finally { globalThis.fetch = beforeFetch; }
assert.equal(fetches, 0, 'Supplied surface passthrough files prevent all native network reads');
bases.forEach((file, index) => assert.deepEqual(file.data, copies[index], 'Every imported DDS remains immutable'));
console.log('✓ Surfaces matériaux : masques alpha, ordre/normalisation, AO multiplicative, résolution, DDS linéaire, sources intactes, preview/export et cache GPU');
