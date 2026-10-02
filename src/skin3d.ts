/**
 * Skin voiture 3D TM2020 : mesh custom (même hitbox) + textures peintes ici.
 *
 * Manifeste calé sur SkinMaker (Zip.cs, bmx22c) :
 *   - le zip de jeu contient les DDS, les JSON du dossier de travail, et les
 *     `*.*.gbx` SAUF `*.mesh.gbx` ;
 *   - `MainBody.Mesh.gbx` (sortie de skinfix, dossier hors Work) est ajouté à part ;
 *   - le `Nom.Mesh.gbx` produit par NadeoImporter avant skinfix n'est PAS dans le zip.
 *
 * Ici, les DDS des maps connues sont régénérées par l'éditeur. On recopie seulement
 * les DDS supplémentaires (ex. `fakeshad.dds`) et les GBX qui ne sont pas un mesh
 * de carrosserie. `skin3d.json` et `preview.glb` servent à l'app, pas au jeu.
 */

import { MAPS } from './maps';

/** Mesh que le jeu charge à la place du visuel Stadium Car. */
export const SKIN3D_MESH_FILE = 'MainBody.Mesh.gbx';

/** Aperçu pour l'app (mêmes UV / matériaux que le FBX compilé). */
export const SKIN3D_PREVIEW_FILE = 'preview.glb';

/** Métadonnées du dossier projet (nom, date). Absentes du zip de jeu. */
export const SKIN3D_META_FILE = 'skin3d.json';

export interface Skin3DFile {
  /** Nom de fichier seul, tel qu'il apparaît à la racine du zip. */
  name: string;
  data: Uint8Array;
}

/** Projet 3D chargé depuis un zip (dossier projet ou skin déjà compilé). */
export interface Skin3DProject {
  mesh: Uint8Array;
  /** Absent si le zip ne contient que le mesh de jeu, sans aperçu. */
  preview: ArrayBuffer | null;
  passthrough: Skin3DFile[];
  /** Nom lu dans skin3d.json, s'il est présent. */
  name: string | null;
}

export function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

export function isMainBodyMeshName(path: string): boolean {
  return baseName(path).toLowerCase() === SKIN3D_MESH_FILE.toLowerCase();
}

export function isPreviewGlbName(path: string): boolean {
  return baseName(path).toLowerCase() === SKIN3D_PREVIEW_FILE;
}

export function isSkin3DMetaName(path: string): boolean {
  return baseName(path).toLowerCase() === SKIN3D_META_FILE;
}

const PAINTED_DDS = new Set(MAPS.map((m) => m.fileName.toLowerCase()));

/**
 * Fichier recopié tel quel dans le zip de jeu.
 * Reprend le filtre SkinMaker, moins les maps que l'app ré-encode.
 */
export function isGameZipPassthrough(path: string): boolean {
  const name = baseName(path);
  const lower = name.toLowerCase();
  if (isMainBodyMeshName(lower) || isPreviewGlbName(lower) || isSkin3DMetaName(lower)) {
    return false;
  }
  if (lower.endsWith('.dds')) return !PAINTED_DDS.has(lower);
  // `[Nom].[QuelqueChose].gbx` mais pas `*.mesh.gbx` (mesh pré-skinfix).
  if (lower.endsWith('.gbx') && !lower.endsWith('.mesh.gbx')) {
    return /^[^.]+\.[^.]+\.gbx$/i.test(name);
  }
  return false;
}
