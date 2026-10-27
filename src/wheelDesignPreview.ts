import type { MapId } from './maps';
import type { MaterialLayer } from './materials/types';
import type { Skin3DFile } from './skin3d';
import type { AtlasSourceLayout } from './realUvAtlas';
import type { DetailsLayout } from './detailsSides';
import type { VehiclePose } from './three/vehiclePose';
import type { WheelSurfaceSettings } from './wheelSurface';
import type { MaterialSurfaceOverlay } from './materials/surfaceMaps';

export interface WheelDesignPreviewMap {
  below: HTMLCanvasElement;
  above: HTMLCanvasElement;
  roles?: HTMLCanvasElement;
}

/** Detached paint snapshots bracket the edited owner at its actual stacking order. */
export interface WheelDesignPreviewContext {
  maps: ReadonlyMap<MapId, WheelDesignPreviewMap>;
  modelPreview: ArrayBuffer | null;
  nativeSurfaceLayout: boolean;
  detailsLayout?: DetailsLayout;
  atlasSource?: AtlasSourceLayout;
  surfaceFiles: readonly Skin3DFile[];
  surfaceOverlays?: readonly MaterialSurfaceOverlay[];
  /** Insertion point of the edited owner among the other material surface overlays. */
  surfaceOverlayInsertIndex?: number;
  wheelSurface: WheelSurfaceSettings;
  pose: VehiclePose;
  layer?: MaterialLayer;
  ownerOpacity: number;
  ownerVisible: boolean;
  initialTarget: 'outer' | 'inner' | 'both';
}
