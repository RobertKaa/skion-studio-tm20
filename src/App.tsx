import { useCallback, useEffect, useRef, useState } from 'react';
import type { FabricObject, IText, Line } from 'fabric';
import { EditorCore, type LayerInfo, type Tool, type Transform } from './editor/EditorCore';
import { CarPreview, type PaintFamily } from './three/CarPreview';
import {
  ILLUM_ROLES,
  MAPS,
  MAP_BY_ID,
  REGIONS_BY_FAMILY,
  type IllumRole,
  type MapId,
} from './maps';
import { exportSkinZip, formatImportError, importSkinZip, rgbaToCanvas } from './skinZip';
import RandomModal from './RandomModal';
import UvGuideOverlay from './UvGuideOverlay';
import { UV_GUIDE_BY_FAMILY } from './uvGuideData';
import {
  FINISH_LABELS,
  PATTERN_LABELS,
  generateSkin,
  type GeneratorOptions,
} from './generator';

const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: 'Sélection', icon: '⬚', hint: 'Déplacer / redimensionner (V)' },
  { id: 'draw', label: 'Pinceau', icon: '✎', hint: 'Dessin libre (B) · taille : [ / ] (touches physiques) ou Ctrl+molette' },
  { id: 'rect', label: 'Rectangle', icon: '▭', hint: 'Glisser pour tracer (R)' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯', hint: 'Glisser pour tracer (E)' },
  { id: 'line', label: 'Ligne', icon: '╱', hint: 'Glisser pour tracer (L)' },
  { id: 'polygon', label: 'Polygone', icon: '⬠', hint: 'Polygone / étoile — glisser pour tracer (P)' },
  { id: 'text', label: 'Texte', icon: 'T', hint: 'Cliquer pour placer (T)' },
  { id: 'eyedropper', label: 'Pipette', icon: '💧', hint: 'Cliquer sur la texture pour prélever une couleur (I)' },
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

/** Convertit un hex (#rrggbb) en triplet 0..255, tolérant aux valeurs invalides. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

const pct = (v: number) => `${Math.round((v / 255) * 100)} %`;

interface SelectionState {
  type: string;
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
}

/** Vrai si une valeur de remplissage fabric correspond à « sans remplissage ». */
function isNoFill(fill: unknown): boolean {
  if (fill == null || fill === '') return true;
  if (typeof fill !== 'string') return false;
  const f = fill.trim().toLowerCase();
  return f === 'transparent' || f === 'rgba(0,0,0,0)' || f === 'rgba(0, 0, 0, 0)';
}

export default function App() {
  const editorHostRef = useRef<HTMLDivElement>(null);
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
  const [bgColor, setBgColor] = useState(MAP_BY_ID.Skin_B.defaultFill);
  const [showGuide, setShowGuide] = useState(true);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const [skinName, setSkinName] = useState('MonSkin');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRandom, setShowRandom] = useState(false);
  const [illumRole, setIllumRole] = useState<IllumRole>('always');
  const [coatIntensity, setCoatIntensity] = useState(1);
  const [neonIntensity, setNeonIntensity] = useState(1.4);
  const [braking, setBraking] = useState(false);
  const [edit3D, setEdit3D] = useState(false);
  /** Vue active : éditeur 2D classique ou grande vue d'édition 3D. */
  const [view, setView] = useState<'2d' | '3d'>('2d');

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

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const readSelection = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const obj = ed.getSelection();
    if (!obj) {
      setSelection(null);
      setTransformState(null);
      return;
    }
    setTransformState(ed.getTransform());
    const anyObj = obj as FabricObject & Partial<IText> & Partial<Line>;
    const dash = (obj as FabricObject & { strokeDashArray?: number[] | null })
      .strokeDashArray;
    setSelection({
      type: obj.type,
      fill: typeof obj.fill === 'string' ? obj.fill : '#000000',
      noFill: isNoFill(obj.fill),
      opacity: obj.opacity ?? 1,
      stroke: typeof obj.stroke === 'string' ? obj.stroke : '#ffffff',
      strokeWidth: obj.strokeWidth ?? 0,
      dashed: Array.isArray(dash) && dash.length > 0,
      hasShadow: !!obj.shadow,
      fontSize: anyObj.fontSize,
      fontFamily: anyObj.fontFamily,
      text: anyObj.text,
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

    const pushTextures = () => {
      for (const def of MAPS) {
        pv.setMapCanvas(def.id, ed.getCanvasElement(def.id));
      }
    };
    const offTexture = ed.on('texture', pushTextures);
    const offLayers = ed.on('layers', () => {
      setLayers(ed.getLayers());
      setHasRef(ed.hasReference());
    });
    const offSel = ed.on('selection', readSelection);

    // Pipette : prélève une couleur du canvas vers le remplissage + le pinceau.
    ed.pickHandler = (hex: string) => {
      setFillColor(hex);
      setLastFill(hex);
      setFillEnabled(true);
      ed.fillColor = hex;
      ed.fillEnabled = true;
      setBrushColor(hex);
      ed.setBrush(hex, ed.brushSize);
      notify(`Couleur prélevée : ${hex.toUpperCase()}`);
    };
    const offHist = ed.on('history', () =>
      setHistoryState({ undo: ed.canUndo(), redo: ed.canRedo() }),
    );
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
    const resolveTarget = (family: PaintFamily): MapId => {
      const current = MAP_BY_ID[activeMapRef.current];
      if (current.group === family) return activeMapRef.current;
      return family === 'wheels' ? 'Wheels_B' : family === 'details' ? 'Details_B' : 'Skin_B';
    };
    const uvToXY = (mapId: MapId, u: number, v: number) => {
      const res = MAP_BY_ID[mapId].workRes;
      return { x: u * res, y: (1 - v) * res };
    };
    pv.setPaintHandler({
      begin: (family, u, v) => {
        const target = resolveTarget(family);
        if (target !== activeMapRef.current) {
          ed.setActiveMap(target);
          activeMapRef.current = target;
          setActiveMapState(target);
          setBgColor(ed.getBackgroundColor());
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

    pushTextures();
    setLayers(ed.getLayers());
    setReady(true);

    return () => {
      offTexture();
      offLayers();
      offSel();
      offHist();
      offViewport();
      offBrush();
      pv.dispose();
      ed.dispose();
      editorRef.current = null;
      previewRef.current = null;
    };
  }, [readSelection]);

  // Rebranche le rendu 3D sur le bon conteneur (petit aperçu vs grande vue) et
  // s'assure que le renderer se redimensionne au changement de mise en page.
  useEffect(() => {
    const pv = previewRef.current;
    if (!pv || !ready) return;
    const host = view === '3d' ? preview3dHostRef.current : previewHostRef.current;
    if (host) pv.mount(host);
  }, [view, ready]);

  // En vue 3D la peinture est toujours active ; en vue 2D elle suit le bouton.
  useEffect(() => {
    previewRef.current?.setEdit3D(view === '3d' ? true : edit3D);
  }, [view, edit3D, ready]);

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

  // --------------------------------------------------------------- shortcuts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ed = editorRef.current;
      if (!ed) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
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
        e.preventDefault();
        ed.duplicateSelection();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        ed.deleteSelection();
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
        ed.setTool(t);
        setToolState(t);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------------------------ actions

  const setActiveMap = (id: MapId) => {
    editorRef.current?.setActiveMap(id);
    setActiveMapState(id);
    setBgColor(editorRef.current?.getBackgroundColor() ?? '#000000');
    const nextGroup = MAP_BY_ID[id].group;
    const nextIslands = UV_GUIDE_BY_FAMILY[nextGroup];
    if (clipIsland && !nextIslands.some((i) => i.key === clipIsland)) {
      setClipIsland(null);
      editorRef.current?.setClipIsland(null);
    }
    if (focusedRegion && nextGroup !== 'skin') {
      setFocusedRegion(null);
      editorRef.current?.focusRegion(null);
    } else if (focusedRegion && nextGroup === 'skin') {
      editorRef.current?.focusRegion(focusedRegion);
    }
    if (centerTarget && !nextIslands.some((i) => i.key === centerTarget)) {
      setCenterTarget('');
    }
    setHasRef(editorRef.current?.hasReference() ?? false);
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
      editorRef.current?.focusRegion(key);
    } else {
      editorRef.current?.setClipIsland(key);
    }
  };

  const onFocusRegion = (key: string | null) => {
    setFocusedRegion(key);
    setClipIsland(key);
    editorRef.current?.focusRegion(key);
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

  const onTransform = (p: Partial<Transform>) => {
    editorRef.current?.setTransform(p);
    setTransformState(editorRef.current?.getTransform() ?? null);
  };

  const onCenterInIsland = () => {
    if (!centerTarget) return;
    editorRef.current?.centerSelectionInIsland(centerTarget);
    setTransformState(editorRef.current?.getTransform() ?? null);
  };

  const onToggleCarAligned = () => {
    setCarAligned((v) => {
      const next = !v;
      editorRef.current?.setCarAligned(next);
      return next;
    });
  };

  const onRefChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await editorRef.current?.addReferenceUnderlay(file);
    setRefOpacity(0.5);
    setHasRef(editorRef.current?.hasReference() ?? false);
  };

  const onRefOpacity = (v: number) => {
    setRefOpacity(v);
    editorRef.current?.setReferenceOpacity(v);
  };

  const setTool = (t: Tool) => {
    editorRef.current?.setTool(t);
    setToolState(t);
  };

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

  /** Bascule le remplissage de l'objet sélectionné entre transparent et sa dernière couleur. */
  const onSelNoFill = (checked: boolean) => {
    if (!selection) return;
    if (checked) {
      if (selection.fill.startsWith('#')) setLastFill(selection.fill);
      const props: Record<string, unknown> = { fill: 'transparent' };
      // Assurer un contour visible, sinon la forme devient invisible.
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

  const onBgChange = (color: string) => {
    setBgColor(color);
    editorRef.current?.setBackgroundColor(color);
  };

  /** Écrit le fond d'une map _R : R = rugosité, G = métal. */
  const onRoughMetalChange = (rough: number, metal: number) => {
    onBgChange(toHex(rough, metal, 0));
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

  const onImageChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await editorRef.current?.addImageFromFile(file);
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
      const applyErrors: string[] = [];
      for (const { id, image, path } of result.imported) {
        const label = MAP_BY_ID[id]?.fileName ?? path;
        try {
          const canvas = rgbaToCanvas(image);
          if (!canvas) {
            applyErrors.push(`${label} : conversion canvas impossible`);
            continue;
          }
          ed.setBackgroundFromCanvas(id, canvas, { flush: false });
          applied.push(label);
        } catch (err) {
          applyErrors.push(formatImportError(label, err));
        }
      }
      if (applied.length) ed.flushTexture();
      if (applied.length) setBgColor(ed.getBackgroundColor());
      setSkinName(file.name.replace(/\.zip$/i, ''));
      if (applied.length) {
        const parts = [`${applied.length} texture(s) importée(s)`];
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

  const onExport = async () => {
    const ed = editorRef.current;
    const pv = previewRef.current;
    if (!ed || !pv) return;
    setBusy('Encodage DDS + création du zip…');
    // laisse le temps à l'overlay de s'afficher avant le travail CPU
    await new Promise((r) => setTimeout(r, 30));
    try {
      ed.flushTexture();
      const blob = await exportSkinZip(skinName, {
        getMapCanvas: (id) => ed.getCanvasElement(id),
        illumRole,
        icon: pv.snapshot(256),
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${skinName || 'skin'}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      notify(
        'Zip exporté. Placez-le dans Documents/Trackmania/Skins/Models/CarSport/ puis Garage > Upload skin.',
      );
    } catch (err) {
      notify(`Échec de l'export : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const updateSel = (props: Record<string, unknown>) => {
    editorRef.current?.updateSelection(props);
  };

  const onGenerate = async (opts: GeneratorOptions) => {
    const ed = editorRef.current;
    if (!ed) return;
    setBusy('Génération du skin…');
    // laisse le loader s'afficher avant le travail sur les canvas
    await new Promise((r) => setTimeout(r, 30));
    try {
      const summary = generateSkin(ed, opts);
      setBgColor(ed.getBackgroundColor());
      notify(
        `Skin généré : ${PATTERN_LABELS[summary.pattern]}, finition ${FINISH_LABELS[
          summary.finish
        ].toLowerCase()} (graine ${summary.seed}). Re-cliquez sur « Générer » pour une autre variante.`,
      );
    } catch (err) {
      notify(`Échec de la génération : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const mapDef = MAP_BY_ID[activeMap];
  const guideIslands = UV_GUIDE_BY_FAMILY[mapDef.group];
  /** Zones « Remplir une pièce » de la famille active (carrosserie ou détails). */
  const regionSet = REGIONS_BY_FAMILY[mapDef.group];
  /** Les zones details sont dispersées : le remplissage doit être découpé sur les contours. */
  const clipFillZones = mapDef.group === 'details';
  const [roughVal, metalVal] = hexToRgb(bgColor);

  // --------------------------------------------------------------------- UI

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-badge">TM</span> Skin Studio
          <span className="brand-sub">Trackmania 2020 · CarSport</span>
        </div>
        <div className="topbar-actions">
          <input
            className="skin-name"
            value={skinName}
            onChange={(e) => setSkinName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))}
            placeholder="Nom du skin"
            title="Nom du fichier zip exporté"
          />
          <button onClick={() => setShowRandom(true)} disabled={!ready}>
            🎲 Aléatoire
          </button>
          <button onClick={() => zipInputRef.current?.click()} disabled={!ready}>
            Importer un skin (.zip)
          </button>
          <button className="primary" onClick={onExport} disabled={!ready}>
            Exporter le skin (.zip)
          </button>
        </div>
      </header>

      <div className="view-switch">
        <button
          className={`view-tab ${view === '2d' ? 'active' : ''}`}
          onClick={() => setView('2d')}
          title="Éditeur de textures 2D (calques, formes, texte…)"
        >
          🖼 Éditeur 2D
        </button>
        <button
          className={`view-tab ${view === '3d' ? 'active' : ''}`}
          onClick={() => setView('3d')}
          disabled={!ready}
          title="Grande vue 3D pour peindre directement sur la voiture"
        >
          🎨 Édition 3D
        </button>
      </div>

      <div className="workspace">
        {/* ================================================= mise en page 2D */}
        <div className="layout-2d" style={{ display: view === '2d' ? 'flex' : 'none' }}>
        {/* ----------------------------------------------------- barre d'outils */}
        <aside className="toolbar">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool ${tool === t.id ? 'active' : ''}`}
              title={t.hint}
              onClick={() => setTool(t.id)}
            >
              <span className="tool-icon">{t.icon}</span>
              <span className="tool-label">{t.label}</span>
            </button>
          ))}
          <button
            className="tool"
            title="Ajouter une image (logo, sticker…)"
            onClick={() => imageInputRef.current?.click()}
          >
            <span className="tool-icon">🖼</span>
            <span className="tool-label">Image</span>
          </button>

          <div className="tool-sep" />

          <label className="tool-field">
            <span>Remplissage</span>
            <input
              type="color"
              value={fillColor}
              disabled={!fillEnabled}
              onChange={(e) => onFillChange(e.target.value)}
            />
          </label>
          <button
            className={`tool ${!fillEnabled ? 'active' : ''}`}
            onClick={() => onFillEnabled(!fillEnabled)}
            title="Sans remplissage : les nouvelles formes n'ont qu'un contour (ex. anneau / cercle vide)"
          >
            <span className="tool-icon">⭕</span>
            <span className="tool-label">{fillEnabled ? 'Rempli' : 'Sans rempl.'}</span>
          </button>
          <label className="tool-field">
            <span>Opacité rempl. {Math.round(fillAlpha * 100)} %</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={fillAlpha}
              disabled={!fillEnabled}
              onChange={(e) => onFillAlpha(Number(e.target.value))}
            />
          </label>

          <div className="tool-sep" />

          <label className="tool-field">
            <span>Contour</span>
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => onStrokeColor(e.target.value)}
            />
          </label>
          <label className="tool-field">
            <span>Épaisseur {strokeWidth}</span>
            <input
              type="range"
              min={0}
              max={40}
              value={strokeWidth}
              onChange={(e) => onStrokeWidth(Number(e.target.value))}
            />
          </label>
          <button
            className={`tool ${strokeDashed ? 'active' : ''}`}
            onClick={() => onStrokeDashed(!strokeDashed)}
            title="Contour en pointillés pour les nouvelles formes"
          >
            <span className="tool-icon">┈</span>
            <span className="tool-label">Pointillés</span>
          </button>

          {tool === 'polygon' && (
            <>
              <div className="tool-sep" />
              <label className="tool-field">
                <span>{polygonStar ? 'Branches' : 'Côtés'} {polygonSides}</span>
                <input
                  type="range"
                  min={3}
                  max={12}
                  value={polygonSides}
                  onChange={(e) => onPolygonSides(Number(e.target.value))}
                />
              </label>
              <button
                className={`tool ${polygonStar ? 'active' : ''}`}
                onClick={() => onPolygonStar(!polygonStar)}
                title="Basculer entre polygone régulier et étoile"
              >
                <span className="tool-icon">★</span>
                <span className="tool-label">{polygonStar ? 'Étoile' : 'Polygone'}</span>
              </button>
            </>
          )}

          <div className="tool-sep" />

          <label className="tool-field">
            <span>Pinceau</span>
            <input
              type="color"
              value={brushColor}
              onChange={(e) => onBrushChange(e.target.value, brushSize)}
            />
          </label>
          <label className="tool-field tool-field--brush-size">
            <span className="brush-size-label">Taille {brushSize}</span>
            <input
              type="range"
              min={2}
              max={120}
              value={brushSize}
              onChange={(e) => onBrushChange(brushColor, Number(e.target.value))}
              title="Réduire / agrandir : [ / ] (touches physiques, AZERTY/QWERTY) ou Ctrl+molette"
            />
          </label>
          <label className="tool-field">
            <span>Lissage {Math.round(brushSmoothing * 100)} %</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={brushSmoothing}
              onChange={(e) => onBrushSmoothing(Number(e.target.value))}
              title="Stabilise les traits libres (réduit les tremblements)"
            />
          </label>
          <label className="tool-field">
            <span>Fond</span>
            <input type="color" value={bgColor} onChange={(e) => onBgChange(e.target.value)} />
          </label>

          <div className="tool-sep" />

          <button
            className={`tool ${showGuide ? 'active' : ''}`}
            onClick={() => setShowGuide((v) => !v)}
            title="Afficher les silhouettes UV précises (capot, flancs, aileron…)"
          >
            <span className="tool-icon">▦</span>
            <span className="tool-label">Guide</span>
          </button>
          <button
            className={`tool ${symmetry ? 'active' : ''}`}
            onClick={onToggleSymmetry}
            title="Symétrie gauche/droite : chaque ajout est dupliqué en miroir sur l'axe vertical central"
          >
            <span className="tool-icon">⇄</span>
            <span className="tool-label">Symétrie</span>
          </button>
          <button
            className={`tool ${showGrid ? 'active' : ''}`}
            onClick={onToggleGrid}
            title="Grille + magnétisme : aligne les objets déplacés sur la grille"
          >
            <span className="tool-icon">▤</span>
            <span className="tool-label">Grille</span>
          </button>
          <button
            className="tool"
            disabled={!historyState.undo}
            onClick={() => editorRef.current?.undo()}
            title="Annuler (Ctrl+Z)"
          >
            <span className="tool-icon">↩</span>
            <span className="tool-label">Annuler</span>
          </button>
          <button
            className="tool"
            disabled={!historyState.redo}
            onClick={() => editorRef.current?.redo()}
            title="Rétablir (Ctrl+Shift+Z)"
          >
            <span className="tool-icon">↪</span>
            <span className="tool-label">Rétablir</span>
          </button>
          <button
            className="tool danger"
            onClick={() => {
              if (confirm(`Vider la texture « ${mapDef.label} » ?`)) {
                editorRef.current?.clearMap();
                setBgColor(editorRef.current?.getBackgroundColor() ?? '#000000');
              }
            }}
            title="Réinitialiser la texture affichée"
          >
            <span className="tool-icon">🗑</span>
            <span className="tool-label">Vider</span>
          </button>
        </aside>

        {/* ------------------------------------------------------------ éditeur */}
        <main className="editor-pane">
          <div className="map-tabs">
            {MAPS.map((m) => (
              <button
                key={m.id}
                className={`map-tab ${activeMap === m.id ? 'active' : ''}`}
                onClick={() => setActiveMap(m.id)}
                title={m.description}
              >
                {m.label}
                <span className="map-file">{m.fileName}</span>
              </button>
            ))}
          </div>
          <p className="map-hint">{mapDef.description}</p>
          {mapDef.group === 'skin' && guideIslands.length > 0 && (
            <div className="focus-region-bar">
              <label className="focus-region-label">
                Élément à éditer
                <select
                  className="focus-region-select"
                  value={focusedRegion ?? ''}
                  onChange={(e) => onFocusRegion(e.target.value || null)}
                  title="Isole une pièce de carrosserie : zoom, rognage du pinceau et surbrillance du repère UV"
                >
                  <option value="">Vue complète (toutes les zones)</option>
                  {guideIslands.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </label>
              {focusedRegion && (
                <span className="focus-region-hint muted small">
                  Édition limitée à <b>{guideIslands.find((i) => i.key === focusedRegion)?.label}</b>
                  {' · '}
                  <button type="button" className="linkish" onClick={() => onFocusRegion(null)}>
                    Tout voir
                  </button>
                </span>
              )}
            </div>
          )}
          <div className="editor-status">
            <span>
              Outil : <b>{TOOLS.find((t) => t.id === tool)?.label ?? tool}</b>
            </span>
            <span>
              Texture : <b>{mapDef.label}</b>
            </span>
            {edit3D && <span className="status-3d">● Peinture 3D active</span>}
            {tool === 'draw' && (
              <span>
                Pinceau : <b>{brushSize} px</b>
                <span className="muted"> · [ / ] · Ctrl+molette</span>
              </span>
            )}
            <span className="zoom-hint muted">
              Molette ou − / + = zoom · Ctrl+molette (pinceau) = taille · [ / ] = taille · Espace/Alt/clic milieu = déplacer · Double-clic = réinitialiser
            </span>
          </div>
          <div
            className={`canvas-stage${tool === 'draw' ? ' canvas-stage--draw' : ''}`}
            onMouseMove={onCanvasFrameMove}
            onMouseLeave={onCanvasFrameLeave}
          >
            <div
              className={`canvas-frame${tool === 'draw' ? ' canvas-frame--draw' : ''}`}
              ref={canvasFrameRef}
            >
              <div ref={editorHostRef} className="canvas-host" />
              <div
                className="canvas-overlays"
                style={{ transform: overlayTransform }}
              >
                {showGrid && (
                  <div
                    className="grid-overlay"
                    style={{ backgroundSize: `${100 / gridDiv}% ${100 / gridDiv}%` }}
                  />
                )}
                <UvGuideOverlay
                  activeMap={activeMap}
                  visible={showGuide && guideIslands.length > 0}
                  focusedRegion={mapDef.group === 'skin' ? focusedRegion : null}
                />
              </div>
              <div className="zoom-controls">
                <button type="button" onClick={onZoomOut} title="Zoom arrière (-)">
                  −
                </button>
                <span className="zoom-label">{zoomPercent} %</span>
                <button type="button" onClick={onZoomIn} title="Zoom avant (+)">
                  +
                </button>
                <button type="button" onClick={onZoomReset} title="Réinitialiser le zoom (0)">
                  Réinitialiser
                </button>
              </div>
            </div>
            <div ref={brushPreviewRef} className="brush-preview" aria-hidden />
          </div>
        </main>

        {/* ------------------------------------------------- panneau de droite */}
        <aside className="side-panel">
          <div className="preview-box">
            <div className="preview-toolbar">
              <button
                className={`edit3d-toggle ${edit3D ? 'on' : ''}`}
                onClick={() => setEdit3D((v) => !v)}
                disabled={!ready}
                title="Peindre directement sur la voiture en 3D avec le pinceau"
              >
                🖌 {edit3D ? 'Peinture 3D : ON' : 'Peindre sur la 3D'}
              </button>
            </div>
            <div ref={previewHostRef} className="preview-host" />
            {edit3D ? (
              <span className="preview-hint">
                <b>Clic gauche</b> = peindre · <b>clic droit</b> = tourner · <b>molette</b> = zoom.
                Réglez la couleur et la taille du <b>pinceau</b> à gauche. La texture peinte s'ouvre
                automatiquement dans l'éditeur 2D.
              </span>
            ) : (
              <span className="preview-caption">
                Aperçu 3D temps réel — activez « Peindre sur la 3D » pour peindre dessus
              </span>
            )}
          </div>

          {/* ---- Réglages contextuels de la map active ---- */}
          {mapDef.kind === 'roughmetal' && (
            <section className="panel map-settings">
              <h3>Matière · {mapDef.label}</h3>
              <div className="prop-grid">
                <label className="full">
                  Rugosité : {pct(roughVal)}{' '}
                  <span className="muted">(0 = miroir, 100 = mat)</span>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={roughVal}
                    onChange={(e) => onRoughMetalChange(Number(e.target.value), metalVal)}
                  />
                </label>
                <label className="full">
                  Métal : {pct(metalVal)}{' '}
                  <span className="muted">(0 = peinture, 100 = chrome)</span>
                  <input
                    type="range"
                    min={0}
                    max={255}
                    value={metalVal}
                    onChange={(e) => onRoughMetalChange(roughVal, Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="muted small">
                Ces curseurs règlent le fond de la texture (rouge = rugosité, vert = métal).
                Vous pouvez aussi peindre zone par zone : rouge foncé = brillant, rouge vif =
                mat, vert = métallique.
              </p>
            </section>
          )}

          {mapDef.kind === 'illum' && (
            <section className="panel map-settings">
              <h3>Néon / feux · {mapDef.label}</h3>
              <div className="prop-grid">
                <label className="full">
                  Rôle des zones lumineuses
                  <select
                    value={illumRole}
                    onChange={(e) => setIllumRole(e.target.value as IllumRole)}
                  >
                    {ILLUM_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="full">
                  Intensité de l'aperçu : {neonIntensity.toFixed(1)}
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.1}
                    value={neonIntensity}
                    onChange={(e) => onNeonIntensity(Number(e.target.value))}
                  />
                </label>
                <label className="full checkbox-row">
                  <input
                    type="checkbox"
                    checked={braking}
                    onChange={(e) => onBraking(e.target.checked)}
                  />
                  <span>Simuler le freinage (booste les feux)</span>
                </label>
              </div>
              <p className="muted small">
                Peignez en couleur vive les zones qui doivent briller ; le noir reste éteint. Le
                rôle est écrit dans le canal alpha à l'export : <b>toujours allumé</b> (néon),
                <b> phares</b> (nuit) ou <b>feux de frein</b> (au freinage). Le néon/fluo de la{' '}
                <i>carrosserie</i> se choisit en jeu via la peinture, ce n'est pas une texture.
              </p>
            </section>
          )}

          {activeMap === 'Skin_CoatR' && (
            <section className="panel map-settings">
              <h3>Vernis (clearcoat)</h3>
              <div className="prop-grid">
                <label className="full">
                  Intensité du vernis (aperçu) : {pct(Math.round(coatIntensity * 255))}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={coatIntensity}
                    onChange={(e) => onCoatIntensity(Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="muted small">
                Le vernis ajoute une couche transparente brillante par-dessus la peinture (reflets
                façon carrosserie vernie / paillettes). Peignez en <b>blanc</b> les zones vernies,
                laissez en <b>noir</b> les zones mates. Le curseur ne règle que l'aperçu ; en jeu
                c'est la map qui décide.
              </p>
            </section>
          )}

          {regionSet && (
            <section className="panel region-fill">
              <h3>Remplir une pièce</h3>
              <p className="muted small">
                {clipFillZones ? (
                  <>
                    Pose un aplat de la couleur de <b>remplissage</b> sur la zone de détail choisie
                    (aileron, diffuseur, entrées d'air…). Le remplissage est <b>découpé sur les
                    contours réels</b> de la zone — même dispersée sur l'atlas UV.
                  </>
                ) : (
                  <>
                    Pose un aplat de la couleur de <b>remplissage</b> sur la pièce choisie (calque
                    éditable, déplaçable). Idéal pour colorer vite un capot, un flanc, l'aileron…
                  </>
                )}
              </p>
              <div className="region-grid">
                {Object.entries(regionSet).map(([key, r]) => (
                  <button
                    key={key}
                    onClick={() =>
                      editorRef.current?.fillRegion(r, clipFillZones ? key : undefined)
                    }
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {mapDef.group === 'wheels' && (
            <section className="panel map-settings">
              <h3>Côté des roues (jantes)</h3>
              <p className="muted small">
                La texture des roues déplie chaque roue en deux parties : le <b>flanc/jante</b>{' '}
                (le côté visible, disque + rayons) et la <b>bande de roulement du pneu</b>. Pour
                décorer le côté de la roue, peignez la jante sur <code>Wheels_B</code> (couleur)
                et montez le métal sur <code>Wheels_R</code> pour un rendu chromé. Astuce :
                importez un skin existant pour voir précisément où tombe chaque zone.
              </p>
            </section>
          )}

          {selection && (
            <section className="panel">
              <h3>Objet sélectionné</h3>
              <div className="prop-grid">
                <label>
                  Couleur
                  <input
                    type="color"
                    value={selection.fill.startsWith('#') ? selection.fill : '#000000'}
                    onChange={(e) =>
                      selection.type === 'line'
                        ? updateSel({ stroke: e.target.value })
                        : updateSel({ fill: e.target.value })
                    }
                  />
                </label>
                <label>
                  Opacité
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={selection.opacity}
                    onChange={(e) => updateSel({ opacity: Number(e.target.value) })}
                  />
                </label>
                {selection.type !== 'line' && (
                  <>
                    <label className="checkbox-row full">
                      <input
                        type="checkbox"
                        checked={selection.noFill}
                        onChange={(e) => onSelNoFill(e.target.checked)}
                      />
                      <span>Sans remplissage (contour seul)</span>
                    </label>
                    <label>
                      Contour
                      <input
                        type="color"
                        value={selection.stroke.startsWith('#') ? selection.stroke : '#ffffff'}
                        onChange={(e) => updateSel({ stroke: e.target.value })}
                      />
                    </label>
                    <label>
                      Épaisseur {selection.strokeWidth}
                      <input
                        type="range"
                        min={0}
                        max={40}
                        value={selection.strokeWidth}
                        onChange={(e) => updateSel({ strokeWidth: Number(e.target.value) })}
                      />
                    </label>
                    <label className="checkbox-row full">
                      <input
                        type="checkbox"
                        checked={selection.dashed}
                        onChange={(e) => onSelDashed(e.target.checked)}
                      />
                      <span>Contour en pointillés</span>
                    </label>
                  </>
                )}
                {(selection.type === 'i-text' || selection.type === 'text') && (
                  <>
                    <label className="full">
                      Police
                      <select
                        value={selection.fontFamily}
                        onChange={(e) => updateSel({ fontFamily: e.target.value })}
                      >
                        {FONTS.map((f) => (
                          <option key={f} value={f}>
                            {f.split(',')[0]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Taille {selection.fontSize}
                      <input
                        type="range"
                        min={12}
                        max={300}
                        value={selection.fontSize ?? 72}
                        onChange={(e) => updateSel({ fontSize: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
              </div>
              {transform && (
                <div className="transform-panel">
                  <span className="muted small">Position &amp; taille (pixels de la texture)</span>
                  <div className="transform-grid">
                    <label>
                      X
                      <input
                        type="number"
                        value={transform.x}
                        onChange={(e) => onTransform({ x: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        value={transform.y}
                        onChange={(e) => onTransform({ y: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Largeur
                      <input
                        type="number"
                        min={1}
                        value={transform.w}
                        onChange={(e) => onTransform({ w: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Hauteur
                      <input
                        type="number"
                        min={1}
                        value={transform.h}
                        onChange={(e) => onTransform({ h: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Angle °
                      <input
                        type="number"
                        value={transform.angle}
                        onChange={(e) => onTransform({ angle: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  {guideIslands.length > 0 && (
                    <div className="transform-center">
                      <select
                        value={centerTarget}
                        onChange={(e) => setCenterTarget(e.target.value)}
                        title="Pièce sur laquelle centrer l'objet"
                      >
                        <option value="">Choisir une pièce…</option>
                        {guideIslands.map((i) => (
                          <option key={i.key} value={i.key}>
                            {i.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={onCenterInIsland}
                        disabled={!centerTarget}
                        title={
                          carAligned
                            ? 'Centre et oriente le décalque pour qu\u2019il soit droit sur la voiture'
                            : 'Centre le décalque sans le réorienter'
                        }
                      >
                        {carAligned ? 'Centrer + aligner voiture' : 'Centrer dans la pièce'}
                      </button>
                      <label className="checkbox-row full" title="Oriente le décalque/numéro selon la pièce de la voiture (haut/avant), pas selon le canvas d'édition">
                        <input type="checkbox" checked={carAligned} onChange={onToggleCarAligned} />
                        <span>Aligner sur la voiture (numéros / décalques droits)</span>
                      </label>
                    </div>
                  )}
                </div>
              )}
              <div className="btn-row">
                <button onClick={() => editorRef.current?.flipSelection('x')}>Miroir ↔</button>
                <button onClick={() => editorRef.current?.flipSelection('y')}>Miroir ↕</button>
                <button
                  className={selection.hasShadow ? 'on' : ''}
                  onClick={() => editorRef.current?.toggleShadow()}
                >
                  Ombre
                </button>
                <button onClick={() => editorRef.current?.duplicateSelection()}>Dupliquer</button>
                <button className="danger" onClick={() => editorRef.current?.deleteSelection()}>
                  Supprimer
                </button>
              </div>
            </section>
          )}

          <section className="panel precision-panel">
            <h3>Précision</h3>
            <div className="precision-grid">
              <label className="checkbox-row">
                <input type="checkbox" checked={symmetry} onChange={onToggleSymmetry} />
                <span>Symétrie gauche/droite (miroir automatique)</span>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={showGrid} onChange={onToggleGrid} />
                <span>Grille + magnétisme au déplacement</span>
              </label>
              {showGrid && (
                <label className="full">
                  Divisions de la grille : {gridDiv}
                  <select value={gridDiv} onChange={(e) => onGridDiv(Number(e.target.value))}>
                    {[8, 16, 32, 64].map((d) => (
                      <option key={d} value={d}>
                        {d} × {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {guideIslands.length > 0 && (
                <label className="full">
                  Limiter à la pièce
                  <select
                    value={clipIsland ?? ''}
                    onChange={(e) => onClipIsland(e.target.value || null)}
                    title="Le dessin est rogné aux contours de la pièce choisie (pas de débordement)"
                  >
                    <option value="">Aucune (toute la texture)</option>
                    {guideIslands.map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="precision-ref">
              <button onClick={() => refInputRef.current?.click()}>
                🖼 Calque de référence (traçage)
              </button>
              {hasRef && (
                <label className="full">
                  Opacité de la référence : {Math.round(refOpacity * 100)} %
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={refOpacity}
                    onChange={(e) => onRefOpacity(Number(e.target.value))}
                  />
                </label>
              )}
            </div>
            <p className="muted small">
              La symétrie reflète chaque forme, texte, image ou trait sur l'axe vertical
              central (les deux moitiés restent des calques éditables). « Limiter à la pièce »
              rogne le dessin aux contours UV. Le calque de référence est verrouillé et
              semi-transparent pour décalquer un logo. Maintenez <b>Maj</b> pour tracer une
              ligne droite (pinceau), un carré/cercle (formes) ou des angles à 45° (ligne).
            </p>
          </section>

          <section className="panel layers-panel">
            <h3>
              Calques <span className="muted">({layers.length})</span>
            </h3>
            {layers.length === 0 && (
              <p className="muted small">
                Aucun calque. Dessinez, ajoutez du texte, une forme ou une image.
              </p>
            )}
            <ul className="layer-list">
              {layers.map((l) => (
                <li
                  key={l.id}
                  className={`layer ${l.selected ? 'selected' : ''}`}
                  onClick={() => editorRef.current?.selectLayer(l.id)}
                >
                  <span className="layer-name" title={l.name}>
                    {l.name}
                  </span>
                  <span className="layer-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      title="Monter"
                      onClick={() => editorRef.current?.moveLayer(l.id, 'up')}
                    >
                      ▲
                    </button>
                    <button
                      title="Descendre"
                      onClick={() => editorRef.current?.moveLayer(l.id, 'down')}
                    >
                      ▼
                    </button>
                    <button
                      title={l.visible ? 'Masquer' : 'Afficher'}
                      onClick={() => editorRef.current?.toggleVisible(l.id)}
                    >
                      {l.visible ? '👁' : '·'}
                    </button>
                    <button
                      title={l.locked ? 'Déverrouiller' : 'Verrouiller'}
                      onClick={() => editorRef.current?.toggleLock(l.id)}
                    >
                      {l.locked ? '🔒' : '🔓'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel help-panel">
            <h3>Installer dans le jeu</h3>
            <ol className="small">
              <li>Exporter le skin (.zip)</li>
              <li>
                Copier le zip dans{' '}
                <code>Documents\Trackmania\Skins\Models\CarSport\</code>
              </li>
              <li>En jeu : Profil → Garage → « Upload skin »</li>
            </ol>
          </section>
        </aside>
        </div>

        {/* ================================================= mise en page 3D */}
        <div className="layout-3d" style={{ display: view === '3d' ? 'flex' : 'none' }}>
          <aside className="edit3d-panel">
            <h2 className="edit3d-title">🎨 Édition 3D</h2>
            <p className="muted small">
              Peignez directement sur la voiture. <b>Clic gauche</b> = peindre ·{' '}
              <b>clic droit</b> = tourner · <b>molette</b> = zoomer (jusqu'au détail).
            </p>

            <label className="edit3d-field">
              <span>Texture peinte</span>
              <select
                value={activeMap}
                onChange={(e) => setActiveMap(e.target.value as MapId)}
                title="Choisissez quelle texture recevra la peinture"
              >
                {MAPS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small no-margin">
              Astuce : peignez la pièce correspondante et cette texture est mise à jour ; la
              carrosserie utilise « Carrosserie », les détails « Détails », etc.
            </p>

            <div className="edit3d-row">
              <label className="edit3d-color">
                <span>Pinceau</span>
                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => onBrushChange(e.target.value, brushSize)}
                />
              </label>
              <label className="edit3d-slider">
                <span>Taille {brushSize}</span>
                <input
                  type="range"
                  min={2}
                  max={120}
                  value={brushSize}
                  onChange={(e) => onBrushChange(brushColor, Number(e.target.value))}
                />
              </label>
            </div>

            <div className="btn-row">
              <button
                disabled={!historyState.undo}
                onClick={() => editorRef.current?.undo()}
                title="Annuler (Ctrl+Z)"
              >
                ↩ Annuler
              </button>
              <button
                disabled={!historyState.redo}
                onClick={() => editorRef.current?.redo()}
                title="Rétablir (Ctrl+Shift+Z)"
              >
                ↪ Rétablir
              </button>
            </div>

            {regionSet && (
              <div className="edit3d-regions">
                <span className="muted small">Remplir une pièce (couleur de remplissage) :</span>
                <label className="edit3d-color">
                  <span>Remplissage</span>
                  <input
                    type="color"
                    value={fillColor}
                    onChange={(e) => onFillChange(e.target.value)}
                  />
                </label>
                <div className="region-grid">
                  {Object.entries(regionSet).map(([key, r]) => (
                    <button
                      key={key}
                      onClick={() =>
                        editorRef.current?.fillRegion(r, clipFillZones ? key : undefined)
                      }
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="muted small">
              Les traits restent des calques éditables et annulables, visibles dans l'éditeur 2D.
            </p>
          </aside>

          <div className="edit3d-stage">
            <div ref={preview3dHostRef} className="preview3d-host" />
          </div>
        </div>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onImageChosen}
      />
      <input ref={refInputRef} type="file" accept="image/*" hidden onChange={onRefChosen} />
      <input ref={zipInputRef} type="file" accept=".zip" hidden onChange={onZipChosen} />

      {showRandom && (
        <RandomModal
          busy={busy !== null}
          onGenerate={onGenerate}
          onClose={() => setShowRandom(false)}
        />
      )}

      {busy && (
        <div className="busy-overlay">
          <div className="spinner" />
          <p>{busy}</p>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
