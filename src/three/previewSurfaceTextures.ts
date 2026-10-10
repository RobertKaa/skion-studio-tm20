import * as THREE from 'three';
import type { RGBAImage } from '../dds';
import type { Skin3DFile } from '../skin3d';
import {
  applyWheelRelief, decodeNormalVectors, getWheelTreadNormal, isWheelTreadPreset,
  normalizeWheelSurface, resolveWheelNormalImage, SMOOTH_WHEEL_NORMAL, type WheelSurfaceSettings,
} from '../wheelSurface';

export const NORMAL_TEXTURE_FILES = ['Details_N.dds', 'Wheels_N.dds'] as const;
export type NormalTextureFile = typeof NORMAL_TEXTURE_FILES[number];

const nativeUrls: Record<NormalTextureFile, URL> = {
  'Details_N.dds': new URL('../assets/model/car/Details_N.dds', import.meta.url),
  'Wheels_N.dds': new URL('../assets/model/car/Wheels_N.dds', import.meta.url),
};

/**
 * Trackmania BC5 normals store tangent X/Y, without Z. Its car resource spec
 * specifies OpenGL (Y+), as does Three: keep Y, reconstruct the positive Z.
 * Nadeo's "Stadium CAR Ressources" car-texturing specification (08/06/2020).
 */
export const decodeNormalTexture = decodeNormalVectors;

export function normalTextureFile(name: string): NormalTextureFile | null {
  const file = name.split(/[/\\]/).pop()?.toLowerCase();
  return NORMAL_TEXTURE_FILES.find((candidate) => candidate.toLowerCase() === file) ?? null;
}

/** Unknown custom UVs must never inherit the Stadium tyre tread. */
export function resolveNormalTexture(
  file: NormalTextureFile,
  imported: ReadonlyMap<NormalTextureFile, RGBAImage>,
  native: ReadonlyMap<NormalTextureFile, RGBAImage>,
  officialModel: boolean,
): RGBAImage | null {
  return imported.get(file) ?? (officialModel ? native.get(file) : null) ?? null;
}

/** Owns only the GPU normal textures; it never changes the editable atlases. */
export class PreviewSurfaceTextures {
  private imported = new Map<NormalTextureFile, RGBAImage>();
  private native = new Map<NormalTextureFile, RGBAImage>();
  private textures = new Map<NormalTextureFile, { image: RGBAImage; texture: THREE.DataTexture }>();
  private officialModel = true;
  private wheelSurface = normalizeWheelSurface(undefined);
  private wheelTransform: { source: RGBAImage; strength: number; image: RGBAImage } | null = null;
  private disposed = false;
  private readonly materials: { details: THREE.MeshStandardMaterial; wheels: THREE.MeshStandardMaterial };
  private readonly anisotropy: number;

  constructor(
    materials: { details: THREE.MeshStandardMaterial; wheels: THREE.MeshStandardMaterial },
    anisotropy: number,
  ) { this.materials = materials; this.anisotropy = anisotropy; }

  async loadNativeTextures(load?: (url: URL) => Promise<ArrayBuffer>): Promise<void> {
    if (this.disposed) return;
    const loadBuffer = load ?? (async (url: URL) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    });
    await Promise.all(NORMAL_TEXTURE_FILES.map(async (file) => {
      try {
        // Share the native wheel image with the 2D guide/export and its bounded
        // sidewall composites instead of fetching/decoding a second CPU atlas.
        const image = file === 'Wheels_N.dds' && !load
          ? await resolveWheelNormalImage({ mode: 'relief', strength: 1 })
          : decodeNormalTexture(await loadBuffer(nativeUrls[file]));
        if (this.disposed) return;
        if (!image) return;
        this.native.set(file, image);
        this.sync();
      } catch (error) {
        if (!this.disposed) console.warn(`[CarPreview] ${file} indisponible pour l’aperçu.`, error);
      }
    }));
  }

  setFiles(files: readonly Skin3DFile[]) {
    if (this.disposed) return;
    const imported = new Map<NormalTextureFile, RGBAImage>();
    for (const entry of files) {
      const file = normalTextureFile(entry.name);
      if (!file) continue;
      const image = decodeNormalTexture(entry.data.slice().buffer);
      if (image) imported.set(file, image);
    }
    this.imported = imported;
    this.sync();
  }

  setOfficialModel(official: boolean) {
    this.officialModel = official;
    this.sync();
  }

  /** Smooth is a flat normal, just like the explicit Wheels_N exported to game. */
  setWheelSurface(value: WheelSurfaceSettings) {
    const next = normalizeWheelSurface(value);
    if (next.mode === this.wheelSurface.mode && next.strength === this.wheelSurface.strength) return;
    this.wheelSurface = next;
    this.sync();
  }

  private wheelImage(source: RGBAImage | null): RGBAImage | null {
    const { mode, strength } = this.wheelSurface;
    if (mode === 'smooth' || strength === 0) return SMOOTH_WHEEL_NORMAL;
    // The generated atlas is authored for the official Stadium UV islands.
    // Use the same explicit flat fallback as export on unknown custom UVs.
    if (isWheelTreadPreset(mode)) {
      if (!this.officialModel) return SMOOTH_WHEEL_NORMAL;
      source = getWheelTreadNormal(mode, this.native.get('Wheels_N.dds'));
    }
    if (!source) return null;
    if (this.wheelTransform?.source === source && this.wheelTransform.strength === strength) return this.wheelTransform.image;
    const image = applyWheelRelief(source, strength);
    this.wheelTransform = { source, strength, image };
    return image;
  }

  private sync() {
    if (this.disposed) return;
    for (const file of NORMAL_TEXTURE_FILES) {
      const material = file === 'Details_N.dds' ? this.materials.details : this.materials.wheels;
      const source = resolveNormalTexture(file, this.imported, this.native, this.officialModel);
      const image = file === 'Wheels_N.dds' ? this.wheelImage(source) : source;
      const previous = this.textures.get(file);
      if (previous?.image === image) continue;
      previous?.texture.dispose();
      this.textures.delete(file);
      if (image) {
        const texture = new THREE.DataTexture(image.data, image.width, image.height);
        texture.name = file;
        texture.colorSpace = THREE.NoColorSpace;
        texture.flipY = true; // Same UV convention as the editable CanvasTextures.
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.anisotropy;
        texture.needsUpdate = true;
        this.textures.set(file, { image, texture });
        material.normalMap = texture;
      } else material.normalMap = null;
      material.needsUpdate = true;
    }
  }

  dispose() {
    this.disposed = true;
    for (const { texture } of this.textures.values()) texture.dispose();
    this.textures.clear(); this.native.clear(); this.imported.clear();
    this.wheelTransform = null;
    this.materials.details.normalMap = null; this.materials.wheels.normalMap = null;
  }
}
