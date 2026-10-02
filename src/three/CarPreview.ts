/**
 * Aperçu 3D temps réel du skin sur le modèle Stadium Car TM2020 (FBX).
 * Les textures éditées (base color, rugosité/métal _R, vernis _CoatR,
 * illumination _I) sont appliquées aux matériaux correspondants : la
 * carrosserie utilise un MeshPhysicalMaterial pour le vernis (clearcoat) et les
 * détails un MeshStandardMaterial émissif pour les néons / feux.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MAP_BY_ID, type IllumRole, type MapId } from '../maps';
import { speedLightMask } from '../skinZip';
import { lightIsOn, roleFromAlpha } from '../illumination';
import { continuousImageUV, imageIslandAt } from '../editor/imagePlacement';
import { bakeProjection, type DecalProjection, type PixelSource, type ProjectionTriangle, type SurfaceAnchor, type Vec3 } from './decalProjection';

/** Modèle servi statiquement depuis public/models/ (fiable en dev et prod). */
const CAR_MODEL_URL = `${import.meta.env.BASE_URL}models/car/StadiumCAR2020_OffsetFix.fbx`;
const CAR_MODEL_RESOURCE_PATH = `${import.meta.env.BASE_URL}models/car/`;
const CAR_MODEL_LOAD_TIMEOUT_MS = 45_000;
const CAR_MODEL_MIN_BYTES = 100_000;

type MaterialSlot = 'skin' | 'details' | 'wheels' | 'glass' | 'other';

/** Famille de map peignable en 3D (correspond au `group` des MapDef). */
export type PaintFamily = 'skin' | 'details' | 'wheels';

/**
 * Gestionnaire de peinture directe sur la 3D. Les coordonnées `u`/`v` sont les
 * coordonnées UV brutes de l'intersection (0..1). C'est l'appelant qui les
 * convertit en pixels de canvas et choisit la map cible exacte.
 */
export interface Paint3DHandler {
  begin: (family: PaintFamily, u: number, v: number) => void;
  move: (family: PaintFamily, u: number, v: number) => void;
  end: () => void;
}

export type Interaction3D = 'navigate' | 'paint' | 'image' | 'place';
export interface PreviewViewState { position: Vec3; target: Vec3 }
export interface Image3DHandler {
  begin: (family: PaintFamily, u: number, v: number, anchor: SurfaceAnchor) => boolean | 'projection';
  move: (family: PaintFamily, u: number, v: number, anchor: SurfaceAnchor) => boolean | void;
  end: () => void;
  place: (family: PaintFamily, u: number, v: number, anchor: SurfaceAnchor) => void;
  boundary?: () => void;
  transform?: (values: Partial<Pick<DecalProjection, 'width' | 'height' | 'angle'>>) => void;
  transformEnd?: () => void;
}

function materialSlot(name: string): MaterialSlot {
  const n = name.toLowerCase();
  if (n.includes('wheel')) return 'wheels';
  if (n.includes('detail')) return 'details';
  if (n.includes('glass')) return 'glass';
  if (n.includes('skin')) return 'skin';
  return 'other';
}

function slotFromObject(mesh: THREE.Mesh): MaterialSlot {
  const mat = mesh.material;
  const matName = (Array.isArray(mat) ? mat[0]?.name : mat?.name) ?? '';
  return materialSlot(`${mesh.name} ${matName}`);
}

function fitModelToGround(root: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 4.2 / maxDim : 1;
  root.scale.setScalar(scale);

  box.setFromObject(root);
  box.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  box.setFromObject(root);
  return Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).z);
}

export class CarPreview {
  onModelReady: (() => void) | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private textures = new Map<MapId, THREE.CanvasTexture>();
  /** Canvas intermédiaires pour repacker R (rugosité) / G (métal) par matériau. */
  private rmPacks = new Map<MapId, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
  private skinMat: THREE.MeshPhysicalMaterial;
  private detailsMat: THREE.MeshStandardMaterial;
  private wheelsMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshPhysicalMaterial;
  private coatIntensity = 1;
  private emissiveIntensity = 1.4;
  private braking = false;
  private night = false;
  /** Rôle des zones peintes hors vitesse. Les feux arrière restent allumés. */
  private illumRole: IllumRole = 'always';
  private illumination = new Map<MapId, { source: HTMLCanvasElement; roles?: HTMLCanvasElement; canvas: HTMLCanvasElement; texture?: THREE.CanvasTexture }>();
  private carRoot = new THREE.Group();
  /** Racine du modèle courant (FBX officiel ou GLB custom), pour la remplacer. */
  private modelRoot: THREE.Object3D | null = null;
  private importedMaterials: THREE.Material[] = [];
  private loadingEl: HTMLDivElement;
  private loading = true;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private container: HTMLElement;
  private disposed = false;
  private loadGeneration = 0;

  // ---- Édition directe sur la 3D ----
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private edit3dEnabled = false;
  private interaction: Interaction3D = 'navigate';
  private imageHandler: Image3DHandler | null = null;
  private draggingImage = false;
  private draggingProjection = false;
  private projectionTriangles: ProjectionTriangle[] | null = null;
  private selectedProjection: DecalProjection | null = null;
  private projectionGuide: HTMLDivElement | null = null;
  private guideHandles: HTMLButtonElement[] = [];
  private guideFrame: SVGPolygonElement | null = null;
  private guideDrag: { decal: DecalProjection; radius: number; pointerAngle: number; rotate: boolean } | null = null;
  private lastDragUV: { u: number; v: number } | null = null;
  private dragIsland: string | undefined;
  private dragBoundaryShown = false;
  private painting3d = false;
  private lockedFamily: PaintFamily | null = null;
  private paintHandler: Paint3DHandler | null = null;
  private onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);

  // ---- Navigation libre ----
  /** Le pointeur survole la vue 3D : les raccourcis clavier de déplacement sont actifs. */
  private hovered = false;
  private shiftHeld = false;
  private moveKeys = new Set<string>();
  private lastFrame = 0;
  /** Boîte englobante (monde) du modèle chargé : base du cadrage « maison ». */
  private carBounds: THREE.Box3 | null = null;
  /**
   * True dès que l'utilisateur a bougé la vue (orbite, zoom, clavier…).
   * Tant que c'est false, un changement de ratio (vignette → grande vue)
   * recalcule le cadrage maison.
   */
  private userNavigated = false;
  private pendingView: PreviewViewState | null = null;
  private onPointerEnter = () => {
    this.hovered = true;
  };
  private onPointerLeave = (e: PointerEvent) => {
    this.hovered = false;
    this.moveKeys.clear();
    this.handlePointerUp(e);
  };
  private onDblClick = (e: MouseEvent) => this.handleDblClick(e);
  private onKeyDown = (e: KeyboardEvent) => this.handleKey(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.handleKey(e, false);
  private onBlur = () => {
    this.finishInteraction();
    this.moveKeys.clear();
    this.shiftHeld = false;
    this.applyMouseButtons();
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'car-preview-loading';
    this.loadingEl.textContent = 'Chargement du modèle…';
    container.appendChild(this.loadingEl);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111a20);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;

    // near volontairement petit pour pouvoir zoomer très près sans clipper.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.02, 200);
    this.camera.position.set(5.5, 3.2, 6.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.55, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.12;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 18;
    // Déplacement latéral dans le plan écran (plus naturel pour « aller où on veut »).
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 1.1;
    this.controls.addEventListener('start', this.onControlsStart);
    this.applyMouseButtons();

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('lostpointercapture', this.onPointerUp);
    dom.addEventListener('pointerenter', this.onPointerEnter);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 7, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x334422, 0.5));

    this.skinMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 1,
      metalness: 1,
      // Vernis (Skin_CoatR) : couche de clearcoat modulée par la map.
      clearcoat: this.coatIntensity,
      clearcoatRoughness: 0.08,
    });
    this.detailsMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      // The data maps contain the full value; the factors must remain neutral.
      roughness: 1,
      metalness: 1,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.wheelsMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 1,
      metalness: 1,
    });
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d1620,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
    });

    this.scene.add(this.carRoot);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(18, 36, 0x2c313a, 0x22262d);
    grid.position.y = -0.005;
    this.scene.add(grid);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.initDefaultRoughnessPack();

    void this.loadCarModel();

    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
      this.lastFrame = now;
      this.applyKeyboardMove(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.updateProjectionGuide();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private async loadCarModel() {
    const generation = ++this.loadGeneration;
    try {
      const buffer = await this.fetchModelBuffer(CAR_MODEL_URL);
      if (this.disposed || generation !== this.loadGeneration) return;
      await this.installModel(buffer, 'fbx', generation);
      this.hideLoadingOverlay();
    } catch (err) {
      if (this.disposed || generation !== this.loadGeneration) return;
      const message = err instanceof Error ? err.message : 'erreur inconnue';
      console.error('[CarPreview] Échec du chargement du modèle FBX :', err);
      this.showLoadingError(message);
    }
  }

  /**
   * Affiche un `preview.glb` exporté depuis le blend de référence, à la place
   * de la Stadium Car officielle. Les matériaux sont rebranchés sur les mêmes
   * atlas (le nom doit contenir skin / detail / wheel / glass).
   */
  async loadCustomPreview(buffer: ArrayBuffer): Promise<void> {
    const generation = ++this.loadGeneration;
    await this.installModel(buffer, 'glb', generation);
  }

  /** Revient au FBX officiel (export texture seul, sans mesh custom). */
  async loadOfficialModel(): Promise<void> {
    await this.loadCarModel();
  }

  private parseModel(buffer: ArrayBuffer, kind: 'fbx' | 'glb'): Promise<THREE.Object3D> {
    if (kind === 'fbx') {
      const loader = new FBXLoader();
      loader.setResourcePath(CAR_MODEL_RESOURCE_PATH);
      return Promise.resolve(loader.parse(buffer, CAR_MODEL_RESOURCE_PATH));
    }
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
      loader.parse(
        buffer,
        '',
        (gltf) => resolve(gltf.scene),
        (err) => reject(err instanceof Error ? err : new Error('GLB illisible')),
      );
    });
  }

  private async installModel(buffer: ArrayBuffer, kind: 'fbx' | 'glb', generation: number) {
    const model = await this.parseModel(buffer, kind);
    if (this.disposed || generation !== this.loadGeneration) return;

    this.detachModel();
    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const origMats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of origMats) {
        if (m && !this.importedMaterials.includes(m)) this.importedMaterials.push(m);
      }
      const slot = slotFromObject(obj);
      obj.userData.paintSlot = slot;
      obj.material = this.materialForSlot(slot);
      obj.castShadow = true;
      obj.receiveShadow = true;
    });

    const span = fitModelToGround(model);
    this.modelRoot = model;
    this.carRoot.add(model);
    this.carBounds = new THREE.Box3().setFromObject(model);
    this.projectionTriangles = null;
    this.controls.minDistance = span * 0.12;
    this.controls.maxDistance = span * 6;
    this.applyHomeFraming();
    if (this.pendingView) this.restoreViewState(this.pendingView);
    this.hideLoadingOverlay();
    this.onModelReady?.();
  }

  private detachModel() {
    if (!this.modelRoot) return;
    this.carRoot.remove(this.modelRoot);
    this.modelRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.modelRoot = null;
    for (const m of this.importedMaterials) m.dispose();
    this.importedMaterials = [];
  }

  /** Télécharge le FBX avec timeout et validation basique (évite le fallback HTML de Vite). */
  private async fetchModelBuffer(url: string): Promise<ArrayBuffer> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CAR_MODEL_LOAD_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'fichier introuvable — vérifiez public/models/car/StadiumCAR2020_OffsetFix.fbx'
            : `HTTP ${response.status}`,
        );
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < CAR_MODEL_MIN_BYTES) {
        throw new Error('fichier trop petit ou absent (archive non extraite ?)');
      }

      const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength)));
      if (/^\s*<!doctype html/i.test(head) || /^\s*<html/i.test(head)) {
        throw new Error('réponse HTML reçue à la place du FBX — modèle manquant');
      }

      return buffer;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('délai de chargement dépassé');
      }
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private hideLoadingOverlay() {
    if (!this.loading) return;
    this.loading = false;
    this.loadingEl.remove();
  }

  /**
   * Déplace le rendu 3D (canvas WebGL + overlay) vers un nouveau conteneur DOM,
   * par ex. pour passer de l'aperçu compact à la grande vue « Édition 3D ».
   * Ré-observe le redimensionnement et resynchronise immédiatement la taille.
   */
  mount(container: HTMLElement) {
    if (this.disposed) return;
    if (container !== this.container) {
      this.container = container;
      container.appendChild(this.renderer.domElement);
      if (this.projectionGuide) container.appendChild(this.projectionGuide);
      if (this.loading) container.appendChild(this.loadingEl);
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(container);
    }
    // Toujours resynchroniser (conteneur ré-affiché après repli du panneau, etc.).
    requestAnimationFrame(() => this.resize());
  }

  private showLoadingError(detail: string) {
    this.loadingEl.textContent = `Échec du chargement : ${detail}`;
    this.loadingEl.classList.add('car-preview-loading--error');
  }

  private materialForSlot(slot: MaterialSlot): THREE.Material {
    switch (slot) {
      case 'wheels':
        return this.wheelsMat;
      case 'details':
        return this.detailsMat;
      case 'glass':
        return this.glassMat;
      case 'skin':
      case 'other':
      default:
        return this.skinMat;
    }
  }

  /** Roughness/metalness neutres avant import des maps _R (évite un rendu noir). */
  private initDefaultRoughnessPack() {
    // three lit la rugosité dans le canal G et le métal dans le canal B.
    const seed: { id: MapId; g: number; b: number; mat: THREE.MeshStandardMaterial }[] = [
      { id: 'Skin_R', g: 140, b: 255, mat: this.skinMat },
      { id: 'Details_R', g: 140, b: 90, mat: this.detailsMat },
      { id: 'Wheels_R', g: 217, b: 26, mat: this.wheelsMat },
    ];
    for (const { id, g, b, mat } of seed) {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `rgb(255, ${g}, ${b})`;
      ctx.fillRect(0, 0, 4, 4);
      const texture = new THREE.CanvasTexture(canvas);
      texture.flipY = true;
      this.rmPacks.set(id, { canvas, texture });
      mat.roughnessMap = texture;
      mat.metalnessMap = texture;
      mat.needsUpdate = true;
    }
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    const aspectChanged = Math.abs(aspect - this.camera.aspect) > 1e-4;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // Vue jamais déplacée par l'utilisateur (vignette → grande vue 3D, repli d'un
    // panneau…) : on garde la voiture bien cadrée pour le nouveau ratio. Une vue
    // déjà manipulée n'est jamais touchée.
    if (aspectChanged && !this.userNavigated) this.applyHomeFraming();
  }

  private onControlsStart = () => {
    this.userNavigated = true;
  };

  /** Branche/rafraîchit un canvas source comme texture d'une map. */
  setMapCanvas(id: MapId, source: HTMLCanvasElement, roles?: HTMLCanvasElement) {
    // Les maps _R sont repackées séparément (canaux R/G → G/B).
    if (id === 'Skin_R' || id === 'Details_R' || id === 'Wheels_R') {
      this.updateRoughnessPack(id, source);
      return;
    }
    if (MAP_BY_ID[id].kind === 'illum') {
      const state = this.illumination.get(id) ?? { source, canvas: document.createElement('canvas') };
      state.source = source; state.roles = roles;
      this.illumination.set(id, state);
      this.syncIllumPreview(id);
      return;
    }

    let tex = this.textures.get(id);
    if (!tex || tex.image !== source) {
      tex?.dispose();
      tex = new THREE.CanvasTexture(source);
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.flipY = true;
      this.textures.set(id, tex);
      if (id === 'Skin_B') {
        tex.colorSpace = THREE.SRGBColorSpace;
        this.skinMat.map = tex;
        this.skinMat.needsUpdate = true;
      } else if (id === 'Skin_CoatR') {
        // Vernis : la map (niveaux de gris) module l'intensité du clearcoat.
        this.skinMat.clearcoatMap = tex;
        this.skinMat.needsUpdate = true;
      } else if (id === 'Details_B') {
        tex.colorSpace = THREE.SRGBColorSpace;
        this.detailsMat.map = tex;
        this.detailsMat.needsUpdate = true;
      } else if (id === 'Wheels_B') {
        tex.colorSpace = THREE.SRGBColorSpace;
        this.wheelsMat.map = tex;
        this.wheelsMat.needsUpdate = true;
      }
    }
    tex.needsUpdate = true;
  }

  /**
   * Maps _R : R = rugosité, G = métal. three.js lit la rugosité dans le canal G
   * et le métal dans le canal B, on repacke donc les canaux dans un canvas
   * intermédiaire propre à chaque matériau.
   */
  private updateRoughnessPack(id: MapId, source: HTMLCanvasElement) {
    const pack = this.rmPacks.get(id);
    if (!pack) return;
    const { canvas, texture } = pack;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);
    const img = ctx.getImageData(0, 0, source.width, source.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const rough = d[i];
      const metal = d[i + 1];
      d[i] = 255;
      d[i + 1] = rough;
      d[i + 2] = metal;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    texture.needsUpdate = true;
  }

  /** Exposure is independent of the light's behaviour. */
  private applyEmissive() {
    for (const material of [this.skinMat, this.detailsMat, this.wheelsMat]) {
      material.emissiveIntensity = this.emissiveIntensity;
      material.needsUpdate = true;
    }
  }

  /**
   * Aperçu du néon. Les feux de vitesse restent visibles. En rôle frein, les
   * autres zones ne s'allument que quand le freinage est simulé.
   */
  private syncIllumPreview(mapId?: MapId) {
    if (!mapId) { for (const id of this.illumination.keys()) this.syncIllumPreview(id); return; }
    const state = this.illumination.get(mapId);
    if (!state) return;
    const { source, canvas } = state;
    const material = mapId === 'Skin_I' ? this.skinMat : mapId === 'Wheels_I' ? this.wheelsMat : this.detailsMat;
    if (!source || source.width === 0 || source.height === 0) return;
    const w = source.width;
    const h = source.height;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0);
    {
      const img = ctx.getImageData(0, 0, w, h);
      const mask = mapId === 'Details_I' ? speedLightMask(w, h) : null;
      const roles = state.roles?.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, w, h).data;
      const d = img.data;
      for (let p = 0, i = 0; i < d.length; p++, i += 4) {
        const role = roles ? roleFromAlpha(roles[i]) : this.illumRole;
        if (lightIsOn(role, this.night, this.braking, mask?.[p] === 1)) continue;
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
      }
      ctx.putImageData(img, 0, 0);
    }
    if (!state.texture) {
      state.texture = new THREE.CanvasTexture(canvas);
      state.texture.colorSpace = THREE.SRGBColorSpace;
      state.texture.flipY = true;
      state.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      material.emissiveMap = state.texture;
      this.applyEmissive();
    }
    state.texture.needsUpdate = true;
    material.needsUpdate = true;
  }

  /** Rôle des zones peintes (la vitesse n'est pas concernée). */
  setIllumRole(role: IllumRole) {
    this.illumRole = role;
    this.syncIllumPreview();
    this.applyEmissive();
  }

  /** Intensité du vernis (clearcoat) sur la carrosserie (0..1). */
  setCoatIntensity(v: number) {
    this.coatIntensity = Math.max(0, Math.min(1, v));
    this.skinMat.clearcoat = this.coatIntensity;
    this.skinMat.needsUpdate = true;
  }

  /** Intensité globale de l'auto-illumination des détails (néon). */
  setEmissiveIntensity(v: number) {
    this.emissiveIntensity = Math.max(0, v);
    this.applyEmissive();
  }

  /** Simule le freinage : allume les zones « feux de frein », la vitesse reste visible. */
  setBraking(on: boolean) {
    this.braking = on;
    this.syncIllumPreview();
    this.applyEmissive();
  }

  /** Dim the studio and enable only the zones assigned to headlights. */
  setNight(on: boolean) {
    this.night = on;
    this.scene.environmentIntensity = on ? 0.12 : 0.9;
    this.scene.background = new THREE.Color(on ? 0x080c14 : 0x15181d);
    this.scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) object.intensity = on ? 0.12 : 2.2;
      if (object instanceof THREE.HemisphereLight) object.intensity = on ? 0.12 : 0.5;
    });
    this.syncIllumPreview();
  }

  // -------------------------------------------------- édition directe sur la 3D

  /** Injecte (ou retire) le gestionnaire de peinture 3D. */
  setPaintHandler(handler: Paint3DHandler | null) {
    this.paintHandler = handler;
  }

  /**
   * Active/désactive la peinture directe sur la voiture. En mode actif, le clic
   * gauche peint (l'orbite est déplacée sur le clic droit) ; sinon le clic
   * gauche tourne la caméra comme d'habitude.
   */
  setEdit3D(on: boolean) {
    this.setInteraction(on ? 'paint' : 'navigate');
  }

  setImageHandler(handler: Image3DHandler | null) {
    this.imageHandler = handler;
  }

  setProjectionGuide(decal: DecalProjection | null) {
    this.selectedProjection = decal;
    if (!this.projectionGuide) this.createProjectionGuide();
    this.updateProjectionGuide();
  }

  private projectionAxes(decal: DecalProjection) {
    const normal = new THREE.Vector3(...decal.normal).normalize();
    const tangent = new THREE.Vector3(...decal.tangent).normalize();
    const up = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const angle = decal.angle * Math.PI / 180;
    return { normal, right: tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)),
      up: up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(tangent, -Math.sin(angle)) };
  }

  private guidePointer(e: PointerEvent, decal: DecalProjection) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const normal = new THREE.Vector3(...decal.normal).normalize();
    return this.raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...decal.center)), new THREE.Vector3());
  }

  private createProjectionGuide() {
    const guide = document.createElement('div'); guide.className = 'projection-guide';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true');
    const frame = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); svg.appendChild(frame); guide.appendChild(svg); this.guideFrame = frame;
    for (let index = 0; index < 5; index++) {
      const handle = document.createElement('button'); handle.type = 'button';
      handle.className = index === 4 ? 'projection-handle projection-handle--rotate' : 'projection-handle';
      const label = index === 4 ? 'Tourner la projection' : `Redimensionner la projection · coin ${index + 1}`;
      handle.setAttribute('aria-label', label); handle.title = `${label} · glisser ou flèches du clavier`;
      if (index === 4) handle.textContent = '↻';
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.selectedProjection) return;
        const decal = this.selectedProjection; const point = this.guidePointer(e, decal);
        if (!point) return;
        const delta = point.sub(new THREE.Vector3(...decal.center)); const axes = this.projectionAxes(decal);
        this.guideDrag = { decal, radius: Math.max(.001, delta.length()), pointerAngle: Math.atan2(delta.dot(axes.up), delta.dot(axes.right)), rotate: index === 4 };
        handle.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
      });
      handle.addEventListener('pointermove', (e) => {
        const drag = this.guideDrag;
        if (!drag) return;
        const point = this.guidePointer(e, drag.decal); if (!point) return;
        const delta = point.sub(new THREE.Vector3(...drag.decal.center));
        if (drag.rotate) {
          const axes = this.projectionAxes(drag.decal);
          let angle = Math.atan2(delta.dot(axes.up), delta.dot(axes.right)) - drag.pointerAngle;
          angle = Math.atan2(Math.sin(angle), Math.cos(angle));
          this.imageHandler?.transform?.({ angle: Math.round(drag.decal.angle + angle * 180 / Math.PI) });
        } else {
          const factor = Math.max(.1, Math.min(6, delta.length() / drag.radius));
          this.imageHandler?.transform?.({ width: drag.decal.width * factor, height: drag.decal.height * factor });
        }
        e.preventDefault();
      });
      const finish = () => { if (this.guideDrag) { this.guideDrag = null; this.imageHandler?.transformEnd?.(); } };
      handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish); handle.addEventListener('lostpointercapture', finish);
      handle.addEventListener('keydown', (event) => {
        const decal = this.selectedProjection;
        if (!decal || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const increment = event.key === 'ArrowRight' || event.key === 'ArrowUp';
        if (index === 4) this.imageHandler?.transform?.({ angle: decal.angle + (increment ? 5 : -5) });
        else { const scale = increment ? 1.05 : 1 / 1.05; this.imageHandler?.transform?.({ width: decal.width * scale, height: decal.height * scale }); }
        this.imageHandler?.transformEnd?.();
      });
      this.guideHandles.push(handle); guide.appendChild(handle);
    }
    this.projectionGuide = guide; this.container.appendChild(guide);
  }

  private updateProjectionGuide() {
    const decal = this.selectedProjection; const guide = this.projectionGuide;
    if (!guide) return;
    guide.hidden = !decal || this.interaction !== 'image';
    if (guide.hidden || !decal) return;
    const axes = this.projectionAxes(decal); const center = new THREE.Vector3(...decal.center).addScaledVector(axes.normal, .008);
    const size = this.renderer.domElement.getBoundingClientRect();
    const positions = [[-.5, .5], [.5, .5], [.5, -.5], [-.5, -.5], [0, .7]].map(([x, y]) => {
      const point = center.clone().addScaledVector(axes.right, x * decal.width).addScaledVector(axes.up, y * decal.height).project(this.camera);
      return { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2, z: point.z };
    });
    guide.hidden = positions.some((point) => point.z > 1 || point.z < -1);
    this.guideFrame?.setAttribute('points', positions.slice(0, 4).map((point) => `${point.x},${point.y}`).join(' '));
    for (let i = 0; i < this.guideHandles.length; i++) {
      this.guideHandles[i].style.left = `${positions[i].x}px`; this.guideHandles[i].style.top = `${positions[i].y}px`;
    }
  }

  setInteraction(mode: Interaction3D) {
    if (mode !== this.interaction) this.finishInteraction();
    this.interaction = mode;
    this.edit3dEnabled = mode !== 'navigate';
    this.renderer.domElement.style.cursor = mode === 'image' ? 'grab' : this.edit3dEnabled ? 'crosshair' : '';
    this.applyMouseButtons();
    this.updateProjectionGuide();
  }

  private finishInteraction() {
    if (this.painting3d) this.paintHandler?.end();
    if (this.draggingImage) this.imageHandler?.end();
    this.painting3d = false;
    this.draggingImage = false;
    this.draggingProjection = false;
    this.lockedFamily = null;
    this.lastDragUV = null;
    this.dragIsland = undefined;
    this.dragBoundaryShown = false;
    this.renderer.domElement.style.cursor = this.interaction === 'image' ? 'grab' : this.edit3dEnabled ? 'crosshair' : '';
  }

  // -------------------------------------------------- navigation libre

  /**
   * Affectation des boutons souris selon le mode :
   *  - aperçu : gauche = tourner, milieu = déplacer, droit = déplacer ;
   *  - peinture : gauche = peindre, milieu = déplacer, droit = tourner.
   * Maj enfoncée bascule le bouton « tourner » en « déplacer ».
   */
  private applyMouseButtons() {
    const buttons = this.controls.mouseButtons as {
      LEFT: THREE.MOUSE | null;
      MIDDLE: THREE.MOUSE | null;
      RIGHT: THREE.MOUSE | null;
    };
    const rotateOrPan = this.shiftHeld ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    buttons.MIDDLE = THREE.MOUSE.PAN;
    if (this.edit3dEnabled) {
      buttons.LEFT = null;
      buttons.RIGHT = rotateOrPan;
    } else {
      buttons.LEFT = rotateOrPan;
      buttons.RIGHT = THREE.MOUSE.PAN;
    }
  }

  private static isEditableTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  /** Touches de déplacement : ZQSD / WASD / flèches, PageUp/PageDown pour monter/descendre. */
  private static readonly MOVE_KEYS: Record<string, 'fwd' | 'back' | 'left' | 'right' | 'up' | 'down'> = {
    w: 'fwd',
    z: 'fwd',
    arrowup: 'fwd',
    s: 'back',
    arrowdown: 'back',
    a: 'left',
    q: 'left',
    arrowleft: 'left',
    d: 'right',
    arrowright: 'right',
    pageup: 'up',
    pagedown: 'down',
  };

  private handleKey(e: KeyboardEvent, down: boolean) {
    if (e.key === 'Shift') {
      if (this.shiftHeld !== down) {
        this.shiftHeld = down;
        this.applyMouseButtons();
      }
      return;
    }
    if (!down) {
      this.moveKeys.delete(e.key.toLowerCase());
      return;
    }
    if (!this.hovered || e.ctrlKey || e.metaKey || e.altKey) return;
    if (CarPreview.isEditableTarget(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === 'f') {
      this.resetCamera();
      e.preventDefault();
      return;
    }
    if (key in CarPreview.MOVE_KEYS) {
      this.moveKeys.add(key);
      e.preventDefault();
    }
  }

  /** Translation caméra + cible dans le repère de la caméra (vol libre). */
  private applyKeyboardMove(dt: number) {
    if (dt <= 0 || this.moveKeys.size === 0) return;
    const dir = new THREE.Vector3();
    for (const key of this.moveKeys) {
      switch (CarPreview.MOVE_KEYS[key]) {
        case 'fwd':
          dir.z -= 1;
          break;
        case 'back':
          dir.z += 1;
          break;
        case 'left':
          dir.x -= 1;
          break;
        case 'right':
          dir.x += 1;
          break;
        case 'up':
          dir.y += 1;
          break;
        case 'down':
          dir.y -= 1;
          break;
      }
    }
    if (dir.lengthSq() === 0) return;
    this.userNavigated = true;
    dir.normalize();
    // Vitesse proportionnelle à la distance à la cible : lent en gros plan, rapide de loin.
    const distance = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.max(0.4, distance) * 1.4 * dt;

    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3(0, 1, 0);
    // Avant = direction de visée projetée au sol, pour ne pas s'enfoncer dans le plancher.
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();

    const delta = new THREE.Vector3()
      .addScaledVector(right, dir.x * speed)
      .addScaledVector(up, dir.y * speed)
      .addScaledVector(forward, -dir.z * speed);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
  }

  /** Double-clic : recentre la vue sur le point de la voiture visé (sans changer l'angle). */
  private handleDblClick(e: MouseEvent) {
    // En mode peinture, le double-clic gauche est un double coup de pinceau : on ne
    // déplace pas la caméra sous les pieds de l'utilisateur.
    if (this.edit3dEnabled && e.button === 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.carRoot, true)[0];
    if (!hit) return;
    const delta = hit.point.clone().sub(this.controls.target);
    this.controls.target.copy(hit.point);
    this.camera.position.add(delta);
    this.userNavigated = true;
    e.preventDefault();
  }

  /** Direction caméra → cible du cadrage « maison » : 3/4 avant, légèrement en plongée. */
  private static readonly HOME_DIR = new THREE.Vector3(1.35, 0.55, 1.65).normalize();
  /**
   * Part du cadre que la BOÎTE englobante peut occuper. Les coins d'une boîte
   * débordent largement de la carrosserie : 0.92 ici ≈ 70–75 % pour la voiture.
   */
  private static readonly HOME_FILL = 0.92;

  /**
   * Calcule la vue « maison » à partir de la boîte englobante du modèle et du
   * FOV / ratio COURANTS de la caméra : la distance est la plus petite telle que
   * les 8 coins de la boîte tiennent dans HOME_FILL du cadre (vertical et
   * horizontal). La voiture remplit donc l'aperçu quelle que soit sa taille
   * (vignette de l'inspecteur ou grande vue 3D).
   */
  private computeHome(): { position: THREE.Vector3; target: THREE.Vector3 } | null {
    const box = this.carBounds;
    if (!box || box.isEmpty()) return null;
    // Cible : centre de la boîte, un peu rabaissé (vue en plongée : la voiture se
    // projette sinon dans la moitié basse du cadre).
    const target = box.getCenter(new THREE.Vector3());
    target.y = box.min.y + (box.max.y - box.min.y) * 0.4;
    const dir = CarPreview.HOME_DIR;
    // Repère caméra pour cette direction de visée.
    const forward = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * CarPreview.HOME_FILL;
    const tanH = tanV * Math.max(this.camera.aspect, 1e-3);
    let distance = 0;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      corner.sub(target);
      const depth = corner.dot(forward); // profondeur relative à la cible (caméra en −dir·d)
      const x = Math.abs(corner.dot(right));
      const y = Math.abs(corner.dot(up));
      // Le coin est à la profondeur d + depth : il tient si x ≤ tanH·(d + depth), idem pour y.
      distance = Math.max(distance, x / tanH - depth, y / tanV - depth);
    }
    distance = Math.max(distance, this.controls.minDistance);
    const position = target.clone().addScaledVector(dir, distance);
    return { position, target };
  }

  /** Recalcule et applique le cadrage « maison » (chargement, recadrage). */
  private applyHomeFraming() {
    const home = this.computeHome();
    if (!home) return;
    this.camera.position.copy(home.position);
    this.controls.target.copy(home.target);
    this.controls.update();
    this.userNavigated = false;
  }

  /** Revient au cadrage initial (touche F ou bouton « Recadrer »). */
  resetCamera() {
    if (!this.carBounds) return;
    // Purge l'inertie (amortissement) d'un glisser encore en cours : sans cela,
    // le reste du mouvement continuerait à s'appliquer après le recadrage.
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    // Recalcul à damping coupé pour que OrbitControls fige tout de suite
    // la nouvelle pose (sinon l'amortissement ferait encore dériver).
    this.applyHomeFraming();
    this.controls.enableDamping = damping;
  }

  getViewState(): PreviewViewState {
    return { position: this.camera.position.toArray() as Vec3, target: this.controls.target.toArray() as Vec3 };
  }

  /** Conserve la vue de travail pendant une mise à jour à chaud du serveur de développement. */
  restoreViewState(view: PreviewViewState) {
    if (view.position.length !== 3 || view.target.length !== 3 ||
      ![...view.position, ...view.target].every((v) => Number.isFinite(v) && Math.abs(v) <= 200)) return;
    if (!this.carBounds) { this.pendingView = view; return; }
    this.pendingView = null;
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.fromArray(view.position);
    this.controls.target.fromArray(view.target);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.userNavigated = true;
  }

  /** L'axe de projection suit le regard, plutôt que la normale d'un seul triangle du relief. */
  projectionAnchorFromView(point: Vec3): SurfaceAnchor {
    this.camera.updateMatrixWorld();
    return { point: [...point], normal: this.camera.getWorldDirection(new THREE.Vector3()).negate().toArray() as Vec3,
      tangent: new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).toArray() as Vec3 };
  }

  /** Renvoie la famille de map + les UV du premier mesh peignable sous le pointeur. */
  private pickAt(e: PointerEvent): { family: PaintFamily; u: number; v: number; anchor: SurfaceAnchor } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.carRoot, true);
    for (const hit of hits) {
      if (!(hit.object instanceof THREE.Mesh) || !hit.uv) continue;
      const slot = hit.object.userData.paintSlot as MaterialSlot ?? slotFromObject(hit.object);
      if (slot === 'glass') continue; // le verre est transparent : on peint dessous
      if (slot === 'other') return null;
      const family: PaintFamily =
        slot === 'wheels' ? 'wheels' : slot === 'details' ? 'details' : 'skin';
      const normal = (hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0))
        .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
      const tangent = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      tangent.addScaledVector(normal, -tangent.dot(normal));
      if (tangent.lengthSq() < .001) tangent.crossVectors(new THREE.Vector3(0, 1, 0), normal);
      if (tangent.lengthSq() < .001) tangent.crossVectors(new THREE.Vector3(0, 0, 1), normal);
      tangent.normalize();
      return { family, u: hit.uv.x, v: hit.uv.y, anchor: { point: hit.point.toArray() as Vec3, normal: normal.toArray() as Vec3, tangent: tangent.toArray() as Vec3 } };
    }
    return null;
  }

  private handlePointerDown(e: PointerEvent) {
    if (!this.edit3dEnabled || e.button !== 0) return;
    const hit = this.pickAt(e);
    if (!hit) return;
    if (this.interaction === 'place') {
      this.imageHandler?.place(hit.family, hit.u, hit.v, hit.anchor);
      e.preventDefault();
      return;
    }
    if (this.interaction === 'image') {
      const result = this.imageHandler?.begin(hit.family, hit.u, hit.v, hit.anchor);
      if (!result) return;
      this.draggingImage = true;
      this.draggingProjection = result === 'projection';
      this.lastDragUV = hit;
      this.dragIsland = imageIslandAt(hit.family, hit.u, hit.v);
      this.renderer.domElement.style.cursor = 'grabbing';
    } else {
      if (!this.paintHandler) return;
      this.painting3d = true;
      this.paintHandler.begin(hit.family, hit.u, hit.v);
    }
    this.lockedFamily = hit.family;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.painting3d && !this.draggingImage) return;
    const hit = this.pickAt(e);
    if (this.draggingProjection) {
      if (hit && this.imageHandler?.move(hit.family, hit.u, hit.v, hit.anchor) === false && !this.dragBoundaryShown) {
        this.imageHandler.boundary?.(); this.dragBoundaryShown = true;
      }
      return;
    }
    const boundary = () => {
      if (!this.dragBoundaryShown) this.imageHandler?.boundary?.();
      this.dragBoundaryShown = true;
    };
    if (this.draggingImage && hit && hit.family !== this.lockedFamily) boundary();
    // On reste sur la même famille que le début du trait pour éviter de sauter
    // d'un îlot UV à l'autre en glissant sur une autre pièce.
    if (hit && hit.family === this.lockedFamily) {
      if (this.draggingImage) {
        // Une couture UV peut séparer deux triangles voisins par des centaines de pixels.
        // On refuse ce saut pour conserver le logo sur sa zone ; « Replacer » permet de changer de pièce.
        const previous = this.lastDragUV;
        if ((previous && !continuousImageUV(previous, hit)) ||
          (this.dragIsland && imageIslandAt(hit.family, hit.u, hit.v) !== this.dragIsland)) {
          boundary();
          return;
        }
        this.lastDragUV = hit;
        if (this.imageHandler?.move(hit.family, hit.u, hit.v, hit.anchor) === false) boundary();
      } else this.paintHandler?.move(hit.family, hit.u, hit.v);
    }
  }

  /** Triangles en espace monde avec leurs UV d'origine : une projection peut traverser plusieurs atlas. */
  projectImage(decal: DecalProjection, source: PixelSource) {
    if (!this.projectionTriangles) {
      this.carRoot.updateMatrixWorld(true);
      const triangles: ProjectionTriangle[] = [];
      this.carRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const family = object.userData.paintSlot as MaterialSlot;
        if (family !== 'skin' && family !== 'details' && family !== 'wheels') return;
        const geometry = object.geometry;
        const position = geometry.getAttribute('position'); const uv = geometry.getAttribute('uv');
        if (!position || !uv) return;
        const index = geometry.index;
        const count = index?.count ?? position.count;
        for (let i = 0; i + 2 < count; i += 3) {
          const ids = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset);
          triangles.push({ family, points: ids.map((id) => new THREE.Vector3().fromBufferAttribute(position, id).applyMatrix4(object.matrixWorld).toArray()) as [Vec3, Vec3, Vec3],
            uv: ids.map((id) => [uv.getX(id), uv.getY(id)]) as ProjectionTriangle['uv'] });
        }
      });
      this.projectionTriangles = triangles;
    }
    return bakeProjection(this.projectionTriangles, decal, source);
  }

  private handlePointerUp(e: PointerEvent) {
    if (!this.painting3d && !this.draggingImage) return;
    this.finishInteraction();
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  /** Capture carrée de la vue courante (pour Icon.tga). */
  snapshot(size: number): HTMLCanvasElement {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d')!;
    const s = Math.min(src.width, src.height);
    ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    return out;
  }

  dispose() {
    this.projectionGuide?.remove();
    this.disposed = true;
    this.loadGeneration++;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerUp);
    dom.removeEventListener('lostpointercapture', this.onPointerUp);
    dom.removeEventListener('pointerenter', this.onPointerEnter);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    dom.removeEventListener('dblclick', this.onDblClick);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.dispose();
    this.carRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    for (const m of this.importedMaterials) m.dispose();
    this.skinMat.dispose();
    this.detailsMat.dispose();
    this.wheelsMat.dispose();
    this.glassMat.dispose();
    for (const t of this.textures.values()) t.dispose();
    for (const state of this.illumination.values()) state.texture?.dispose();
    for (const { texture } of this.rmPacks.values()) texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.loadingEl.remove();
  }
}
