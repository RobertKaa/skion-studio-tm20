/**
 * Zip de jeu avec les couleurs par défaut de l'app (carrosserie gris clair)
 * et le MainBody.Mesh.gbx du dossier projet.
 *
 *   npx tsx scripts/pack-default-game-zip.ts work/citrouille-nez
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MAPS, type MapId } from '../src/maps.ts';
import { buildSkinZipFromImages, type RGBAImage } from '../src/skinZip.ts';

interface PaintSpot {
  map: MapId;
  /** Centre UV Blender (v = 0 en bas). */
  u: number;
  v: number;
  /** Demi-côté du carré, en UV. */
  size: number;
  rgb: [number, number, number];
}

function hexToRgba(hex: string): [number, number, number, number] {
  const n = hex.replace('#', '');
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
    255,
  ];
}

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

const project = process.argv[2];
if (!project) {
  throw new Error('usage: pack-default-game-zip.ts <dossier-projet>');
}

const name = basename(project);
const mesh = new Uint8Array(readFileSync(join(project, 'MainBody.Mesh.gbx')));
const images = {} as Record<MapId, RGBAImage>;
for (const def of MAPS) {
  images[def.id] = solid(def.exportRes, hexToRgba(def.defaultFill));
}

const paintPath = join(project, 'paint.json');
if (existsSync(paintPath)) {
  const spots = JSON.parse(readFileSync(paintPath, 'utf8')) as PaintSpot[];
  for (const spot of spots) {
    const img = images[spot.map];
    if (!img) continue;
    const s = img.width;
    const half = Math.max(1, Math.round(spot.size * s));
    const cx = Math.round(spot.u * (s - 1));
    // Le canvas a l'origine en haut : v = 1 est la première ligne.
    const cy = Math.round((1 - spot.v) * (s - 1));
    for (let y = cy - half; y <= cy + half; y++) {
      if (y < 0 || y >= s) continue;
      for (let x = cx - half; x <= cx + half; x++) {
        if (x < 0 || x >= s) continue;
        const i = (y * s + x) * 4;
        img.data[i] = spot.rgb[0];
        img.data[i + 1] = spot.rgb[1];
        img.data[i + 2] = spot.rgb[2];
        img.data[i + 3] = 255;
      }
    }
  }
}

const blob = await buildSkinZipFromImages(images, { skinName: name, meshGbx: mesh });
const out = join(project, `${name}.zip`);
writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log(out);
