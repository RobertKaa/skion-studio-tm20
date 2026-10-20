import JSZip from 'jszip';
import { MAPS, MAP_BY_ID, type IllumRole, type MapId } from './maps';
import type { PreviewViewState } from './three/CarPreview';
import type { Skin3DFile, Skin3DProject } from './skin3d';
import { isWheelSurfaceMode, type WheelSurfaceSettings } from './wheelSurface';
import { validateBlenderParts, type BlenderPart } from './blenderParts';
import { validIllumCodes } from './illumination';
import { LEGACY_TEXTURE_RESOLUTION, TEXTURE_RESOLUTION, upgradeMapResolution, isTextureResolution, type TextureResolution } from './editor/resolution';
import { isPreviewEnvironment, type PreviewEnvironment } from './previewEnvironment';
import { HORN_ASSET_PATH, MAX_HORN_BYTES, hornDuration, hornSourceName, type SkinHorn } from './horn';
import { validTextureBackgroundSettings } from './editor/textureBackground';
import { isValidMaterialLayer } from './materials/types';
import { validReliefSettings, type ReliefSettings } from './relief/settings';
import { INDEPENDENT_DETAILS, type DetailsLayout } from './detailsSides';
import { UNDERBODY_PANEL_LAYOUT } from './underbodyPanel';

export type ProjectMaps = Record<MapId, Record<string, unknown>>;
export interface ProjectWorkspace {
  textureResolution?: TextureResolution;
  activeMap: MapId; view: '2d' | 'split' | '3d'; camera: PreviewViewState;
  coatIntensity: number; neonIntensity: number; night: boolean; braking: boolean;
  /** Global export protection; optional for projects saved before dirt controls existed. */
  dirtEnabled?: boolean;
  dirtPreview?: number;
  /** Optional to retain compatibility with projects created before the test circuit. */
  environment?: PreviewEnvironment;
  wheelSurface?: WheelSurfaceSettings;
  relief?: ReliefSettings;
}
export interface ProjectDocument {
  format: 'tm-skin-studio'; version: 1 | 2; name: string;
  editor: { maps: ProjectMaps; speedColor: string; illumRole: IllumRole };
  workspace: ProjectWorkspace;
  model: null | { mesh: string; preview: string | null; name: string | null; parts?: BlenderPart[]; detailsLayout?: DetailsLayout; uvAtlas?:'organized-v1'; passthrough: { name: string; asset: string }[] };
  /** Normal/prelight maps also belong to texture-only skins, without a custom mesh. */
  surfaceTextures?: { name: string; asset: string }[];
  /** Optional for older projects. The audio is embedded, never an external URL. */
  horn?: { name: string; asset: string };
}
export interface ProjectBundle { document: ProjectDocument; assets: Map<string, Blob | Uint8Array> }
export const PROJECT_EXTENSION = '.tmskin';
// Editable 4K PBR sources plus a dense model can exceed 128 MiB even when
// their game ZIP is compact. Keep a bounded project capacity distinct from it.
const MAX_FILE = 192 * 1024 * 1024;
const MAX_EXPANDED = 256 * 1024 * 1024;
// Native custom cars split the 2048² atlases into many independently editable
// pieces. The sphere car alone needs ~300 million pixels before deduplication.
const MAX_IMAGE_PIXELS = 384 * 1024 * 1024;
const ROLES = new Set(['always', 'head', 'brake']);
const OBJECT_TYPES = new Set(['rect', 'ellipse', 'circle', 'triangle', 'line', 'polygon', 'polyline', 'path', 'i-text', 'itext', 'text', 'textbox', 'group', 'image', 'linear', 'radial', 'layoutmanager', 'fit-content', 'fixed', 'clip-path']);
const ASSET_PATH = /^assets\/(?:image-\d+\.png|mesh\.gbx|preview\.glb|extra-\d+\.bin|horn\.wav)$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function fail(message: string): never { throw new Error(`Projet non chargé : ${message}`); }

/** Upgrade only the exact historical nine-map and eleven-map layouts. */
export function upgradeProjectMaps(value: unknown): unknown {
  if (!record(value) || value.format !== 'tm-skin-studio' || value.version !== 1 || !record(value.editor) || !record(value.editor.maps)) return value;
  const maps = value.editor.maps;
  const layouts = [MAPS.filter((map) => !['Skin_I', 'Wheels_I', 'Details_DirtMask', 'Wheels_DirtMask'].includes(map.id)),
    MAPS.filter((map) => !['Details_DirtMask', 'Wheels_DirtMask'].includes(map.id))];
  if (!layouts.some((layout) => Object.keys(maps).length === layout.length && layout.every((map) => Object.hasOwn(maps, map.id)))) return value;
  const upgraded = { ...maps };
  for (const def of MAPS) if (!Object.hasOwn(upgraded, def.id)) upgraded[def.id] = {
    objects: [], background: def.defaultFill, ...(def.kind === 'illum' ? { illumRole: 'always' } : {}),
  };
  return { ...value, editor: { ...value.editor, maps: upgraded } };
}

/** Validation avant toute instanciation Fabric ou création d'URL. Aucune ressource externe admise. */
export function validateProjectDocument(value: unknown, assets: Set<string>): asserts value is ProjectDocument {
  if (!record(value) || value.format !== 'tm-skin-studio' || value.version !== 1 && value.version !== 2) fail('format ou version non pris en charge.');
  if (typeof value.name !== 'string' || value.name.length > 120) fail('nom invalide.');
  if (!record(value.editor) || !record(value.editor.maps) || Object.keys(value.editor.maps).length !== MAPS.length) fail('textures manquantes.');
  const editor = value.editor as Record<string, unknown>;
  const maps = editor.maps as Record<string, unknown>;
  for (const def of MAPS) if (!record(maps[def.id]) || !Array.isArray((maps[def.id] as Record<string, unknown>).objects)) fail(`texture ${def.id} invalide.`);
  for (const map of Object.values(maps) as Record<string, unknown>[]) {
    if (map.workRes === undefined ? value.version === 2 : map.workRes !== LEGACY_TEXTURE_RESOLUTION && map.workRes !== TEXTURE_RESOLUTION) fail('résolution de texture invalide.');
  }
  if (typeof editor.speedColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(editor.speedColor) || !ROLES.has(String(editor.illumRole))) fail('réglages de lumière invalides.');
  const w = value.workspace;
  if (!record(w) || typeof w.activeMap !== 'string' || !Object.hasOwn(MAP_BY_ID, w.activeMap) || !['2d', 'split', '3d'].includes(String(w.view))) fail('espace de travail invalide.');
  const workspace = w as Record<string, unknown>;
  if (!record(workspace.camera) || !['position', 'target'].every((key) => {
    const tuple = (workspace.camera as Record<string, unknown>)[key];
    return Array.isArray(tuple) && tuple.length === 3 && tuple.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 200);
  })) fail('vue 3D invalide.');
  for (const [key, max] of [['coatIntensity', 1], ['neonIntensity', 4]] as const) if (typeof workspace[key] !== 'number' || (workspace[key] as number) < 0 || (workspace[key] as number) > max) fail('intensité invalide.');
  if (typeof workspace.night !== 'boolean' || typeof workspace.braking !== 'boolean') fail('simulation invalide.');
  if (workspace.textureResolution !== undefined && !isTextureResolution(workspace.textureResolution)) fail('résolution de texture invalide.');
  if (workspace.relief !== undefined && !validReliefSettings(workspace.relief, src => /^assets\/image-\d+\.png$/.test(src) && assets.has(src))) fail('réglages ou sources du relief invalides.');
  if (workspace.environment !== undefined && !isPreviewEnvironment(workspace.environment)) fail('environnement de test invalide.');
  if (workspace.dirtEnabled !== undefined && typeof workspace.dirtEnabled !== 'boolean') fail('protection de saleté invalide.');
  if (workspace.dirtPreview !== undefined && (typeof workspace.dirtPreview !== 'number' || !Number.isFinite(workspace.dirtPreview) || workspace.dirtPreview < 0 || workspace.dirtPreview > 1)) fail('aperçu de saleté invalide.');
  if (workspace.wheelSurface !== undefined) {
    const surface = workspace.wheelSurface;
    if (!record(surface) || !isWheelSurfaceMode(surface.mode) || typeof surface.strength !== 'number' || !Number.isFinite(surface.strength) || surface.strength < 0 || surface.strength > 1) fail('relief des pneus invalide.');
  }
  const asset = (path: unknown) => { if (typeof path !== 'string' || !ASSET_PATH.test(path) || !assets.has(path)) fail('image ou fichier lié absent.'); };
  if (value.horn !== undefined) {
    if (!record(value.horn) || typeof value.horn.name !== 'string' || !value.horn.name || value.horn.name !== hornSourceName(value.horn.name) || value.horn.asset !== HORN_ASSET_PATH) fail('klaxon invalide.');
    asset(value.horn.asset);
  }
  if (value.surfaceTextures !== undefined) {
    if (!Array.isArray(value.surfaceTextures) || value.surfaceTextures.length > 5) fail('textures de surface invalides.');
    const names = new Set<string>();
    for (const entry of value.surfaceTextures) {
      if (!record(entry) || typeof entry.name !== 'string' || !/^(?:(?:Details|Wheels)_N|(?:Skin|Details|Wheels)_AO)\.dds$/i.test(entry.name) || names.has(entry.name.toLowerCase())) fail('texture de surface invalide.');
      names.add(entry.name.toLowerCase()); asset(entry.asset);
      if (!/^assets\/extra-\d+\.bin$/.test(String(entry.asset))) fail('ressource de surface invalide.');
    }
  }
  const image = (path: unknown) => { asset(path); if (typeof path !== 'string' || !/^assets\/image-\d+\.png$/.test(path)) fail('ressource image invalide.'); };
  let nodes = 0; let objects = 0;
  const walk = (node: unknown, depth: number) => {
    if (++nodes > 500_000 || depth > 40) fail('configuration trop complexe.');
    if (typeof node === 'number' && (!Number.isFinite(node) || Math.abs(node) > 1e18)) fail('valeur numérique invalide.');
    if (typeof node === 'string' && node.length > 200_000) fail('texte trop long.');
    if (Array.isArray(node)) { node.forEach((entry) => walk(entry, depth + 1)); return; }
    if (!record(node)) return;
    for (const key of Object.keys(node)) if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('propriété interdite.');
    if (typeof node.type === 'string' && !OBJECT_TYPES.has(node.type.toLowerCase())) fail(`type de calque « ${node.type.slice(0, 40)} » non pris en charge.`);
    if (node.src !== undefined) image(node.src);
    if (node.materialLayer !== undefined && (String(node.type).toLowerCase() !== 'image' || node.decal !== undefined ||
      !isValidMaterialLayer(node.materialLayer, (src) => /^assets\/image-\d+\.png$/.test(src) && assets.has(src)))) fail('matériau ou textures associés invalides.');
    if (node.linkedImageId) fail('un fragment ne peut pas remplacer son image maîtresse.');
    if (node.filters !== undefined && (!Array.isArray(node.filters) || node.filters.length)) fail('filtre d’image non pris en charge.');
    if (node.textureBackground !== undefined && (!validTextureBackgroundSettings(node.textureBackground) ||
      String(node.type).toLowerCase() !== 'group' || !Array.isArray(node.objects) || node.objects.length !== (node.textureBackground.layout||node.textureBackground.uvAtlas||node.textureBackground.projection ? 3 : 2) ||
      !record(node.objects[0]) || String(node.objects[0].type).toLowerCase() !== 'image' ||
      ((node.textureBackground.layout||node.textureBackground.uvAtlas||node.textureBackground.projection) && (!record(node.objects[1]) || String(node.objects[1].type).toLowerCase() !== 'image')) ||
      !record(node.objects.at(-1)) || String(node.objects.at(-1)!.type).toLowerCase() !== 'rect')) fail('image de fond invalide.');
    if (node.illumRole !== undefined && !ROLES.has(String(node.illumRole))) fail('rôle lumineux invalide.');
    if (node.illumCodes !== undefined && !validIllumCodes(node.illumCodes)) fail('masque de comportement lumineux invalide.');
    if (node.blenderPart !== undefined && (typeof node.blenderPart !== 'string' || !/^[\w:.-]{1,120}$/.test(node.blenderPart))) fail('référence de pièce invalide.');
    if (node.partColor !== undefined && (typeof node.partColor !== 'string' || !/^#[\da-f]{6}$/i.test(node.partColor))) fail('couleur de pièce invalide.');
    if (node.imageLight !== undefined) {
      if (!record(node.imageLight) || !ROLES.has(String(node.imageLight.role)) || typeof node.imageLight.strength !== 'number' || !Number.isFinite(node.imageLight.strength) || node.imageLight.strength < 0 || node.imageLight.strength > 1) fail('lumière d’image invalide.');
    }
    if (node.imageLightEnabled !== undefined && typeof node.imageLightEnabled !== 'boolean') fail('activation de lumière d’image invalide.');
    if (node.decal !== undefined) {
      const d = node.decal;
      if (!record(d)) fail('projection invalide.');
      const decal = d as Record<string, unknown>;
      image(decal.source);
      if (!Array.isArray(decal.families) || !decal.families.length || decal.families.some((f) => !['skin', 'details', 'wheels'].includes(String(f)))) fail('surface de projection invalide.');
      for (const key of ['center', 'normal', 'tangent']) if (!Array.isArray(decal[key]) || (decal[key] as unknown[]).length !== 3 || !(decal[key] as unknown[]).every((v) => typeof v === 'number' && Number.isFinite(v))) fail('projection incomplète.');
      for (const key of ['normal', 'tangent']) if (Math.hypot(...decal[key] as [number, number, number]) < .001) fail('direction de projection invalide.');
      for (const key of ['width', 'height', 'depth']) if (typeof decal[key] !== 'number' || (decal[key] as number) <= 0 || (decal[key] as number) > 4.2) fail('taille de projection invalide.');
      if (typeof decal.angle !== 'number') fail('rotation invalide.');
    }
    if (Array.isArray(node.objects)) {
      if ((objects += node.objects.length) > 5000) fail('5000 calques maximum.');
      if (node.objects.some((o) => !record(o) || typeof o.type !== 'string')) fail('calque invalide.');
    }
    Object.values(node).forEach((entry) => walk(entry, depth + 1));
  };
  walk(maps, 0);
  if (value.model !== null) {
    const m = value.model;
    if (!record(m) || !Array.isArray(m.passthrough) || m.passthrough.length > 64) fail('modèle invalide.');
    const model = m as Record<string, unknown>;
    if(model.uvAtlas!==undefined&&model.uvAtlas!=='organized-v1')fail('Disposition UV inconnue.');
    if (model.parts !== undefined) validateBlenderParts(model.parts);
    if (model.detailsLayout !== undefined && ![INDEPENDENT_DETAILS,UNDERBODY_PANEL_LAYOUT].includes(model.detailsLayout as DetailsLayout)) fail('Disposition des détails invalide.');
    if (model.mesh !== 'assets/mesh.gbx' || (model.preview !== null && model.preview !== 'assets/preview.glb')) fail('ressource du modèle invalide.');
    asset(model.mesh); if (model.preview !== null) asset(model.preview);
    if (model.name !== null && (typeof model.name !== 'string' || model.name.length > 120)) fail('nom du modèle invalide.');
    for (const entry of model.passthrough as unknown[]) {
      if (!record(entry) || typeof entry.name !== 'string' || !entry.name || entry.name.length > 160 || /[\\/]/.test(entry.name) || entry.name.includes(String.fromCharCode(0)) || entry.name.includes('..')) fail('nom de fichier invalide.');
      asset((entry as Record<string, unknown>).asset);
      if (!/^assets\/extra-\d+\.bin$/.test(String((entry as Record<string, unknown>).asset))) fail('ressource du modèle invalide.');
    }
  }
}

export function validateProjectPng(bytes: Uint8Array) {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail('image PNG invalide.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16); const height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 32 * 1024 * 1024) fail('image trop grande.');
  return width * height;
}

export function projectLayerCount(document: ProjectDocument) {
  return Object.values(document.editor.maps).reduce((total, map) => total + (map.objects as Record<string, unknown>[]).filter((o) => !o.referenceOnly && o.name !== 'Vitesse').length, 0);
}

/** Called only after validation; originals and model/world coordinates are retained. */
export function upgradeProjectResolution(document: ProjectDocument): ProjectDocument {
  return { ...document, version: 2, editor: { ...document.editor,
    maps: Object.fromEntries(MAPS.map((map) => [map.id, upgradeMapResolution(document.editor.maps[map.id])])) as ProjectMaps,
  } };
}

/** Share byte-identical PNGs without merging layers or modifying the caller's document. */
async function compactProjectImages(bundle: ProjectBundle): Promise<ProjectBundle> {
  if (bundle.assets.size > 300) fail('projet trop volumineux.');
  const assets = new Map<string, Uint8Array>();
  const buckets = new Map<string, { path: string; bytes: Uint8Array }[]>();
  const aliases = new Map<string, string>();
  let imagePixels = 0; let totalBytes = 0;
  for (const [path, content] of bundle.assets) {
    if (!ASSET_PATH.test(path)) fail('chemin de ressource invalide.');
    const bytes = content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : content;
    if (bytes.length > 64 * 1024 * 1024) fail('projet trop volumineux.');
    if (path === HORN_ASSET_PATH) {
      try { hornDuration(bytes); } catch { fail('fichier du klaxon invalide.'); }
    }
    if (path.endsWith('.png')) {
      const pixels = validateProjectPng(bytes);
      // This hash only selects comparison candidates; full byte equality decides sharing.
      let hash = 2166136261;
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
      const key = `${bytes.length}:${hash >>> 0}`;
      const candidates = buckets.get(key) ?? [];
      const match = candidates.find((entry) => entry.bytes.every((byte, index) => byte === bytes[index]));
      if (match) { aliases.set(path, match.path); continue; }
      if ((imagePixels += pixels) > MAX_IMAGE_PIXELS) fail('trop d’images en haute résolution dans ce projet.');
      candidates.push({ path, bytes }); buckets.set(key, candidates);
    }
    // Internal capture can reference the same immutable texture from several
    // families and the relief source. Only unique files enter the final ZIP.
    // Untrusted ZIPs are still capped before decompression in readProjectFile.
    if ((totalBytes += bytes.length) > MAX_EXPANDED) fail('projet trop volumineux.');
    assets.set(path, bytes);
  }
  if (!aliases.size) return { document: bundle.document, assets };
  const document = structuredClone(bundle.document);
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!record(node)) return;
    if (typeof node.src === 'string') node.src = aliases.get(node.src) ?? node.src;
    if (record(node.decal) && typeof node.decal.source === 'string') node.decal.source = aliases.get(node.decal.source) ?? node.decal.source;
    Object.values(node).forEach(walk);
  };
  walk(document.editor.maps);
  walk(document.workspace.relief);
  return { document, assets };
}

export async function writeProjectFile(bundle: ProjectBundle): Promise<Blob> {
  try { return await serializeProjectFile(bundle); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('Projet non chargé :')) throw new Error(error.message.replace('Projet non chargé :', 'Projet non enregistré :'));
    throw error;
  }
}

async function serializeProjectFile(bundle: ProjectBundle): Promise<Blob> {
  validateProjectDocument(bundle.document, new Set(bundle.assets.keys()));
  const compact = await compactProjectImages(bundle);
  const document = upgradeProjectResolution(compact.document);
  validateProjectDocument(document, new Set(compact.assets.keys()));
  const zip = new JSZip();
  const manifest = JSON.stringify(document);
  const manifestBytes = new TextEncoder().encode(manifest).length;
  if (manifestBytes > 8 * 1024 * 1024 || compact.assets.size > 300) fail('projet trop volumineux.');
  zip.file('project.json', manifest);
  let total = manifestBytes;
  for (const [name, content] of compact.assets) {
    if (!ASSET_PATH.test(name)) fail('chemin de ressource invalide.');
    const bytes = content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : content;
    if (bytes.length > 64 * 1024 * 1024 || (total += bytes.length) > MAX_EXPANDED) fail('projet trop volumineux.');
    zip.file(name, bytes);
  }
  const buffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  if (buffer.byteLength > MAX_FILE) fail(`192 Mo maximum par fichier projet (${(buffer.byteLength/1048576).toFixed(1)} Mo obtenus).`);
  return new Blob([buffer], { type: 'application/zip' });
}

export async function readProjectFile(file: Blob): Promise<ProjectBundle> {
  if (file.size > MAX_FILE) fail('192 Mo maximum par fichier projet.');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  let total = 0;
  if (entries.length > 301 || !zip.file('project.json')) fail('archive invalide.');
  for (const entry of entries) {
    if (entry.name !== 'project.json' && !ASSET_PATH.test(entry.name)) fail('fichier inattendu dans le projet.');
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    const limit = entry.name === HORN_ASSET_PATH ? MAX_HORN_BYTES : (entry.name === 'project.json' ? 8 : 64) * 1024 * 1024;
    if (typeof size !== 'number' || size < 0 || size > limit || (total += size) > MAX_EXPANDED) fail('archive trop volumineuse.');
  }
  const document: unknown = upgradeProjectMaps(JSON.parse(await zip.file('project.json')!.async('string')));
  const paths = new Set(entries.filter((e) => e.name !== 'project.json').map((e) => e.name));
  validateProjectDocument(document, paths);
  const assets = new Map<string, Blob | Uint8Array>();
  for (const path of paths) {
    const bytes = await zip.file(path)!.async('uint8array');
    assets.set(path, bytes);
  }
  const compact = await compactProjectImages({ document, assets });
  const upgraded = upgradeProjectResolution(compact.document);
  validateProjectDocument(upgraded, new Set(compact.assets.keys()));
  return { document: upgraded, assets: compact.assets };
}

/** Les références de l'archive sont remplacées uniquement par des URLs créées pour ses propres PNG. */
export function hydrateProject(bundle: ProjectBundle): { document: ProjectDocument; model: Skin3DProject | null; surfaceTextures: Skin3DFile[]; horn: SkinHorn | null; urls: string[] } {
  const document = structuredClone(bundle.document); const urls: string[] = [];
  const images = new Map<string, string>();
  for (const [path, value] of bundle.assets) if (path.endsWith('.png')) {
    const blob = value instanceof Blob ? value : new Blob([new Uint8Array(value)], { type: 'image/png' });
    const url = URL.createObjectURL(blob); images.set(path, url); urls.push(url);
  }
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!record(node)) return;
    if (typeof node.src === 'string') node.src = images.get(node.src)!;
    if (record(node.decal)) node.decal.source = images.get(String(node.decal.source))!;
    Object.values(node).forEach(walk);
  };
  walk(document.editor.maps);
  walk(document.workspace.relief);
  const data = (path: string) => {
    const bytes = bundle.assets.get(path);
    if (!(bytes instanceof Uint8Array)) fail('ressource binaire invalide.');
    return new Uint8Array(bytes as Uint8Array);
  };
  const m = document.model;
  const model: Skin3DProject | null = m ? { mesh: data(m.mesh), preview: m.preview ? data(m.preview).buffer as ArrayBuffer : null,
    name: m.name, ...(m.detailsLayout?{detailsLayout:m.detailsLayout}:{}), ...(m.uvAtlas?{uvAtlas:m.uvAtlas}:{}), ...(m.parts ? { parts: m.parts } : {}), passthrough: m.passthrough.map((entry) => ({ name: entry.name, data: data(entry.asset) })) } : null;
  const surfaceTextures = (document.surfaceTextures ?? []).map((entry) => ({ name: entry.name, data: data(entry.asset) }));
  const horn = document.horn ? { name: document.horn.name, data: data(document.horn.asset) } : null;
  if (horn) hornDuration(horn.data);
  return { document, model, surfaceTextures, horn, urls };
}

export function projectError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'Espace local insuffisant. Téléchargez un fichier projet pour conserver votre travail.';
  return error instanceof Error ? error.message : 'La sauvegarde est indisponible dans ce navigateur.';
}
