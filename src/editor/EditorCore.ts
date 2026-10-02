/**
 * Cœur de l'éditeur : un canvas fabric.js par map de texture, outils de
 * dessin, calques, undo/redo. Indépendant de React ; l'UI s'abonne via on().
 */

import {
  ActiveSelection,
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
  StaticCanvas,
  type TMat2D,
} from 'fabric';
import { MAPS, MAP_BY_ID, getRegionOrientation, SKIN_REGIONS, type IllumRole, type MapId } from '../maps';
import { decodeIllumCodes, encodeIllumCodes, importLightPixels, imageLightBitmap, roleAlpha, roleFromAlpha, type IllumCodes, type ImageLight } from '../illumination';
import { speedLightPolygons } from '../skinZip';
import { UV_GUIDE_ISLANDS } from '../uvGuideData';
import { applyObjectPaint, applyObjectStyle, readObjectPaint } from './objectPaint';
import { imageIslandAt, imageIslandClearance } from './imagePlacement';
import { materialBitmap, moveProjection, type DecalFamily, type DecalProjection, type PixelSource, type ProjectionBitmap, type SurfaceAnchor, type Vec3 } from '../three/decalProjection';
import { decodeSurfaceMaterial, type SurfaceMaterial } from '../material';
import type { ProjectMaps } from '../projectFile';

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
  linked: boolean;
}

export type CoreEvent =
  | 'layers'
  | 'selection'
  | 'texture'
  | 'history'
  | 'viewport'
  | 'brush'
  | 'dirty'
  | 'speed-color';

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

/**
 * Propriétés personnalisées sérialisées dans l'historique / les clones.
 * `mirrorOf` lie deux calques en miroir (symétrie) : l'un suit l'autre tant
 * que le mode symétrie est actif.
 */
const CUSTOM_PROPS = ['id', 'name', 'selectable', 'evented', 'visible', 'mirrorOf', 'referenceOnly', 'illumRole', 'illumCodes', 'decal', 'linkedImageId', 'linkedImageKind', 'imageMaterial', 'imageMaterialEnabled', 'imageOrder', 'imageLight', 'imageLightEnabled'];

/** Calque verrouillé des feux arrière : seule sa couleur se règle. */
const SPEED_LIGHT_NAME = 'Vitesse';

/** Objet fabric enrichi des propriétés personnalisées de l'éditeur. */
type EditorObject = FabricObject & { id?: string; name?: string; mirrorOf?: string; referenceOnly?: boolean; illumRole?: IllumRole; illumCodes?: IllumCodes;
  decal?: DecalProjection; linkedImageId?: string; linkedImageKind?: 'color' | 'material' | 'light'; imageMaterial?: SurfaceMaterial; imageMaterialEnabled?: boolean; imageOrder?: number; imageLight?: ImageLight; imageLightEnabled?: boolean };

type LightCanvas = Canvas & { illumRole?: IllumRole };

const isReference = (object: FabricObject) => (object as EditorObject).referenceOnly === true || ((object as EditorObject).name === 'Référence' && object.selectable === false);

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
  /**
   * Clé de fusion de la dernière entrée d'historique (curseur d'opacité, champ
   * X…). Tant que la même clé se répète, la dernière entrée est remplacée :
   * un geste = une annulation. `endHistoryCoalescing()` ou une autre clé
   * referme le geste.
   */
  coalesceKey: string | null;
}

export type MapCopyMode = 'replace' | 'overlay';

interface CheckpointEntry {
  snap: string;
  undo: string[];
  redo: string[];
}

/** Point de reprise opaque renvoyé par `createCheckpoint()`. */
export interface HistoryCheckpoint {
  maps: Map<MapId, CheckpointEntry>;
}

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
  private imageDrag: { mapId: MapId; image: FabricImage; pointer: Point; center: Point; islandKey?: string; clearance: number; changed: boolean } | null = null;
  private projectionDrag: { image: FabricImage & EditorObject; mapId: MapId; pointer: Vec3; center: Vec3; changed: boolean } | null = null;
  projectionBaker: ((decal: DecalProjection, source: PixelSource) => Map<DecalFamily, ProjectionBitmap>) | null = null;
  private projectionSources = new Map<string, PixelSource>();
  private projectionBakes = new Map<string, { key: string; bitmaps: Map<DecalFamily, ProjectionBitmap> }>();
  private refreshingLinkedImages = false;
  private textureRaf = 0;
  private resizeObserver: ResizeObserver;
  /**
   * URLs `blob:` des images ajoutées (logos, fonds importés, références).
   * Elles DOIVENT rester valides tant que l'éditeur vit : les snapshots
   * d'historique référencent l'image par son `src`, et `loadFromJSON`
   * (undo/redo) la recharge depuis cette URL. Révoquées dans dispose().
   */
  private objectUrls: string[] = [];
  takeObjectUrls(): string[] { const urls = this.objectUrls; this.objectUrls = []; return urls; }
  adoptObjectUrls(urls: string[]) { this.objectUrls.push(...urls); }
  /** Couleur des feux arrière (compteur). Toujours allumés. Blanc par défaut. */
  private speedLightColor = '#ffffff';
  illumToolRole: IllumRole = 'always';
  private illumRoles = new Map<MapId, HTMLCanvasElement>();
  private importedRoleMasks = new WeakMap<IllumCodes, HTMLCanvasElement>();

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
      if (def.kind === 'illum') (canvas as LightCanvas).illumRole = 'always';
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
        coalesceKey: null,
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
    const illum = this.maps.get('Details_I');
    if (illum) {
      this.ensureSpeedLight(illum);
      this.resetMapBaseline('Details_I');
    }
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
    const references = c.getObjects().filter(isReference).map((object) => ({ object, visible: object.visible }));
    try {
      // A tracing guide belongs to the editor, never to the car's paint data.
      for (const { object } of references) object.set('visible', false);
      c.setViewportTransform([...DEFAULT_VPT]);
      const snap = c.toCanvasElement(1);
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, res, res);
      ctx.drawImage(snap, 0, 0);
      if (MAP_BY_ID[id].kind === 'illum') this.syncIllumRoles(id, c, res);
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
      for (const { object, visible } of references) object.set('visible', visible);
      c.setViewportTransform(savedVpt);
    }
  }

  /** Discrete roles follow the top visible layer; opacity remains colour brightness. */
  private syncIllumRoles(id: MapId, c: Canvas, res: number) {
    const canvas = this.illumRoles.get(id) ?? document.createElement('canvas');
    this.illumRoles.set(id, canvas);
    canvas.width = res; canvas.height = res;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(res, res);
    const backgroundRole = this.getIllumBackgroundRole(id);
    const alpha = roleAlpha(backgroundRole);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = alpha;
      image.data[i + 3] = 255;
    }
      for (const object of c.getObjects()) {
        if (!object.visible || isReference(object) || this.isSpeedLight(object)) continue;
        const bounds = object.getBoundingRect();
        const shadow = object.shadow;
        const padding = shadow ? shadow.blur * 2 + Math.abs(shadow.offsetX) + Math.abs(shadow.offsetY) + 2 : 2;
        const x = Math.max(0, Math.floor(bounds.left - padding)); const y = Math.max(0, Math.floor(bounds.top - padding));
        const width = Math.min(res, Math.ceil(bounds.left + bounds.width + padding)) - x;
        const height = Math.min(res, Math.ceil(bounds.top + bounds.height + padding)) - y;
        if (width <= 0 || height <= 0) continue;
        const mask = document.createElement('canvas'); mask.width = width; mask.height = height;
        const maskContext = mask.getContext('2d')!; maskContext.translate(-x, -y); object.render(maskContext);
        const coverage = maskContext.getImageData(0, 0, width, height).data;
        const code = roleAlpha((object as EditorObject).illumRole ?? backgroundRole);
        const original = (object as EditorObject).illumCodes;
        let originalPixels: Uint8ClampedArray | undefined;
        if (original && object instanceof FabricImage) {
          let source = this.importedRoleMasks.get(original);
          if (!source) {
            const codes = decodeIllumCodes(original);
            source = document.createElement('canvas'); source.width = original.width; source.height = original.height;
            const pixels = source.getContext('2d')!.createImageData(original.width, original.height);
            for (let p = 0; p < codes.length; p++) { pixels.data[p * 4] = codes[p]; pixels.data[p * 4 + 3] = 255; }
            source.getContext('2d')!.putImageData(pixels, 0, 0); this.importedRoleMasks.set(original, source);
          }
          const roleImage = new FabricImage(source, { left: object.left, top: object.top, width: object.width, height: object.height,
            scaleX: object.scaleX, scaleY: object.scaleY, angle: object.angle, flipX: object.flipX, flipY: object.flipY,
            skewX: object.skewX, skewY: object.skewY, originX: object.originX, originY: object.originY, cropX: object.cropX, cropY: object.cropY,
            clipPath: object.clipPath, objectCaching: false });
          const raster = document.createElement('canvas'); raster.width = width; raster.height = height;
          const context = raster.getContext('2d')!; context.translate(-x, -y); context.imageSmoothingEnabled = false; roleImage.render(context);
          originalPixels = context.getImageData(0, 0, width, height).data;
          // Keep the shared clipping object owned by its editable image.
          roleImage.clipPath = undefined; roleImage.dispose();
        }
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
          const i = (row * width + col) * 4;
          if (coverage[i + 3] > 0) image.data[((y + row) * res + x + col) * 4] = originalPixels && originalPixels[i + 3] > 0 ? originalPixels[i] : code;
        }
      }
    ctx.putImageData(image, 0, 0);
  }

  getIllumRoleCanvas(id: MapId = 'Details_I'): HTMLCanvasElement {
    this.syncTextureCanvas(id);
    return this.illumRoles.get(id)!;
  }

  getIllumBackgroundRole(id: MapId = this.activeMap): IllumRole {
    return (this.maps.get(id)!.canvas as LightCanvas).illumRole ?? 'always';
  }

  setIllumBackgroundRole(role: IllumRole, applyToAll = false) {
    if (MAP_BY_ID[this.activeMap].kind !== 'illum') return;
    const checkpoint = applyToAll ? this.createCheckpoint() : null;
    const st = this.maps.get(this.activeMap)!;
    (st.canvas as LightCanvas).illumRole = role;
    if (applyToAll) for (const object of st.canvas.getObjects()) {
      if (!isReference(object) && !this.isSpeedLight(object)) {
        const linked = (object as EditorObject).linkedImageId;
        const owner = linked && this.imageOwners().find(({ image }) => image.id === linked);
        if (owner && owner.image.imageLight) { owner.image.imageLight = { ...owner.image.imageLight, role }; this.pushHistory(owner.mapId); }
        else if (owner && MAP_BY_ID[owner.mapId].kind === 'illum') { owner.image.illumRole = role; owner.image.illumCodes = undefined; this.pushHistory(owner.mapId); }
        (object as EditorObject).illumRole = role;
        (object as EditorObject).illumCodes = undefined;
      }
    }
    this.refreshLinkedImages();
    this.pushHistory(this.activeMap);
    if (checkpoint) this.commitCheckpoint(checkpoint);
    this.markTextureDirty(this.activeMap);
    st.canvas.requestRenderAll();
    this.emit('selection');
    this.flushTexture();
  }

  getSelectionIllumRole(): IllumRole | 'mixed' {
    const roles = new Set(this.canvas.getActiveObjects().map((object) => (object as EditorObject).illumRole ?? this.getIllumBackgroundRole()));
    return roles.size > 1 ? 'mixed' : roles.values().next().value ?? this.illumToolRole;
  }

  setSelectionIllumRole(role: IllumRole) {
    if (MAP_BY_ID[this.activeMap].kind !== 'illum') return;
    for (const object of this.canvas.getActiveObjects()) {
      (object as EditorObject).illumRole = role;
      (object as EditorObject).illumCodes = undefined;
      const partner = this.symmetry ? this.mirrorPartner(object, this.canvas) : null;
      if (partner) { (partner as EditorObject).illumRole = role; (partner as EditorObject).illumCodes = undefined; }
    }
    this.refreshLinkedImages();
    this.pushHistory(this.activeMap);
    this.markTextureDirty(this.activeMap);
    this.canvas.requestRenderAll();
    this.emit('selection');
    this.flushTexture();
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

  /** Le focus est dans un champ de saisie (nom du skin, valeurs numériques…). */
  private static isEditableTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  private onViewportKeyDown(e: KeyboardEvent) {
    if (e.code === 'Space' && !this.isTextEditing() && !EditorCore.isEditableTarget(e.target)) {
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
      const obj = e.target as EditorObject;
      if (!obj.id) obj.id = nextId();
      if (MAP_BY_ID[id].kind === 'illum' && !obj.illumRole && !isReference(obj) && !this.isSpeedLight(obj)) obj.illumRole = this.illumToolRole;
      if (obj.name !== SPEED_LIGHT_NAME) {
        const speed = c.getObjects().find((o) => (o as EditorObject).name === SPEED_LIGHT_NAME);
        if (speed && speed !== obj) c.bringObjectToFront(speed);
      }
      record();
    });
    c.on('object:removed', record);
    c.on('object:modified', (e) => {
      // Fin de geste : le miroir lié reçoit la géométrie finale avant le snapshot.
      this.syncMirrorOf(e.target as FabricObject | undefined, c, id);
      if ((e.target as EditorObject)?.imageMaterialEnabled || (e.target as EditorObject)?.imageLight) this.refreshLinkedImages();
      record();
      this.emit('selection');
    });
    const selectionChanged = () => {
      const object = c.getActiveObject() as EditorObject | undefined;
      if (object?.linkedImageId && !this.refreshingLinkedImages) this.selectLinkedImageOwner(object.linkedImageId);
      else this.emit('selection');
    };
    c.on('selection:created', selectionChanged);
    c.on('selection:updated', selectionChanged);
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
      this.syncMirrorOf(t, c, id);
      if ((t as EditorObject | undefined)?.imageMaterialEnabled || (t as EditorObject | undefined)?.imageLight) this.refreshLinkedImages();
      this.emit('selection');
    });
    c.on('object:scaling', (e) => {
      this.syncMirrorOf(e.target as FabricObject | undefined, c, id);
      if ((e.target as EditorObject)?.imageMaterialEnabled || (e.target as EditorObject)?.imageLight) this.refreshLinkedImages();
      this.emit('selection');
    });
    c.on('object:rotating', (e) => {
      this.syncMirrorOf(e.target as FabricObject | undefined, c, id);
      if ((e.target as EditorObject)?.imageMaterialEnabled || (e.target as EditorObject)?.imageLight) this.refreshLinkedImages();
      this.emit('selection');
    });
    c.on('object:skewing', (e) => {
      this.syncMirrorOf(e.target as FabricObject | undefined, c, id);
    });
    // Texte édité inline : le miroir lié reflète le nouveau contenu.
    c.on('text:changed', (e) => {
      const t = e.target as IText | undefined;
      if (!t || !this.symmetry) return;
      const partner = this.mirrorPartner(t, c) as IText | undefined;
      if (partner && partner.text !== t.text) {
        partner.set('text', t.text);
        this.markTextureDirty(id);
      }
    });

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
        // Ajout + saisie (+ miroir éventuel) = une seule entrée d'historique,
        // enregistrée à la fin de l'édition inline.
        state.suspendHistory = true;
        c.add(text);
        c.setActiveObject(text);
        this.setTool('select');
        text.enterEditing();
        text.selectAll();
        this.emit('layers');
        text.once('editing:exited', () => {
          const finalize = () => {
            state.suspendHistory = false;
            this.pushHistory(id);
            this.emit('layers');
          };
          // Le miroir est créé quand l'édition du texte se termine (contenu figé).
          if (this.symmetry && c.getObjects().includes(text)) {
            void this.createMirror(text, c, id).then(finalize, finalize);
          } else {
            finalize();
          }
        });
        return;
      }
      let obj: FabricObject;
      const strokeW = this.effectiveStrokeWidth();
      const dash =
        this.strokeDashed && strokeW > 0 ? this.dashArrayFor(strokeW) : undefined;
      // fabric 7 centre l'origine par défaut : on ancre explicitement le coin
      // haut-gauche pour que left/top = point de départ du glisser.
      const common = {
        fill: this.newShapeFill(),
        stroke: strokeW > 0 ? this.strokeColor : undefined,
        strokeWidth: strokeW,
        strokeDashArray: dash,
        strokeUniform: true,
        originX: 'left' as const,
        originY: 'top' as const,
      };
      if (this.tool === 'rect') {
        obj = new Rect({ ...common, left: p.x, top: p.y, width: 1, height: 1 });
      } else if (this.tool === 'ellipse') {
        obj = new Ellipse({ ...common, left: p.x, top: p.y, rx: 1, ry: 1 });
      } else if (this.tool === 'polygon') {
        obj = new Polygon(this.polygonPoints(p.x, p.y, 1), { ...common });
      } else {
        // La ligne n'a pas de remplissage : sa couleur visible est le trait.
        const lineColor = this.strokeColor;
        const lineW = Math.max(this.strokeWidth, 1);
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
    this.endImageDrag();
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

  /** `coalesce` : clé de fusion d'historique (curseur rugosité/métal, pipette couleur…). */
  setBackgroundColor(color: string, coalesce?: string) {
    const c = this.canvas;
    c.backgroundColor = color;
    c.requestRenderAll();
    this.pushHistory(this.activeMap, coalesce);
  }

  /** Changes the full editable surface in one undoable step, preserving geometry. */
  applyMaterialToActiveMap(color: string) {
    const id = this.activeMap;
    const st = this.maps.get(id)!;
    const c = st.canvas;
    const wasSuspended = st.suspendHistory;
    st.suspendHistory = true;
    try {
      for (const object of c.getObjects()) applyObjectPaint(object, color);
      c.backgroundColor = color;
      c.requestRenderAll();
    } finally {
      st.suspendHistory = wasSuspended;
    }
    this.pushHistory(id);
    this.emit('layers');
    this.emit('selection');
    this.flushTexture();
  }

  getBackgroundColor(): string {
    return (this.canvas.backgroundColor as string) || '#000000';
  }

  /**
   * Crée une URL `blob:` persistante pour un fichier image. Elle n'est PAS
   * révoquée après chargement (voir `objectUrls`) : l'historique undo/redo
   * recharge les images depuis leur `src`.
   */
  private persistentObjectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  private async loadEditableImage(file: File): Promise<FabricImage> {
    if (file.size > 32 * 1024 * 1024) throw new Error('Image trop volumineuse : 32 Mo maximum.');
    if (file.type && !file.type.startsWith('image/')) throw new Error('Choisissez un fichier image (PNG, JPEG, WebP ou SVG).');
    const url = this.persistentObjectUrl(file);
    try {
      const image = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      if (!image.width || !image.height || image.width > 8192 || image.height > 8192 || image.width * image.height > 32 * 1024 * 1024) {
        image.dispose();
        throw new Error('Image trop grande : 8192 px par côté et 32 millions de pixels maximum.');
      }
      return image;
    } catch (error) {
      URL.revokeObjectURL(url);
      this.objectUrls = this.objectUrls.filter((entry) => entry !== url);
      throw error;
    }
  }

  async addImageFromFile(file: File, placement?: { mapId: MapId; x: number; y: number; islandKey?: string }) {
    const mapId = placement?.mapId ?? this.activeMap;
    const clipKey = placement ? placement.islandKey : this.clipIslandKey;
    const img = await this.loadEditableImage(file);
    const st = this.maps.get(mapId)!;
    const c = st.canvas;
    const W = c.width!;
    const H = c.height!;
    // En symétrie, l'image est posée sur la moitié droite du canvas (et son
    // miroir sur la gauche) : les deux copies sont visibles d'emblée au lieu
    // d'être superposées au centre.
    const maxFrac = placement ? 0.18 : this.symmetry ? 0.36 : 0.6;
    const scale = Math.min((W * maxFrac) / img.width!, (H * maxFrac) / img.height!, 1);
    img.set({
      left: placement?.x ?? (this.symmetry ? W * 0.72 : W / 2),
      top: placement?.y ?? H / 2,
      originX: 'center',
      originY: 'center',
      scaleX: scale,
      scaleY: scale,
      perPixelTargetFind: true,
    });
    if (placement?.islandKey && this.carAligned) img.set(getRegionOrientation(placement.islandKey));
    (img as EditorObject).name = file.name;
    (img as EditorObject).imageOrder = Date.now() * 1000 + idCounter;
    if (clipKey) img.clipPath = this.buildIslandClip(clipKey, mapId) ?? undefined;
    // Image + miroir = une seule entrée d'historique.
    st.suspendHistory = true;
    try {
      c.add(img);
      if (this.symmetry) await this.createMirror(img, c, mapId);
    } finally {
      st.suspendHistory = false;
    }
    this.pushHistory(mapId);
    c.setActiveObject(img);
    this.setTool('select');
    this.emit('layers');
    this.emit('selection');
    c.requestRenderAll();
    this.flushTexture();
    return img;
  }

  /** Une seule image source et un seul historique ; les fragments et la matière sont des calques liés. */
  async addProjectedImage(file: File, mapId: MapId, anchor: SurfaceAnchor, withMaterial = false) {
    const image = await this.loadEditableImage(file);
    const sourceCanvas = document.createElement('canvas');
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    sourceCanvas.width = Math.max(1, Math.round(image.width * scale));
    sourceCanvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image.getElement(), 0, 0, sourceCanvas.width, sourceCanvas.height);
    const sourceBlob = await new Promise<Blob>((resolve, reject) => sourceCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image impossible à préparer.')), 'image/png'));
    const source = this.persistentObjectUrl(sourceBlob);
    this.projectionSources.set(source, ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height));
    const family = MAP_BY_ID[mapId].group;
    const object = image as FabricImage & EditorObject;
    object.id = nextId(); object.name = file.name; object.imageOrder = Date.now() * 1000 + idCounter;
    const width = .65;
    object.decal = { source, center: [...anchor.point], normal: [...anchor.normal], tangent: [...anchor.tangent],
      width, height: width * sourceCanvas.height / sourceCanvas.width, depth: .45, angle: 0,
      families: family === 'wheels' ? ['wheels'] : ['skin', 'details'] };
    if (withMaterial) {
      object.imageMaterial = this.defaultImageMaterial(mapId);
      object.imageMaterialEnabled = true;
      object.decal.material = object.imageMaterial;
    }
    const st = this.maps.get(mapId)!;
    st.suspendHistory = true;
    try { st.canvas.add(object); } finally { st.suspendHistory = false; }
    this.refreshLinkedImages();
    this.pushHistory(mapId);
    if (this.activeMap !== mapId) this.setActiveMap(mapId);
    this.setTool('select');
    st.canvas.setActiveObject(object);
    this.emit('selection'); this.emit('layers'); this.flushTexture();
  }

  private defaultImageMaterial(mapId: MapId): SurfaceMaterial {
    const target = this.materialMap(MAP_BY_ID[mapId].group);
    return decodeSurfaceMaterial(String(this.maps.get(target)!.canvas.backgroundColor || MAP_BY_ID[target].defaultFill));
  }

  private materialMap(family: DecalFamily): MapId {
    return family === 'skin' ? 'Skin_R' : family === 'details' ? 'Details_R' : 'Wheels_R';
  }

  private imageOwners() {
    const owners: { mapId: MapId; image: FabricImage & EditorObject }[] = [];
    for (const [mapId, state] of this.maps) for (const object of state.canvas.getObjects()) {
      if (object instanceof FabricImage && !(object as EditorObject).linkedImageId) owners.push({ mapId, image: object as FabricImage & EditorObject });
    }
    return owners;
  }

  private selectLinkedImageOwner(id: string) {
    const owner = this.imageOwners().find(({ image }) => image.id === id);
    if (!owner || !owner.image.selectable) return false;
    if (this.activeMap !== owner.mapId) this.setActiveMap(owner.mapId);
    this.canvas.setActiveObject(owner.image);
    this.canvas.requestRenderAll(); this.emit('selection'); this.emit('layers');
    return true;
  }

  private bitmapCanvas(bitmap: PixelSource): HTMLCanvasElement {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height), 0, 0);
    return canvas;
  }

  /** Fragments reconstruits depuis l'image maîtresse, exclus de l'historique pour éviter toute désynchronisation. */
  refreshLinkedImages() {
    if (this.refreshingLinkedImages) return;
    this.refreshingLinkedImages = true;
    const wanted = new Set<string>();
    try {
      for (const { mapId, image } of this.imageOwners()) {
        if (!image.id || isReference(image)) continue;
        const light = image.imageLightEnabled !== false ? image.imageLight : undefined;
        if (image.decal || image.imageMaterialEnabled || light) image.imageOrder ??= Date.now() * 1000 + idCounter++;
        let colors: Map<DecalFamily, ProjectionBitmap>;
        if (image.decal && this.projectionBaker) {
          const source = this.projectionSources.get(image.decal.source);
          if (!source) continue;
          const { material: _material, ...geometry } = image.decal;
          const key = JSON.stringify(geometry);
          const saved = this.projectionBakes.get(image.id);
          colors = saved?.key === key ? saved.bitmaps : this.projectionBaker(image.decal, source);
          this.projectionBakes.set(image.id, { key, bitmaps: colors });
          const own = colors.get(MAP_BY_ID[mapId].group);
          const canvas = own ? this.bitmapCanvas(own) : document.createElement('canvas');
          if (!own) { canvas.width = MAP_BY_ID[mapId].workRes; canvas.height = canvas.width; }
          image.setElement(canvas);
          image.set({ left: 0, top: 0, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0,
            flipX: false, flipY: false, clipPath: undefined, hasControls: false, hasBorders: false,
            lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true,
            perPixelTargetFind: true, objectCaching: false });
          image.setCoords(); this.markTextureDirty(mapId); this.maps.get(mapId)!.canvas.requestRenderAll();
        } else if (image.imageMaterialEnabled || light) {
          const c = this.maps.get(mapId)!.canvas;
          const saved = { backgroundColor: c.backgroundColor, backgroundImage: c.backgroundImage, vpt: c.viewportTransform.slice(), opacity: image.opacity, shadow: image.shadow };
          let mask: HTMLCanvasElement;
          try {
            c.backgroundColor = ''; c.backgroundImage = undefined; c.setViewportTransform([...DEFAULT_VPT]);
            image.set({ opacity: 1, shadow: null });
            mask = c.toCanvasElement(1, { filter: (object) => object === image });
          } finally {
            c.backgroundColor = saved.backgroundColor; c.backgroundImage = saved.backgroundImage; c.setViewportTransform(saved.vpt as TMat2D);
            image.set({ opacity: saved.opacity, shadow: saved.shadow });
          }
          const res = MAP_BY_ID[mapId].workRes;
          colors = new Map([[MAP_BY_ID[mapId].group, { width: res, height: res, data: mask.getContext('2d')!.getImageData(0, 0, res, res).data, triangles: 1 }]]);
        } else continue;
        for (const [family, bitmap] of colors) {
          const colorMap: MapId = family === 'skin' ? 'Skin_B' : family === 'details' ? 'Details_B' : 'Wheels_B';
          if (image.decal && MAP_BY_ID[mapId].kind === 'basecolor' && colorMap !== mapId) this.upsertLinkedImage(image, colorMap, bitmap, 'color', wanted);
          const material = image.decal?.material ?? (image.imageMaterialEnabled ? image.imageMaterial : undefined);
          if (material) this.upsertLinkedImage(image, this.materialMap(family), { ...bitmap, data: materialBitmap(bitmap, material) }, 'material', wanted);
          const lightMap: MapId = family === 'skin' ? 'Skin_I' : family === 'details' ? 'Details_I' : 'Wheels_I';
          if (MAP_BY_ID[mapId].kind === 'basecolor' && light) this.upsertLinkedImage(image, lightMap, { ...bitmap, data: imageLightBitmap(bitmap, light.strength) }, 'light', wanted);
          else if (image.decal && MAP_BY_ID[mapId].kind === 'illum' && lightMap !== mapId) this.upsertLinkedImage(image, lightMap, bitmap, 'light', wanted);
        }
      }
      for (const [id, state] of this.maps) {
        const stale = state.canvas.getObjects().filter((object) => (object as EditorObject).linkedImageId && !wanted.has((object as EditorObject).id!));
        if (!stale.length) continue;
        state.suspendHistory = true;
        try { state.canvas.remove(...stale); } finally { state.suspendHistory = false; }
        this.markTextureDirty(id); state.canvas.requestRenderAll();
      }
      const owners = new Map(this.imageOwners().map(({ image }) => [image.id, image]));
      for (const [id, state] of this.maps) {
        const objects = state.canvas.getObjects();
        const participants = objects.map((object, index) => ({ object, index, owner: (object as EditorObject).linkedImageId ? owners.get((object as EditorObject).linkedImageId) : object as EditorObject }))
          .filter((entry) => entry.owner?.imageOrder !== undefined);
        const sorted = [...participants].sort((a, b) => a.owner!.imageOrder! - b.owner!.imageOrder!);
        if (sorted.every((entry, index) => entry.object === participants[index].object)) continue;
        sorted.forEach((entry, index) => state.canvas.moveObjectTo(entry.object, participants[index].index));
        this.markTextureDirty(id); state.canvas.requestRenderAll();
      }
    } finally { this.refreshingLinkedImages = false; }
  }

  rebuildProjectionsForModel() {
    this.projectionBakes.clear(); this.refreshLinkedImages(); this.flushTexture(); this.emit('layers'); this.emit('selection'); this.emit('dirty');
  }

  private upsertLinkedImage(owner: FabricImage & EditorObject, mapId: MapId, bitmap: PixelSource, kind: 'color' | 'material' | 'light', wanted: Set<string>) {
    const id = `${owner.id}:${mapId}`; wanted.add(id);
    const state = this.maps.get(mapId)!;
    let child = state.canvas.getObjects().find((object) => (object as EditorObject).id === id) as (FabricImage & EditorObject) | undefined;
    const canvas = this.bitmapCanvas(bitmap);
    if (!child) {
      child = new FabricImage(canvas) as FabricImage & EditorObject;
      child.id = id; child.linkedImageId = owner.id; child.linkedImageKind = kind;
      state.suspendHistory = true;
      try { state.canvas.add(child); } finally { state.suspendHistory = false; }
    } else child.setElement(canvas);
    child.name = `${kind === 'material' ? 'Matière' : kind === 'light' ? 'Lumière' : 'Projection'} · ${owner.name || 'Image'}`;
    if (kind === 'light') child.illumRole = owner.imageLight?.role ?? owner.illumRole ?? 'always';
    child.set({ left: 0, top: 0, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, visible: owner.visible,
      opacity: owner.opacity, selectable: owner.selectable, evented: owner.evented, hasControls: false, hasBorders: false,
      lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true, perPixelTargetFind: true, objectCaching: false });
    child.setCoords(); this.markTextureDirty(mapId); state.canvas.requestRenderAll();
  }

  getSelectionProjection(): DecalProjection | null { return (this.getSelection() as EditorObject | null)?.decal ?? null; }
  getSelectionImageLight(): { enabled: boolean; available: boolean; touches: boolean; value: ImageLight } | null {
    const image = this.getSelection() as (FabricImage & EditorObject) | null;
    if (!(image instanceof FabricImage) || isReference(image) || MAP_BY_ID[this.activeMap].kind !== 'basecolor') return null;
    const available = true;
    const touches = image.decal ? [...(this.projectionBakes.get(image.id!)?.bitmaps.values() ?? [])].some((bitmap) => bitmap.triangles > 0) : available;
    return { enabled: !!image.imageLight && image.imageLightEnabled !== false, available, touches, value: image.imageLight ?? { role: 'always', strength: 1 } };
  }

  setImageLightEnabled(enabled: boolean) {
    const info = this.getSelectionImageLight(); const image = this.getSelection() as EditorObject | null;
    if (!info?.available || !image) return;
    image.imageLight ??= { role: 'always', strength: 1 };
    image.imageLightEnabled = enabled;
    this.refreshLinkedImages(); this.pushHistory(this.activeMap); this.flushTexture(); this.emit('selection'); this.emit('layers');
  }

  setImageLight(values: Partial<ImageLight>, coalesce?: string) {
    const image = this.getSelection() as EditorObject | null;
    if (!this.getSelectionImageLight()?.enabled || !image?.imageLight || (values.strength !== undefined && !Number.isFinite(values.strength))) return;
    if (values.role !== undefined && !['always', 'head', 'brake'].includes(values.role)) return;
    image.imageLight = { ...image.imageLight, ...values, strength: Math.max(0, Math.min(1, values.strength ?? image.imageLight.strength)) };
    this.refreshLinkedImages(); this.pushHistory(this.activeMap, coalesce); this.flushTexture(); this.emit('selection');
  }
  getSelectionImageMaterial(): { enabled: boolean; value: SurfaceMaterial } | null {
    const image = this.getSelection() as (FabricImage & EditorObject) | null;
    if (!(image instanceof FabricImage) || isReference(image) || MAP_BY_ID[this.activeMap].kind !== 'basecolor') return null;
    return { enabled: !!(image.decal?.material || image.imageMaterialEnabled), value: image.decal?.material ?? image.imageMaterial ?? this.defaultImageMaterial(this.activeMap) };
  }

  setImageMaterialEnabled(enabled: boolean) {
    const image = this.getSelection() as EditorObject | null;
    if (!this.getSelectionImageMaterial() || !image) return;
    image.imageMaterial ??= this.defaultImageMaterial(this.activeMap);
    image.imageMaterialEnabled = enabled;
    if (image.decal) image.decal = { ...image.decal, material: enabled ? image.imageMaterial : undefined };
    this.refreshLinkedImages(); this.pushHistory(this.activeMap); this.flushTexture(); this.emit('selection'); this.emit('layers');
  }

  setImageMaterial(roughness: number, metalness: number) {
    const image = this.getSelection() as EditorObject | null;
    if (!this.getSelectionImageMaterial()?.enabled || !image) return;
    image.imageMaterial = { roughness: Math.max(0, Math.min(255, Math.round(roughness))), metalness: Math.max(0, Math.min(255, Math.round(metalness))) };
    if (image.decal) image.decal = { ...image.decal, material: image.imageMaterial };
    this.refreshLinkedImages(); this.pushHistory(this.activeMap, 'image-material'); this.flushTexture(); this.emit('selection');
  }

  setProjection(values: Partial<Pick<DecalProjection, 'width' | 'height' | 'angle' | 'depth' | 'families'>>, coalesce = 'projection') {
    const image = this.getSelection() as (FabricImage & EditorObject) | null;
    if (!image?.decal || Object.values(values).some((value) => typeof value === 'number' && !Number.isFinite(value))) return;
    image.decal = { ...image.decal, ...values };
    if (values.width !== undefined && values.height !== undefined) {
      const scale = Math.min(1, 4.2 / Math.max(image.decal.width, image.decal.height));
      image.decal.width *= scale; image.decal.height *= scale;
    }
    image.decal.width = Math.max(.05, Math.min(4.2, image.decal.width));
    image.decal.height = Math.max(.025, Math.min(4.2, image.decal.height));
    image.decal.depth = Math.max(.02, Math.min(1.5, image.decal.depth));
    this.refreshLinkedImages(); this.pushHistory(this.activeMap, coalesce); this.flushTexture(); this.emit('selection'); this.emit('layers');
  }

  beginProjectionDrag(mapId: MapId, x: number, y: number, anchor: SurfaceAnchor): boolean {
    this.endImageDrag();
    const canvas = this.maps.get(mapId)!.canvas; const point = new Point(x, y); const viewport = point.transform(canvas.viewportTransform);
    const candidate = [...canvas.getObjects()].reverse().find((object) => object instanceof FabricImage && object.selectable && object.visible && object.opacity > 0 &&
      ((object as EditorObject).decal || (object as EditorObject).linkedImageId) && !canvas.isTargetTransparent(object, viewport.x, viewport.y)) as (FabricImage & EditorObject) | undefined;
    if (!candidate) return false;
    const owner = candidate.linkedImageId ? this.imageOwners().find(({ image }) => image.id === candidate.linkedImageId) : { mapId, image: candidate };
    if (!owner?.image.decal || !owner.image.selectable) return false;
    this.selectLinkedImageOwner(owner.image.id!); this.setTool('select');
    this.projectionDrag = { ...owner, pointer: [...anchor.point], center: [...owner.image.decal.center], changed: false };
    return true;
  }

  moveProjectionDrag(anchor: SurfaceAnchor) {
    const drag = this.projectionDrag;
    if (!drag?.image.decal) return false;
    const point = anchor.point.map((v, i) => drag.center[i] + v - drag.pointer[i]) as Vec3;
    // Le glisser translate le projecteur sans changer son orientation à chaque triangle.
    // Cela évite les sauts sur les raccords et garde le point saisi sous le curseur.
    drag.image.decal = { ...drag.image.decal, center: point }; drag.changed = true;
    this.refreshLinkedImages(); this.flushTexture(); this.emit('selection'); this.emit('layers');
    return true;
  }

  placeSelectedProjection(anchor: SurfaceAnchor) {
    const image = this.getSelection() as EditorObject | null;
    if (!image?.decal || !image.selectable) return false;
    image.decal = moveProjection(image.decal, anchor);
    this.refreshLinkedImages(); this.pushHistory(this.activeMap); this.flushTexture(); this.emit('selection'); this.emit('layers');
    return true;
  }

  /** Sélection dans l'atlas depuis un clic sur la voiture. Les calques verrouillés sont ignorés. */
  beginImageDrag(mapId: MapId, x: number, y: number): boolean {
    this.endImageDrag();
    const canvas = this.maps.get(mapId)!.canvas;
    const point = new Point(x, y);
    const viewportPoint = point.transform(canvas.viewportTransform);
    const image = [...canvas.getObjects()].reverse().find((object) =>
      object instanceof FabricImage && object.visible && object.opacity > 0 && object.selectable &&
      !isReference(object) && !(object as EditorObject).decal && !(object as EditorObject).linkedImageId && object.containsPoint(point) &&
      !canvas.isTargetTransparent(object, viewportPoint.x, viewportPoint.y),
    ) as FabricImage | undefined;
    if (!image) return false;
    if (this.activeMap !== mapId) this.setActiveMap(mapId);
    this.setTool('select');
    canvas.setActiveObject(image);
    const center = image.getCenterPoint();
    const res = MAP_BY_ID[mapId].workRes;
    const islandKey = image.clipPath ? imageIslandAt(MAP_BY_ID[mapId].group, center.x / res, 1 - center.y / res) : undefined;
    this.imageDrag = { mapId, image, pointer: point, center,
      islandKey,
      clearance: islandKey ? Math.min(imageIslandClearance(MAP_BY_ID[mapId].group, islandKey, center.x / res, 1 - center.y / res), .45 * Math.min(image.getScaledWidth(), image.getScaledHeight()) / res) : 0,
      changed: false };
    canvas.requestRenderAll();
    this.emit('selection');
    return true;
  }

  moveImageDrag(x: number, y: number) {
    const drag = this.imageDrag;
    if (!drag) return false;
    const res = MAP_BY_ID[drag.mapId].workRes;
    const next = new Point(
      Math.max(0, Math.min(res, drag.center.x + x - drag.pointer.x)),
      Math.max(0, Math.min(res, drag.center.y + y - drag.pointer.y)),
    );
    // Le point saisi n'est pas forcément le centre du logo. On vérifie aussi ce centre
    // pour qu'un glisser par un bord ne pousse pas l'image hors de son masque.
    if (drag.islandKey && imageIslandAt(MAP_BY_ID[drag.mapId].group, next.x / res, 1 - next.y / res) !== drag.islandKey) return false;
    if (drag.islandKey && imageIslandClearance(MAP_BY_ID[drag.mapId].group, drag.islandKey, next.x / res, 1 - next.y / res) + .00001 < drag.clearance) return false;
    if (next.eq(drag.image.getCenterPoint())) return true;
    drag.image.setXY(next, 'center', 'center');
    drag.image.setCoords();
    drag.changed = true;
    const canvas = this.maps.get(drag.mapId)!.canvas;
    this.syncMirrorOf(drag.image, canvas, drag.mapId);
    this.refreshLinkedImages();
    this.markTextureDirty(drag.mapId);
    canvas.requestRenderAll();
    this.emitTexture();
    this.emit('selection');
    return true;
  }

  /** Un déplacement complet correspond à un seul Ctrl+Z. */
  endImageDrag() {
    const projection = this.projectionDrag;
    this.projectionDrag = null;
    if (projection?.changed) this.pushHistory(projection.mapId);
    const drag = this.imageDrag;
    this.imageDrag = null;
    if (drag?.changed) this.pushHistory(drag.mapId);
  }

  placeSelectedImage(x: number, y: number, islandKey?: string): boolean {
    const image = this.getSelection();
    if (!(image instanceof FabricImage) || !image.selectable || isReference(image)) return false;
    this.endImageDrag();
    image.setXY(new Point(x, y), 'center', 'center');
    // Le nouveau masque remplace celui de la pièce précédente, sans changer la taille ni l'orientation.
    image.clipPath = islandKey ? this.buildIslandClip(islandKey, this.activeMap) ?? undefined : undefined;
    image.setCoords();
    this.syncMirrorOf(image, this.canvas, this.activeMap);
    this.refreshLinkedImages();
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.flushTexture();
    this.emit('selection');
    return true;
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

  /** Pose une image importée comme calque sélectionnable (déplaçable, duplicable). */
  private async addImportedImage(
    raster: HTMLCanvasElement,
    name: string,
    place: { left: number; top: number; scaleX: number; scaleY: number },
  ): Promise<FabricImage> {
    const blob = await new Promise<Blob>((resolve, reject) => {
      raster.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encodage PNG impossible'))),
        'image/png',
      );
    });
    const url = this.persistentObjectUrl(blob);
    const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
    img.set({
      left: place.left,
      top: place.top,
      originX: 'left',
      originY: 'top',
      scaleX: place.scaleX,
      scaleY: place.scaleY,
      selectable: true,
      evented: true,
      perPixelTargetFind: true,
    });
    const tagged = img as EditorObject;
    tagged.id = nextId();
    tagged.name = name;
    return img;
  }

  /** Rend opaques les pixels allumés (l'alpha DDS est un rôle, pas une transparence). */
  private opaqueLit(src: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return src;
    ctx.drawImage(src, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20) data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /**
   * Découpe les taches non noires d'une map néon en images séparées.
   * Renvoie `null` s'il y en a trop : on garde alors une seule image.
   */
  private splitLitPatches(src: HTMLCanvasElement, codes?: Uint8Array): { canvas: HTMLCanvasElement; x: number; y: number; codes?: IllumCodes; role?: IllumRole }[] | null {
    const w = src.width;
    const h = src.height;
    const ctx = src.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;
    const lit = new Uint8Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      if (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20) lit[p] = 1;
    }
    const seen = new Uint8Array(w * h);
    const patches: { pixels: number[]; minX: number; minY: number; maxX: number; maxY: number }[] = [];
    for (let s = 0; s < w * h; s++) {
      if (!lit[s] || seen[s]) continue;
      const stack = [s];
      seen[s] = 1;
      const pixels: number[] = [];
      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;
      while (stack.length) {
        const c = stack.pop()!;
        pixels.push(c);
        const x = c % w;
        const y = (c / w) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        const nb = [c - 1, c + 1, c - w, c + w];
        const ok = [x > 0, x < w - 1, y > 0, y < h - 1];
        for (let k = 0; k < 4; k++) {
          if (!ok[k]) continue;
          const n = nb[k];
          if (lit[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      patches.push({ pixels, minX, minY, maxX, maxY });
      // A noisy or hostile image can contain hundreds of thousands of isolated pixels.
      // Preserve it as one image instead of allocating an object per component.
      if (patches.length > 20_000) return null;
    }
    if (patches.length === 0) return [];
    const editable = patches.filter((patch) => patch.pixels.length >= 12);
    const small = patches.filter((patch) => patch.pixels.length < 12);
    // Keep all tiny marks together: do not discard them or flatten the meaningful motifs.
    if (small.length) {
      const combined = { pixels: [] as number[], minX: w, minY: h, maxX: 0, maxY: 0 };
      for (const patch of small) {
        for (const pixel of patch.pixels) combined.pixels.push(pixel);
        combined.minX = Math.min(combined.minX, patch.minX);
        combined.minY = Math.min(combined.minY, patch.minY);
        combined.maxX = Math.max(combined.maxX, patch.maxX);
        combined.maxY = Math.max(combined.maxY, patch.maxY);
      }
      editable.push(combined);
    }
    if (editable.length > 80) return null;
    editable.sort((a, b) => b.pixels.length - a.pixels.length);
    return editable.map((patch) => {
      const pw = patch.maxX - patch.minX + 1;
      const ph = patch.maxY - patch.minY + 1;
      const canvas = document.createElement('canvas');
      canvas.width = pw;
      canvas.height = ph;
      const out = canvas.getContext('2d')!.createImageData(pw, ph);
      const alphaCodes = codes ? new Uint8Array(pw * ph) : undefined;
      const histogram = new Map<IllumRole, number>();
      for (const p of patch.pixels) {
        const x = (p % w) - patch.minX;
        const y = ((p / w) | 0) - patch.minY;
        const si = p * 4;
        const di = (y * pw + x) * 4;
        out.data[di] = data[si];
        out.data[di + 1] = data[si + 1];
        out.data[di + 2] = data[si + 2];
        // L'alpha du DDS est le rôle (frein ≈ 3) : on le rend opaque pour pouvoir
        // voir et déplacer la tache. L'export réécrit le rôle.
        out.data[di + 3] = 255;
        if (alphaCodes && codes) {
          alphaCodes[di / 4] = codes[p];
          const role = roleFromAlpha(codes[p]); histogram.set(role, (histogram.get(role) ?? 0) + 1);
        }
      }
      canvas.getContext('2d')!.putImageData(out, 0, 0);
      return { canvas, x: patch.minX, y: patch.minY,
        codes: alphaCodes ? encodeIllumCodes(pw, ph, alphaCodes) : undefined,
        role: [...histogram].sort((a, b) => b[1] - a[1])[0]?.[0] };
    });
  }

  /** Remplace le contenu importé de la map par des calques éditables. */
  async setBackgroundFromCanvas(
    id: MapId,
    source: HTMLCanvasElement | ImageBitmap,
    opts?: { flush?: boolean; recordHistory?: boolean; illumination?: PixelSource },
  ) {
    const st = this.maps.get(id);
    if (!st) throw new Error(`Map inconnue : ${id}`);
    const c = st.canvas;
    const res = MAP_BY_ID[id].workRes;
    const sw = source.width;
    const sh = source.height;
    if (!sw || !sh) throw new Error(`Image importée vide (0×0) pour ${MAP_BY_ID[id].fileName}`);

    const raster = this.canvasFromImageSource(source);
    const fitted = document.createElement('canvas');
    fitted.width = res;
    fitted.height = res;
    const fitCtx = fitted.getContext('2d');
    if (!fitCtx) throw new Error('Contexte canvas indisponible');
    fitCtx.imageSmoothingEnabled = true;
    fitCtx.imageSmoothingQuality = 'high';
    let importedCodes: Uint8Array | undefined;
    if (opts?.illumination && MAP_BY_ID[id].kind === 'illum') {
      const imported = importLightPixels(opts.illumination, res);
      fitCtx.putImageData(new ImageData(new Uint8ClampedArray(imported.pixels.data), res, res), 0, 0);
      importedCodes = imported.codes;
    } else fitCtx.drawImage(raster, 0, 0, sw, sh, 0, 0, res, res);

    const patches = MAP_BY_ID[id].kind === 'illum' ? this.splitLitPatches(fitted, importedCodes) : null;
    const images: FabricImage[] = [];
    if (patches && patches.length === 0) {
      // Néon entièrement noir : rien à sélectionner.
    } else if (patches && patches.length > 0) {
      for (let i = 0; i < patches.length; i++) {
        const patch = patches[i];
        const image = await this.addImportedImage(patch.canvas, `Néon importé ${i + 1}`, {
            left: patch.x,
            top: patch.y,
            scaleX: 1,
            scaleY: 1,
          });
        (image as EditorObject).illumCodes = patch.codes;
        (image as EditorObject).illumRole = patch.role;
        images.push(image);
      }
    } else {
      const sheet = MAP_BY_ID[id].kind === 'illum' ? this.opaqueLit(fitted) : fitted;
      images.push(
        await this.addImportedImage(sheet, 'Texture importée', {
          left: 0,
          top: 0,
          scaleX: 1,
          scaleY: 1,
        }),
      );
      if (importedCodes) {
        const image = images.at(-1)! as EditorObject;
        image.illumCodes = encodeIllumCodes(res, res, importedCodes);
        const pixels = fitCtx.getImageData(0, 0, res, res).data;
        const litPixel = importedCodes.findIndex((_code, p) => Math.max(pixels[p * 4], pixels[p * 4 + 1], pixels[p * 4 + 2]) > 20);
        image.illumRole = roleFromAlpha(importedCodes[litPixel] ?? 255);
      }
    }

    const stale = c.getObjects().filter((o) => {
      const name = (o as EditorObject).name ?? '';
      return name === 'Texture importée' || name.startsWith('Néon importé') || name === 'Fond importé';
    });
    if (stale.length) c.remove(...stale);
    if (c.backgroundImage) {
      c.backgroundImage.dispose();
      c.backgroundImage = undefined;
    }
    for (const img of images) {
      c.add(img);
      c.sendObjectToBack(img);
    }
    c.requestRenderAll();

    if (opts?.recordHistory !== false) this.pushHistory(id);
    else this.markTextureDirty(id);
    if (id === this.activeMap) this.emit('layers');
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
    const srcObjects = srcState.canvas.getObjects().filter((o) => !this.isSpeedLight(o));

    dstState.suspendHistory = true;
    try {
      if (mode === 'replace') {
        dstCanvas.discardActiveObject();
        dstCanvas.remove(...dstCanvas.getObjects());
      }
      for (const obj of srcObjects) {
        const clone = await obj.clone(CUSTOM_PROPS);
        // Une copie entre atlas copie ses pixels. Elle ne crée pas un second maître du projecteur.
        const copy = clone as EditorObject;
        copy.decal = undefined; copy.linkedImageId = undefined; copy.linkedImageKind = undefined;
        copy.illumCodes = undefined;
        copy.imageMaterial = undefined; copy.imageMaterialEnabled = false; copy.imageOrder = undefined; copy.imageLight = undefined; copy.imageLightEnabled = undefined;
        (clone as FabricObject & { id?: string }).id = nextId();
        const srcName = (obj as FabricObject & { name?: string }).name;
        if (srcName) (clone as FabricObject & { name?: string }).name = srcName;
        dstCanvas.add(clone);
      }
      if (targetId === 'Details_I') this.ensureSpeedLight(dstState);
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
      .filter((o) => !this.isSpeedLight(o))
      .map((o) => {
        const obj = o as FabricObject & { id?: string; name?: string };
        return {
          id: obj.id ?? '',
          name: obj.name || this.defaultName(obj),
          type: obj.type,
          visible: obj.visible !== false,
          locked: !obj.selectable,
          selected: active.has(obj),
          linked: !!(obj as EditorObject).linkedImageId,
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
      case 'polygon':
        return 'Polygone';
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
    if ((obj as EditorObject).linkedImageId) { this.selectLinkedImageOwner((obj as EditorObject).linkedImageId!); return; }
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    this.emit('layers');
    this.emit('selection');
  }

  toggleVisible(id: string) {
    const obj = this.findById(id);
    if (!obj) return;
    if ((obj as EditorObject).linkedImageId) {
      const owner = this.imageOwners().find(({ image }) => image.id === (obj as EditorObject).linkedImageId);
      if (!owner) return;
      owner.image.visible = !owner.image.visible;
      this.refreshLinkedImages(); this.pushHistory(owner.mapId); this.emit('layers');
      return;
    }
    obj.visible = !obj.visible;
    this.refreshLinkedImages();
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('layers');
  }

  toggleLock(id: string) {
    const obj = this.findById(id);
    if (!obj) return;
    const linked = (obj as EditorObject).linkedImageId;
    if (linked) {
      const owner = this.imageOwners().find(({ image }) => image.id === linked);
      if (!owner) return;
      this.setActiveMap(owner.mapId); this.toggleLock(linked); return;
    }
    const locked = obj.selectable;
    obj.selectable = !locked ? true : false;
    obj.evented = obj.selectable;
    this.refreshLinkedImages();
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
    if ((obj as EditorObject).linkedImageId) return;
    if (dir === 'up') c.bringObjectForward(obj);
    else if (dir === 'down') c.sendObjectBackwards(obj);
    else if (dir === 'top') c.bringObjectToFront(obj);
    else c.sendObjectToBack(obj);
    if ((obj as EditorObject).imageOrder !== undefined) {
      const owners = new Map(this.imageOwners().map(({ image }) => [image.id, image]));
      const peers = c.getObjects().map((object) => (object as EditorObject).linkedImageId ? owners.get((object as EditorObject).linkedImageId) : object as EditorObject)
        .filter((object): object is EditorObject => object?.imageOrder !== undefined);
      const index = peers.indexOf(obj as EditorObject);
      const before = peers[index - 1]?.imageOrder; const after = peers[index + 1]?.imageOrder;
      if (before !== undefined && after !== undefined) (obj as EditorObject).imageOrder = (before + after) / 2;
      else if (before !== undefined) (obj as EditorObject).imageOrder = before + 1;
      else if (after !== undefined) (obj as EditorObject).imageOrder = after - 1;
      this.refreshLinkedImages();
    }
    c.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('layers');
  }

  /**
   * Supprime des objets (et, en mode symétrie, leurs miroirs liés) en une
   * seule entrée d'historique.
   */
  private removeObjects(objs: FabricObject[]) {
    const st = this.maps.get(this.activeMap)!;
    const c = st.canvas;
    const toRemove = new Set<FabricObject>(objs.filter((o) => !this.isSpeedLight(o)));
    if (!toRemove.size) return;
    if (this.symmetry) {
      for (const o of objs) {
        const partner = this.mirrorPartner(o, c);
        if (partner) toRemove.add(partner);
      }
    }
    if (c.getActiveObject()) c.discardActiveObject();
    st.suspendHistory = true;
    try {
      c.remove(...toRemove);
    } finally {
      st.suspendHistory = false;
    }
    this.refreshLinkedImages();
    this.pushHistory(this.activeMap);
    c.requestRenderAll();
    this.emit('layers');
    this.emit('selection');
  }

  deleteSelection() {
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) return;
    this.removeObjects(objs);
  }

  deleteLayer(id: string) {
    const obj = this.findById(id);
    if (!obj) return;
    if ((obj as EditorObject).linkedImageId) {
      const kind = (obj as EditorObject).linkedImageKind;
      if (!this.selectLinkedImageOwner((obj as EditorObject).linkedImageId!)) return;
      if (kind === 'material') this.setImageMaterialEnabled(false);
      else if (kind === 'light' && MAP_BY_ID[this.activeMap].kind === 'basecolor') this.setImageLightEnabled(false);
      else this.deleteSelection();
      return;
    }
    this.removeObjects([obj]);
  }

  async duplicateSelection() {
    const st = this.maps.get(this.activeMap)!;
    const c = st.canvas;
    const obj = c.getActiveObject();
    if (!obj) return;
    const clone = await obj.clone(CUSTOM_PROPS);
    if ((obj as EditorObject).decal) {
      const decal = (obj as EditorObject).decal!;
      (clone as EditorObject).decal = { ...decal, center: decal.center.map((v, i) => v + decal.tangent[i] * .12) as Vec3 };
    } else clone.set({ left: (obj.left ?? 0) + 24, top: (obj.top ?? 0) + 24 });
    (clone as EditorObject).id = nextId();
    (clone as EditorObject).imageOrder = Date.now() * 1000 + idCounter;
    (clone as EditorObject).mirrorOf = undefined;
    st.suspendHistory = true;
    try {
      c.add(clone);
      if (this.symmetry && !(obj as EditorObject).decal) await this.createMirror(clone, c, this.activeMap);
    } finally {
      st.suspendHistory = false;
    }
    this.refreshLinkedImages();
    this.pushHistory(this.activeMap);
    c.setActiveObject(clone);
    c.requestRenderAll();
    this.emit('layers');
    this.emit('selection');
  }

  // ---------------------------------------------------------------- selection

  getSelection(): FabricObject | null {
    return this.canvas.getActiveObject() ?? null;
  }

  getSelectionPaint() {
    const object = this.getSelection();
    return object ? readObjectPaint(object) : null;
  }

  setSelectionMaterial(color: string, coalesce = 'surface-material') {
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) return;
    const targets = new Set(objects);
    if (this.symmetry) {
      for (const object of objects) {
        const partner = this.mirrorPartner(object, this.canvas);
        if (partner) targets.add(partner);
      }
    }
    for (const object of targets) applyObjectPaint(object, color);
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap, coalesce);
    this.emit('selection');
  }

  /**
   * Applique `props` à la sélection. `coalesce` (ex. `'opacity'`) fusionne les
   * crans successifs d'un même curseur en une seule entrée d'historique.
   */
  updateSelection(props: Record<string, unknown>, coalesce?: string) {
    const c = this.canvas;
    const objs = c.getActiveObjects();
    if (!objs.length) return;
    const targets = new Set<FabricObject>(objs);
    // En symétrie, le style (couleur, contour, police…) s'applique aussi au miroir.
    if (this.symmetry) {
      for (const o of objs) {
        const partner = this.mirrorPartner(o, c);
        if (partner) targets.add(partner);
      }
    }
    for (const o of targets) {
      applyObjectStyle(o, props);
    }
    this.refreshLinkedImages();
    c.requestRenderAll();
    this.pushHistory(this.activeMap, coalesce);
    this.emit('selection');
  }

  flipSelection(axis: 'x' | 'y') {
    const obj = this.canvas.getActiveObject();
    if (!obj) return;
    if ((obj as EditorObject).decal || (obj as EditorObject).linkedImageId) return;
    if (axis === 'x') obj.set('flipX', !obj.flipX);
    else obj.set('flipY', !obj.flipY);
    this.syncMirrorOf(obj, this.canvas, this.activeMap);
    this.refreshLinkedImages();
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
  }

  toggleShadow() {
    const c = this.canvas;
    const obj = c.getActiveObject();
    if (!obj) return;
    const next = obj.shadow
      ? null
      : new Shadow({ color: 'rgba(0,0,0,0.6)', blur: 18, offsetX: 6, offsetY: 6 });
    obj.set('shadow', next);
    if (this.symmetry) {
      const partner = this.mirrorPartner(obj, c);
      if (partner) {
        partner.set(
          'shadow',
          next ? new Shadow({ ...next.toObject(), offsetX: -next.offsetX }) : null,
        );
      }
    }
    c.requestRenderAll();
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
      if (id === 'Details_I') this.ensureSpeedLight(st);
      c.requestRenderAll();
    } finally {
      st.suspendHistory = false;
    }
    this.refreshLinkedImages();
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
  /** Couleur actuelle des feux de vitesse (hex). */
  getSpeedLightColor(): string {
    return this.speedLightColor;
  }

  /**
   * Pose la couleur des feux arrière. Ces îlots restent allumés ; le rôle
   * (frein, phares, néon) ne les concerne pas.
   */
  setSpeedLightColor(color: string) {
    const hex = color.trim().toLowerCase();
    this.speedLightColor = /^#[0-9a-f]{6}$/.test(hex) ? hex : '#ffffff';
    const st = this.maps.get('Details_I');
    if (!st) return;
    this.ensureSpeedLight(st);
    this.pushHistory('Details_I', 'speed-color');
    this.markTextureDirty('Details_I');
    st.canvas.requestRenderAll();
    this.flushTexture();
    this.emit('speed-color');
  }

  private isSpeedLight(obj: FabricObject): boolean {
    return (obj as EditorObject).name === SPEED_LIGHT_NAME;
  }

  private mapIdOf(st: MapState): MapId | null {
    for (const [id, s] of this.maps) if (s === st) return id;
    return null;
  }

  /** Recrée le calque verrouillé du compteur, uniquement sur son panneau. */
  private ensureSpeedLight(st: MapState) {
    const c = st.canvas;
    const existing = c.getObjects().filter((o) => this.isSpeedLight(o));
    const was = st.suspendHistory;
    st.suspendHistory = true;
    try {
      if (existing.length) c.remove(...existing);
      const res = MAP_BY_ID.Details_I.workRes;
      const parts = speedLightPolygons().map(
        (poly) =>
          new Polygon(
            poly.map((p) => ({ x: p.x * res, y: p.y * res })),
            {
              fill: this.speedLightColor,
              strokeWidth: 0,
              absolutePositioned: true,
              selectable: false,
              evented: false,
            },
          ),
      );
      if (!parts.length) return;
      const group = new Group(parts, {
        absolutePositioned: true,
        selectable: false,
        evented: false,
      });
      (group as EditorObject).name = SPEED_LIGHT_NAME;
      c.add(group);
    } finally {
      st.suspendHistory = was;
    }
  }

  fillRegion(
    frac: { x: number; y: number; w: number; h: number; label?: string },
    regionKey?: string,
  ) {
    const effKey = regionKey ?? this.clipIslandKey ?? undefined;
    const c = this.canvas;
    const res = MAP_BY_ID[this.activeMap].workRes;
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
      skewX: -(obj.skewX ?? 0),
      skewY: -(obj.skewY ?? 0),
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
    const src = obj as EditorObject;
    const mirror = clone as EditorObject;
    if (!src.id) src.id = nextId();
    mirror.id = nextId();
    // Liaison bidirectionnelle : chacun suit l'autre tant que la symétrie est active.
    mirror.mirrorOf = src.id;
    src.mirrorOf = mirror.id;
    mirror.name = src.name ? `${src.name} (miroir)` : 'Miroir';
    canvas.add(clone);
    clone.setXY(new Point(w - center.x, center.y), 'center', 'center');
    clone.setCoords();
    canvas.requestRenderAll();
    this.flushTexture();
  }

  /** Calque miroir lié à `obj` (via `mirrorOf`), s'il existe encore sur le canvas. */
  private mirrorPartner(obj: FabricObject, canvas: Canvas): FabricObject | undefined {
    const id = (obj as EditorObject).mirrorOf;
    if (!id) return undefined;
    return canvas.getObjects().find((o) => (o as EditorObject).id === id);
  }

  /**
   * Répercute la géométrie de `src` sur son miroir lié (réflexion sur l'axe
   * vertical central) : position, échelle, rotation, skew, flip et dimensions
   * intrinsèques. Actif uniquement en mode symétrie ; ignore les sélections
   * multiples (coordonnées relatives au groupe).
   */
  private syncMirrorOf(src: FabricObject | undefined, canvas: Canvas, mapId: MapId) {
    if (!src || !this.symmetry) return;
    if (src instanceof ActiveSelection) return;
    const partner = this.mirrorPartner(src, canvas);
    if (!partner || partner === src) return;
    const w = MAP_BY_ID[mapId].workRes;
    const s = src as FabricObject & { rx?: number; ry?: number };
    const p = partner as FabricObject & { rx?: number; ry?: number };
    const props: Record<string, unknown> = {
      flipX: !src.flipX,
      flipY: src.flipY,
      angle: -(src.angle ?? 0),
      scaleX: src.scaleX,
      scaleY: src.scaleY,
      skewX: -(src.skewX ?? 0),
      skewY: -(src.skewY ?? 0),
      strokeWidth: src.strokeWidth,
    };
    // Dimensions intrinsèques (Rect/Ellipse redimensionnés via le panneau numérique).
    if (src.type === partner.type) {
      if (src.width !== undefined) props.width = src.width;
      if (src.height !== undefined) props.height = src.height;
      if (s.rx !== undefined && p.rx !== undefined) props.rx = s.rx;
      if (s.ry !== undefined && p.ry !== undefined) props.ry = s.ry;
    }
    partner.set(props);
    const c = src.getCenterPoint();
    partner.setXY(new Point(w - c.x, c.y), 'center', 'center');
    partner.setCoords();
    this.markTextureDirty(mapId);
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

  /** Applique une géométrie partielle à l'objet sélectionné (`coalesce` : voir updateSelection). */
  setTransform(p: Partial<Transform>, coalesce?: string) {
    const o = this.canvas.getActiveObject();
    if (!o) return;
    if ((o as EditorObject).decal || (o as EditorObject).linkedImageId) return;
    if (p.angle !== undefined) o.rotate(p.angle);
    if (p.w !== undefined && o.width) o.scaleX = Math.max(p.w, 1) / o.width;
    if (p.h !== undefined && o.height) o.scaleY = Math.max(p.h, 1) / o.height;
    if (p.x !== undefined || p.y !== undefined) {
      const c = o.getCenterPoint();
      o.setXY(new Point(p.x ?? c.x, p.y ?? c.y), 'center', 'center');
    }
    o.setCoords();
    this.syncMirrorOf(o, this.canvas, this.activeMap);
    this.refreshLinkedImages();
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap, coalesce);
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
    if ((o as EditorObject).decal || (o as EditorObject).linkedImageId) return;
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
    this.syncMirrorOf(o, this.canvas, this.activeMap);
    this.refreshLinkedImages();
    this.canvas.requestRenderAll();
    this.pushHistory(this.activeMap);
    this.emit('selection');
  }

  // ---------------------------------------------------- calque de référence

  /** Importe une image comme sous-calque verrouillé et semi-transparent (traçage). */
  async addReferenceUnderlay(file: File) {
    const mapId = this.activeMap;
    const img = await this.loadEditableImage(file);
    const st = this.maps.get(mapId)!;
    const c = st.canvas;
    const res = MAP_BY_ID[mapId].workRes;
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
    (img as EditorObject).name = 'Référence';
    (img as EditorObject).referenceOnly = true;
    st.suspendHistory = true;
    try {
      c.remove(...c.getObjects().filter(isReference));
      c.add(img);
      c.sendObjectToBack(img);
    } finally {
      st.suspendHistory = false;
    }
    c.requestRenderAll();
    this.pushHistory(mapId);
    this.emit('layers');
  }

  /** Règle l'opacité des calques de référence de la map active. */
  setReferenceOpacity(v: number) {
    const c = this.canvas;
    let touched = false;
    for (const o of c.getObjects()) {
      if (isReference(o)) {
        o.set('opacity', v);
        touched = true;
      }
    }
    if (touched) {
      this.pushHistory(this.activeMap, 'reference-opacity');
      c.requestRenderAll();
    }
  }

  /** True si la map active contient au moins un calque de référence. */
  hasReference(): boolean {
    return this.canvas
      .getObjects()
      .some(isReference);
  }

  getReferenceOpacity(): number {
    return this.canvas.getObjects().find(isReference)?.opacity ?? 0.5;
  }

  // ------------------------------------------------------------------ history

  private serialize(c: Canvas): string {
    const data = c.toObject(CUSTOM_PROPS);
    if ((c as LightCanvas).illumRole) data.illumRole = (c as LightCanvas).illumRole;
    data.objects = data.objects.filter((object: { linkedImageId?: string }) => !object.linkedImageId);
    return JSON.stringify(data);
  }

  /** Archive les originaux PNG, jamais les URLs temporaires ni les fragments recalculables. */
  async captureProject() {
    this.endHistoryCoalescing(); this.endImageDrag();
    const maps = {} as ProjectMaps; const assets = new Map<string, Blob>();
    const imagePaths = new Map<string, string>();
    const packImage = async (image: FabricImage & EditorObject, json: Record<string, unknown>) => {
      const key = image.decal?.source ?? image.getSrc();
      let path = imagePaths.get(key);
      if (!path) {
        const original = image.decal && this.projectionSources.get(image.decal.source);
        if (image.decal && !original) throw new Error('L’image originale d’une projection n’est pas disponible.');
        let bitmap: HTMLCanvasElement;
        if (original) bitmap = this.bitmapCanvas(original);
        else {
          const element = image.getElement();
          const width = element instanceof HTMLImageElement ? element.naturalWidth : element.width;
          const height = element instanceof HTMLImageElement ? element.naturalHeight : element.height;
          if (!width || !height || width > 8192 || height > 8192 || width * height > 32 * 1024 * 1024) throw new Error('Une image ne peut pas être sauvegardée : dimensions invalides.');
          bitmap = document.createElement('canvas'); bitmap.width = width; bitmap.height = height;
          bitmap.getContext('2d')!.drawImage(element, 0, 0);
        }
        const blob = await new Promise<Blob>((resolve, reject) => bitmap.toBlob((value) => value ? resolve(value) : reject(new Error('Image impossible à sauvegarder.')), 'image/png'));
        path = `assets/image-${assets.size}.png`; assets.set(path, blob); imagePaths.set(key, path);
      }
      json.src = path;
      if (json.decal && typeof json.decal === 'object') (json.decal as Record<string, unknown>).source = path;
    };
    const packObject = async (object: FabricObject, json: Record<string, unknown>) => {
      if (object instanceof FabricImage) await packImage(object as FabricImage & EditorObject, json);
      if (object instanceof Group && Array.isArray(json.objects)) {
        const children = object.getObjects();
        for (let i = 0; i < children.length; i++) await packObject(children[i], json.objects[i] as Record<string, unknown>);
      }
      if (object.clipPath && json.clipPath) await packObject(object.clipPath as FabricObject, json.clipPath as Record<string, unknown>);
    };
    for (const [id, state] of this.maps) {
      const json = JSON.parse(this.serialize(state.canvas)) as Record<string, unknown>;
      const objects = state.canvas.getObjects().filter((o) => !(o as EditorObject).linkedImageId);
      for (let i = 0; i < objects.length; i++) await packObject(objects[i], (json.objects as Record<string, unknown>[])[i]);
      if (state.canvas.backgroundImage && json.backgroundImage) await packObject(state.canvas.backgroundImage, json.backgroundImage as Record<string, unknown>);
      maps[id] = json;
    }
    return { maps, assets, speedColor: this.speedLightColor, illumRole: this.getIllumBackgroundRole('Details_I') };
  }

  /** Tous les calques sont chargés dans des canvas temporaires avant de remplacer le projet courant. */
  async loadProject(maps: ProjectMaps, globals: { speedColor: string; illumRole: IllumRole }) {
    const staged = new Map<MapId, StaticCanvas>();
    const sources = new Map<string, PixelSource>();
    try {
      for (const def of MAPS) {
        const canvas = new StaticCanvas(document.createElement('canvas'), { width: def.workRes, height: def.workRes, renderOnAddRemove: false });
        staged.set(def.id, canvas);
        await canvas.loadFromJSON(maps[def.id]);
        for (const object of canvas.getObjects()) {
          const image = object as FabricImage & EditorObject;
          if (!(image instanceof FabricImage) || !image.decal || sources.has(image.decal.source)) continue;
          const original = await FabricImage.fromURL(image.decal.source);
          try {
            const bitmap = document.createElement('canvas'); bitmap.width = original.width; bitmap.height = original.height;
            const context = bitmap.getContext('2d', { willReadFrequently: true })!;
            context.drawImage(original.getElement(), 0, 0);
            sources.set(image.decal.source, context.getImageData(0, 0, bitmap.width, bitmap.height));
          } finally { original.dispose(); }
        }
      }
      this.endImageDrag(); this.endHistoryCoalescing();
      this.projectionSources = sources; this.projectionBakes.clear();
      this.speedLightColor = globals.speedColor;
      for (const [id, temporary] of staged) {
        const state = this.maps.get(id)!; const canvas = state.canvas;
        state.suspendHistory = true;
        try {
          canvas.discardActiveObject(); canvas.clear();
          canvas.backgroundColor = temporary.backgroundColor;
          canvas.backgroundImage = temporary.backgroundImage; temporary.backgroundImage = undefined;
          const objects = temporary.getObjects(); temporary.remove(...objects); canvas.add(...objects);
          if (MAP_BY_ID[id].kind === 'illum') (canvas as LightCanvas).illumRole = (maps[id].illumRole as IllumRole | undefined) ?? 'always';
          if (id === 'Details_I') { (canvas as LightCanvas).illumRole = globals.illumRole; this.ensureSpeedLight(state); }
          for (const object of canvas.getObjects()) object.setCoords();
          state.textureDirty = true;
        } finally { state.suspendHistory = false; }
      }
      this.refreshLinkedImages(); this.resetAllBaselines();
      this.emit('speed-color'); this.emit('layers'); this.emit('selection'); this.flushTexture();
    } finally { for (const canvas of staged.values()) await canvas.dispose(); }
  }

  /** True si la map diffère de son état initial (ou post-import / reset). */
  isDirty(id: MapId = this.activeMap): boolean {
    const st = this.maps.get(id);
    if (!st) return false;
    // Évite de resérialiser des fonds importés (2048² en data URL) à chaque événement dirty.
    return st.undo.length > 1 || st.canvas.getObjects().some((object) => {
      const linked = (object as EditorObject).linkedImageId;
      const owner = linked && this.imageOwners().find(({ image }) => image.id === linked);
      return !!owner && this.maps.get(owner.mapId)!.undo.length > 1;
    });
  }

  /** État dirty de toutes les maps (pour badges onglets). */
  getDirtyMaps(): Record<MapId, boolean> {
    const out = {} as Record<MapId, boolean>;
    for (const id of this.maps.keys()) out[id] = this.isDirty(id);
    return out;
  }

  /** Références aux snapshots courants : changer de texture ne modifie pas le projet. */
  getProjectContentState(): string[] {
    return [...this.maps.values()].map((state) => state.undo.at(-1) ?? state.baseline).concat(this.speedLightColor);
  }

  hasProjectContent(): boolean {
    return [...this.maps].some(([id, state]) => !!state.canvas.backgroundImage || state.canvas.backgroundColor !== MAP_BY_ID[id].defaultFill || state.canvas.getObjects().some((object) => !this.isSpeedLight(object)));
  }

  /** Réaligne la baseline sur l'état courant (import, vidage, génération…). */
  resetMapBaseline(id: MapId) {
    const st = this.maps.get(id);
    if (!st) return;
    const snap = this.serialize(st.canvas);
    st.baseline = snap;
    st.undo = [snap];
    st.redo = [];
    st.coalesceKey = null;
    this.emit('history');
    this.emit('dirty');
  }

  resetAllBaselines() {
    for (const id of this.maps.keys()) this.resetMapBaseline(id);
  }

  /**
   * Empile un snapshot. Avec `coalesceKey`, les appels successifs porteurs de
   * la même clé remplacent la dernière entrée : un geste de curseur = une
   * seule annulation. Toute entrée sans clé, une autre clé, ou
   * `endHistoryCoalescing()`, referme le geste.
   */
  private pushHistory(id: MapId, coalesceKey?: string) {
    const st = this.maps.get(id)!;
    if (st.suspendHistory) return;
    const snap = this.serialize(st.canvas);
    const merge =
      !!coalesceKey &&
      st.coalesceKey === coalesceKey &&
      st.undo.length > 1; // jamais remplacer la baseline
    st.coalesceKey = coalesceKey ?? null;
    if (st.undo[st.undo.length - 1] === snap) return;
    if (merge) {
      if (st.undo[st.undo.length - 2] === snap) {
        // Retour à la valeur d'avant le geste : l'entrée n'a plus de raison d'être.
        st.undo.pop();
        st.coalesceKey = null;
      } else {
        st.undo[st.undo.length - 1] = snap;
      }
    } else {
      st.undo.push(snap);
      if (st.undo.length > 60) st.undo.shift();
    }
    st.redo = [];
    this.markTextureDirty(id);
    this.emit('history');
    this.emit('dirty');
  }

  /**
   * Termine le geste en cours (relâchement d'un curseur, blur d'un champ) : la
   * prochaine modification, même de la même propriété, créera une nouvelle entrée.
   */
  endHistoryCoalescing() {
    for (const [, st] of this.maps) st.coalesceKey = null;
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

  /**
   * Point de reprise multi-maps : capture l'état courant et les piles
   * d'historique de toutes les maps (ex. avant l'aperçu d'une génération dans
   * une modale, pour pouvoir « Annuler » ou « Conserver » proprement).
   */
  createCheckpoint(): HistoryCheckpoint {
    const maps = new Map<MapId, CheckpointEntry>();
    for (const [id, st] of this.maps) {
      maps.set(id, { snap: this.serialize(st.canvas), undo: st.undo.slice(), redo: st.redo.slice() });
    }
    return { maps };
  }

  private checkpointChanged(st: MapState, saved: CheckpointEntry): boolean {
    return (
      st.undo.length !== saved.undo.length ||
      st.undo[st.undo.length - 1] !== saved.undo[saved.undo.length - 1] ||
      st.redo.length !== saved.redo.length
    );
  }

  /** Revient à l'état du point de reprise (contenu + historique) sur chaque map modifiée depuis. */
  async restoreCheckpoint(cp: HistoryCheckpoint) {
    for (const [id, saved] of cp.maps) {
      const st = this.maps.get(id);
      if (!st || !this.checkpointChanged(st, saved)) continue;
      await this.restore(st, saved.snap);
      st.undo = saved.undo.slice();
      st.redo = saved.redo.slice();
    }
    this.emit('layers');
    this.emit('selection');
    this.emit('history');
    this.emit('dirty');
    this.flushTexture();
  }

  /**
   * Valide les modifications faites depuis le point de reprise en une seule
   * entrée d'historique par map (un Ctrl+Z ramène à l'état d'avant).
   */
  commitCheckpoint(cp: HistoryCheckpoint) {
    for (const [id, saved] of cp.maps) {
      const st = this.maps.get(id);
      if (!st || !this.checkpointChanged(st, saved)) continue;
      const top = st.undo[st.undo.length - 1] ?? this.serialize(st.canvas);
      st.undo = saved.undo.slice();
      if (st.undo[st.undo.length - 1] !== top) st.undo.push(top);
      if (st.undo.length > 60) st.undo.shift();
      st.redo = [];
      st.coalesceKey = null;
    }
    this.emit('history');
    this.emit('dirty');
  }

  private async restore(st: MapState, snap: string) {
    const c = st.canvas;
    // Ids des objets sélectionnés : loadFromJSON vide le canvas (et la sélection),
    // on la rétablit ensuite pour que le panneau Propriétés reste ouvert.
    const selectedIds = c
      .getActiveObjects()
      .map((o) => (o as EditorObject).id)
      .filter((id): id is string => !!id);
    st.suspendHistory = true;
    st.coalesceKey = null;
    try {
      const json = JSON.parse(snap);
      await c.loadFromJSON(json);
      if (['always', 'head', 'brake'].includes(json.illumRole)) (c as LightCanvas).illumRole = json.illumRole;
      for (const o of c.getObjects()) o.setCoords();
      for (const { image } of this.imageOwners()) {
        if (!image.decal || this.projectionSources.has(image.decal.source)) continue;
        const original = await FabricImage.fromURL(image.decal.source);
        const source = document.createElement('canvas'); source.width = original.width; source.height = original.height;
        const context = source.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(original.getElement(), 0, 0);
        this.projectionSources.set(image.decal.source, context.getImageData(0, 0, source.width, source.height));
        original.dispose();
      }
    } catch (err) {
      // Une image irrécupérable ne doit pas laisser l'éditeur dans un état
      // incohérent : on garde ce qui a pu être rechargé et on trace l'erreur.
      console.error('[EditorCore] Restauration de l’historique incomplète :', err);
    } finally {
      st.textureDirty = true;
      st.suspendHistory = false;
    }
    if (selectedIds.length > 0) {
      const wanted = new Set(selectedIds);
      const found = c
        .getObjects()
        .filter((o) => wanted.has((o as EditorObject).id ?? '') && o.selectable !== false);
      if (found.length === 1) {
        c.setActiveObject(found[0]);
      } else if (found.length > 1) {
        c.setActiveObject(new ActiveSelection(found, { canvas: c }));
      }
      // Sinon (undo d'un ajout) : l'objet n'existe plus, sélection vide.
    }
    if (this.mapIdOf(st) === 'Details_I') {
      const speed = c.getObjects().find((object) => this.isSpeedLight(object));
      const color = speed ? readObjectPaint(speed).color : null;
      if (color) this.speedLightColor = color;
      this.ensureSpeedLight(st);
      this.emit('speed-color');
    }
    c.requestRenderAll();
    this.refreshLinkedImages();
    this.emit('layers');
    this.emit('selection');
    this.emit('history');
    this.emit('dirty');
  }

  clearMap() {
    const c = this.canvas;
    const state = this.maps.get(this.activeMap)!;
    state.suspendHistory = true;
    try {
      c.discardActiveObject();
      c.remove(...c.getObjects().filter((object) => !(object as EditorObject).linkedImageId));
      c.backgroundImage = undefined;
      c.backgroundColor = MAP_BY_ID[this.activeMap].defaultFill;
      if (this.activeMap === 'Details_I') this.ensureSpeedLight(state);
    } finally {
      state.suspendHistory = false;
    }
    c.requestRenderAll();
    this.refreshLinkedImages();
    this.markTextureDirty(this.activeMap);
    this.pushHistory(this.activeMap);
    this.emit('layers');
    this.emit('selection');
  }

  dispose() {
    this.unwireViewport();
    this.resizeObserver.disconnect();
    if (this.textureRaf) window.cancelAnimationFrame(this.textureRaf);
    for (const [, st] of this.maps) st.canvas.dispose();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.container.innerHTML = '';
  }
}
