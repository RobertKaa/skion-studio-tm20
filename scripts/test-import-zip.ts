/**
 * Test headless du chemin d'IMPORT zip (sans DOM / fabric).
 *
 * Simule des exports « anciens » (9 maps pleine résolution) et « récents »
 * (maps plates en 4×4), plus des cas corrompus / partiels, puis vérifie que
 * `importSkinZipFromBuffer` ne lève pas et isole les entrées invalides.
 *
 * Lancer :  npx.cmd tsx scripts/test-import-zip.ts
 */
import JSZip from 'jszip';
import { decodeDDS, encodeDDS, type RGBAImage } from '../src/dds';
import {
  buildSkinZipFromImages,
  importSkinZipFromBuffer,
} from '../src/skinZip';
import { MAPS, MAP_BY_ID, type MapId } from '../src/maps';
import { SKIN3D_MESH_FILE } from '../src/skin3d';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

function solid(size: number, rgba: [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width: size, height: size, data };
}

function paintPattern(size: number, seed: number): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round((x * 255) / Math.max(1, size - 1));
      data[i + 1] = Math.round((y * 255) / Math.max(1, size - 1));
      data[i + 2] = (seed * 41) & 255;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Export « ancien » : toutes les maps à leur exportRes (pas de shrink 4×4). */
async function buildLegacyZip(): Promise<ArrayBuffer> {
  const images = {} as Record<MapId, RGBAImage>;
  MAPS.forEach((def, idx) => {
    images[def.id] = paintPattern(def.exportRes, idx + 1);
  });
  const blob = await buildSkinZipFromImages(images, { skinName: 'LegacySkin' });
  return blob.arrayBuffer();
}

/** Zip partiel type vieille export : seulement les maps carrosserie + détails de base. */
async function buildPartialOldZip(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const ids: MapId[] = ['Skin_B', 'Skin_R', 'Skin_CoatR', 'Skin_DirtMask', 'Details_B', 'Details_I', 'Wheels_B'];
  for (const id of ids) {
    const def = MAP_BY_ID[id];
    zip.file(def.fileName, encodeDDS(paintPattern(def.exportRes, 1), def.format));
  }
  zip.file('ReadMe.txt', 'Skin partiel (simule une vieille export).\n');
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

/** Zip avec une entrée DDS tronquée (header valide, payload coupé). */
async function buildCorruptEntryZip(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const def = MAP_BY_ID.Skin_B;
  const full = encodeDDS(paintPattern(def.exportRes, 1), def.format);
  const truncated = full.slice(0, 128 + 32); // header + quelques blocs seulement
  zip.file(def.fileName, truncated);
  zip.file(MAP_BY_ID.Skin_R.fileName, encodeDDS(paintPattern(1024, 2), 'BC5'));
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

async function main() {
  // 1) Export récent (avec shrink) — import doit réussir pour toutes les maps.
  {
    const images = {} as Record<MapId, RGBAImage>;
    MAPS.forEach((def, idx) => {
      images[def.id] =
        def.id === 'Skin_B' || def.id === 'Details_I'
          ? paintPattern(def.exportRes, idx)
          : solid(def.exportRes, [200, 200, 200, 255]);
    });
    const blob = await buildSkinZipFromImages(images, { skinName: 'NewFmt' });
    const result = await importSkinZipFromBuffer(await blob.arrayBuffer());
    check('format récent : import sans exception', result.imported.length > 0);
    check(
      `format récent : ${MAPS.length} maps reconnues`,
      result.imported.length === MAPS.length,
      `got ${result.imported.length}`,
    );
    check('format récent : aucun échec fatal', result.failures.length === 0);
  }

  // 2) Export « legacy » pleine résolution.
  {
    const buf = await buildLegacyZip();
    const result = await importSkinZipFromBuffer(buf);
    check('legacy pleine résolution : import OK', result.imported.length === MAPS.length);
    for (const { id, image } of result.imported) {
      const def = MAP_BY_ID[id];
      check(
        `legacy ${id} dims ${def.exportRes}²`,
        image.width === def.exportRes && image.height === def.exportRes,
        `got ${image.width}×${image.height}`,
      );
    }
  }

  // 3) Zip partiel (sans Details_R / Wheels_R) — rétrocompatibilité.
  {
    const result = await importSkinZipFromBuffer(await buildPartialOldZip());
    check('zip partiel : import partiel', result.imported.length === 7, `got ${result.imported.length}`);
    check(
      'zip partiel : pas de Details_R',
      !result.imported.some((x) => x.id === 'Details_R'),
    );
  }

  // 4) Entrée DDS tronquée : Skin_B ignorée, Skin_R importée.
  {
    const result = await importSkinZipFromBuffer(await buildCorruptEntryZip());
    check('DDS tronqué : import ne lève pas', true);
    check(
      'DDS tronqué : Skin_B ignorée',
      !result.imported.some((x) => x.id === 'Skin_B'),
    );
    check(
      'DDS tronqué : Skin_R importée',
      result.imported.some((x) => x.id === 'Skin_R'),
    );
    check('DDS tronqué : échec enregistré', result.failures.some((f) => f.path.includes('Skin_B')));
  }

  // 5) decodeDDS ne lève pas sur buffer vide / garbage.
  {
    check('decodeDDS([]) → null', decodeDDS(new ArrayBuffer(0)) === null);
    check('decodeDDS(garbage) → null', decodeDDS(new ArrayBuffer(256)) === null);
    const tiny = new ArrayBuffer(200);
    new DataView(tiny).setUint32(0, 0x20534444, true);
    check('decodeDDS(header seul) → null', decodeDDS(tiny) === null);
  }

  // 6) Chemins Windows dans le zip (backslash).
  {
    const zip = new JSZip();
    zip.file('Skins\\Skin_B.dds', encodeDDS(paintPattern(64, 1), 'BC1'));
    const result = await importSkinZipFromBuffer(await zip.generateAsync({ type: 'arraybuffer' }));
    check('chemin backslash : Skin_B reconnu', result.imported.some((x) => x.id === 'Skin_B'));
    check('zip texture : pas de skin3d', result.skin3d === null);
  }

  // 7) Projet 3D : mesh recopié, preview et nom conservés, DDS peinte toujours lue.
  {
    const mesh = new Uint8Array([9, 8, 7, 6, 5]);
    const preview = new Uint8Array([1, 2, 3, 4]);
    const shade = new Uint8Array([3, 3, 3]);
    const zip = new JSZip();
    zip.file(SKIN3D_MESH_FILE, mesh);
    zip.file('preview.glb', preview);
    zip.file('fakeshad.dds', shade);
    zip.file('skin3d.json', JSON.stringify({ name: 'Citrouille' }));
    zip.file('Skin_B.dds', encodeDDS(paintPattern(32, 2), 'BC1'));
    const result = await importSkinZipFromBuffer(await zip.generateAsync({ type: 'arraybuffer' }));
    check('projet 3D : mesh présent', !!result.skin3d);
    check('projet 3D : nom', result.skin3d?.name === 'Citrouille');
    const gotMesh = result.skin3d?.mesh;
    check(
      'projet 3D : octets du mesh',
      !!gotMesh && gotMesh.length === mesh.length && mesh.every((b, i) => b === gotMesh[i]),
    );
    check('projet 3D : preview', (result.skin3d?.preview?.byteLength ?? 0) === 4);
    check(
      'projet 3D : fakeshad en passthrough',
      result.skin3d?.passthrough.some((f) => f.name === 'fakeshad.dds' && f.data[0] === 3) === true,
    );
    check('projet 3D : Skin_B toujours importée', result.imported.some((x) => x.id === 'Skin_B'));
  }

  if (failures) {
    console.error(`\n${failures} test(s) d'import en échec`);
    process.exit(1);
  }
  console.log('\nTous les tests d\'import passent.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
