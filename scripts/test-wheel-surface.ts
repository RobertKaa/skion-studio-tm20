import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDDS, encodeDDS, type RGBAImage } from '../src/dds';
import {
  applyWheelRelief, buildWheelNormalFile, buildWheelOcclusionFile, decodeNormalVectors,
  DEFAULT_WHEEL_SURFACE, getWheelTreadNormal, normalizeWheelSurface, resolveWheelNormalImage,
  SMOOTH_WHEEL_NORMAL, withWheelNormalFile,
} from '../src/wheelSurface';
import { getWheelTreadOcclusion, WHEEL_TREAD_UV } from '../src/wheelTreads';

const native = new Uint8Array(readFileSync(new URL('../src/assets/model/car/Wheels_N.dds', import.meta.url)));
let loads = 0;
const loadNative = async () => { loads++; return native; };
const smooth = await buildWheelNormalFile({ ...DEFAULT_WHEEL_SURFACE }, [], true, loadNative);
assert(smooth);
assert.equal(loads, 0, 'Smooth wheels do not need native assets to export');
assert.equal(String.fromCharCode(...smooth.data.subarray(84, 88)), 'ATI2', 'An explicit game-compatible BC5 override is exported');
const flat = decodeDDS(smooth.data.slice().buffer)!;
assert.equal(flat.width, 4); assert.equal(flat.height, 4);
for (let i = 0; i < flat.data.length; i += 4) assert.deepEqual([...flat.data.subarray(i, i + 2)], [128, 128], 'Every flat normal is neutral');
const dv = new DataView(smooth.data.buffer);
assert.equal(dv.getUint32(28, true), 3, 'The flat normal has its full 4x4, 2x2 and 1x1 mip chain');

const full = await buildWheelNormalFile({ mode: 'relief', strength: 1 }, [], true, loadNative);
assert(full); assert.equal(loads, 1);
assert.equal(full.data, native, 'The full native normal is copied verbatim, without repeated lossy compression');
const noCustomNormal = await buildWheelNormalFile({ mode: 'relief', strength: 1 }, [], false, loadNative);
assert.deepEqual(noCustomNormal?.data, smooth.data, 'Custom UVs without a supplied normal explicitly stay flat in game instead of falling back to the native Stadium normal');
assert.equal(loads, 1);

function solid(x: number, y: number): RGBAImage {
  const data = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([x, y, 255, 255], i);
  return { width: 4, height: 4, data };
}
const imported = { name: 'custom/WHEELS_N.DDS', data: new Uint8Array(encodeDDS(solid(204, 153), 'BC5')) };
const importedCopy = imported.data.slice();
const importedFull = await buildWheelNormalFile({ mode: 'relief', strength: 1 }, [imported], false, loadNative);
assert.equal(importedFull!.data, imported.data, 'An imported normal wins, even on a custom model');
const reduced = await buildWheelNormalFile({ mode: 'relief', strength: .5 }, [imported], false, loadNative);
const reducedImage = decodeNormalVectors(reduced!.data.slice().buffer)!;
assert.equal(reducedImage.data[0], 166, 'Reduced relief scales tangent X');
assert.equal(reducedImage.data[1], 140, 'Reduced relief scales tangent Y without flipping it');
assert.deepEqual(imported.data, importedCopy, 'Source DDS bytes stay pristine for later full-strength export');
assert.equal(applyWheelRelief(solid(204, 153), 0), SMOOTH_WHEEL_NORMAL);
const source = solid(204, 153); assert.equal(applyWheelRelief(source, 1), source);

const overridden = withWheelNormalFile([imported, { name: 'Details_N.dds', data: native }], smooth);
assert.deepEqual(overridden.map((entry) => entry.name), ['Details_N.dds', 'Wheels_N.dds'], 'Replacing a wheel normal preserves other files and avoids case-insensitive duplicates');
assert.deepEqual(normalizeWheelSurface(undefined), DEFAULT_WHEEL_SURFACE);
assert.deepEqual(normalizeWheelSurface({ mode: 'relief', strength: Infinity }), { mode: 'relief', strength: 1 });
assert.deepEqual(normalizeWheelSurface({ mode: 'other', strength: -4 }), { mode: 'smooth', strength: 0 });
await assert.rejects(buildWheelNormalFile({ mode: 'relief', strength: 1 }, [{ name: 'Wheels_N.dds', data: new Uint8Array(12) }], false), /invalide/, 'Invalid normals cannot silently create a broken game ZIP');

// The uncompressed resolver is shared by the 2D relief guide and final ZIP.
const nativeCopy = native.slice();
const loadsBeforeResolve = loads;
for (const official of [true, false]) {
  assert.equal(await resolveWheelNormalImage({ mode: 'smooth', strength: 1 }, [imported], official, loadNative), SMOOTH_WHEEL_NORMAL);
  assert.equal(await resolveWheelNormalImage({ mode: 'relief', strength: 0 }, [imported], official, loadNative), SMOOTH_WHEEL_NORMAL);
  assert.equal(await resolveWheelNormalImage({ mode: 'road', strength: 0 }, [imported], official, loadNative), SMOOTH_WHEEL_NORMAL);
}
assert.equal(await resolveWheelNormalImage({ mode: 'road', strength: 1 }, [imported], false, loadNative), SMOOTH_WHEEL_NORMAL, 'Presets cannot apply Stadium relief to custom-model UVs');
assert.equal(await resolveWheelNormalImage({ mode: 'relief', strength: 1 }, [], false, loadNative), SMOOTH_WHEEL_NORMAL);
assert.equal(loads, loadsBeforeResolve, 'Smooth, zero strength and custom fallback never load unrelated native relief');
const importedImage = await resolveWheelNormalImage({ mode: 'relief', strength: 1 }, [imported], false, loadNative);
assert.deepEqual(importedImage, decodeNormalVectors(imported.data.slice().buffer));
assert.equal(await resolveWheelNormalImage({ mode: 'relief', strength: 1 }, [imported], true, loadNative), importedImage, 'Imported relief is cached and wins over native on both model types');
assert.equal(loads, loadsBeforeResolve);
const nativeImage = await resolveWheelNormalImage({ mode: 'relief', strength: 1 }, [], true, loadNative);
assert.deepEqual(nativeImage, decodeNormalVectors(native.slice().buffer), 'Native resolver preserves the whole original atlas, including sidewalls');
assert.equal(await resolveWheelNormalImage({ mode: 'relief', strength: 1 }, [], true, loadNative), nativeImage, 'Native source decoding is cached');
const presetImage = await resolveWheelNormalImage({ mode: 'road', strength: 1 }, [imported], true, loadNative);
assert.equal(presetImage, getWheelTreadNormal('road', nativeImage), 'Official presets use their physical tread with official moulded sidewalls');
const attenuated = await resolveWheelNormalImage({ mode: 'road', strength: .5 }, [], true, loadNative);
const physicalIndex = Math.floor(presetImage.height * .37) * presetImage.width * 4 + Math.floor(presetImage.width * .35) * 4;
for (const channel of [0, 1]) {
  assert.equal(attenuated.data[physicalIndex + channel], Math.round(((presetImage.data[physicalIndex + channel] / 127.5 - 1) * .5 + 1) * 127.5), 'Resolver strength scales actual tangent normals');
}
assert.deepEqual(native, nativeCopy); assert.deepEqual(imported.data, importedCopy);

function expectWhiteAO(value: { mode: 'smooth' | 'relief' | 'road'; strength: number }, official = true) {
  const file = buildWheelOcclusionFile(value, official)!;
  assert.equal(file.name, 'Wheels_AO.dds');
  assert.equal(String.fromCharCode(...file.data.subarray(84, 88)), 'ATI1', 'AO is a game-compatible scalar BC4 texture');
  const image = decodeDDS(file.data.slice().buffer)!;
  assert.equal(image.width, 4); assert.equal(image.height, 4);
  assert(image.data.every((v) => v === 255), 'An explicit white override removes inherited tread shadows');
  assert.equal(new DataView(file.data.buffer).getUint32(28, true), 3, 'Neutral AO retains the full mip chain');
  return file;
}
const whiteAO = expectWhiteAO({ mode: 'smooth', strength: 1 });
expectWhiteAO({ mode: 'relief', strength: 0 });
expectWhiteAO({ mode: 'road', strength: 0 });
expectWhiteAO({ mode: 'road', strength: 1 }, false);
assert.equal(buildWheelOcclusionFile({ mode: 'relief', strength: 1 }), null, 'Full native/imported AO is passed through without recompression');
assert.equal(buildWheelOcclusionFile({ mode: 'relief', strength: .5 }, false), null, 'Imported source relief keeps its own AO');

const physicalAO = getWheelTreadOcclusion('road');
const physicalAOCopy = physicalAO.data.slice();
for (const strength of [1, .5]) {
  const file = buildWheelOcclusionFile({ mode: 'road', strength }, true)!;
  const image = decodeDDS(file.data.slice().buffer)!;
  assert.equal(image.width, physicalAO.width); assert.equal(image.height, physicalAO.height);
  assert.equal(String.fromCharCode(...file.data.subarray(84, 88)), 'ATI1');
  assert.equal(new DataView(file.data.buffer).getUint32(28, true), 13, 'The 2048×4096 prelight has all mip levels');
  let error = 0, darkest = 255, pixels = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4, expected = Math.round(255 - (255 - physicalAO.data[i]) * strength);
    error += Math.abs(image.data[i] - expected); pixels++;
    darkest = Math.min(darkest, image.data[i]);
    if (x / image.width < WHEEL_TREAD_UV.minU - .01 || x / image.width > WHEEL_TREAD_UV.maxU + .01) {
      assert.equal(image.data[i], 255, 'Export sidewalls never inherit unrelated native tread shadows');
    }
  }
  assert(error / pixels < 1.8, `BC4 AO preserves physical depth and intensity (mean error ${error / pixels})`);
  assert(darkest < 255 - 35 * strength, 'Export retains the depth of the physical grooves');
}
assert.deepEqual(physicalAO.data, physicalAOCopy, 'Attenuating exported AO never alters the uncompressed source used by previews');

const importedAO = { name: 'folder/WHEELS_AO.DDS', data: new Uint8Array(encodeDDS(solid(73, 73), 'BC4')) };
const duplicateAO = { name: 'Wheels_AO.dds', data: importedAO.data.slice() };
const untouched = { name: 'Details_AO.dds', data: native };
const files = [imported, importedAO, duplicateAO, untouched];
const beforeNames = files.map((entry) => entry.name), beforeAO = importedAO.data.slice();
const fresh = withWheelNormalFile(files, smooth, { mode: 'smooth', strength: 1 }, whiteAO);
assert.deepEqual(fresh.map((entry) => entry.name), ['Details_AO.dds', 'Wheels_N.dds', 'Wheels_AO.dds'], 'Case-insensitive path-qualified AO and normal duplicates are replaced once');
assert.equal(fresh[0], untouched); assert.equal(fresh[2], whiteAO);
const restore = withWheelNormalFile(files, importedFull!, { mode: 'relief', strength: 1 }, buildWheelOcclusionFile({ mode: 'relief', strength: 1 }));
assert(restore.includes(importedAO), 'Returning to source relief recovers the original imported AO');
assert.equal(restore.find((entry) => entry.name === 'Wheels_N.dds')!.data, imported.data, 'Returning to source relief recovers the exact original normal bytes');
assert.deepEqual(files.map((entry) => entry.name), beforeNames);
assert.deepEqual(importedAO.data, beforeAO); assert.deepEqual(imported.data, importedCopy);
assert.deepEqual(withWheelNormalFile(files, null, { mode: 'road', strength: 1 }, whiteAO), files, 'No normal replacement leaves source resources untouched');

console.log('✓ Pneus BC5, sources sans recompression, resolver commun, flancs natifs, AO BC4 cohérente, overrides blancs, priorité import et UV custom');
