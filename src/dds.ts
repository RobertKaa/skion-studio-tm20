/**
 * Encodage / décodage DDS minimal pour les skins TM2020.
 * Export : BC1 (DXT1), BC3 (DXT5, couleur + alpha interpolé), BC4 (ATI1),
 * BC5 (ATI2) avec chaîne de mipmaps complète, en-têtes style D3D9 (ce que le
 * jeu attend).
 * Import : BC1/BC2/BC3/BC4/BC5 et RGBA non compressé.
 */

import type { BCFormat } from './maps';

// ---------------------------------------------------------------------------
// Helpers image

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}

function downsample(img: RGBAImage): RGBAImage {
  const w = Math.max(1, img.width >> 1);
  const h = Math.max(1, img.height >> 1);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(x * 2, img.width - 1);
      const sy = Math.min(y * 2, img.height - 1);
      const sx1 = Math.min(sx + 1, img.width - 1);
      const sy1 = Math.min(sy + 1, img.height - 1);
      for (let c = 0; c < 4; c++) {
        const a = img.data[(sy * img.width + sx) * 4 + c];
        const b = img.data[(sy * img.width + sx1) * 4 + c];
        const cc = img.data[(sy1 * img.width + sx) * 4 + c];
        const d = img.data[(sy1 * img.width + sx1) * 4 + c];
        out[(y * w + x) * 4 + c] = (a + b + cc + d + 2) >> 2;
      }
    }
  }
  return { width: w, height: h, data: out };
}

function mipChain(img: RGBAImage): RGBAImage[] {
  const chain = [img];
  let cur = img;
  while (cur.width > 1 || cur.height > 1) {
    cur = downsample(cur);
    chain.push(cur);
  }
  return chain;
}

/** Extrait un bloc 4x4 RGBA (clampé aux bords). */
function getBlock(img: RGBAImage, bx: number, by: number, out: Uint8Array) {
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const sx = Math.min(bx * 4 + x, img.width - 1);
      const sy = Math.min(by * 4 + y, img.height - 1);
      const si = (sy * img.width + sx) * 4;
      const di = (y * 4 + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }
}

// ---------------------------------------------------------------------------
// BC1 (DXT1)

function to565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function from565(c: number): [number, number, number] {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function encodeBlockBC1(block: Uint8Array, out: DataView, offset: number) {
  // Endpoints : min/max projetés sur l'axe de plus grande variance (approx. luminance-fit)
  let minV = Infinity;
  let maxV = -Infinity;
  let minI = 0;
  let maxI = 0;
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4];
    const g = block[i * 4 + 1];
    const b = block[i * 4 + 2];
    const v = r * 0.299 + g * 0.587 + b * 0.114;
    if (v < minV) {
      minV = v;
      minI = i;
    }
    if (v > maxV) {
      maxV = v;
      maxI = i;
    }
  }
  let c0 = to565(block[maxI * 4], block[maxI * 4 + 1], block[maxI * 4 + 2]);
  let c1 = to565(block[minI * 4], block[minI * 4 + 1], block[minI * 4 + 2]);
  if (c0 === c1) {
    out.setUint16(offset, c0, true);
    out.setUint16(offset + 2, c1, true);
    out.setUint32(offset + 4, 0, true);
    return;
  }
  // c0 > c1 => mode 4 couleurs opaque
  if (c0 < c1) {
    const t = c0;
    c0 = c1;
    c1 = t;
  }
  const [r0, g0, b0] = from565(c0);
  const [r1, g1, b1] = from565(c1);
  const palette = [
    [r0, g0, b0],
    [r1, g1, b1],
    [(2 * r0 + r1 + 1) / 3, (2 * g0 + g1 + 1) / 3, (2 * b0 + b1 + 1) / 3],
    [(r0 + 2 * r1 + 1) / 3, (g0 + 2 * g1 + 1) / 3, (b0 + 2 * b1 + 1) / 3],
  ];
  let indices = 0;
  for (let i = 0; i < 16; i++) {
    const r = block[i * 4];
    const g = block[i * 4 + 1];
    const b = block[i * 4 + 2];
    let best = 0;
    let bestD = Infinity;
    for (let p = 0; p < 4; p++) {
      const dr = r - palette[p][0];
      const dg = g - palette[p][1];
      const db = b - palette[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    indices |= best << (i * 2);
  }
  out.setUint16(offset, c0, true);
  out.setUint16(offset + 2, c1, true);
  out.setUint32(offset + 4, indices >>> 0, true);
}

// ---------------------------------------------------------------------------
// BC4 (un canal, 8 octets/bloc) — utilisé seul (ATI1) ou doublé pour BC5 (ATI2)

function encodeBlockBC4(
  block: Uint8Array,
  channel: number,
  out: DataView,
  offset: number,
) {
  let min = 255;
  let max = 0;
  for (let i = 0; i < 16; i++) {
    const v = block[i * 4 + channel];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    out.setUint8(offset, max);
    out.setUint8(offset + 1, min === 0 ? 0 : min - 1);
    for (let i = 2; i < 8; i++) out.setUint8(offset + i, 0);
    return;
  }
  // mode 8 valeurs : a0 > a1
  const a0 = max;
  const a1 = min;
  const palette = [a0, a1];
  for (let i = 1; i <= 6; i++) palette.push(((7 - i) * a0 + i * a1 + 3) / 7);
  out.setUint8(offset, a0);
  out.setUint8(offset + 1, a1);
  let bits = 0n;
  for (let i = 0; i < 16; i++) {
    const v = block[i * 4 + channel];
    let best = 0;
    let bestD = Infinity;
    for (let p = 0; p < 8; p++) {
      const d = Math.abs(v - palette[p]);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    bits |= BigInt(best) << BigInt(i * 3);
  }
  for (let i = 0; i < 6; i++) {
    out.setUint8(offset + 2 + i, Number((bits >> BigInt(i * 8)) & 0xffn));
  }
}

// ---------------------------------------------------------------------------
// En-tête DDS (D3D9)

const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_MIPMAPCOUNT = 0x20000;
const DDSD_LINEARSIZE = 0x80000;
const DDPF_FOURCC = 0x4;
const DDSCAPS_COMPLEX = 0x8;
const DDSCAPS_TEXTURE = 0x1000;
const DDSCAPS_MIPMAP = 0x400000;

function fourCC(s: string): number {
  return (
    s.charCodeAt(0) |
    (s.charCodeAt(1) << 8) |
    (s.charCodeAt(2) << 16) |
    (s.charCodeAt(3) << 24)
  );
}

const FORMAT_INFO: Record<BCFormat, { fourcc: string; blockBytes: number }> = {
  BC1: { fourcc: 'DXT1', blockBytes: 8 },
  BC3: { fourcc: 'DXT5', blockBytes: 16 },
  BC4: { fourcc: 'ATI1', blockBytes: 8 },
  BC5: { fourcc: 'ATI2', blockBytes: 16 },
};

/** Encode une image RGBA en DDS compressé avec chaîne de mipmaps complète. */
export function encodeDDS(img: RGBAImage, format: BCFormat): ArrayBuffer {
  const info = FORMAT_INFO[format];
  const mips = mipChain(img);
  let dataSize = 0;
  for (const m of mips) {
    dataSize +=
      Math.max(1, Math.ceil(m.width / 4)) *
      Math.max(1, Math.ceil(m.height / 4)) *
      info.blockBytes;
  }
  const buf = new ArrayBuffer(128 + dataSize);
  const dv = new DataView(buf);

  dv.setUint32(0, fourCC('DDS '), true);
  dv.setUint32(4, 124, true); // dwSize
  dv.setUint32(
    8,
    DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | DDSD_MIPMAPCOUNT | DDSD_LINEARSIZE,
    true,
  );
  dv.setUint32(12, img.height, true);
  dv.setUint32(16, img.width, true);
  dv.setUint32(
    20,
    Math.max(1, Math.ceil(img.width / 4)) * Math.max(1, Math.ceil(img.height / 4)) * info.blockBytes,
    true,
  );
  dv.setUint32(24, 0, true); // depth
  dv.setUint32(28, mips.length, true);
  // ddspf @76
  dv.setUint32(76, 32, true); // dwSize
  dv.setUint32(80, DDPF_FOURCC, true);
  dv.setUint32(84, fourCC(info.fourcc), true);
  dv.setUint32(108, DDSCAPS_COMPLEX | DDSCAPS_TEXTURE | DDSCAPS_MIPMAP, true);

  const block = new Uint8Array(64);
  let offset = 128;
  for (const m of mips) {
    const bw = Math.max(1, Math.ceil(m.width / 4));
    const bh = Math.max(1, Math.ceil(m.height / 4));
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        getBlock(m, bx, by, block);
        if (format === 'BC1') {
          encodeBlockBC1(block, dv, offset);
          offset += 8;
        } else if (format === 'BC3') {
          // DXT5 : bloc alpha interpolé (canal 3, 8 octets) + bloc couleur BC1 (8 octets).
          encodeBlockBC4(block, 3, dv, offset);
          encodeBlockBC1(block, dv, offset + 8);
          offset += 16;
        } else if (format === 'BC4') {
          encodeBlockBC4(block, 0, dv, offset); // canal rouge (image en niveaux de gris)
          offset += 8;
        } else {
          // BC5 / FourCC « ATI2 ». Point CRUCIAL : la convention D3D9 « ATI2 »
          // (3Dc) correspond à un BC5U dont les canaux rouge et vert sont
          // ÉCHANGÉS (cf. NVIDIA Texture Tools : « ATI2 corresponds to BC5U
          // with the red and green channels swapped »). Autrement dit, un
          // lecteur ATI2 conforme — comme TM2020 — lit le PREMIER sous-bloc BC4
          // comme le VERT et le SECOND comme le ROUGE.
          //
          // Nos maps `_R` portent la rugosité en R (canal 0) et le métal en G
          // (canal 1). Pour que TM2020 relise R=rugosité / G=métal, on écrit
          // donc : sous-bloc 0 = VERT (métal), sous-bloc 1 = ROUGE (rugosité).
          // Sans cet échange, le jeu inverse rugosité/métal : une peinture
          // brillante/chromée devient mate et sans métal (= « peinture plate »).
          encodeBlockBC4(block, 1, dv, offset); // sous-bloc 0 = vert (métal)
          encodeBlockBC4(block, 0, dv, offset + 8); // sous-bloc 1 = rouge (rugosité)
          offset += 16;
        }
      }
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Décodage DDS (pour importer des skins existants)

function decodeBlockBC1(
  dv: DataView,
  offset: number,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  bx: number,
  by: number,
  writeAlpha: boolean,
) {
  const c0 = dv.getUint16(offset, true);
  const c1 = dv.getUint16(offset + 2, true);
  const bits = dv.getUint32(offset + 4, true);
  const [r0, g0, b0] = from565(c0);
  const [r1, g1, b1] = from565(c1);
  const pal: number[][] = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
  ];
  if (c0 > c1) {
    pal.push([(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255]);
    pal.push([(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255]);
  } else {
    pal.push([(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255]);
    pal.push([0, 0, 0, 0]);
  }
  for (let i = 0; i < 16; i++) {
    const px = bx * 4 + (i % 4);
    const py = by * 4 + (i >> 2);
    if (px >= w || py >= h) continue;
    const di = (py * w + px) * 4;
    const p = pal[(bits >> (i * 2)) & 3];
    out[di] = p[0];
    out[di + 1] = p[1];
    out[di + 2] = p[2];
    if (writeAlpha) out[di + 3] = p[3];
  }
}

function decodeBlockBC4Channel(
  dv: DataView,
  offset: number,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  bx: number,
  by: number,
  channel: number,
) {
  const a0 = dv.getUint8(offset);
  const a1 = dv.getUint8(offset + 1);
  const pal = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) pal.push(((7 - i) * a0 + i * a1) / 7);
  } else {
    for (let i = 1; i <= 4; i++) pal.push(((5 - i) * a0 + i * a1) / 5);
    pal.push(0, 255);
  }
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(dv.getUint8(offset + 2 + i)) << BigInt(i * 8);
  for (let i = 0; i < 16; i++) {
    const px = bx * 4 + (i % 4);
    const py = by * 4 + (i >> 2);
    if (px >= w || py >= h) continue;
    const di = (py * w + px) * 4 + channel;
    out[di] = pal[Number((bits >> BigInt(i * 3)) & 7n)];
  }
}

/** Taille max. raisonnable pour une map TM2020 (2048² + marge). */
const MAX_DDS_DIM = 8192;

function mip0BlockBytes(pfFlags: number, fc: number): number | null {
  const isFourCC = (s: string) => (pfFlags & DDPF_FOURCC) !== 0 && fc === fourCC(s);
  if (isFourCC('DXT1')) return 8;
  if (isFourCC('DXT3') || isFourCC('DXT5')) return 16;
  if (isFourCC('ATI1') || isFourCC('BC4U')) return 8;
  if (isFourCC('ATI2') || isFourCC('A2XY') || isFourCC('BC5U')) return 16;
  if ((pfFlags & 0x40) !== 0) {
    const bitCount = fc; // placeholder — caller passes bitCount separately
    void bitCount;
    return null;
  }
  return null;
}

function decodeDDSInternal(buf: ArrayBuffer): RGBAImage | null {
  const dv = new DataView(buf);
  if (buf.byteLength < 128 || dv.getUint32(0, true) !== fourCC('DDS ')) return null;
  const height = dv.getUint32(12, true);
  const width = dv.getUint32(16, true);
  if (!width || !height || width > MAX_DDS_DIM || height > MAX_DDS_DIM) return null;
  const pfFlags = dv.getUint32(80, true);
  const fc = dv.getUint32(84, true);
  let dataOffset = 128;
  if (fc === fourCC('DX10')) dataOffset += 20;

  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  const blockBytes = mip0BlockBytes(pfFlags, fc);
  if (blockBytes !== null) {
    const need = dataOffset + bw * bh * blockBytes;
    if (buf.byteLength < need) return null;
  } else if ((pfFlags & 0x40) === 0) {
    return null;
  } else {
    const bitCount = dv.getUint32(88, true);
    if (!bitCount || bitCount % 8 !== 0) return null;
    const bytes = bitCount / 8;
    const need = dataOffset + width * height * bytes;
    if (buf.byteLength < need) return null;
  }

  const out = new Uint8ClampedArray(width * height * 4);
  out.fill(255);

  const isFourCC = (s: string) => (pfFlags & DDPF_FOURCC) !== 0 && fc === fourCC(s);

  if (isFourCC('DXT1')) {
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++)
        decodeBlockBC1(dv, dataOffset + (by * bw + bx) * 8, out, width, height, bx, by, true);
  } else if (isFourCC('DXT3') || isFourCC('DXT5')) {
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const o = dataOffset + (by * bw + bx) * 16;
        if (isFourCC('DXT5')) {
          decodeBlockBC4Channel(dv, o, out, width, height, bx, by, 3);
        } else {
          for (let i = 0; i < 16; i++) {
            const px = bx * 4 + (i % 4);
            const py = by * 4 + (i >> 2);
            if (px >= width || py >= height) continue;
            const nib = (dv.getUint8(o + (i >> 1)) >> ((i & 1) * 4)) & 0xf;
            out[(py * width + px) * 4 + 3] = (nib << 4) | nib;
          }
        }
        decodeBlockBC1(dv, o + 8, out, width, height, bx, by, false);
      }
    }
  } else if (isFourCC('ATI1') || isFourCC('BC4U')) {
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const o = dataOffset + (by * bw + bx) * 8;
        decodeBlockBC4Channel(dv, o, out, width, height, bx, by, 0);
      }
    }
    // recopie R -> G,B pour un rendu niveaux de gris
    for (let i = 0; i < width * height; i++) {
      out[i * 4 + 1] = out[i * 4];
      out[i * 4 + 2] = out[i * 4];
    }
  } else if (isFourCC('ATI2') || isFourCC('A2XY') || isFourCC('BC5U')) {
    // BC5 à deux canaux. Attention à la convention de canaux selon le FourCC :
    //   - « ATI2 »/« A2XY » : sous-bloc 0 = VERT, sous-bloc 1 = ROUGE
    //     (ATI2 = BC5U avec R et G échangés — même convention qu'à l'encodage).
    //   - « BC5U »          : sous-bloc 0 = ROUGE, sous-bloc 1 = VERT (standard).
    // On décode ainsi chaque .dds vers R = rugosité, G = métal, quelle que soit
    // la variante d'origine.
    const swapped = !isFourCC('BC5U'); // ATI2 / A2XY => échangé
    const firstChannel = swapped ? 1 : 0; // canal du sous-bloc 0
    const secondChannel = swapped ? 0 : 1; // canal du sous-bloc 1
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const o = dataOffset + (by * bw + bx) * 16;
        decodeBlockBC4Channel(dv, o, out, width, height, bx, by, firstChannel);
        decodeBlockBC4Channel(dv, o + 8, out, width, height, bx, by, secondChannel);
      }
    }
    for (let i = 0; i < width * height; i++) out[i * 4 + 2] = 0;
  } else if ((pfFlags & 0x40) !== 0) {
    // RGB(A) non compressé
    const bitCount = dv.getUint32(88, true);
    const rMask = dv.getUint32(92, true);
    const gMask = dv.getUint32(96, true);
    const bMask = dv.getUint32(100, true);
    const aMask = dv.getUint32(104, true);
    const bytes = bitCount / 8;
    const maskShift = (m: number) => {
      if (m === 0) return { s: 0, bits: 0 };
      let s = 0;
      while (((m >> s) & 1) === 0) s++;
      let bits = 0;
      while ((m >> (s + bits)) & 1) bits++;
      return { s, bits };
    };
    const rm = maskShift(rMask);
    const gm = maskShift(gMask);
    const bm = maskShift(bMask);
    const am = maskShift(aMask);
    const read = (v: number, m: { s: number; bits: number }, def: number) => {
      if (m.bits === 0) return def;
      const raw = (v >> m.s) & ((1 << m.bits) - 1);
      return Math.round((raw / ((1 << m.bits) - 1)) * 255);
    };
    for (let i = 0; i < width * height; i++) {
      let v = 0;
      for (let b = 0; b < bytes; b++) v |= dv.getUint8(dataOffset + i * bytes + b) << (b * 8);
      out[i * 4] = read(v, rm, 0);
      out[i * 4 + 1] = read(v, gm, 0);
      out[i * 4 + 2] = read(v, bm, 0);
      out[i * 4 + 3] = read(v, am, 255);
    }
  } else {
    return null;
  }
  return { width, height, data: out };
}

/** Décode le mip 0 d'un DDS. Retourne null si format non géré ou données invalides. */
export function decodeDDS(buf: ArrayBuffer): RGBAImage | null {
  try {
    return decodeDDSInternal(buf);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TGA (pour Icon.tga)

/** Encode une image RGBA en TGA 32 bits non compressé (origine en haut à gauche). */
export function encodeTGA(img: RGBAImage): ArrayBuffer {
  const buf = new ArrayBuffer(18 + img.width * img.height * 4);
  const dv = new DataView(buf);
  dv.setUint8(2, 2); // truecolor non compressé
  dv.setUint16(12, img.width, true);
  dv.setUint16(14, img.height, true);
  dv.setUint8(16, 32); // bpp
  dv.setUint8(17, 0x28); // 8 bits alpha, origine haut-gauche
  const px = new Uint8Array(buf, 18);
  for (let i = 0; i < img.width * img.height; i++) {
    px[i * 4] = img.data[i * 4 + 2]; // B
    px[i * 4 + 1] = img.data[i * 4 + 1]; // G
    px[i * 4 + 2] = img.data[i * 4]; // R
    px[i * 4 + 3] = img.data[i * 4 + 3]; // A
  }
  return buf;
}
