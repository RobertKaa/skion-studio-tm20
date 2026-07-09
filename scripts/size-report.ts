/**
 * Rapport de POIDS d'export + vérification de conformité DDS.
 *
 * Objectif : quantifier ce que le jeu doit (re)charger au respawn.
 *   (a) Poids par map (octets DDS) et poids total du .zip pour des scénarios
 *       d'usage réalistes (AVANT vs APRÈS optimisation, selon l'état du code).
 *   (b) Conformité de CHAQUE DDS : chaîne de mips complète (jusqu'à 1×1),
 *       dwMipMapCount / flags / caps / dwPitchOrLinearSize corrects, pour tous
 *       les formats (BC1/BC3/BC4/BC5).
 *
 * Lancer :  npx.cmd tsx scripts/size-report.ts
 */
import { buildSkinZipFromImages, applyIllumRole } from '../src/skinZip';
import { encodeDDS, type RGBAImage } from '../src/dds';
import { MAPS, MAP_BY_ID, type BCFormat, type MapId } from '../src/maps';

const fourCCStr = (v: number): string =>
  String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);

const EXPECTED_FOURCC: Record<BCFormat, string> = {
  BC1: 'DXT1',
  BC3: 'DXT5',
  BC4: 'ATI1',
  BC5: 'ATI2',
};
const BLOCK_BYTES: Record<BCFormat, number> = { BC1: 8, BC3: 16, BC4: 8, BC5: 16 };

const kb = (n: number) => `${(n / 1024).toFixed(1)} Ko`;
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(2)} Mo`;

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name} ${detail}`);
  }
};

// --- Fabriques d'images -----------------------------------------------------

/** Map « plate » (couleur unie) — cas d'une map jamais éditée par l'utilisateur. */
function solid(size: number, hex: string): RGBAImage {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}

/** Map « riche » (bruit haute fréquence) — cas d'une map réellement peinte. */
function busy(size: number, seed: number): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) >>> 24);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rnd();
    data[i + 1] = rnd();
    data[i + 2] = rnd();
    data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}

/** Néon : moitié gauche vive, moitié droite noire (map _I éditée). */
function neon(size: number): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const lit = x < size / 2;
      data[i] = lit ? 255 : 0;
      data[i + 1] = lit ? 30 : 0;
      data[i + 2] = lit ? 220 : 0;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

// --- Conformité DDS (mips + en-tête) pour chaque format ---------------------

const DDSD_MIPMAPCOUNT = 0x20000;
const DDSD_LINEARSIZE = 0x80000;
const DDSCAPS_COMPLEX = 0x8;
const DDSCAPS_MIPMAP = 0x400000;
const DDSCAPS_TEXTURE = 0x1000;
const DDPF_FOURCC = 0x4;

function expectedMipCount(w: number, h: number): number {
  let n = 1;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    n++;
  }
  return n;
}

function expectedTotalBytes(w: number, h: number, fmt: BCFormat): number {
  let total = 128;
  let cw = w;
  let ch = h;
  for (;;) {
    total += Math.max(1, Math.ceil(cw / 4)) * Math.max(1, Math.ceil(ch / 4)) * BLOCK_BYTES[fmt];
    if (cw === 1 && ch === 1) break;
    cw = Math.max(1, cw >> 1);
    ch = Math.max(1, ch >> 1);
  }
  return total;
}

function verifyDDS(id: string, buf: ArrayBuffer, fmt: BCFormat, w: number, h: number) {
  const dv = new DataView(buf);
  check(`${id} magic`, fourCCStr(dv.getUint32(0, true)) === 'DDS ');
  check(`${id} fourcc=${EXPECTED_FOURCC[fmt]}`, fourCCStr(dv.getUint32(84, true)) === EXPECTED_FOURCC[fmt]);
  check(`${id} dims ${w}x${h}`, dv.getUint32(16, true) === w && dv.getUint32(12, true) === h,
    `got ${dv.getUint32(16, true)}x${dv.getUint32(12, true)}`);
  const flags = dv.getUint32(8, true);
  check(`${id} DDSD_MIPMAPCOUNT`, (flags & DDSD_MIPMAPCOUNT) !== 0);
  check(`${id} DDSD_LINEARSIZE`, (flags & DDSD_LINEARSIZE) !== 0);
  const mips = dv.getUint32(28, true);
  check(`${id} mip chain complete (${expectedMipCount(w, h)})`, mips === expectedMipCount(w, h),
    `got ${mips}`);
  const caps = dv.getUint32(108, true);
  check(`${id} caps COMPLEX|TEXTURE|MIPMAP`,
    (caps & (DDSCAPS_COMPLEX | DDSCAPS_TEXTURE | DDSCAPS_MIPMAP)) ===
      (DDSCAPS_COMPLEX | DDSCAPS_TEXTURE | DDSCAPS_MIPMAP));
  check(`${id} ddspf FOURCC`, (dv.getUint32(80, true) & DDPF_FOURCC) !== 0);
  const linear = dv.getUint32(20, true);
  const expLinear = Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * BLOCK_BYTES[fmt];
  check(`${id} pitchOrLinearSize=${expLinear}`, linear === expLinear, `got ${linear}`);
  check(`${id} taille fichier = somme mips`, buf.byteLength === expectedTotalBytes(w, h, fmt),
    `got ${buf.byteLength}, want ${expectedTotalBytes(w, h, fmt)}`);
}

// --- Scénarios --------------------------------------------------------------

type Scenario = { name: string; edited: Set<MapId> };
const SCENARIOS: Scenario[] = [
  { name: 'A. Carrosserie seule (typique)', edited: new Set<MapId>(['Skin_B']) },
  { name: 'B. Carrosserie + NÉON', edited: new Set<MapId>(['Skin_B', 'Details_I']) },
  {
    name: 'C. Tout édité (pire cas)',
    edited: new Set<MapId>(MAPS.map((m) => m.id)),
  },
];

function buildImages(sc: Scenario): Record<MapId, RGBAImage> {
  const images = {} as Record<MapId, RGBAImage>;
  MAPS.forEach((def, idx) => {
    if (sc.edited.has(def.id)) {
      images[def.id] = def.kind === 'illum' ? neon(def.exportRes) : busy(def.exportRes, idx + 7);
    } else {
      // Non éditée : reste à sa couleur de remplissage par défaut (plate).
      images[def.id] = solid(def.exportRes, def.defaultFill);
    }
  });
  return images;
}

async function main() {
  console.log('=== Résolutions d’export actuelles (maps.ts) ===');
  for (const def of MAPS) {
    console.log(
      `  ${def.id.padEnd(16)} ${def.format}  ${def.exportRes}²  (${EXPECTED_FOURCC[def.format]})`,
    );
  }

  // Conformité : encode chaque map à SA résolution d'export + verif complète.
  console.log('\n=== Conformité DDS (mips + en-tête), toutes les maps ===');
  for (const def of MAPS) {
    let img = busy(def.exportRes, 1);
    if (def.kind === 'illum') img = applyIllumRole(img, 'always');
    verifyDDS(def.id, encodeDDS(img, def.format), def.format, def.exportRes, def.exportRes);
  }
  console.log(failures === 0 ? '  → toutes conformes.' : `  → ${failures} problème(s).`);

  // Poids DDS bruts par map à pleine résolution (référence).
  console.log('\n=== Poids DDS brut par map (pleine résolution éditée) ===');
  let rawFull = 0;
  for (const def of MAPS) {
    const bytes = expectedTotalBytes(def.exportRes, def.exportRes, def.format);
    rawFull += bytes;
    console.log(`  ${def.id.padEnd(16)} ${def.exportRes}² ${def.format}  ${kb(bytes).padStart(12)}`);
  }
  console.log(`  ${'TOTAL brut (9 maps pleines)'.padEnd(16)}            ${mb(rawFull)}`);

  // Poids réel du .zip par scénario (avec la logique d'export en vigueur).
  console.log('\n=== Poids du .zip exporté par scénario (code actuel) ===');
  for (const sc of SCENARIOS) {
    const images = buildImages(sc);
    const blob = await buildSkinZipFromImages(images, {
      skinName: 'SizeReport',
      illumRole: 'always',
    });
    const zipBytes = (await blob.arrayBuffer()).byteLength;

    // Décompresse pour révéler la taille réelle de chaque DDS produit (post-shrink éventuel).
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
    let ddsTotal = 0;
    const lines: string[] = [];
    for (const def of MAPS) {
      const ab = await zip.file(def.fileName)!.async('arraybuffer');
      ddsTotal += ab.byteLength;
      const dv = new DataView(ab);
      const w = dv.getUint32(16, true);
      lines.push(`      ${def.id.padEnd(16)} ${String(w).padStart(4)}²  ${kb(ab.byteLength).padStart(12)}`);
    }
    console.log(`\n  ${sc.name}`);
    for (const l of lines) console.log(l);
    console.log(`      ${'— DDS décompressés'.padEnd(16)}       ${mb(ddsTotal)}`);
    console.log(`      ${'— .ZIP (DEFLATE)'.padEnd(16)}         ${mb(zipBytes)}`);
  }

  void MAP_BY_ID;
  if (failures) {
    console.error(`\n${failures} vérification(s) de conformité en échec`);
    process.exit(1);
  }
  console.log('\nRapport terminé.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
