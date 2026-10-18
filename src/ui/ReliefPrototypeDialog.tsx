import { useEffect, useId, useRef, useState } from 'react';
import type { RGBAImage } from '../dds';
import type { MapId } from '../maps';
import { importMaterialFilesDetailed } from '../materials/import';
import { createMaterialRenderSession, hasProceduralMaterialRelief, renderMaterialLayer } from '../materials/render';
import { createMaterialDefinition, type MaterialDefinition, type MaterialLayer, type MaterialRenderChannel } from '../materials/types';
import {
  buildReliefPrototype, createDiagnosticReliefAtlas, createVolumeDiagnosticAtlas, createReliefMask, loadPreparedReliefTemplate,
  type BuildReliefOptions, type PreparedReliefTemplate, type ReliefPrototypeResult,
} from '../relief/engine';
import type { ReliefMode, ReliefScope } from '../relief/types';
import { RELIEF_GAME_ZIP_LIMIT_BYTES, reliefPrototypeName } from '../relief/export';
import { createHeightSampler, createProjectedHeightSampler, loadHeightSource, localPNGAspect, type HeightSource } from '../relief/heightSource';
import { detailSources } from '../materials/relief';
import { retainOtherLayerVolumes } from '../relief/layerVolume';
import type { ReliefSettings } from '../relief/settings';
import type { Skin3DFile } from '../skin3d';
import type { ProjectionTriangle } from '../three/decalProjection';
import { CarPreview, type PreviewViewState } from '../three/CarPreview';
import { DEFAULT_WHEEL_SURFACE } from '../wheelSurface';
import { SliderField } from './controls';
import { Icon } from './Icon';
import './reliefPrototypeDialog.css';

type PrototypePreview = Pick<CarPreview, 'setMapCanvas' | 'setSurfaceTextures' | 'setWheelSurface' | 'setCoatIntensity'
  | 'setDirtPreview' | 'loadCustomPreview' | 'getViewState' | 'restoreViewState' | 'resetCamera' | 'snapshot' | 'dispose'>;
interface PrototypeMaterialSession {
  load(definition: MaterialDefinition): Promise<void>;
  render(layer: MaterialLayer, size: number, geometry?: readonly ProjectionTriangle[]): Map<MaterialRenderChannel, HTMLCanvasElement>;
  dispose(): void;
}
export interface ReliefPrototypeRuntime {
  createPreview(host: HTMLElement): PrototypePreview;
  loadTemplate(): Promise<PreparedReliefTemplate>;
  build(options: BuildReliefOptions): Promise<ReliefPrototypeResult>;
  createMaterialSession?(): PrototypeMaterialSession;
}
const DEFAULT_RUNTIME: ReliefPrototypeRuntime = {
  createPreview: (host) => new CarPreview(host), loadTemplate: () => loadPreparedReliefTemplate(true), build: buildReliefPrototype,
};
export interface ReliefPrototypeDialogProps {
  preserveMaterialMask?:boolean;
  baseVolume?:{mesh:Uint8Array;variant:'standard'|'normal'};
  name: string;
  maps: ReadonlyMap<MapId, HTMLCanvasElement>;
  material: MaterialLayer | null;
  projectionGeometry?: readonly ProjectionTriangle[];
  surfaceFiles: readonly Skin3DFile[];
  onClose(): void;
  settings?: ReliefSettings | null;
  onApply?(result: ReliefPrototypeResult, settings: ReliefSettings, maps: ReadonlyMap<MapId, HTMLCanvasElement>, appearance?: MaterialDefinition): Promise<void>;
  onExport(result: ReliefPrototypeResult, maps: ReadonlyMap<MapId, HTMLCanvasElement>, icon: HTMLCanvasElement, sourceName: string): Promise<number | void>;
  /** The same lifecycle can be verified without depending on a GPU in unit tests. */
  runtime?: ReliefPrototypeRuntime;
}
type TextureQuality = 1024 | 2048 | 4096;
interface Source { kind: 'selected' | 'carbon' | 'demo' | 'imported' | 'diagnostic'; layer: MaterialLayer | null; name: string; serial: number }
const materialHasHeight = (definition: MaterialDefinition) => !!definition.textures.height || hasProceduralMaterialRelief(definition);
const materialHasNormal = (definition: MaterialDefinition) => !!definition.textures.normal || detailSources(definition).height || hasProceduralMaterialRelief(definition);
const usable = (layer: MaterialLayer | null) => layer?.family === 'skin' && (materialHasNormal(layer.definition) || materialHasHeight(layer.definition));
function repeatingLayer(layer: MaterialLayer): MaterialLayer {
  return structuredClone(layer);
}
const image = (canvas: HTMLCanvasElement): RGBAImage => ({ width: canvas.width, height: canvas.height, data: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data });
function canvasFrom(image: RGBAImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('L’aperçu des textures est indisponible.');
  const pixels = context.createImageData(image.width, image.height); pixels.data.set(image.data); context.putImageData(pixels, 0, 0); return canvas;
}
function copyMaps(maps: ReadonlyMap<MapId, HTMLCanvasElement>, maxSize?: number) {
  const result = new Map<MapId, HTMLCanvasElement>();
  for (const [id, source] of maps) {
    const ratio = maxSize ? Math.min(1, maxSize / Math.max(source.width, source.height)) : 1;
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(source.width * ratio)); canvas.height = Math.max(1, Math.round(source.height * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('L’aperçu des textures est indisponible.');
    context.drawImage(source, 0, 0, canvas.width, canvas.height); result.set(id, canvas);
  }
  return result;
}
function release(canvases: Iterable<HTMLCanvasElement>) { for (const canvas of canvases) canvas.width = canvas.height = 0; }
function diagnosticAppearance(maps: Map<MapId, HTMLCanvasElement>) {
  for (const [ids, fill] of [
    [['Skin_B', 'Details_B', 'Wheels_B'], '#606060'],
    [['Skin_R', 'Details_R', 'Wheels_R'], '#b40000'],
    [['Skin_CoatR'], '#000000'],
  ] as const) for (const id of ids) {
    const previous = maps.get(id); if (previous) release([previous]);
    const source = document.createElement('canvas'); source.width = source.height = 4;
    const ctx = source.getContext('2d')!; ctx.fillStyle = fill; ctx.fillRect(0, 0, 4, 4); maps.set(id, source);
  }
}
function overlaySurface(target: HTMLCanvasElement, source: HTMLCanvasElement, template: PreparedReliefTemplate, scope: ReliefScope) {
  if (scope === 'vehicle') { target.getContext('2d')!.drawImage(source, 0, 0, target.width, target.height); return; }
  const masked = document.createElement('canvas'); masked.width = source.width; masked.height = source.height;
  const mask = canvasFrom(createReliefMask(template, source.width, source.height, scope));
  try {
    const context = masked.getContext('2d')!; context.drawImage(source, 0, 0);
    context.globalCompositeOperation = 'destination-in'; context.drawImage(mask, 0, 0);
    target.getContext('2d')!.drawImage(masked, 0, 0, target.width, target.height);
  } finally { release([masked, mask]); }
}
function mergedFiles(base: readonly Skin3DFile[], added: readonly Skin3DFile[]): Skin3DFile[] {
  const files = new Map(base.filter(file => file.name.toLowerCase() !== 'skin_n.dds').map(file => [file.name.toLowerCase(), file]));
  for (const file of added) files.set(file.name.toLowerCase(), file);
  return [...files.values()];
}
const HOOD_VIEW: PreviewViewState = { position: [2.1, 1.4, 2.45], target: [0, .75, .75] };
/** The hood feather also belongs to its editable paint owner. Original repeat
 * sources are retained separately in ReliefSettings for subsequent changes.
 */
function hoodAppearance(definition: MaterialDefinition, channels: Map<MaterialRenderChannel, HTMLCanvasElement>, template: PreparedReliefTemplate): MaterialDefinition {
  const copy = createMaterialDefinition('solid'); copy.name = definition.name;
  copy.color = '#ffffff'; copy.roughness = 255; copy.coat = 255; copy.transform.mode = 'stretch'; copy.transform.size = 256;
  for (const [channel, role] of [['color','color'],['roughmetal','roughmetal'],['coat','coat']] as const) {
    const source = channels.get(channel); if (!source) continue;
    const masked = document.createElement('canvas'); masked.width = source.width; masked.height = source.height;
    const mask = canvasFrom(createReliefMask(template, source.width, source.height, 'hood'));
    try {
      const ctx = masked.getContext('2d')!; ctx.drawImage(source,0,0); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask,0,0);
      copy.textures[role] = { src: masked.toDataURL('image/png'), name: `${role}-capot.png`, component: 'r', invert: false };
    } finally { release([masked,mask]); }
  }
  return copy;
}
const nextPaint = () => new Promise<void>(resolve => window.setTimeout(resolve, 0));

/** The workshop owns a separate preview and canvas copies; the editor is never modified. */
export function ReliefPrototypeDialog({ name, maps, material, projectionGeometry, surfaceFiles, onClose, onExport, settings, onApply,preserveMaterialMask=false,baseVolume, runtime = DEFAULT_RUNTIME }: ReliefPrototypeDialogProps) {
  const id = useId(), panel = useRef<HTMLDivElement>(null), previewHost = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null), preview = useRef<PrototypePreview | null>(null);
  const diagnostic = useRef<{ resolution: TextureQuality; kind: Source['kind']; atlas: RGBAImage } | null>(null);
  const materialSession = useRef<PrototypeMaterialSession | null>(null);
  const numericHeight = useRef<{ src: string; component: string; field: HeightSource | null; aspect: number } | null>(null);
  const selected = useRef(usable(material) ? repeatingLayer(material!) : null);
  const layerScoped=preserveMaterialMask&&!!selected.current;
  const [source, setSource] = useState<Source>(() => settings
    ? { kind: settings.source === 'material' ? 'imported' : settings.source, layer: settings.material ? structuredClone(settings.material) : null, name: settings.sourceName, serial: 0 }
    : selected.current
    ? { kind: 'selected', layer: structuredClone(selected.current), name: selected.current.definition.name, serial: 0 }
    : { kind: 'carbon', layer: { definition: createMaterialDefinition('carbon'), family: 'skin', regions: [], exclusions: [] }, name: 'Carbone tissé', serial: 0 });
  const [template, setTemplate] = useState<PreparedReliefTemplate | null>(null);
  const [scope, setScope] = useState<ReliefScope>(layerScoped?'vehicle':settings?.scope ?? 'vehicle');
  const [textureResolution, setTextureResolution] = useState<TextureQuality>(settings?.textureResolution ?? 2048);
  const [mode, setMode] = useState<ReliefMode>(() => settings?.mode ?? (selected.current && !materialHasHeight(selected.current.definition) ? 'normal' : 'geometry'));
  const [strengthMm, setStrengthMm] = useState(settings?.strengthMm ?? (!selected.current || selected.current.definition.preset === 'carbon' ? .5 : 10)), [compare, setCompare] = useState(false);
  const [exaggerated, setExaggerated] = useState(settings?.diagnostic ?? false);
  const [building, setBuilding] = useState(true), [importing, setImporting] = useState(false), [exporting, setExporting] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState('Préparation du modèle…');
  const [notices, setNotices] = useState<string[]>([]), [stats, setStats] = useState<ReliefPrototypeResult['stats'] | null>(null);
  const [builtKey, setBuiltKey] = useState('');
  const alive = useRef(true), generation = useRef(0), importGeneration = useRef(0), close = useRef(onClose);
  const current = useRef<{ result: ReliefPrototypeResult; maps: Map<MapId, HTMLCanvasElement>; sourceName: string; key: string; appearance?: MaterialDefinition } | null>(null);
  const hasHeight = source.kind === 'demo' || source.kind === 'diagnostic' || !!source.layer && materialHasHeight(source.layer.definition);
  const hasNormal = !!source.layer && materialHasNormal(source.layer.definition);
  const proceduralRelief = !!source.layer && hasProceduralMaterialRelief(source.layer.definition);
  const buildKey = JSON.stringify([source.serial, mode, strengthMm, compare, scope, textureResolution, exaggerated]);
  close.current = () => { if (!exporting) onClose(); };

  useEffect(() => {
    alive.current = true;
    const session = runtime.createMaterialSession?.() ?? createMaterialRenderSession();
    materialSession.current = session;
    let instance: PrototypePreview | undefined;
    const invalidatePending = () => { generation.current++; importGeneration.current++; };
    const previousFocus = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('[aria-label="Fermer l’atelier de relief"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Isolate editor shortcuts; mouse orbit and zoom remain available in the preview.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return; }
      if (event.key === 'Tab') {
        const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="hidden"]), summary, [tabindex="0"]')]
          .filter(control => !control.hidden && !control.closest('[hidden]') && (control.tagName === 'SUMMARY' || !control.closest('details:not([open])')));
        const first = controls[0], last = controls.at(-1);
        if (!controls.length) { event.preventDefault(); panel.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panel.current!.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.current!.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      } else if ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => event.stopImmediatePropagation();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    try {
      instance = runtime.createPreview(previewHost.current!); preview.current = instance;
      instance.setCoatIntensity(1); instance.setDirtPreview(0); instance.setWheelSurface({ ...DEFAULT_WHEEL_SURFACE });
      for (const [map, canvas] of maps) instance.setMapCanvas(map, canvas);
      instance.setSurfaceTextures(surfaceFiles);
      void runtime.loadTemplate().then(value => { if (alive.current) setTemplate(value); }).catch(reason => {
        if (alive.current) { setError(reason instanceof Error ? reason.message : 'Le modèle du prototype est indisponible.'); setBuilding(false); }
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'L’aperçu 3D est indisponible.'); setBuilding(false); }
    return () => {
      alive.current = false; invalidatePending();
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKeyUp, true);
      instance?.dispose(); session.dispose();
      if (materialSession.current === session) materialSession.current = null;
      preview.current = null; current.current = null; numericHeight.current = null;
      previousFocus?.focus();
    };
  }, [maps, surfaceFiles, runtime]);

  useEffect(() => {
    const session = materialSession.current;
    if (!template || !preview.current || !session) return;
    const ticket = ++generation.current;
    const invalidate = () => { generation.current++; };
    let owned: Map<MapId, HTMLCanvasElement> | undefined;
    setBuilding(true); setError(''); setStatus('Calcul du relief…');
    const timer = window.setTimeout(() => { void (async () => {
      let rendered: ReturnType<typeof renderMaterialLayer> | undefined;
      try {
        let heightAtlas: RGBAImage | undefined, normalAtlas: RGBAImage | undefined, heightSample: BuildReliefOptions['heightSample'], heightSourceBits: 8 | 16 | undefined;
        setStatus(`Préparation des textures ${textureResolution / 1024}K…`); await nextPaint();
        if (!alive.current || generation.current !== ticket) return;
        owned = copyMaps(maps, textureResolution);
        if (source.layer) {
          const definition = structuredClone(source.layer.definition);
          // The workshop preserves lighting/dirt and renders only the surface
          // channels it uses. Geometry mode does not need a decoded normal image.
          delete definition.textures.ao; delete definition.textures.emission; delete definition.textures.dirt;
          if (mode === 'geometry' || compare) delete definition.textures.normal;
          await session.load(definition);
          if (!alive.current || generation.current !== ticket) return;
            const layer = { ...source.layer, definition, regions: scope === 'vehicle'&&!preserveMaterialMask ? [] : source.layer.regions, exclusions: scope === 'vehicle'&&!preserveMaterialMask ? [] : source.layer.exclusions };
          rendered = session.render(layer, textureResolution, projectionGeometry);
          if (rendered.has('height')) heightAtlas = image(rendered.get('height')!);
          const height = definition.textures.height;
          const projected = !!definition.transform.projection && definition.transform.projection !== 'uv';
          if (height && heightAtlas && (definition.transform.mode === 'repeat' || projected) && mode !== 'normal' && !compare) {
            if (numericHeight.current?.src !== height.src || numericHeight.current.component !== height.component) {
              const reference = definition.textures.color ?? definition.textures.roughmetal ?? Object.values(definition.textures)[0];
              numericHeight.current = { src: height.src, component: height.component, field: await loadHeightSource(height), aspect: await localPNGAspect(reference!.src) };
            }
            if (!alive.current || generation.current !== ticket) return;
            const field = numericHeight.current.field;
            if (field) {
              heightSample = projected ? createProjectedHeightSampler(field, layer, heightAtlas, projectionGeometry ?? [], numericHeight.current.aspect)
                : createHeightSampler(field, layer, heightAtlas, numericHeight.current.aspect);
              heightSourceBits = field.bits;
            }
          }
          if (mode !== 'geometry' && !compare && rendered.has('normal')) normalAtlas = image(rendered.get('normal')!);
          const targets = scope === 'vehicle'&&!preserveMaterialMask
            ? [['color', 'Skin_B'], ['color', 'Details_B'], ['color', 'Wheels_B'], ['roughmetal', 'Skin_R'], ['roughmetal', 'Details_R'], ['roughmetal', 'Wheels_R'], ['coat', 'Skin_CoatR']] as const
            : [['color', 'Skin_B'], ['roughmetal', 'Skin_R'], ['coat', 'Skin_CoatR']] as const;
          const familyRenders = new Map<string, Map<MaterialRenderChannel, HTMLCanvasElement>>([['skin', rendered]]);
          try {
            if (!layerScoped&&(scope === 'vehicle' || source.kind === 'imported' || source.kind === 'carbon')) for (const [channel, map] of targets) {
              const textures = source.layer.definition.textures;
              if (source.kind === 'imported' && !(channel === 'color' ? textures.color
                : channel === 'roughmetal' ? textures.roughmetal || textures.roughness || textures.metalness
                : textures.coat || textures.color)) continue;
              const family = map.startsWith('Details') ? 'details' : map.startsWith('Wheels') ? 'wheels' : 'skin';
              if (projected && !familyRenders.has(family)) {
                familyRenders.set(family, session.render({ ...layer, family }, textureResolution, projectionGeometry));
              }
              const target = owned.get(map), overlay = (familyRenders.get(family) ?? rendered).get(channel);
              if (target && overlay) {
                if (target.width !== textureResolution || target.height !== textureResolution) {
                  const enlarged = document.createElement('canvas'); enlarged.width = enlarged.height = textureResolution;
                  enlarged.getContext('2d')!.drawImage(target, 0, 0, textureResolution, textureResolution); release([target]); owned.set(map, enlarged);
                }
                overlaySurface(owned.get(map)!, overlay, template, scope);
                await nextPaint(); if (!alive.current || generation.current !== ticket) return;
              }
            }
          } finally { for (const [family, channels] of familyRenders) if (family !== 'skin') release(channels.values()); }
        } else {
          if (diagnostic.current?.resolution !== textureResolution || diagnostic.current.kind !== source.kind) diagnostic.current = {
            resolution: textureResolution, kind: source.kind,
            atlas: source.kind === 'diagnostic' ? createVolumeDiagnosticAtlas(textureResolution) : createDiagnosticReliefAtlas(textureResolution),
          };
          heightAtlas = diagnostic.current.atlas;
          if (source.kind === 'diagnostic') diagnosticAppearance(owned);
        }
        setStatus('Calcul du volume et des normales…'); await nextPaint();
        if (!alive.current || generation.current !== ticket) return;
        let result = await runtime.build({ template, mode: compare ? 'geometry' : mode, strengthMm: compare ? 0 : strengthMm,
          heightAtlas: compare ? undefined : heightAtlas, normalAtlas: compare || mode === 'geometry' ? undefined : normalAtlas,
          scope, textureResolution, diagnostic: exaggerated, heightSample, heightSourceBits });
        if(layerScoped&&baseVolume)result=retainOtherLayerVolumes(template,result,baseVolume,heightAtlas??{width:1,height:1,data:new Uint8ClampedArray(4)});
        if(layerScoped)result.project.passthrough=result.project.passthrough.filter(file=>! /^(Details|Wheels)_N\.dds$/i.test(file.name));
        if (!alive.current || generation.current !== ticket) return;
        const displayed = result;
        if (!displayed.project.preview) throw new Error('L’aperçu du prototype est manquant.');
        const instance = preview.current!;
        const camera = current.current ? instance.getViewState() : null;
        await instance.loadCustomPreview(displayed.project.preview, { nativeSurfaceLayout: true });
        if (!alive.current || generation.current !== ticket) return;
        for (const [map, canvas] of owned) instance.setMapCanvas(map, canvas);
        instance.setSurfaceTextures(mergedFiles(surfaceFiles, displayed.project.passthrough));
        // The independent preview uses the same wheel DDS as the exported ZIP.
        instance.setWheelSurface({ mode: 'relief', strength: 1 });
        if (source.kind === 'diagnostic' && !current.current?.sourceName.startsWith('Test géométrique')) instance.restoreViewState(HOOD_VIEW);
        else if (camera) instance.restoreViewState(camera);
        const appearance = !layerScoped&&scope === 'hood' && source.layer && rendered && (source.kind !== 'imported' || source.layer.definition.textures.color)
          ? hoodAppearance(source.layer.definition, rendered, template) : undefined;
        current.current = { result, maps: owned, sourceName: source.name, key: buildKey, appearance };
        setStats(result.stats); setBuiltKey(buildKey); setBuilding(false);
        setStatus(compare ? 'Comparaison : même texture, sans relief.' : 'Aperçu prêt. Glissez pour tourner ; utilisez la molette pour zoomer.');
      } catch (reason) {
        if (alive.current && generation.current === ticket) { setError(reason instanceof Error ? reason.message : 'Le calcul du relief a échoué.'); setBuilding(false); }
      } finally { if (rendered) release(rendered.values()); }
    })(); }, 120);
    return () => { window.clearTimeout(timer); invalidate(); if (owned) release(owned.values()); };
  }, [template, source, mode, strengthMm, compare, maps, surfaceFiles, buildKey, runtime, scope, textureResolution, exaggerated, projectionGeometry,preserveMaterialMask,layerScoped,baseVolume]);

  async function importFiles(files: File[]) {
    const ticket = ++importGeneration.current;
    setImporting(true); setError(''); setStatus('Import des textures…');
    try {
      const imported = await importMaterialFilesDetailed(files, { maxTextureSize: 4096 });
      if (!alive.current || importGeneration.current !== ticket) return;
      if (!materialHasHeight(imported.definition) && !materialHasNormal(imported.definition)) throw new Error('Ce pack ne contient ni hauteur ni normales. Ajoutez une image nommée height, displacement ou normal.');
      const layer = repeatingLayer({ definition: imported.definition, family: 'skin', regions: [], exclusions: [] });
      if (files.some(file => /\.blend\.zip$/i.test(file.name))) layer.definition.transform.size = 1024;
      if (source.kind === 'carbon' || source.kind === 'demo') { setStrengthMm(10); setExaggerated(false); }
      setSource(value => ({ kind: 'imported', layer, name: imported.definition.name, serial: value.serial + 1 }));
      setMode(previous => materialHasHeight(imported.definition) ? previous === 'combined' ? previous : 'geometry' : 'normal');
      setCompare(false); setNotices(imported.notices);
    } catch (reason) { if (alive.current && importGeneration.current === ticket) setError(reason instanceof Error ? reason.message : 'L’import des textures a échoué.'); }
    finally { if (alive.current && importGeneration.current === ticket) setImporting(false); }
  }
  async function exportPrototype() {
    const prepared = current.current;
    if (!prepared || prepared.key !== buildKey || building || importing || exporting || error || !preview.current) return;
    setExporting(true); setError(''); setStatus('Création du skin…');
    let icon: HTMLCanvasElement | undefined, exportMaps: Map<MapId, HTMLCanvasElement> | undefined;
    try {
      await nextPaint(); if (!alive.current) return;
      icon = preview.current.snapshot(256); exportMaps = copyMaps(prepared.maps);
      const bytes = await onExport(prepared.result, exportMaps, icon, prepared.sourceName);
      if (alive.current) setStatus(`ZIP créé : ${reliefPrototypeName(name, prepared.result)}.zip${typeof bytes === 'number' ? ` · ${(bytes / 1_000_000).toFixed(1)} Mo · budget ${RELIEF_GAME_ZIP_LIMIT_BYTES / 1_000_000} Mo` : ''} · ${prepared.sourceName}. Skin prêt à importer dans le garage.`);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'L’export du skin a échoué.'); }
    finally { if (icon) release([icon]); if (exportMaps) release(exportMaps.values()); if (alive.current) setExporting(false); }
  }
  async function applyRelief() {
    const prepared = current.current;
    if (!onApply || !prepared || prepared.key !== buildKey || exportDisabled || compare || source.kind === 'diagnostic') return;
    setExporting(true); setError(''); setStatus('Application du relief au projet…');
    try {
      await nextPaint(); if (!alive.current) return;
      await onApply(prepared.result, { version: 1, source: source.layer ? 'material' : 'demo',
        material: source.layer ? structuredClone(source.layer) : null, sourceName: source.name, mode, scope, textureResolution, strengthMm, diagnostic: exaggerated,...(preserveMaterialMask?{appearanceScope:'skin' as const}:{}) }, prepared.maps, prepared.appearance);
      if (alive.current) onClose();
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'L’application du relief a échoué.'); }
    finally { if (alive.current) setExporting(false); }
  }
  const controlsBusy = importing || exporting, exportDisabled = controlsBusy || building || !!error || !current.current || builtKey !== buildKey;
  return <div className="modal-overlay relief-overlay" onClick={() => close.current()}>
    <div ref={panel} className="modal relief-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <header className="modal-head"><div><h2 id={`${id}-title`}>Textures et relief <span className="relief-version">v1.0</span></h2><p id={`${id}-description`}>{layerScoped?`Volume du calque « ${selected.current!.definition.name} » · ses zones et exclusions sont conservées.`:<>Car Stadium · ajustez le volume, puis appliquez-le à « {name} » ou exportez-le.</>}</p></div><button type="button" className="modal-close" aria-label="Fermer l’atelier de relief" onClick={() => close.current()}><Icon name="x" size={18} /></button></header>
      <div className="relief-workshop">
        <div className="relief-stage"><div ref={previewHost} className="relief-preview" aria-label="Aperçu 3D du relief" />
          <div className="relief-view-tools"><button type="button" className="btn btn-sm" disabled={building} onClick={() => preview.current?.restoreViewState(HOOD_VIEW)}><Icon name="target" size={14} />Voir le capot</button><button type="button" className="btn btn-sm" disabled={building} onClick={() => preview.current?.resetCamera()}>Voiture entière</button></div>
          {building && <div className="relief-building" role="status">Préparation de l’aperçu…</div>}
          <span className="relief-stage-label">{compare ? 'Sans relief' : mode === 'normal' ? 'Relief par la lumière' : mode === 'geometry' ? 'Volume réel' : 'Volume + normales'}</span>
        </div>
        <div className="relief-controls">
          <fieldset disabled={controlsBusy}><legend>Zone et qualité</legend>
            {layerScoped?<div className="relief-layer-target" role="group" aria-label="Calque ciblé"><strong>{selected.current!.definition.name}</strong><p className="hint">{selected.current!.regions.length?selected.current!.regions.map(region=>region.label).join(', '):'Ce calque couvre toute la carrosserie.'}{selected.current!.exclusions.length?` · ${selected.current!.exclusions.length} exclusion(s) conservée(s)`:''}</p><p className="hint">La portée se règle dans Matières → Zones d’application. Les détails, roues et autres calques gardent leurs textures.</p></div>:<div className="relief-scope" role="group" aria-label="Zone du relief"><button type="button" aria-pressed={scope === 'hood'} onClick={() => { setScope('hood'); setCompare(false); }}>Capot</button><button type="button" aria-pressed={scope === 'vehicle'} onClick={() => { setScope('vehicle'); setCompare(false); }}>Toute la voiture</button></div>}
            <label className="relief-quality">Résolution des textures<select aria-label="Résolution des textures du relief" value={textureResolution} onChange={event => setTextureResolution(Number(event.target.value) as TextureQuality)}><option value={1024}>1K · légère</option><option value={2048}>2K · équilibrée</option><option value={4096}>4K · détaillée</option></select></label>
            <p className="hint">Les images originales jusqu’à 4K sont conservées. Changer de qualité recalcule les textures depuis ces sources.</p>
            {textureResolution === 4096 && <p className="hint">Export : couleur carrosserie en 4K, autres couleurs et normales jusqu’à 2K. Les finitions et normales secondaires peuvent passer en 1K pour tenir le budget.</p>}
            <p className="hint">Budget prudent de {RELIEF_GAME_ZIP_LIMIT_BYTES / 1_000_000} Mo pour l’envoi au jeu. Les résolutions secondaires s’adaptent à la taille réelle du ZIP.</p>
          </fieldset>
          <fieldset disabled={controlsBusy}><legend>Source du relief</legend>
            <div className="relief-source-name"><Icon name={source.kind === 'demo' || source.kind === 'carbon' ? 'sparkles' : 'image'} size={16} /><div><strong>{source.name}</strong><span>{source.kind === 'selected' ? 'Matériau sélectionné · copie temporaire' : source.kind === 'carbon' ? 'Tissage intégré · hauteur et normales' : source.kind === 'imported' ? `Pack importé · ${scope === 'hood' ? 'capot uniquement' : 'carrosserie, détails et roues'}` : 'Motif de test · bosses et creux'}</span></div></div>
            {!layerScoped&&<><div className="relief-source-buttons"><button type="button" className="btn btn-sm" disabled={!selected.current} aria-pressed={source.kind === 'selected'} onClick={() => {
              if (!selected.current) return; setSource(value => ({ kind: 'selected', layer: structuredClone(selected.current), name: selected.current!.definition.name, serial: value.serial + 1 }));
              setMode(materialHasHeight(selected.current.definition) ? 'geometry' : 'normal'); setCompare(false); setNotices([]);
            }}>Matériau sélectionné</button><button type="button" className="btn btn-sm" aria-pressed={source.kind === 'demo'} onClick={() => { setSource(value => ({ kind: 'demo', layer: null, name: 'Motif de démonstration', serial: value.serial + 1 })); setMode('geometry'); setCompare(false); setNotices([]); }}>Motif démo</button></div>
            <button type="button" className="btn btn-full" aria-pressed={source.kind === 'carbon'} onClick={() => {
              setSource(value => ({ kind: 'carbon', layer: { definition: createMaterialDefinition('carbon'), family: 'skin', regions: [], exclusions: [] }, name: 'Carbone tissé', serial: value.serial + 1 }));
              setMode('geometry'); setStrengthMm(.5); setExaggerated(false); setCompare(false); setNotices([]);
            }}><Icon name="sparkles" size={14} />Carbone tissé</button>
            <button type="button" className="btn btn-full" onClick={() => fileInput.current?.click()}><Icon name="upload" size={14} />Importer un pack ou des images</button>
            <details className="relief-import-notices"><summary>Diagnostic géométrique</summary><button type="button" className="btn btn-full" aria-pressed={source.kind === 'diagnostic'} onClick={() => {
              setSource(value => ({ kind: 'diagnostic', layer: null, name: 'Test géométrique gris', serial: value.serial + 1 }));
              setScope('hood'); setTextureResolution(1024); setMode('geometry'); setStrengthMm(80); setExaggerated(true); setCompare(false); setNotices([]);
            }}><Icon name="box" size={14} />Test géométrique gris</button></details></>}
            <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,.exr,.zip" aria-label="Importer des textures pour le relief" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void importFiles(files); }} />
              <p className="hint">{layerScoped?'Hauteur et placement du calque sélectionné. Ses images se modifient dans Matières → Textures.':'ZIP Blender, PNG, JPG, WebP ou EXR · aucun logiciel à installer. Le placement du matériau est conservé.'}</p>
            {source.kind === 'diagnostic' && <p className="relief-note">Carrosserie grise, sans image ni normales Skin. Les grosses bosses permettent de vérifier le modèle en jeu. Exportez aussi la comparaison sans relief.</p>}
            {proceduralRelief && <p className="hint">Le volume est discret à 0,5 mm. Les fibres fines peuvent rester plus petites que la surface densifiée ; augmentez la taille du motif pour mieux voir le tissage.</p>}
            {source.layer && !layerScoped&&<SliderField label="Taille du motif" value={source.layer.definition.transform.size} min={64} max={2048} step={32} format={value => `${value} px`} onChange={size => setSource(value => ({ ...value, serial: value.serial + 1, layer: { ...value.layer!, definition: { ...value.layer!.definition, transform: { ...value.layer!.definition.transform, size } } } }))} />}
          </fieldset>
          <fieldset disabled={controlsBusy}><legend>Type de relief</legend>
            <div className="relief-mode" role="group" aria-label="Type de relief">
              {([['normal', 'Normales'], ['geometry', 'Volume'], ['combined', 'Les deux']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={source.kind === 'diagnostic' ? value !== 'geometry' : !hasHeight && value !== 'normal'} onClick={() => { setMode(value); setCompare(false); }}>{label}</button>)}
            </div>
            <p className="hint">{mode === 'normal' ? 'La lumière révèle les détails ; la silhouette reste identique.' : mode === 'geometry' ? `La carte de hauteur déforme réellement ${scope === 'hood' ? 'les sommets du capot' : 'la carrosserie fixe'}.` : 'La hauteur crée le volume, les normales ajoutent les détails fins.'}</p>
            {mode !== 'geometry' && <p className="relief-note">Les normales de carrosserie restent expérimentales. Le carbone testé révèle son relief dans le garage, mais peu en course, même avec le ZIP local. Le volume géométrique a été confirmé en course.</p>}
              {scope === 'vehicle' && <p className="hint">{preserveMaterialMask?'Le volume est limité au masque du calque, avec ses exclusions et son opacité.':'Le motif et la finition couvrent toute la voiture.'} Le volume déforme les panneaux fixes de carrosserie. Les roues, pièces de détail et éléments articulés gardent leur forme ; le relief s’atténue près des raccords.</p>}
            {source.layer && hasHeight && <button type="button" className="btn btn-full" onClick={() => {
              setMode('geometry'); setStrengthMm(20); setExaggerated(false); setCompare(false);
            }}>Relief marqué · 20 mm</button>}
            <details className="relief-import-notices"><summary>Amplitude extrême</summary><button type="button" className="btn btn-full" aria-pressed={exaggerated} disabled={!hasHeight} onClick={() => {
              setExaggerated(value => !value); if (exaggerated) setStrengthMm(value => Math.min(value, 30)); setCompare(false);
            }}>Amplifier pour le test · jusqu’à 8 cm</button></details>
            {exaggerated && <p className="relief-note">Test volontairement exagéré. Les grosses déformations peuvent se croiser ; comparez la silhouette de profil dans le jeu.</p>}
            <SliderField label="Amplitude du volume" value={strengthMm} min={0} max={exaggerated ? 80 : 30} step={exaggerated ? 1 : .25} disabled={!hasHeight || mode === 'normal' && hasNormal} format={value => `${value.toFixed(2).replace(/\.00$/, '')} mm`} title={`Déplacement maximal dans chaque sens : bosses et creux. Limite ${exaggerated ? '80 mm pour le diagnostic' : '30 mm'}.`} onChange={setStrengthMm} />
            {!hasHeight && <p className="relief-note">Ce matériau contient des normales. Réimportez son ZIP avec une carte de hauteur pour essayer le volume réel.</p>}
            {source.layer && hasNormal && <SliderField label="Intensité des normales" value={source.layer.definition.normalStrength} min={0} max={2} step={.05} disabled={mode === 'geometry'} format={value => `${value.toFixed(2)}×`} onChange={normalStrength => setSource(value => ({ ...value, serial: value.serial + 1, layer: { ...value.layer!, definition: { ...value.layer!.definition, normalStrength } } }))} />}
            <button type="button" className={`btn btn-full${compare ? ' is-active' : ''}`} aria-pressed={compare} disabled={building} onClick={() => setCompare(value => !value)}><Icon name="eye" size={14} />{compare ? 'Revenir au relief' : 'Comparer sans relief'}</button>
          </fieldset>
          {stats && <p className="relief-stats">{stats.affectedVertices.toLocaleString('fr-FR')} sommets déplacés · {stats.maxDisplacementMm.toFixed(2)} mm réellement obtenus au maximum</p>}
          {notices.length > 0 && <details className="relief-import-notices"><summary>Détails de l’import</summary><ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></details>}
        </div>
      </div>
      <footer className="relief-footer"><div><p className="relief-experimental"><Icon name="info" size={14} />Surface densifiée · cartes de hauteur PNG jusqu’à 16 bits</p><p className="hint">Volume confirmé en course sur PC avec le ZIP local. Distribution via les Clubs à vérifier.</p><p className={`relief-status${error ? ' relief-status--error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">{error || (importing ? 'Import des textures…' : exporting ? 'Préparation du skin…' : status)}</p></div><div className="relief-actions"><button type="button" className="btn" disabled={exportDisabled} onClick={() => void exportPrototype()}><Icon name="download" size={15} />{compare ? 'Exporter sans relief' : 'Exporter le skin'}</button>{onApply && <button type="button" className="btn btn-primary" disabled={exportDisabled || compare || source.kind === 'diagnostic'} onClick={() => void applyRelief()}><Icon name="check" size={15} />Appliquer au projet</button>}</div></footer>
    </div>
  </div>;
}
