import { useEffect, useRef } from 'react';
import type { RGBAImage } from '../dds';
import type { Skin3DFile } from '../skin3d';
import { resolveWheelNormalImage, isWheelTreadPreset, type WheelSurfaceSettings } from '../wheelSurface';
import { cachedAtlasPixels } from '../realUvTextures';
import type { AtlasSourceLayout } from '../realUvAtlas';
import { createWheelReliefOverlay } from './wheelReliefShading';
import './wheelReliefOverlay.css';

/** Mounted inside canvas-overlays: its parent already applies the editor viewport. */
export function WheelReliefOverlay({ visible, value, files, officialModel, technicalChannel, atlasSource }: {
  visible: boolean;
  value: WheelSurfaceSettings;
  files: readonly Skin3DFile[];
  officialModel: boolean;
  technicalChannel: boolean;
  atlasSource?:AtlasSourceLayout;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // At most one shaded atlas is retained, not a cache entry for every slider step.
  const cached = useRef<{ normal: RGBAImage; image: RGBAImage } | null>(null);
  const displayedSource = useRef<{ mode: WheelSurfaceSettings['mode']; files: readonly Skin3DFile[]; officialModel: boolean } | null>(null);
  const { mode, strength } = value;
  const enabled = visible && mode !== 'smooth' && strength > 0;

  useEffect(() => {
    if (!enabled || !canvas.current) return;
    let current = true;
    const target = canvas.current;
    const previous = displayedSource.current;
    if (!previous || previous.mode !== mode || previous.files !== files || previous.officialModel !== officialModel) {
      // A new model/import may have unrelated UVs: never leave its old guide up.
      target.width = target.height = 1;
    }
    // Coalesce slider events and give the controls a paint before the source
    // resolves. Keep the previous guide during calculation instead of blinking.
    const timer = setTimeout(() => {
      void resolveWheelNormalImage({ mode, strength }, files, officialModel||!!atlasSource).then((native) => {
        if (!current) return;
        const normal=atlasSource&&isWheelTreadPreset(mode)?cachedAtlasPixels(native,'wheels',atlasSource):native;
        const image = cached.current?.normal === normal
          ? cached.current.image : createWheelReliefOverlay(normal);
        cached.current = { normal, image };
        const ctx = target.getContext('2d');
        if (!ctx) return;
        target.width = image.width; target.height = image.height;
        const pixels = ctx.createImageData(image.width, image.height);
        pixels.data.set(image.data);
        ctx.putImageData(pixels, 0, 0);
        displayedSource.current = { mode, files, officialModel };
      }).catch((error: unknown) => {
        if (current) {
          target.width = target.height = 1;
          console.warn('[WheelReliefOverlay] Repère de relief indisponible.', error);
        }
      });
    }, 80);
    return () => { current = false; clearTimeout(timer); };
  }, [enabled, mode, strength, files, officialModel,atlasSource]);

  if (!enabled) return null;
  return <canvas ref={canvas} width={1} height={1} aria-hidden="true"
    className={`wheel-relief-overlay${technicalChannel ? ' wheel-relief-overlay--technical' : ''}`} />;
}
