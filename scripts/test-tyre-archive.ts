import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { getEnv } from 'fabric/node';
import { setEnv } from 'fabric';
import { MAPS } from '../src/maps';
import { decodeDDS } from '../src/dds';
import { decodeReliefManifest } from '../src/relief/template';
import { buildWheelTreadVolume } from '../src/wheelTreadVolume';
import { buildWheelNormalFile, buildWheelOcclusionFile } from '../src/wheelSurface';
import { exportSkinZip, importSkinZipFromBuffer } from '../src/skinZip';
import { fitTyreArchiveToBudget, limitPrototypeDDSResolution, RELIEF_GAME_ZIP_LIMIT_BYTES } from '../src/relief/export';

setEnv(getEnv()); Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const root = 'public/models/relief/', bytes = async (name: string) => new Uint8Array(await readFile(root + name));
const manifest = decodeReliefManifest(JSON.parse(await readFile(root + 'tyres/manifest.json', 'utf8')));
const template = { manifest, preview: await bytes(manifest.preview.url), variants: { standard: await bytes(manifest.variants.standard.url), normal: await bytes(manifest.variants.normal.url) },
  dependencies: await Promise.all(manifest.dependencies.map(async entry => ({ name: entry.name, data: await bytes(entry.url) }))) };
const settings = { mode: 'gravel' as const, strength: 1, volume: true };
const geometry = await buildWheelTreadVolume(settings, undefined, template);
const native = async (name: string) => ({ name, data: new Uint8Array(await readFile(`src/assets/model/car/${name}`)) });
const nativeWheel = await native('Wheels_N.dds');
const normal = await buildWheelNormalFile(settings, [], true, async () => nativeWheel.data);
const occlusion = buildWheelOcclusionFile(settings);
const maps = new Map(MAPS.map(map => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
  const context = canvas.getContext('2d')!; context.fillStyle = map.defaultFill; context.fillRect(0, 0, 4, 4); return [map.id, canvas]; }));
const mapState = new Map([...maps].map(([id, canvas]) => [id, canvas.toDataURL()]));
const source = await exportSkinZip('Native tyre budget', { getMapCanvas: id => maps.get(id)!, textureResolution: 2048, surfaceTemplate: 'tyres', wheelSurface: settings,
  meshGbx: geometry.project.mesh, previewGlb: geometry.project.preview!, passthrough: [...geometry.project.passthrough,
    ...await Promise.all(['Details_N.dds', 'Skin_AO.dds', 'Details_AO.dds'].map(native)), ...normal ? [normal] : [], ...occlusion ? [occlusion] : []] });
assert(source.size >= RELIEF_GAME_ZIP_LIMIT_BYTES, 'The actual dense tyre ZIP needs its measured DDS mip budget even with compact painted maps');
const sourceZip = await JSZip.loadAsync(await source.arrayBuffer()), beforeMetadata = JSON.parse(await sourceZip.file('skin3d.json')!.async('string'));
const fitted = await fitTyreArchiveToBudget(source, 2048), zip = await JSZip.loadAsync(await fitted.arrayBuffer());
assert(fitted.size < RELIEF_GAME_ZIP_LIMIT_BYTES);
for (const name of ['MainBody.Mesh.gbx', 'preview.glb', ...MAPS.map(map => map.fileName)]) {
  assert.equal(hash(await zip.file(name)!.async('uint8array')), hash(await sourceZip.file(name)!.async('uint8array')), `${name} stays byte for byte unchanged`);
}
const metadata = JSON.parse(await zip.file('skin3d.json')!.async('string'));
for (const [key, value] of Object.entries(beforeMetadata)) assert.deepEqual(metadata[key], value, 'Every original model and wheel setting survives optimization');
assert.equal(metadata.exportProfile.actualArchiveBytes, fitted.size); assert.equal(metadata.exportProfile.preservedPaint, true);
for (const name of ['Wheels_N.dds', 'Details_N.dds', 'Wheels_AO.dds']) {
  const actual = await zip.file(name)!.async('uint8array'), original = await sourceZip.file(name)!.async('uint8array');
  const limit = name.endsWith('_N.dds') ? metadata.exportProfile.detailsWheelNormalResolution : 2048;
  assert.equal(hash(actual), hash(limitPrototypeDDSResolution(original, limit)), 'Only original compressed mip blocks are promoted, without texture re-encoding');
  const decoded = decodeDDS(actual.slice().buffer)!; assert(decoded && Math.max(decoded.width, decoded.height) <= 2048);
}
const reopened = await importSkinZipFromBuffer(await fitted.arrayBuffer());
assert.equal(reopened.failures.length, 0); assert.deepEqual(reopened.wheelSurface, settings);
assert.equal(reopened.skin3d?.surfaceTemplate, 'tyres');
assert.equal(hash(reopened.skin3d!.mesh), hash(geometry.project.mesh));
for (const [id, canvas] of maps) assert.equal(canvas.toDataURL(), mapState.get(id), 'Budget fitting never changes the editable source canvases');
assert.match(await zip.file('ReadMe.txt')!.async('string'), new RegExp(`Taille finale du ZIP : ${fitted.size} octets`));
await assert.rejects(() => fitTyreArchiveToBudget(new Blob([new Uint8Array(20)]), 2048));
console.log(`✓ ZIP pneus réel : ${(source.size / 1e6).toFixed(3)} → ${(fitted.size / 1e6).toFixed(3)} Mo ; modèle, aperçu, réglages et 13 textures peintes identiques ; N/AO en mipmaps d’origine`);
