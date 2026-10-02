/**
 * Import / export du skin au format .zip TM2020
 * (à placer dans Documents/Trackmania/Skins/Models/CarSport/).
 */

import JSZip from 'jszip';
import { decodeDDS, encodeDDS, encodeTGA, type RGBAImage } from './dds';
import { ILLUM_ROLES, MAPS, mapIdFromFileName, type IllumRole, type MapId } from './maps';
import { UV_GUIDE_ISLANDS } from './uvGuideData';
import {
  SKIN3D_MESH_FILE,
  baseName,
  isGameZipPassthrough,
  isMainBodyMeshName,
  isPreviewGlbName,
  isSkin3DMetaName,
  type Skin3DFile,
  type Skin3DProject,
} from './skin3d';

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
  /** Rôle appliqué au canal alpha de Details_I, hors feux de vitesse. */
  illumRole?: IllumRole;
  /** Discrete behaviour of each painted light, encoded in R. */
  getIllumRoleCanvas?: (id: MapId) => HTMLCanvasElement;
  /**
   * Couleur des feux arrière (compteur). Toujours allumés, indépendamment du rôle.
   * Défaut : blanc.
   */
  speedColor?: string;
  /** Capture de l'aperçu 3D pour Icon.tga (facultatif). */
  icon?: HTMLCanvasElement;
  /** Mesh 3D déjà compilé, joint tel quel au zip. */
  meshGbx?: Uint8Array;
  /** Fichiers du projet 3D à recopier (fakeshad, autres GBX). */
  passthrough?: Skin3DFile[];
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
 * Le rôle choisi s'applique aux zones peintes par l'utilisateur. Les deux zones
 * du compteur sont forcées en alpha 97 : c'est la valeur des skins où la
 * vitesse reste visible en roulant (l'alpha ~3 ne l'affiche qu'au freinage,
 * l'alpha 255 n'allume pas ce panneau).
 *
 * Ne mute PAS l'image source (copie), pour rester réutilisable.
 */
const SPEED_LIT = 20;
/**
 * Alpha des deux zones du compteur. Mesuré sur des skins où la vitesse reste
 * affichée sans freiner (Bronze, Plastic, Kr6) : 97, pas 3 ni 255.
 */
const SPEED_ALPHA = 97;

/**
 * Les deux zones UV du compteur :
 * la forme juste au-dessus de l'octogone « FEU », et la pastille en bas à droite.
 * L'octogone « FEU » lui-même n'en fait pas partie.
 */
const SPEED_ZONE_BOXES = [
  { x0: 0.388, y0: 0.021, x1: 0.439, y1: 0.039 },
  { x0: 0.649, y0: 0.409, x1: 0.708, y1: 0.426 },
];

function polygonBox(poly: { x: number; y: number }[]) {
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

export function speedLightPolygons(): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  for (const island of UV_GUIDE_ISLANDS) {
    if (island.family !== 'details') continue;
    for (const poly of island.polygons) {
      const box = polygonBox(poly);
      const hit = SPEED_ZONE_BOXES.some(
        (zone) =>
          Math.abs(box.x0 - zone.x0) < 0.012 &&
          Math.abs(box.y0 - zone.y0) < 0.012 &&
          Math.abs(box.x1 - zone.x1) < 0.012 &&
          Math.abs(box.y1 - zone.y1) < 0.012,
      );
      if (hit) out.push(poly);
    }
  }
  return out;
}

const rearLightMasks = new Map<string, Uint8Array>();

function fillUvPolygon(
  mask: Uint8Array,
  width: number,
  height: number,
  poly: { x: number; y: number }[],
) {
  if (poly.length < 3) return;
  const pts = poly.map((p) => ({ x: p.x * width, y: p.y * height }));
  let minY = height;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, Math.floor(p.y));
    maxY = Math.max(maxY, Math.ceil(p.y));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(height - 1, maxY);
  for (let y = minY; y <= maxY; y++) {
    const ys = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const yi = pts[i].y;
      const yj = pts[j].y;
      if (yi > ys === yj > ys) continue;
      xs.push(pts[i].x + ((ys - yi) * (pts[j].x - pts[i].x)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(width - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) mask[y * width + x] = 1;
    }
  }
}

function parseHexColor(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length === 6) {
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    if ([r, g, b].every((n) => Number.isFinite(n))) return [r, g, b];
  }
  return [255, 255, 255];
}

/** Îlots UV des feux arrière, là où le jeu affiche la vitesse. */
export function speedLightMask(width: number, height: number): Uint8Array {
  const key = `${width}x${height}`;
  const cached = rearLightMasks.get(key);
  if (cached) return cached;
  const mask = new Uint8Array(width * height);
  for (const poly of speedLightPolygons()) fillUvPolygon(mask, width, height, poly);
  rearLightMasks.set(key, mask);
  return mask;
}

export function applyIllumRole(
  img: RGBAImage,
  role: IllumRole,
  rearMask?: Uint8Array,
  speedColor = '#ffffff',
  roles?: RGBAImage,
): RGBAImage {
  const alpha = ILLUM_ROLES.find((r) => r.id === role)?.alpha ?? 255;
  const speedRgb = parseHexColor(speedColor);
  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  const mask = rearMask && rearMask.length === img.width * img.height ? rearMask : null;
  for (let p = 0, i = 0; i < out.length; p++, i += 4) {
    const lit = Math.max(src[i], src[i + 1], src[i + 2]) > SPEED_LIT;
    const rear = mask?.[p] === 1;
    if (rear) {
      out[i] = speedRgb[0];
      out[i + 1] = speedRgb[1];
      out[i + 2] = speedRgb[2];
      // 97 : lumière du compteur, visible en roulant. 3 = seulement au freinage.
      out[i + 3] = SPEED_ALPHA;
    } else if (lit) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = roles && roles.width === img.width && roles.height === img.height ? roles.data[i] : alpha;
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
  /** Rôle du canal alpha pour la map d'illumination (Details_I), hors vitesse. */
  illumRole?: IllumRole;
  illumRoles?: RGBAImage;
  illumRolesByMap?: Partial<Record<MapId, RGBAImage>>;
  /** Couleur des feux du compteur. Allumés en roulant. Défaut blanc. */
  speedColor?: string;
  /** Icône déjà encodée en TGA (facultatif). */
  iconTGA?: ArrayBuffer;
  /**
   * Mesh compilé (NadeoImporter + skinfix), recopié tel quel.
   * Absent → zip texture classique, sans changement de forme.
   */
  meshGbx?: Uint8Array;
  /** DDS hors maps (fakeshad) et GBX non-mesh, même règle que SkinMaker. */
  passthrough?: Skin3DFile[];
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
      // Les feux de vitesse sont toujours écrits, même si le reste du calque est noir.
      rgba = applyIllumRole(
        rgba,
        opts.illumRole ?? 'always',
        def.id === 'Details_I' ? speedLightMask(rgba.width, rgba.height) : undefined,
        opts.speedColor ?? '#ffffff',
        opts.illumRolesByMap?.[def.id] ?? (def.id === 'Details_I' ? opts.illumRoles : undefined),
      );
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
  if (opts.meshGbx) {
    zip.file(SKIN3D_MESH_FILE, opts.meshGbx);
  }
  for (const extra of opts.passthrough ?? []) {
    const name = baseName(extra.name);
    if (!isGameZipPassthrough(name) || zip.file(name)) continue;
    zip.file(name, extra.data);
  }
  const meshNote = opts.meshGbx
    ? `Ce zip contient ${SKIN3D_MESH_FILE} : le visuel remplace la carrosserie, la hitbox reste celle du jeu.\n`
    : '';
  zip.file(
    'ReadMe.txt',
    `Skin "${opts.skinName}" généré par TM Skin Studio.\n` +
      meshNote +
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
  const illumRolesByMap: Partial<Record<MapId, RGBAImage>> = {};
  for (const def of MAPS.filter((map) => map.kind === 'illum')) {
    const roleSource = sources.getIllumRoleCanvas?.(def.id);
    if (!roleSource) continue;
    const size = images[def.id].width;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(roleSource, 0, 0, size, size);
    illumRolesByMap[def.id] = { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data };
  }
  return buildSkinZipFromImages(images, {
    skinName,
    illumRole: sources.illumRole,
    illumRolesByMap,
    speedColor: sources.speedColor,
    iconTGA,
    meshGbx: sources.meshGbx,
    passthrough: sources.passthrough,
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
  /** Présent si le zip contient MainBody.Mesh.gbx. */
  skin3d: Skin3DProject | null;
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
  const result: ImportResult = { imported: [], skipped: [], failures: [], skin3d: null };
  /** Dernière texture gagnante par map (zip peut contenir des doublons). */
  const byId = new Map<MapId, { id: MapId; image: RGBAImage; path: string }>();
  let mesh: Uint8Array | null = null;
  let preview: ArrayBuffer | null = null;
  let metaName: string | null = null;
  const passthrough: Skin3DFile[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const file = baseName(path);
    if (isMainBodyMeshName(file)) {
      mesh = new Uint8Array(await entry.async('arraybuffer'));
      continue;
    }
    if (isPreviewGlbName(file)) {
      preview = await entry.async('arraybuffer');
      continue;
    }
    if (isSkin3DMetaName(file)) {
      try {
        const parsed = JSON.parse(await entry.async('string')) as { name?: unknown };
        if (typeof parsed.name === 'string' && parsed.name.trim()) metaName = parsed.name.trim();
      } catch {
        /* métadonnées illisibles : le mesh reste chargeable */
      }
      continue;
    }
    if (isGameZipPassthrough(file)) {
      passthrough.push({ name: file, data: new Uint8Array(await entry.async('arraybuffer')) });
      continue;
    }
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
  if (mesh) {
    result.skin3d = { mesh, preview, passthrough, name: metaName };
  }
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
