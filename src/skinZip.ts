/**
 * Import / export du skin au format .zip TM2020
 * (à placer dans Documents/Trackmania/Skins/Models/CarSport/).
 */

import JSZip from 'jszip';
import { decodeDDS, encodeDDS, encodeTGA, type RGBAImage } from './dds';
import { ILLUM_ROLES, MAPS, mapIdFromFileName, type IllumRole, type MapId } from './maps';

/**
 * Rends la totalité du contenu d'un canvas source dans un buffer RGBA de
 * `size×size`. On utilise la forme à 5 arguments de `drawImage`, qui met à
 * l'échelle l'intégralité du canvas source quelle que soit sa taille interne
 * (backstore) : aucun risque de rognage si le backstore diffère de workRes.
 */
function canvasToRGBA(source: HTMLCanvasElement, size: number): RGBAImage {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Un canvas fabric non encore rendu peut avoir un backstore vide : on ne
  // dessine que s'il a une taille réelle, sinon le buffer reste transparent.
  if (source.width > 0 && source.height > 0) {
    ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, size, size);
  }
  const data = ctx.getImageData(0, 0, size, size).data;
  return { width: size, height: size, data };
}

/** Attend la prochaine frame d'animation (fallback timer hors navigateur). */
function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

export interface ExportSources {
  getMapCanvas: (id: MapId) => HTMLCanvasElement;
  /** Rôle appliqué au canal alpha de Details_I (néon / phares / freins). */
  illumRole?: IllumRole;
  /** Capture de l'aperçu 3D pour Icon.tga (facultatif). */
  icon?: HTMLCanvasElement;
  /**
   * Force un rendu synchrone de TOUTES les maps avant la capture des pixels.
   * Indispensable : le buffer texture est synchronisé via `flushTexture` /
   * `getCanvasElement` (rendu scène sans viewportTransform), pas le lowerCanvasEl
   * d'affichage qui inclut le pan/zoom.
   */
  flush?: () => void;
  /**
   * Plafond FACULTATIF de résolution d'export (px), appliqué à CHAQUE map :
   * la résolution effective devient `min(def.exportRes, maxExportRes)`. Permet
   * d'offrir un réglage de qualité dans l'UI (ex. 2048 « Haute », 1024
   * « Standard », 512 « Légère ») sans toucher aux maps.ts. Non fourni ⇒ chaque
   * map garde son `exportRes`. Les maps en aplat sont de toute façon rétrécies.
   */
  maxExportRes?: number;
}

/**
 * Encode le rôle des zones lumineuses dans une map `_I` (Details_I, BC3/DXT5).
 * Convention Nadeo confirmée (spec officielle Maniaplanet + doc TM2020) :
 *   - RVB = COULEUR d'émission (noir = éteint : rien n'émet).
 *   - Alpha = TYPE de lumière (rôle) :
 *       255 (1.0)  → tableau de bord / néon « toujours allumé »
 *       103 (~0.5) → phares (allumés la nuit)   [valeur communautaire, off. ~128]
 *       3   (~0)   → feux de frein (base + plus fort au freinage)
 *
 * Pour chaque pixel :
 *   - « allumé » (RVB non quasi-noir)  → RVB conservé, alpha = rôle choisi.
 *   - « éteint » (RVB quasi-noir)      → RVB forcé à NOIR (aucune émission) et
 *     alpha BLANC (255). C'est EXACTEMENT ce que font les skins Nadeo qui
 *     fonctionnent (« le reste de Details_I est noir en RVB, alpha blanc »).
 *     On évite ainsi de taguer tout le fond en rôle « frein » (alpha 0) et de
 *     laisser une bavure de couleur créer un halo parasite.
 *
 * IMPORTANT (limite de conception) : un SEUL rôle est appliqué à TOUTES les
 * zones allumées d'un même export. On ne peut donc pas mélanger néon toujours
 * allumé + feux de frein réactifs dans le même skin via cette fonction.
 *
 * Ne mute PAS l'image source (copie), pour rester réutilisable.
 */
export function applyIllumRole(img: RGBAImage, role: IllumRole): RGBAImage {
  const alpha = ILLUM_ROLES.find((r) => r.id === role)?.alpha ?? 255;
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < out.length; i += 4) {
    const lit = Math.max(src[i], src[i + 1], src[i + 2]) > 20;
    if (lit) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = alpha;
    } else {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

export interface BuildSkinZipOptions {
  skinName: string;
  /** Rôle du canal alpha pour la map d'illumination (Details_I). */
  illumRole?: IllumRole;
  /** Icône déjà encodée en TGA (facultatif). */
  iconTGA?: ArrayBuffer;
}

/**
 * Résolution (px) à laquelle on réduit une map de COULEUR UNIE (« plate »).
 * Une map jamais éditée reste à sa couleur de remplissage : l'exporter en 2048²
 * gaspille ~2,7 Mo de VRAM que le jeu doit (re)charger à chaque respawn. Une map
 * plate rend STRICTEMENT à l'identique à 4×4 (même couleur, chaîne de mips
 * triviale) : on divise donc son poids par des milliers sans aucune perte
 * visible. 4 = taille minimale d'un bloc BC (4×4).
 */
const FLAT_MAP_RES = 4;

/**
 * Détecte une image RGBA strictement uniforme (tous les pixels identiques) et
 * renvoie sa couleur, sinon `null`. Sert à repérer les maps laissées à leur
 * couleur par défaut (ou peintes d'un aplat uni) pour les exporter en tout petit.
 * Détection EXACTE (aucune tolérance) : on ne rétrécit jamais une map qui porte
 * le moindre détail.
 */
function uniformColor(img: RGBAImage): [number, number, number, number] | null {
  const d = img.data;
  if (d.length < 4) return null;
  const r = d[0];
  const g = d[1];
  const b = d[2];
  const a = d[3];
  for (let i = 4; i < d.length; i += 4) {
    if (d[i] !== r || d[i + 1] !== g || d[i + 2] !== b || d[i + 3] !== a) return null;
  }
  return [r, g, b, a];
}

/** Construit une image `size×size` remplie d'une seule couleur RGBA. */
function solidImage(size: number, [r, g, b, a]: [number, number, number, number]): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width: size, height: size, data };
}

/**
 * Cœur PUR de l'export (sans DOM) : encode une image RGBA par map en DDS et
 * assemble le zip TM2020. Chaque map de `MAPS` DOIT être fournie, sinon l'export
 * lèverait une erreur (garantit qu'aucune map n'est silencieusement oubliée).
 * Séparé de `exportSkinZip` pour être testable en headless.
 */
export async function buildSkinZipFromImages(
  images: Record<MapId, RGBAImage>,
  opts: BuildSkinZipOptions,
): Promise<Blob> {
  const zip = new JSZip();
  for (const def of MAPS) {
    let rgba = images[def.id];
    if (!rgba) throw new Error(`Map manquante à l'export : ${def.id}`);
    if (def.kind === 'illum') {
      // On applique le rôle AVANT le test d'uniformité : une map _I noire (néon
      // éteint) devient (0,0,0,255) partout → détectée comme plate → rétrécie.
      rgba = applyIllumRole(rgba, opts.illumRole ?? 'always');
    }
    // Map laissée en aplat (non éditée) → export minuscule (voir FLAT_MAP_RES).
    const flat = uniformColor(rgba);
    if (flat && rgba.width > FLAT_MAP_RES) {
      rgba = solidImage(FLAT_MAP_RES, flat);
    }
    zip.file(def.fileName, encodeDDS(rgba, def.format));
  }
  if (opts.iconTGA) {
    zip.file('Icon.tga', opts.iconTGA);
  }
  zip.file(
    'ReadMe.txt',
    `Skin "${opts.skinName}" généré par TM Skin Studio.\n` +
      `Placez ce fichier .zip dans Documents/Trackmania/Skins/Models/CarSport/\n` +
      `puis dans le jeu : Profil > Garage > Upload skin.\n`,
  );
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportSkinZip(
  skinName: string,
  sources: ExportSources,
): Promise<Blob> {
  // 1) Force le rendu synchrone de toutes les maps si l'appelant le fournit…
  sources.flush?.();
  // 2) …puis laisse fabric vider ses `requestRenderAll` en attente (2 frames)
  //    afin qu'aucun backstore périmé ne soit lu, même sur les onglets non actifs.
  await nextAnimationFrame();
  await nextAnimationFrame();

  const images = {} as Record<MapId, RGBAImage>;
  for (const def of MAPS) {
    const res = sources.maxExportRes
      ? Math.min(def.exportRes, sources.maxExportRes)
      : def.exportRes;
    images[def.id] = canvasToRGBA(sources.getMapCanvas(def.id), res);
  }
  const iconTGA = sources.icon ? encodeTGA(canvasToRGBA(sources.icon, 256)) : undefined;
  return buildSkinZipFromImages(images, {
    skinName,
    illumRole: sources.illumRole,
    iconTGA,
  });
}

export interface ImportFailure {
  path: string;
  reason: string;
}

export interface ImportResult {
  imported: { id: MapId; image: RGBAImage; path: string }[];
  skipped: string[];
  failures: ImportFailure[];
}

const MAX_IMPORT_DIM = 8192;

/** Message d'erreur en français pour les échecs d'import (navigateur / zip). */
export function formatImportError(label: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name =
    err instanceof DOMException ? err.name : err instanceof Error ? err.name : '';
  if (name === 'NotFoundError' || /could not be found/i.test(msg)) {
    return `${label} : fichier introuvable ou illisible (supprimé, déplacé ou corrompu)`;
  }
  if (
    name === 'InvalidStateError' ||
    /could not be decoded|not.*usable|source image width is 0/i.test(msg)
  ) {
    return `${label} : image illisible ou corrompue`;
  }
  if (name === 'NotReadableError') {
    return `${label} : lecture impossible (fichier verrouillé ou permissions)`;
  }
  if (/Corrupted zip|CRC32 mismatch/i.test(msg)) {
    return `${label} : archive zip corrompue`;
  }
  if (msg && msg !== '[object DOMException]') return `${label} : ${msg}`;
  return `${label} : échec de lecture`;
}

function isValidRGBA(img: RGBAImage): boolean {
  if (!img.width || !img.height || img.width > MAX_IMPORT_DIM || img.height > MAX_IMPORT_DIM) {
    return false;
  }
  const need = img.width * img.height * 4;
  return img.data.length >= need;
}

async function decodeBitmapEntry(blob: Blob): Promise<RGBAImage | null> {
  if (!blob.size) return null;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    if (!bmp.width || !bmp.height) return null;
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    return { width: bmp.width, height: bmp.height, data };
  } finally {
    bmp.close();
  }
}

/**
 * Décode le contenu d'un zip TM2020 déjà chargé en mémoire.
 * Chaque entrée est isolée : une texture corrompue n'interrompt pas les autres.
 */
export async function importSkinZipFromBuffer(buf: ArrayBuffer): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(buf);
  const result: ImportResult = { imported: [], skipped: [], failures: [] };
  /** Dernière texture gagnante par map (zip peut contenir des doublons). */
  const byId = new Map<MapId, { id: MapId; image: RGBAImage; path: string }>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const id = mapIdFromFileName(path);
    const lower = path.toLowerCase();
    if (!id) {
      if (/\.(dds|png|jpg|jpeg|tga|webp)$/.test(lower)) result.skipped.push(path);
      continue;
    }
    try {
      let image: RGBAImage | null = null;
      if (lower.endsWith('.dds')) {
        const ddsBuf = await entry.async('arraybuffer');
        image = decodeDDS(ddsBuf);
        if (!image) {
          result.skipped.push(path);
          result.failures.push({ path, reason: `${path} : DDS non reconnu ou tronqué` });
          continue;
        }
      } else if (/\.(png|jpg|jpeg|webp)$/.test(lower)) {
        const blob = await entry.async('blob');
        image = await decodeBitmapEntry(blob);
        if (!image) {
          result.skipped.push(path);
          result.failures.push({ path, reason: `${path} : image bitmap illisible` });
          continue;
        }
      } else {
        result.skipped.push(path);
        continue;
      }
      if (!isValidRGBA(image)) {
        result.skipped.push(path);
        result.failures.push({
          path,
          reason: `${path} : dimensions invalides (${image.width}×${image.height})`,
        });
        continue;
      }
      byId.set(id, { id, image, path });
    } catch (err) {
      result.skipped.push(path);
      result.failures.push({ path, reason: formatImportError(path, err) });
    }
  }

  result.imported = [...byId.values()];
  return result;
}

export async function importSkinZip(file: File): Promise<ImportResult> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (err) {
    throw new Error(formatImportError(file.name, err));
  }
  try {
    return await importSkinZipFromBuffer(buf);
  } catch (err) {
    throw new Error(formatImportError(file.name, err));
  }
}

export function rgbaToCanvas(img: RGBAImage): HTMLCanvasElement | null {
  if (!isValidRGBA(img)) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
    0,
    0,
  );
  return c;
}
