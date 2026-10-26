import { isValidMaterialLayer, type MaterialLayer } from '../materials/types';
import type { ReliefFamily, ReliefMode, ReliefScope, ReliefTextureResolution, ReliefPrototypeResult } from './types';

export interface ReliefSettings {
  appearanceScope?:ReliefFamily;
  family?:ReliefFamily;
  strengthByFamily?:Partial<Record<ReliefFamily,number>>;
  modeByFamily?:Partial<Record<ReliefFamily,ReliefMode>>;
  version: 1;
  source: 'material' | 'demo' | 'diagnostic';
  material: MaterialLayer | null;
  sourceName: string;
  mode: ReliefMode;
  scope: ReliefScope;
  textureResolution: ReliefTextureResolution;
  strengthMm: number;
  diagnostic: boolean;
  appliedLayers?: Partial<Record<'Skin_B' | 'Details_B' | 'Wheels_B', string>>;
  stats?: ReliefPrototypeResult['stats'];
  heightSourceBits?: 8 | 16;
}
export function validReliefSettings(value: unknown, sourceValidator?: (src: string) => boolean): value is ReliefSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as ReliefSettings;
  if (Object.keys(v).some(key => !['version','source','material','sourceName','mode','scope','textureResolution','strengthMm','diagnostic','appliedLayers','stats','heightSourceBits','appearanceScope','family','strengthByFamily','modeByFamily'].includes(key))) return false;
  for(const key of ['strengthByFamily','modeByFamily'] as const){const values=v[key];if(values!==undefined&&(!values||typeof values!=='object'||Array.isArray(values)||Object.entries(values).some(([family,value])=>!['skin','details','wheels'].includes(family)||(key==='strengthByFamily'?!Number.isFinite(value)||Number(value)<0||Number(value)>80:!['normal','geometry','combined'].includes(String(value))))))return false;}
  if(v.appearanceScope!==undefined&&!['skin','details','wheels'].includes(v.appearanceScope))return false;
  if(v.appearanceScope!==undefined&&v.appearanceScope!==(v.family??v.material?.family??'skin'))return false;
  if(v.family!==undefined&&(!['skin','details','wheels'].includes(v.family)||v.material&&v.material.family!==v.family||v.family!=='skin'&&v.scope==='hood'))return false;
  if (v.heightSourceBits !== undefined && ![8,16].includes(v.heightSourceBits)) return false;
  if (v.stats !== undefined && (!v.stats || typeof v.stats !== 'object' || Array.isArray(v.stats)
    || Object.keys(v.stats).some(key=>!['affectedVertices','hoodVertices','eligibleVertices','triangleCount','maxDisplacementMm','templateVariant'].includes(key))
    || !['standard','normal'].includes(v.stats.templateVariant)
    || !Number.isFinite(v.stats.maxDisplacementMm) || v.stats.maxDisplacementMm < 0 || v.stats.maxDisplacementMm > 80.001
    || !['affectedVertices','hoodVertices','eligibleVertices','triangleCount'].every(key => {
      const n = v.stats![key as 'affectedVertices']; return Number.isSafeInteger(n) && n >= 0 && n <= (key === 'triangleCount' ? 2_000_000 : 600_000);
    }))) return false;
  return v.version === 1 && ['material','demo','diagnostic'].includes(v.source)
    && typeof v.sourceName === 'string' && v.sourceName.length > 0 && v.sourceName.length <= 160 && ![...v.sourceName].some(c=>c.charCodeAt(0)<32)
    && ['geometry','normal','combined'].includes(v.mode) && ['hood','vehicle'].includes(v.scope)
    && [1024,2048,4096].includes(v.textureResolution) && typeof v.diagnostic === 'boolean'
    && Number.isFinite(v.strengthMm) && v.strengthMm >= 0 && v.strengthMm <= (v.diagnostic ? 80 : 30)
    && (v.source === 'material' ? isValidMaterialLayer(v.material, sourceValidator) : v.material === null)
    && (v.appliedLayers === undefined || !!v.appliedLayers && typeof v.appliedLayers === 'object' && !Array.isArray(v.appliedLayers)
      && Object.entries(v.appliedLayers).every(([key,id]) => ['Skin_B','Details_B','Wheels_B'].includes(key) && typeof id === 'string' && id.length > 0 && id.length <= 128));
}

/** Embed immutable original PNGs so a saved relief stays adjustable offline. */
export async function captureReliefSettings(settings: ReliefSettings, assets: Map<string, Blob | Uint8Array>): Promise<ReliefSettings> {
  if (!validReliefSettings(settings)) throw new Error('Réglages du relief invalides.');
  const copy = structuredClone(settings), aliases = new Map<string,string>();
  let index = Math.max(-1, ...[...assets.keys()].map(path => Number(/^assets\/image-(\d+)\.png$/.exec(path)?.[1] ?? -1))) + 1;
  for (const texture of Object.values(copy.material?.definition.textures ?? {})) {
    if (!texture) continue;
    const known = aliases.get(texture.src); if (known) { texture.src = known; continue; }
    const response = await fetch(texture.src, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('La texture originale du relief est indisponible.');
    const blob = await response.blob(); if (blob.size > 64 * 1024 * 1024) throw new Error('La texture du relief est trop grande.');
    const path = `assets/image-${index++}.png`; aliases.set(texture.src,path); assets.set(path,blob); texture.src = path;
  }
  return copy;
}
