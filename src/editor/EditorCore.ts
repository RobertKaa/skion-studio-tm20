/**
 * Cœur de l'éditeur : un canvas fabric.js par map de texture, outils de
 * dessin, calques, undo/redo. Indépendant de React ; l'UI s'abonne via on().
 */

import {
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  IText,
  Line,
  Path,
  PencilBrush,
  Point,
  Polygon,
  Rect,
  Shadow,
  type TMat2D,
} from 'fabric';
import { MAPS, MAP_BY_ID, getRegionOrientation, SKIN_REGIONS, type MapId } from '../maps';
import { UV_GUIDE_ISLANDS } from '../uvGuideData';

/** Géométrie éditable d'un objet, exposée au panneau numérique. */
export interface Transform {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

export type Tool =
  | 'select'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'polygon'
  | 'text'
  | 'eyedropper';

export interface LayerInfo {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  selected: boolean;
}

export type CoreEvent =
  | 'layers'
  | 'selection'
  | 'texture'
  | 'history'
  | 'viewport'
  | 'brush'
  | 'dirty';

/** Aperçu curseur pinceau en coords viewport (position: fixed). */
export interface BrushPreviewFrame {
  x: number;
  y: number;
  diameter: number;
}

/** État du zoom/pan de l'éditeur 2D (1 = ajusté au cadre). */
export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_WHEEL_FACTOR = 1.08;
const DEFAULT_VPT: TMat2D = [1, 0, 0, 1, 0, 0];

const CUSTOM_PROPS = ['id', 'name', 'selectable', 'evented', 'visible'];

let idCounter = 0;
const nextId = () => `obj_${Date.now().toString(36)}_${idCounter++}`;

/** Épaisseur de contour appliquée d'office à une forme sans remplissage (sinon invisible). */
const DEFAULT_OUTLINE_WIDTH = 4;

/** Convertit un hex (#rrggbb) en triplet 0..255, tolérant aux valeurs invalides. */
function hexToRgbTriplet(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Construit une couleur `rgba(...)` à partir d'un hex et d'une opacité 0..1. */
function rgbaString(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbTriplet(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

const toHex2 = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** Path fabric exposant l'API interne de mise à jour du tracé. */
type MutablePath = Path & { _setPath: (path: string, adjustPosition?: boolean) => void };

/** Construit une donnée de chemin SVG (segments droits, extrémités arrondies). */
function brushPathData(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  const [first] = pts;
  if (pts.length === 1) return `M ${first.x} ${first.y} L ${first.x} ${first.y}`;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  return d;
}

interface MapState {
  canvas: Canvas;
  el: HTMLCanvasElement;
  /** Buffer export / 3D : rendu sans viewportTransform (coords texture brutes). */
  textureEl: HTMLCanvasElement;
  textureDirty: boolean;
  undo: string[];
  redo: string[];
  suspendHistory: boolean;
  /** Snapshot JSON initial (ou après import / reset) pour détecter les modifications. */
  baseline: string;
}

export type MapCopyMode = 'replace' | 'overlay';

export class EditorCore {
  private maps = new Map<MapId, MapState>();
  activeMap: MapId = 'Skin_B';
  tool: Tool = 'select';
  brushColor = '#ff3838';
  brushSize = 18;
  fillColor = '#2f7df6';
  strokeColor = '#ffffff';
  strokeWidth = 0;
  /** Remplissage des nouvelles formes : false = transparent (contour seul). */
  fillEnabled = true;
  /** Opacité du remplissage des nouvelles formes (0..1, RVBA). */
  fillAlpha = 1;
  /** Contour en pointillés pour les nouvelles formes. */
  strokeDashed = false;
  /** Nombre de côtés/branches de l'outil polygone/étoile. */
  polygonSides = 6;
  /** true = étoile (branches), false = polygone régulier. */
  polygonStar = false;
  /** Callback appelé par la pipette avec la couleur (hex) prélevée sur le canvas. */
  pickHandler: ((hex: string) => void) | null = null;
  /** Lissage du pinceau libre (0 = aucun, 1 = max) — contrôle le decimate fabric. */
  brushSmoothing = 0.35;

  // ---- Outils de précision ----
  /** Symétrie gauche/droite : miroir sur l'axe vertical central (x → largeur − x). */
  symmetry = false;
  /** Clé d'îlot UV sur lequel restreindre le dessin (null = pas de restriction). */
  clipIslandKey: string | null = null;
  /** Magnétisme sur la grille lors des déplacements. */
  snapEnabled = false;
  /** Pas de la grille en pixels du canvas de travail. */
  gridSize = 64;
  /**
   * Aligner les décalques/numéros sur la VOITURE (orientation de la pièce) plutôt
   * que sur le canvas d'édition, lors du centrage dans une pièce. Voir
   * REGION_ORIENTATION (maps.ts). Activé par défaut (numéros/décalques droits sur la voiture).
   */
  carAligned = true;

  private listeners = new Map<CoreEvent, Set<() => void>>();
  private drawing: { obj: FabricObject; startX: number; startY: number } | null = null;
  /** Trait de peinture 3D en cours (une seule entrée d'historique par trait). */
  private stroke3d: {
    mapId: MapId;
    st: MapState;
    path: MutablePath;
    pts: { x: number; y: number }[];
  } | null = null;
  private textureRaf = 0;
  private resizeObserver: ResizeObserver;

  private container: HTMLElement;
  private viewportFrame: HTMLElement | null = null;
  /** Cible wheel (`.canvas-stage` si présent, sinon `.canvas-frame`) — capture la plus tôt. */
  private wheelTarget: HTMLElement | null = null;
  /** Viewport fabric sauvegardé par map (zoom + pan). */
  private savedViewports = new Map<MapId, number[]>();
  private panning = false;
  private panLast = { x: 0, y: 0 };
  private spaceHeld = false;
  private shiftHeld = false;
  /** Ctrl maintenu (taille pinceau à la molette en mode dessin). */
  private ctrlHeld = false;
  private boundViewportKeyDown: (e: KeyboardEvent) => void;
  private boundViewportKeyUp: (e: KeyboardEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundPanDown: (e: MouseEvent) => void;
  private boundPanMove: (e: MouseEvent) => void;
  private boundPanUp: (e: MouseEvent) => void;
  private boundDblClick: (e: MouseEvent) => void;

  constructor(container: HTMLElement, viewportFrame?: HTMLElement) {
    this.container = container;
    this.viewportFrame = viewportFrame ?? null;
    this.boundViewportKeyDown = (e) => this.onViewportKeyDown(e);
    this.boundViewportKeyUp = (e) => this.onViewportKeyUp(e);
    this.boundWheel = (e) => this.onWheel(e);
    this.boundPanDown = (e) => this.onPanDown(e);
    this.boundPanMove = (e) => this.onPanMove(e);
    this.boundPanUp = (e) => this.onPanUp(e);
    this.boundDblClick = (e) => this.onDblClick(e);
    for (const def of MAPS) {
      const el = document.createElement('canvas');
      el.width = def.workRes;
      el.height = def.workRes;
      const wrapper = document.createElement('div');
      wrapper.className = 'canvas-slot';
      wrapper.dataset.map = def.id;
      wrapper.appendChild(el);
      container.appendChild(wrapper);

      const canvas = new Canvas(el, {
        width: def.workRes,
        height: def.workRes,
        backgroundColor: def.defaultFill,
        backgroundVpt: false,
        preserveObjectStacking: true,
        enableRetinaScaling: false,
        selectionColor: 'rgba(80, 150, 255, 0.15)',
        selectionBorderColor: '#5096ff',
      });
      const brush = new PencilBrush(canvas);
      brush.color = this.brushColor;
      brush.width = this.brushSize;
      brush.decimate = this.brushDecimate();
      brush.drawStraightLine = true;
      brush.straightLineKey = 'shiftKey';
      canvas.freeDrawingBrush = brush;

      const textureEl = document.createElement('canvas');
      textureEl.width = def.workRes;
      textureEl.height = def.workRes;
      const state: MapState = {
        canvas,
        el,
        textureEl,
        textureDirty: true,
        undo: [],
        redo: [],
        suspendHistory: false,
        baseline: '',
      };
      this.maps.set(def.id, state);
      this.wireCanvas(def.id, state);
      this.syncCanvasLayout(def.id);
      const initial = this.serialize(canvas);
      state.baseline = initial;
      state.undo.push(initial);
    }
    this.resizeObserver = new ResizeObserver(() => {
      for (const id of this.maps.keys()) this.syncCanvasLayout(id);
      this.emitViewport();
    });
    this.resizeObserver.observe(container);
    if (this.viewportFrame) {
      this.resizeObserver.observe(this.viewportFrame);
      this.wireViewport(this.viewportFrame);
    }
    this.setActiveMap('Skin_B');
    this.applyTool();
  }

  /** Cadre d'édition pour zoom molette / pan (peut être défini après le montage React). */
  setViewportFrame(el: HTMLElement) {
    if (this.viewportFrame) {
      this.unwireViewport();
      this.resizeObserver.unobserve(this.viewportFrame);
    }
    this.viewportFrame = el;
    this.wireViewport(el);
    this.resizeObserver.observe(el);
    for (const id of this.maps.keys()) this.syncCanvasLayout(id);
    this.emitViewport();
  }

  // ------------------------------------------------------------------ events

  on(ev: CoreEvent, fn: () => void): () => void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
    return () => this.listeners.get(ev)!.delete(fn);
  }

  private emit(ev: CoreEvent) {
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  /** Planifie un rafraîchissement 3D au prochain frame (~60 Hz max). */
  private emitTexture() {
    if (this.textureRaf) return;
    this.textureRaf = window.requestAnimationFrame(() => {
      this.textureRaf = 0;
      this.emit('texture');
    });
  }

  /** Rafraîchit l'aperçu 3D immédiatement (import, génération…). */
  flushTexture() {
    if (this.textureRaf) {
      window.cancelAnimationFrame(this.textureRaf);
      this.textureRaf = 0;
    }
    for (const id of this.maps.keys()) this.markTextureDirty(id);
    for (const id of this.maps.keys()) this.syncTextureCanvas(id);
    this.emit('texture');
  }

  /** Marque le buffer texture d'une map comme obsolète (changement de contenu, pas de pan/zoom). */
  private markTextureDirty(id: MapId) {
    this.maps.get(id)!.textureDirty = true;
  }

  /**
   * Recopie le contenu scène (sans viewportTransform) dans textureEl.
   * lowerCanvasEl inclut le vpt pour l'affichage ; la 3D et l'export lisent textureEl.
   */
  private syncTextureCanvas(id: MapId) {
    const st = this.maps.get(id);
    if (!st?.textureDirty) return;
    st.textureDirty = false;
    const c = st.canvas;
    const el = st.textureEl;
    const res = MAP_BY_ID[id].workRes;
    if (el.width !== res || el.height !== res) {
      el.width = res;
      el.height = res;
    }
    const savedVpt = (c.viewportTransform ?? DEFAULT_VPT).slice() as TMat2D;
    try {
      c.setViewportTransform([...DEFAULT_VPT]);
      const snap = c.toCanvasElement(1);
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, res, res);
      ctx.drawImage(snap, 0, 0);
    } catch {
      // Fallback : recomposer fond + calques sans toCanvasElement (fond importé volumineux).
      try {
        const ctx = el.getContext('2d');
        if (!ctx) throw new Error('Contexte texture indisponible');
        ctx.clearRect(0, 0, res, res);
        const bg = c.backgroundColor;
        if (typeof bg === 'string' && bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, res, res);
        }
        const bgImg = c.backgroundImage as FabricImage | undefined;
        const bgEl = bgImg?.getElement?.();
        if (bgImg && bgEl && bgEl.width > 0 && bgEl.height > 0) {
          const sx = bgImg.scaleX ?? 1;
          const sy = bgImg.scaleY ?? 1;
          const dw = (bgImg.width ?? bgEl.width) * sx;
          const dh = (bgImg.height ?? bgEl.height) * sy;
          ctx.drawImage(bgEl, bgImg.left ?? 0, bgImg.top ?? 0, dw, dh);
        }
        for (const obj of c.getObjects()) {
          if (!obj.visible) continue;
          obj.render(ctx);
        }
        st.textureDirty = false;
      } catch {
        st.textureDirty = true;
      }
    } finally {
      c.setViewportTransform(savedVpt);
    }
  }

  private brushDecimate(): number {
    return Math.max(0.4, Math.round(0.5 + this.brushSmoothing * 7.5));
  }

  private pencilBrush(c: Canvas): PencilBrush {
    return c.freeDrawingBrush as PencilBrush;
  }

  setBrushSmoothing(v: number) {
    this.brushSmoothing = Math.max(0, Math.min(1, v));
    for (const [, st] of this.maps) {
      const b = this.pencilBrush(st.canvas);
      b.decimate = this.brushDecimate();
    }
  }

  // ----------------------------------------------------------- zoom / pan 2D

  getViewport(): ViewportState {
    const c = this.canvas;
    const vpt = c.viewportTransform ?? DEFAULT_VPT;
    return { zoom: c.getZoom(), panX: vpt[4], panY: vpt[5] };
  }

  /**
   * Rapport pixels cadre CSS / pixels backstore (workRes).
   * Le vpt fabric vit en coords backstore ; les overlays HTML sont en coords cadre.
   */
  private frameToBackstoreScale(): number {
    const frameW = this.viewportFrame?.getBoundingClientRect().width;
    const backW = this.canvas.width;
    if (!frameW || !backW) return 1;
    return frameW / backW;
  }

  /** Transform CSS pour les overlays : même zoom que fabric, pan converti en px cadre. */
  getViewportCssTransform(): string {
    const vpt = this.canvas.viewportTransform ?? DEFAULT_VPT;
    const s = this.frameToBackstoreScale();
    return `matrix(${vpt[0]}, ${vpt[1]}, ${vpt[2]}, ${vpt[3]}, ${vpt[4] * s}, ${vpt[5] * s})`;
  }

  /** Point texture (pixels de travail) à partir de coordonnées écran client. */
  scenePointFromClient(clientX: number, clientY: number): { x: number; y: number } {
    this.canvas.calcOffset();
    return this.canvas.getScenePoint({ clientX, clientY } as MouseEvent);
  }

  /**
   * Position absolue dans le cadre CSS (px) pour un point scène.
   * Pipeline fabric : vpt en backstore, puis scale CSS cadre/backstore.
   */
  scenePointToFrameLocal(sceneX: number, sceneY: number): { x: number; y: number } {
    const vpt = this.canvas.viewportTransform ?? DEFAULT_VPT;
    const s = this.frameToBackstoreScale();
    const bx = vpt[0] * sceneX + vpt[2] * sceneY + vpt[4];
    const by = vpt[1] * sceneX + vpt[3] * sceneY + vpt[5];
    return { x: bx * s, y: by * s };
  }

  /** Diamètre du pinceau en pixels cadre (largeur scène × zoom × scale CSS). */
  brushDiameterInFrame(brushSize = this.brushSize): number {
    return brushSize * this.canvas.getZoom() * this.frameToBackstoreScale();
  }

  /**
   * Aperçu pinceau centré sur le pointeur (coords viewport) — le diamètre
   * reflète zoom + échelle CSS ; le positionnement suit clientX/clientY directement.
   */
  getBrushPreviewAtClient(
    clientX: number,
    clientY: number,
    brushSize = this.brushSize,
  ): BrushPreviewFrame | null {
    const frame = this.viewportFrame;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientY < rect.top ||
      clientX > rect.right ||
      clientY > rect.bottom
    ) {
      return null;
    }
    return { x: clientX, y: clientY, diameter: this.brushDiameterInFrame(brushSize) };
  }

  /** Ajuste la taille du pinceau (2–120 px scène) et notifie l'UI. */
  adjustBrushSize(delta: number): number {
    const next = Math.max(2, Math.min(120, Math.round(this.brushSize + delta)));
    this.setBrush(this.brushColor, next);
    return next;
  }

  getZoomPercent(): number {
    return Math.round(this.canvas.getZoom() * 100);
  }

  private saveViewport(id: MapId) {
    const c = this.maps.get(id)!.canvas;
    const vpt = c.viewportTransform ?? DEFAULT_VPT;
    this.savedViewports.set(id, [...vpt] as TMat2D);
  }

  private restoreViewport(id: MapId) {
    const c = this.maps.get(id)!.canvas;
    const vpt = this.savedViewports.get(id) ?? DEFAULT_VPT;
    c.setViewportTransform([...vpt] as TMat2D);
    c.calcOffset();
    c.requestRenderAll();
    this.emit('viewport');
  }

  private emitViewport() {
    this.emit('viewport');
  }

  private clampZoom(z: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  /** Zoom centré sur un point écran (clientX/Y) ou au centre du cadre. */
  zoomAt(factor: number, clientX?: number, clientY?: number) {
    const c = this.canvas;
    const frame = this.viewportFrame;
    const rect = frame?.getBoundingClientRect();
    const px =
      clientX ?? (rect ? rect.left + rect.width / 2 : c.width! / 2);
    const py =
      clientY ?? (rect ? rect.top + rect.height / 2 : c.height! / 2);
    const before = c.getScenePoint({ clientX: px, clientY: py } as MouseEvent);
    const next = this.clampZoom(c.getZoom() * factor);
    c.zoomToPoint(before, next);
    c.calcOffset();
    c.requestRenderAll();
    this.saveViewport(this.activeMap);
    this.emitViewport();
  }

  zoomIn() {
    this.zoomAt(ZOOM_WHEEL_FACTOR);
  }

  zoomOut() {
    this.zoomAt(1 / ZOOM_WHEEL_FACTOR);
  }

  /** Réinitialise zoom et pan (ajusté au cadre). */
  resetViewport() {
    const c = this.canvas;
    c.setViewportTransform([...DEFAULT_VPT]);
    c.calcOffset();
    c.requestRenderAll();
    this.saveViewport(this.activeMap);
    this.emitViewport();
  }

  /**
   * Cadre la vue sur une zone UV (fractions 0..1, origine haut-gauche).
   * `padding` = marge autour de la zone (0..0.5).
   * Utilise la taille réelle du cadre CSS pour un zoom qui remplit l'espace visible.
   */
  fitViewportToBounds(
    frac: { x: number; y: number; w: number; h: number },
    padding = 0.12,
  ) {
    const c = this.canvas;
    const frame = this.viewportFrame;
    const rect = frame?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    const res = MAP_BY_ID[this.activeMap].workRes;
    const pad = Math.max(0, Math.min(0.45, padding));
    const regionW = Math.max(frac.w * res * (1 + 2 * pad), 8);
    const regionH = Math.max(frac.h * res * (1 + 2 * pad), 8);
    const cx = (frac.x + frac.w / 2) * res;
    const cy = (frac.y + frac.h / 2) * res;
    // Zoom pour que la zone cible remplisse le cadre carré à l'écran.
    const zoom = this.clampZoom(Math.min(res / regionW, res / regionH));
    const tx = res / 2 - cx * zoom;
    const ty = res / 2 - cy * zoom;
    c.setViewportTransform([zoom, 0, 0, zoom, tx, ty]);
    c.calcOffset();
    c.requestRenderAll();
    this.saveViewport(this.activeMap);
    this.emitViewport();
  }

  /** Bounding box union d'un îlot guide (polygones UV 0..1). */
  private islandBounds(key: string): { x: number; y: number; w: number; h: number } | null {
    const island = UV_GUIDE_ISLANDS.find((i) => i.key === key);
    if (island && island.polygons.length > 0) {
      let x0 = 1;
      let y0 = 1;
      let x1 = 0;
      let y1 = 0;
      for (const poly of island.polygons) {
        for (const p of poly) {
          if (p.x < x0) x0 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.x > x1) x1 = p.x;
          if (p.y > y1) y1 = p.y;
        }
      }
      if (x1 > x0 && y1 > y0) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const rect = SKIN_REGIONS[key];
    return rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null;
  }

  /**
   * Mode focus : rogne le dessin à l'îlot et zoome la vue sur ses contours.
   * `null` = vue complète (clip retiré, zoom réinitialisé).
   * `onLayoutSettled` est appelé une fois le cadrage UV stabilisé (pour resync CSS).
   */
  focusRegion(key: string | null, onLayoutSettled?: () => void) {
    this.setClipIsland(key);
    if (!key) {
      this.resetViewport();
      onLayoutSettled?.();
      return;
    }
    const bounds = this.islandBounds(key);
    if (!bounds) {
      onLayoutSettled?.();
      return;
    }
    // Attendre la mise en page (chrome, hint, --canvas-fit…) avant le cadrage UV.
    const fit = () => {
      for (const id of this.maps.keys()) this.syncCanvasLayout(id);
      this.fitViewportToBounds(bounds, 0.1);
      this.canvas.calcOffset();
      this.canvas.requestRenderAll();
      this.emitViewport();
      // Recadrage après que le cadre CSS ait sa taille définitive.
      requestAnimationFrame(() => {
        this.fitViewportToBounds(bounds, 0.1);
        this.canvas.calcOffset();
        this.canvas.requestRenderAll();
        this.emitViewport();
        onLayoutSettled?.();
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(fit));
  }

  private isPanTrigger(e: MouseEvent): boolean {
    return e.button === 1 || (e.button === 0 && (this.spaceHeld || e.altKey));
  }

  private isPanning(): boolean {
    return this.panning;
  }

  private wireViewport(frame: HTMLElement) {
    const stage = frame.parentElement;
    this.wheelTarget =
      stage?.classList.contains('canvas-stage') ? stage : frame;
    this.wheelTarget.addEventListener('wheel', this.boundWheel, {
      passive: false,
      capture: true,
    });
    frame.addEventListener('mousedown', this.boundPanDown, true);
    frame.addEventListener('dblclick', this.boundDblClick);
    window.addEventListener('mousemove', this.boundPanMove);
    window.addEventListener('mouseup', this.boundPanUp);
    window.addEventListener('keydown', this.boundViewportKeyDown);
    window.addEventListener('keyup', this.boundViewportKeyUp);
    frame.classList.add('canvas-frame--viewport');
  }

  private unwireViewport() {
    const frame = this.viewportFrame;
    if (!frame) return;
    this.wheelTarget?.removeEventListener('wheel', this.boundWheel, true);
    this.wheelTarget = null;
    frame.removeEventListener('mousedown', this.boundPanDown, true);
    frame.removeEventListener('dblclick', this.boundDblClick);
    window.removeEventListener('mousemove', this.boundPanMove);
    window.removeEventListener('mouseup', this.boundPanUp);
    window.removeEventListener('keydown', this.boundViewportKeyDown);
    window.removeEventListener('keyup', this.boundViewportKeyUp);
    frame.classList.remove('canvas-frame--viewport');
  }

  private onViewportKeyDown(e: KeyboardEvent) {
    if (e.code === 'Space' && !this.isTextEditing()) {
      this.spaceHeld = true;
      if (this.viewportFrame) this.viewportFrame.classList.add('canvas-frame--space');
    }
    if (e.key === 'Shift') this.shiftHeld = true;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.ctrlHeld = true;
  }

  private onViewportKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      this.spaceHeld = false;
      this.viewportFrame?.classList.remove('canvas-frame--space');
      if (this.panning) this.endPan();
    }
    if (e.key === 'Shift') this.shiftHeld = false;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.ctrlHeld = false;
  }

  /** Pointeur au-dessus du cadre canvas (coords client, indépendant de `e.target`). */
  private isPointerOverViewport(e: WheelEvent): boolean {
    const frame = this.viewportFrame;
    if (!frame) return false;
    const rect = frame.getBoundingClientRect();
    return (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    );
  }

  /** Ctrl sur Windows : `ctrlKey` + état clavier + `getModifierState`. */
  private wheelCtrlHeld(e: WheelEvent): boolean {
    return this.ctrlHeld || e.ctrlKey || e.getModifierState('Control');
  }

  /** Molette + Ctrl redimensionne le pinceau en mode dessin (molette seule = zoom). */
  private shouldResizeBrushOnWheel(e: WheelEvent): boolean {
    if (this.tool !== 'draw') return false;
    return this.wheelCtrlHeld(e);
  }

  private wheelBrushStep(e: WheelEvent): number {
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    return delta < 0 ? 2 : -2;
  }

  private onWheel(e: WheelEvent) {
    if (!this.isPointerOverViewport(e)) return;
    if (this.shouldResizeBrushOnWheel(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this.adjustBrushSize(this.wheelBrushStep(e));
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const c = this.canvas;
    const point = c.getScenePoint(e);
    const delta = e.deltaY;
    const factor = delta < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
    const next = this.clampZoom(c.getZoom() * factor);
    c.zoomToPoint(point, next);
    c.calcOffset();
    c.requestRenderAll();
    this.saveViewport(this.activeMap);
    this.emitViewport();
  }

  private onPanDown(e: MouseEvent) {
    if (!this.isPanTrigger(e)) return;
    e.preventDefault();
    e.stopPropagation();
    this.panning = true;
    this.panLast = { x: e.clientX, y: e.clientY };
    this.viewportFrame?.classList.add('canvas-frame--panning');
    for (const [, st] of this.maps) {
      st.canvas.isDrawingMode = false;
      st.canvas.selection = false;
      st.canvas.defaultCursor = 'grabbing';
      st.canvas.hoverCursor = 'grabbing';
    }
  }

  private onPanMove(e: MouseEvent) {
    if (!this.panning) return;
    const dx = e.clientX - this.panLast.x;
    const dy = e.clientY - this.panLast.y;
    this.panLast = { x: e.clientX, y: e.clientY };
    const c = this.canvas;
    const backstorePerCss = 1 / this.frameToBackstoreScale();
    c.relativePan(new Point(dx * backstorePerCss, dy * backstorePerCss));
    c.calcOffset();
    c.requestRenderAll();
    this.saveViewport(this.activeMap);
    this.emitViewport();
  }

  private endPan() {
    this.panning = false;
    this.viewportFrame?.classList.remove('canvas-frame--panning');
    this.applyTool();
  }

  private onPanUp(e: MouseEvent) {
    if (!this.panning) return;
    if (e.button === 1 || e.button === 0) this.endPan();
  }

  private onDblClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('.zoom-controls')) return;
    if (!this.viewportFrame?.contains(t)) return;
    if (t.closest('.canvas-container') || t.classList.contains('canvas-frame')) {
      this.resetViewport();
    }
  }

  /** True si un objet texte fabric est en cours d'édition inline. */
  isTextEditing(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset?.fabric === 'textarea') return true;
    const obj = this.canvas.getActiveObject() as (FabricObject & { isEditing?: boolean }) | undefined;
    return !!obj?.isEditing;
  }

  /** Aligne le backstore (workRes) et le CSS (100 %) pour des coordonnées pointeur correctes. */
  private syncCanvasLayout(id: MapId) {
    const st = this.maps.get(id)!;
    const res = MAP_BY_ID[id].workRes;
    const c = st.canvas;
    c.setDimensions({ width: res, height: res });
    c.setDimensions({ width: '100%', height: '100%' }, { cssOnly: true });
    c.calcOffset();
  }

  // ------------------------------------------------------------- canvas wiring

  private wireCanvas(id: MapId, state: MapState) {
    const c = state.canvas;
    c.on('after:render', () => {
      if (!state.textureDirty) return;
      this.syncTextureCanvas(id);
      this.emitTexture();
    });
    const record = () => {
      if (!state.suspendHistory) this.pushHistory(id);
      this.markTextureDirty(id);
      this.emit('layers');
    };
    c.on('object:added', (e) => {
      const obj = e.target as FabricObject & { id?: string };
      if (!obj.id) obj.id = nextId();
      record();
    });
    c.on('object:removed', record);
    c.on('object:modified', () => {
      record();
      this.emit('selection');
    });
    c.on('selection:created', () => this.emit('selection'));
    c.on('selection:updated', () => this.emit('selection'));
    c.on('selection:cleared', () => this.emit('selection'));

    // Magnétisme + rafraîchissement live du panneau numérique pendant les gestes.
    c.on('object:moving', (e) => {
      const t = e.target as FabricObject | undefined;
      if (t && this.snapEnabled && this.gridSize > 0) {
        t.set({
          left: Math.round((t.left ?? 0) / this.gridSize) * this.gridSize,
          top: Math.round((t.top ?? 0) / this.gridSize) * this.gridSize,
        });
      }
      this.emit('selection');
    });
    c.on('object:scaling', () => this.emit('selection'));
    c.on('object:rotating', () => this.emit('selection'));

    // Coup de pinceau libre : applique clip + miroir sur le tracé créé.
    c.on('path:created', (e) => {
      const path = (e as unknown as { path: FabricObject }).path;
      if (!path) return;
      let changed = false;
      if (this.clipIslandKey) {
        this.applyClip(path);
        changed = true;
      }
      if (this.symmetry) {
        void this.createMirror(path, c);
        // le miroir enregistre sa propre entrée d'historique via object:added
      } else if (changed) {
        this.pushHistory(this.activeMap);
      }
      this.flushTexture();
    });

    c.on('mouse:down', (opt) => {
      if (this.tool === 'eyedropper') {
        const p = c.getScenePoint(opt.e);
        const hex = this.pickColorAt(p.x, p.y);
        if (hex && this.pickHandler) this.pickHandler(hex);
        return;
      }
      if (this.tool === 'select' || this.tool === 'draw') return;
      if (opt.target) return; // clic sur un objet existant : laisser fabric gérer
      const p = c.getScenePoint(opt.e);
      if (this.tool === 'text') {
        const text = new IText('Texte', {
          left: p.x,
          top: p.y,
          fontFamily: 'Arial Black, sans-serif',
          fontSize: 72,
          fill: this.fillColor,
          originX: 'center',
          originY: 'center',
        });
        this.applyClip(text);
        c.add(text);
        c.setActiveObject(text);
        this.setTool('select');
        text.enterEditing();
        text.selectAll();
        // Le miroir est créé quand l'édition du texte se termine (contenu figé).
        if (this.symmetry) {
          text.once('editing:exited', () => {
            void this.createMirror(text, c);
          });
        }
        return;
      }
      let obj: FabricObject;
      const strokeW = this.effectiveStrokeWidth();
      const dash =
        this.strokeDashed && strokeW > 0 ? this.dashArrayFor(strokeW) : undefined;
      const common = {
        fill: this.newShapeFill(),
        stroke: strokeW > 0 ? this.strokeColor : undefined,
        strokeWidth: strokeW,
        strokeDashArray: dash,
        strokeUniform: true,
      };
      if (this.tool === 'rect') {
        obj = new Rect({ ...common, left: p.x, top: p.y, width: 1, height: 1 });
      } else if (this.tool === 'ellipse') {
        obj = new Ellipse({ ...common, left: p.x, top: p.y, rx: 1, ry: 1 });
      } else if (this.tool === 'polygon') {
        obj = new Polygon(this.polygonPoints(p.x, p.y, 1), { ...common });
      } else {
        // La ligne n'a pas de remplissage : sa couleur visible est le trait.
        const lineColor = this.fillEnabled
          ? this.fillColorValue()
          : this.strokeColor;
        const lineW = Math.max(this.strokeWidth, 6);
        obj = new Line([p.x, p.y, p.x, p.y], {
          stroke: lineColor,
          strokeWidth: lineW,
          strokeDashArray: this.strokeDashed ? this.dashArrayFor(lineW) : undefined,
          strokeUniform: true,
        });
      }
      state.suspendHistory = true;
      c.add(obj);
      this.drawing = { obj, startX: p.x, startY: p.y };
    });

    c.on('mouse:move', (opt) => {
      if (this.drawing) {
        const p = c.getScenePoint(opt.e);
        const { obj, startX, startY } = this.drawing;
        let endX = p.x;
        let endY = p.y;
        if (this.shiftHeld) {
          if (obj instanceof Line) {
            const dx = endX - startX;
            const dy = endY - startY;
            const angle = Math.atan2(dy, dx);
            const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            endX = startX + Math.cos(snap) * len;
            endY = startY + Math.sin(snap) * len;
          } else if (obj instanceof Rect || obj instanceof Ellipse) {
            const side = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
            endX = startX + (endX >= startX ? side : -side);
            endY = startY + (endY >= startY ? side : -side);
          }
        }
        const left = Math.min(endX, startX);
        const top = Math.min(endY, startY);
        const w = Math.abs(endX - startX);
        const h = Math.abs(endY - startY);
        if (obj instanceof Polygon) {
          const r = Math.max(Math.hypot(endX - startX, endY - startY), 1);
          obj.points = this.polygonPoints(startX, startY, r);
          obj.setBoundingBox(true);
        } else if (obj instanceof Rect) {
          obj.set({ left, top, width: Math.max(w, 1), height: Math.max(h, 1) });
        } else if (obj instanceof Ellipse) {
          obj.set({ left, top, rx: Math.max(w / 2, 1), ry: Math.max(h / 2, 1) });
        } else if (obj instanceof Line) {
          obj.set({ x2: endX, y2: endY });
        }
        obj.setCoords();
        this.markTextureDirty(id);
        c.requestRenderAll();
        return;
      }
    });

    c.on('mouse:up', () => {
      if (!this.drawing) return;
      const { obj, startX, startY } = this.drawing;
      this.drawing = null;
      // annule les formes dégénérées (simple clic sans glisser)
      const tooSmall =
        (obj instanceof Polygon && (obj.width! < 4 || obj.height! < 4)) ||
        (obj instanceof Rect && (obj.width! < 3 || obj.height! < 3)) ||
        (obj instanceof Ellipse && (obj.rx! < 2 || obj.ry! < 2)) ||
        (obj instanceof Line &&
          Math.hypot((obj.x2 ?? 0) - startX, (obj.y2 ?? 0) - startY) < 3);
      if (tooSmall) {
        state.suspendHistory = false;
        state.canvas.remove(obj);
        state.canvas.requestRenderAll();
        this.emit('layers');
        return;
      }
      // clip + miroir sont créés pendant que l'historique est encore suspendu,
      // afin de tout regrouper dans une seule entrée d'annulation.
      this.applyClip(obj);
      const finalize = () => {
        state.suspendHistory = false;
        this.pushHistory(this.activeMap);
        c.setActiveObject(obj);
        this.setTool('select');
        this.emit('layers');
      };
      if (this.symmetry) {
        void this.createMirror(obj, c).then(finalize);
      } else {
        finalize();
      }
    });
  }

  // -------------------------------------------------------------- maps / tools

  get canvas(): Canvas {
    return this.maps.get(this.activeMap)!.canvas;
  }

  getCanvas(id: MapId): Canvas {
    return this.maps.get(id)!.canvas;
  }

  getCanvasElement(id: MapId): HTMLCanvasElement {
    this.syncTextureCanvas(id);
    return this.maps.get(id)!.textureEl;
  }

  setActiveMap(id: MapId) {
    this.saveViewport(this.activeMap);
    this.activeMap = id;
    for (const [mid, st] of this.maps) {
      const slot = st.el.parentElement!.parentElement as HTMLElement; // canvas-container -> slot
      // fabric enveloppe le canvas dans .canvas-container, lui-même dans notre .canvas-slot
      const outer = slot.classList.contains('canvas-slot')
        ? slot
        : (slot.parentElement as HTMLElement);
      outer.style.display = mid === id ? 'block' : 'none';
    }
    this.syncCanvasLayout(id);
    this.restoreViewport(id);
    this.applyTool();
    this.emit('layers');
    this.emit('selection');
    this.emit('history');
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.applyTool();
    this.emit('selection');
  }

  private applyTool() {
    if (this.isPanning()) return;
    for (const [, st] of this.maps) {
      const c = st.canvas;
      c.isDrawingMode = this.tool === 'draw';
      c.selection = this.tool === 'select';
      c.defaultCursor =
        this.tool === 'select'
          ? 'default'
          : this.tool === 'draw'
            ? 'none'
            : this.spaceHeld
              ? 'grab'
              : 'crosshair';
      c.hoverCursor = c.defaultCursor;
      c.skipTargetFind = this.tool !== 'select';
      if (c.freeDrawingBrush) {
        const b = this.pencilBrush(c);
        b.color = this.brushColor;
        b.width = this.brushSize;
        b.decimate = this.brushDecimate();
        b.drawStraightLine = true;
        b.straightLineKey = 'shiftKey';
      }
    }
  }

  setBrush(color: string, size: number) {
    this.brushColor = color;
    this.brushSize = size;
    this.applyTool();
    this.emit('brush');
  }

  // --------------------------------------------- remplissage / contour / formes

  /** Couleur de remplissage courante (hex ou rgba si alpha < 1), sans le mode transparent. */
  private fillColorValue(): string {
    return this.fillAlpha >= 1 ? this.fillColor : rgbaString(this.fillColor, this.fillAlpha);
  }

  /** Remplissage à appliquer à une nouvelle forme (`'transparent'` si sans remplissage). */
  private newShapeFill(): string {
    return this.fillEnabled ? this.fillColorValue() : 'transparent';
  }

  /**
   * Épaisseur de contour des nouvelles formes. Sans remplissage, on force une
   * épaisseur minimale pour que le contour reste visible (sinon forme invisible).
   */
  private effectiveStrokeWidth(): number {
    if (!this.fillEnabled && this.strokeWidth <= 0) return DEFAULT_OUTLINE_WIDTH;
    return this.strokeWidth;
  }

  /** Motif de pointillés proportionnel à l'épaisseur du trait. */
  private dashArrayFor(w: number): number[] {
    return [Math.max(w * 2.2, 6), Math.max(w * 1.6, 4)];
  }

  /**
   * Points d'un polygone régulier (ou d'une étoile si `polygonStar`) centré en
   * (cx, cy), de rayon `r`, en coordonnées absolues du canvas.
   */
  private polygonPoints(cx: number, cy: number, r: number): { x: number; y: number }[] {
    const n = Math.max(3, Math.round(this.polygonSides));
    const pts: { x: number; y: number }[] = [];
    if (this.polygonStar) {
      const inner = r * 0.5;
      for (let i = 0; i < n * 2; i++) {
        const rad = i % 2 === 0 ? r : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
      }
    } else {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    }
    return pts;
  }

  /**
   * Prélève la couleur (hex) au point (x, y) du canvas de la map active,
   * fond et calques composités inclus. Retourne null hors limites.
   */
  pickColorAt(x: number, y: number): string | null {
    this.syncTextureCanvas(this.activeMap);
    const el = this.maps.get(this.activeMap)!.textureEl;
    const ctx = el.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= el.width || py >= el.height) return null;
    const d = ctx.getImageData(px, py, 1, 1).data;
    return `#${toHex2(d[0])}${toHex2(d[1])}${toHex2(d[2])}`;
  }

  setBackgroundColor(color: string) {
    const c = this.canvas;
    c.backgroundColor = color;
    c.requestRenderAll();
    this.pushHistory(this.activeMap);
  }

  getBackgroundColor(): string {
    return (this.canvas.backgroundColor as string) || '#000000';
  }

  async addImageFromFile(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      const c = this.canvas;
      const scale = Math.min(
        (c.width! * 0.6) / img.width!,
        (c.height! * 0.6) / img.height!,
        1,
      );
      img.set({
        left: c.width! / 2,
        top: c.height! / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
      });
      (img as FabricObject & { name?: string }).name = file.name;
      this.applyClip(img);
      c.add(img);
      c.setActiveObject(img);
      this.setTool('select');
      if (this.symmetry) await this.createMirror(img, c);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Copie une image source dans le buffer texture 3D / export (coords UV brutes). */
  private blitSourceToTextureEl(id: MapId, source: HTMLCanvasElement | ImageBitmap) {
    const st = this.maps.get(id);
    if (!st) return;
    const res = MAP_BY_ID[id].workRes;
    const el = st.textureEl;
    if (el.width !== res || el.height !== res) {
      el.width = res;
      el.height = res;
    }
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, res, res);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, res, res);
    st.textureDirty = false;
  }

  private canvasFromImageSource(source: HTMLCanvasElement | ImageBitmap): HTMLCanvasElement {
    if (source instanceof HTMLCanvasElement) return source;
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Contexte canvas indisponible');
    ctx.drawImage(source, 0, 0);
    return c;
  }

  /** Remplace l'image de fond de la map (import de skin existant). */
  async setBackgroundFromCanvas(
    id: MapId,
    source: HTMLCanvasElement | ImageBitmap,
    opts?: { flush?: boolean; recordHistory?: boolean },
  ) {
    const st = this.maps.get(id);
    if (!st) throw new Error(`Map inconnue : ${id}`);
    const c = st.canvas;
    const res = MAP_BY_ID[id].workRes;
    const sw = source.width;
    const sh = source.height;
    if (!sw || !sh) throw new Error(`Image importée vide (0×0) pour ${MAP_BY_ID[id].fileName}`);

    const raster = this.canvasFromImageSource(source);
    this.blitSourceToTextureEl(id, raster);

    const blob = await new Promise<Blob>((resolve, reject) => {
      raster.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encodage PNG impossible'))),
        'image/png',
      );
    });
    const url = URL.createObjectURL(blob);
    try {
      const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      img.set({
        left: 0,
        top: 0,
        originX: 'left',
        originY: 'top',
        scaleX: res / sw,
        scaleY: res / sh,
        selectable: false,
        evented: false,
      });
      (img as FabricObject & { name?: string }).name = 'Fond importé';
      if (c.backgroundImage) c.backgroundImage.dispose();
      c.backgroundImage = img;
      c.requestRenderAll();
    } finally {
      URL.revokeObjectURL(url);
    }

    if (opts?.recordHistory !== false) this.pushHistory(id);
    else this.markTextureDirty(id);
    if (opts?.flush !== false) this.flushTexture();
  }

  /** Finalise l'état undo/dirty après un import multi-maps (sans resérialiser en boucle). */
  commitImportState(ids: MapId[]) {
    for (const id of ids) this.resetMapBaseline(id);
  }

  /**
   * Copie les calques éditables d'une map source vers une map cible (sans le fond).
   * - replace : remplace les calques de la cible (le fond destination est conservé)
   * - overlay : ajoute les calques source par-dessus ceux de la cible
   */
  async copyRenderedMapToMap(sourceId: MapId, targetId: MapId, mode: MapCopyMode = 'replace') {
    const srcState = this.maps.get(sourceId);
    const dstState = this.maps.get(targetId);
    if (!srcState || !dstState) throw new Error(`Map inconnue (${sourceId} -> ${targetId})`);

    const dstCanvas = dstState.canvas;
    const srcObjects = [...srcState.canvas.getObjects()];

    dstState.suspendHistory = true;
    try {
      if (mode === 'replace') {
        dstCanvas.discardActiveObject();
        dstCanvas.remove(...dstCanvas.getObjects());
      }
      for (const obj of srcObjects) {
        const clone = await obj.clone(CUSTOM_PROPS);
        (clone as FabricObject & { id?: string }).id = nextId();
        const srcName = (obj as FabricObject & { name?: string }).name;
        if (srcName) (clone as FabricObject & { name?: string }).name = srcName;
        dstCanvas.add(clone);
      }
      dstCanvas.requestRenderAll();
    } finally {
      dstState.suspendHistory = false;
    }

    this.pushHistory(targetId);
    this.markTextureDirty(targetId);
    this.emit('layers');
    this.emit('selection');
    if (this.activeMap === targetId) this.emit('history');
    this.flushTexture();
  }

  // ------------------------------------------------------------------- layers

  getLayers(): LayerInfo[] {
    const c = this.canvas;
    const active = new Set(c.getActiveObjects());
    return c
      .getObjects()
      .map((o) => {
        const obj = o as FabricObject & { id?: string; name?: string };
        return {
          id: obj.id ?? '',
          name: obj.name || this.defaultName(obj),
          type: obj.type,
          visible: obj.visible !== false,
          locked: !obj.selectable,
          selected: active.has(obj),
        };
      })
      .reverse();
  }

  private defaultName(obj: FabricObject): string {
    switch (obj.type) {
      case 'rect':
        return 'Rectangle';
      case 'ellipse':
        return 'Ellipse';
      case 'line':
        return 'Ligne';
      case 'i-text':
      case 'text':
        return `Texte « ${(obj as IText).text?.slice(0, 14) ?? ''} »`;
      case 'path':
        return 'Coup de pinceau';
      case 'image':
        return 'Image';
      default:
        return obj.type;
    }
  }

  private findById(id: string): FabricObject | undefined {
    return this.canvas.getObjects().find((o) => (o as FabricObject & { id?: string }).id === id);
  }

  selectLayer(id: string) {
    const obj = this.findById(id);
    if (!obj || !obj.selectable) return;
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    this.emit('layers');
    this.emit('selection');
  }

  toggleVisible(id: string) {
    const obj = this.findById(id);
    if (!obj) return;
    obj.visible = !obj.visible;
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('layers');
  }

  toggleLock(id: string) {
    const obj = this.findById(id);
    if (!obj) return;
    const locked = obj.selectable;
    obj.selectable = !locked ? true : false;
    obj.evented = obj.selectable;
    if (!obj.selectable && this.canvas.getActiveObject() === obj) {
      this.canvas.discardActiveObject();
    }
    this.canvas.requestRenderAll();
    this.emit('layers');
  }

  moveLayer(id: string, dir: 'up' | 'down' | 'top' | 'bottom') {
    const obj = this.findById(id);
    if (!obj) return;
    const c = this.canvas;
    if (dir === 'up') c.bringObjectForward(obj);
    else if (dir === 'down') c.sendObjectBackwards(obj);
    else if (dir === 'top') c.bringObjectToFront(obj);
    else c.sendObjectToBack(obj);
    c.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('layers');
  }

  deleteSelection() {
    const c = this.canvas;
    const objs = c.getActiveObjects();
    if (!objs.length) return;
    c.discardActiveObject();
    objs.forEach((o) => c.remove(o));
    c.requestRenderAll();
    this.emit('layers');
    this.emit('selection');
  }

  deleteLayer(id: string) {
    const obj = this.findById(id);
    if (!obj) return;
    const c = this.canvas;
    if (c.getActiveObject() === obj) c.discardActiveObject();
    c.remove(obj);
    c.requestRenderAll();
    this.emit('layers');
    this.emit('selection');
  }

  async duplicateSelection() {
    const c = this.canvas;
    const obj = c.getActiveObject();
    if (!obj) return;
    const clone = await obj.clone();
    clone.set({ left: (obj.left ?? 0) + 24, top: (obj.top ?? 0) + 24 });
    (clone as FabricObject & { id?: string }).id = nextId();
    c.add(clone);
    c.setActiveObject(clone);
    c.requestRenderAll();
  }

  // ---------------------------------------------------------------- selection

  getSelection(): FabricObject | null {
    return this.canvas.getActiveObject() ?? null;
  }

  updateSelection(props: Record<string, unknown>) {
    const c = this.canvas;
    const objs = c.getActiveObjects();
    if (!objs.length) return;
    for (const o of objs) {
      if ('stroke' in props && o instanceof Line) {
        o.set({ stroke: props.stroke });
        continue;
      }
      o.set(props);
    }
    c.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('selection');
  }

  flipSelection(axis: 'x' | 'y') {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    if (axis === 'x') obj.set('flipX', !obj.flipX);
    else obj.set('flipY', !obj.flipY);
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
  }

  toggleShadow() {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    obj.set(
      'shadow',
      obj.shadow
        ? null
        : new Shadow({ color: 'rgba(0,0,0,0.6)', blur: 18, offsetX: 6, offsetY: 6 }),
    );
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('selection');
  }

  /**
   * Applique une série de modifications sur une map en une seule entrée
   * d'historique (utilisé par le générateur aléatoire).
   */
  batch(id: MapId, opts: { clear?: boolean }, fn: (c: Canvas) => void) {
    const st = this.maps.get(id)!;
    st.suspendHistory = true;
    try {
      const c = st.canvas;
      if (opts.clear) {
        c.discardActiveObject();
        c.remove(...c.getObjects());
        c.backgroundImage = undefined;
      }
      fn(c);
      c.requestRenderAll();
    } finally {
      st.suspendHistory = false;
    }
    this.pushHistory(id);
    this.emit('layers');
    this.emit('selection');
  }

  // --------------------------------------------------- peinture directe sur la 3D

  /**
   * Démarre un trait de pinceau à la position (x, y) en pixels du canvas de la
   * map `mapId`. Chaque trait devient un seul calque `Path` éditable/annulable.
   */
  paintBegin(mapId: MapId, x: number, y: number, opts: { color: string; size: number }) {
    if (this.stroke3d) this.paintEnd();
    const st = this.maps.get(mapId)!;
    st.suspendHistory = true;
    const path = new Path(brushPathData([{ x, y }]), {
      stroke: opts.color,
      strokeWidth: opts.size,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      fill: '',
      selectable: true,
      evented: true,
      strokeUniform: true,
    }) as MutablePath;
    (path as FabricObject & { name?: string }).name = 'Peinture 3D';
    if (this.clipIslandKey) this.applyClip(path, mapId);
    st.canvas.add(path);
    this.stroke3d = { mapId, st, path, pts: [{ x, y }] };
    st.canvas.requestRenderAll();
    this.flushTexture();
  }

  /** Prolonge le trait de pinceau 3D courant. */
  paintMove(x: number, y: number) {
    const s = this.stroke3d;
    if (!s) return;
    const last = s.pts[s.pts.length - 1];
    if (Math.abs(last.x - x) < 1 && Math.abs(last.y - y) < 1) return;
    s.pts.push({ x, y });
    s.path._setPath(brushPathData(s.pts), true);
    s.path.setCoords();
    this.markTextureDirty(s.mapId);
    s.st.canvas.requestRenderAll();
  }

  /** Termine le trait de pinceau 3D et l'enregistre dans l'historique. */
  paintEnd() {
    const s = this.stroke3d;
    if (!s) return;
    this.stroke3d = null;
    s.st.suspendHistory = false;
    s.path.setCoords();
    s.st.canvas.requestRenderAll();
    this.pushHistory(s.mapId);
    if (this.symmetry) void this.createMirror(s.path, s.st.canvas, s.mapId);
    this.emit('layers');
    this.flushTexture();
  }

  /**
   * Construit une forme de remplissage (Polygon ou Group) épousant les contours
   * UV exacts de l'îlot `key`, en coordonnées absolues du canvas.
   */
  private buildIslandFill(key: string, mapId: MapId): FabricObject | null {
    const island = UV_GUIDE_ISLANDS.find((i) => i.key === key);
    if (!island || island.polygons.length === 0) return null;
    const res = MAP_BY_ID[mapId].workRes;
    const common = {
      fill: this.fillColorValue(),
      stroke: undefined as string | undefined,
      strokeWidth: 0,
      strokeUniform: true,
    };
    const toPoly = (poly: { x: number; y: number }[]) =>
      new Polygon(
        poly.map((p) => ({ x: p.x * res, y: p.y * res })),
        { ...common, absolutePositioned: true },
      );
    if (island.polygons.length === 1) return toPoly(island.polygons[0]);
    return new Group(island.polygons.map(toPoly), { absolutePositioned: true });
  }

  /**
   * Remplit une pièce UV avec la couleur de remplissage courante.
   * Utilise les polygones exacts de UV_GUIDE_ISLANDS (pas le rectangle englobant).
   * Repli sur un rectangle inset si l'îlot n'est pas trouvé.
   *
   * `regionKey` identifie la pièce (clé SKIN_REGIONS / DETAILS_REGIONS).
   */
  fillRegion(
    frac: { x: number; y: number; w: number; h: number; label?: string },
    regionKey?: string,
  ) {
    const c = this.canvas;
    const res = MAP_BY_ID[this.activeMap].workRes;
    const effKey = regionKey ?? this.clipIslandKey ?? undefined;
    let obj: FabricObject | null = effKey ? this.buildIslandFill(effKey, this.activeMap) : null;

    if (!obj) {
      const inset = 0.08;
      obj = new Rect({
        left: (frac.x + frac.w * inset) * res,
        top: (frac.y + frac.h * inset) * res,
        width: Math.max(frac.w * res * (1 - 2 * inset), 4),
        height: Math.max(frac.h * res * (1 - 2 * inset), 4),
        fill: this.fillColorValue(),
        originX: 'left',
        originY: 'top',
        strokeUniform: true,
        rx: res * 0.008,
        ry: res * 0.008,
      });
    }

    (obj as FabricObject & { name?: string }).name = frac.label
      ? `Remplissage · ${frac.label}`
      : 'Remplissage pièce';
    c.add(obj);
    c.setActiveObject(obj);
    this.setTool('select');
    if (this.symmetry) void this.createMirror(obj, c, this.activeMap, effKey);
    c.requestRenderAll();
    this.emit('layers');
    this.emit('selection');
  }

  // -------------------------------------------------------------- précision

  setSymmetry(on: boolean) {
    this.symmetry = on;
  }

  setClipIsland(key: string | null) {
    this.clipIslandKey = key;
  }

  setSnap(enabled: boolean, gridSize?: number) {
    this.snapEnabled = enabled;
    if (gridSize && gridSize > 0) this.gridSize = gridSize;
  }

  /** Aligner les décalques/numéros sur la voiture (orientation de la pièce). */
  setCarAligned(on: boolean) {
    this.carAligned = on;
  }

  /**
   * Construit un clipPath fabric épousant l'îlot UV `key`, en coordonnées
   * absolues du canvas. Un Path evenodd (multi-polygones) évite les bugs fabric
   * avec Group + FabricImage lors de l'isolation de pièce.
   */
  private buildIslandClip(key: string, mapId: MapId, mirror = false): FabricObject | null {
    const island = UV_GUIDE_ISLANDS.find((i) => i.key === key);
    if (!island || island.polygons.length === 0) return null;
    const res = MAP_BY_ID[mapId].workRes;
    if (island.polygons.length === 1) {
      return new Polygon(
        island.polygons[0].map((p) => ({ x: (mirror ? 1 - p.x : p.x) * res, y: p.y * res })),
        { absolutePositioned: true },
      );
    }
    let d = '';
    for (const poly of island.polygons) {
      if (poly.length < 2) continue;
      const pts = poly.map((p) => {
        const x = (mirror ? 1 - p.x : p.x) * res;
        const y = p.y * res;
        return `${x} ${y}`;
      });
      d += `M ${pts[0]}`;
      for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]}`;
      d += ' Z ';
    }
    if (!d.trim()) return null;
    return new Path(d.trim(), {
      absolutePositioned: true,
      fill: 'black',
      fillRule: 'evenodd',
    });
  }

  /** Applique le clip d'îlot courant à un objet (si un îlot est sélectionné). */
  private applyClip(obj: FabricObject, mapId: MapId = this.activeMap, mirror = false) {
    if (!this.clipIslandKey) return;
    const clip = this.buildIslandClip(this.clipIslandKey, mapId, mirror);
    if (clip) obj.clipPath = clip;
  }

  /**
   * Crée un clone miroir (axe vertical central) de `obj` sur `canvas`, comme
   * calque indépendant et éditable. Convention : réflexion sur x → largeur − x,
   * avec flipX inversé et angle négatif.
   */
  private async createMirror(
    obj: FabricObject,
    canvas: Canvas,
    mapId: MapId = this.activeMap,
    clipKeyOverride?: string,
  ) {
    const clone = await obj.clone(CUSTOM_PROPS);
    const w = MAP_BY_ID[mapId].workRes;
    const center = obj.getCenterPoint();
    clone.set({
      flipX: !obj.flipX,
      angle: -(obj.angle ?? 0),
    });
    // clip miroir pour rester dans l'îlot reflété (sinon on droppe le clip hérité).
    // `clipKeyOverride` (fillRegion des zones details) prime sur le clip courant.
    const clipKey = clipKeyOverride ?? this.clipIslandKey ?? undefined;
    if (clipKey) {
      const clip = this.buildIslandClip(clipKey, mapId, true);
      clone.clipPath = clip ?? undefined;
    } else {
      clone.clipPath = undefined;
    }
    (clone as FabricObject & { id?: string }).id = nextId();
    const baseName = (obj as FabricObject & { name?: string }).name;
    (clone as FabricObject & { name?: string }).name = baseName
      ? `${baseName} (miroir)`
      : 'Miroir';
    canvas.add(clone);
    clone.setXY(new Point(w - center.x, center.y), 'center', 'center');
    clone.setCoords();
    canvas.requestRenderAll();
    this.flushTexture();
  }

  // ------------------------------------------------------- transform numérique

  /** Géométrie de l'objet sélectionné (centre X/Y, dimensions à l'échelle, angle). */
  getTransform(): Transform | null {
    const o = this.canvas.getActiveObject();
    if (!o) return null;
    const c = o.getCenterPoint();
    return {
      x: Math.round(c.x),
      y: Math.round(c.y),
      w: Math.round(o.getScaledWidth()),
      h: Math.round(o.getScaledHeight()),
      angle: Math.round((((o.angle ?? 0) % 360) + 360) % 360),
    };
  }

  /** Applique une géométrie partielle à l'objet sélectionné. */
  setTransform(p: Partial<Transform>) {
    const o = this.canvas.getActiveObject();
    if (!o) return;
    if (p.angle !== undefined) o.rotate(p.angle);
    if (p.w !== undefined && o.width) o.scaleX = Math.max(p.w, 1) / o.width;
    if (p.h !== undefined && o.height) o.scaleY = Math.max(p.h, 1) / o.height;
    if (p.x !== undefined || p.y !== undefined) {
      const c = o.getCenterPoint();
      o.setXY(new Point(p.x ?? c.x, p.y ?? c.y), 'center', 'center');
    }
    o.setCoords();
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('selection');
  }

  /** Centre le centroïde du plus grand polygone d'un îlot, en 0..1. */
  private islandCentroid(key: string): { x: number; y: number } | null {
    const island = UV_GUIDE_ISLANDS.find((i) => i.key === key);
    if (!island) return null;
    let best: { x: number; y: number }[] | null = null;
    let bestArea = -1;
    for (const poly of island.polygons) {
      let a = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
      }
      const area = Math.abs(a) / 2;
      if (area > bestArea) {
        bestArea = area;
        best = poly;
      }
    }
    if (!best || best.length === 0) return null;
    let cx = 0;
    let cy = 0;
    for (const pt of best) {
      cx += pt.x;
      cy += pt.y;
    }
    return { x: cx / best.length, y: cy / best.length };
  }

  /**
   * Centre l'objet sélectionné sur l'îlot UV `key`. Si `align` (par défaut
   * `carAligned`), applique aussi l'orientation « voiture » de la pièce
   * (REGION_ORIENTATION) : l'objet reste éditable mais apparaît droit / vers
   * l'avant SUR LA VOITURE, quelle que soit la rotation/miroir de l'îlot UV.
   */
  centerSelectionInIsland(key: string, align: boolean = this.carAligned) {
    const o = this.canvas.getActiveObject();
    if (!o) return;
    const c = this.islandCentroid(key);
    if (!c) return;
    const res = MAP_BY_ID[this.activeMap].workRes;
    if (align) {
      const { angle, flipX } = getRegionOrientation(key);
      // orientation ABSOLUE « voiture » (idempotente, cohérente avec le
      // générateur) : le décalque se lit droit / vers l'avant sur la voiture.
      o.set('flipX', flipX);
      o.rotate(angle);
    }
    o.setXY(new Point(c.x * res, c.y * res), 'center', 'center');
    o.setCoords();
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('selection');
  }

  // ---------------------------------------------------- calque de référence

  /** Importe une image comme sous-calque verrouillé et semi-transparent (traçage). */
  async addReferenceUnderlay(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      const c = this.canvas;
      const res = MAP_BY_ID[this.activeMap].workRes;
      const scale = Math.min(res / img.width!, res / img.height!);
      img.set({
        left: res / 2,
        top: res / 2,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale,
        opacity: 0.5,
        selectable: false,
        evented: false,
      });
      (img as FabricObject & { name?: string }).name = 'Référence';
      c.add(img);
      c.sendObjectToBack(img);
      c.requestRenderAll();
      this.pushHistory(this.activeMap);
      this.emit('layers');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Règle l'opacité des calques de référence de la map active. */
  setReferenceOpacity(v: number) {
    const c = this.canvas;
    let touched = false;
    for (const o of c.getObjects()) {
      if ((o as FabricObject & { name?: string }).name === 'Référence') {
        o.set('opacity', v);
        touched = true;
      }
    }
    if (touched) {
      this.markTextureDirty(this.activeMap);
      c.requestRenderAll();
    }
  }

  /** True si la map active contient au moins un calque de référence. */
  hasReference(): boolean {
    return this.canvas
      .getObjects()
      .some((o) => (o as FabricObject & { name?: string }).name === 'Référence');
  }

  // ------------------------------------------------------------------ history

  private serialize(c: Canvas): string {
    return JSON.stringify(c.toObject(CUSTOM_PROPS));
  }

  /** True si la map diffère de son état initial (ou post-import / reset). */
  isDirty(id: MapId = this.activeMap): boolean {
    const st = this.maps.get(id);
    if (!st) return false;
    // Évite de resérialiser des fonds importés (2048² en data URL) à chaque événement dirty.
    return st.undo.length > 1;
  }

  /** État dirty de toutes les maps (pour badges onglets). */
  getDirtyMaps(): Record<MapId, boolean> {
    const out = {} as Record<MapId, boolean>;
    for (const id of this.maps.keys()) out[id] = this.isDirty(id);
    return out;
  }

  /** Réaligne la baseline sur l'état courant (import, vidage, génération…). */
  resetMapBaseline(id: MapId) {
    const st = this.maps.get(id);
    if (!st) return;
    const snap = this.serialize(st.canvas);
    st.baseline = snap;
    st.undo = [snap];
    st.redo = [];
    this.emit('history');
    this.emit('dirty');
  }

  resetAllBaselines() {
    for (const id of this.maps.keys()) this.resetMapBaseline(id);
  }

  private pushHistory(id: MapId) {
    const st = this.maps.get(id)!;
    if (st.suspendHistory) return;
    const snap = this.serialize(st.canvas);
    if (st.undo[st.undo.length - 1] === snap) return;
    st.undo.push(snap);
    if (st.undo.length > 60) st.undo.shift();
    st.redo = [];
    this.markTextureDirty(id);
    this.emit('history');
    this.emit('dirty');
  }

  canUndo(): boolean {
    return this.maps.get(this.activeMap)!.undo.length > 1;
  }

  canRedo(): boolean {
    return this.maps.get(this.activeMap)!.redo.length > 0;
  }

  async undo() {
    const st = this.maps.get(this.activeMap)!;
    if (st.undo.length <= 1) return;
    st.redo.push(st.undo.pop()!);
    await this.restore(st, st.undo[st.undo.length - 1]);
  }

  async redo() {
    const st = this.maps.get(this.activeMap)!;
    const snap = st.redo.pop();
    if (!snap) return;
    st.undo.push(snap);
    await this.restore(st, snap);
  }

  private async restore(st: MapState, snap: string) {
    st.suspendHistory = true;
    try {
      await st.canvas.loadFromJSON(JSON.parse(snap));
      st.textureDirty = true;
      st.canvas.requestRenderAll();
    } finally {
      st.suspendHistory = false;
    }
    this.emit('layers');
    this.emit('selection');
    this.emit('history');
    this.emit('dirty');
  }

  clearMap() {
    const c = this.canvas;
    c.discardActiveObject();
    c.remove(...c.getObjects());
    c.backgroundImage = undefined;
    c.backgroundColor = MAP_BY_ID[this.activeMap].defaultFill;
    c.requestRenderAll();
    this.markTextureDirty(this.activeMap);
    this.resetMapBaseline(this.activeMap);
    this.emit('layers');
    this.emit('selection');
  }

  dispose() {
    this.unwireViewport();
    this.resizeObserver.disconnect();
    if (this.textureRaf) window.cancelAnimationFrame(this.textureRaf);
    for (const [, st] of this.maps) st.canvas.dispose();
    this.container.innerHTML = '';
  }
}
