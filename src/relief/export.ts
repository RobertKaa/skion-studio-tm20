import JSZip from 'jszip';
import { exportSkinZip, type ExportSources } from '../skinZip';
import { MAPS, type MapId } from '../maps';
import type { Skin3DFile } from '../skin3d';
import type { ReliefPrototypeResult, ReliefTextureResolution } from './types';

/** Conservative app target after a rejected 4K upload, not a published game limit. */
export const RELIEF_GAME_ZIP_LIMIT_BYTES = 24_000_000;

export interface ReliefExportProfile {
  colourResolution: ReliefTextureResolution;
  secondaryColourResolution: ReliefTextureResolution;
  bodyNormalResolution: ReliefTextureResolution;
  finishResolution: ReliefTextureResolution;
  bodyFinishResolution: ReliefTextureResolution;
  detailsWheelNormalResolution: ReliefTextureResolution;
  illuminationResolution: ReliefTextureResolution;
  maxArchiveBytes: number;
  budgetPolicy: 'conservative-target-unverified';
  fallbackUsed: string[];
  /** Actual DDS dimensions, including constant maps smaller than the quality cap. */
  resolutions: Record<string, { width: number; height: number }>;
  actualArchiveBytes: number;
}

export function reliefExportProfile(resolution: ReliefTextureResolution): ReliefExportProfile {
  const secondary = Math.min(resolution, 2048) as ReliefTextureResolution;
  return { colourResolution: resolution, secondaryColourResolution: secondary,
    bodyNormalResolution: secondary, finishResolution: secondary, bodyFinishResolution: secondary,
    detailsWheelNormalResolution: secondary, illuminationResolution: secondary,
    maxArchiveBytes: RELIEF_GAME_ZIP_LIMIT_BYTES, budgetPolicy: 'conservative-target-unverified',
    fallbackUsed: [], resolutions: {}, actualArchiveBytes: 0 };
}

/**
 * Promote an existing DDS mip to its new base level, preserving every retained
 * block exactly. The encoder already averages material data in linear space;
 * BC5 normals retain tangent X/Y and reconstruct their unit Z in the shader.
 * Reusing those mips avoids another lossy encode and a second RGBA allocation.
 */
export function limitPrototypeDDSResolution(data: Uint8Array, maximum: number): Uint8Array {
  if (!Number.isInteger(maximum) || maximum < 4 || maximum > 4096) throw new Error('Plafond DDS invalide.');
  if (data.byteLength < 128) throw new Error('Texture DDS du prototype incomplète.');
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fourCC = String.fromCharCode(...data.subarray(84, 88));
  const blockBytes = ['DXT1', 'ATI1', 'BC4U'].includes(fourCC) ? 8
    : ['DXT3', 'DXT5', 'ATI2', 'A2XY', 'BC5U'].includes(fourCC) ? 16 : 0;
  let height = header.getUint32(12, true), width = header.getUint32(16, true);
  const mipCount = header.getUint32(28, true) || 1;
  if (header.getUint32(0, true) !== 0x20534444 || header.getUint32(4, true) !== 124 ||
    header.getUint32(76, true) !== 32 || !(header.getUint32(80, true) & 4) || !blockBytes ||
    !width || !height || width > 8192 || height > 8192 || header.getUint32(24, true) > 1 ||
    header.getUint32(112, true) !== 0 || mipCount > Math.floor(Math.log2(Math.max(width, height))) + 1) {
    throw new Error('Format DDS du prototype non pris en charge.');
  }
  let offset = 128, skipBytes = 0, skippedLevels = 0;
  let outputWidth = width, outputHeight = height;
  for (let level = 0; level < mipCount; level++) {
    const bytes = Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * blockBytes;
    if (offset + bytes > data.byteLength) throw new Error('Mipmaps DDS du prototype incomplètes.');
    if (width > maximum || height > maximum) {
      skipBytes += bytes; skippedLevels++;
      outputWidth = Math.max(1, width >> 1); outputHeight = Math.max(1, height >> 1);
    }
    offset += bytes; width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
  }
  if (!skippedLevels) return data;
  if (skippedLevels >= mipCount || outputWidth > maximum || outputHeight > maximum) {
    throw new Error('La texture DDS ne contient pas la résolution nécessaire à l’export.');
  }
  const output = new Uint8Array(offset - skipBytes);
  output.set(data.subarray(0, 128)); output.set(data.subarray(128 + skipBytes, offset), 128);
  const outputHeader = new DataView(output.buffer);
  outputHeader.setUint32(12, outputHeight, true); outputHeader.setUint32(16, outputWidth, true);
  outputHeader.setUint32(20, Math.max(1, Math.ceil(outputWidth / 4)) * Math.max(1, Math.ceil(outputHeight / 4)) * blockBytes, true);
  outputHeader.setUint32(28, mipCount - skippedLevels, true);
  return output;
}

/** Only this experimental game export changes the resolutions of secondary atlases. */
export async function applyReliefExportProfile(zip: JSZip, resolution: ReliefTextureResolution,
  profile: ReliefExportProfile = reliefExportProfile(resolution)): Promise<ReliefExportProfile> {
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.dds$/i.test(entry.name)) continue;
    const name = entry.name.toLowerCase();
    let maximum: number | undefined;
    if (name === 'skin_b.dds') maximum = profile.colourResolution;
    else if (/^(details|wheels)_b\.dds$/.test(name)) maximum = profile.secondaryColourResolution;
    else if (name === 'skin_n.dds') maximum = profile.bodyNormalResolution;
    else if (/^(details|wheels)_n\.dds$/.test(name)) maximum = profile.detailsWheelNormalResolution;
    else if (name === 'skin_r.dds') maximum = profile.bodyFinishResolution;
    else if (/^(details|wheels)_r\.dds$/.test(name) || name === 'skin_coatr.dds') maximum = profile.finishResolution;
    else if (/^(skin|details|wheels)_i\.dds$/.test(name)) maximum = profile.illuminationResolution;
    else if (/^(skin|details|wheels)_(ao|dirtmask)\.dds$/.test(name)) maximum = Math.min(resolution, 2048);
    const source = await entry.async('uint8array');
    const data = maximum === undefined ? source : limitPrototypeDDSResolution(source, maximum);
    if (data !== source) zip.file(entry.name, data);
    if (data.byteLength < 128 || new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) !== 0x20534444) {
      throw new Error('Texture DDS du prototype incomplète.');
    }
    const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
    profile.resolutions[entry.name] = { width: header.getUint32(16, true), height: header.getUint32(12, true) };
  }
  return profile;
}

/** The archive target is precautionary; passing it does not guarantee game registration. */
export function assertReliefGameZipBudget(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error('Taille du ZIP invalide.');
  if (byteLength >= RELIEF_GAME_ZIP_LIMIT_BYTES) {
    throw new Error(`Le ZIP du prototype pèse ${(byteLength / 1_000_000).toFixed(1)} Mo après optimisation et dépasse notre cible prudente de 24 Mo. Choisissez la qualité 2K ou 1K pour réduire sa taille. Cette cible ne garantit pas l’acceptation par le jeu.`);
  }
}

/** Measure the real compressed ZIP after each fallback, preserving Skin_B quality. */
export async function fitReliefArchiveToBudget<T extends { size: number }>(zip: JSZip,
  resolution: ReliefTextureResolution, createArchive: (profile: ReliefExportProfile) => Promise<T>,
): Promise<{ archive: T; profile: ReliefExportProfile }> {
  const profile = await applyReliefExportProfile(zip, resolution);
  const canReduce = (names: RegExp) => Object.entries(profile.resolutions).some(([name, size]) =>
    names.test(name) && Math.max(size.width, size.height) > 1024);
  const fallbacks = [
    { name: 'secondary-normals-1k', needed: () => canReduce(/^(details|wheels)_n\.dds$/i),
      apply: () => { profile.detailsWheelNormalResolution = 1024; } },
    { name: 'secondary-finishes-1k', needed: () => canReduce(/^(details_r|wheels_r|skin_coatr)\.dds$/i),
      apply: () => { profile.finishResolution = 1024; } },
    { name: 'body-finish-1k', needed: () => canReduce(/^skin_r\.dds$/i),
      apply: () => { profile.bodyFinishResolution = 1024; } },
  ];
  let archive = await createArchive(profile);
  profile.actualArchiveBytes = archive.size;
  if (!Number.isSafeInteger(archive.size) || archive.size < 0) assertReliefGameZipBudget(archive.size);
  for (const fallback of fallbacks) {
    if (archive.size < RELIEF_GAME_ZIP_LIMIT_BYTES) break;
    if (!fallback.needed()) continue;
    fallback.apply(); profile.fallbackUsed.push(fallback.name);
    await applyReliefExportProfile(zip, resolution, profile);
    archive = await createArchive(profile);
    profile.actualArchiveBytes = archive.size;
    if (!Number.isSafeInteger(archive.size) || archive.size < 0) assertReliefGameZipBudget(archive.size);
  }
  assertReliefGameZipBudget(archive.size);
  return { archive, profile };
}

/**
 * STORE the small, padded documents so writing the measured byte count cannot
 * alter archive size. Reuse compressed DDS/model entries for the second pass.
 */
export async function generateReliefArchive(zip: JSZip, profile: ReliefExportProfile,
  metadata: unknown, readme: (profile: ReliefExportProfile) => string,
): Promise<Blob> {
  profile.actualArchiveBytes = 0;
  const encoder = new TextEncoder();
  const metadataBytes = encoder.encode(JSON.stringify(metadata, null, 2)).byteLength + 64;
  const readmeBytes = encoder.encode(readme(profile)).byteLength + 64;
  const padded = (value: string, bytes: number): Uint8Array => {
    const content = encoder.encode(value);
    if (content.byteLength > bytes) throw new Error('Métadonnées du prototype trop longues.');
    const output = new Uint8Array(bytes); output.fill(32); output.set(content); return output;
  };
  const writeDocuments = (target: JSZip) => {
    target.file('skin3d.json', padded(JSON.stringify(metadata, null, 2), metadataBytes), { compression: 'STORE' });
    target.file('ReadMe.txt', padded(readme(profile), readmeBytes), { compression: 'STORE' });
  };
  writeDocuments(zip);
  const options = { type: 'blob' as const, compression: 'DEFLATE' as const, compressionOptions: { level: 9 } };
  const measured = await zip.generateAsync(options);
  profile.actualArchiveBytes = measured.size;
  const finalZip = await JSZip.loadAsync(await measured.arrayBuffer());
  writeDocuments(finalZip);
  const archive = await finalZip.generateAsync(options);
  if (archive.size !== measured.size) throw new Error('La taille finale du prototype a changé pendant sa vérification.');
  return archive;
}

const nativeUrls = {
  'Details_N.dds': new URL('../assets/model/car/Details_N.dds', import.meta.url),
  'Wheels_N.dds': new URL('../assets/model/car/Wheels_N.dds', import.meta.url),
  'Skin_AO.dds': new URL('../assets/model/car/Skin_AO.dds', import.meta.url),
  'Details_AO.dds': new URL('../assets/model/car/Details_AO.dds', import.meta.url),
  'Wheels_AO.dds': new URL('../assets/model/car/Wheels_AO.dds', import.meta.url),
};
const nativeBuffers = new Map<string, Promise<Uint8Array>>();

/** The prepared car has the original UVs, so its game ZIP carries the same native surfaces as its preview. */
export async function prototypeSurfaceFiles(files: readonly Skin3DFile[]): Promise<Skin3DFile[]> {
  const result = new Map(files.filter(file => !/^Skin_N\.dds$/i.test(file.name)).map(file => [file.name.toLowerCase(), file]));
  await Promise.all(Object.entries(nativeUrls).map(async ([name, url]) => {
    if (result.has(name.toLowerCase())) return;
    let pending = nativeBuffers.get(name);
    if (!pending) {
      pending = fetch(url, { signal: AbortSignal.timeout(15_000) }).then(async response => {
        if (!response.ok) throw new Error(`Texture d’origine indisponible : ${name}`);
        return new Uint8Array(await response.arrayBuffer());
      });
      nativeBuffers.set(name, pending);
      pending.catch(() => nativeBuffers.delete(name));
    }
    result.set(name.toLowerCase(), { name, data: await pending });
  }));
  return [...result.values()];
}

export function reliefPrototypeName(name: string, result: ReliefPrototypeResult): string {
  const base = [...name.replace(/[\\/:*?"<>|]/g, '')].filter(character => character.charCodeAt(0) >= 32).join('').trim().slice(0, 100) || 'Skin';
  const label = result.options.surfaceMethod ? `relief-v1.0${result.options.diagnostic ? '-diagnostic-volume' : ''}` : result.options.diagnostic ? 'prototype-diagnostic-volume' : 'prototype-relief';
  return `${base}-${label}${result.options.family?`-${result.options.family}`:''}-${result.options.scope}-${result.options.mode}-${result.options.strengthMm}mm-${result.options.textureResolution}px`;
}

/** A prototype archive stays separate from local projects, and can be reopened in the app. */
export async function exportReliefPrototype(
  name: string, sourceName: string, result: ReliefPrototypeResult,
  maps: ReadonlyMap<MapId, HTMLCanvasElement>, baseFiles: readonly Skin3DFile[],
  settings: Pick<ExportSources, 'illumRole' | 'speedColor' | 'getIllumRoleCanvas' | 'dirtEnabled' | 'horn'>,
  icon: HTMLCanvasElement,
): Promise<Blob> {
  if (!result.project.preview || !MAPS.every(map => maps.has(map.id))) throw new Error('Le prototype est incomplet.');
  const archiveName = reliefPrototypeName(name, result);
  const extras = new Map([...baseFiles, ...result.project.passthrough].map(file => [file.name.toLowerCase(), file]));
  if (result.options.mode === 'geometry') extras.delete('skin_n.dds');
  const blob = await exportSkinZip(archiveName, {
    ...settings, textureResolution: result.options.textureResolution,
    mapResolutions: Object.fromEntries(MAPS.map(map => [map.id,
      map.id === 'Skin_B' ? result.options.textureResolution : Math.min(result.options.textureResolution, 2048),
    ])),
    getMapCanvas: id => maps.get(id)!, icon, meshGbx: result.project.mesh,
    detailsLayout: result.project.detailsLayout, uvAtlas:result.project.uvAtlas, previewGlb: result.project.preview,
    passthrough: [...extras.values()],
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  zip.file('preview.glb', result.project.preview);
  const fitted = await fitReliefArchiveToBudget(zip, result.options.textureResolution, exportProfile =>
    generateReliefArchive(zip, exportProfile, { version: 1, name: archiveName, ...(result.project.detailsLayout ? { detailsLayout: result.project.detailsLayout } : {}), ...(result.project.uvAtlas?{uvAtlas:result.project.uvAtlas}:{}), [result.options.surfaceMethod ? 'relief' : 'prototype']: {
      version: result.options.surfaceMethod ? '1.0.0' : 1, source: sourceName.slice(0, 160), ...result.options, ...result.stats,
      exportProfile, gameValidation: 'pending',
    } }, profile => [
    result.options.surfaceMethod ? 'TEXTURES ET RELIEF v1.0 — SKION STUDIO' : 'PROTOTYPE DE RELIEF — SKION STUDIO',
    `Source : ${sourceName.slice(0, 160)}`,
    `Mode : ${result.options.mode} ; amplitude : ${result.options.strengthMm} mm.`,
    `Zone : ${result.options.scope === 'vehicle' ? `surface entière ${result.options.family??'skin'}` : 'capot'} ; textures : ${result.options.textureResolution} px.`,
    `Export jeu : couleur Skin jusqu’à ${profile.colourResolution} px ; couleurs Details/Wheels jusqu’à ${profile.secondaryColourResolution} px ; normales Skin jusqu’à ${profile.bodyNormalResolution} px.`,
    `Finitions Skin jusqu’à ${profile.bodyFinishResolution} px ; finitions secondaires/vernis jusqu’à ${profile.finishResolution} px ; normales Details/Wheels jusqu’à ${profile.detailsWheelNormalResolution} px ; illumination jusqu’à ${profile.illuminationResolution} px.`,
    `Optimisation supplémentaire : ${profile.fallbackUsed.length ? profile.fallbackUsed.join(', ') : 'aucune'}.`,
    `Taille finale du ZIP : ${profile.actualArchiveBytes} octets. Les dimensions réelles de chaque DDS sont consignées dans skin3d.json.`,
    'Le ZIP doit rester sous notre cible prudente de 24 Mo (24 000 000 octets), choisie après un rejet 4K.',
    'Cette cible n’est pas une limite officielle publiée et ne garantit pas l’acceptation par Trackmania.',
    `Sommets déplacés : ${result.stats.affectedVertices} ; déplacement maximal : ${result.stats.maxDisplacementMm.toFixed(3)} mm.`,
    ...(result.options.diagnostic ? ['TEST DE DIAGNOSTIC : volume volontairement exagéré. Comparer le profil et les ombres avec le témoin sans relief. Utiliser le test géométrique gris pour isoler la géométrie.'] : []),
    '',
    result.options.surfaceMethod ? 'Surface densifiée, cinq niveaux de détail. Le volume Body a déjà été confirmé en course avec un ZIP local ; l’extension aux pièces articulées et aux autres familles reste à vérifier en jeu.' : 'Ce ZIP contient une voiture 3D expérimentale. Il ne remplace aucun projet enregistré dans l’app.',
    'Le volume est écrit dans MainBody.Mesh.gbx ; preview.glb représente les mêmes positions.',
    'Le volume et les nouvelles textures ciblent uniquement la famille sélectionnée. Les volumes précédents des autres familles sont conservés.',
    'Les attaches des pièces mobiles sont conservées ; le volume ne remplace pas le squelette ni les animations.',
    'Les raccords du volume sont protégés. La taille et l’orientation du motif peuvent varier selon les UV des pièces.',
    'Carrosserie : seul le volume géométrique a été confirmé en course ; les normales de texture ne sont pas proposées dans l’atelier. Détails/Roues conservent leurs normales BC5.',
    'Le volume est intégré au maillage avant l’export ; sa présence dans le fichier ne garantit pas un relief perceptible en course.',
    'Chaque export utilise vos propres réglages : contrôlez le résultat dans le garage puis en course.',
    'Privilégier l’import direct du ZIP local pour les essais 3D. Des objets de deux anciens skins ont réapparu après réimport local, mais sont restés absents via un Club ; la cause et le fichier effectivement distribué restent à vérifier.',
    'Ce retour sur les anciens skins ne valide pas le partage de ce prototype via les Clubs. La compatibilité console reste à vérifier.',
    '',
    'Essai PC : copier le ZIP dans Documents/Trackmania/Skins/Models/CarSport puis le sélectionner dans le Garage si disponible.',
    'Contrôler la voiture de face et de profil, les reflets, les roues et les effets des réacteurs.',
    'Pour revoir le modèle dans Skion Studio, importer ce même ZIP : son aperçu GLB est inclus.',
    ].join('\n')));
  return fitted.archive;
}
