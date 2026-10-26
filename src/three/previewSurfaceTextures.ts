import * as THREE from 'three';
import type { RGBAImage } from '../dds';
import type { Skin3DFile } from '../skin3d';
import { cachedAtlasPixels } from '../realUvTextures';
import type { AtlasSourceLayout } from '../realUvAtlas';
import { composeMaterialSurface, type MaterialSurfaceOverlay } from '../materials/surfaceMaps';
import {
  applyWheelRelief, decodeNormalVectors, getWheelTreadNormal, isWheelTreadPreset,
  normalizeWheelSurface, resolveWheelNormalImage, SMOOTH_WHEEL_NORMAL, type WheelSurfaceSettings,
} from '../wheelSurface';

export const NORMAL_TEXTURE_FILES = ['Details_N.dds', 'Wheels_N.dds', 'Skin_N.dds'] as const;
export type NormalTextureFile = typeof NORMAL_TEXTURE_FILES[number];

const nativeUrls: Partial<Record<NormalTextureFile, URL>> = {
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
  private materialOverlays: readonly MaterialSurfaceOverlay[] = [];
  private materialComposites = new Map<NormalTextureFile, { source: RGBAImage | null; overlays: readonly MaterialSurfaceOverlay[]; image: RGBAImage | null }>();
  private imported = new Map<NormalTextureFile, RGBAImage>();
  private native = new Map<NormalTextureFile, RGBAImage>();
  private textures = new Map<NormalTextureFile, { image: RGBAImage; texture: THREE.DataTexture }>();
  private officialModel = true;
  private atlasSource?:AtlasSourceLayout;
  private skinNormalEnabled = false;
  private wheelSurface = normalizeWheelSurface(undefined);
  private wheelTransform: { source: RGBAImage; strength: number; image: RGBAImage } | null = null;
  private disposed = false;
  private readonly materials: { skin?: THREE.MeshStandardMaterial; details: THREE.MeshStandardMaterial; wheels: THREE.MeshStandardMaterial };
  private readonly anisotropy: number;

  constructor(
    materials: { skin?: THREE.MeshStandardMaterial; details: THREE.MeshStandardMaterial; wheels: THREE.MeshStandardMaterial },
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
      const url = nativeUrls[file];
      if (!url) return;
      try {
        // Share the native wheel image with the 2D guide/export and its bounded
        // sidewall composites instead of fetching/decoding a second CPU atlas.
        const image = file === 'Wheels_N.dds' && !load
          ? await resolveWheelNormalImage({ mode: 'relief', strength: 1 })
          : decodeNormalTexture(await loadBuffer(url));
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

  setMaterialOverlays(overlays: readonly MaterialSurfaceOverlay[]) {
    if (this.materialOverlays === overlays) return;
    this.materialOverlays = overlays; this.sync();
  }

  private materialImage(file: NormalTextureFile, source: RGBAImage | null) {
    const cached = this.materialComposites.get(file);
    if (cached?.source === source && cached.overlays === this.materialOverlays) return cached.image;
    const family = file === 'Skin_N.dds' ? 'skin' : file === 'Details_N.dds' ? 'details' : 'wheels';
    const overlays = this.materialOverlays.filter(layer => layer.family === family && layer.normal).map(layer => layer.normal!);
    const image = composeMaterialSurface(source, overlays, true);
    this.materialComposites.set(file, { source, overlays: this.materialOverlays, image });
    return image;
  }

  setOfficialModel(official: boolean) {
    this.officialModel = official;
    this.sync();
  }
  setAtlasSource(source?:AtlasSourceLayout){if(this.atlasSource===source)return;this.atlasSource=source;this.wheelTransform=null;this.sync();}

  /** Skin_N is bound only when the loaded custom mesh explicitly requests it. */
  setSkinNormalEnabled(enabled: boolean) {
    if (this.skinNormalEnabled === enabled) return;
    this.skinNormalEnabled = enabled;
    this.sync();
  }

  /** Smooth is a flat normal, just like the explicit Wheels_N exported to game. */
  setWheelSurface(value: WheelSurfaceSettings) {
    const next = normalizeWheelSurface(value);
    if (next.mode === this.wheelSurface.mode && next.strength === this.wheelSurface.strength && next.volume === this.wheelSurface.volume) return;
    this.wheelSurface = next;
    this.sync();
  }

  private wheelImage(source: RGBAImage | null): RGBAImage | null {
    const { mode, strength } = this.wheelSurface;
    if (mode === 'smooth' || strength === 0) return SMOOTH_WHEEL_NORMAL;
    // The generated atlas is authored for the official Stadium UV islands.
    // Use the same explicit flat fallback as export on unknown custom UVs.
    if (isWheelTreadPreset(mode)) {
      if (!this.officialModel&&!this.atlasSource) return SMOOTH_WHEEL_NORMAL;
      source = getWheelTreadNormal(mode, this.native.get('Wheels_N.dds'), this.wheelSurface.volume === true);
      if(this.atlasSource)source=cachedAtlasPixels(source,'wheels',this.atlasSource);
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
      const material = file === 'Skin_N.dds' ? this.materials.skin : file === 'Details_N.dds' ? this.materials.details : this.materials.wheels;
      if (!material) continue;
      const raw = resolveNormalTexture(file, this.imported, this.native, this.officialModel||!!this.atlasSource);
      const source=raw&&this.atlasSource&&!this.imported.has(file)?cachedAtlasPixels(raw,file==='Details_N.dds'?'details':file==='Wheels_N.dds'?'wheels':'skin',this.atlasSource):raw;
      const image = file === 'Skin_N.dds' && !this.skinNormalEnabled ? null : this.materialImage(file, file === 'Wheels_N.dds' ? this.wheelImage(source) : source);
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
    this.materialComposites.clear(); this.materialOverlays = [];
    this.wheelTransform = null;
    this.materials.details.normalMap = null; this.materials.wheels.normalMap = null;
    if (this.materials.skin) this.materials.skin.normalMap = null;
  }
}
