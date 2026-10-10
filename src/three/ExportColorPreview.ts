import * as THREE from 'three';
import type { ExportMaterialImage, ExportColorMapId } from '../exportColorPreview';
export type { ExportColorImage, ExportMaterialImage } from '../exportColorPreview';

type TextureSlot = 'map' | 'roughnessMap' | 'metalnessMap' | 'clearcoatMap';
type PreviewMaterial = THREE.MeshStandardMaterial & { clearcoatMap?: THREE.Texture | null };

/** A reversible material override; editor canvases and export sources stay untouched. */
export class ExportColorPreview {
  private overrides: { material: PreviewMaterial; slot: TextureSlot; original: THREE.Texture | null; texture: THREE.DataTexture }[] = [];
  private materials: Record<ExportColorMapId, THREE.MeshStandardMaterial>;
  private anisotropy: number;
  constructor(materials: Record<ExportColorMapId, THREE.MeshStandardMaterial>, anisotropy: number) {
    this.materials = materials; this.anisotropy = anisotropy;
  }
  set(images: readonly ExportMaterialImage[]) {
    this.clear();
    // Last entry wins, avoiding an override whose original is another temporary texture.
    const unique = new Map(images.map((image) => [image.id, image]));
    for (const { id, levels } of unique.values()) {
      const materialId = id === 'Skin_CoatR' ? 'Skin_B' : id.replace(/_R$/, '_B') as ExportColorMapId;
      const material: PreviewMaterial = this.materials[materialId], image = levels[0];
      if (!material || !image) continue;
      const color = id.endsWith('_B');
      const roughmetal = id.endsWith('_R');
      if (id === 'Skin_CoatR' && !('clearcoatMap' in material)) continue;
      // Three samples roughness in G and metalness in B. Keep the decoded DDS
      // immutable, and repack only this GPU override, at every encoded mip level.
      const gpuLevels = roughmetal ? levels.map((level) => {
        const data = new Uint8ClampedArray(level.data.length);
        for (let i = 0; i < data.length; i += 4) data.set([255, level.data[i], level.data[i + 1], 255], i);
        return { width: level.width, height: level.height, data };
      }) : levels;
      const texture = new THREE.DataTexture(gpuLevels[0].data, image.width, image.height);
      texture.mipmaps = gpuLevels;
      texture.generateMipmaps = false;
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.flipY = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = this.anisotropy;
      texture.needsUpdate = true;
      const slots: TextureSlot[] = color ? ['map'] : roughmetal ? ['roughnessMap', 'metalnessMap'] : ['clearcoatMap'];
      for (const slot of slots) {
        this.overrides.push({ material, slot, original: material[slot] ?? null, texture });
        material[slot] = texture;
      }
      material.needsUpdate = true;
    }
  }
  clear() {
    const textures = new Set<THREE.Texture>();
    for (const { material, slot, original, texture } of this.overrides) {
      if (material[slot] === texture) { material[slot] = original; material.needsUpdate = true; }
      textures.add(texture);
    }
    for (const texture of textures) texture.dispose();
    this.overrides = [];
  }
  dispose() { this.clear(); }
}
