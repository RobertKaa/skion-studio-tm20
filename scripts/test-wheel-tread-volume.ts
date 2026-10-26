import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { buildWheelTreadVolume } from '../src/wheelTreadVolume';
import { decodeReliefManifest, validateReliefManifest } from '../src/relief/template';
import type { PreparedReliefTemplate, ReliefGeometry, ReliefPrototypeResult, ReliefVariant } from '../src/relief/types';
import { getWheelTreadNormal, sampleWheelTreadBlockHeight, WHEEL_TREAD_DEPTH_MM, WHEEL_TREAD_UV } from '../src/wheelTreads';
import { normalizeWheelSurface } from '../src/wheelSurface';
import { MAPS, type MapId } from '../src/maps';
import { buildSkinZipFromImages, importSkinZipFromBuffer } from '../src/skinZip';
import type { RGBAImage } from '../src/dds';
import { blenderPartsFromGlb, embeddedGlbData, paintIslandsForModel, validateBlenderParts } from '../src/blenderParts';
import { hasExperimentalSkinNormalShader } from '../src/three/materialSlots';
import { createBaseSkinProject } from '../src/baseSkin';
import { hydrateProject, readProjectFile, writeProjectFile } from '../src/projectFile';
import { WHEEL_PART_GUIDES } from '../src/wheelParts';
import { unpackReliefNormal } from '../src/relief/engine';
import { assertNativeTreadEdges } from './assert-wheel-tread-edges';

const root = 'public/models/relief/';
for (const volume of [true, false]) assert.equal(normalizeWheelSurface({ mode: 'mud', strength: .5, volume }).volume, volume);
for (const volume of ['true', 1, null, {}, []]) assert.equal(normalizeWheelSurface({ mode: 'mud', strength: .5, volume }).volume, undefined);
for (const mode of ['road', 'smooth', 'relief', 'winter']) assert.equal(normalizeWheelSurface({ mode, strength: .5, volume: true }).volume, undefined, 'Unsupported types cannot opt into native block volume');
for (const mode of ['gravel', 'mud'] as const) {
  const full = getWheelTreadNormal(mode), details = getWheelTreadNormal(mode, undefined, true);
  assert.equal(full.width, details.width); assert.equal(full.height, details.height);
  assert.deepEqual(details.data.subarray(0, details.width * 4), details.data.subarray((details.height - 1) * details.width * 4), 'Residual details close exactly at the wheel seam');
  let removedWalls = 0, remainingSipes = 0;
  const acrossStep = 1 / (full.width * (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU));
  for (let y = 0; y < full.height - 1; y += 8) for (let x = Math.ceil(WHEEL_TREAD_UV.minU * full.width) + 8; x < Math.floor(WHEEL_TREAD_UV.maxU * full.width) - 8; x += 8) {
    const at = (y * full.width + x) * 4, across = ((x + .5) / full.width - WHEEL_TREAD_UV.minU) / (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU), turn = y / (full.height - 1);
    const before = Math.hypot(full.data[at] - 127.5, full.data[at + 1] - 127.5), after = Math.hypot(details.data[at] - 127.5, details.data[at + 1] - 127.5);
    const blockSlope = Math.abs(sampleWheelTreadBlockHeight(mode, across + acrossStep, turn) - sampleWheelTreadBlockHeight(mode, across - acrossStep, turn))
      + Math.abs(sampleWheelTreadBlockHeight(mode, across, turn + 1 / (full.height - 1)) - sampleWheelTreadBlockHeight(mode, across, turn - 1 / (full.height - 1)));
    if (blockSlope > .00002 && before > 70 && after < 16) removedWalls++;
    if (after > 40) remainingSipes++;
  }
  assert(removedWalls > 100, `${mode}: large native block walls are absent from residual normals (${removedWalls})`);
  assert(remainingSipes > 100, `${mode}: fine incisions remain after removing the block walls (${remainingSipes})`);
}
async function fixture(name: 'full' | 'tyres'): Promise<PreparedReliefTemplate> {
  const manifest = decodeReliefManifest(JSON.parse(await readFile(`${root}${name}/manifest.json`, 'utf8')));
  const bytes = async (path: string) => new Uint8Array(await readFile(root + path));
  return { manifest, preview: await bytes(manifest.preview.url),
    variants: { standard: await bytes(manifest.variants.standard.url), normal: await bytes(manifest.variants.normal.url) },
    dependencies: await Promise.all(manifest.dependencies.map(async asset => ({ name: asset.name, data: await bytes(asset.url) }))) };
}
const template = await fixture('tyres'), legacy = await fixture('full');
validateReliefManifest(template.manifest);
assert(template.manifest.geometries.length <= 32);
assert(template.manifest.geometries.reduce((n, g) => n + g.bodyVertices.length, 0) <= 600_000);
for (const g of template.manifest.geometries) assert(g.bodyVertices.length <= 65_535, 'Each native visual keeps its 16-bit vertex limit');
const lod0 = template.manifest.geometries.filter(g => g.family === 'wheels' && g.positionAccessor !== undefined);
assert.equal(lod0.length, 4, 'Four independently dense, rigged wheel visuals are present');
assert.deepEqual([...new Set(lod0.flatMap(g => g.bindings ?? []).filter(binding => binding >= 1 && binding <= 4))].sort(), [1, 2, 3, 4]);

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const position = (data: DataView, g: ReliefGeometry, variant: ReliefVariant, vertex: number) =>
  [0, 1, 2].map(axis => data.getFloat32(g.offsets[variant].positionOffset + vertex * 12 + axis * 4, true));
function verifyMouldEdges(mode: 'gravel' | 'mud', result: ReliefPrototypeResult, strength = 1): void {
  const g = lod0.find(geometry => geometry.bindings?.includes(1))!, native = view(result.project.mesh), offset = g.offsets[result.stats.templateVariant];
  const positions = Float32Array.from({ length: g.positions.length }, (_, i) => native.getFloat32(offset.positionOffset + i * 4, true));
  const normals = Float32Array.from({ length: g.normals.length }, (_, i) => g.normalEncoding === 'dec3n'
    ? unpackReliefNormal(native.getUint32(offset.normalOffset + Math.floor(i / 3) * 4, true))[i % 3] : native.getFloat32(offset.normalOffset + i * 4, true));
  assertNativeTreadEdges(mode, g, positions, normals, strength);
}
function verifyPreview(result: ReliefPrototypeResult): void {
  assert(result.project.preview);
  const glb = new Uint8Array(result.project.preview), header = view(glb), jsonLength = header.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  const binary = new DataView(glb.buffer, glb.byteOffset + 28 + jsonLength), native = view(result.project.mesh);
  for (const g of template.manifest.geometries) {
    if (g.positionAccessor === undefined) continue;
    const accessor = json.accessors[g.positionAccessor], buffer = json.bufferViews[accessor.bufferView];
    const offset = (buffer.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = buffer.byteStride ?? 12;
    for (let i = 0; i < accessor.count; i++) for (let axis = 0; axis < 3; axis++) {
      assert.equal(binary.getFloat32(offset + i * stride + axis * 4, true), native.getFloat32(g.offsets[result.stats.templateVariant].positionOffset + i * 12 + axis * 4, true), 'GLB and game mesh contain identical positions');
    }
  }
}

// A previous app-generated normal-shader body volume on the old full template.
const base = legacy.variants.normal.slice(), oldBase = view(base);
const changedBody = legacy.manifest.geometries.find(g => g.family === 'skin' && g.bodyVertices.some(Boolean))!;
const bodyVertex = changedBody.bodyVertices.findIndex(Boolean), bodyOffset = changedBody.offsets.normal.positionOffset + bodyVertex * 12;
oldBase.setFloat32(bodyOffset + 4, oldBase.getFloat32(bodyOffset + 4, true) + .004, true);
const savedBase = base.slice(), savedTemplate = template.variants.standard.slice();
const settings = { mode: 'mud' as const, strength: 1, volume: true };
const sculpted = await buildWheelTreadVolume(settings, { mesh: base, variant: 'normal' }, template, legacy);
assert.deepEqual(settings, { mode: 'mud', strength: 1, volume: true });
assert.deepEqual(base, savedBase, 'Previous native mesh is immutable');
assert.deepEqual(template.variants.standard, savedTemplate, 'Prepared source mesh is immutable');
assert.equal(sculpted.stats.templateVariant, 'normal', 'Previous body normal shader survives wheel rebuilding');
assert(embeddedGlbData(sculpted.project.preview!).gltf.materials.some((material: { name?: string }) => hasExperimentalSkinNormalShader(material.name ?? '')), 'The application detects the preserved normal shader from exported preview metadata');
assert.equal(sculpted.project.surfaceTemplate, 'tyres');
assert.equal(sculpted.normalAtlas, null, 'Geometry does not bake or recolor paint atlases');
assert.deepEqual(sculpted.project.passthrough?.map(file => file.name), template.dependencies.map(file => file.name));
assert(sculpted.stats.affectedVertices > 10_000, 'Large blocks affect a densely sampled tread');
assert(sculpted.stats.maxDisplacementMm > WHEEL_TREAD_DEPTH_MM.mud - .1);
assert(sculpted.stats.maxDisplacementMm <= WHEEL_TREAD_DEPTH_MM.mud + .001);
verifyPreview(sculpted);
const parts = blenderPartsFromGlb(sculpted.project.preview!);
validateBlenderParts(parts);
assert.deepEqual(paintIslandsForModel(parts, 'wheels'), WHEEL_PART_GUIDES, 'The application keeps native tread and sidewall editing guides for all four dense wheels');
const output = view(sculpted.project.mesh), maxima: number[] = [];
let sidewalls = 0, retained = 0;
for (const g of template.manifest.geometries) {
  if (g.family !== 'wheels') {
    const old = legacy.manifest.geometries.find(entry => entry.visualIndex === g.visualIndex)!;
    assert(old && old.positions.length === g.positions.length, 'Other native geometry topology stays unchanged');
    for (let i = 0; i < g.bodyVertices.length; i++) {
      assert.deepEqual(position(output, g, 'normal', i), position(oldBase, old, 'normal', i), 'Every earlier body/detail position survives');
      retained++;
    }
    const normalBytes = g.bodyVertices.length * (g.normalEncoding === 'dec3n' ? 4 : 12);
    assert.deepEqual(sculpted.project.mesh.subarray(g.offsets.normal.normalOffset, g.offsets.normal.normalOffset + normalBytes), base.subarray(old.offsets.normal.normalOffset, old.offsets.normal.normalOffset + normalBytes), 'Earlier body/detail normals survive byte for byte');
    continue;
  }
  let maximum = 0;
  for (let i = 0; i < g.bodyVertices.length; i++) {
    const written = position(output, g, 'normal', i), original = g.positions.slice(i * 3, i * 3 + 3);
    const distance = Math.hypot(...written.map((n, k) => n - original[k])) * 1000;
    maximum = Math.max(maximum, distance);
    const u = g.uv[i * 2];
    if (u < WHEEL_TREAD_UV.minU || u > WHEEL_TREAD_UV.maxU || g.bindings?.[i] === 18) {
      assert.deepEqual(written, original, 'Original native sidewalls keep their positions'); sidewalls++;
    }
  }
  if (g.positionAccessor !== undefined) maxima.push(maximum);
}
assert(retained > 200_000 && sidewalls > 1000);
assert.equal(maxima.length, 4);
for (const maximum of maxima) assert(Math.abs(maximum - WHEEL_TREAD_DEPTH_MM.mud) < .1, 'Every wheel reaches the same physical groove depth');

const reset = await buildWheelTreadVolume({ mode: 'mud', strength: 1, volume: false }, { mesh: sculpted.project.mesh, variant: 'normal' }, template);
const resetView = view(reset.project.mesh);
for (const g of template.manifest.geometries) for (let i = 0; i < g.bodyVertices.length; i++) {
  assert.deepEqual(position(resetView, g, 'normal', i), g.family === 'wheels' ? g.positions.slice(i * 3, i * 3 + 3) : position(output, g, 'normal', i), 'Disabling wheel volume resets only wheels');
}
assert.equal(reset.stats.affectedVertices, 0);
assert.equal(reset.project.surfaceTemplate, 'tyres', 'Dense topology remains identifiable after resetting volume');
verifyPreview(reset);
const unsupported = await buildWheelTreadVolume({ mode: 'road', strength: 1, volume: true }, undefined, template);
assert.equal(unsupported.stats.affectedVertices, 0, 'Other tire types do not accidentally receive large-block geometry');
const initial = await buildWheelTreadVolume(settings, undefined, template);
verifyMouldEdges('mud', initial);
const initialPreview = embeddedGlbData(initial.project.preview!);
for (const g of template.manifest.geometries.filter(g => g.family === 'wheels')) for (let i = 0; i < g.bodyVertices.length; i++) {
  if (g.uv[i * 2] >= WHEEL_TREAD_UV.minU && g.uv[i * 2] <= WHEEL_TREAD_UV.maxU) continue;
  const at = g.offsets.standard.normalOffset + i * (g.normalEncoding === 'dec3n' ? 4 : 12), size = g.normalEncoding === 'dec3n' ? 4 : 12;
  assert.deepEqual(initial.project.mesh.subarray(at, at + size), template.variants.standard.subarray(at, at + size), 'First application preserves artist-authored native sidewall normals exactly');
  if (g.offsets.standard.tangentOffset !== undefined) {
    const tangent = g.offsets.standard.tangentOffset + i * 4;
    assert.deepEqual(initial.project.mesh.subarray(tangent, tangent + 4), template.variants.standard.subarray(tangent, tangent + 4), 'First application preserves native sidewall tangents exactly');
  }
  if (g.normalAccessor !== undefined) {
    const accessor = initialPreview.gltf.accessors[g.normalAccessor], buffer = initialPreview.gltf.bufferViews[accessor.bufferView];
    const normalAt = initialPreview.binStart + (buffer.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (buffer.byteStride ?? 12);
    for (let axis = 0; axis < 3; axis++) assert.equal(initialPreview.view.getFloat32(normalAt + axis * 4, true), Math.fround(g.normals[i * 3 + axis]), 'Preview keeps original artist-authored sidewall shading');
  }
}
const flankBase = base.slice(), flankView = view(flankBase), flankKey = (g: ReliefGeometry, i: number) => `${g.positionAccessor !== undefined ? 'lod0' : g.visualIndex}:${g.bindings?.[i] ?? 0}:${[...g.positions.slice(i * 3, i * 3 + 3), ...g.uv.slice(i * 2, i * 2 + 2)].map(n => Math.round(n * 1e6)).join(',')}`;
const oldFlanks = new Map<string, number[]>();
for (const g of legacy.manifest.geometries.filter(g => g.family === 'wheels')) for (let i = 0; i < g.bodyVertices.length; i++) {
  if (!g.bodyVertices[i] || g.bindings?.[i] === 18 || g.uv[i * 2] >= WHEEL_TREAD_UV.minU && g.uv[i * 2] <= WHEEL_TREAD_UV.maxU) continue;
  const at = g.offsets.normal.positionOffset + i * 12;
  flankView.setFloat32(at, flankView.getFloat32(at, true) + .003, true); oldFlanks.set(flankKey(g, i), position(flankView, g, 'normal', i));
}
const migratedFlanks = await buildWheelTreadVolume({ mode: 'mud', strength: 1, volume: false }, { mesh: flankBase, variant: 'normal' }, template, legacy);
const migratedView = view(migratedFlanks.project.mesh); let matchedFlanks = 0, interpolatedFlanks = 0, appendedFlanks = 0;
for (const g of template.manifest.geometries.filter(g => g.family === 'wheels')) for (let i = 0; i < g.bodyVertices.length; i++) {
  if (!g.bodyVertices[i] || g.uv[i * 2] >= WHEEL_TREAD_UV.minU && g.uv[i * 2] <= WHEEL_TREAD_UV.maxU) continue;
  const written = position(migratedView, g, 'normal', i), exact = oldFlanks.get(flankKey(g, i));
  if (exact) { assert.deepEqual(written, exact, 'Earlier original sidewall vertices keep their exact volume'); matchedFlanks++; }
  else {
    appendedFlanks++;
    const delta = written.map((n, axis) => n - g.positions[i * 3 + axis]);
    assert(delta[0] >= -.000001 && delta[0] <= .003001 && Math.abs(delta[1]) < .000001 && Math.abs(delta[2]) < .000001, 'New conforming sidewall points interpolate the earlier native displacement');
    if (delta[0] > .000001) interpolatedFlanks++;
  }
}
assert(matchedFlanks > 1000, 'All retained original sidewall samples keep their existing volume');
const half = await buildWheelTreadVolume({ mode: 'gravel', strength: .5, volume: true }, { mesh: migratedFlanks.project.mesh, variant: 'normal' }, template);
assert(half.stats.affectedVertices > 10_000);
assert(Math.abs(half.stats.maxDisplacementMm - WHEEL_TREAD_DEPTH_MM.gravel * .5) < .1, 'Volume strength uses physical millimetres');
verifyMouldEdges('gravel', half, .5);
const halfView = view(half.project.mesh);
for (const g of template.manifest.geometries.filter(g => g.family === 'wheels')) for (let i = 0; i < g.bodyVertices.length; i++) if (g.bodyVertices[i] && (g.uv[i * 2] < WHEEL_TREAD_UV.minU || g.uv[i * 2] > WHEEL_TREAD_UV.maxU)) assert.deepEqual(position(halfView, g, 'normal', i), position(migratedView, g, 'normal', i), 'Changing a native tread preserves all previously sculpted sidewalls');
await assert.rejects(() => buildWheelTreadVolume(settings, { mesh: new Uint8Array(20), variant: 'standard' }, template), /incompatible/);
const unsafeBase = base.slice(), unsafeView = view(unsafeBase);
unsafeView.setFloat32(bodyOffset + 4, unsafeView.getFloat32(bodyOffset + 4, true) + 1, true);
await assert.rejects(() => buildWheelTreadVolume(settings, { mesh: unsafeBase, variant: 'normal' }, template, legacy), /hors des limites/, 'Previous geometry outside the bounded app relief cannot enter a trusted template');
const corrupt = template.variants.standard.slice(); corrupt[corrupt.length - 1] ^= 1;
await assert.rejects(() => buildWheelTreadVolume(settings, undefined, { ...template, variants: { ...template.variants, standard: corrupt } }), /modifié ou est incomplet/, 'Only authenticated bundled meshes can be sculpted');
const paint: RGBAImage = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(255) };
const images = Object.fromEntries(MAPS.map(map => [map.id, paint])) as Record<MapId, RGBAImage>;
const archive = await buildSkinZipFromImages(images, { skinName: 'Tyre volume roundtrip', surfaceTemplate: sculpted.project.surfaceTemplate, wheelSurface: settings,
  meshGbx: sculpted.project.mesh, previewGlb: sculpted.project.preview!, passthrough: sculpted.project.passthrough });
const reopened = await importSkinZipFromBuffer(await archive.arrayBuffer());
assert.equal(reopened.skin3d?.surfaceTemplate, 'tyres', 'Native topology marker survives a game ZIP');
assert.deepEqual(reopened.wheelSurface, settings, 'Game ZIP reimport preserves the exact wheel type, strength and native volume setting');
assert.deepEqual(reopened.skin3d?.mesh, sculpted.project.mesh);
assert.deepEqual(new Uint8Array(reopened.skin3d!.preview!), new Uint8Array(sculpted.project.preview!));
assert.equal(reopened.failures.length, 0, 'The dense model is usable through the actual application ZIP importer');
const project = createBaseSkinProject({ position: [3, 2, 4], target: [0, .5, 0] });
project.document.workspace.wheelSurface = settings;
project.document.model = { mesh: 'assets/mesh.gbx', preview: 'assets/preview.glb', name: 'Tyre volume project', surfaceTemplate: 'tyres', parts, passthrough: [] };
project.assets.set('assets/mesh.gbx', sculpted.project.mesh); project.assets.set('assets/preview.glb', new Uint8Array(sculpted.project.preview!));
const hydrated = hydrateProject(await readProjectFile(await writeProjectFile(project)));
assert.equal(hydrated.model?.surfaceTemplate, 'tyres'); assert.deepEqual(hydrated.document.workspace.wheelSurface, settings);
assert.deepEqual(hydrated.model?.parts, parts, 'Dense native contours remain usable after the editable project roundtrip');
hydrated.urls.forEach(url => URL.revokeObjectURL(url));
await assert.rejects(() => buildSkinZipFromImages(images, { skinName: 'Invalid marker', surfaceTemplate: '../tyres' as 'tyres' }), /Gabarit de surface inconnu/);
const badMetadata = await JSZip.loadAsync(await archive.arrayBuffer());
badMetadata.file('skin3d.json', JSON.stringify({ version: 1, surfaceTemplate: { url: 'https://example.com/mesh.gbx' } }));
const rejectedMetadata = await importSkinZipFromBuffer(await badMetadata.generateAsync({ type: 'arraybuffer' }));
assert.equal(rejectedMetadata.skin3d?.surfaceTemplate, undefined);
assert(rejectedMetadata.failures.some(entry => /Métadonnées/.test(entry.reason)), 'Untrusted topology markers are rejected while keeping editable textures');
const badWheelSettings = await JSZip.loadAsync(await archive.arrayBuffer());
badWheelSettings.file('skin3d.json', JSON.stringify({ version: 1, wheelSurface: settings }));
const rejectedSettings = await importSkinZipFromBuffer(await badWheelSettings.generateAsync({ type: 'arraybuffer' }));
assert.equal(rejectedSettings.wheelSurface, undefined, 'A volume flag without an authenticated topology marker is not restored');
assert(rejectedSettings.failures.some(entry => /Métadonnées/.test(entry.reason)));
console.log(`✓ Sculpture pneus native : quatre roues, profondeur et flancs (${matchedFlanks} originaux, ${appendedFlanks} points de raccord dont ${interpolatedFlanks} déplacés), ${retained} sommets antérieurs conservés, remise à zéro, shader normal et positions GLB/GBX identiques`);
