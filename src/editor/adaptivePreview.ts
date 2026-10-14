import type { MapId } from '../maps';
import { TEXTURE_RESOLUTION } from './resolution';

export const EDITING_PREVIEW_RESOLUTION = 512;
export const PREVIEW_SETTLE_MS = 350;

type Schedule = (callback: () => void, delay: number) => () => void;

/** Preview quality is transient; it never changes a layer, source image or export. */
export class AdaptivePreview {
  private enabled = true;
  private reduced = new Set<MapId>();
  private cancelPending?: () => void;
  private restore: (maps: ReadonlySet<MapId>) => void;
  private schedule: Schedule;

  constructor(
    restore: (maps: ReadonlySet<MapId>) => void,
    schedule: Schedule = (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
  ) {
    this.restore = restore;
    this.schedule = schedule;
  }

  edited(id: MapId) {
    if (!this.enabled) return;
    this.reduced.add(id);
    this.cancelPending?.();
    this.cancelPending = this.schedule(() => this.settle(), PREVIEW_SETTLE_MS);
  }

  resolution(id: MapId, fullResolution: number = TEXTURE_RESOLUTION) {
    return this.reduced.has(id) ? Math.min(EDITING_PREVIEW_RESOLUTION, fullResolution) : fullResolution;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.settle();
  }

  private settle() {
    this.cancelPending?.();
    this.cancelPending = undefined;
    if (!this.reduced.size) return;
    const maps = this.reduced;
    this.reduced = new Set();
    this.restore(maps);
  }

  dispose() {
    this.cancelPending?.();
    this.cancelPending = undefined;
    this.reduced.clear();
  }
}
