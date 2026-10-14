/** Stable scene coordinates; output pixels can change without resampling source layers. */
export const TEXTURE_RESOLUTION = 2048;
export const LEGACY_TEXTURE_RESOLUTION = 1024;
export const TEXTURE_RESOLUTIONS = [1024, 2048, 4096] as const;
export type TextureResolution = typeof TEXTURE_RESOLUTIONS[number];
export const MAX_TEXTURE_RESOLUTION = 4096;
export function isTextureResolution(value: unknown): value is TextureResolution {
  return typeof value === 'number' && TEXTURE_RESOLUTIONS.some((size) => size === value);
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Rescale the scene, retaining native image pixels, local group geometry and 3D units. */
export function upgradeMapResolution(map: Record<string, unknown>): Record<string, unknown> {
  const source = map.workRes ?? LEGACY_TEXTURE_RESOLUTION;
  if (source !== LEGACY_TEXTURE_RESOLUTION && source !== TEXTURE_RESOLUTION) throw new Error('Résolution de texture non prise en charge.');
  if (source === TEXTURE_RESOLUTION) return map;
  const result = structuredClone(map);
  const ratio = TEXTURE_RESOLUTION / source;
  const scaleObject = (object: Record<string, unknown>, sceneRoot: boolean) => {
    if (sceneRoot) {
      for (const key of ['left', 'top']) object[key] = (typeof object[key] === 'number' ? object[key] : 0) * ratio;
      for (const key of ['scaleX', 'scaleY']) object[key] = (typeof object[key] === 'number' ? object[key] : 1) * ratio;
    }
    // These styles deliberately ignore the object's (and parent's) scale in Fabric.
    if (object.strokeUniform === true && typeof object.strokeWidth === 'number') object.strokeWidth *= ratio;
    if (record(object.shadow) && object.shadow.nonScaling === true) {
      for (const key of ['blur', 'offsetX', 'offsetY']) if (typeof object.shadow[key] === 'number') object.shadow[key] *= ratio;
    }
    if (Array.isArray(object.objects)) for (const child of object.objects) if (record(child)) scaleObject(child, false);
    // An absolute clip lives in atlas coordinates; a relative clip inherits its owner.
    if (record(object.clipPath)) scaleObject(object.clipPath, object.clipPath.absolutePositioned === true);
  };
  if (Array.isArray(result.objects)) for (const object of result.objects) if (record(object)) scaleObject(object, true);
  for (const key of ['backgroundImage', 'overlayImage', 'clipPath']) if (record(result[key])) scaleObject(result[key], true);
  result.workRes = TEXTURE_RESOLUTION;
  return result;
}

/** Old HMR checkpoints include the current scene and every undo/redo scene. */
export function upgradeResolutionSnapshot(snapshot: string): string {
  const map = JSON.parse(snapshot) as Record<string, unknown>;
  const upgraded = upgradeMapResolution(map);
  return upgraded === map ? snapshot : JSON.stringify(upgraded);
}
