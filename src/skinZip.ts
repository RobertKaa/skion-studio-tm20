/**
 * Import / export du skin au format .zip TM2020
 * (à placer dans Documents/Trackmania/Skins/Models/CarSport/).
 */

import JSZip from 'jszip';
import { blenderPartsFromGlb, validateBlenderParts, type BlenderPart } from './blenderParts';
import { decodeDDS, encodeDDS, encodeTGA, type RGBAImage } from './dds';
import { ILLUM_ROLES, MAPS, isDirtMask, mapIdFromFileName, type IllumRole, type MapId } from './maps';
import { UV_GUIDE_ISLANDS } from './uvGuideData';
import { ambientOcclusionFile, decodeAmbientOcclusion } from './three/previewAmbientOcclusion';
import { HORN_FILE_NAME, MAX_HORN_SOURCE_BYTES, normalizeHornAudio, prepareHorn, type SkinHorn } from './horn';
import { isTextureResolution, type TextureResolution } from './editor/resolution';
import { createSkinZipEncoder } from './workers/skinZipClient';
import { INDEPENDENT_DETAILS, type DetailsLayout } from './detailsSides';
import { REAL_UV_ATLAS, mappedMaterialRegions, type UvAtlasVersion } from './realUvAtlas';
import { UNDERBODY_PANEL_LAYOUT, panelPoint } from './underbodyPanel';
import {
  SKIN3D_MESH_FILE,
  SKIN3D_PREVIEW_FILE,
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
  c.width = c.height = 1;
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
  uvAtlas?:UvAtlasVersion;
  detailsLayout?: DetailsLayout;
  previewGlb?: ArrayBuffer;
  /** Selected raster resolution; editable layer coordinates stay independent of it. */
  textureResolution?: TextureResolution;
  /** Optional per-channel caps, used by compact exports before allocating RGBA. */
  mapResolutions?: Partial<Record<MapId, TextureResolution>>;
  horn?: SkinHorn | null;
  /** False exports black dirt masks, while leaving editable masks untouched. */
  dirtEnabled?: boolean;
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
   * la résolution effective devient `min(textureResolution ?? def.exportRes, maxExportRes)`.
   * Les maps en aplat sont de toute façon rétrécies.
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

export function speedLightPolygons(layout?: import('./detailsSides').DetailsLayout,uvAtlas?:UvAtlasVersion): { x: number; y: number }[][] {
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
  const polygons=layout===UNDERBODY_PANEL_LAYOUT?out.map(poly=>poly.map(p=>panelPoint(p,'base'))):layout ? out.flatMap(poly=>[0,.5].map(offset=>poly.map(p=>({x:offset+p.x*.5,y:p.y})))) : out;
  return uvAtlas?mappedMaterialRegions([{key:'speed',label:'Vitesse',polygons}],'details',layout??'stock').flatMap(r=>r.polygons):polygons;
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
export function speedLightMask(width: number, height: number, layout?: import('./detailsSides').DetailsLayout,uvAtlas?:UvAtlasVersion): Uint8Array {
  const key = `${width}x${height}:${layout??'native'}`;
  const cached = rearLightMasks.get(key);
  if (cached) return cached;
  const mask = new Uint8Array(width * height);
  for (const poly of speedLightPolygons(layout,uvAtlas)) fillUvPolygon(mask, width, height, poly);
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
  uvAtlas?:UvAtlasVersion;
  detailsLayout?: DetailsLayout;
  previewGlb?: ArrayBuffer;
  horn?: SkinHorn | null;
  dirtEnabled?: boolean;
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
export function encodeSkinMap(id: MapId, image: RGBAImage, opts: BuildSkinZipOptions): Uint8Array {
  const def = MAPS.find(map => map.id === id);
  if (!def || !image) throw new Error(`Map manquante à l'export : ${id}`);
  let rgba = image;
  if (isDirtMask(def.id) && opts.dirtEnabled === false) rgba = solidImage(4, [0, 0, 0, 255]);
  if (def.kind === 'illum') {
    // Les feux de vitesse sont toujours écrits, même si le reste du calque est noir.
    rgba = applyIllumRole(
      rgba,
      opts.illumRole ?? 'always',
      def.id === 'Details_I' ? speedLightMask(rgba.width, rgba.height, opts.detailsLayout,opts.uvAtlas) : undefined,
      opts.speedColor ?? '#ffffff',
      opts.illumRolesByMap?.[def.id] ?? (def.id === 'Details_I' ? opts.illumRoles : undefined),
    );
  }
  // Map laissée en aplat (non éditée) → export minuscule (voir FLAT_MAP_RES).
  const flat = uniformColor(rgba);
  if (flat && rgba.width > FLAT_MAP_RES) {
    rgba = solidImage(FLAT_MAP_RES, flat);
  }
  return new Uint8Array(encodeDDS(rgba, def.format, {
    colorSpace: def.kind === 'basecolor' ? 'srgb' : 'linear',
    mipmapAlpha: def.kind === 'illum' ? 'illumination-role' : 'average',
  }));
}

export type EncodedSkinMaps = Partial<Record<MapId, Uint8Array>>;

export async function buildSkinZipFromImages(images: Record<MapId, RGBAImage>, opts: BuildSkinZipOptions): Promise<Blob> {
  const encoded: EncodedSkinMaps = {};
  for (const def of MAPS) encoded[def.id] = encodeSkinMap(def.id, images[def.id], opts);
  return buildSkinZipFromEncodedMaps(encoded, opts);
}

/** Retain compact DDS files, never all thirteen uncompressed RGBA atlases. */
export async function buildSkinZipFromEncodedMaps(images: EncodedSkinMaps, opts: BuildSkinZipOptions): Promise<Blob> {
  const hornAudio = opts.horn ? normalizeHornAudio(opts.horn.data) : null;
  const zip = new JSZip();
  for (const def of MAPS) {
    const encoded = images[def.id];
    if (!encoded) throw new Error(`Map manquante à l'export : ${def.id}`);
    zip.file(def.fileName, encoded);
  }
  // Glass has no editable surface yet, but full-skin protection covers its dirt mask too.
  if (opts.dirtEnabled === false) zip.file('Glass_DirtMask.dds', encodeDDS(solidImage(4, [0, 0, 0, 255]), 'BC4'));
  if (opts.iconTGA) {
    zip.file('Icon.tga', opts.iconTGA);
  }
  if (opts.meshGbx) {
    zip.file(SKIN3D_MESH_FILE, opts.meshGbx);
  }
  if (opts.detailsLayout||opts.uvAtlas) {
    if ((opts.detailsLayout&&![INDEPENDENT_DETAILS,UNDERBODY_PANEL_LAYOUT].includes(opts.detailsLayout)) || (opts.uvAtlas&&opts.uvAtlas!==REAL_UV_ATLAS) || !opts.meshGbx || !opts.previewGlb) throw new Error('Modèle UV incomplet.');
    zip.file(SKIN3D_PREVIEW_FILE, opts.previewGlb);
    zip.file('skin3d.json', JSON.stringify({ version: 1, name: opts.skinName, detailsLayout: opts.detailsLayout,uvAtlas:opts.uvAtlas }));
  }
  for (const extra of opts.passthrough ?? []) {
    const name = baseName(extra.name);
    if (!isGameZipPassthrough(name) || zip.file(name)) continue;
    zip.file(name, extra.data);
  }
  if (hornAudio) zip.file(HORN_FILE_NAME, hornAudio);
  const meshNote = opts.meshGbx
    ? `Ce zip contient ${SKIN3D_MESH_FILE} : le visuel remplace la carrosserie, la hitbox reste celle du jeu.\n`
    : '';
  zip.file(
    'ReadMe.txt',
    `Skin "${opts.skinName}" généré par Skion Studio.\n` +
      meshNote +
      (opts.horn ? `Klaxon personnalisé inclus : ${HORN_FILE_NAME} (WAV mono).\n` : '') +
      `Placez ce fichier .zip dans Documents/Trackmania/Skins/Models/CarSport/\n` +
      `puis dans le jeu : Profil > Garage > Upload skin.\n`,
  );
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportSkinZip(
  skinName: string,
  sources: ExportSources,
): Promise<Blob> {
  if (sources.textureResolution !== undefined && !isTextureResolution(sources.textureResolution)) throw new Error('Résolution de texture invalide.');
  if (sources.mapResolutions !== undefined && (sources.mapResolutions === null || typeof sources.mapResolutions !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(sources.mapResolutions))
    || Object.entries(sources.mapResolutions).some(([id, size]) => !MAPS.some(map => map.id === id) || !isTextureResolution(size)))) {
    throw new Error('Résolution de canal invalide.');
  }
  // 1) Force le rendu synchrone de toutes les maps si l'appelant le fournit…
  sources.flush?.();
  // 2) …puis laisse fabric vider ses `requestRenderAll` en attente (2 frames)
  //    afin qu'aucun backstore périmé ne soit lu, même sur les onglets non actifs.
  await nextAnimationFrame();
  await nextAnimationFrame();

  const options: BuildSkinZipOptions = {
    horn: sources.horn, skinName, dirtEnabled: sources.dirtEnabled, illumRole: sources.illumRole, speedColor: sources.speedColor,
    iconTGA: sources.icon ? encodeTGA(canvasToRGBA(sources.icon, 256)) : undefined,
    meshGbx: sources.meshGbx, detailsLayout: sources.detailsLayout, uvAtlas: sources.uvAtlas, previewGlb: sources.previewGlb, passthrough: sources.passthrough,
  };
  const encoder = await createSkinZipEncoder(options, () => {
    const encoded: EncodedSkinMaps = {};
    return {
      async addMap(id, image, roles) {
        // Yield to the UI between channels when workers are unavailable.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        encoded[id] = encodeSkinMap(id, image, { ...options, ...(roles ? { illumRolesByMap: { [id]: roles } } : {}) });
      },
      finish: () => buildSkinZipFromEncodedMaps(encoded, options),
      dispose: () => { for (const def of MAPS) delete encoded[def.id]; },
    };
  });
  try {
    for (const def of MAPS) {
      if (isDirtMask(def.id) && sources.dirtEnabled === false) {
        await encoder.addMap(def.id, solidImage(4, [0, 0, 0, 255]));
        continue;
      }
      const selected = Math.min(sources.textureResolution ?? def.exportRes, sources.mapResolutions?.[def.id] ?? Infinity);
      const res = sources.maxExportRes
        ? Math.min(selected, sources.maxExportRes)
        : selected;
      const canvas = sources.getMapCanvas(def.id);
      // Blank editable channels already have a tiny, exact preview. Avoid expanding
      // them to 4096² only to shrink them again after the uniform-colour check.
      const flat = def.id !== 'Details_I' && canvas.width === FLAT_MAP_RES && canvas.height === FLAT_MAP_RES ? canvasToRGBA(canvas, FLAT_MAP_RES) : null;
      const image = flat && uniformColor(flat) ? flat : canvasToRGBA(canvas, res);
      let roles: RGBAImage | undefined;
      const roleSource = def.kind === 'illum' ? sources.getIllumRoleCanvas?.(def.id) : undefined;
      if (roleSource) {
        const roleCanvas = document.createElement('canvas'); roleCanvas.width = roleCanvas.height = image.width;
        const ctx = roleCanvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
        ctx.drawImage(roleSource, 0, 0, image.width, image.height);
        roles = { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
        roleCanvas.width = roleCanvas.height = 1;
      }
      await encoder.addMap(def.id, image, roles);
    }
    return await encoder.finish();
  } finally { encoder.dispose(); }
}

export interface ImportFailure {
  path: string;
  reason: string;
}

export interface ImportResult {
  horn?: SkinHorn;
  imported: { id: MapId; image: RGBAImage; path: string }[];
  skipped: string[];
  failures: ImportFailure[];
  /** Présent si le zip contient MainBody.Mesh.gbx. */
  skin3d: Skin3DProject | null;
  surfaceTextures?: Skin3DFile[];
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
  if (buf.byteLength > 128 * 1024 * 1024) throw new Error('128 Mo maximum par fichier skin.');
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > 512) throw new Error('Trop de fichiers dans ce skin.');
  let expanded = 0;
  for (const entry of entries) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024 || (expanded += size) > 256 * 1024 * 1024) throw new Error('Archive skin trop volumineuse après décompression.');
  }
  const result: ImportResult = { imported: [], skipped: [], failures: [], skin3d: null };
  /** Dernière texture gagnante par map (zip peut contenir des doublons). */
  const byId = new Map<MapId, { id: MapId; image: RGBAImage; path: string }>();
  let mesh: Uint8Array | null = null;
  let preview: ArrayBuffer | null = null;
  let metaName: string | null = null;
  let parts: BlenderPart[] | undefined;
  let detailsLayout: DetailsLayout | undefined;
  let uvAtlas:UvAtlasVersion|undefined;
  const passthrough: Skin3DFile[] = [];
  // Decode a single candidate; prefer the game file at the root over archived alternatives.
  const hornCandidates = entries.filter((entry) => /^horn\.(wav|ogg|mp3)$/i.test(baseName(entry.name)));
  const selectedHorn = hornCandidates.find((entry) => /^horn\.wav$/i.test(entry.name))
    ?? hornCandidates.find((entry) => /\.wav$/i.test(entry.name)) ?? hornCandidates[0];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const file = baseName(path);
    if (/^horn\.(wav|ogg|mp3)$/i.test(file)) {
      if (entry !== selectedHorn) { result.skipped.push(path); continue; }
      try {
        const size = (entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize;
        if (size > MAX_HORN_SOURCE_BYTES) throw new Error('10 Mo maximum par fichier audio.');
        const bytes = await entry.async('uint8array');
        const mime = /\.mp3$/i.test(file) ? 'audio/mpeg' : /\.ogg$/i.test(file) ? 'audio/ogg' : 'audio/wav';
        result.horn = await prepareHorn(new Blob([new Uint8Array(bytes)], { type: mime }), file);
      } catch (error) { result.failures.push({ path, reason: formatImportError('Klaxon', error) }); }
      continue;
    }
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
        const size = (entry as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize;
        if (size > 4 * 1024 * 1024) throw new Error('Métadonnées Blender trop volumineuses.');
        const metadata = await entry.async('string');
        if (metadata.length > 4 * 1024 * 1024) throw new Error('Métadonnées Blender trop volumineuses.');
        const parsed = JSON.parse(metadata) as { name?: unknown; parts?: unknown; detailsLayout?: unknown;uvAtlas?:unknown };
        if(parsed.uvAtlas!==undefined&&parsed.uvAtlas!==REAL_UV_ATLAS)throw new Error('Disposition UV inconnue.');uvAtlas=parsed.uvAtlas as UvAtlasVersion|undefined;
        if (parsed.detailsLayout !== undefined && ![INDEPENDENT_DETAILS,UNDERBODY_PANEL_LAYOUT].includes(parsed.detailsLayout as DetailsLayout)) throw new Error('Disposition des détails inconnue.');
        detailsLayout = parsed.detailsLayout as DetailsLayout | undefined;
        if (typeof parsed.name === 'string' && parsed.name.trim()) metaName = parsed.name.trim();
        if (parsed.parts !== undefined) { validateBlenderParts(parsed.parts); parts = parsed.parts; }
      } catch {
        result.failures.push({ path, reason: 'Métadonnées des pièces illisibles : textures conservées.' });
      }
      continue;
    }
    if (isGameZipPassthrough(file)) {
      const data = new Uint8Array(await entry.async('arraybuffer'));
      if (ambientOcclusionFile(file) && !decodeAmbientOcclusion(data.buffer)) {
        result.skipped.push(path);
        result.failures.push({ path, reason: `${path} : texture d’ombrage DDS non reconnue, trop grande ou tronquée` });
        continue;
      }
      if (/^(Details|Wheels)_N\.dds$/i.test(file)) {
        const normal = decodeDDS(data.buffer);
        if (!normal || !isValidRGBA(normal)) {
          result.skipped.push(path);
          result.failures.push({ path, reason: `${path} : texture de relief DDS non reconnue ou tronquée` });
          continue;
        }
      }
      passthrough.push({ name: file, data });
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
  const uniquePassthrough = [...new Map(passthrough.map((entry) => [entry.name.toLowerCase(), entry])).values()];
  result.surfaceTextures = uniquePassthrough.filter((entry) => /^(Details|Wheels)_N\.dds$/i.test(entry.name) || ambientOcclusionFile(entry.name));
  if (mesh) {
    if (!parts && preview) {
      try { parts = blenderPartsFromGlb(preview); }
      catch (err) { result.failures.push({ path: SKIN3D_PREVIEW_FILE, reason: `Pièces non séparées : ${String(err)}` }); }
    }
    result.skin3d = { mesh, preview, passthrough: uniquePassthrough, name: metaName, ...(parts?.length ? { parts } : {}), ...(detailsLayout ? { detailsLayout } : {}),...(uvAtlas?{uvAtlas}:{}) };
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
