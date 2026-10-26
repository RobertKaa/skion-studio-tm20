import type { RGBAImage } from './dds';
import type { MapId } from './maps';
import type { WheelSurfaceSettings } from './wheelSurface';
import type { AtlasSourceLayout } from './realUvAtlas';

/** Tread selection controls relief only. Painted colour and finish are authoritative. */
export function hasWheelTreadAppearance(_id: MapId, _value: WheelSurfaceSettings | undefined, _officialModel = true): boolean {
  return false;
}

/** Native and reorganized wheels keep cavity maps separate from painted colour and finish. */
export function wheelTreadAppearanceCavity(_value: WheelSurfaceSettings | undefined, _officialModel = true, _atlasSource?: AtlasSourceLayout): RGBAImage | undefined {
  return undefined;
}

/**
 * Retain the public adapter for callers that prepare preview/export surfaces.
 * Cavity lighting belongs to geometry and relief maps, never to baked paint.
 * Returning the exact source also prevents resampling or alpha rounding.
 */
export function applyWheelTreadAppearance(image: RGBAImage, _channel: 'color' | 'roughmetal', _value: WheelSurfaceSettings | undefined,
  _officialModel = true, _cavitySource?: RGBAImage): RGBAImage {
  return image;
}

/** Selecting a tread must not resize, repaint, or replace an editable canvas. */
export function wheelTreadAppearanceCanvas(source: HTMLCanvasElement, _target: HTMLCanvasElement, _channel: 'color' | 'roughmetal',
  _value: WheelSurfaceSettings | undefined, _officialModel = true, _cavity?: RGBAImage, _minimumSize?: number): HTMLCanvasElement {
  return source;
}
