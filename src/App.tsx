import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FabricObject, IText, Line } from 'fabric';
import {
  EditorCore,
  type HistoryCheckpoint,
  type LayerInfo,
  type MapCopyMode,
  type Tool,
  type Transform,
} from './editor/EditorCore';
import { CarPreview, type PaintFamily } from './three/CarPreview';
import {
  COPY_COMPATIBLE_TARGETS,
  ILLUM_ROLES,
  MAPS,
  MAP_BY_ID,
  REGIONS_BY_FAMILY,
  resolvePaintMap,
  isDirtMask,
  type IllumRole,
  type MapDef,
  type MapId,
  type MapKind,
} from './maps';
import { exportSkinZip, formatImportError, importSkinZip, rgbaToCanvas } from './skinZip';
import type { Skin3DProject } from './skin3d';
import RandomModal from './RandomModal';
import UvGuideOverlay from './UvGuideOverlay';
import { UV_GUIDE_BY_FAMILY } from './uvGuideData';
import { generateSkin, type GenerationSummary, type GeneratorOptions } from './generator';
import { loadRandomPrefs, saveRandomPrefs } from './randomPrefs';
import { decodeSurfaceMaterial, encodeScalarMap, encodeSurfaceMaterial, SURFACE_PRESETS } from './material';
import { Icon, type IconName } from './ui/Icon';
import { IconButton, Row, Section, SliderField, Swatch, Toggle } from './ui/controls';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { imageIslandAt } from './editor/imagePlacement';
import type { DecalProjection } from './three/decalProjection';
import type { SurfaceMaterial } from './material';
import ProjectLibrary from './ProjectLibrary';
import './projectLibrary.css';
import { hydrateProject, projectError, projectLayerCount, readProjectFile, writeProjectFile, type ProjectBundle, type ProjectWorkspace } from './projectFile';
import { getProject, lastProjectId, putProject, rememberProject, type LocalProject } from './projectStore';

// ----------------------------------------------------------------- constantes

/** Subdivisions proposées pour la grille / le magnétisme (nombre de cases par côté). */
const GRID_DIVS = [4, 8, 16, 32, 64, 128];

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; hint: string }[] = [
  { id: 'select', label: 'Sélection', icon: 'select', key: 'V', hint: 'Déplacer, redimensionner, pivoter' },
  { id: 'draw', label: 'Pinceau', icon: 'brush', key: 'B', hint: 'Dessin libre · [ ] ou Ctrl+molette pour la taille' },
  { id: 'rect', label: 'Rectangle', icon: 'square', key: 'R', hint: 'Glisser pour tracer' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', key: 'E', hint: 'Glisser pour tracer' },
  { id: 'line', label: 'Ligne', icon: 'line', key: 'L', hint: 'Glisser pour tracer · Maj = angles à 45°' },
  { id: 'polygon', label: 'Polygone', icon: 'hexagon', key: 'P', hint: 'Polygone ou étoile' },
  { id: 'text', label: 'Texte', icon: 'type', key: 'T', hint: 'Cliquer pour placer' },
  { id: 'eyedropper', label: 'Pipette', icon: 'pipette', key: 'I', hint: 'Prélever une couleur sur la texture' },
];

const FONTS = [
  'Arial Black, sans-serif',
  'Arial, sans-serif',
  'Impact, sans-serif',
  'Georgia, serif',
  'Courier New, monospace',
  'Verdana, sans-serif',
  'Comic Sans MS, cursive',
];

type Family = MapDef['group'];
type View = '2d' | 'split' | '3d';
type ImagePlacement = { file: File; mode: 'projection' | 'uv'; material: boolean; channel: 'basecolor' | 'illum' } | { mapId: MapId; layerId: string };

const FAMILY_LABELS: Record<Family, string> = {
  skin: 'Carrosserie',
  details: 'Détails',
  wheels: 'Roues',
};

/** Libellé court du canal, affiché dans la barre des textures sous la famille. */
const CHANNEL_LABELS: Record<MapId, string> = {
  Skin_B: 'Couleur',
  Skin_R: 'Matière',
  Skin_CoatR: 'Vernis',
  Skin_DirtMask: 'Saleté',
  Details_B: 'Couleur',
  Details_R: 'Matière',
  Details_I: 'Néon / feux',
  Details_DirtMask: 'Saleté',
  Skin_I: 'Néon / feux',
  Wheels_I: 'Néon / feux',
  Wheels_B: 'Couleur',
  Wheels_R: 'Matière',
  Wheels_DirtMask: 'Saleté',
};

const LAYER_ICONS: Record<string, IconName> = {
  rect: 'square',
  ellipse: 'circle',
  circle: 'circle',
  line: 'line',
  polygon: 'hexagon',
  path: 'brush',
  'i-text': 'type',
  text: 'type',
  image: 'image',
  group: 'layers',
};

const pct = (v: number) => `${Math.round((v / 255) * 100)} %`;

interface SelectionState {
  type: string;
  name: string;
  paintColor: string;
  paintMixed: boolean;
  paintEditable: boolean;
  lightRole: IllumRole | 'mixed';
  fill: string;
  noFill: boolean;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  hasShadow: boolean;
  fontSize?: number;
  fontFamily?: string;
  text?: string;
  projection: DecalProjection | null;
  imageMaterial: { enabled: boolean; value: SurfaceMaterial } | null;
  imageLight: ReturnType<EditorCore['getSelectionImageLight']>;
}

/** Vrai si une valeur de remplissage fabric correspond à « sans remplissage ». */
function isNoFill(fill: unknown): boolean {
  if (fill == null || fill === '') return true;
  if (typeof fill !== 'string') return false;
  const f = fill.trim().toLowerCase();
  return f === 'transparent' || f === 'rgba(0,0,0,0)' || f === 'rgba(0, 0, 0, 0)';
}

const SELECTION_TYPE_LABELS: Record<string, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  circle: 'Cercle',
  line: 'Ligne',
  polygon: 'Polygone',
  path: 'Trait',
  'i-text': 'Texte',
  text: 'Texte',
  image: 'Image',
  group: 'Groupe',
  activeselection: 'Sélection multiple',
};

export default function App() {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const brushPreviewRef = useRef<HTMLDivElement>(null);
  const brushPointerRef = useRef<{ x: number; y: number } | null>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const preview3dHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorCore | null>(null);
  const previewRef = useRef<CarPreview | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [activeMap, setActiveMapState] = useState<MapId>('Skin_B');
  const [tool, setToolState] = useState<Tool>('select');
  const [brushColor, setBrushColor] = useState('#ff3838');
  const [brushSize, setBrushSize] = useState(18);
  const [brushSmoothing, setBrushSmoothing] = useState(0.35);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [overlayTransform, setOverlayTransform] = useState('matrix(1, 0, 0, 1, 0, 0)');
  const [fillColor, setFillColor] = useState('#2f7df6');
  const [fillEnabled, setFillEnabled] = useState(true);
  const [fillAlpha, setFillAlpha] = useState(1);
  const [strokeColor, setStrokeColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [strokeDashed, setStrokeDashed] = useState(false);
  const [polygonSides, setPolygonSides] = useState(6);
  const [polygonStar, setPolygonStar] = useState(false);
  /** Dernière couleur de remplissage non transparente (pour rebasculer un objet). */
  const [lastFill, setLastFill] = useState('#2f7df6');
  const toolPaintByKindRef = useRef<Record<MapKind, { brush: string; fill: string; stroke: string }>>({
    basecolor: { brush: '#ff3838', fill: '#2f7df6', stroke: '#ffffff' },
    roughmetal: { brush: '#6e0000', fill: '#6e0000', stroke: '#6e0000' },
    grayscale: { brush: '#ffffff', fill: '#ffffff', stroke: '#ffffff' },
    illum: { brush: '#00d4ff', fill: '#00d4ff', stroke: '#00d4ff' },
  });
  const [bgColor, setBgColor] = useState(MAP_BY_ID.Skin_B.defaultFill);
  const [showGuide, setShowGuide] = useState(true);
  const [surfaceView, setSurfaceView] = useState<'roughness' | 'metalness' | 'data'>('roughness');
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [dirtyMaps, setDirtyMaps] = useState<Partial<Record<MapId, boolean>>>({});
  const [skinName, setSkinName] = useState('MonSkin');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryOpenRef = useRef(false); libraryOpenRef.current = libraryOpen;
  const busyRef = useRef(false);
  const projectRestoringRef = useRef(false);
  const [projectContent, setProjectContent] = useState<string[]>([]);
  const [savedContent, setSavedContent] = useState<string[]>([]);
  const [savedMetadata, setSavedMetadata] = useState<string | null>(null);
  const saveProjectRef = useRef<() => Promise<void>>(async () => {});
  const openProjectRef = useRef<(project: LocalProject) => Promise<void>>(async () => {});
  const startupProjectRef = useRef(false);
  /** Mesh compilé importé (preview.glb + MainBody.Mesh.gbx). Null = voiture officielle. */
  const [skin3d, setSkin3d] = useState<Skin3DProject | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  busyRef.current = !!busy;
  const [toast, setToast] = useState<string | null>(null);
  const [showRandom, setShowRandom] = useState(false);
  /** Dernière configuration du générateur (mémorisée entre ouvertures et rechargements). */
  const [randomOpts, setRandomOpts] = useState<GeneratorOptions>(() => loadRandomPrefs());
  const [generating, setGenerating] = useState(false);
  /** Hôte de l'aperçu 3D dans la modale de génération (prioritaire sur `view`). */
  const randomPreviewHostRef = useRef<HTMLDivElement>(null);
  /** État de l'éditeur à l'ouverture de la modale, pour « Annuler » / « Conserver ». */
  const randomCheckpointRef = useRef<HistoryCheckpoint | null>(null);
  const showRandomRef = useRef(false);
  showRandomRef.current = showRandom;
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<MapId[]>([]);
  const [copyMode, setCopyMode] = useState<MapCopyMode>('replace');
  const [clearRequested, setClearRequested] = useState<MapId | null>(null);
  const [quickRegionKey, setQuickRegionKey] = useState('');
  const [illumRole, setIllumRole] = useState<IllumRole>('always');
  const [newLightRole, setNewLightRole] = useState<IllumRole>('always');
  const [night, setNight] = useState(false);
  const [speedColor, setSpeedColor] = useState('#ffffff');
  const [coatIntensity, setCoatIntensity] = useState(1);
  const [neonIntensity, setNeonIntensity] = useState(1.4);
  const [braking, setBraking] = useState(false);
  const [dirtEnabled, setDirtEnabled] = useState(true);
  const [dirtPreview, setDirtPreview] = useState(0);
  const projectMetadata = JSON.stringify([skinName, coatIntensity, neonIntensity, !!skin3d, dirtEnabled]);
  const projectModified = savedMetadata === null || projectMetadata !== savedMetadata || projectContent.length !== savedContent.length || projectContent.some((snapshot, index) => snapshot !== savedContent[index]);
  /** Vue : éditeur 2D, 2D + 3D côte à côte, ou 3D plein cadre. */
  const [view, setView] = useState<View>('3d');
  const chooseToolRef = useRef<(tool: Tool) => void>(() => {});
  const currentPaintRef = useRef({ brush: brushColor, fill: fillColor, stroke: strokeColor });
  currentPaintRef.current = { brush: brushColor, fill: fillColor, stroke: strokeColor };
  const [explore3D, setExplore3D] = useState(false);
  const [imagePlacement, setImagePlacement] = useState<ImagePlacement | null>(null);
  const [placingImage, setPlacingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imagePlacementRef = useRef<ImagePlacement | null>(null);
  const placingImageRef = useRef(false);
  imagePlacementRef.current = imagePlacement;
  /** Onglet de l'inspecteur (panneau droit). */
  const [inspectorTab, setInspectorTab] = useState<'texture' | 'props' | 'layers'>('props');
  /** Dernier canal visité par famille, pour y revenir en changeant de famille. */
  const lastMapByFamily = useRef<Record<Family, MapId>>({
    skin: 'Skin_B',
    details: 'Details_B',
    wheels: 'Wheels_B',
  });

  // ---- Outils de précision ----
  const [symmetry, setSymmetry] = useState(false);
  const [clipIsland, setClipIsland] = useState<string | null>(null);
  /** Pièce carrosserie isolée pour l'édition (zoom + clip + guide). */
  const [focusedRegion, setFocusedRegion] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [gridDiv, setGridDiv] = useState(16);
  const [transform, setTransformState] = useState<Transform | null>(null);
  const [centerTarget, setCenterTarget] = useState<string>('');
  /** Aligner les décalques/numéros sur la voiture (orientation de la pièce), pas sur le canvas. */
  const [carAligned, setCarAligned] = useState(true);
  const [keepImageRatio, setKeepImageRatio] = useState(true);
  const [refOpacity, setRefOpacity] = useState(0.5);
  const [hasRef, setHasRef] = useState(false);

  // Refs lues par le gestionnaire de peinture 3D (évite les closures périmées).
  const activeMapRef = useRef(activeMap);
  const toolRef = useRef(tool);
  const brushColorRef = useRef(brushColor);
  const brushSizeRef = useRef(brushSize);
  const strokeMapRef = useRef<MapId | null>(null);
  activeMapRef.current = activeMap;
  toolRef.current = tool;
  brushColorRef.current = brushColor;
  brushSizeRef.current = brushSize;

  /** Stable : lit tool/couleur/taille via refs pour ne pas recréer EditorCore. */
  const syncBrushPreview = useCallback((clientX?: number, clientY?: number) => {
    const preview = brushPreviewRef.current;
    const ed = editorRef.current;
    if (!preview || !ed || toolRef.current !== 'draw') {
      if (preview) preview.style.display = 'none';
      return;
    }
    const ptr = clientX != null && clientY != null ? { x: clientX, y: clientY } : brushPointerRef.current;
    if (!ptr) {
      preview.style.display = 'none';
      return;
    }
    const info = ed.getBrushPreviewAtClient(ptr.x, ptr.y, ed.brushSize);
    if (!info) {
      preview.style.display = 'none';
      return;
    }
    preview.style.display = 'block';
    preview.style.left = `${info.x}px`;
    preview.style.top = `${info.y}px`;
    preview.style.width = `${Math.max(info.diameter, 2)}px`;
    preview.style.height = `${Math.max(info.diameter, 2)}px`;
    preview.style.borderColor = ed.brushColor;
  }, []);

  const toastTimerRef = useRef(0);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    // Un toast précédent encore affiché ne doit pas effacer le nouveau avant l'heure.
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const readSelection = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const obj = ed.getSelection();
    if (!obj) {
      previewRef.current?.setProjectionGuide(null);
      setSelection(null);
      setTransformState(null);
      return;
    }
    setTransformState(ed.getTransform());
    previewRef.current?.setProjectionGuide(ed.getSelectionProjection());
    const anyObj = obj as FabricObject & Partial<IText> & Partial<Line>;
    const paint = ed.getSelectionPaint();
    const dash = (obj as FabricObject & { strokeDashArray?: number[] | null })
      .strokeDashArray;
    setSelection({
      type: obj.type,
      name: (obj as FabricObject & { name?: string }).name ?? '',
      paintColor: paint?.color ?? '#000000',
      paintMixed: paint?.mixed ?? false,
      paintEditable: paint?.editable ?? false,
      lightRole: ed.getSelectionIllumRole(),
      fill: obj.type === 'group' ? paint?.color ?? '#000000' : typeof obj.fill === 'string' ? obj.fill : '#000000',
      noFill: isNoFill(obj.type === 'group' ? paint?.color : obj.fill),
      opacity: obj.opacity ?? 1,
      stroke: typeof obj.stroke === 'string' ? obj.stroke : '#ffffff',
      strokeWidth: obj.strokeWidth ?? 0,
      dashed: Array.isArray(dash) && dash.length > 0,
      hasShadow: !!obj.shadow,
      fontSize: anyObj.fontSize != null ? Math.round(anyObj.fontSize) : undefined,
      fontFamily: anyObj.fontFamily,
      text: anyObj.text,
      projection: ed.getSelectionProjection(),
      imageMaterial: ed.getSelectionImageMaterial(),
      imageLight: ed.getSelectionImageLight(),
    });
  }, []);

  // ------------------------------------------------------------ init / teardown

  useEffect(() => {
    const host = editorHostRef.current!;
    const frame = canvasFrameRef.current!;
    const previewHost = previewHostRef.current!;
    const ed = new EditorCore(host, frame);
    const pv = new CarPreview(previewHost);
    editorRef.current = ed;
    previewRef.current = pv;
    ed.projectionBaker = (decal, source) => pv.projectImage(decal, source);
    pv.onModelReady = () => ed.rebuildProjectionsForModel();

    const pushTextures = () => {
      for (const def of MAPS) {
        pv.setMapCanvas(def.id, ed.getCanvasElement(def.id), def.kind === 'illum' ? ed.getIllumRoleCanvas(def.id) : undefined);
      }
    };
    const offTexture = ed.on('texture', pushTextures);
    const offLayers = ed.on('layers', () => {
      setLayers(ed.getLayers());
      setHasRef(ed.hasReference());
      setRefOpacity(ed.getReferenceOpacity());
    });
    const offSel = ed.on('selection', () => {
      if (ed.activeMap !== activeMapRef.current) {
        const next = ed.activeMap;
        const before = MAP_BY_ID[activeMapRef.current].kind; const after = MAP_BY_ID[next].kind;
        if (before !== after) {
          toolPaintByKindRef.current[before] = currentPaintRef.current;
          const paint = toolPaintByKindRef.current[after];
          setBrushColor(paint.brush); setFillColor(paint.fill); setStrokeColor(paint.stroke);
          ed.fillColor = paint.fill; ed.strokeColor = paint.stroke; ed.setBrush(paint.brush, brushSizeRef.current);
        }
        activeMapRef.current = next; setActiveMapState(next); setBgColor(ed.getBackgroundColor());
        lastMapByFamily.current[MAP_BY_ID[next].group] = next;
      }
      const pending = imagePlacementRef.current;
      if (pending && 'mapId' in pending && !placingImageRef.current &&
        (ed.getSelection() as (FabricObject & { id?: string }) | undefined)?.id !== pending.layerId) setImagePlacement(null);
      readSelection();
      // Le noyau peut changer d'outil seul (retour à Sélection après un tracé) :
      // le rail et la barre d'options doivent suivre, ainsi que le surlignage des calques.
      setToolState(ed.tool);
      setLayers(ed.getLayers());
      setInspectorTab((previous) => previous === 'layers' ? previous : ed.tool !== 'select' || ed.getSelection() ? 'props' : 'texture');
    });

    // Pipette : prélève une couleur du canvas vers le remplissage + le pinceau.
    ed.pickHandler = (hex: string) => {
      setFillColor(hex);
      setLastFill(hex);
      setFillEnabled(true);
      ed.fillColor = hex;
      ed.fillEnabled = true;
      setBrushColor(hex);
      ed.setBrush(hex, ed.brushSize);
      const kind = MAP_BY_ID[activeMapRef.current].kind;
      const material = decodeSurfaceMaterial(hex);
      notify(kind === 'roughmetal' ? `Matière prélevée : rugosité ${pct(material.roughness)}, métal ${pct(material.metalness)}.` : kind === 'grayscale' ? `Valeur prélevée : ${pct(material.roughness)}.` : `Couleur prélevée : ${hex.toUpperCase()}`);
    };
    const offSpeed = ed.on('speed-color', () => setSpeedColor(ed.getSpeedLightColor()));
    const offHist = ed.on('history', () => {
      if (!projectRestoringRef.current) setProjectContent(ed.getProjectContentState());
      setHistoryState({ undo: ed.canUndo(), redo: ed.canRedo() });
      // Undo/redo d'un changement de fond : pastille et curseurs rugosité/métal suivent.
      setBgColor(ed.getBackgroundColor());
      setIllumRole(ed.getIllumBackgroundRole());
    });
    const syncDirty = () => setDirtyMaps(ed.getDirtyMaps());
    const offDirty = ed.on('dirty', syncDirty);
    const syncViewport = () => {
      setZoomPercent(ed.getZoomPercent());
      setOverlayTransform(ed.getViewportCssTransform());
      syncBrushPreview();
    };
    const offViewport = ed.on('viewport', syncViewport);
    const offBrush = ed.on('brush', () => {
      setBrushSize(ed.brushSize);
      syncBrushPreview();
    });
    syncViewport();

    ed.setBrushSmoothing(brushSmoothing);

    // ---- Peinture directe sur la 3D ----
    const resolveTarget = (family: PaintFamily) => resolvePaintMap(activeMapRef.current, family);
    const uvToXY = (mapId: MapId, u: number, v: number) => {
      const res = MAP_BY_ID[mapId].workRes;
      return { x: u * res, y: (1 - v) * res };
    };
    pv.setPaintHandler({
      begin: (family, u, v) => {
        const target = resolveTarget(family);
        if (!target) {
          strokeMapRef.current = null;
          notify('Ce canal n’existe pas sur cette partie de la voiture. Choisissez Couleur ou Matière.');
          return;
        }
        if (target !== activeMapRef.current) {
          ed.setActiveMap(target);
          activeMapRef.current = target;
          setActiveMapState(target);
          setBgColor(ed.getBackgroundColor());
          lastMapByFamily.current[family] = target;
        }
        strokeMapRef.current = target;
        const { x, y } = uvToXY(target, u, v);
        ed.paintBegin(target, x, y, {
          color: brushColorRef.current,
          size: brushSizeRef.current,
        });
      },
      move: (_family, u, v) => {
        const target = strokeMapRef.current;
        if (!target) return;
        const { x, y } = uvToXY(target, u, v);
        ed.paintMove(x, y);
      },
      end: () => {
        ed.paintEnd();
        strokeMapRef.current = null;
      },
    });

    const activateImageMap = (id: MapId) => {
      const currentKind = MAP_BY_ID[activeMapRef.current].kind;
      const nextKind = MAP_BY_ID[id].kind;
      if (currentKind !== nextKind) {
        toolPaintByKindRef.current[currentKind] = currentPaintRef.current;
        const paint = toolPaintByKindRef.current[nextKind];
        setBrushColor(paint.brush); setFillColor(paint.fill); setLastFill(paint.fill); setStrokeColor(paint.stroke);
        ed.fillColor = paint.fill; ed.strokeColor = paint.stroke; ed.setBrush(paint.brush, brushSizeRef.current);
        if (currentKind === 'illum') { setNight(false); pv.setNight(false); }
      }
      if (ed.activeMap !== id) ed.setActiveMap(id);
      activeMapRef.current = id;
      setActiveMapState(id);
      lastMapByFamily.current[MAP_BY_ID[id].group] = id;
      setBgColor(ed.getBackgroundColor());
      setClipIsland(null);
      ed.setClipIsland(null);
      setFocusedRegion(null);
      setCenterTarget('');
      setToolState('select');
      setInspectorTab('props');
    };
    pv.setImageHandler({
      transform: (values) => ed.setProjection(values, 'projection:gizmo'),
      transformEnd: () => ed.endHistoryCoalescing(),
      begin: (family, u, v, anchor) => {
        const current = resolveTarget(family);
        const base = resolvePaintMap('Skin_B', family)!;
        for (const target of [...new Set([current, base])]) {
          if (!target) continue;
          const { x, y } = uvToXY(target, u, v);
          if (ed.beginProjectionDrag(target, x, y, anchor)) {
            strokeMapRef.current = ed.activeMap;
            activateImageMap(ed.activeMap);
            return 'projection';
          }
          if (ed.beginImageDrag(target, x, y)) {
            strokeMapRef.current = target;
            activateImageMap(target);
            return true;
          }
        }
        notify('Aucune image ici. Ajoutez un logo ou sélectionnez une image dans Calques.');
        return false;
      },
      move: (family, u, v, anchor) => {
        if (ed.getSelectionProjection()) return ed.getSelectionProjection()!.families.includes(family) ? ed.moveProjectionDrag(anchor) : false;
        if (!strokeMapRef.current) return;
        const { x, y } = uvToXY(strokeMapRef.current, u, v);
        return ed.moveImageDrag(x, y);
      },
      end: () => { ed.endImageDrag(); strokeMapRef.current = null; },
      boundary: () => notify(ed.getSelectionProjection() ? 'Cette surface est exclue. Activez-la dans « Surfaces et profondeur » pour y déplacer le logo.' : 'Bord de la pièce atteint. Utilisez « Replacer sur la voiture » pour choisir une autre zone.'),
      place: (family, u, v, anchor) => {
        const pending = imagePlacementRef.current;
        if (!pending || placingImageRef.current) return;
        const target = 'file' in pending ? resolvePaintMap(pending.channel === 'illum' ? 'Details_I' : 'Skin_B', family) : pending.mapId;
        if (!target) { notify('La lumière de cette surface n’est pas prise en charge dans cet éditeur. Cliquez sur une surface Détails : phare ou élément du châssis.'); return; }
        const isProjection = 'file' in pending ? pending.mode === 'projection' : !!ed.getSelectionProjection();
        if (!isProjection && MAP_BY_ID[target].group !== family) {
          notify(`Cette image appartient à ${FAMILY_LABELS[MAP_BY_ID[target].group]}. Cliquez sur cette partie de la voiture.`);
          return;
        }
        const { x, y } = uvToXY(target, u, v);
        const islandKey = imageIslandAt(family, u, v);
        placingImageRef.current = true;
        setPlacingImage(true);
        void (async () => {
          try {
            if ('file' in pending) {
              if (isProjection) await ed.addProjectedImage(pending.file, target, pv.projectionAnchorFromView(anchor.point), pending.material);
              else { await ed.addImageFromFile(pending.file, { mapId: target, x, y, islandKey }); activateImageMap(target); if (pending.material) ed.setImageMaterialEnabled(true); }
            } else {
              if (ed.activeMap !== pending.mapId || (ed.getSelection() as (FabricObject & { id?: string }) | undefined)?.id !== pending.layerId) throw new Error('Sélectionnez une image déverrouillée.');
              if (isProjection && !ed.getSelectionProjection()?.families.includes(family)) throw new Error('Activez cette surface dans les options de projection avant de la choisir.');
              if (!(isProjection ? ed.placeSelectedProjection(pv.projectionAnchorFromView(anchor.point)) : ed.placeSelectedImage(x, y, islandKey))) throw new Error('Sélectionnez une image déverrouillée.');
            }
            activateImageMap(ed.activeMap);
            setImagePlacement(null);
            notify('Image placée. Glissez dessus pour la déplacer ; ajustez sa taille et sa rotation dans Élément.');
          } catch (error) {
            notify(`Image non placée : ${error instanceof Error ? error.message : 'image illisible'}`);
            setImagePlacement(null);
          } finally {
            placingImageRef.current = false;
            setPlacingImage(false);
          }
        })();
      },
    });

    pushTextures();
    setLayers(ed.getLayers());
    syncDirty();
    setReady(true);

    // Le développement ne doit pas effacer les essais dans la page ouverte à chaque mise à jour.
    const recovery = import.meta.hot?.data.editorRecovery as { checkpoint: HistoryCheckpoint; mapId: MapId; selectionId?: string; urls?: string[]; view?: ReturnType<CarPreview['getViewState']> } | undefined;
    if (recovery) {
      projectRestoringRef.current = true;
      delete import.meta.hot!.data.editorRecovery;
      if (recovery.view) pv.restoreViewState(recovery.view);
      ed.adoptObjectUrls(recovery.urls ?? []);
      void ed.restoreCheckpoint(recovery.checkpoint).then(() => {
        ed.setActiveMap(recovery.mapId);
        if (recovery.selectionId) ed.selectLayer(recovery.selectionId);
        pushTextures(); readSelection(); setLayers(ed.getLayers());
      }).finally(() => { projectRestoringRef.current = false; });
    } else readSelection();

    return () => {
      if (import.meta.hot) import.meta.hot.data.editorRecovery = { checkpoint: ed.createCheckpoint(), mapId: ed.activeMap, selectionId: (ed.getSelection() as (FabricObject & { id?: string }) | null)?.id, urls: ed.takeObjectUrls(), view: pv.getViewState() };
      offTexture();
      offLayers();
      offSel();
      offSpeed();
      offHist();
      offDirty();
      offViewport();
      offBrush();
      pv.dispose();
      ed.dispose();
      editorRef.current = null;
      previewRef.current = null;
    };
  }, [readSelection]);

  /** Cadre UV carré : taille = min(largeur, hauteur) réelle du stage. */
  const syncCanvasFit = useCallback(() => {
    const stage = canvasStageRef.current;
    if (!stage) return;
    const { width, height } = stage.getBoundingClientRect();
    const pad = 24;
    const fit = Math.max(0, Math.floor(Math.min(width - pad, height - pad)));
    if (fit > 0) stage.style.setProperty('--canvas-fit', `${fit}px`);
  }, []);

  useEffect(() => {
    const stage = canvasStageRef.current;
    if (!stage || view === '3d') return;
    syncCanvasFit();
    const ro = new ResizeObserver(() => syncCanvasFit());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [syncCanvasFit, view, focusedRegion]);

  // Rebranche le rendu 3D sur le bon conteneur : modale de génération (prioritaire),
  // sinon aperçu compact de l'inspecteur ou grande vue selon `view`.
  useEffect(() => {
    const pv = previewRef.current;
    if (!pv || !ready) return;
    const host = showRandom
      ? randomPreviewHostRef.current
      : view === '2d'
        ? previewHostRef.current
        : preview3dHostRef.current;
    if (host) requestAnimationFrame(() => pv.mount(host));
  }, [view, ready, showRandom]);

  useEffect(() => {
    previewRef.current?.setInteraction(showRandom || view === '2d' ? 'navigate' : imagePlacement ? 'place' : explore3D ? 'navigate' : tool === 'draw' ? 'paint' : tool === 'select' ? 'image' : 'navigate');
  }, [view, tool, ready, showRandom, imagePlacement, explore3D]);

  useEffect(() => {
    if (!imagePlacement || !('file' in imagePlacement)) { setImagePreview(null); return; }
    const url = URL.createObjectURL(imagePlacement.file);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imagePlacement]);

  useEffect(() => {
    if (!imagePlacement) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !placingImageRef.current) { event.preventDefault(); event.stopImmediatePropagation(); setImagePlacement(null); }
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [imagePlacement]);

  // Mémorise la configuration du générateur (survit au rechargement).
  useEffect(() => {
    saveRandomPrefs(randomOpts);
  }, [randomOpts]);

  useEffect(() => {
    if (tool !== 'draw') {
      brushPointerRef.current = null;
      syncBrushPreview();
      return;
    }
    const onMove = (e: MouseEvent) => {
      brushPointerRef.current = { x: e.clientX, y: e.clientY };
      syncBrushPreview(e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [tool, syncBrushPreview]);

  // Ferme le popover « Copier vers » au clic extérieur.
  useEffect(() => {
    if (!copyOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.popover-anchor')) setCopyOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [copyOpen]);

  // --------------------------------------------------------------- shortcuts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ed = editorRef.current;
      if (!ed) return;
      // Modale de génération ouverte : ses propres raccourcis (Échap) priment,
      // et Ctrl+Z/Suppr ne doivent pas toucher l'éditeur derrière.
      if (showRandomRef.current || libraryOpenRef.current || busyRef.current || imagePlacementRef.current || placingImageRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); void saveProjectRef.current(); return;
      }
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        target.dataset?.fabric === 'textarea'
      ) {
        return;
      }
      if (ed.isTextEditing()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        ed.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (e.shiftKey) {
          e.preventDefault();
          const targets = COPY_COMPATIBLE_TARGETS[activeMapRef.current] ?? [];
          if (!targets.length) {
            notify('Aucune map liée compatible pour cette texture.');
            return;
          }
          for (const mapId of targets) void ed.copyRenderedMapToMap(activeMapRef.current, mapId, 'replace');
          const labels = targets.map((id) => MAP_BY_ID[id].label).join(', ');
          notify(`Map dupliquée vers les maps liées : ${labels}.`);
          return;
        }
        e.preventDefault();
        ed.duplicateSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        ed.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (ed.getSelection()) {
          ed.canvas.discardActiveObject();
          ed.canvas.requestRenderAll();
          readSelection();
        }
        return;
      }
      if (ed.tool === 'draw' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'BracketLeft') {
          e.preventDefault();
          setBrushSize(ed.adjustBrushSize(-2));
          return;
        }
        if (e.code === 'BracketRight') {
          e.preventDefault();
          setBrushSize(ed.adjustBrushSize(2));
          return;
        }
      }
      if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
        e.preventDefault();
        ed.zoomIn();
        setZoomPercent(ed.getZoomPercent());
        return;
      }
      if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        ed.zoomOut();
        setZoomPercent(ed.getZoomPercent());
        return;
      }
      if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        ed.resetViewport();
        setZoomPercent(100);
        return;
      }
      const toolKeys: Record<string, Tool> = {
        v: 'select',
        b: 'draw',
        r: 'rect',
        e: 'ellipse',
        l: 'line',
        p: 'polygon',
        t: 'text',
        i: 'eyedropper',
      };
      const t = toolKeys[e.key.toLowerCase()];
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) {
        chooseToolRef.current(t);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notify, readSelection]);

  // ------------------------------------------------------------------ actions

  const setActiveMap = (id: MapId) => {
    if (placingImageRef.current) return;
    if (!placingImageRef.current) setImagePlacement(null);
    const currentKind = MAP_BY_ID[activeMap].kind;
    const nextKind = MAP_BY_ID[id].kind;
    if (currentKind === 'illum' && nextKind !== 'illum' && night) {
      setNight(false);
      previewRef.current?.setNight(false);
    }
    if (currentKind !== nextKind) {
      toolPaintByKindRef.current[currentKind] = { brush: brushColor, fill: fillColor, stroke: strokeColor };
      const paint = toolPaintByKindRef.current[nextKind];
      setBrushColor(paint.brush);
      setFillColor(paint.fill);
      setLastFill(paint.fill);
      setStrokeColor(paint.stroke);
      const editor = editorRef.current;
      if (editor) {
        editor.fillColor = paint.fill;
        editor.strokeColor = paint.stroke;
        editor.setBrush(paint.brush, brushSize);
      }
    }
    editorRef.current?.setActiveMap(id);
    setActiveMapState(id);
    if (nextKind === 'illum') setIllumRole(editorRef.current?.getIllumBackgroundRole(id) ?? 'always');
    lastMapByFamily.current[MAP_BY_ID[id].group] = id;
    setBgColor(editorRef.current?.getBackgroundColor() ?? '#000000');
    const nextGroup = MAP_BY_ID[id].group;
    const nextIslands = UV_GUIDE_BY_FAMILY[nextGroup];
    if (clipIsland && !nextIslands.some((i) => i.key === clipIsland)) {
      setClipIsland(null);
      editorRef.current?.setClipIsland(null);
    }
    if (focusedRegion && nextGroup !== 'skin') {
      setFocusedRegion(null);
      editorRef.current?.focusRegion(null, syncCanvasFit);
    } else if (focusedRegion && nextGroup === 'skin') {
      editorRef.current?.focusRegion(focusedRegion, syncCanvasFit);
    }
    if (centerTarget && !nextIslands.some((i) => i.key === centerTarget)) {
      setCenterTarget('');
    }
    setHasRef(editorRef.current?.hasReference() ?? false);
    setCopyOpen(false);
    setInspectorTab('texture');
  };

  const setFamily = (family: Family) => {
    if (MAP_BY_ID[activeMap].group === family) return;
    setActiveMap(isDirtMask(activeMap) ? resolvePaintMap(activeMap, family)! : lastMapByFamily.current[family]);
  };

  const onToggleSymmetry = () => {
    setSymmetry((v) => {
      const next = !v;
      editorRef.current?.setSymmetry(next);
      return next;
    });
  };

  const onClipIsland = (key: string | null) => {
    setClipIsland(key);
    if (MAP_BY_ID[activeMap].group === 'skin') {
      setFocusedRegion(key);
      editorRef.current?.focusRegion(key, syncCanvasFit);
    } else {
      editorRef.current?.setClipIsland(key);
    }
  };

  const onFocusRegion = (key: string | null) => {
    setFocusedRegion(key);
    setClipIsland(key);
    editorRef.current?.focusRegion(key, syncCanvasFit);
  };

  const onToggleGrid = () => {
    setShowGrid((v) => {
      const next = !v;
      editorRef.current?.setSnap(next, mapDef.workRes / gridDiv);
      return next;
    });
  };

  const onGridDiv = (d: number) => {
    setGridDiv(d);
    editorRef.current?.setSnap(showGrid, mapDef.workRes / d);
  };

  /** Champs numériques : une entrée d'historique par champ édité (pas par frappe). */
  const onTransform = (p: Partial<Transform>) => {
    editorRef.current?.setTransform(p, `transform:${Object.keys(p).join(',')}`);
    setTransformState(editorRef.current?.getTransform() ?? null);
  };

  /** Fin de geste (curseur relâché, champ quitté) : la prochaine modification ouvre une nouvelle entrée. */
  const endHistoryGesture = () => editorRef.current?.endHistoryCoalescing();

  const onCenterInIsland = () => {
    if (!centerTarget) return;
    editorRef.current?.centerSelectionInIsland(centerTarget);
    setTransformState(editorRef.current?.getTransform() ?? null);
  };

  const onToggleCarAligned = (next: boolean) => {
    setCarAligned(next);
    editorRef.current?.setCarAligned(next);
  };

  const onRefChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await editorRef.current?.addReferenceUnderlay(file);
      setRefOpacity(0.5);
      setHasRef(editorRef.current?.hasReference() ?? false);
    } catch (error) {
      notify(`Référence non chargée : ${error instanceof Error ? error.message : 'image illisible'}`);
    }
  };

  const onRefOpacity = (v: number) => {
    setRefOpacity(v);
    editorRef.current?.setReferenceOpacity(v);
  };

  const setTool = (t: Tool) => {
    if (placingImageRef.current) return;
    if (!placingImageRef.current) setImagePlacement(null);
    setExplore3D(false);
    // Les outils de formes/texte utilisent la texture ; on la rend visible au choix de l'outil.
    if (view === '3d' && t !== 'select' && t !== 'draw') setView('split');
    editorRef.current?.setTool(t);
    setToolState(t);
    setInspectorTab(t === 'select' && !editorRef.current?.getSelection() ? 'texture' : 'props');
  };
  chooseToolRef.current = setTool;

  const onBrushSmoothing = (v: number) => {
    setBrushSmoothing(v);
    editorRef.current?.setBrushSmoothing(v);
  };

  const onZoomIn = () => {
    editorRef.current?.zoomIn();
    setZoomPercent(editorRef.current?.getZoomPercent() ?? 100);
  };

  const onZoomOut = () => {
    editorRef.current?.zoomOut();
    setZoomPercent(editorRef.current?.getZoomPercent() ?? 100);
  };

  const onZoomReset = () => {
    editorRef.current?.resetViewport();
    setZoomPercent(100);
  };

  const onCanvasFrameMove = (e: React.MouseEvent) => {
    if (tool !== 'draw') {
      brushPointerRef.current = null;
      syncBrushPreview();
      return;
    }
    brushPointerRef.current = { x: e.clientX, y: e.clientY };
    syncBrushPreview(e.clientX, e.clientY);
  };

  const onCanvasFrameLeave = () => {
    brushPointerRef.current = null;
    syncBrushPreview();
  };

  const onBrushChange = (color: string, size: number) => {
    setBrushColor(color);
    setBrushSize(size);
    editorRef.current?.setBrush(color, size);
  };

  const onFillChange = (color: string) => {
    setFillColor(color);
    setLastFill(color);
    if (editorRef.current) editorRef.current.fillColor = color;
  };

  const onFillEnabled = (enabled: boolean) => {
    setFillEnabled(enabled);
    if (editorRef.current) editorRef.current.fillEnabled = enabled;
    // Sans remplissage : garantir un contour visible pour les nouvelles formes.
    if (!enabled && strokeWidth <= 0) onStrokeWidth(4);
  };

  const onFillAlpha = (a: number) => {
    setFillAlpha(a);
    if (editorRef.current) editorRef.current.fillAlpha = a;
  };

  const onStrokeColor = (color: string) => {
    setStrokeColor(color);
    if (editorRef.current) editorRef.current.strokeColor = color;
  };

  const onStrokeWidth = (w: number) => {
    setStrokeWidth(w);
    if (editorRef.current) editorRef.current.strokeWidth = w;
  };

  const onStrokeDashed = (dashed: boolean) => {
    setStrokeDashed(dashed);
    if (editorRef.current) editorRef.current.strokeDashed = dashed;
  };

  const onPolygonSides = (n: number) => {
    setPolygonSides(n);
    if (editorRef.current) editorRef.current.polygonSides = n;
  };

  const onPolygonStar = (star: boolean) => {
    setPolygonStar(star);
    if (editorRef.current) editorRef.current.polygonStar = star;
  };

  /** `coalesce` : clé de fusion d'historique pour les contrôles continus (curseurs, pastilles couleur). */
  const updateSel = (props: Record<string, unknown>, coalesce?: string) => {
    editorRef.current?.updateSelection(props, coalesce);
  };

  /** Lignes et coups de pinceau n'ont pas de remplissage : leur couleur est le trait. */
  const isStrokeColored = (type: string) => type === 'line' || type === 'path';

  /** Valeur numérique d'un champ, ou `null` si vide / invalide (on ne déplace pas l'objet à 0). */
  const numOrNull = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.valueAsNumber;
    return Number.isFinite(v) ? v : null;
  };

  /** Bascule le remplissage de l'objet sélectionné entre transparent et sa dernière couleur. */
  const onSelNoFill = (checked: boolean) => {
    if (!selection) return;
    if (checked) {
      if (selection.fill.startsWith('#')) setLastFill(selection.fill);
      const props: Record<string, unknown> = { fill: 'transparent' };
      if (selection.strokeWidth <= 0) {
        props.stroke = selection.stroke.startsWith('#') ? selection.stroke : '#ffffff';
        props.strokeWidth = 6;
      }
      updateSel(props);
    } else {
      updateSel({ fill: lastFill });
    }
  };

  /** Active/désactive le contour en pointillés de l'objet sélectionné. */
  const onSelDashed = (checked: boolean) => {
    if (!selection) return;
    const w = Math.max(selection.strokeWidth, 4);
    updateSel({ strokeDashArray: checked ? [w * 2.2, w * 1.6] : null });
  };

  /** Le sélecteur natif émet un flot de valeurs pendant le glisser : une seule entrée d'historique. */
  const onBgChange = (color: string) => {
    setBgColor(color);
    editorRef.current?.setBackgroundColor(color, 'background');
  };

  /** Écrit le fond d'une map _R : R = rugosité, G = métal. */
  const onRoughMetalChange = (rough: number, metal: number) => {
    onBgChange(encodeSurfaceMaterial({ roughness: rough, metalness: metal }));
  };

  const onRoughMetalSelectionChange = (rough: number, metal: number) => {
    if (!selection) return;
    const color = encodeSurfaceMaterial({ roughness: rough, metalness: metal });
    editorRef.current?.setSelectionMaterial(color);
  };

  const onRoughMetalToolChange = (target: 'brush' | 'fill' | 'stroke', rough: number, metal: number) => {
    const color = encodeSurfaceMaterial({ roughness: rough, metalness: metal });
    if (target === 'brush') onBrushChange(color, brushSize);
    else if (target === 'fill') onFillChange(color);
    else onStrokeColor(color);
  };

  const onApplyMaterialToAll = () => {
    const ed = editorRef.current;
    if (!ed || mapDef.kind !== 'roughmetal') return;
    const color = encodeSurfaceMaterial({ roughness: roughVal, metalness: metalVal });
    ed.applyMaterialToActiveMap(color);
    setBgColor(color);
    setInspectorTab('texture');
    notify('Finition appliquée au fond et aux formes éditables. Les calques sont conservés ; Ctrl+Z pour annuler.');
  };

  const onCoatIntensity = (v: number) => {
    setCoatIntensity(v);
    previewRef.current?.setCoatIntensity(v);
  };

  const onNeonIntensity = (v: number) => {
    setNeonIntensity(v);
    previewRef.current?.setEmissiveIntensity(v);
  };

  const onBraking = (v: boolean) => {
    setBraking(v);
    previewRef.current?.setBraking(v);
  };

  useEffect(() => {
    previewRef.current?.setDirtPreview(dirtPreview, dirtEnabled);
  }, [dirtPreview, dirtEnabled, ready]);

  const onIllumRole = (role: IllumRole) => {
    setIllumRole(role);
    editorRef.current?.setIllumBackgroundRole(role);
    setInspectorTab('texture');
  };

  const onNewLightRole = (role: IllumRole) => {
    setNewLightRole(role);
    if (editorRef.current) editorRef.current.illumToolRole = role;
  };

  const onSpeedColor = (color: string) => {
    setSpeedColor(color);
    editorRef.current?.setSpeedLightColor(color);
  };

  const onUseOfficialMesh = async () => {
    setSkin3d(null);
    try {
      await previewRef.current?.loadOfficialModel();
      notify('Aperçu : voiture officielle. L’export ne contiendra plus le mesh custom.');
    } catch (err) {
      notify(`Échec du rechargement : ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onImageChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('32 Mo maximum.');
      if (file.type && !file.type.startsWith('image/')) throw new Error('Choisissez une image PNG, JPEG, WebP ou SVG.');
      if (view !== '2d') {
        setTool('select');
        setImagePlacement({ file, mode: 'projection', material: false, channel: MAP_BY_ID[editorRef.current?.activeMap ?? 'Skin_B'].kind === 'illum' ? 'illum' : 'basecolor' });
        setInspectorTab('props');
        return;
      }
      await editorRef.current?.addImageFromFile(file);
    } catch (error) {
      notify(`Image non chargée : ${error instanceof Error ? error.message : 'image illisible'}`);
    }
  };

  const changeView = (next: View) => {
    if (placingImageRef.current) return;
    setImagePlacement(null);
    setView(next);
  };

  const onZipChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editorRef.current) return;
    setBusy('Import du skin…');
    const ed = editorRef.current;
    try {
      const result = await importSkinZip(file);
      const applied: string[] = [];
      const appliedIds: MapId[] = [];
      const applyErrors: string[] = [];
      for (const { id, image, path } of result.imported) {
        const label = MAP_BY_ID[id]?.fileName ?? path;
        try {
          const canvas = rgbaToCanvas(image);
          if (!canvas) {
            applyErrors.push(`${label} : conversion canvas impossible`);
            continue;
          }
          await ed.setBackgroundFromCanvas(id, canvas, {
            flush: false,
            recordHistory: false,
            illumination: MAP_BY_ID[id].kind === 'illum' ? image : undefined,
          });
          applied.push(label);
          appliedIds.push(id);
        } catch (err) {
          applyErrors.push(formatImportError(label, err));
        }
      }
      if (appliedIds.length) ed.commitImportState(appliedIds);
      if (applied.length) ed.flushTexture();
      if (applied.length) setBgColor(ed.getBackgroundColor());
      if (result.skin3d?.name) setSkinName(result.skin3d.name.replace(/[\\/:*?"<>|]/g, ''));
      else setSkinName(file.name.replace(/\.zip$/i, ''));
      if (result.skin3d) {
        setSkin3d(result.skin3d);
        if (result.skin3d.preview && previewRef.current) {
          try {
            await previewRef.current.loadCustomPreview(result.skin3d.preview);
          } catch (err) {
            applyErrors.push(
              `aperçu 3D : ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      if (applied.length || result.skin3d) {
        setDirtEnabled(true); setDirtPreview(0);
        previewRef.current?.setDirtPreview(0, true);
        setProjectId(null); setSavedAt(null); setSavedMetadata(null); rememberProject(null);
        const parts: string[] = [];
        if (applied.length) parts.push(`${applied.length} texture(s) importée(s)`);
        if (result.skin3d) {
          parts.push(
            result.skin3d.preview
              ? 'mesh 3D chargé'
              : 'mesh 3D chargé (aperçu officiel : preview.glb absent)',
          );
        }
        const skipped = result.skipped.length + applyErrors.length;
        if (skipped) parts.push(`${skipped} ignorée(s)`);
        notify(`${parts.join(', ')}.`);
        if (applyErrors.length) {
          notify(`Textures non appliquées : ${applyErrors.join(' ; ')}`);
        }
      } else if (result.imported.length) {
        notify(`Échec de l'import : aucune texture n'a pu être appliquée. ${applyErrors.join(' ; ')}`);
      } else {
        notify(
          result.failures.length
            ? `Aucune texture reconnue. ${result.failures.map((f) => f.reason).join(' ; ')}`
            : 'Aucune texture reconnue dans ce zip.',
        );
      }
    } catch (err) {
      notify(`Échec de l'import : ${formatImportError(file.name, err)}`);
    } finally {
      setBusy(null);
    }
  };

  const captureProjectBundle = async (): Promise<ProjectBundle> => {
    const ed = editorRef.current; const pv = previewRef.current;
    if (!ed || !pv) throw new Error('L’éditeur n’est pas encore prêt.');
    const content = await ed.captureProject();
    const assets = new Map<string, Blob | Uint8Array>(content.assets);
    const model = skin3d ? { mesh: 'assets/mesh.gbx', preview: skin3d.preview ? 'assets/preview.glb' : null, name: skin3d.name,
      passthrough: skin3d.passthrough.map((entry, index) => ({ name: entry.name, asset: `assets/extra-${index}.bin` })) } : null;
    if (skin3d) {
      assets.set('assets/mesh.gbx', skin3d.mesh);
      if (skin3d.preview) assets.set('assets/preview.glb', new Uint8Array(skin3d.preview));
      skin3d.passthrough.forEach((entry, index) => assets.set(`assets/extra-${index}.bin`, entry.data));
    }
    const workspace: ProjectWorkspace = { activeMap: ed.activeMap, view, camera: pv.getViewState(), coatIntensity, neonIntensity, night, braking, dirtEnabled, dirtPreview };
    return { document: { format: 'tm-skin-studio', version: 1, name: skinName.trim().slice(0, 120) || 'Sans titre',
      editor: { maps: content.maps, speedColor: content.speedColor, illumRole: content.illumRole }, workspace, model }, assets };
  };

  const persistProject = async (copy = false) => {
    const bundle = await captureProjectBundle(); const file = await writeProjectFile(bundle);
    const thumbnail = await new Promise<Blob>((resolve, reject) => previewRef.current!.snapshot(320).toBlob((blob) => blob ? resolve(blob) : reject(new Error('Miniature impossible à créer.')), 'image/webp', .8));
    const previous = !copy && projectId ? await getProject(projectId) : undefined;
    const now = Date.now(); const id = previous && !previous.deletedAt ? previous.id : crypto.randomUUID();
    const name = copy ? `${bundle.document.name.slice(0, 110)} — copie` : bundle.document.name;
    if (copy) { bundle.document.name = name; }
    const savedFile = copy ? await writeProjectFile(bundle) : file;
    await putProject({ id, name, file: savedFile, thumbnail, layers: projectLayerCount(bundle.document), bytes: savedFile.size + thumbnail.size,
      createdAt: previous && !previous.deletedAt ? previous.createdAt : now, updatedAt: now, deletedAt: null });
    setSkinName(name);
    setProjectId(id); setSavedAt(now);
    const content = editorRef.current!.getProjectContentState(); setProjectContent(content); setSavedContent(content);
    setSavedMetadata(JSON.stringify([name, coatIntensity, neonIntensity, !!skin3d, dirtEnabled])); rememberProject(id);
    return id;
  };

  const saveProject = async (copy = false) => {
    setBusy('Enregistrement du projet et de ses images…');
    try { await persistProject(copy); notify(copy ? 'Copie enregistrée dans Mes projets.' : 'Projet enregistré avec tous ses calques dans Mes projets.'); }
    finally { setBusy(null); }
  };
  saveProjectRef.current = async () => { try { await saveProject(); } catch (error) { notify(projectError(error)); } };

  const downloadCurrentProject = async () => {
    setBusy('Préparation du fichier projet…');
    try {
      const file = await writeProjectFile(await captureProjectBundle());
      return { file, name: skinName.trim() || 'skin' };
    } finally { setBusy(null); }
  };

  const loadProjectBundle = async (bundle: ProjectBundle, saved?: LocalProject) => {
    const ed = editorRef.current; const pv = previewRef.current;
    if (!ed || !pv) throw new Error('L’éditeur n’est pas encore prêt.');
    const checkpoint = ed.createCheckpoint(); const previousModel = skin3d;
    const hydrated = hydrateProject(bundle);
    setBusy('Ouverture du projet et de tous ses calques…'); projectRestoringRef.current = true;
    try {
      await ed.loadProject(hydrated.document.editor.maps, hydrated.document.editor);
      if (hydrated.model?.preview) await pv.loadCustomPreview(hydrated.model.preview);
      else await pv.loadOfficialModel();
      const document = hydrated.document; const workspace = document.workspace;
      for (const url of ed.takeObjectUrls()) URL.revokeObjectURL(url);
      ed.adoptObjectUrls(hydrated.urls);
      ed.setClipIsland(null); ed.setTool('select'); ed.setActiveMap(workspace.activeMap);
      activeMapRef.current = ed.activeMap; setActiveMapState(ed.activeMap); setToolState('select');
      setClipIsland(null); setFocusedRegion(null); setImagePlacement(null); setInspectorTab('layers');
      setSkin3d(hydrated.model); setSkinName(saved?.name ?? document.name); setView(workspace.view); setExplore3D(true);
      setCoatIntensity(workspace.coatIntensity); setNeonIntensity(workspace.neonIntensity); setNight(workspace.night); setBraking(workspace.braking);
      pv.setCoatIntensity(workspace.coatIntensity); pv.setEmissiveIntensity(workspace.neonIntensity); pv.setNight(workspace.night); pv.setBraking(workspace.braking);
      setDirtEnabled(workspace.dirtEnabled ?? true); setDirtPreview(workspace.dirtPreview ?? 0);
      pv.setDirtPreview(workspace.dirtPreview ?? 0, workspace.dirtEnabled ?? true);
      pv.setIllumRole(document.editor.illumRole);
      setIllumRole(ed.getIllumBackgroundRole(ed.activeMap)); setSpeedColor(document.editor.speedColor);
      pv.restoreViewState(workspace.camera); setBgColor(ed.getBackgroundColor()); setLayers(ed.getLayers()); readSelection();
      setProjectId(saved?.id ?? null); setSavedAt(saved?.updatedAt ?? null);
      const content = ed.getProjectContentState(); setProjectContent(content); setSavedContent(content);
      setSavedMetadata(saved ? JSON.stringify([saved.name, workspace.coatIntensity, workspace.neonIntensity, !!hydrated.model, workspace.dirtEnabled ?? true]) : null);
      rememberProject(saved?.id ?? null); setLibraryOpen(false);
      notify(saved ? 'Projet rouvert : chaque calque reste modifiable.' : 'Fichier projet ouvert. Enregistrez-le pour l’ajouter à Mes projets.');
    } catch (error) {
      try {
        await ed.restoreCheckpoint(checkpoint);
        if (previousModel?.preview) await pv.loadCustomPreview(previousModel.preview); else await pv.loadOfficialModel();
      } finally { for (const url of hydrated.urls) URL.revokeObjectURL(url); }
      throw error;
    } finally { projectRestoringRef.current = false; setBusy(null); }
  };
  const openSavedProject = async (project: LocalProject) => { const bundle = await readProjectFile(project.file); await loadProjectBundle(bundle, project); };
  openProjectRef.current = openSavedProject;
  const importProjectFile = async (file: File) => { const bundle = await readProjectFile(file); await loadProjectBundle(bundle); };
  useEffect(() => {
    if (!ready || startupProjectRef.current) return;
    startupProjectRef.current = true;
    const id = lastProjectId(); if (!id) return;
    void getProject(id).then(async (project) => { if (project && !project.deletedAt) await openProjectRef.current(project); else rememberProject(null); }).catch((error) => notify(projectError(error)));
  }, [ready, notify]);

  const compatibleTargets = useMemo(() => COPY_COMPATIBLE_TARGETS[activeMap] ?? [], [activeMap]);

  useEffect(() => {
    setCopyTargets(compatibleTargets);
    setCopyMode('replace');
  }, [compatibleTargets]);

  const onToggleCopyTarget = (target: MapId, checked: boolean) => {
    setCopyTargets((prev) => {
      if (checked) {
        if (prev.includes(target)) return prev;
        return [...prev, target];
      }
      return prev.filter((id) => id !== target);
    });
  };

  const runCopyToTargets = async (targets: MapId[], mode: MapCopyMode) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (!targets.length) {
      notify('Sélectionnez au moins une texture de destination.');
      return;
    }
    try {
      for (const target of targets) {
        await ed.copyRenderedMapToMap(activeMap, target, mode);
      }
      const labels = targets.map((id) => MAP_BY_ID[id].label).join(', ');
      const modeLabel = mode === 'overlay' ? 'superposition' : 'remplacement';
      notify(`Copie appliquée (${modeLabel}) vers : ${labels}.`);
      setCopyOpen(false);
    } catch (err) {
      notify(`Échec de la copie : ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onExport = async () => {
    const ed = editorRef.current;
    const pv = previewRef.current;
    if (!ed || !pv) return;
    setBusy('Enregistrement local puis export pour Trackmania…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      let saveError = '';
      try { await persistProject(); } catch (error) { saveError = projectError(error); }
      setBusy('Encodage DDS + création du zip…');
      ed.flushTexture();
      const blob = await exportSkinZip(skinName, {
        dirtEnabled,
        getMapCanvas: (id) => ed.getCanvasElement(id),
        illumRole,
        getIllumRoleCanvas: (id) => ed.getIllumRoleCanvas(id),
        speedColor,
        icon: pv.snapshot(256),
        meshGbx: skin3d?.mesh,
        passthrough: skin3d?.passthrough,
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${skinName || 'skin'}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      notify(
        (skin3d
          ? 'Zip 3D exporté (mesh + textures). Placez-le dans Documents/Trackmania/Skins/Models/CarSport/ puis Garage > Upload skin.'
          : 'Zip exporté. Placez-le dans Documents/Trackmania/Skins/Models/CarSport/ puis Garage > Upload skin.') + (saveError ? ` Sauvegarde locale non effectuée : ${saveError}` : ' Projet modifiable enregistré dans Mes projets.'),
      );
    } catch (err) {
      notify(`Échec de l'export : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  // ---- Génération de livrée (modale avec aperçu 3D en direct) ----

  const openRandom = () => {
    const ed = editorRef.current;
    if (!ed) return;
    randomCheckpointRef.current = ed.createCheckpoint();
    setShowRandom(true);
  };

  /** Applique une génération à l'éditeur ; l'aperçu 3D (monté dans la modale) suit. */
  const onGenerate = async (opts: GeneratorOptions): Promise<GenerationSummary | null> => {
    const ed = editorRef.current;
    if (!ed) return null;
    setGenerating(true);
    // Laisse React afficher l'indicateur avant le travail synchrone.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const summary = generateSkin(ed, opts);
      setBgColor(ed.getBackgroundColor());
      return summary;
    } catch (err) {
      notify(`Échec de la génération : ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setGenerating(false);
    }
  };

  /** Ferme la modale en gardant le résultat : une seule entrée d'historique par map. */
  const onRandomKeep = () => {
    const cp = randomCheckpointRef.current;
    if (cp) editorRef.current?.commitCheckpoint(cp);
    randomCheckpointRef.current = null;
    setShowRandom(false);
  };

  /** Ferme la modale en restaurant l'état d'avant son ouverture (no-op si rien n'a été généré). */
  const onRandomCancel = async () => {
    const cp = randomCheckpointRef.current;
    randomCheckpointRef.current = null;
    setShowRandom(false);
    const ed = editorRef.current;
    if (!cp || !ed) return;
    await ed.restoreCheckpoint(cp);
    setBgColor(ed.getBackgroundColor());
  };

  const onClearMap = () => {
    setClearRequested(activeMap);
  };

  const confirmClearMap = () => {
    if (!clearRequested) return;
    editorRef.current?.setActiveMap(clearRequested);
    editorRef.current?.clearMap();
    setBgColor(editorRef.current?.getBackgroundColor() ?? '#000000');
    setClearRequested(null);
    notify('Texture réinitialisée. Ctrl+Z pour revenir à l’état précédent.');
  };

  const mapDef = MAP_BY_ID[activeMap];
  const family = mapDef.group;
  const guideIslands = UV_GUIDE_BY_FAMILY[family];
  /** Zones « Remplir une pièce » de la famille active (carrosserie ou détails). */
  const regionSet = REGIONS_BY_FAMILY[family];
  const regionEntries = useMemo(() => (regionSet ? Object.entries(regionSet) : []), [regionSet]);
  const { roughness: roughVal, metalness: metalVal } = decodeSurfaceMaterial(bgColor);
  const fillMaterial = decodeSurfaceMaterial(fillColor);
  const scalarLabel = activeMap === 'Skin_CoatR' ? 'Vernis' : 'Saleté autorisée';

  useEffect(() => {
    const firstRegion = regionEntries[0]?.[0] ?? '';
    setQuickRegionKey((prev) => {
      if (!firstRegion) return '';
      return regionEntries.some(([key]) => key === prev) ? prev : firstRegion;
    });
  }, [regionEntries]);

  const fillRegion = (key: string) => {
    const region = regionSet?.[key];
    if (!region) return;
    editorRef.current?.fillRegion(region, key);
  };

  const dirtyCount = Object.values(dirtyMaps).filter(Boolean).length;
  const currentTool = TOOLS.find((t) => t.id === tool);
  const sceneNavigation = explore3D || (tool !== 'select' && tool !== 'draw');
  const focusedLabel = focusedRegion
    ? guideIslands.find((i) => i.key === focusedRegion)?.label ?? focusedRegion
    : null;

  const renderMaterialControls = (
    title: string,
    value: { roughness: number; metalness: number },
    onChange: (roughness: number, metalness: number) => void,
  ) => (
    <div className="material-controls">
      <div className="material-controls-head">
        <span>{title}</span>
      </div>
      <div className="material-controls-grid">
        <SliderField
          label="Rugosité"
          value={value.roughness}
          min={0}
          max={255}
          format={pct}
          title="0 = miroir brillant · 255 = mat"
          onChange={(v) => onChange(v, value.metalness)}
          onCommit={endHistoryGesture}
        />
        <SliderField
          label="Métal"
          value={value.metalness}
          min={0}
          max={255}
          format={pct}
          title="0 = peinture · 255 = métal pur"
          onChange={(v) => onChange(value.roughness, v)}
          onCommit={endHistoryGesture}
        />
      </div>
      <p className="material-scale-hint">Rugosité : brillant → mat · Métal : peinture → métal</p>
    </div>
  );

  const renderMaterialPresets = (
    value: { roughness: number; metalness: number },
    onChange: (roughness: number, metalness: number) => void,
  ) => (
    <div className="material-presets" role="group" aria-label="Finitions de matière">
      {SURFACE_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className={`material-preset${
            value.roughness === preset.value.roughness && value.metalness === preset.value.metalness
              ? ' is-active'
              : ''
          }`}
          onClick={() => {
            endHistoryGesture();
            onChange(preset.value.roughness, preset.value.metalness);
            endHistoryGesture();
          }}
          title={`Rugosité ${pct(preset.value.roughness)} · métal ${pct(preset.value.metalness)}`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );

  const renderToolMaterialControls = (target: 'brush' | 'fill' | 'stroke', value: { roughness: number; metalness: number }) => (
    <>
      {renderMaterialControls(
        target === 'brush' ? 'Matière du pinceau' : target === 'stroke' ? 'Matière du contour' : 'Matière du remplissage',
        value,
        (rough, metal) => onRoughMetalToolChange(target, rough, metal),
      )}
      {renderMaterialPresets(value, (rough, metal) => onRoughMetalToolChange(target, rough, metal))}
    </>
  );

  const renderToolPaintControls = (target: 'brush' | 'fill' | 'stroke', color: string, label: string) => {
    const onChange = (next: string) => {
      if (target === 'brush') onBrushChange(next, brushSize);
      else if (target === 'fill') onFillChange(next);
      else onStrokeColor(next);
    };
    if (mapDef.kind === 'roughmetal') return renderToolMaterialControls(target, decodeSurfaceMaterial(color));
    if (mapDef.kind === 'grayscale') return <SliderField label={`${label} · ${scalarLabel}`} value={decodeSurfaceMaterial(color).roughness} min={0} max={255} format={pct} onChange={(v) => onChange(encodeScalarMap(v))} />;
    return <><span className="opt-label">{label}</span><Swatch value={color} onChange={onChange} disabled={target === 'fill' && !fillEnabled} title={`Couleur : ${label.toLowerCase()}`} showHex /></>;
  };

  // ------------------------------------------------------------ barre options

  const renderToolOptions = (): ReactNode => {
    const shapeOptions = (
      <>
        <div className="opt-group">
          {renderToolPaintControls('fill', fillColor, 'Remplissage')}
          <button
            type="button"
            className={`chip chip--sm${!fillEnabled ? ' is-active' : ''}`}
            onClick={() => onFillEnabled(!fillEnabled)}
            title="Sans remplissage : contour seul (anneau, cadre…)"
          >
            Contour seul
          </button>
          <SliderField
            compact
            label="Opacité"
            value={fillAlpha}
            min={0.05}
            max={1}
            step={0.05}
            disabled={!fillEnabled}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={onFillAlpha}
          />
        </div>
        <span className="opt-sep" />
        <div className="opt-group">
          {renderToolPaintControls('stroke', strokeColor, 'Contour')}
          <SliderField compact label="Épaisseur" value={strokeWidth} min={0} max={40} onChange={onStrokeWidth} />
          <button
            type="button"
            className={`chip chip--sm${strokeDashed ? ' is-active' : ''}`}
            onClick={() => onStrokeDashed(!strokeDashed)}
            title="Contour en pointillés"
          >
            Pointillés
          </button>
        </div>
      </>
    );

    switch (tool) {
      case 'draw':
        return (
          <>
            <div className="opt-group">
              {renderToolPaintControls('brush', brushColor, 'Pinceau')}
              <SliderField
                compact
                label="Taille"
                value={brushSize}
                min={2}
                max={120}
                format={(v) => `${v} px`}
                onChange={(v) => onBrushChange(brushColor, v)}
                title="[ et ] ou Ctrl+molette"
              />
              <SliderField
                compact
                label="Lissage"
                value={brushSmoothing}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)} %`}
                onChange={onBrushSmoothing}
                title="Stabilise le trait (réduit les tremblements)"
              />
            </div>
            <span className="opt-sep" />
            <span className="opt-hint">Maj = ligne droite · [ ] = taille</span>
          </>
        );
      case 'rect':
      case 'ellipse':
        return shapeOptions;
      case 'polygon':
        return (
          <>
            {shapeOptions}
            <span className="opt-sep" />
            <div className="opt-group">
              <button
                type="button"
                className={`chip chip--sm${polygonStar ? ' is-active' : ''}`}
                onClick={() => onPolygonStar(!polygonStar)}
                title="Basculer polygone régulier / étoile"
              >
                <Icon name="star" size={12} /> Étoile
              </button>
              <SliderField
                compact
                label={polygonStar ? 'Branches' : 'Côtés'}
                value={polygonSides}
                min={3}
                max={12}
                onChange={onPolygonSides}
              />
            </div>
          </>
        );
      case 'line':
        return (
          <div className="opt-group">
            {renderToolPaintControls('stroke', strokeColor, 'Ligne')}
            <SliderField
              compact
              label="Épaisseur"
              value={Math.max(strokeWidth, 1)}
              min={1}
              max={40}
              onChange={onStrokeWidth}
            />
            <button
              type="button"
              className={`chip chip--sm${strokeDashed ? ' is-active' : ''}`}
              onClick={() => onStrokeDashed(!strokeDashed)}
            >
              Pointillés
            </button>
            <span className="opt-hint">Maj = angles à 45°</span>
          </div>
        );
      case 'text':
        return (
          <>
            <div className="opt-group">
              {renderToolPaintControls('fill', fillColor, 'Texte')}
              <span className="opt-hint">Cliquez sur la texture pour placer, double-clic pour éditer.</span>
            </div>
          </>
        );
      case 'eyedropper':
        return <span className="opt-hint">Cliquez sur la texture pour prélever {mapDef.kind === 'roughmetal' ? 'la matière (rugosité et métal)' : mapDef.kind === 'grayscale' ? 'l’intensité' : 'une couleur'}. Les prochains remplissages et traits utiliseront cette valeur.</span>;
      case 'select':
      default:
        return (
          <span className="opt-hint">
            Cliquez un élément pour le sélectionner · glissez pour déplacer · molette pour zoomer · espace + glisser pour
            se déplacer
          </span>
        );
    }
  };

  // ----------------------------------------------------------- inspecteur

  const lightRoleControl = (label: string, value: IllumRole | 'mixed', onChange: (role: IllumRole) => void) => (
    <Row label={label}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as IllumRole)}>
        {value === 'mixed' && <option value="mixed" disabled>Plusieurs comportements</option>}
        {ILLUM_ROLES.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
      </select>
    </Row>
  );

  const renderLightPreview = () => (
    <Section title="Tester les lumières en 3D">
      <Toggle checked={night} onChange={(on) => { setNight(on); previewRef.current?.setNight(on); }} label="Ambiance de nuit" />
      <Toggle checked={braking} onChange={onBraking} label="Simuler le freinage" />
      <SliderField label="Luminosité de l’aperçu" value={neonIntensity} min={0} max={4} step={0.1} format={(value) => `${value.toFixed(1)} ×`} onChange={onNeonIntensity} />
      <p className="hint">La nuit active les phares ; le freinage active les feux de frein. Ces simulations et ce multiplicateur modifient uniquement l’aperçu. La couleur et l’opacité du calque règlent la lumière peinte.</p>
    </Section>
  );

  const renderDirtControls = () => (
    <Section title="Saleté du skin">
      <Toggle label="Protéger tout le skin" checked={!dirtEnabled} onChange={(protectedSkin) => setDirtEnabled(!protectedSkin)} />
      <p className="hint">Cette protection désactive la saleté sur la carrosserie, les détails et les roues à l’export. Vos masques et calques restent enregistrés et réutilisables.</p>
      <SliderField label="Saleté sur la voiture (aperçu)" value={dirtPreview} min={0} max={1} step={.05} format={(value) => `${Math.round(value * 100)} %`} onChange={setDirtPreview} />
      <p className="hint">Aperçu simplifié pour vérifier les zones protégées. Ce curseur ne change pas l’export ; le jeu applique sa propre saleté en roulant.</p>
      {!dirtEnabled && <p className="hint light-limit">Protection active : le skin reste propre, même avec un masque blanc. Désactivez-la pour tester vos masques.</p>}
    </Section>
  );

  const renderSelectionProps = () => {
    if (!selection) return null;
    const isText = selection.type === 'i-text' || selection.type === 'text';
    const selectedMaterial = decodeSurfaceMaterial(selection.paintColor);
    const supportsElementMaterial = mapDef.kind === 'roughmetal' && selection.paintEditable;
    const projection = selection.projection;
    const resizeImage = (factor: number) => {
      if (projection) editorRef.current?.setProjection({ width: projection.width * factor, height: projection.height * factor });
      else if (transform) onTransform({ w: transform.w * factor, h: transform.h * factor });
      endHistoryGesture();
    };
    return (
      <>
        {isDirtMask(activeMap) && renderDirtControls()}
        {selection.type === 'image' && <Section title="Image sur la voiture">
          <div className="image-actions">
            <div className="image-actions-icon"><Icon name="image" size={24} /></div>
            <div><strong>{selection.name || 'Votre image'}</strong><p>{projection ? 'Projection 3D · un calque pour toutes les pièces touchées.' : 'Un calque indépendant, visible en 2D et en 3D.'}</p></div>
          </div>
          <button type="button" className="btn btn-primary btn-full" disabled={placingImage} onClick={() => {
            const image = editorRef.current?.getSelection() as (FabricObject & { id?: string }) | undefined;
            if (!image?.id) return;
            setTool('select'); setExplore3D(false); setView('3d'); setImagePlacement({ mapId: activeMap, layerId: image.id });
          }}><Icon name="target" size={15} /> Replacer sur la voiture</button>
          <div className="image-adjustments">
            <button type="button" className="btn btn-sm" aria-label="Réduire l’image" onClick={() => resizeImage(.85)}><Icon name="minus" size={14} /> Taille</button>
            <button type="button" className="btn btn-sm" aria-label="Agrandir l’image" onClick={() => resizeImage(1.15)}><Icon name="plus" size={14} /> Taille</button>
            <button type="button" className="btn btn-sm" aria-label="Tourner l’image de 15 degrés" onClick={() => { if (projection) editorRef.current?.setProjection({ angle: projection.angle + 15 }); else if (transform) onTransform({ angle: transform.angle + 15 }); endHistoryGesture(); }}><Icon name="rotate" size={14} /> +15°</button>
          </div>
          <p className="hint">{projection ? 'Glissez sur le logo pour déplacer toute la projection. Les poignées règlent la taille et la rotation. Replacer choisit un nouveau point depuis votre angle de vue.' : 'Glissez sur l’image pour la déplacer. Replacer permet de changer de pièce. Le logo est rogné aux bords de la pièce choisie.'}</p>
        </Section>}
        {projection && <Section title="Projection 3D">
          <SliderField label="Taille de l’image" value={Math.round(projection.width / .65 * 100)} min={10} max={600} step={5} format={(v) => `${v} %`} onChange={(v) => { const width = .65 * v / 100; editorRef.current?.setProjection({ width, height: projection.height * width / projection.width }); }} onCommit={endHistoryGesture} />
          <Row label="Rotation"><input aria-label="Rotation de projection" type="number" value={Math.round(projection.angle)} onChange={(e) => { const v = numOrNull(e); if (v !== null) editorRef.current?.setProjection({ angle: v }); }} onBlur={endHistoryGesture} /></Row>
          <button type="button" className="btn btn-sm" disabled={view === '2d'} onClick={() => {
            const anchor = previewRef.current?.projectionAnchorFromView(projection.center);
            if (anchor && editorRef.current?.placeSelectedProjection(anchor)) notify('Projection alignée avec cette vue. Taille, rotation et matière conservées.');
          }}><Icon name="target" size={14} /> Aligner avec cette vue</button>
          <p className="hint">Un logo coupé sur une pente ? Regardez la zone de face, puis alignez la projection. Son orientation reste fixe quand vous tournez la voiture.</p>
          <details className="projection-options"><summary>Surfaces et profondeur</summary>
            <div className="stack">{(['skin', 'details', 'wheels'] as Family[]).map((target) => <Toggle key={target} label={`Projeter sur ${FAMILY_LABELS[target].toLowerCase()}`} checked={projection.families.includes(target)} onChange={(on) => {
              const families = on ? [...projection.families, target] : projection.families.filter((entry) => entry !== target);
              if (families.length) { editorRef.current?.setProjection({ families }); endHistoryGesture(); }
            }} />)}
            <SliderField label="Profondeur de projection" value={projection.depth} min={.02} max={1.5} step={.02} format={(v) => `${Math.round(v / 4.2 * 100)} % voiture`} onChange={(depth) => editorRef.current?.setProjection({ depth })} onCommit={endHistoryGesture} />
            <p className="hint">Augmentez la profondeur pour atteindre des surfaces voisines. Les faces arrière et les surfaces masquées sont écartées. Le verre est exclu.</p></div>
          </details>
        </Section>}
        {selection.imageMaterial && <Section title="Matière du logo">
          <Toggle label="Matière propre à l’image" checked={selection.imageMaterial.enabled} onChange={(enabled) => editorRef.current?.setImageMaterialEnabled(enabled)} />
          {selection.imageMaterial.enabled ? <>
            {renderMaterialControls('Finition de cette image', selection.imageMaterial.value, (roughness, metalness) => editorRef.current?.setImageMaterial(roughness, metalness))}
            {renderMaterialPresets(selection.imageMaterial.value, (roughness, metalness) => { editorRef.current?.setImageMaterial(roughness, metalness); endHistoryGesture(); })}
            <p className="hint">Un calque lié dans Matière suit la silhouette transparente de l’image, sa taille et sa position. Le fond et les autres éléments gardent leur finition.</p>
          </> : <p className="hint">L’image utilise la matière déjà présente sur la voiture. Activez ce switch pour lui donner sa propre finition.</p>}
        </Section>}
        {selection.imageLight && <Section title="Lumière du logo">
          {selection.imageLight.available ? <>
            <Toggle label="Image lumineuse" checked={selection.imageLight.enabled} onChange={(enabled) => editorRef.current?.setImageLightEnabled(enabled)} />
            {selection.imageLight.enabled && <>
              <SliderField label="Intensité de cette image" value={selection.imageLight.value.strength} min={0} max={1} step={.05} format={(value) => `${Math.round(value * 100)} %`} onChange={(strength) => editorRef.current?.setImageLight({ strength }, 'image-light:strength')} onCommit={endHistoryGesture} />
              {lightRoleControl('Comportement de cette image', selection.imageLight.value.role, (role) => { editorRef.current?.setImageLight({ role }); endHistoryGesture(); })}
            </>}
            <p className="hint">La lumière garde les couleurs et la transparence du logo. Les calques liés dans Néon / feux suivent sa position et sa taille sur la carrosserie, les détails et les roues.</p>
            {!selection.imageLight.touches && <p className="hint light-limit">Cette projection ne touche actuellement aucune surface. Déplacez-la sur la voiture ou augmentez sa profondeur.</p>}
          </> : <>
            <p className="hint light-limit">Sélectionnez une image dans Couleur pour activer sa lumière.</p>
            <button type="button" className="btn btn-sm" onClick={() => { setActiveMap('Details_I'); imageInputRef.current?.click(); }}><Icon name="image" size={14} /> Ajouter une image lumineuse</button>
          </>}
        </Section>}
        {selection.imageLight?.enabled && renderLightPreview()}
        <Section title={selection.name || SELECTION_TYPE_LABELS[selection.type] || 'Élément'}>
          <Row label="Nom du calque">
            <input className="element-name" value={selection.name} placeholder={SELECTION_TYPE_LABELS[selection.type] ?? 'Élément'} onChange={(e) => updateSel({ name: e.target.value }, 'name')} onBlur={endHistoryGesture} />
          </Row>
          {mapDef.kind === 'illum' && <>
            {lightRoleControl('Comportement de cet élément', selection.lightRole, (role) => editorRef.current?.setSelectionIllumRole(role))}
            <p className="hint">Ce choix concerne uniquement la sélection. Le compteur reste indépendant.</p>
          </>}
          {supportsElementMaterial ? (
            <>
              {renderMaterialControls(selection.type === 'group' ? 'Matière de toutes les formes du groupe' : 'Matière de cet élément', selectedMaterial, onRoughMetalSelectionChange)}
              {renderMaterialPresets(selectedMaterial, onRoughMetalSelectionChange)}
              <p className="hint">{selection.paintMixed ? 'Le groupe contient plusieurs matières. Le prochain réglage applique la même finition à ses formes.' : 'Seul cet élément est modifié. Retrouvez le fond global dans l’onglet Texture.'}</p>
              {!isStrokeColored(selection.type) && selection.type !== 'group' && (
                <Toggle checked={selection.noFill} onChange={onSelNoFill} label="Contour seul" />
              )}
            </>
          ) : mapDef.kind === 'grayscale' && selection.paintEditable ? (
            <SliderField label={scalarLabel} value={decodeSurfaceMaterial(selection.paintColor).roughness} min={0} max={255} format={pct} onChange={(v) => editorRef.current?.setSelectionMaterial(encodeScalarMap(v), 'scalar-map')} onCommit={endHistoryGesture} />
          ) : selection.type !== 'image' ? (
            <Row label={isStrokeColored(selection.type) ? 'Couleur' : 'Remplissage'}>
              <Swatch
                value={isStrokeColored(selection.type) ? selection.stroke : selection.fill}
                title="Couleur de cet élément"
                showHex
                onChange={(c) =>
                  isStrokeColored(selection.type) ? updateSel({ stroke: c }, 'stroke') : updateSel({ fill: c }, 'fill')
                }
              />
              {!isStrokeColored(selection.type) && (
                <Toggle checked={selection.noFill} onChange={onSelNoFill} label="Contour seul" />
              )}
            </Row>
          ) : mapDef.kind === 'roughmetal' ? <p className="hint">Cette image contient ses propres pixels de matière. Pour créer une finition réglable, ajoutez une forme sur la pièce depuis Texture.</p> : null}
          <SliderField
            label={isDirtMask(activeMap) ? 'Opacité du masque' : 'Opacité'}
            value={selection.opacity}
            min={isDirtMask(activeMap) ? 0 : 0.05}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(v) => updateSel({ opacity: v }, 'opacity')}
            onCommit={endHistoryGesture}
          />
          {(selection.type === 'path' || selection.type === 'line') && (
            <SliderField
              label="Épaisseur"
              value={selection.strokeWidth}
              min={1}
              max={120}
              onChange={(v) => updateSel({ strokeWidth: v }, 'strokeWidth')}
              onCommit={endHistoryGesture}
            />
          )}
          {!isStrokeColored(selection.type) && selection.type !== 'image' && (
            <>
              <Row label="Contour">
                {mapDef.kind !== 'roughmetal' && <Swatch
                  value={selection.stroke.startsWith('#') ? selection.stroke : '#ffffff'}
                  onChange={(c) => updateSel({ stroke: c }, 'stroke')}
                />}
                <Toggle checked={selection.dashed} onChange={onSelDashed} label="Pointillés" />
              </Row>
              <SliderField
                label="Épaisseur"
                value={selection.strokeWidth}
                min={0}
                max={40}
                onChange={(v) => updateSel({ strokeWidth: v }, 'strokeWidth')}
                onCommit={endHistoryGesture}
              />
              {mapDef.kind === 'roughmetal' && selection.strokeWidth > 0 && renderMaterialControls(
                'Matière du contour',
                decodeSurfaceMaterial(selection.stroke),
                (roughness, metalness) => updateSel({ stroke: encodeSurfaceMaterial({ roughness, metalness }) }, 'surface-contour'),
              )}
            </>
          )}
          {isText && (
            <>
              <Row label="Police">
                <select
                  aria-label="Police du texte"
                  value={selection.fontFamily}
                  onChange={(e) => updateSel({ fontFamily: e.target.value })}
                >
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f.split(',')[0]}
                    </option>
                  ))}
                </select>
              </Row>
              <SliderField
                label="Taille"
                value={selection.fontSize ?? 72}
                min={12}
                max={300}
                onChange={(v) => updateSel({ fontSize: v }, 'fontSize')}
                onCommit={endHistoryGesture}
              />
            </>
          )}
          <div className="btn-row">
            {!projection && <>
            <button type="button" className="btn btn-sm" onClick={() => editorRef.current?.flipSelection('x')} title="Miroir horizontal">
              <Icon name="flipH" size={14} /> Miroir H
            </button>
            <button type="button" className="btn btn-sm" onClick={() => editorRef.current?.flipSelection('y')} title="Miroir vertical">
              <Icon name="flipV" size={14} /> Miroir V
            </button>
            {mapDef.kind !== 'roughmetal' && <button
              type="button"
              className={`btn btn-sm${selection.hasShadow ? ' is-active' : ''}`}
              onClick={() => editorRef.current?.toggleShadow()}
            >
              <Icon name="sun" size={14} /> Ombre
            </button>}
            </>}
            <button type="button" className="btn btn-sm" onClick={() => editorRef.current?.duplicateSelection()}>
              <Icon name="copy" size={14} /> Dupliquer
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => editorRef.current?.deleteSelection()}>
              <Icon name="trash" size={14} /> Supprimer
            </button>
          </div>
        </Section>

        {transform && !projection && (
          <Section title="Position et taille">
            {selection.type === 'image' && <Toggle checked={keepImageRatio} onChange={setKeepImageRatio} label="Conserver les proportions" />}
            <div className="transform-grid" onBlur={endHistoryGesture}>
              <label className="num">
                <span>X</span>
                <input aria-label="Position X" type="number" value={transform.x} onChange={(e) => { const v = numOrNull(e); if (v !== null) onTransform({ x: v }); }} />
              </label>
              <label className="num">
                <span>Y</span>
                <input aria-label="Position Y" type="number" value={transform.y} onChange={(e) => { const v = numOrNull(e); if (v !== null) onTransform({ y: v }); }} />
              </label>
              <label className="num">
                <span>L</span>
                <input aria-label="Largeur" type="number" min={1} value={transform.w} onChange={(e) => { const v = numOrNull(e); if (v !== null && v > 0) onTransform({ w: v, ...(selection.type === 'image' && keepImageRatio ? { h: transform.h * v / transform.w } : {}) }); }} />
              </label>
              <label className="num">
                <span>H</span>
                <input aria-label="Hauteur" type="number" min={1} value={transform.h} onChange={(e) => { const v = numOrNull(e); if (v !== null && v > 0) onTransform({ h: v, ...(selection.type === 'image' && keepImageRatio ? { w: transform.w * v / transform.h } : {}) }); }} />
              </label>
              <label className="num">
                <span>°</span>
                <input aria-label="Rotation" type="number" value={transform.angle} onChange={(e) => { const v = numOrNull(e); if (v !== null) onTransform({ angle: v }); }} />
              </label>
            </div>
            <p className="hint">Pixels de la texture ({mapDef.workRes} × {mapDef.workRes}).</p>
          </Section>
        )}

        {guideIslands.length > 0 && !projection && (
          <Section title="Placer sur une pièce" collapsible defaultOpen>
            <div className="stack">
              <select aria-label="Pièce de placement" value={centerTarget} onChange={(e) => setCenterTarget(e.target.value)}>
                <option value="">Choisir une pièce…</option>
                {guideIslands.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm" disabled={!centerTarget} onClick={onCenterInIsland}>
                <Icon name="target" size={14} /> {carAligned ? 'Centrer et aligner sur la voiture' : 'Centrer dans la pièce'}
              </button>
              <Toggle
                checked={carAligned}
                onChange={onToggleCarAligned}
                label="Orienter selon la voiture"
                hint="Le décalque est tourné pour apparaître droit sur la carrosserie, pas sur le canvas"
              />
            </div>
          </Section>
        )}
      </>
    );
  };

  const renderTextureProps = () => (
    <>
      {isDirtMask(activeMap) && renderDirtControls()}
      <Section title={`${FAMILY_LABELS[family]} · ${CHANNEL_LABELS[activeMap]}`}>
        <p className="hint">{mapDef.description}</p>
        {mapDef.kind === 'roughmetal' ? (
          <>
            {renderMaterialControls('Fond de la texture', { roughness: roughVal, metalness: metalVal }, onRoughMetalChange)}
            {renderMaterialPresets({ roughness: roughVal, metalness: metalVal }, onRoughMetalChange)}
            <p className="hint">
              Le fond définit la matière des zones sans dessin. Pour modifier une zone séparément, sélectionnez un
              élément et réglez sa matière dans l’onglet Élément.
            </p>
            <button type="button" className="btn btn-sm material-uniformize" onClick={onApplyMaterialToAll}>
              <Icon name="layers" size={14} /> Appliquer à tous les éléments
            </button>
            <p className="hint">Applique le fond choisi aux formes de cette carte, en conservant les calques. Les images et références gardent leurs propres valeurs. Annulable avec Ctrl+Z.</p>
          </>
        ) : mapDef.kind === 'grayscale' ? (
          <>
            <SliderField label={`${scalarLabel} · fond`} value={decodeSurfaceMaterial(bgColor).roughness} min={0} max={255} format={pct} onChange={(v) => onBgChange(encodeScalarMap(v))} onCommit={endHistoryGesture} />
            {isDirtMask(activeMap) && <>
              <div className="material-presets" role="group" aria-label="Dosage du fond de saleté">
                {[{ value: 0, label: 'Propre' }, { value: 64, label: 'Légère' }, { value: 128, label: 'Modérée' }, { value: 255, label: 'Maximum' }].map((preset) =>
                  <button type="button" className={`material-preset${decodeSurfaceMaterial(bgColor).roughness === preset.value ? ' is-active' : ''}`} key={preset.value} onClick={() => { endHistoryGesture(); onBgChange(encodeScalarMap(preset.value)); endHistoryGesture(); }}>{preset.label}</button>)}
              </div>
              <p className="hint">Le fond agit sur les zones sans calque. Les images importées et dessins au-dessus gardent leurs valeurs. Pour rester propre partout, activez la protection du skin.</p>
            </>}
          </>
        ) : (
          <Row label="Couleur de fond">
            <Swatch value={bgColor} onChange={onBgChange} title="Couleur de fond" showHex />
          </Row>
        )}
        {mapDef.kind === 'illum' && (
          <>
            {activeMap === 'Details_I' && <Row label="Compteur de vitesse" hint="Visible en roulant. Indépendant des phares et du freinage.">
              <Swatch value={speedColor} onChange={onSpeedColor} title="Couleur des feux de vitesse" showHex />
            </Row>}
            {lightRoleControl('Comportement du fond', illumRole, onIllumRole)}
            <button type="button" className="btn btn-sm" onClick={() => { editorRef.current?.setIllumBackgroundRole(illumRole, true); setInspectorTab('texture'); notify('Comportement appliqué à tous les calques lumineux, hors compteur. Ctrl+Z pour annuler.'); }}>Appliquer ce comportement à tous les calques</button>
            <p className="hint">Chaque calque conserve son propre comportement dans Élément. Un fond noir n’émet aucune lumière.</p>
          </>
        )}
        {activeMap === 'Skin_CoatR' && (
          <SliderField
            label="Vernis (aperçu)"
            value={coatIntensity}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={onCoatIntensity}
            title="N'affecte que l'aperçu 3D ; en jeu, c'est la texture qui décide"
          />
        )}
      </Section>

      {mapDef.kind === 'basecolor' && <Section title="Éclairage">
        <p className="hint">Ajoutez une lumière dans Néon / feux sur cette surface, ou activez « Image lumineuse » dans les propriétés d’un logo pour qu’elle suive son déplacement.</p>
        <div className="btn-group"><button type="button" className="btn btn-sm" onClick={() => { setActiveMap(resolvePaintMap('Details_I', family)!); imageInputRef.current?.click(); }}><Icon name="image" size={14} /> Image lumineuse</button><button type="button" className="btn btn-sm" onClick={() => { setActiveMap(resolvePaintMap('Details_I', family)!); setTool('draw'); }}><Icon name="brush" size={14} /> Peindre une lumière</button></div>
      </Section>}

      {regionSet && (
        <Section title="Peindre une pièce">
          {mapDef.kind === 'illum' && lightRoleControl('Comportement du prochain tracé', newLightRole, onNewLightRole)}
          <div className="chip-grid">
            {regionEntries.map(([key, r]) => (
              <button
                key={key}
                type="button"
                className={`chip${quickRegionKey === key ? ' is-active' : ''}${
                  focusedRegion === key ? ' is-focused' : ''
                }`}
                onClick={() => {
                  setQuickRegionKey(key);
                  if (family === 'skin' && focusedRegion) onFocusRegion(key);
                }}
                title={r.label}
              >
                {r.label}
              </button>
            ))}
          </div>
          {mapDef.kind === 'roughmetal' && <>
            {renderMaterialControls('Matière à appliquer à la pièce', fillMaterial, (rough, metal) => onRoughMetalToolChange('fill', rough, metal))}
            {renderMaterialPresets(fillMaterial, (rough, metal) => onRoughMetalToolChange('fill', rough, metal))}
          </>}
          <div className="row row--actions">
            {mapDef.kind === 'grayscale' ? renderToolPaintControls('fill', fillColor, 'Pièce') : mapDef.kind !== 'roughmetal' && <Swatch value={fillColor} onChange={onFillChange} title="Couleur de remplissage" />}
            <button
              type="button"
              className="btn btn-sm"
              disabled={!quickRegionKey}
              onClick={() => fillRegion(quickRegionKey)}
              title="Remplir la pièce sélectionnée avec la couleur (contours UV exacts)"
            >
              <Icon name="droplet" size={14} /> Appliquer
            </button>
            {family === 'skin' && (
              <button
                type="button"
                className={`btn btn-sm${focusedRegion === quickRegionKey ? ' is-active' : ''}`}
                disabled={!quickRegionKey}
                onClick={() => onFocusRegion(focusedRegion === quickRegionKey ? null : quickRegionKey)}
                title="Isoler : zoom sur la pièce et rognage du dessin à ses contours"
              >
                <Icon name="crop" size={14} /> {focusedRegion === quickRegionKey ? 'Tout voir' : 'Isoler'}
              </button>
            )}
          </div>
          <p className="hint">Choisissez une pièce, puis appliquez la {mapDef.kind === 'roughmetal' ? 'matière' : 'couleur'}. Un calque éditable épouse son contour. « Isoler » limite le dessin à cette pièce.</p>
        </Section>
      )}

      <Section title="Précision" collapsible defaultOpen={false}>
        <div className="stack">
          {guideIslands.length > 0 && (
            <Row label="Limiter à" hint="Le dessin est rogné aux contours de la pièce choisie">
              <select aria-label="Limiter le dessin à une pièce" value={clipIsland ?? ''} onChange={(e) => onClipIsland(e.target.value || null)}>
                <option value="">Toute la texture</option>
                {guideIslands.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <Row label="Grille" hint="Affiche une grille et aimante les objets dessus (déplacement, tracé)">
            <Toggle checked={showGrid} onChange={onToggleGrid} label="Magnétisme" />
            <select aria-label="Pas de la grille" value={gridDiv} onChange={(e) => onGridDiv(Number(e.target.value))} disabled={!showGrid}>
              {GRID_DIVS.map((d) => (
                <option key={d} value={d}>
                  {d} × {d} · {Math.round(mapDef.workRes / d)} px
                </option>
              ))}
            </select>
          </Row>
          <Row label="Référence" hint="Image verrouillée et semi-transparente pour décalquer un logo">
            <button type="button" className="btn btn-sm" onClick={() => refInputRef.current?.click()}>
              <Icon name="image" size={14} /> {hasRef ? 'Remplacer' : 'Importer une image'}
            </button>
          </Row>
          {hasRef && (
            <SliderField
              label="Opacité réf."
              value={refOpacity}
              min={0.05}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={onRefOpacity}
              onCommit={endHistoryGesture}
            />
          )}
        </div>
      </Section>

      <Section title="Installer dans le jeu" collapsible defaultOpen={false}>
        <ol className="steps">
          <li>Exporter le skin (.zip)</li>
          <li>
            Copier le zip dans <code>Documents\Trackmania\Skins\Models\CarSport\</code>
          </li>
          <li>En jeu : Profil → Garage → « Upload skin »</li>
        </ol>
      </Section>
    </>
  );

  const renderLayers = () => (
    <div className="layers">
      {layers.length === 0 ? (
        <div className="empty">
          <Icon name="layers" size={22} />
          <p>Aucun calque sur cette texture.</p>
          <p className="hint">Dessinez, ajoutez une forme, du texte ou une image.</p>
        </div>
      ) : (
        <>
        <p className="layers-hint">Cliquez pour sélectionner · double-clic pour ouvrir les réglages. Le calque du haut recouvre ceux du dessous.</p>
        <button type="button" className="btn btn-sm layer-edit" disabled={!selection} onClick={() => { setTool('select'); setInspectorTab('props'); }}><Icon name="sliders" size={14} /> Modifier la sélection</button>
        <ul className="layer-list">
          {layers.map((l) => (
            <li
              key={l.id}
              className={`layer-row${l.selected ? ' is-selected' : ''}${l.visible ? '' : ' is-hidden'}${
                l.locked ? ' is-locked' : ''
              }`}
            >
              <button type="button" className="layer-select" aria-pressed={l.selected} onClick={() => { editorRef.current?.selectLayer(l.id); if (l.linked && !l.locked) setInspectorTab('props'); }} onDoubleClick={() => setInspectorTab('props')} title={`${l.name} · ${l.linked ? 'réglages liés à l’image' : 'double-clic pour modifier'}`}>
              <Icon name={LAYER_ICONS[l.type] ?? 'square'} size={14} className="layer-type" />
              <span className="layer-name" title={l.name}>
                {l.name}
              </span>
              </button>
              <span className="layer-actions" onClick={(e) => e.stopPropagation()}>
                <IconButton size="sm" icon="chevronUp" label="Monter" disabled={l.linked} onClick={() => editorRef.current?.moveLayer(l.id, 'up')} className="hover-only" tipSide="left" />
                <IconButton size="sm" icon="chevronDown" label="Descendre" disabled={l.linked} onClick={() => editorRef.current?.moveLayer(l.id, 'down')} className="hover-only" tipSide="left" />
                <IconButton size="sm" icon="trash" label="Supprimer" danger onClick={() => editorRef.current?.deleteLayer(l.id)} className="hover-only" tipSide="left" />
                <IconButton
                  size="sm"
                  icon={l.locked ? 'lock' : 'unlock'}
                  label={l.locked ? 'Déverrouiller' : 'Verrouiller'}
                  active={l.locked}
                  onClick={() => editorRef.current?.toggleLock(l.id)}
                  tipSide="left"
                />
                <IconButton
                  size="sm"
                  icon={l.visible ? 'eye' : 'eyeOff'}
                  label={l.visible ? 'Masquer' : 'Afficher'}
                  onClick={() => editorRef.current?.toggleVisible(l.id)}
                  tipSide="left"
                />
              </span>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );

  // --------------------------------------------------------------------- UI

  return (
    <div className={`app app--${view}`}>
      <svg className="studio-filter-defs" aria-hidden="true" width="0" height="0">
        <defs>
          <filter id="studio-roughness-view" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 1 0" />
          </filter>
          <filter id="studio-metalness-view" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0 1 0 0 0  0 1 0 0 0  0 1 0 0 0  0 0 0 1 0" />
          </filter>
        </defs>
      </svg>
      {/* ------------------------------------------------------------ topbar */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <span className="brand-mark">TM</span>
            <span className="brand-name">Skin Studio</span>
          </div>
          <span className="topbar-sep" />
          <input
            className="project-name"
            value={skinName}
            onChange={(e) => setSkinName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))}
            placeholder="Nom du skin"
            title="Nom du skin et du projet"
            maxLength={120}
            spellCheck={false}
          />
          <span className={`project-save-status ${projectModified ? 'is-unsaved' : ''}`} title={projectModified ? 'Enregistrez le projet pour conserver tous les calques.' : savedAt ? `Enregistré le ${new Date(savedAt).toLocaleString('fr-FR')}` : ''}>
            <Icon name={projectModified ? 'pen' : 'check'} size={12} /> {projectModified ? 'À enregistrer' : 'Enregistré'}
          </span>
          {skin3d && (
            <span className="mesh-badge" title="L'export inclura MainBody.Mesh.gbx. La hitbox du jeu ne change pas.">
              Mesh 3D
            </span>
          )}
        </div>

        <div className="topbar-center">
          <div className="segmented" role="tablist" aria-label="Vue">
            <button type="button" role="tab" aria-selected={view === '2d'} className={view === '2d' ? 'is-active' : ''} onClick={() => changeView('2d')} disabled={placingImage} title="Éditeur de texture">
              <Icon name="image" size={14} /> Texture 2D
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'split'}
              className={view === 'split' ? 'is-active' : ''}
              onClick={() => changeView('split')}
              disabled={!ready || placingImage}
              title="Texture et voiture côte à côte"
            >
              <Icon name="panelRight" size={14} /> Côte à côte
            </button>
            <button type="button" role="tab" aria-selected={view === '3d'} className={view === '3d' ? 'is-active' : ''} onClick={() => changeView('3d')} disabled={!ready || placingImage} title="Voiture plein cadre">
              <Icon name="box" size={14} /> Atelier 3D
            </button>
          </div>
        </div>

        <div className="topbar-right">
          <div className="btn-group">
            <IconButton icon="undo" label="Annuler" shortcut="Ctrl+Z" disabled={!historyState.undo || placingImage} onClick={() => editorRef.current?.undo()} />
            <IconButton icon="redo" label="Rétablir" shortcut="Ctrl+Y" disabled={!historyState.redo || placingImage} onClick={() => editorRef.current?.redo()} />
          </div>
          <span className="topbar-sep" />
          <button type="button" className="btn" onClick={() => setLibraryOpen(true)} disabled={!ready || placingImage || !!imagePlacement} title="Ouvrir la bibliothèque des projets locaux"><Icon name="folder" size={15} /> Mes projets</button>
          <button type="button" className="btn" onClick={() => void saveProjectRef.current()} disabled={!ready || placingImage || !!imagePlacement} title="Enregistrer le projet complet · Ctrl+S"><Icon name="save" size={15} /> Enregistrer</button>
          <button type="button" className="btn" onClick={openRandom} disabled={!ready || placingImage} title="Générer une livrée complète">
            <Icon name="sparkles" size={15} /> Générer
          </button>
          <button type="button" className="btn" onClick={() => zipInputRef.current?.click()} disabled={!ready || placingImage} title="Importer un skin (.zip) ou un projet 3D (skin3d-project.zip)">
            <Icon name="upload" size={15} /> Importer
          </button>
          {skin3d && (
            <button type="button" className="btn" onClick={() => void onUseOfficialMesh()} disabled={!ready} title="Oublier le mesh custom et revenir à la voiture officielle">
              Mesh officiel
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onExport} disabled={!ready || placingImage} title="Exporter le skin pour Trackmania (.zip)">
            <Icon name="download" size={15} /> Exporter
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------- barre options */}
      <div className="options-bar">
        <div className="options-left">
          <div className="options-tool">
            <Icon name={currentTool?.icon ?? 'select'} size={15} />
            <span>{currentTool?.label}</span>
          </div>
          <span className="opt-sep" />
          {tool === 'select' && selection ? (
            <div className="selection-context">
              <span>{selection.name || SELECTION_TYPE_LABELS[selection.type] || 'Élément sélectionné'}</span>
              <span className="opt-hint">{selection.projection ? view === '2d' ? 'Déplacement dans Atelier 3D · taille et matière dans Élément' : explore3D ? 'Tournez pour choisir la vue · alignez la projection dans Élément' : 'Glissez sur le logo · poignées pour taille et rotation · matière dans Élément' : view === '3d' ? selection.type === 'image' ? 'Glissez sur l’image pour déplacer · taille et rotation dans Élément' : 'Réglages dans Élément · ouvrez Texture 2D pour déplacer cette forme' : 'Glissez pour déplacer · poignées pour redimensionner · réglages dans Élément'}</span>
            </div>
          ) : <span className="opt-hint">{tool === 'select' ? view === '3d' ? 'Ajoutez une image, puis cliquez sur la voiture pour la placer.' : 'Choisissez un dessin sur la texture ou dans Calques. Espace + glisser pour déplacer la vue.' : currentTool?.hint}</span>}
        </div>
        <div className="options-right">
          {tool !== 'select' && (
            <button type="button" className="btn btn-sm" onClick={() => setInspectorTab('props')}>
              <Icon name="sliders" size={14} /> Réglages de l’outil
            </button>
          )}
          {showGrid && (
            <label className="pill pill--select" title="Taille de la grille et du magnétisme">
              <Icon name="grid" size={12} />
              <span className="pill-text">Grille</span>
              {/* Libellé court ici (le pas en px est détaillé dans Précision de l'inspecteur). */}
              <select value={gridDiv} onChange={(e) => onGridDiv(Number(e.target.value))} aria-label="Taille de la grille">
                {GRID_DIVS.map((d) => (
                  <option key={d} value={d}>
                    {d} × {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          {symmetry && (
            <span className="pill pill--accent" title="Symétrie active : chaque ajout est dupliqué en miroir">
              <Icon name="flipH" size={12} /> <span className="pill-text">Symétrie</span>
            </span>
          )}
          {focusedLabel && (
            <button type="button" className="pill pill--accent pill--btn" onClick={() => onFocusRegion(null)} title="Quitter l'isolation">
              <Icon name="crop" size={12} /> {focusedLabel} <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="body">
        {/* ------------------------------------------------------------ rail */}
        <aside className="rail">
          <button type="button" className="rail-image-add" aria-label="Importer un logo ou une image" disabled={placingImage} onClick={() => imageInputRef.current?.click()}>
            <span className="rail-image-symbol"><Icon name="image" size={22} /><Icon name="plus" size={12} /></span>
            <strong>Ajouter un logo</strong><small>Image PNG, JPG, SVG…</small>
          </button>
          <div className="rail-caption">ÉDITER</div>
          <div className="rail-group">
            {TOOLS.map((t, index) => (
              <Fragment key={t.id}>
              {index === 2 && <div className="rail-caption rail-caption--section">DESSIN SUR LA TEXTURE <span>2D</span></div>}
              <button
                type="button"
                className={`tool-item${tool === t.id ? ' is-active' : ''}`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                onClick={() => setTool(t.id)}
                title={`${t.hint} · ${t.key}`}
              >
                <Icon name={t.icon} size={17} />
                <span>{t.label}</span>
                <kbd>{t.key}</kbd>
              </button>
              </Fragment>
            ))}
          </div>
          <div className="rail-group rail-group--bottom">
            <div className="rail-caption">AIDES</div>
            <button type="button" className={`tool-item tool-item--utility${symmetry ? ' is-active' : ''}`} aria-pressed={symmetry} onClick={onToggleSymmetry} title="Duplique les ajouts de l’autre côté de la texture">
              <Icon name="flipH" size={16} /><span>Symétrie</span><i className={`status-dot${symmetry ? ' is-on' : ''}`} />
            </button>
            <button type="button" className={`tool-item tool-item--utility${showGrid ? ' is-active' : ''}`} aria-pressed={showGrid} onClick={onToggleGrid} title="Afficher la grille et activer le magnétisme">
              <Icon name="grid" size={16} /><span>Grille</span><i className={`status-dot${showGrid ? ' is-on' : ''}`} />
            </button>
            <button type="button" className={`tool-item tool-item--utility${showGuide ? ' is-active' : ''}`} aria-pressed={showGuide} onClick={() => setShowGuide((v) => !v)} title="Afficher les formes des pièces de carrosserie">
              <Icon name="guide" size={16} /><span>Guide UV</span><i className={`status-dot${showGuide ? ' is-on' : ''}`} />
            </button>
          </div>
        </aside>

        {/* ----------------------------------------------------------- stage */}
        <main className="stage-col">
          <div className="texture-bar">
            <div className="surface-row">
            <span className="workspace-label">Surface</span>
            <div className="segmented segmented--sm">
              {(Object.keys(FAMILY_LABELS) as Family[]).map((f) => (
                <button key={f} type="button" aria-pressed={family === f} className={family === f ? 'is-active' : ''} onClick={() => setFamily(f)}>
                  <Icon name={f === 'skin' ? 'box' : f === 'wheels' ? 'circle' : 'sliders'} size={14} />
                  {FAMILY_LABELS[f]}
                  {MAPS.some((m) => m.group === f && dirtyMaps[m.id]) && <span className="dot" aria-hidden />}
                </button>
              ))}
            </div>
            </div>
            <div className="channel-row">
            <span className="workspace-label">Peinture</span>
            <div className="channel-tabs">
              {MAPS.filter((m) => m.group === family).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`channel-tab${activeMap === m.id ? ' is-active' : ''}`}
                  aria-pressed={activeMap === m.id}
                  onClick={() => setActiveMap(m.id)}
                  title={m.description}
                >
                  <Icon name={m.kind === 'roughmetal' ? 'sliders' : m.kind === 'illum' ? 'sun' : 'droplet'} size={14} /> {CHANNEL_LABELS[m.id]}
                  {dirtyMaps[m.id] && <span className="dot" aria-hidden />}
                </button>
              ))}
            </div>
            <div className="texture-bar-right">
              {compatibleTargets.length > 0 && (
                <div className="popover-anchor">
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm${copyOpen ? ' is-active' : ''}`}
                    onClick={() => setCopyOpen((v) => !v)}
                    title="Copier les calques de cette texture vers les textures liées"
                  >
                    <Icon name="copy" size={14} /> Copier vers…
                  </button>
                  {copyOpen && (
                    <div className="popover">
                      <div className="popover-title">Copier les calques de {CHANNEL_LABELS[activeMap]} vers</div>
                      <div className="stack">
                        {compatibleTargets.map((target) => (
                          <label key={target} className="check">
                            <input type="checkbox" checked={copyTargets.includes(target)} onChange={(e) => onToggleCopyTarget(target, e.target.checked)} />
                            <span>
                              {MAP_BY_ID[target].label}
                              <small>{MAP_BY_ID[target].fileName}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="segmented segmented--sm segmented--full">
                        <button type="button" className={copyMode === 'replace' ? 'is-active' : ''} onClick={() => setCopyMode('replace')}>
                          Remplacer
                        </button>
                        <button type="button" className={copyMode === 'overlay' ? 'is-active' : ''} onClick={() => setCopyMode('overlay')}>
                          Superposer
                        </button>
                      </div>
                      <p className="hint">Seuls les calques sont copiés ; le fond de destination est conservé. Les couleurs sont copiées sans conversion : réglez ensuite la matière ou le masque dans la destination. Ctrl+Maj+D copie vers toutes les textures liées.</p>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void runCopyToTargets(copyTargets, copyMode)}>
                        Appliquer
                      </button>
                    </div>
                  )}
                </div>
              )}
              <IconButton icon="trash" label={layers.some((layer) => layer.linked) ? 'Réinitialiser le fond et les calques indépendants' : 'Vider cette texture'} onClick={onClearMap} danger />
            </div>
            </div>
          </div>

          <div className={`stage stage--${view}`}>
            <div
              ref={canvasStageRef}
              className={`canvas-stage${tool === 'draw' ? ' canvas-stage--draw' : ''}${mapDef.kind === 'roughmetal' ? ` canvas-stage--${surfaceView}` : ''}`}
              onMouseMove={onCanvasFrameMove}
              onMouseLeave={onCanvasFrameLeave}
            >
              <div className={`canvas-frame${tool === 'draw' ? ' canvas-frame--draw' : ''}`} ref={canvasFrameRef}>
                <div ref={editorHostRef} className="canvas-host" />
                <div className="canvas-overlays" style={{ transform: overlayTransform }}>
                  {showGrid && <div className="grid-overlay" style={{ backgroundSize: `${100 / gridDiv}% ${100 / gridDiv}%` }} />}
                  <UvGuideOverlay activeMap={activeMap} visible={showGuide && guideIslands.length > 0} focusedRegion={family === 'skin' ? focusedRegion : null} />
                </div>
              </div>
              {mapDef.kind === 'roughmetal' && (
                <div className="float float--tl surface-view">
                  <div className="segmented segmented--sm" role="group" aria-label="Affichage de la matière">
                    <button type="button" aria-pressed={surfaceView === 'roughness'} className={surfaceView === 'roughness' ? 'is-active' : ''} onClick={() => setSurfaceView('roughness')}>Rugosité</button>
                    <button type="button" aria-pressed={surfaceView === 'metalness'} className={surfaceView === 'metalness' ? 'is-active' : ''} onClick={() => setSurfaceView('metalness')}>Métal</button>
                    <button type="button" aria-pressed={surfaceView === 'data'} className={surfaceView === 'data' ? 'is-active' : ''} onClick={() => setSurfaceView('data')}>Données</button>
                  </div>
                  <span>{surfaceView === 'roughness' ? 'Sombre = brillant · clair = mat' : surfaceView === 'metalness' ? 'Sombre = peinture · clair = métal' : 'Valeurs techniques de la texture'}</span>
                </div>
              )}
              <div className="float float--bl">
                <span className="float-item">
                  {MAP_BY_ID[activeMap].label} · {mapDef.workRes} px
                </span>
              </div>
              <div className="float float--br zoom">
                <IconButton size="sm" icon="minus" label="Zoom arrière" shortcut="-" onClick={onZoomOut} tipSide="left" />
                <button type="button" className="zoom-value" onClick={onZoomReset} title="Réinitialiser (0)">
                  {zoomPercent} %
                </button>
                <IconButton size="sm" icon="plus" label="Zoom avant" shortcut="+" onClick={onZoomIn} tipSide="left" />
              </div>
              <div ref={brushPreviewRef} className="brush-preview" aria-hidden />
            </div>

            <div className="viewer3d">
              <div ref={preview3dHostRef} className="viewer3d-host" />
              <div className="scene-toolbar" role="toolbar" aria-label="Édition de la voiture">
                <div className="scene-modes">
                  <button type="button" aria-pressed={sceneNavigation && !imagePlacement} className={sceneNavigation && !imagePlacement ? 'is-active' : ''} disabled={placingImage} onClick={() => { setImagePlacement(null); setExplore3D(true); }}><Icon name="rotate" size={16} /><span>Explorer</span></button>
                  <button type="button" aria-pressed={!explore3D && tool === 'select' && !imagePlacement} className={!explore3D && tool === 'select' && !imagePlacement ? 'is-active' : ''} disabled={placingImage} onClick={() => setTool('select')}><Icon name="move" size={16} /><span>Images</span></button>
                  <button type="button" aria-pressed={!explore3D && tool === 'draw' && !imagePlacement} className={!explore3D && tool === 'draw' && !imagePlacement ? 'is-active' : ''} disabled={placingImage} onClick={() => setTool('draw')}><Icon name="brush" size={16} /><span>Peindre</span></button>
                </div>
                <button type="button" className="scene-add" disabled={placingImage} onClick={() => imageInputRef.current?.click()}><Icon name="plus" size={16} /> Ajouter une image</button>
              </div>
              {imagePlacement && <div className="placement-banner" role="status">
                {imagePreview ? <img src={imagePreview} alt="Image à placer" /> : <Icon name="target" size={22} />}
                <div><strong>{placingImage ? 'Placement en cours…' : 'Cliquez sur la voiture pour placer l’image'}</strong><span>{'file' in imagePlacement ? imagePlacement.file.name : `Nouvel emplacement · ${FAMILY_LABELS[MAP_BY_ID[imagePlacement.mapId].group]}`}</span></div>
                <button type="button" className="btn btn-sm" disabled={placingImage} onClick={() => setImagePlacement(null)}>Annuler <kbd>Échap</kbd></button>
              </div>}
              {!imagePlacement && !explore3D && tool === 'select' && <div className="scene-selection"><span className="status-dot is-on" />{selection?.type === 'image' ? `${selection.name || 'Image'} · glissez pour déplacer` : 'Cliquez sur une image pour la sélectionner'}</div>}
              <div className="float float--bl">
                <span className="float-item">
                  {!explore3D && (tool === 'draw' || tool === 'select' || imagePlacement) ? (
                    <>
                      <Icon name={tool === 'draw' ? 'brush' : 'move'} size={12} /> Gauche : {imagePlacement ? 'placer l’image' : tool === 'draw' ? 'peindre' : 'déplacer l’image'} · droit : tourner · milieu : déplacer la vue ·
                      molette : zoom
                    </>
                  ) : (
                    <>
                      <Icon name="rotate" size={12} /> Gauche : tourner · droit ou milieu : déplacer · molette : zoom ·
                      double-clic : centrer
                    </>
                  )}
                </span>
                <span className="float-item float-item--muted">ZQSD / flèches : se déplacer · Pg↑ Pg↓ : monter / descendre</span>
              </div>
              <div className="float float--br">
                <IconButton
                  size="sm"
                  icon="target"
                  label="Recadrer la vue"
                  shortcut="F"
                  onClick={() => previewRef.current?.resetCamera()}
                  tipSide="top"
                />
              </div>
            </div>
          </div>
        </main>

        {/* -------------------------------------------------------- inspector */}
        <aside className="inspector">
          <div className={`inspector-preview${view !== '2d' ? ' is-hidden' : ''}`}>
            <div ref={previewHostRef} className="preview-host" />
            <IconButton icon="maximize" label="Agrandir la vue 3D" onClick={() => setView('split')} className="preview-expand" tipSide="left" />
          </div>
          <div className="inspector-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={inspectorTab === 'texture'} className={inspectorTab === 'texture' ? 'is-active' : ''} onClick={() => setInspectorTab('texture')}>
              <Icon name="droplet" size={14} /> Texture
            </button>
            <button type="button" role="tab" aria-selected={inspectorTab === 'props'} className={inspectorTab === 'props' ? 'is-active' : ''} onClick={() => setInspectorTab('props')}>
              <Icon name="sliders" size={14} /> {tool === 'select' ? 'Élément' : 'Outil'}
            </button>
            <button type="button" role="tab" aria-selected={inspectorTab === 'layers'} className={inspectorTab === 'layers' ? 'is-active' : ''} onClick={() => setInspectorTab('layers')}>
              <Icon name="layers" size={14} /> Calques
              {layers.length > 0 && <span className="count">{layers.length}</span>}
            </button>
          </div>
          <div className="inspector-context"><span>{FAMILY_LABELS[family]} <Icon name="chevronRight" size={12} /> {CHANNEL_LABELS[activeMap]}</span><strong>{inspectorTab === 'texture' ? 'Fond & pièces' : inspectorTab === 'layers' ? 'Calques' : tool !== 'select' ? 'Prochain tracé' : 'Sélection'}</strong></div>
          <div className="inspector-body">
            {imagePlacement ? <div className="placement-help"><Icon name="target" size={24} /><strong>Choisissez son emplacement</strong><p>Cliquez sur une surface de la voiture. Tournez la voiture avec le clic droit.</p>
              {'file' in imagePlacement && <div className="placement-settings">
                <Toggle label="Image lumineuse" checked={imagePlacement.channel === 'illum'} onChange={(on) => setImagePlacement({ ...imagePlacement, channel: on ? 'illum' : 'basecolor', material: on ? false : imagePlacement.material })} />
                {imagePlacement.channel === 'illum' && <p className="hint">Cliquez sur la carrosserie, les détails ou les roues. La projection épouse les surfaces et crée leurs calques lumineux liés. Noir = éteint.</p>}
                <Row label="Placement"><select aria-label="Mode de placement" disabled={placingImage} value={imagePlacement.mode} onChange={(e) => setImagePlacement({ ...imagePlacement, mode: e.target.value as 'projection' | 'uv' })}><option value="projection">Projection 3D · plusieurs pièces</option><option value="uv">Texture UV · une pièce</option></select></Row>
                <p className="hint">{imagePlacement.mode === 'projection' ? 'L’image est projetée depuis votre angle de vue et se découpe sur les surfaces visibles. Elle reste un seul élément déplaçable.' : 'L’image est limitée à la pièce choisie dans la texture.'}</p>
                {imagePlacement.channel !== 'illum' && <><Toggle label="Matière propre à l’image" checked={imagePlacement.material} onChange={(material) => setImagePlacement({ ...imagePlacement, material })} />
                <p className="hint">Ajoute une couche de rugosité et de métal liée au logo. Vous pourrez aussi l’activer après le placement.</p></>}
              </div>}
              <button type="button" className="btn btn-full" disabled={placingImage} onClick={() => setImagePlacement(null)}>Annuler le placement</button></div> : <>
            {mapDef.kind === 'illum' && inspectorTab !== 'layers' && renderLightPreview()}
            {inspectorTab === 'layers' ? renderLayers() : inspectorTab === 'texture' ? renderTextureProps() : tool !== 'select' ? (
              <Section title={`${currentTool?.label ?? 'Outil'} · prochain tracé`}>
                <div className="tool-settings">{renderToolOptions()}</div>
                {mapDef.kind === 'illum' && lightRoleControl('Comportement du prochain tracé', newLightRole, onNewLightRole)}
                <p className="hint">Ces réglages s’appliquent aux prochains éléments. Pour retoucher un dessin existant, utilisez Sélection puis l’onglet Élément.</p>
              </Section>
            ) : selection ? renderSelectionProps() : (
              <div className="empty studio-welcome"><div className="welcome-symbol"><Icon name={view === '3d' ? 'box' : 'select'} size={28} /></div><h2>{imagePlacement ? 'Prêt à placer votre image' : 'Créez votre livrée'}</h2><p>{view === '3d' ? 'Ajoutez un logo directement sur la voiture, ou commencez par peindre une pièce.' : 'Ajoutez un dessin, du texte ou un logo. Chaque élément reste modifiable.'}</p>
                {!imagePlacement && <><button type="button" className="btn btn-primary btn-full" onClick={() => imageInputRef.current?.click()}><Icon name="image" size={15} /> Ajouter une image</button><button type="button" className="btn btn-full" onClick={() => setInspectorTab('texture')}><Icon name="droplet" size={15} /> Couleurs et matières</button><button type="button" className="btn btn-ghost btn-full" onClick={() => setInspectorTab('layers')}><Icon name="layers" size={15} /> Retrouver mes calques</button></>}
              </div>
            )}
            </>}
          </div>
        </aside>
      </div>

      <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onImageChosen} />
      <input ref={refInputRef} type="file" accept="image/*" hidden onChange={onRefChosen} />
      <input ref={zipInputRef} type="file" accept=".zip" hidden onChange={onZipChosen} />

      {libraryOpen && <ProjectLibrary currentId={projectId} needsSave={projectModified && (dirtyCount > 0 || !!projectId || skinName !== 'MonSkin' || !!editorRef.current?.hasProjectContent() || !!skin3d || coatIntensity !== 1 || neonIntensity !== 1.4 || !dirtEnabled)}
        onClose={() => setLibraryOpen(false)} onSave={saveProject} onOpen={openSavedProject} onImport={importProjectFile} onDownloadCurrent={downloadCurrentProject}
        onRenameCurrent={(id, name) => { if (id === projectId) { const next = name.trim().slice(0, 120) || 'Sans titre'; setSkinName(next); setSavedAt(Date.now()); setSavedMetadata((before) => { if (!before) return null; const metadata = JSON.parse(before); metadata[0] = next; return JSON.stringify(metadata); }); } }}
        onDeleteCurrent={(id) => { if (id === projectId) { setProjectId(null); setSavedAt(null); setSavedMetadata(null); } }} />}

      {showRandom && (
        <RandomModal
          opts={randomOpts}
          onChange={setRandomOpts}
          onGenerate={onGenerate}
          onKeep={onRandomKeep}
          onCancel={() => void onRandomCancel()}
          generating={generating}
          previewHostRef={randomPreviewHostRef}
        />
      )}

      {busy && (
        <div className="busy-overlay">
          <div className="spinner" />
          <p>{busy}</p>
        </div>
      )}
      {clearRequested && <ConfirmDialog title="Réinitialiser cette texture ?" message={`Les calques indépendants de « ${MAP_BY_ID[clearRequested].label} » seront retirés et son fond réinitialisé.${layers.some((layer) => layer.linked) ? ' Les images et matières liées restent gérées par leur image : sélectionnez leur calque pour les modifier ou les retirer.' : ''}`} onCancel={() => setClearRequested(null)} onConfirm={confirmClearMap} />}
      {toast && (
        <div className="toast" role="status">
          <Icon name="info" size={14} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
