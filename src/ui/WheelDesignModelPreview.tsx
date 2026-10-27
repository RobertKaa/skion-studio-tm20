import { useEffect, useRef, useState } from 'react';
import { createMaterialRenderSession } from '../materials/render';
import type { MaterialDefinition, MaterialLayer, MaterialRenderChannel } from '../materials/types';
import type { MapId } from '../maps';
import type { WheelDesignPreviewContext } from '../wheelDesignPreview';
import { createWheelArtworkDefinition, mergeWheelArtworkDefinition, normalizeWheelComposition, type WheelDesignArtwork, type WheelDesignComposition } from '../wheelDesignComposition';
import { createWheelVisibleArea } from '../wheelDesignArea';
import { hasWheelFaceAlignmentConflict } from '../materials/wheelCoordinates';
import type { WheelDesignCoverage } from './WheelDesignDialog';
import { WHEEL_PART_GUIDES } from '../wheelParts';
import { CarPreview } from '../three/CarPreview';
import { Icon } from './Icon';
import './wheelDesignModelPreview.css';

type Target = 'outer' | 'inner' | 'both';
type ModelPreview = Pick<CarPreview, 'onModelReady' | 'loadCustomPreview' | 'setMapCanvas' | 'setSurfaceTextures'
  | 'setWheelSurface' | 'setVehiclePose' | 'getProjectionTriangles' | 'getViewState' | 'focusWheelForDesign' | 'setMaterialSurfaceOverlays' | 'setBraking' | 'dispose'>;
export interface WheelDesignModelPreviewRuntime {
  createPreview(host: HTMLElement): ModelPreview;
  createDefinition(artwork: WheelDesignArtwork): Promise<MaterialDefinition>;
  createSession(): ReturnType<typeof createMaterialRenderSession>;
  createVisibleArea?: typeof createWheelVisibleArea;
}
const DEFAULT_RUNTIME: WheelDesignModelPreviewRuntime = {
  createPreview: host => new CarPreview(host), createDefinition: createWheelArtworkDefinition,
  createSession: createMaterialRenderSession,
};
const CHANNEL_MAPS: Readonly<Partial<Record<MaterialRenderChannel, MapId>>> = {
  color: 'Wheels_B', roughmetal: 'Wheels_R', emission: 'Wheels_I', dirt: 'Wheels_DirtMask',
};

/** An independent renderer paints detached snapshots. The editor is never used as a scratch canvas. */
export function WheelDesignModelPreview({ artwork, target, context, onCoverageChange, runtime = DEFAULT_RUNTIME }: {
  artwork: WheelDesignComposition; target: Target; context: WheelDesignPreviewContext;
  onCoverageChange?(coverage: WheelDesignCoverage): void;
  runtime?: WheelDesignModelPreviewRuntime;
}) {
  const host = useRef<HTMLDivElement>(null), preview = useRef<ModelPreview | null>(null);
  const latest = useRef({ artwork, target }); latest.current = { artwork, target };
  const schedule = useRef<() => void>(() => {});
  const coverageCallback = useRef(onCoverageChange); coverageCallback.current = onCoverageChange;
  const refreshCoverage = useRef<(side: 'outer' | 'inner') => void>(() => {});
  const sideRef = useRef<'outer' | 'inner'>(target === 'inner' ? 'inner' : 'outer');
  const [side, setSide] = useState(sideRef.current), [ready, setReady] = useState(false);
  const [painted, setPainted] = useState(false), [updating, setUpdating] = useState(false);
  const [braking, setBraking] = useState(false);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true, initialized = false, running = false, pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined, coverageTimer: ReturnType<typeof setTimeout> | undefined;
    let instance: ModelPreview | null = null;
    const session = runtime.createSession(), maps = new Map<MapId, HTMLCanvasElement>();
    const roleMap = document.createElement('canvas');
    const coverageMaps = new Map<string, { mask: HTMLCanvasElement | null; alignmentConflict: boolean | null }>();
    const showCoverage = (side: 'outer' | 'inner') => {
      clearTimeout(coverageTimer);
      coverageCallback.current?.(null);
      const keepMask = !!context.layer && latest.current.target === context.initialTarget;
      const key = `${side}:${keepMask ? 'original' : 'whole'}`;
      const cached = coverageMaps.get(key);
      if (cached) { coverageCallback.current?.({ side, ...cached }); return; }
      coverageTimer = setTimeout(() => {
        if (!alive || !instance || !initialized) return;
        const geometry = instance.getProjectionTriangles();
        const alignmentConflict = hasWheelFaceAlignmentConflict(geometry);
        try {
          const mask = (runtime.createVisibleArea ?? createWheelVisibleArea)(geometry, side, {
            definition: context.layer?.definition, ...(keepMask ? { layer: context.layer } : {}),
            center: instance.getViewState().target, size: 256, pose: context.pose,
          });
          const result = { mask, alignmentConflict }; coverageMaps.set(key, result); coverageCallback.current?.({ side, ...result });
        } catch { coverageCallback.current?.({ side, mask: null, alignmentConflict }); }
      }, 0);
    };
    refreshCoverage.current = showCoverage;
    setReady(false); setPainted(false); setError('');
    const timeout = setTimeout(() => {
      if (alive && !initialized) setError('La roue 3D met trop de temps à charger. Vous pouvez continuer dans la vue de construction.');
    }, 25_000);
    const compose = (id: MapId, overlay?: HTMLCanvasElement, roleOverlay?: HTMLCanvasElement) => {
      const source = context.maps.get(id);
      if (!source) return;
      let canvas = maps.get(id);
      if (!canvas) { canvas = document.createElement('canvas'); canvas.width = source.below.width; canvas.height = source.below.height; maps.set(id, canvas); }
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('L’aperçu des couleurs est indisponible.');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source.below, 0, 0, canvas.width, canvas.height);
      if (overlay && context.ownerVisible) {
        ctx.globalAlpha = context.ownerOpacity; ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1;
      }
      ctx.drawImage(source.above, 0, 0, canvas.width, canvas.height);
      if (id === 'Wheels_I') {
        roleMap.width = canvas.width; roleMap.height = canvas.height;
        const roles = roleMap.getContext('2d')!; roles.imageSmoothingEnabled = false;
        if (source.roles) roles.drawImage(source.roles, 0, 0, roleMap.width, roleMap.height);
        else { roles.fillStyle = '#fff'; roles.fillRect(0, 0, roleMap.width, roleMap.height); }
        if (roleOverlay && context.ownerVisible && context.ownerOpacity > 0) {
          const draft = document.createElement('canvas'); draft.width = roleMap.width; draft.height = roleMap.height;
          const draftContext = draft.getContext('2d')!; draftContext.imageSmoothingEnabled = false;
          draftContext.drawImage(roleOverlay, 0, 0, draft.width, draft.height);
          const draftRoles = draftContext.getImageData(0, 0, draft.width, draft.height).data;
          const result = roles.getImageData(0, 0, roleMap.width, roleMap.height);
          for (let i = 0; i < result.data.length; i += 4) if (draftRoles[i + 3]) result.data[i] = draftRoles[i] < 129 ? 3 : 255;
          roles.putImageData(result, 0, 0); draft.width = draft.height = 1;
        }
        if (source.roles) {
          const top = document.createElement('canvas'); top.width = roleMap.width; top.height = roleMap.height;
          const topContext = top.getContext('2d')!; topContext.drawImage(source.roles, 0, 0, top.width, top.height);
          topContext.globalCompositeOperation = 'destination-in'; topContext.drawImage(source.above, 0, 0, top.width, top.height);
          roles.drawImage(top, 0, 0); top.width = top.height = 1;
        }
        instance!.setMapCanvas(id, canvas, roleMap);
      } else instance!.setMapCanvas(id, canvas);
    };
    const paint = async () => {
      if (!alive || !initialized || !instance || running) return;
      running = true; pending = false; setUpdating(true);
      const draft = latest.current, safe = normalizeWheelComposition(draft.artwork);
      const current = () => alive && latest.current.artwork === draft.artwork && latest.current.target === draft.target;
      for (const element of safe.elements) {
        const original = draft.artwork.elements.find(item => item.id === element.id);
        if (element.design.pattern === 'lettering' && !original?.design.text.trim()) element.visible = false;
        if (element.design.pattern === 'image' && !element.design.imageData) element.visible = false;
      }
      let channels: Map<MaterialRenderChannel, HTMLCanvasElement> | undefined;
      try {
        if (safe.elements.some(element => element.visible && element.opacity > 0)) {
          const generated = await runtime.createDefinition(safe);
          if (!current()) return;
          const definition = context.layer ? mergeWheelArtworkDefinition(context.layer.definition, generated) : generated;
          const keepMask = context.layer && draft.target === context.initialTarget;
          const regions = draft.target === 'both' ? ['tyres:outer', 'tyres:inner'] : [`tyres:${draft.target}`];
          const layer: MaterialLayer = keepMask ? { ...context.layer!, definition } : {
            ...(context.layer ?? {}), definition, family: 'wheels',
            regions: WHEEL_PART_GUIDES.filter(region => regions.includes(region.key)).map(({ key, label, polygons }) => ({ key, label, polygons })), exclusions: [],
            ...(!context.layer && context.atlasSource ? { nativeAtlas: context.atlasSource } : {}),
          };
          await session.load(definition);
          if (!current()) return;
          channels = session.render(layer, 512, instance.getProjectionTriangles());
        }
        if (!current()) return;
        for (const [channel, id] of Object.entries(CHANNEL_MAPS)) compose(id!, channels?.get(channel as MaterialRenderChannel), id === 'Wheels_I' ? channels?.get('wheelEmissionRole') : undefined);
        const pixels = (channel: 'normal' | 'ao') => {
          const canvas = channels?.get(channel);
          if (!canvas || !context.ownerVisible) return undefined;
          const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
          if (context.ownerOpacity !== 1) for (let i = 3; i < image.data.length; i += 4) image.data[i] *= context.ownerOpacity;
          return { width: image.width, height: image.height, data: image.data };
        };
        const normal = pixels('normal'), ao = pixels('ao');
        const surfaces = context.surfaceOverlays ?? [];
        const index = Number.isInteger(context.surfaceOverlayInsertIndex)
          ? Math.max(0, Math.min(surfaces.length, context.surfaceOverlayInsertIndex!)) : surfaces.length;
        instance.setMaterialSurfaceOverlays([...surfaces.slice(0, index),
          ...(normal || ao ? [{ family: 'wheels' as const, normal, ao }] : []), ...surfaces.slice(index)]);
        setError(''); setPainted(true);
      } catch (cause) {
        if (current()) setError(cause instanceof Error ? cause.message : 'L’aperçu de la roue est indisponible.');
      } finally {
        for (const canvas of channels?.values() ?? []) canvas.width = canvas.height = 1;
        running = false;
        if (alive) { setUpdating(false); if (pending) request(); }
      }
    };
    const request = () => {
      pending = true;
      if (!alive || !initialized || running || timer) return;
      timer = setTimeout(() => { timer = undefined; void paint(); }, 45);
    };
    schedule.current = request;
    const prepare = async () => {
      if (!alive || initialized || !instance) return;
      instance.onModelReady = null;
      try {
        if (context.modelPreview) await instance.loadCustomPreview(context.modelPreview, {
          nativeSurfaceLayout: context.nativeSurfaceLayout, detailsLayout: context.detailsLayout,
        });
        if (!alive) return;
        instance.setSurfaceTextures(context.surfaceFiles); instance.setWheelSurface(context.wheelSurface);
        instance.setVehiclePose(context.pose);
        for (const id of context.maps.keys()) compose(id);
        instance.setMaterialSurfaceOverlays(context.surfaceOverlays ?? []);
        if (!instance.focusWheelForDesign(sideRef.current)) throw new Error('Cette roue ne peut pas être cadrée sur le modèle actuel.');
        initialized = true; clearTimeout(timeout); setReady(true); request(); showCoverage(sideRef.current);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'La roue 3D est indisponible.');
      }
    };
    try {
      instance = runtime.createPreview(host.current!); preview.current = instance;
      instance.onModelReady = () => { void prepare(); };
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Votre navigateur ne peut pas ouvrir cet aperçu 3D.'); }
    return () => {
      alive = false; clearTimeout(timeout); clearTimeout(timer); clearTimeout(coverageTimer); schedule.current = () => {};
      refreshCoverage.current = () => {}; coverageCallback.current?.(null);
      if (instance) { instance.onModelReady = null; instance.dispose(); }
      if (preview.current === instance) preview.current = null;
      session.dispose(); for (const canvas of maps.values()) canvas.width = canvas.height = 1; roleMap.width = roleMap.height = 1;
      for (const { mask } of coverageMaps.values()) if (mask) mask.width = mask.height = 1;
    };
  }, [context, retry, runtime]);

  useEffect(() => { schedule.current(); }, [artwork, target]);
  useEffect(() => { preview.current?.setBraking?.(braking); }, [braking, ready]);
  useEffect(() => {
    if (target !== 'both') { sideRef.current = target; setSide(target); if (ready && preview.current?.focusWheelForDesign(target)) refreshCoverage.current(target); }
    else if (ready) refreshCoverage.current(sideRef.current);
  }, [target, ready]);
  const changeSide = (value: 'outer' | 'inner') => {
    sideRef.current = value; setSide(value); if (ready && preview.current?.focusWheelForDesign(value)) refreshCoverage.current(value);
  };
  return <div className="wheel-design-model-preview" aria-busy={!painted || updating}>
    <div className="wheel-design-model-canvas" ref={host} role="img" aria-label="Votre roue 3D avec la composition en direct" />
    <div className="wheel-design-model-tools" role="group" aria-label="Face de la roue 3D">
      <button type="button" className={side === 'outer' ? 'is-active' : ''} aria-pressed={side === 'outer'} onClick={() => changeSide('outer')}>Extérieur</button>
      <button type="button" className={side === 'inner' ? 'is-active' : ''} aria-pressed={side === 'inner'} onClick={() => changeSide('inner')}>Intérieur</button>
      <button type="button" aria-label="Recadrer la roue 3D" title="Recadrer la roue" disabled={!ready} onClick={() => preview.current?.focusWheelForDesign(sideRef.current)}><Icon name="target" size={13} /></button>
      <button type="button" aria-pressed={braking} className={braking ? 'is-active' : ''} onClick={() => setBraking(value => !value)}>Freinage</button>
    </div>
    {!painted && !error && <div className="wheel-design-model-loading" role="status"><span className="spinner" />Préparation de votre roue…</div>}
    {error && <div className="wheel-design-model-error" role="status"><p>{error}</p><button type="button" className="btn btn-sm" onClick={() => setRetry(value => value + 1)}>Réessayer la 3D</button></div>}
    <div className="wheel-design-model-caption"><span className={updating ? 'is-updating' : ''} />{updating ? 'Actualisation…' : target !== 'both' && target !== side ? 'Le brouillon cible l’autre flanc' : 'Brouillon en direct'}<small>Glissez pour tourner · molette pour zoomer</small></div>
  </div>;
}
