/** Test rapide : encode BC1/BC4/BC5, vérifie l'en-tête et le round-trip. */
import { encodeDDS, decodeDDS, encodeTGA, type RGBAImage } from '../src/dds';

function makeImage(size: number): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = (x * 255) / (size - 1);
      data[i + 1] = (y * 255) / (size - 1);
      data[i + 2] = (x + y) % 2 ? 255 : 0;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function fourCCStr(v: number): string {
  return String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
}

function fourCCFromStr(s: string): number {
  return (
    (s.charCodeAt(0) |
      (s.charCodeAt(1) << 8) |
      (s.charCodeAt(2) << 16) |
      (s.charCodeAt(3) << 24)) >>>
    0
  );
}

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

const img = makeImage(64);

// Constantes d'en-tête DDS (D3D9) attendues octet par octet.
const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_MIPMAPCOUNT = 0x20000;
const DDSD_LINEARSIZE = 0x80000;
const EXPECTED_FLAGS =
  DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | DDSD_MIPMAPCOUNT | DDSD_LINEARSIZE; // 0xa1007
const DDPF_FOURCC = 0x4;
const DDSCAPS_COMPLEX = 0x8;
const DDSCAPS_TEXTURE = 0x1000;
const DDSCAPS_MIPMAP = 0x400000;
const EXPECTED_CAPS = DDSCAPS_COMPLEX | DDSCAPS_TEXTURE | DDSCAPS_MIPMAP; // 0x401008

for (const [format, expectedFourCC, blockBytes] of [
  ['BC1', 'DXT1', 8],
  ['BC3', 'DXT5', 16],
  ['BC4', 'ATI1', 8],
  ['BC5', 'ATI2', 16],
] as const) {
  const buf = encodeDDS(img, format);
  const dv = new DataView(buf);
  check(`${format} magic`, fourCCStr(dv.getUint32(0, true)) === 'DDS ');
  check(`${format} dwSize=124`, dv.getUint32(4, true) === 124, `got ${dv.getUint32(4, true)}`);
  // En-tête octet par octet : dwFlags exact (avec LINEARSIZE, pas PITCH).
  check(
    `${format} dwFlags=0x${EXPECTED_FLAGS.toString(16)}`,
    dv.getUint32(8, true) === EXPECTED_FLAGS,
    `got 0x${dv.getUint32(8, true).toString(16)}`,
  );
  check(`${format} fourcc`, fourCCStr(dv.getUint32(84, true)) === expectedFourCC);
  check(`${format} dims`, dv.getUint32(12, true) === 64 && dv.getUint32(16, true) === 64);
  check(`${format} depth=0`, dv.getUint32(24, true) === 0);
  // ddspf : dwSize=32, flags=DDPF_FOURCC uniquement.
  check(`${format} ddspf.dwSize=32`, dv.getUint32(76, true) === 32, `got ${dv.getUint32(76, true)}`);
  check(
    `${format} ddspf.dwFlags=FOURCC`,
    dv.getUint32(80, true) === DDPF_FOURCC,
    `got 0x${dv.getUint32(80, true).toString(16)}`,
  );
  // dwCaps : COMPLEX|TEXTURE|MIPMAP (mipmaps => COMPLEX obligatoire).
  check(
    `${format} dwCaps=0x${EXPECTED_CAPS.toString(16)}`,
    dv.getUint32(108, true) === EXPECTED_CAPS,
    `got 0x${dv.getUint32(108, true).toString(16)}`,
  );
  check(`${format} dwCaps2=0`, dv.getUint32(112, true) === 0);
  // dwPitchOrLinearSize = taille (octets) de la surface de niveau 0 (LINEARSIZE).
  const expectedLinear = Math.ceil(64 / 4) * Math.ceil(64 / 4) * blockBytes;
  check(
    `${format} linearSize=${expectedLinear}`,
    dv.getUint32(20, true) === expectedLinear,
    `got ${dv.getUint32(20, true)}`,
  );
  const mips = dv.getUint32(28, true);
  check(`${format} mipcount`, mips === 7, `got ${mips}`);
  // taille attendue = somme des mips
  let expected = 128;
  for (let m = 0, s = 64; m < mips; m++, s = Math.max(1, s >> 1)) {
    expected += Math.max(1, Math.ceil(s / 4)) ** 2 * blockBytes;
  }
  check(`${format} size`, buf.byteLength === expected, `got ${buf.byteLength}, want ${expected}`);
}

// Round-trip BC1 : le dégradé doit survivre à ±24 près
{
  const buf = encodeDDS(img, 'BC1');
  const dec = decodeDDS(buf)!;
  check('BC1 decode dims', dec.width === 64 && dec.height === 64);
  let maxErr = 0;
  for (let i = 0; i < dec.data.length; i += 4) {
    maxErr = Math.max(
      maxErr,
      Math.abs(dec.data[i] - img.data[i]),
      Math.abs(dec.data[i + 1] - img.data[i + 1]),
    );
  }
  check('BC1 round-trip error', maxErr <= 40, `maxErr=${maxErr}`);
}

// Round-trip BC5 : canaux R et G
{
  const buf = encodeDDS(img, 'BC5');
  const dec = decodeDDS(buf)!;
  let maxErr = 0;
  for (let i = 0; i < dec.data.length; i += 4) {
    maxErr = Math.max(
      maxErr,
      Math.abs(dec.data[i] - img.data[i]),
      Math.abs(dec.data[i + 1] - img.data[i + 1]),
    );
  }
  check('BC5 round-trip error', maxErr <= 12, `maxErr=${maxErr}`);
}

// ---------------------------------------------------------------------------
// BC5 / ATI2 : ORDRE PHYSIQUE DES CANAUX (le cœur du bug « pas de
// rugosité/métal en jeu »). Convention D3D9 « ATI2 » = BC5U avec R et G
// ÉCHANGÉS (NVIDIA Texture Tools). Donc le PREMIER sous-bloc BC4 doit contenir
// le VERT (métal) et le SECOND le ROUGE (rugosité). On peint une map où R et G
// sont des constantes bien distinctes et on inspecte les octets bruts.
{
  const size = 16;
  const ROUGH = 40; // R (rugosité) : brillant
  const METAL = 210; // G (métal)   : chromé
  const rm: RGBAImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let i = 0; i < size * size; i++) {
    rm.data[i * 4] = ROUGH;
    rm.data[i * 4 + 1] = METAL;
    rm.data[i * 4 + 3] = 255;
  }
  const buf = encodeDDS(rm, 'BC5');
  const dv = new DataView(buf);
  // Sur un bloc uniforme, encodeBlockBC4 écrit a0 = valeur exacte en octet 0.
  const firstBlockA0 = dv.getUint8(128); // sous-bloc 0 -> doit être le MÉTAL (vert)
  const secondBlockA0 = dv.getUint8(128 + 8); // sous-bloc 1 -> doit être la RUGOSITÉ (rouge)
  check(
    'ATI2 1er sous-bloc = VERT/métal',
    firstBlockA0 === METAL,
    `got ${firstBlockA0}, want ${METAL}`,
  );
  check(
    'ATI2 2e sous-bloc = ROUGE/rugosité',
    secondBlockA0 === ROUGH,
    `got ${secondBlockA0}, want ${ROUGH}`,
  );
  // Malgré l'échange physique, le décodeur ATI2 doit rendre R=rugosité, G=métal.
  const dec = decodeDDS(buf)!;
  check('ATI2 décode R=rugosité', Math.abs(dec.data[0] - ROUGH) <= 4, `got R=${dec.data[0]}`);
  check('ATI2 décode G=métal', Math.abs(dec.data[1] - METAL) <= 4, `got G=${dec.data[1]}`);
}

// Round-trip d'un MOTIF rugosité/métal réaliste (zones distinctes) : le motif
// peint doit ressortir avec R=rugosité et G=métal aux bons endroits.
{
  const size = 32;
  const rm: RGBAImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const shiny = x < size / 2; // moitié gauche : chrome brillant
      rm.data[i] = shiny ? 20 : 230; // R rugosité
      rm.data[i + 1] = shiny ? 240 : 10; // G métal
      rm.data[i + 3] = 255;
    }
  }
  const dec = decodeDDS(encodeDDS(rm, 'BC5'))!;
  const li = (16 * size + 4) * 4; // pixel dans la zone brillante
  const ri = (16 * size + size - 4) * 4; // pixel dans la zone mate
  check('motif R/M gauche brillant (R bas, G haut)', dec.data[li] < 40 && dec.data[li + 1] > 200,
    `got R=${dec.data[li]} G=${dec.data[li + 1]}`);
  check('motif R/M droite mat (R haut, G bas)', dec.data[ri] > 200 && dec.data[ri + 1] < 40,
    `got R=${dec.data[ri]} G=${dec.data[ri + 1]}`);
}

// BC5U (non échangé) : le décodeur doit lire sous-bloc 0 -> ROUGE. On fabrique
// un DDS BC5U minimal (1 bloc) à la main et on vérifie l'absence d'échange.
{
  const buf = new ArrayBuffer(128 + 16);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x20534444, true); // 'DDS '
  dv.setUint32(4, 124, true);
  dv.setUint32(12, 4, true); // height
  dv.setUint32(16, 4, true); // width
  dv.setUint32(76, 32, true);
  dv.setUint32(80, 0x4, true); // DDPF_FOURCC
  dv.setUint32(84, fourCCFromStr('BC5U'), true);
  // sous-bloc 0 = constante 200 (a0=200,a1=199), sous-bloc 1 = constante 50.
  dv.setUint8(128, 200);
  dv.setUint8(129, 199);
  dv.setUint8(136, 50);
  dv.setUint8(137, 49);
  const dec = decodeDDS(buf)!;
  check('BC5U non échangé : R=sous-bloc0', Math.abs(dec.data[0] - 200) <= 2, `got R=${dec.data[0]}`);
  check('BC5U non échangé : G=sous-bloc1', Math.abs(dec.data[1] - 50) <= 2, `got G=${dec.data[1]}`);
}

// Round-trip BC3 : couleur (RGB) + canal alpha interpolé (rôle d'illumination)
{
  const size = 64;
  const alphaImg: RGBAImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      alphaImg.data[i] = (x * 255) / (size - 1);
      alphaImg.data[i + 1] = (y * 255) / (size - 1);
      alphaImg.data[i + 2] = 128;
      // alpha en escalier : 0 / 3 (freins) / 103 (phares) / 255 (toujours)
      alphaImg.data[i + 3] = [0, 3, 103, 255][x % 4];
    }
  }
  const buf = encodeDDS(alphaImg, 'BC3');
  const dv = new DataView(buf);
  check('BC3 fourcc DXT5', fourCCStr(dv.getUint32(84, true)) === 'DXT5');
  const dec = decodeDDS(buf)!;
  check('BC3 decode dims', dec.width === size && dec.height === size);
  let alphaErr = 0;
  let colorErr = 0;
  for (let i = 0; i < dec.data.length; i += 4) {
    alphaErr = Math.max(alphaErr, Math.abs(dec.data[i + 3] - alphaImg.data[i + 3]));
    colorErr = Math.max(
      colorErr,
      Math.abs(dec.data[i] - alphaImg.data[i]),
      Math.abs(dec.data[i + 1] - alphaImg.data[i + 1]),
    );
  }
  check('BC3 alpha round-trip', alphaErr <= 20, `alphaErr=${alphaErr}`);
  check('BC3 color round-trip', colorErr <= 40, `colorErr=${colorErr}`);
}

// ---------------------------------------------------------------------------
// Details_I (BC3/DXT5) : chaque RÔLE d'auto-illumination survit à l'aller-retour.
// On peint une zone d'émission (couleur vive) avec l'alpha du rôle et un fond
// noir/alpha 255 (convention Nadeo). Après encode→decode, la COULEUR d'émission
// doit ressortir en RVB et l'alpha doit rester ≈ la valeur EXACTE du rôle.
{
  const size = 32;
  // Valeurs de rôle attendues (miroir de ILLUM_ROLES) : always/head/brake.
  const roles = [
    { name: 'always (néon)', alpha: 255 },
    { name: 'head (phares)', alpha: 103 },
    { name: 'brake (frein)', alpha: 3 },
  ] as const;
  // Couleur d'émission de test (magenta vif) sur la moitié gauche.
  const EMIT = [230, 20, 200] as const;
  for (const role of roles) {
    const im: RGBAImage = {
      width: size,
      height: size,
      data: new Uint8ClampedArray(size * size * 4),
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        if (x < size / 2) {
          im.data[i] = EMIT[0];
          im.data[i + 1] = EMIT[1];
          im.data[i + 2] = EMIT[2];
          im.data[i + 3] = role.alpha; // rôle dans l'alpha
        } else {
          im.data[i + 3] = 255; // fond éteint : RVB noir + alpha 255
        }
      }
    }
    const dec = decodeDDS(encodeDDS(im, 'BC3'))!;
    const li = (16 * size + 4) * 4; // zone allumée
    check(
      `Details_I rôle ${role.name} : alpha ≈ ${role.alpha}`,
      Math.abs(dec.data[li + 3] - role.alpha) <= 12,
      `got a=${dec.data[li + 3]}`,
    );
    check(
      `Details_I rôle ${role.name} : couleur émission survit`,
      Math.abs(dec.data[li] - EMIT[0]) <= 40 &&
        Math.abs(dec.data[li + 1] - EMIT[1]) <= 40 &&
        Math.abs(dec.data[li + 2] - EMIT[2]) <= 40,
      `got ${dec.data[li]},${dec.data[li + 1]},${dec.data[li + 2]}`,
    );
  }
}

// TGA
{
  const buf = encodeTGA(img);
  const dv = new DataView(buf);
  check('TGA type', dv.getUint8(2) === 2);
  check('TGA dims', dv.getUint16(12, true) === 64 && dv.getUint16(14, true) === 64);
  check('TGA size', buf.byteLength === 18 + 64 * 64 * 4);
}

// Image non carrée / non multiple de 4
{
  const odd = makeImage(64);
  const cropped: RGBAImage = { width: 10, height: 6, data: new Uint8ClampedArray(10 * 6 * 4) };
  cropped.data.fill(128);
  void odd;
  const buf = encodeDDS(cropped, 'BC1');
  const dec = decodeDDS(buf)!;
  check('non-mult-4 dims', dec.width === 10 && dec.height === 6);
}

// Grandes textures (1024 / 2048) — layout de blocs mip 0
for (const size of [1024, 2048] as const) {
  const big = makeImage(size);
  for (const format of ['BC1', 'BC5'] as const) {
    const buf = encodeDDS(big, format);
    const dec = decodeDDS(buf)!;
    check(`${format} ${size} dims`, dec.width === size && dec.height === size);
    let filled = 0;
    for (let i = 0; i < dec.data.length; i += 4) {
      if (dec.data[i + 3] !== 255 || dec.data[i] !== 255) filled++;
    }
    check(`${format} ${size} coverage`, filled > size * size * 0.9, `filled=${filled}`);
  }
}

if (failures) {
  console.error(`\n${failures} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests DDS passent.');
