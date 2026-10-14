import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { createMaterialDefinition } from '../src/materials/types';
import { detectMaterialTextureRoles, exportMaterialPack, importMaterialFiles, importMaterialFilesDetailed, inspectMaterialImage, inspectMaterialZip, materialPngBytes, portableMaterialDefinition, MATERIAL_IMPORT_LIMITS } from '../src/materials/import';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const imageFile = (name: string, bytes: Uint8Array = png) => new File([bytes.slice().buffer], name, { type: 'image/png' });
const zipFile = async (zip: JSZip) => new File([await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })], 'texture-pack.zip');
const channels = (name: string) => detectMaterialTextureRoles(name).map((role) => [role.channel, role.component, role.invert]);
assert.deepEqual(channels('Carbon_ORM_2K.png'), [['ao', 'r', false], ['roughness', 'g', false], ['metalness', 'b', false]]);
assert.deepEqual(channels('Paint_occlusionRoughnessMetallic.png'), [['ao', 'r', false], ['roughness', 'g', false], ['metalness', 'b', false]]);
assert.deepEqual(channels('paint_RMA.jpg'), [['roughness', 'r', false], ['metalness', 'g', false], ['ao', 'b', false]]);
assert.deepEqual(channels('Skin_R.png'), [['roughmetal', 'luminance', false]]);
assert.deepEqual(channels('Details_N.png'), [['normal', 'luminance', false]]);
assert.deepEqual(channels('Paint_NormalDX.png'), [['normal', 'luminance', true]]);
assert.deepEqual(channels('Paint_Normal_DirectX.png'), [['normal', 'luminance', true]]);
assert.deepEqual(channels('Paint_Normal_DX_2K.png'), [['normal', 'luminance', true]]);
assert.deepEqual(channels('Paint_NormalGL.png'), [['normal', 'luminance', false]]);
assert.deepEqual(channels('Paint_Normal_OpenGL.png'), [['normal', 'luminance', false]]);
assert.deepEqual(channels('paint_normaldx.png'), [['normal', 'luminance', true]]);
assert.deepEqual(channels('paint_normaldirectx.png'), [['normal', 'luminance', true]]);
assert.deepEqual(channels('Paint_Normal_DirectX_2K.png'), [['normal', 'luminance', true]]);
assert.deepEqual(channels('Skin_CoatR.png'), [['coat', 'luminance', false]]);
assert.deepEqual(channels('paint_BaseColor.webp'), [['color', 'luminance', false]]);
assert.deepEqual(channels('Paint_Glossiness.png'), [['roughness', 'luminance', true]]);
assert.deepEqual(channels('metal_emissive.png'), [['emission', 'luminance', false]], 'The channel suffix wins over a material-name word');
assert.deepEqual(channels('Skin_DirtMask.png'), [['dirt', 'luminance', false]]);
for (const filename of ['rock_wall_13_disp_4k.png', 'Stone_Displacement.exr', 'Stone_Height_Map.png', 'Stone_Bump_2K.jpg', 'Stone_Displace.webp']) {
  assert.deepEqual(channels(filename), [['height', 'luminance', false]], 'Height aliases retain a numeric height source rather than coloring the skin');
}
assert.deepEqual(channels('random-picture.png'), [['color', 'luminance', false]]);

assert.deepEqual(inspectMaterialImage(png), { width: 1, height: 1, pixels: 1, mime: 'image/png' });
const fourKHeader = new Uint8Array(png); const fourKView = new DataView(fourKHeader.buffer);
fourKView.setUint32(16, 4096); fourKView.setUint32(20, 4096);
const pbrSetPixels = ['color', 'orm', 'normal'].reduce((total) => total + inspectMaterialImage(fourKHeader).pixels, 0);
assert.equal(pbrSetPixels, 48 * 1024 * 1024); assert(pbrSetPixels <= MATERIAL_IMPORT_LIMITS.totalPixels, 'A common 4K color + ORM + normal texture set fits the renderer budget');
assert.equal(MATERIAL_IMPORT_LIMITS.totalPixels, 64 * 1024 * 1024, 'Import never exceeds the material engine pixel budget');
assert.throws(() => inspectMaterialImage(new TextEncoder().encode('<svg><script>alert(1)</script></svg>')), /PNG, JPEG ou WebP/);
assert.throws(() => inspectMaterialImage(png.subarray(0, 50)), /tronquée|incomplète/);
const oversizedPng = new Uint8Array(png); new DataView(oversizedPng.buffer).setUint32(16, 9000);
assert.throws(() => inspectMaterialImage(oversizedPng), /trop grande/);
assert.throws(() => materialPngBytes('https://example.com/image.png'), /locale PNG/);
assert.throws(() => materialPngBytes('data:image/svg+xml;base64,PHN2Zz4='), /locale PNG/);

const imported = await importMaterialFiles([imageFile('Carbone_BaseColor.png'), imageFile('Carbone_ORM.png'), imageFile('Carbone_Normal.png')]);
assert.equal(imported.name, 'Carbone'); assert.equal(imported.color, '#ffffff');
assert.equal(imported.roughness, 255); assert.equal(imported.metalness, 255, 'Imported numeric maps start at full scale');
assert.equal(imported.textures.roughness!.component, 'g'); assert.equal(imported.textures.metalness!.component, 'b'); assert.equal(imported.textures.ao!.component, 'r');
assert.equal(imported.textures.roughness!.src, imported.textures.metalness!.src, 'Packed components share their original source');
assert.deepEqual(materialPngBytes(imported.textures.color!.src), png, 'PNG source bytes and numeric channels remain intact');
assert.equal((await importMaterialFiles([imageFile('lampe_Emissive.png')])).emissionStrength, 1);
const packedR = await importMaterialFiles([imageFile('Skin_R.png')]);
assert.equal(packedR.roughness, 255); assert.equal(packedR.metalness, 255, 'Trackmania packed maps also retain their full source values');
const roughOnly = await importMaterialFiles([imageFile('paint_Roughness.png')]);
assert.equal(roughOnly.roughness, 255); assert.equal(roughOnly.metalness, createMaterialDefinition().metalness);
const scalarMaps = await importMaterialFiles([imageFile('paint_Coat.png'), imageFile('paint_Dirt.png'), imageFile('paint_NormalDX.png')]);
assert.equal(scalarMaps.coat, 255); assert.equal(scalarMaps.dirt, 255); assert.equal(scalarMaps.textures.normal!.invert, true);

const blenderZip = new JSZip();
blenderZip.file('rock_wall_13_4k.blend', 'This file is deliberately not a readable Blender file.');
blenderZip.file('nested/textures/rock_wall_13_diff_4k.png', png);
blenderZip.file('nested/textures/rock_wall_13_rough_4k.png', png);
blenderZip.file('nested/textures/rock_wall_13_nor_gl_4k.png', png);
blenderZip.file('nested/textures/rock_wall_13_disp_4k.png', png);
blenderZip.file('__MACOSX/._rock_wall_13_diff_4k.png', 'Ignored resource fork.');
blenderZip.file('README.txt', 'Optional documentation.');
const blender = await importMaterialFilesDetailed([await zipFile(blenderZip)]);
assert.equal(blender.definition.name, 'rock_wall_13');
assert.deepEqual(Object.keys(blender.definition.textures), ['color', 'roughness', 'normal', 'height']);
assert.equal(blender.definition.textures.normal!.invert, false);
assert.equal(blender.definition.roughness, 255);
assert.equal(blender.definition.coat, 0, 'A texture archive does not add an unprovided paint varnish to a rough material');
assert(blender.notices.some(notice => notice.includes('.blend') && notice.includes('ignoré')));
assert(blender.notices.some(notice => notice.includes('hauteur conservée') && notice.includes('Textures et relief')));
assert.deepEqual(materialPngBytes(blender.definition.textures.height!.src), png, 'A height PNG is retained byte for byte and stays separate from the color channel');
assert.deepEqual(materialPngBytes(blender.definition.textures.color!.src), png, 'A native PNG below the chosen quality is kept byte for byte');

for (const [names, expected] of [
  [['Paint_BaseColor.png', 'Paint_DirtMask.png', 'Paint_ClearCoat.png', 'Paint_Normal_DirectX.png'], ['color', 'dirt', 'coat', 'normal']],
  [['Paint_BaseColor.png', 'Paint_Normal_OpenGL.png', 'Paint_RoughMetal.png'], ['color', 'normal', 'roughmetal']],
  [['Paint_BaseColor.png', 'Paint_RoughnessMetallic.png'], ['color', 'roughmetal']],
  [['Skin_B.png', 'Skin_R.png', 'Skin_CoatR.png', 'Skin_DirtMask.png'], ['color', 'roughmetal', 'coat', 'dirt']],
] as const) {
  const zip = new JSZip(); for (const name of names) zip.file(`textures/${name}`, png);
  const result = await importMaterialFilesDetailed([await zipFile(zip)]);
  assert.deepEqual(Object.keys(result.definition.textures), expected, 'Archive classification retains the same aliases as direct image import');
  assert.equal(result.notices.length, 0);
}
const mixed = new JSZip(); mixed.file('stone_diff_4k.png', png); mixed.file('wood_rough_4k.png', png);
await assert.rejects(importMaterialFiles([await zipFile(mixed)]), /plusieurs matériaux/);
const variants = new JSZip(); variants.file('stone_diff_2k.png', png); variants.file('stone_diff_4k.png', png);
await assert.rejects(importMaterialFiles([await zipFile(variants)]), /même canal/);
const displacementOnly = new JSZip(); displacementOnly.file('stone.blend', 'Blender'); displacementOnly.file('stone_disp_4k.png', png);
const heightOnly = await importMaterialFiles([await zipFile(displacementOnly)]);
assert.deepEqual(Object.keys(heightOnly.textures), ['height'], 'A pack containing only height can be used in the prototype without being mistaken for a color image');
const directHeight = await importMaterialFiles([imageFile('stone_disp_4k.png')]);
assert.deepEqual(Object.keys(directHeight.textures), ['height']);
assert.deepEqual(materialPngBytes(directHeight.textures.height!.src), png);
const heightRoundTrip = await importMaterialFiles([new File([await exportMaterialPack(directHeight)], 'height.zip')]);
assert.deepEqual(heightRoundTrip, directHeight, 'Optional height survives portable material packs without a schema version change');
for (const path of ['../escape.png', 'textures/../escape.png', 'textures\\escape.png', '/escape.png', 'C:/escape.png']) {
  const zip = new JSZip(); zip.file(path, png);
  await assert.rejects(importMaterialFiles([await zipFile(zip)]), /chemin ou fichier inattendu/);
}
const brokenTextureZip = new JSZip(); brokenTextureZip.file('stone_diff.png', png);
const brokenTexture = new Uint8Array(await (await zipFile(brokenTextureZip)).arrayBuffer());
const brokenEntry = inspectMaterialZip(brokenTexture, 'textures').find(entry => entry.name.endsWith('.png'))!;
brokenTexture[brokenEntry.dataStart] ^= 128;
await assert.rejects(importMaterialFiles([new File([brokenTexture], 'broken-textures.zip')]), /endommagées|contrôle ZIP|volumineuse/);
await assert.rejects(importMaterialFilesDetailed([imageFile('color.png')], { maxTextureSize: 9000 as 4096 }), /qualité d’import/);
console.log('ok Blender texture ZIPs, nested paths, ignored Blender documents, retained height maps, naming aliases, variant conflicts and selected-image CRC');
await assert.rejects(importMaterialFiles([imageFile('first.png'), imageFile('second.png')]), /même canal/);
await assert.rejects(importMaterialFiles([new File(['<svg/>'], 'texture.svg')]), /PNG, JPEG ou WebP/);
await assert.rejects(importMaterialFiles([]), /1 à 10/);
await assert.rejects(importMaterialFiles(Array.from({ length: 11 }, (_, i) => imageFile(`image${i}.png`))), /1 à 10/);

const pack = await exportMaterialPack(imported);
const restored = await importMaterialFiles([new File([pack], 'carbon.zip')]);
assert.deepEqual(restored, imported, 'Shared images, components, transforms and finishes survive a pack round trip');
assert.equal(inspectMaterialZip(new Uint8Array(await pack.arrayBuffer())).filter((entry) => entry.name.endsWith('.png')).length, 1, 'Identical PNG sources are embedded once');
const textureless = createMaterialDefinition('carbon');
assert.deepEqual(await importMaterialFiles([new File([await exportMaterialPack(textureless)], 'preset.zip')]), textureless);
const adjusted = structuredClone(imported); adjusted.roughness = 90; adjusted.metalness = 145;
const adjustedRestored = await importMaterialFiles([new File([await exportMaterialPack(adjusted)], 'adjusted.zip')]);
assert.equal(adjustedRestored.roughness, 90); assert.equal(adjustedRestored.metalness, 145, 'Packs preserve user-adjusted factors instead of resetting them to full scale');
scalarMaps.coat = 71; scalarMaps.dirt = 142;
const scalarPack = await importMaterialFiles([new File([await exportMaterialPack(scalarMaps)], 'scalar.zip')]);
assert.equal(scalarPack.coat, 71); assert.equal(scalarPack.dirt, 142); assert.equal(scalarPack.textures.normal!.invert, true);

const localUrl = 'blob:http://localhost:5173/12345678-1234-1234-1234-123456789012';
const hydrated = structuredClone(imported);
hydrated.textures.color!.src = localUrl; hydrated.textures.normal!.src = localUrl;
let sourceLoads = 0; let serializations = 0;
const portable = await portableMaterialDefinition(hydrated, {
  async loadMaterialSources(definition) { sourceLoads++; assert.equal(definition.textures.color!.src, localUrl); },
  getMaterialSourceCanvas(source) { assert.equal(source, localUrl); return { width: 1, height: 1, toDataURL() { serializations++; return imported.textures.color!.src; } }; },
});
assert.equal(sourceLoads, 1); assert.equal(serializations, 1, 'Shared temporary sources are serialized once');
assert.deepEqual(portable, imported); assert.equal(hydrated.textures.color!.src, localUrl, 'Saving never replaces active project object URLs');
assert.deepEqual(await importMaterialFiles([new File([await exportMaterialPack(portable)], 'hydrated.zip')]), imported, 'Reopened project materials become self-contained portable packs');
await assert.rejects(portableMaterialDefinition(hydrated, { async loadMaterialSources() {}, getMaterialSourceCanvas() { return undefined; } }), /indisponible/);

const invalidExternal = createMaterialDefinition(); invalidExternal.textures.color = { src: 'https://example.com/a.png', name: 'Image', component: 'r', invert: false };
await assert.rejects(exportMaterialPack(invalidExternal), /Matériau non exporté/);
const manifest = { format: 'skion-material', version: 1, material: textureless };
for (const path of ['../escape.png', 'textures/../escape.png', 'textures\\image.png', '/absolute.png', 'textures/executable.svg', 'textures/script.js']) {
  const zip = new JSZip(); zip.file('material.json', JSON.stringify(manifest)); zip.file(path, png);
  await assert.rejects(importMaterialFiles([await zipFile(zip)]), /chemin ou fichier inattendu/, path);
}
const externalZip = new JSZip(); externalZip.file('material.json', JSON.stringify({ ...manifest, material: invalidExternal }));
await assert.rejects(importMaterialFiles([await zipFile(externalZip)]), /réglages du pack invalides/);
const pollutedZip = new JSZip(); pollutedZip.file('material.json', JSON.stringify(manifest).replace('"material":', '"__proto__":{"polluted":true},"material":'));
await assert.rejects(importMaterialFiles([await zipFile(pollutedZip)]), /propriété interdite/); assert.equal(({} as Record<string, unknown>).polluted, undefined);
const scriptMetadata = new JSZip(); scriptMetadata.file('material.json', JSON.stringify({ ...manifest, html: '<script>alert(1)</script>' }));
await assert.rejects(importMaterialFiles([await zipFile(scriptMetadata)]), /réglages du pack invalides/);
const unreferenced = new JSZip(); unreferenced.file('material.json', JSON.stringify(manifest)); unreferenced.file('textures/unused.png', png);
await assert.rejects(importMaterialFiles([await zipFile(unreferenced)]), /image non utilisée/);
const inflated = new JSZip(); inflated.file('material.json', ' '.repeat(MATERIAL_IMPORT_LIMITS.manifestBytes + 1));
await assert.rejects(importMaterialFiles([await zipFile(inflated)]), /décompressée trop volumineuse/);

// A bomb can lie about its uncompressed size. Streaming must stop at actual output limits.
const forged = new Uint8Array(await (await zipFile(inflated)).arrayBuffer());
const central = forged.findIndex((_, index) => index + 4 <= forged.length && new DataView(forged.buffer).getUint32(index, true) === 0x02014b50);
new DataView(forged.buffer).setUint32(central + 24, 32, true);
await assert.rejects(importMaterialFiles([new File([forged], 'forged.zip')]), /taille falsifiée/);

const corrupted = new Uint8Array(await pack.arrayBuffer());
const firstEntry = inspectMaterialZip(corrupted).find((entry) => entry.name === 'material.json')!;
corrupted[firstEntry.dataStart] ^= 128;
await assert.rejects(importMaterialFiles([new File([corrupted], 'broken.zip')]), /endommagées|contrôle ZIP|volumineuse/);

// Different numeric RGB values stay in the original PNG, with no luminance conversion.
const crc = (bytes: Uint8Array) => {
  let result = 0xffffffff;
  for (const byte of bytes) { result ^= byte; for (let bit = 0; bit < 8; bit++) result = result & 1 ? 0xedb88320 ^ result >>> 1 : result >>> 1; }
  return (result ^ 0xffffffff) >>> 0;
};
function chunk(kind: string, payload: Uint8Array) {
  const bytes = new Uint8Array(payload.length + 12); const view = new DataView(bytes.buffer); view.setUint32(0, payload.length);
  bytes.set(new TextEncoder().encode(kind), 4); bytes.set(payload, 8); view.setUint32(payload.length + 8, crc(bytes.subarray(4, payload.length + 8))); return bytes;
}
const header = new Uint8Array(13); new DataView(header.buffer).setUint32(0, 1); new DataView(header.buffer).setUint32(4, 1); header[8] = 8; header[9] = 2;
const rgbPng = new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(new Uint8Array([0, 17, 83, 211]))), chunk('IEND', new Uint8Array())]));
const orm = await importMaterialFiles([imageFile('test_ORM.png', rgbPng)]);
assert.deepEqual(materialPngBytes(orm.textures.roughness!.src), rgbPng);
console.log('✓ Matériaux : détection PBR/ORM/RMA, PNG intact, packs complets, chemins sûrs, CRC, quotas et décompression bornée');
