import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { getEnv } from 'fabric/node';
import { setEnv } from 'fabric';
import { buildReliefPrototype, createDiagnosticReliefAtlas, type PreparedReliefTemplate } from '../src/relief/engine';
import { applyReliefExportProfile, assertReliefGameZipBudget, exportReliefPrototype, limitPrototypeDDSResolution,
  fitReliefArchiveToBudget, RELIEF_GAME_ZIP_LIMIT_BYTES, reliefExportProfile, reliefPrototypeName } from '../src/relief/export';
import { MAPS, type MapId } from '../src/maps';
import { exportSkinZip, importSkinZip, speedLightMask, type ExportSources } from '../src/skinZip';
import { decodeDDS, encodeDDS } from '../src/dds';

// Report a short hash mismatch instead of formatting millions of DDS/mesh bytes.
const byteHash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

// Promoting a mip preserves its encoded linear material values and channel order.
const material = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
for (let p = 0; p < 64; p++) material.data.set([p % 2 ? 224 : 32, p % 2 ? 176 : 48, 0, 255], p * 4);
const materialDDS = new Uint8Array(encodeDDS(material, 'BC5', { colorSpace: 'linear' }));
const materialBefore = materialDDS.slice();
const limitedMaterial = limitPrototypeDDSResolution(materialDDS, 4);
const materialMip = decodeDDS(limitedMaterial.slice().buffer)!;
assert.equal(materialMip.width, 4); assert.equal(materialMip.height, 4);
assert(Math.abs(materialMip.data[0] - 128) <= 2, 'Roughness averages numerically, without an sRGB transfer');
assert(Math.abs(materialMip.data[1] - 112) <= 2, 'The separate metal channel retains its ATI2 order');
assert.deepEqual(limitedMaterial.subarray(128), materialDDS.subarray(128 + 64), 'Remaining DDS blocks are copied byte for byte');
assert.deepEqual(materialDDS, materialBefore, 'DDS optimization does not modify its source');
assert.equal(limitPrototypeDDSResolution(materialDDS, 8), materialDDS, 'Textures below the cap are preserved exactly');
const tangentNormal = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
for (let p = 0; p < 64; p++) tangentNormal.data.set([p % 2 ? 191 : 64, 128, 238, 255], p * 4);
const normalMip = decodeDDS(limitPrototypeDDSResolution(new Uint8Array(encodeDDS(tangentNormal, 'BC5')), 4).slice().buffer)!;
const nx = normalMip.data[0] / 255 * 2 - 1, ny = normalMip.data[1] / 255 * 2 - 1;
assert(Math.abs(nx) < .02 && Math.abs(ny) < .02, 'Opposite tangent normals average to a neutral surface');
assert.throws(() => limitPrototypeDDSResolution(new Uint8Array(128), 2048), /Format DDS/);
assert.throws(() => limitPrototypeDDSResolution(materialDDS.subarray(0, 150), 4), /incomplètes/);
const missingMips = materialDDS.slice(0, 128 + 64); new DataView(missingMips.buffer).setUint32(28, 1, true);
assert.throws(() => limitPrototypeDDSResolution(missingMips, 4), /résolution nécessaire/);
assert.throws(() => limitPrototypeDDSResolution(materialDDS, Number.NaN), /invalide/);

// A synthetic full mip chain exercises the real 4096 -> 2048 export profile
// without expensive colour encoding or requiring an ignored local game ZIP.
function synthetic4KDDS(): Uint8Array {
  let bytes = 128;
  for (let size = 4096; size; size >>= 1) bytes += Math.max(1, Math.ceil(size / 4)) ** 2 * 16;
  const data = new Uint8Array(bytes); data.set(materialDDS.subarray(0, 128));
  const header = new DataView(data.buffer);
  header.setUint32(12, 4096, true); header.setUint32(16, 4096, true);
  header.setUint32(20, 4096 * 4096, true); header.setUint32(28, 13, true);
  return data;
}
const profileZip = new JSZip(), bigDDS = synthetic4KDDS();
const profileChannels = ['Skin_B.dds', 'Skin_N.dds', 'Skin_R.dds', 'Details_R.dds', 'Wheels_R.dds', 'Skin_CoatR.dds', 'Details_N.dds', 'Wheels_N.dds', 'Details_B.dds', 'Wheels_B.dds', 'Details_I.dds'];
for (const name of profileChannels) profileZip.file(name, bigDDS);
profileZip.file('MainBody.Mesh.gbx', new Uint8Array([1, 2, 3]));
const profile = await applyReliefExportProfile(profileZip, 4096);
assert.equal(profile.colourResolution, 4096); assert.equal(profile.bodyNormalResolution, 2048);
assert.equal(profile.secondaryColourResolution, 2048); assert.equal(profile.illuminationResolution, 2048);
assert.equal(profile.finishResolution, 2048); assert.equal(profile.detailsWheelNormalResolution, 2048);
assert.equal(profile.budgetPolicy, 'conservative-target-unverified');
for (const name of profileChannels) {
  const encoded = await profileZip.file(name)!.async('uint8array');
  const width = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint32(16, true);
  assert.equal(width, name === 'Skin_B.dds' ? 4096 : 2048, `${name} follows the advertised quality profile`);
  assert.deepEqual(profile.resolutions[name], { width, height: width });
}
assert.deepEqual(await profileZip.file('MainBody.Mesh.gbx')!.async('uint8array'), new Uint8Array([1, 2, 3]));
assertReliefGameZipBudget(RELIEF_GAME_ZIP_LIMIT_BYTES - 1);
assert.equal(RELIEF_GAME_ZIP_LIMIT_BYTES, 24_000_000);
assert.throws(() => assertReliefGameZipBudget(RELIEF_GAME_ZIP_LIMIT_BYTES), /cible prudente de 24 Mo/);
assert.throws(() => assertReliefGameZipBudget(RELIEF_GAME_ZIP_LIMIT_BYTES + 1), /qualité 2K ou 1K/);
assert.throws(() => assertReliefGameZipBudget(Number.NaN), /invalide/);

// Inject measured compressed sizes to exercise fallback decisions without
// filling the test process with hundreds of MB of random colour textures.
function adaptiveFixture(): JSZip {
  const zip = new JSZip();
  for (const name of profileChannels) zip.file(name, bigDDS);
  zip.file('MainBody.Mesh.gbx', new Uint8Array([1, 2, 3]));
  zip.file('preview.glb', new Uint8Array([4, 5, 6]));
  return zip;
}
const adaptiveZip = adaptiveFixture();
const measuredSteps: string[][] = [];
const adaptive = await fitReliefArchiveToBudget(adaptiveZip, 4096, async selected => {
  measuredSteps.push([...selected.fallbackUsed]);
  return { size: [33_000_000, 27_000_000, 25_000_000, 20_000_000][selected.fallbackUsed.length] };
});
assert.deepEqual(measuredSteps, [[], ['secondary-normals-1k'], ['secondary-normals-1k', 'secondary-finishes-1k'],
  ['secondary-normals-1k', 'secondary-finishes-1k', 'body-finish-1k']]);
assert.equal(adaptive.profile.actualArchiveBytes, 20_000_000);
assert.equal(adaptive.profile.colourResolution, 4096, '4K body colour survives every fallback');
assert.equal(adaptive.profile.bodyNormalResolution, 2048, 'Body normal detail takes priority over secondary finishes');
for (const name of ['Details_N.dds', 'Wheels_N.dds', 'Details_R.dds', 'Wheels_R.dds', 'Skin_CoatR.dds', 'Skin_R.dds']) {
  assert.deepEqual(adaptive.profile.resolutions[name], { width: 1024, height: 1024 });
}
assert.deepEqual(await adaptiveZip.file('MainBody.Mesh.gbx')!.async('uint8array'), new Uint8Array([1, 2, 3]));
assert.deepEqual(await adaptiveZip.file('preview.glb')!.async('uint8array'), new Uint8Array([4, 5, 6]));
const stopped = await fitReliefArchiveToBudget(adaptiveFixture(), 4096, async selected => ({ size: selected.fallbackUsed.length ? 22_000_000 : 26_000_000 }));
assert.deepEqual(stopped.profile.fallbackUsed, ['secondary-normals-1k'], 'Optimization stops immediately when the measured ZIP fits');
assert.equal(stopped.profile.finishResolution, 2048);
const stopped2K = await fitReliefArchiveToBudget(adaptiveFixture(), 2048, async selected => ({ size: selected.fallbackUsed.length ? 23_000_000 : 25_000_000 }));
assert.equal(stopped2K.profile.colourResolution, 2048);
assert.deepEqual(stopped2K.profile.fallbackUsed, ['secondary-normals-1k'], '2K exports use the same measured budget');
let lowQualityAttempts = 0;
await assert.rejects(() => fitReliefArchiveToBudget(adaptiveFixture(), 1024, async () => { lowQualityAttempts++; return { size: 24_000_000 }; }), /cible prudente/);
assert.equal(lowQualityAttempts, 1, '1K does not retry identical fallback caps');
await assert.rejects(() => fitReliefArchiveToBudget(adaptiveFixture(), 4096, async () => ({ size: Number.NaN })), /invalide/);

setEnv(getEnv()); Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const directory = new URL('../public/models/relief/', import.meta.url);
const bytes = (name: string) => new Uint8Array(readFileSync(new URL(name, directory)));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
const template: PreparedReliefTemplate = { manifest, preview: bytes(manifest.preview.url),
  variants: { standard: bytes(manifest.variants.standard.url), normal: bytes(manifest.variants.normal.url) },
  dependencies: manifest.dependencies.map((entry: { name: string; url: string }) => ({ name: entry.name, data: bytes(entry.url) })) };
const maps = new Map<MapId, HTMLCanvasElement>(MAPS.map(map => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
  const context = canvas.getContext('2d')!; context.fillStyle = map.defaultFill; context.fillRect(0, 0, 4, 4);
  return [map.id, canvas];
}));
const diagnostic = createDiagnosticReliefAtlas(64);
const result = await buildReliefPrototype({ template, mode: 'combined', strengthMm: 3, heightAtlas: diagnostic });
const safeName = reliefPrototypeName('../Nom\n', result);
assert(!/[\\/:*?"<>|]/.test(safeName));
assert([...safeName].every(character => character.charCodeAt(0) >= 32));
const before = new Map([...maps].map(([id, canvas]) => [id, canvas.toDataURL()]));
const blob = await exportReliefPrototype('Essai', 'Pack de test', result, maps, [], {}, maps.get('Skin_B')!);
const zip = await JSZip.loadAsync(await blob.arrayBuffer());
assert.equal(byteHash(await zip.file('MainBody.Mesh.gbx')!.async('uint8array')), byteHash(result.project.mesh));
assert.equal(byteHash(await zip.file('preview.glb')!.async('uint8array')), byteHash(new Uint8Array(result.project.preview!)));
for (const dependency of template.dependencies) assert.deepEqual(await zip.file(dependency.name)!.async('uint8array'), dependency.data);
for (const map of MAPS) assert(zip.file(map.fileName), `${map.fileName} is present`);
const normal = decodeDDS(await zip.file('Skin_N.dds')!.async('arraybuffer'))!;
assert.equal(normal.width, diagnostic.width);
const metadata = JSON.parse(await zip.file('skin3d.json')!.async('string'));
assert.equal(metadata.prototype.gameValidation, 'pending'); assert.equal(metadata.prototype.mode, 'combined');
assert.equal(metadata.prototype.exportProfile.actualArchiveBytes, blob.size, 'Metadata records the exact final archive size');
assert.equal(metadata.prototype.exportProfile.budgetPolicy, 'conservative-target-unverified');
assert.deepEqual(metadata.prototype.exportProfile.resolutions['Skin_N.dds'], { width: diagnostic.width, height: diagnostic.height }, 'Small source maps are reported at their actual dimensions');
assert.match(await zip.file('ReadMe.txt')!.async('string'), /expérimentale/);
assert.match(await zip.file('ReadMe.txt')!.async('string'), /n’est pas une limite officielle/);
assert.match(await zip.file('ReadMe.txt')!.async('string'), new RegExp(`Taille finale du ZIP : ${blob.size} octets`));
const imported = await importSkinZip({ size: blob.size, name: 'prototype.zip', arrayBuffer: () => blob.arrayBuffer() } as File);
assert(imported.skin3d?.preview, 'The experimental archive reopens with its real custom preview');
assert(imported.skin3d?.passthrough.some(file => file.name === 'Skin_N.dds'), 'The experimental normal survives import');
for (const [id, canvas] of maps) assert.equal(canvas.toDataURL(), before.get(id), 'Export never modifies the source project maps');
const geometry = await buildReliefPrototype({ template, mode: 'geometry', strengthMm: 3, heightAtlas: diagnostic });
const nativeNormals = ['Details_N.dds', 'Wheels_N.dds'].map(name => ({ name, data: new Uint8Array(readFileSync(new URL(`../src/assets/model/car/${name}`, import.meta.url))) }));
const geometricBlob = await exportReliefPrototype('Essai', 'Pack de test', geometry, maps, [...result.project.passthrough, ...nativeNormals], {}, maps.get('Skin_B')!);
const geometricZip = await JSZip.loadAsync(await geometricBlob.arrayBuffer());
assert.equal(geometricZip.file('Skin_N.dds'), null, 'Geometry-only mode drops an old experimental normal');
for (const file of nativeNormals) assert.equal(byteHash(await geometricZip.file(file.name)!.async('uint8array')),
  byteHash(limitPrototypeDDSResolution(file.data, geometry.options.textureResolution)), 'Geometry-only mode retains the native Details/Wheels normal mip chain at the selected quality');

// Small, nonuniform canvases exercise actual upscaling rather than a solid-fill shortcut.
for (const [id, left, right] of [
  ['Skin_B', '#ef2110', '#143be7'],
  ['Skin_R', 'rgb(32,64,0)', 'rgb(220,180,0)'],
] as const) {
  const ctx = maps.get(id)!.getContext('2d')!;
  ctx.fillStyle = left; ctx.fillRect(0, 0, 2, 4);
  ctx.fillStyle = right; ctx.fillRect(2, 0, 2, 4);
}
const qualitySourceBefore = new Map([...maps].map(([id, canvas]) => [id, canvas.toDataURL()]));
const qualityResult = await buildReliefPrototype({ template, mode: 'combined', scope: 'vehicle', textureResolution: 2048, strengthMm: 3, heightAtlas: diagnostic });
const qualityName = reliefPrototypeName('Essai', qualityResult);
assert.match(qualityName, /-vehicle-combined-3mm-2048px$/);
assert.notEqual(qualityName, reliefPrototypeName('Essai', result), 'Vehicle 2K export cannot replace the previous hood 1K ZIP');
assert.notEqual(qualityName, reliefPrototypeName('Essai', { ...qualityResult, options: { ...qualityResult.options, textureResolution: 1024 } }), 'Each selected quality has a distinct ZIP name');
assert.match(reliefPrototypeName('Essai', { ...qualityResult, options: { ...qualityResult.options, diagnostic: true } }), /prototype-diagnostic-volume/, 'Diagnostic test ZIPs remain distinct from the real stone material');
const qualityBlob = await exportReliefPrototype('Essai', 'Pack de test 2K', qualityResult, maps, nativeNormals, {}, maps.get('Skin_B')!);
const qualityZip = await JSZip.loadAsync(await qualityBlob.arrayBuffer());
const colour2K = decodeDDS(await qualityZip.file('Skin_B.dds')!.async('arraybuffer'))!;
const roughness2K = decodeDDS(await qualityZip.file('Skin_R.dds')!.async('arraybuffer'))!;
for (const image of [colour2K, roughness2K]) { assert.equal(image.width, 2048); assert.equal(image.height, 2048); }
const pixel = (image: typeof colour2K, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const leftColour = pixel(colour2K, 512, 1024), rightColour = pixel(colour2K, 1536, 1024);
assert(leftColour[0] > 220 && leftColour[2] < 40, '2K colour keeps the full left red half');
assert(rightColour[2] > 210 && rightColour[0] < 40, '2K colour keeps the full right blue half');
const leftRoughness = pixel(roughness2K, 512, 1024), rightRoughness = pixel(roughness2K, 1536, 1024);
assert(Math.abs(leftRoughness[0] - 32) <= 3 && Math.abs(leftRoughness[1] - 64) <= 3, '2K data maps preserve roughness/metal channels without gamma');
assert(Math.abs(rightRoughness[0] - 220) <= 3 && Math.abs(rightRoughness[1] - 180) <= 3);
const qualityMetadata = JSON.parse(await qualityZip.file('skin3d.json')!.async('string'));
assert.equal(qualityMetadata.name, qualityName);
assert.equal(qualityMetadata.prototype.scope, 'vehicle');
assert.equal(qualityMetadata.prototype.textureResolution, 2048);
const expectedProfile = reliefExportProfile(2048);
assert.equal(qualityMetadata.prototype.exportProfile.colourResolution, expectedProfile.colourResolution);
assert.equal(qualityMetadata.prototype.exportProfile.actualArchiveBytes, qualityBlob.size);
assert.deepEqual(qualityMetadata.prototype.exportProfile.fallbackUsed, []);
assert.deepEqual(qualityMetadata.prototype.exportProfile.resolutions['Skin_B.dds'], { width: 2048, height: 2048 });
assert.equal(qualityMetadata.prototype.gameValidation, 'pending');
assert.match(await qualityZip.file('ReadMe.txt')!.async('string'), /voiture entière.*2048 px/);
for (const file of ['Skin_N.dds', 'Details_N.dds', 'Wheels_N.dds']) assert(qualityZip.file(file), `${file} accompanies the whole-vehicle export`);
for (const [id, canvas] of maps) assert.equal(canvas.toDataURL(), qualitySourceBefore.get(id), '2K export preserves every small source canvas');

// Per-channel caps must take effect before DDS encoding, retain linear R/G data
// and resample discrete light behaviour at the resulting illumination size.
const cappedMaps = new Map(maps);
const lights = document.createElement('canvas'); lights.width = lights.height = 8;
const lightContext = lights.getContext('2d')!;
lightContext.fillStyle = '#f52b17'; lightContext.fillRect(0, 0, 6, 8);
lightContext.fillStyle = '#000000'; lightContext.fillRect(6, 0, 2, 8);
cappedMaps.set('Details_I', lights);
const roles = document.createElement('canvas'); roles.width = roles.height = 8;
const roleContext = roles.getContext('2d')!;
for (const [x, code] of [[0, 103], [2, 3], [4, 255], [6, 255]]) {
  roleContext.fillStyle = `rgb(${code},0,0)`; roleContext.fillRect(x, 0, 2, 8);
}
const cappedSourcesBefore = new Map([...cappedMaps].map(([id, canvas]) => [id, canvas.toDataURL()]));
const rolesBefore = roles.toDataURL();
const channelCaps = Object.assign(Object.create(null), Object.fromEntries(MAPS.map(map => [map.id, 1024])),
  { Skin_B: 2048, Details_I: 2048 }) as NonNullable<ExportSources['mapResolutions']>;
const capStarted = performance.now();
const cappedBlob = await exportSkinZip('Caps avant encodage', {
  textureResolution: 4096, mapResolutions: channelCaps,
  getMapCanvas: id => cappedMaps.get(id)!, getIllumRoleCanvas: () => roles,
});
const cappedZip = await JSZip.loadAsync(await cappedBlob.arrayBuffer());
const cappedColour = decodeDDS(await cappedZip.file('Skin_B.dds')!.async('arraybuffer'))!;
const cappedFinish = decodeDDS(await cappedZip.file('Skin_R.dds')!.async('arraybuffer'))!;
const cappedLights = decodeDDS(await cappedZip.file('Details_I.dds')!.async('arraybuffer'))!;
assert.equal(cappedColour.width, 2048); assert.equal(cappedColour.height, 2048);
assert.equal(cappedFinish.width, 1024); assert.equal(cappedFinish.height, 1024);
assert.equal(cappedLights.width, 2048); assert.equal(cappedLights.height, 2048);
assert(pixel(cappedColour, 512, 1024)[0] > 220, 'Capped colour retains the red painted area');
assert(pixel(cappedColour, 1536, 1024)[2] > 210, 'Capped colour retains the blue painted area');
const cappedLeftFinish = pixel(cappedFinish, 256, 512), cappedRightFinish = pixel(cappedFinish, 768, 512);
assert(Math.abs(cappedLeftFinish[0] - 32) <= 3 && Math.abs(cappedLeftFinish[1] - 64) <= 3, 'Pre-encoding caps keep numeric roughness and metal channels');
assert(Math.abs(cappedRightFinish[0] - 220) <= 3 && Math.abs(cappedRightFinish[1] - 180) <= 3);
const speedMask = speedLightMask(cappedLights.width, cappedLights.height);
for (const [fraction, code] of [[.125, 103], [.375, 3], [.625, 255], [.875, 255]]) {
  const x = Math.floor(cappedLights.width * fraction);
  let y = 64;
  while (speedMask[y * cappedLights.width + x] && y < cappedLights.height / 2) y += 8;
  assert.equal(speedMask[y * cappedLights.width + x], 0, 'Role sample stays outside the speed display');
  const light = pixel(cappedLights, x, y);
  assert(Math.abs(light[3] - code) <= 2, 'Each discrete light role survives a 4K-selected, 2K-capped export');
  if (fraction < .75) assert(light[0] > 220, 'Head, brake and always-on regions retain their emission');
  else assert(light[0] < 5 && light[1] < 5 && light[2] < 5, 'An unlit region stays black with the native white alpha');
}
for (const [id, canvas] of cappedMaps) assert.equal(canvas.toDataURL(), cappedSourcesBefore.get(id), 'Channel caps do not alter source pixels');
assert.equal(roles.toDataURL(), rolesBefore, 'Channel caps do not alter the source role mask');
console.log(`✓ Per-map caps : Skin_B 2K, Skin_R 1K et illumination 2K avec rôles conservés (${Math.round(performance.now() - capStarted)} ms)`);

const lowerGlobalBlob = await exportSkinZip('Plafond global prioritaire', {
  textureResolution: 1024, mapResolutions: { Skin_B: 4096, Skin_R: 2048, Details_I: 4096 },
  getMapCanvas: id => cappedMaps.get(id)!,
});
const lowerGlobalZip = await JSZip.loadAsync(await lowerGlobalBlob.arrayBuffer());
for (const name of ['Skin_B.dds', 'Skin_R.dds', 'Details_I.dds']) {
  const data = await lowerGlobalZip.file(name)!.async('uint8array');
  assert.equal(new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(16, true), 1024,
    'A per-channel cap can never raise the selected global resolution');
}

// Reject corrupt caps before flushing or reading any project canvas. Allowing
// only own channel keys also avoids accepting inherited/prototype properties.
let invalidCanvasReads = 0, invalidFlushes = 0;
for (const caps of [null, [], '2048', { Skin_B: 0 }, { Skin_B: 512 }, { Skin_B: Number.NaN },
  { Skin_B: 8192 }, { Skin_B: '2048' }, { Skin_N: 2048 }, { unknown: 1024 },
  Object.create({ Skin_B: 1024 }), JSON.parse('{"__proto__":1024}')]) {
  await assert.rejects(() => exportSkinZip('Caps invalides', {
    textureResolution: 4096, mapResolutions: caps as ExportSources['mapResolutions'],
    flush: () => { invalidFlushes++; },
    getMapCanvas: id => { invalidCanvasReads++; return maps.get(id)!; },
  }), /Résolution de canal invalide/);
}
assert.equal(invalidCanvasReads, 0); assert.equal(invalidFlushes, 0);

await assert.rejects(() => exportReliefPrototype('Essai', 'Pack', result, new Map(), [], {}, maps.get('Skin_B')!), /incomplet/);
console.log('✓ Relief ZIP : maillage/aperçu, DDS linéaires, profils adaptatifs mesurés sous 24 Mo, métadonnées exactes, normales natives, réimport et sources préservées');
