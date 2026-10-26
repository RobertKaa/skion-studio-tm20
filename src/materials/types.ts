import { isValidWheelDesign, type WheelDesignSettings } from '../wheelDesign';

export type MaterialPreset = 'solid' | 'carbon' | 'brushed' | 'rubber' | 'fabric' | 'scratched';
export type MaterialChannel = 'color' | 'roughness' | 'metalness' | 'roughmetal' | 'coat' | 'emission' | 'dirt' | 'normal' | 'ao' | 'height';
export type MaterialTextureChannel = MaterialChannel;
export type MaterialRenderChannel = 'color' | 'roughmetal' | 'coat' | 'emission' | 'dirt' | 'normal' | 'ao' | 'height';
export type MaterialProjection = 'uv' | 'top' | 'side' | 'front' | 'triplanar' | 'surface' | 'wheel' | 'wheel-face';

export interface MaterialTexture {
  src: string;
  name: string;
  component: 'r' | 'g' | 'b' | 'luminance';
  invert: boolean;
}

/** Texture bytes. Placement uses 2048 reference pixels in the UV sheet, or along
 * the longest vehicle dimension for projections and surface coordinates. */
export interface MaterialDefinition {
  /** Editable construction settings for a generated tyre-sidewall motif. */
  wheelDesign?: WheelDesignSettings;
  surfaceOnly?:boolean;
  surfaceRelief?: import('./relief').SurfaceReliefSettings;
  version: 1;
  name: string;
  preset: MaterialPreset;
  color: string;
  roughness: number;
  metalness: number;
  coat: number;
  dirt: number;
  emissionColor: string;
  emissionStrength: number;
  emissionRole: 'always' | 'head' | 'brake';
  normalStrength: number;
  aoStrength: number;
  opacity: number;
  transform: {
    mode: 'repeat' | 'cover' | 'contain' | 'stretch';
    size: number;
    angle: number;
    offsetX: number;
    offsetY: number;
    flipX: boolean;
    flipY: boolean;
    /** Omitted in existing projects: preserve their original UV placement. */
    projection?: MaterialProjection;
  };
  textures: Partial<Record<MaterialChannel, MaterialTexture>>;
}

export interface MaterialRegion {
  key: string;
  label: string;
  polygons: { x: number; y: number }[][];
  fillRule?: 'evenodd';
}

export interface MaterialLayer {
  /** Original placement of a material migrated into the real reorganized atlas. */
  nativeAtlas?: 'stock' | 'independent-v1' | 'underbody-panel-v1';
  /** Keep materials authored after repacking editable when returning to native UVs. */
  organizedAtlas?: 'stock' | 'independent-v1' | 'underbody-panel-v1';
  definition: MaterialDefinition;
  family: 'skin' | 'details' | 'wheels';
  regions: MaterialRegion[];
  exclusions: MaterialRegion[];
  /** A migrated native UV material retains its original placement on one side. */
  atlasSide?: 'left' | 'right';
  atlasFrame?: { placement: 'base' | 'right'; reference: { x:number; y:number; w:number; h:number } };
}

export const MATERIAL_CHANNELS: readonly MaterialChannel[] = ['color', 'roughness', 'metalness', 'roughmetal', 'coat', 'emission', 'dirt', 'normal', 'ao', 'height'];
export const MATERIAL_PRESET_IDS: readonly MaterialPreset[] = ['solid', 'carbon', 'brushed', 'rubber', 'fabric', 'scratched'];
const presets: Record<MaterialPreset, { name: string; color: string; roughness: number; metalness: number; coat: number }> = {
  solid: { name: 'Peinture satinée', color: '#d74735', roughness: 110, metalness: 0, coat: 160 },
  carbon: { name: 'Carbone', color: '#343b42', roughness: 105, metalness: 35, coat: 210 },
  brushed: { name: 'Métal brossé', color: '#b6bec9', roughness: 120, metalness: 235, coat: 35 },
  rubber: { name: 'Caoutchouc', color: '#262a2d', roughness: 235, metalness: 0, coat: 0 },
  fabric: { name: 'Tissu', color: '#668999', roughness: 225, metalness: 0, coat: 0 },
  scratched: { name: 'Peinture usée', color: '#577773', roughness: 160, metalness: 20, coat: 70 },
};

export function createMaterialDefinition(preset: MaterialPreset = 'solid'): MaterialDefinition {
  const selected = presets[preset] ?? presets.solid;
  return {
    version: 1, preset, ...selected, dirt: 0, emissionColor: '#ffffff', emissionStrength: 0,
    emissionRole: 'always', normalStrength: 1, aoStrength: 1, opacity: 1,
    transform: { mode: 'repeat', size: preset === 'carbon' || preset === 'fabric' ? 768 : 256, angle: 0, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
    textures: {},
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
const bounded = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !Array.from(value).some(character => character.charCodeAt(0) < 32);
const color = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const sourceValidationCache = new Map<string, boolean>();
let validationCharacters = 0;

/** Reject network URLs and oversized PNGs before the browser decodes them. */
export function isLocalMaterialSource(source: string): boolean {
  if (typeof source !== 'string') return false;
  const cached = sourceValidationCache.get(source);
  if (cached !== undefined) return cached;
  const result = validateSource(source);
  if (source.length <= 32 * 1024 * 1024) {
    while (sourceValidationCache.size && (sourceValidationCache.size >= 32 || validationCharacters + source.length > 32 * 1024 * 1024)) {
      const oldest = sourceValidationCache.keys().next().value!;
      validationCharacters -= oldest.length; sourceValidationCache.delete(oldest);
    }
    sourceValidationCache.set(source, result); validationCharacters += source.length;
  }
  return result;
}

function validateSource(source: string): boolean {
  if (/^blob:(?:https?:\/\/[^\s/]+|null)\/[0-9a-f-]{36}$/i.test(source)) return true;
  if (source.length > 96 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) return false;
  const payload = source.slice(22);
  if (payload.length % 4 !== 0 || payload.length < 44) return false;
  try {
    const header = atob(payload.slice(0, 44));
    if (header.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || header.slice(12, 16) !== 'IHDR') return false;
    const bytes = Uint8Array.from(header, value => value.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const width = view.getUint32(16), height = view.getUint32(20);
    return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16 * 1024 * 1024;
  } catch { return false; }
}

export function isValidMaterialDefinition(value: unknown, sourceValidator: (src: string) => boolean = isLocalMaterialSource): value is MaterialDefinition {
  if (!record(value) || !exactKeys(value, ['version', 'name', 'preset', 'color', 'roughness', 'metalness', 'coat', 'dirt', 'emissionColor', 'emissionStrength', 'emissionRole', 'normalStrength', 'aoStrength', 'opacity', 'transform', 'textures','surfaceRelief','surfaceOnly','wheelDesign'])) return false;
  if (value.wheelDesign !== undefined && (!isValidWheelDesign(value.wheelDesign) || !record(value.transform) || value.transform.projection !== 'wheel-face')) return false;
  if(value.surfaceOnly!==undefined&&typeof value.surfaceOnly!=='boolean')return false;
  const relief=value.surfaceRelief;
  if(relief!==undefined&&(!record(relief)||!exactKeys(relief,['source','heightStrength','midpoint','contrast','heightOrigin'])||!['auto','normal','height','combined','none'].includes(String(relief.source))||!bounded(relief.heightStrength,0,4)||!bounded(relief.midpoint,0,1)||!bounded(relief.contrast,.1,4)||(relief.heightOrigin!==undefined&&relief.heightOrigin!=='normal-estimate')))return false;
  if (value.version !== 1 || !text(value.name) || !MATERIAL_PRESET_IDS.includes(value.preset as MaterialPreset) || !color(value.color) || !color(value.emissionColor)) return false;
  if (!['roughness', 'metalness', 'coat', 'dirt'].every(key => bounded(value[key], 0, 255))
    || !bounded(value.emissionStrength, 0, 1) || !bounded(value.opacity, 0, 1) || !bounded(value.normalStrength, 0, 2) || !bounded(value.aoStrength, 0, 1)
    || !['always', 'head', 'brake'].includes(value.emissionRole as string)) return false;
  const transform = value.transform;
  if (!record(transform) || !exactKeys(transform, ['mode', 'size', 'angle', 'offsetX', 'offsetY', 'flipX', 'flipY', 'projection'])
    || (transform.projection !== undefined && !['uv', 'top', 'side', 'front', 'triplanar', 'surface', 'wheel', 'wheel-face'].includes(transform.projection as string))
    || !['repeat', 'cover', 'contain', 'stretch'].includes(transform.mode as string) || !bounded(transform.size, 8, 2048)
    || !bounded(transform.angle, -360, 360) || !bounded(transform.offsetX, -16384, 16384) || !bounded(transform.offsetY, -16384, 16384)
    || typeof transform.flipX !== 'boolean' || typeof transform.flipY !== 'boolean') return false;
  if (!record(value.textures) || !exactKeys(value.textures, MATERIAL_CHANNELS)) return false;
  for (const texture of Object.values(value.textures)) {
    if (!record(texture) || !exactKeys(texture, ['src', 'name', 'component', 'invert']) || !text(texture.name)
      || typeof texture.src !== 'string' || !sourceValidator(texture.src)
      || !['r', 'g', 'b', 'luminance'].includes(texture.component as string) || typeof texture.invert !== 'boolean') return false;
  }
  return true;
}

function validRegions(value: unknown): value is MaterialRegion[] {
  if (!Array.isArray(value) || value.length > 512) return false;
  let points = 0;
  for (const region of value) {
    if (!record(region) || !exactKeys(region, ['key', 'label', 'polygons', 'fillRule']) || !text(region.key, 256) || !text(region.label, 256)
      || (region.fillRule !== undefined && region.fillRule !== 'evenodd') || !Array.isArray(region.polygons) || !region.polygons.length || region.polygons.length > 8192) return false;
    for (const polygon of region.polygons) {
      if (!Array.isArray(polygon) || polygon.length < 3 || (points += polygon.length) > 100000) return false;
      for (const point of polygon) if (!record(point) || !exactKeys(point, ['x', 'y']) || !bounded(point.x, -2, 3) || !bounded(point.y, -2, 3)) return false;
    }
  }
  return true;
}

export function isValidMaterialLayer(value: unknown, sourceValidator?: (src: string) => boolean): value is MaterialLayer {
  const frame=record(value)&&value.atlasFrame;
  const reference=record(frame)&&record(frame.reference)?frame.reference:null;
  const validFrame=frame===undefined||(record(frame)&&exactKeys(frame,['placement','reference'])&&['base','right'].includes(String(frame.placement))
    &&!!reference&&exactKeys(reference,['x','y','w','h'])&&['x','y'].every(key=>bounded(reference[key],-2,3))
    &&['w','h'].every(key=>bounded(reference[key],.000001,5)));
  return record(value) && exactKeys(value, ['definition', 'family', 'regions', 'exclusions', 'atlasSide','atlasFrame','nativeAtlas','organizedAtlas'])
    && (value.nativeAtlas===undefined||['stock','independent-v1','underbody-panel-v1'].includes(String(value.nativeAtlas)))
    && (value.organizedAtlas===undefined||value.nativeAtlas===undefined&&['stock','independent-v1','underbody-panel-v1'].includes(String(value.organizedAtlas)))
    &&validFrame&&(value.atlasFrame===undefined||(value.family==='details'&&value.atlasSide===undefined))
    && (value.atlasSide === undefined || (value.family === 'details' && ['left','right'].includes(value.atlasSide as string)))
    && ['skin', 'details', 'wheels'].includes(value.family as string) && isValidMaterialDefinition(value.definition, sourceValidator)
    && (value.family==='wheels'||!['wheel','wheel-face'].includes(String((value.definition as MaterialDefinition).transform.projection)))
    && validRegions(value.regions) && validRegions(value.exclusions);
}
export const validMaterialLayer = isValidMaterialLayer;
