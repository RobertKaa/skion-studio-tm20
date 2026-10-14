import { encodeDDS } from '../dds';
import { decodeNormalVectors } from '../wheelSurface';
import { decodeAmbientOcclusion } from '../three/previewAmbientOcclusion';
import type { Skin3DFile } from '../skin3d';
import { attenuateMaterialAO, composeMaterialSurface, type MaterialSurfaceOverlay } from './surfaceMaps';
import type { WheelSurfaceSettings } from '../wheelSurface';

const nativeUrls: Record<string, URL> = {
  'Details_N.dds': new URL('../assets/model/car/Details_N.dds', import.meta.url),
  'Wheels_N.dds': new URL('../assets/model/car/Wheels_N.dds', import.meta.url),
  'Skin_AO.dds': new URL('../assets/model/car/Skin_AO.dds', import.meta.url),
  'Details_AO.dds': new URL('../assets/model/car/Details_AO.dds', import.meta.url),
  'Wheels_AO.dds': new URL('../assets/model/car/Wheels_AO.dds', import.meta.url),
};
const nativeBuffers = new Map<string, Promise<ArrayBuffer>>();

/** Called after tyre profiles have been prepared, so material masks preserve their base. */
export async function exportMaterialSurfaces(files: readonly Skin3DFile[], layers: readonly MaterialSurfaceOverlay[], size: number, officialModel: boolean, wheelSurface?: WheelSurfaceSettings, importedWheelNormal = false): Promise<Skin3DFile[]> {
  const result = new Map(files.map(file => [file.name.toLowerCase(), file]));
  for (const family of ['skin', 'details', 'wheels'] as const) for (const channel of ['normal', 'ao'] as const) {
    if (family === 'skin' && channel === 'normal') continue;
    const overlays = layers.filter(layer => layer.family === family && layer[channel]).map(layer => layer[channel]!);
    if (!overlays.length) continue;
    const prefix = family === 'skin' ? 'Skin' : family === 'details' ? 'Details' : 'Wheels';
    const name = `${prefix}_${channel === 'normal' ? 'N' : 'AO'}.dds`;
    const existing = result.get(name.toLowerCase());
    let buffer: ArrayBuffer | undefined = existing?.data.slice().buffer;
    const suppressNativeAO = family === 'wheels' && channel === 'ao' && importedWheelNormal;
    if (!buffer && officialModel && !suppressNativeAO) {
      let pending = nativeBuffers.get(name);
      if (!pending) {
        pending = fetch(nativeUrls[name], { signal: AbortSignal.timeout(15_000) }).then(response => { if (!response.ok) throw new Error(`Texture d’origine indisponible : ${name}`); return response.arrayBuffer(); });
        nativeBuffers.set(name, pending); pending.catch(() => nativeBuffers.delete(name));
      }
      buffer = await pending;
    }
    const base = buffer ? channel === 'normal' ? decodeNormalVectors(buffer) : decodeAmbientOcclusion(buffer) : null;
    if (buffer && !base) throw new Error(`Texture de surface illisible : ${name}`);
    const adjusted = family === 'wheels' && channel === 'ao' && wheelSurface?.mode === 'relief' ? attenuateMaterialAO(base, wheelSurface.strength) : base;
    const composed = composeMaterialSurface(adjusted, overlays, channel === 'normal', size)!;
    result.set(name.toLowerCase(), { name, data: new Uint8Array(encodeDDS(composed, channel === 'normal' ? 'BC5' : 'BC4', { colorSpace: 'linear' })) });
  }
  return [...result.values()];
}
