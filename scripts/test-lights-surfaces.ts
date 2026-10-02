import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { decodeDDS, type RGBAImage } from '../src/dds';
import { MAPS, mapIdFromFileName, type MapId } from '../src/maps';
import { buildSkinZipFromImages, importSkinZipFromBuffer } from '../src/skinZip';

const solid = (red: number, green = red, blue = red): RGBAImage => ({ width: 16, height: 16,
  data: new Uint8ClampedArray(Array.from({ length: 256 }, () => [red, green, blue, 255]).flat()) });
const maps = Object.fromEntries(MAPS.map((map) => [map.id, solid(map.kind === 'illum' ? 0 : 80)])) as Record<MapId, RGBAImage>;
assert.equal(mapIdFromFileName('folder/Skin_I.dds'), 'Skin_I');
assert.equal(mapIdFromFileName('Wheels_I.dds'), 'Wheels_I');
const dark = await JSZip.loadAsync(await (await buildSkinZipFromImages(maps, { skinName: 'Dark' })).arrayBuffer());
for (const id of ['Skin_I', 'Wheels_I'] as const) {
  const image = decodeDDS(await dark.file(`${id}.dds`)!.async('arraybuffer'))!;
  assert.equal(image.width, 4, `${id}: le fond éteint reste une texture compacte`);
  for (let i = 0; i < image.data.length; i += 4) assert.deepEqual([...image.data.subarray(i, i + 3)], [0, 0, 0], 'Aucun compteur artificiel sur la carrosserie ou les roues');
}
maps.Skin_I = solid(255, 80, 10); maps.Wheels_I = solid(0, 200, 255);
const zip = await JSZip.loadAsync(await (await buildSkinZipFromImages(maps, { skinName: 'Mixed', illumRole: 'always',
  illumRolesByMap: { Skin_I: solid(0), Wheels_I: solid(103) } })).arrayBuffer());
const body = decodeDDS(await zip.file('Skin_I.dds')!.async('arraybuffer'))!;
const wheels = decodeDDS(await zip.file('Wheels_I.dds')!.async('arraybuffer'))!;
assert.equal(body.data[3], 0, 'Alpha zéro du frein conservé indépendamment de la couleur et des détails');
assert.equal(wheels.data[3], 103, 'Rôle propre à la map des roues');
assert.ok(body.data[0] > 230); assert.ok(wheels.data[2] > 230);
const restored = await importSkinZipFromBuffer(await zip.generateAsync({ type: 'arraybuffer' }));
assert.equal(restored.imported.length, MAPS.length);
assert.equal(restored.imported.find((map) => map.id === 'Skin_I')!.image.data[3], 0);
assert.equal(restored.skin3d, null, 'Les textures lumineuses ne requièrent aucun modèle personnalisé');
console.log('✓ Lumières carrosserie/roues : import, BC3, codes indépendants et absence de compteur parasite');
