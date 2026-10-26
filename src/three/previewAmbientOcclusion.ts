import * as THREE from 'three';
import { decodeDDS, type RGBAImage } from '../dds';
import type { Skin3DFile } from '../skin3d';
import { isWheelTreadPreset, normalizeWheelSurface, type WheelSurfaceSettings } from '../wheelSurface';
import { getWheelTreadOcclusion } from '../wheelTreads';
import { attenuateMaterialAO, composeMaterialSurface, type MaterialSurfaceOverlay } from '../materials/surfaceMaps';
import { cachedAtlasPixels } from '../realUvTextures';
import type { AtlasSourceLayout } from '../realUvAtlas';

export const AO_TEXTURE_FILES = ['Skin_AO.dds', 'Details_AO.dds', 'Wheels_AO.dds'] as const;
export type AmbientOcclusionFile = typeof AO_TEXTURE_FILES[number];
type AmbientOcclusionMaterials = { skin: THREE.MeshStandardMaterial; details: THREE.MeshStandardMaterial; wheels: THREE.MeshStandardMaterial };

const nativeUrls: Record<AmbientOcclusionFile, URL> = {
  'Skin_AO.dds': new URL('../assets/model/car/Skin_AO.dds', import.meta.url),
  'Details_AO.dds': new URL('../assets/model/car/Details_AO.dds', import.meta.url),
  'Wheels_AO.dds': new URL('../assets/model/car/Wheels_AO.dds', import.meta.url),
};

export function ambientOcclusionFile(name: string): AmbientOcclusionFile | null {
  const file = name.split(/[/\\]/).pop()?.toLowerCase();
  return AO_TEXTURE_FILES.find((candidate) => candidate.toLowerCase() === file) ?? null;
}

/** AO is scalar data. Reject normals, unsupported formats and excessive preview allocations. */
export function decodeAmbientOcclusion(buffer: ArrayBuffer): RGBAImage | null {
  if (buffer.byteLength < 128 || buffer.byteLength > 32 * 1024 * 1024) return null;
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== 0x20534444) return null;
  const width = header.getUint32(16, true), height = header.getUint32(12, true);
  if (!width || !height || width > 4096 || height > 4096) return null;
  if ((header.getUint32(80, true) & 4) === 0) return null;
  const fourcc = String.fromCharCode(...new Uint8Array(buffer, 84, 4));
  if (!['DXT1', 'DXT3', 'DXT5', 'ATI1', 'BC4U'].includes(fourcc)) return null;
  const image = decodeDDS(buffer);
  if (!image) return null;
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i + 1] = image.data[i + 2] = image.data[i];
    image.data[i + 3] = 255;
  }
  return image;
}

export function resolveAmbientOcclusion(
  file: AmbientOcclusionFile,
  imported: ReadonlyMap<AmbientOcclusionFile, RGBAImage>,
  native: ReadonlyMap<AmbientOcclusionFile, RGBAImage>,
  officialModel: boolean,
  importedWheelNormal = false,
): RGBAImage | null {
  if (imported.has(file)) return imported.get(file)!;
  // A new tyre normal can contain entirely different grooves from the native AO.
  if (file === 'Wheels_AO.dds' && importedWheelNormal) return null;
  return (officialModel ? native.get(file) : null) ?? null;
}

/**
 * Native prelight is already applied in Trackmania's car shader. Preview it as
 * linear ambient occlusion, never baking it into editable/exported base colours.
 * The native atlases are valid only for the official Stadium UV layout.
 */
export class PreviewAmbientOcclusion {
  private materialOverlays: readonly MaterialSurfaceOverlay[] = [];
  private materialComposites = new Map<AmbientOcclusionFile, { source: RGBAImage | null; overlays: readonly MaterialSurfaceOverlay[]; image: RGBAImage | null }>();
  private imported = new Map<AmbientOcclusionFile, RGBAImage>();
  private native = new Map<AmbientOcclusionFile, RGBAImage>();
  private textures = new Map<AmbientOcclusionFile, { image: RGBAImage; texture: THREE.DataTexture }>();
  private officialModel = true;
  private atlasSource?:AtlasSourceLayout;
  private importedWheelNormal = false;
  private wheelSurface = normalizeWheelSurface(undefined);
  private disposed = false;
  private readonly materials: AmbientOcclusionMaterials;
  private readonly anisotropy: number;

  constructor(materials: AmbientOcclusionMaterials, anisotropy: number) {
    this.materials = materials;
    this.anisotropy = Number.isFinite(anisotropy) ? Math.max(1, anisotropy) : 1;
  }

  async loadNativeTextures(load: (url: URL) => Promise<ArrayBuffer> = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }): Promise<void> {
    if (this.disposed) return;
    await Promise.all(AO_TEXTURE_FILES.map(async (file) => {
      try {
        const buffer = await load(nativeUrls[file]);
        if (this.disposed) return;
        const image = decodeAmbientOcclusion(buffer);
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
    const imported = new Map<AmbientOcclusionFile, RGBAImage>();
    this.importedWheelNormal = false;
    for (const entry of files) {
      if (entry.name.split(/[/\\]/).pop()?.toLowerCase() === 'wheels_n.dds') this.importedWheelNormal = true;
      const file = ambientOcclusionFile(entry.name);
      if (!file) continue;
      const image = decodeAmbientOcclusion(entry.data.slice().buffer);
      if (image) imported.set(file, image);
    }
    this.imported = imported;
    this.sync();
  }

  setOfficialModel(official: boolean) {
    this.officialModel = official;
    this.sync();
  }
  setAtlasSource(source?:AtlasSourceLayout){if(this.atlasSource===source)return;this.atlasSource=source;this.sync();}

  /** Each generated tread uses its own prelight; imported/native AO is reserved for source relief. */
  setWheelSurface(value: WheelSurfaceSettings) {
    const next = normalizeWheelSurface(value);
    if (next.mode === this.wheelSurface.mode && next.strength === this.wheelSurface.strength && next.volume === this.wheelSurface.volume) return;
    this.wheelSurface = next;
    this.sync();
  }

  private material(file: AmbientOcclusionFile): THREE.MeshStandardMaterial {
    return file === 'Skin_AO.dds' ? this.materials.skin : file === 'Details_AO.dds' ? this.materials.details : this.materials.wheels;
  }

  setMaterialOverlays(overlays: readonly MaterialSurfaceOverlay[]) {
    if (this.materialOverlays === overlays) return;
    this.materialOverlays = overlays; this.sync();
  }

  private materialImage(file: AmbientOcclusionFile, source: RGBAImage | null) {
    const cached = this.materialComposites.get(file);
    if (cached?.source === source && cached.overlays === this.materialOverlays) return cached.image;
    const family = file === 'Skin_AO.dds' ? 'skin' : file === 'Details_AO.dds' ? 'details' : 'wheels';
    const overlays = this.materialOverlays.filter(layer => layer.family === family && layer.ao).map(layer => layer.ao!);
    const image = composeMaterialSurface(source, overlays, false);
    this.materialComposites.set(file, { source, overlays: this.materialOverlays, image });
    return image;
  }

  private sync() {
    if (this.disposed) return;
    for (const file of AO_TEXTURE_FILES) {
      const material = this.material(file);
      const wheel = file === 'Wheels_AO.dds';
      const raw = wheel
        ? this.wheelSurface.mode === 'smooth' || this.wheelSurface.strength === 0
          ? null
          : isWheelTreadPreset(this.wheelSurface.mode)
            ? this.officialModel||this.atlasSource ? getWheelTreadOcclusion(this.wheelSurface.mode, this.wheelSurface.volume === true) : null
            : resolveAmbientOcclusion(file, this.imported, this.native, this.officialModel||!!this.atlasSource, this.importedWheelNormal)
        : resolveAmbientOcclusion(file, this.imported, this.native, this.officialModel||!!this.atlasSource, this.importedWheelNormal);
      const source=raw&&this.atlasSource&&(wheel&&isWheelTreadPreset(this.wheelSurface.mode)||!this.imported.has(file))?cachedAtlasPixels(raw,file==='Skin_AO.dds'?'skin':file==='Details_AO.dds'?'details':'wheels',this.atlasSource,false):raw;
      const hasMaterialAO = this.materialOverlays.some(layer => layer.family === (file === 'Skin_AO.dds' ? 'skin' : file === 'Details_AO.dds' ? 'details' : 'wheels') && layer.ao);
      const image = this.materialImage(file, wheel && hasMaterialAO ? attenuateMaterialAO(source, this.wheelSurface.strength) : source);
      const previous = this.textures.get(file);
      if (image && previous?.image === image) {
        if (material.aoMap === previous.texture) material.aoMapIntensity = wheel && !hasMaterialAO ? this.wheelSurface.strength : 1;
        continue;
      }
      if (previous) {
        if (material.aoMap === previous.texture) material.aoMap = null;
        previous.texture.dispose();
        this.textures.delete(file);
      }
      if (image) {
        const texture = new THREE.DataTexture(image.data, image.width, image.height);
        texture.name = file;
        texture.colorSpace = THREE.NoColorSpace;
        texture.channel = 0; // Same UV0 as _B/_R, rather than Three's optional lightmap UV.
        texture.flipY = true;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.anisotropy;
        texture.needsUpdate = true;
        this.textures.set(file, { image, texture });
        material.aoMap = texture;
        material.aoMapIntensity = wheel && !hasMaterialAO ? this.wheelSurface.strength : 1;
      }
      material.needsUpdate = true;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.materialComposites.clear(); this.materialOverlays = [];
    for (const [file, { texture }] of this.textures) {
      const material = this.material(file);
      if (material.aoMap === texture) {
        material.aoMap = null;
        material.needsUpdate = true;
      }
      texture.dispose();
    }
    this.textures.clear(); this.native.clear(); this.imported.clear();
  }
}
