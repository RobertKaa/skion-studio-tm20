/**
 * Inspecteur d'en-tête DDS (style D3D9) — imprime tous les champs de l'en-tête
 * DDS_HEADER + le pixelformat (ddspf) et le FourCC, pour n'importe quel .dds.
 *
 * Sert à COMPARER nos exports à une DDS de référence Nadeo/tierce (surtout les
 * maps `_R` en BC5/ATI2 : c'est le signal le plus fiable sur ce que le jeu
 * accepte réellement). Décode aussi le tout premier sous-bloc BC4 d'une BC5
 * pour révéler l'ordre physique des canaux (ATI2 = VERT puis ROUGE).
 *
 * Lancer :
 *   npx.cmd tsx scripts/dds-inspect.ts <fichier.dds> [autre.dds ...]
 *   npx.cmd tsx scripts/dds-inspect.ts            (auto : encode un échantillon)
 */
import { readFileSync } from 'node:fs';
import { encodeDDS, type RGBAImage } from '../src/dds';

const DDSD = {
  CAPS: 0x1,
  HEIGHT: 0x2,
  WIDTH: 0x4,
  PITCH: 0x8,
  PIXELFORMAT: 0x1000,
  MIPMAPCOUNT: 0x20000,
  LINEARSIZE: 0x80000,
  DEPTH: 0x800000,
} as const;
const DDPF = {
  ALPHAPIXELS: 0x1,
  ALPHA: 0x2,
  FOURCC: 0x4,
  RGB: 0x40,
  LUMINANCE: 0x20000,
} as const;
const DDSCAPS = { COMPLEX: 0x8, TEXTURE: 0x1000, MIPMAP: 0x400000 } as const;

const fourCCStr = (v: number): string =>
  String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255)
    .replace(/[^\x20-\x7e]/g, '.');

const flagNames = (v: number, table: Record<string, number>): string => {
  const on = Object.entries(table)
    .filter(([, bit]) => (v & bit) !== 0)
    .map(([name]) => name);
  const known = on.map((n) => table[n]).reduce((a, b) => a | b, 0);
  if ((v & ~known) !== 0) on.push(`0x${(v & ~known).toString(16)}?`);
  return on.join('|') || '(aucun)';
};

function inspect(name: string, buf: ArrayBuffer) {
  const dv = new DataView(buf);
  console.log(`\n=== ${name} (${buf.byteLength} octets) ===`);
  if (buf.byteLength < 128 || fourCCStr(dv.getUint32(0, true)) !== 'DDS ') {
    console.log('  ⚠ pas un DDS valide (magic manquant)');
    return;
  }
  const flags = dv.getUint32(8, true);
  const height = dv.getUint32(12, true);
  const width = dv.getUint32(16, true);
  const pitchOrLinear = dv.getUint32(20, true);
  const mips = dv.getUint32(28, true);
  const pfSize = dv.getUint32(76, true);
  const pfFlags = dv.getUint32(80, true);
  const fourcc = dv.getUint32(84, true);
  const caps = dv.getUint32(108, true);

  console.log(`  dwSize              = ${dv.getUint32(4, true)} (attendu 124)`);
  console.log(`  dwFlags             = 0x${flags.toString(16)} [${flagNames(flags, DDSD)}]`);
  console.log(`  dwHeight x dwWidth  = ${height} x ${width}`);
  console.log(`  dwPitchOrLinearSize = ${pitchOrLinear}`);
  console.log(`  dwMipMapCount       = ${mips}`);
  console.log(`  ddspf.dwSize        = ${pfSize} (attendu 32)`);
  console.log(`  ddspf.dwFlags       = 0x${pfFlags.toString(16)} [${flagNames(pfFlags, DDPF)}]`);
  console.log(
    `  ddspf.dwFourCC      = '${fourCCStr(fourcc)}' (0x${(fourcc >>> 0).toString(16)})`,
  );
  if ((pfFlags & DDPF.FOURCC) === 0) {
    console.log(
      `  ddspf.dwRGBBitCount = ${dv.getUint32(88, true)}  masks R/G/B/A = ` +
        `0x${dv.getUint32(92, true).toString(16)}/0x${dv.getUint32(96, true).toString(16)}/` +
        `0x${dv.getUint32(100, true).toString(16)}/0x${dv.getUint32(104, true).toString(16)}`,
    );
  }
  console.log(`  dwCaps              = 0x${caps.toString(16)} [${flagNames(caps, DDSCAPS)}]`);
  console.log(`  (offset données)    = ${fourCCStr(fourcc) === 'DX10' ? 148 : 128}`);

  const fcs = fourCCStr(fourcc);
  if (fcs === 'ATI2' || fcs === 'A2XY' || fcs === 'BC5U') {
    const a0 = dv.getUint8(128);
    const a1 = dv.getUint8(129);
    console.log(
      `  → BC5 : 1er sous-bloc BC4 endpoints a0=${a0} a1=${a1} ` +
        `(${fcs === 'BC5U' ? 'ROUGE' : 'VERT (ATI2 échangé)'} attendu en premier)`,
    );
  }
}

const files = process.argv.slice(2);
if (files.length === 0) {
  // Auto-démo : encode un échantillon BC5 (rugosité/métal) et l'inspecte.
  const size = 16;
  const img: RGBAImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = 40; // R = rugosité (faible => brillant)
    img.data[i * 4 + 1] = 220; // G = métal (fort => chromé)
    img.data[i * 4 + 3] = 255;
  }
  inspect('échantillon BC5/ATI2 (R=40 rugosité, G=220 métal)', encodeDDS(img, 'BC5'));
  console.log('\n(Passez un/des chemins .dds en argument pour inspecter des fichiers réels.)');
} else {
  for (const f of files) {
    const b = readFileSync(f);
    inspect(f, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
}
