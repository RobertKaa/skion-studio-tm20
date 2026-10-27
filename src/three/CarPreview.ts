/**
 * Aperçu 3D temps réel du skin sur le modèle Stadium Car TM2020 (FBX).
 * Les textures éditées (base color, rugosité/métal _R, vernis _CoatR,
 * illumination _I) sont appliquées aux matériaux correspondants : la
 * carrosserie utilise un MeshPhysicalMaterial pour le vernis (clearcoat) et les
 * détails un MeshStandardMaterial émissif pour les néons / feux.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DemandRenderLoop } from './DemandRenderLoop';
import { StudioEnvironment } from './StudioEnvironment';
import { StadiumEnvironment } from './StadiumEnvironment';
import { STUDIO_LIGHTING, lightingPreset, previewLighting, resolvePreviewEnvironment, type PreviewEnvironment } from '../previewEnvironment';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { embeddedGlbData } from '../blenderParts';
import { VehicleRigPreview, REST_VEHICLE_POSE, poseIsActive, type VehiclePose } from './vehiclePose';
import { MAPS, MAP_BY_ID, isDirtMask, type IllumRole, type MapId } from '../maps';
import { previewDirtPixels } from '../dirt';
import { speedLightMask } from '../skinZip';
import type { DetailsLayout } from '../detailsSides';
import { lightIsOn, roleFromAlpha } from '../illumination';
import { continuousImageUV, imageIslandAt } from '../editor/imagePlacement';
import { bakeProjection, type DecalProjection, type PixelSource, type ProjectionTriangle, type SurfaceAnchor, type Vec3 } from './decalProjection';
import { PreviewSurfaceTextures } from './previewSurfaceTextures';
import type { MaterialSurfaceOverlay } from '../materials/surfaceMaps';
import { PreviewAmbientOcclusion } from './previewAmbientOcclusion';
import { PlayerDisplay } from './playerDisplay';
import { ExportColorPreview, type ExportMaterialImage } from './ExportColorPreview';
import { decodeSurfaceMaterial } from '../material';
import { normalizeWheelSurface, type WheelSurfaceSettings } from '../wheelSurface';
import { ensureWheelTangentFrame } from './wheelTangentFrame';
import { hasWheelTreadAppearance, wheelTreadAppearanceCanvas, wheelTreadAppearanceCavity } from '../wheelTreadAppearance';
import type { Skin3DFile } from '../skin3d';
import { hasExperimentalSkinNormalShader, previewMeshMaterialSlot } from './materialSlots';
import type { UvGuideIsland } from '../uvGuideData';
import { planUvFocus, uvFocusTriangles, uvFocusView, type UvFocusPlan } from './uvFocus';
import { REAL_UV_ATLAS, organizedAtlasGuides, type UvAtlasVersion } from '../realUvAtlas';
import { WHEEL_PART_GUIDES } from '../wheelParts';

/** Modèle servi statiquement depuis public/models/ (fiable en dev et prod). */
const CAR_MODEL_RESOURCE_PATH = `${import.meta.env?.BASE_URL ?? '/'}models/car/`;
const CAR_MODEL_URL = `${CAR_MODEL_RESOURCE_PATH}StadiumCAR2020_OffsetFix.fbx`;
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
export interface UvPreviewFocus { label: string; isolated: boolean; occurrence: number; occurrences: number }
export interface Image3DHandler {
  begin: (family: PaintFamily, u: number, v: number, anchor: SurfaceAnchor) => boolean | 'projection';
  move: (family: PaintFamily, u: number, v: number, anchor: SurfaceAnchor) => boolean | void;
  end: () => void;
  place: (family: PaintFamily, u: number, v: number, anchor: SurfaceAnchor) => void;
  boundary?: () => void;
  transform?: (values: Partial<Pick<DecalProjection, 'width' | 'height' | 'angle'>>) => void;
  transformEnd?: () => void;
}

function slotFromObject(mesh: THREE.Mesh): MaterialSlot {
  const mat = mesh.material;
  const matName = (Array.isArray(mat) ? mat[0]?.name : mat?.name) ?? '';
  return previewMeshMaterialSlot(matName, mesh.name);
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
  onUvFocusChange: ((focus: UvPreviewFocus | null) => void) | null = null;
  private uvFocus: { region: UvGuideIsland; plan: UvFocusPlan; root: THREE.Group; isolated: boolean; previous: PreviewViewState; minDistance: number; near: number; wheelDesignPoints?: readonly Vec3[] } | null = null;
  private uvFocusScene: { projection: readonly ProjectionTriangle[]; triangles: readonly ProjectionTriangle[] } | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private textures = new Map<MapId, THREE.CanvasTexture>();
  private baseSources = new Map<MapId, HTMLCanvasElement>();
  private dirtMasks = new Map<PaintFamily, HTMLCanvasElement>();
  private dirtCanvases = new Map<MapId, HTMLCanvasElement>();
  private dirtAmount = 0;
  private dirtEnabled = true;
  private wheelSurface = normalizeWheelSurface(undefined);
  private wheelAppearanceOfficial = true;
  private wheelRoughnessSource: HTMLCanvasElement | null = null;
  private wheelAppearanceCanvases = new Map<'color' | 'roughmetal', HTMLCanvasElement>();
  /** Canvas intermédiaires pour repacker R (rugosité) / G (métal) par matériau. */
  private rmPacks = new Map<MapId, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
  private skinMat: THREE.MeshPhysicalMaterial;
  private detailsMat: THREE.MeshStandardMaterial;
  private wheelsMat: THREE.MeshStandardMaterial;
  private glassMat: THREE.MeshPhysicalMaterial;
  private surfaceTextures: PreviewSurfaceTextures;
  private ambientOcclusion: PreviewAmbientOcclusion;
  private exportColorPreview: ExportColorPreview;
  private exportPreviewActive = false;
  private playerDisplay: PlayerDisplay | null = null;
  private coatIntensity = 1;
  private skinNormalShader = false;
  private emissiveIntensity = 1.4;
  private braking = false;
  private night = false;
  private previewEnvironment: PreviewEnvironment = { venue: 'studio', mood: 'day' };
  private studioRoot = new THREE.Group();
  private studioEnvironment: StudioEnvironment;
  private stadium: StadiumEnvironment | null = null;
  /** Rôle des zones peintes hors vitesse. Les feux arrière restent allumés. */
  private illumRole: IllumRole = 'always';
  private illumination = new Map<MapId, { source: HTMLCanvasElement; roles?: HTMLCanvasElement; canvas: HTMLCanvasElement; texture?: THREE.CanvasTexture }>();
  private detailsLayout?: DetailsLayout;
  private uvAtlas?:UvAtlasVersion;
  private carRoot = new THREE.Group();
  /** Racine du modèle courant (FBX officiel ou GLB custom), pour la remplacer. */
  private modelRoot: THREE.Object3D | null = null;
  private vehicleRig: VehicleRigPreview | null = null;
  private vehiclePose: VehiclePose = { ...REST_VEHICLE_POSE };
  private importedMaterials: THREE.Material[] = [];
  private loadingEl: HTMLDivElement;
  private loading = true;
  private frameLoop?: DemandRenderLoop;
  private resizeObserver: ResizeObserver;
  private container: HTMLElement;
  private disposed = false;
  private loadGeneration = 0;
  /** Keep the pristine FBX available when resetting an imported vehicle. */
  private officialModelBuffer: ArrayBuffer | null = null;

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
  private onControlsChange = () => this.requestRender();
  private onVisibilityChange = () => this.updateRenderVisibility();
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'car-preview-loading';
    this.loadingEl.textContent = 'Chargement du modèle…';
    container.appendChild(this.loadingEl);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(STUDIO_LIGHTING.background);
    this.studioEnvironment = new StudioEnvironment();
    this.scene.add(this.studioEnvironment.root);
    this.scene.environment = this.studioEnvironment.environmentMap(this.renderer);
    this.scene.environmentIntensity = STUDIO_LIGHTING.environmentIntensity;
    this.scene.add(this.studioRoot);

    // near volontairement petit pour pouvoir zoomer très près sans clipper.
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.02, 200);
    this.camera.position.set(5.5, 3.2, 6.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.55, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI - 0.005;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 18;
    // Déplacement latéral dans le plan écran (plus naturel pour « aller où on veut »).
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 1.1;
    this.controls.addEventListener('start', this.onControlsStart);
    this.controls.addEventListener('change', this.onControlsChange);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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
    dom.addEventListener('webglcontextrestored', this.onControlsChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

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
    this.surfaceTextures = new PreviewSurfaceTextures(
      { skin: this.skinMat, details: this.detailsMat, wheels: this.wheelsMat },
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    void this.surfaceTextures.loadNativeTextures().then(() => this.requestRender());
    this.ambientOcclusion = new PreviewAmbientOcclusion(
      { skin: this.skinMat, details: this.detailsMat, wheels: this.wheelsMat },
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    void this.ambientOcclusion.loadNativeTextures().then(() => this.requestRender());
    this.exportColorPreview = new ExportColorPreview(
      { Skin_B: this.skinMat, Details_B: this.detailsMat, Wheels_B: this.wheelsMat },
      this.renderer.capabilities.getMaxAnisotropy(),
    );

    this.scene.add(this.carRoot);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.studioRoot.add(ground);

    const grid = new THREE.GridHelper(18, 36, 0x2c313a, 0x22262d);
    grid.position.y = -0.005;
    this.studioRoot.add(grid);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.initDefaultRoughnessPack();

    // The loading overlay reports startup errors; explicit replacements must reject.
    void this.loadCarModel().catch(() => {});

    this.frameLoop = new DemandRenderLoop((now: number) => {
      const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
      this.lastFrame = now;
      this.applyKeyboardMove(dt);
      const moving = this.controls.update();
      this.updateGroundVisibility();
      this.renderer.render(this.scene, this.camera);
      this.updateProjectionGuide();
      return moving || this.moveKeys.size > 0;
    });
    this.updateRenderVisibility();
    this.requestRender();
  }

  private requestRender() { this.frameLoop?.invalidate(); }

  private updateRenderVisibility() {
    this.lastFrame = 0;
    this.frameLoop?.setActive(!document.hidden && this.container.clientWidth > 0 && this.container.clientHeight > 0);
  }

  private async loadCarModel(): Promise<boolean> {
    const generation = ++this.loadGeneration;
    try {
      const buffer = this.officialModelBuffer ?? await this.fetchModelBuffer(CAR_MODEL_URL);
      this.officialModelBuffer = buffer;
      if (this.disposed || generation !== this.loadGeneration) return false;
      if (!await this.installModel(buffer, 'fbx', generation)) return false;
      this.hideLoadingOverlay();
      return true;
    } catch (err) {
      if (this.disposed || generation !== this.loadGeneration) return false;
      this.officialModelBuffer = null;
      const message = err instanceof Error ? err.message : 'erreur inconnue';
      console.error('[CarPreview] Échec du chargement du modèle FBX :', err);
      this.showLoadingError(message);
      throw err;
    }
  }

  /**
   * Affiche un `preview.glb` exporté depuis le blend de référence, à la place
   * de la Stadium Car officielle. Les matériaux sont rebranchés sur les mêmes
   * atlas (le nom doit contenir skin / detail / wheel / glass).
   */
  async loadCustomPreview(buffer: ArrayBuffer, options: { nativeSurfaceLayout?: boolean; detailsLayout?: DetailsLayout } = {}): Promise<void> {
    embeddedGlbData(buffer);
    const generation = ++this.loadGeneration;
    if (!await this.installModel(buffer, 'glb', generation, options.detailsLayout)) throw new Error('Le chargement du modèle personnalisé a été interrompu.');
    if (options.nativeSurfaceLayout) {
      this.surfaceTextures.setOfficialModel(true);
      this.ambientOcclusion.setOfficialModel(true);
      this.wheelAppearanceOfficial = true;
      this.refreshWheelAppearance();
    }
  }

  /** Revient au FBX officiel (export texture seul, sans mesh custom). */
  async loadOfficialModel(): Promise<void> {
    if (!await this.loadCarModel()) throw new Error('Le chargement de la voiture officielle a été interrompu.');
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

  private async installModel(buffer: ArrayBuffer, kind: 'fbx' | 'glb', generation: number, detailsLayout?: DetailsLayout) {
    const model = await this.parseModel(buffer, kind);
    if (this.disposed || generation !== this.loadGeneration) return false;
    let hasMesh = false;
    model.traverse((obj) => { if (obj instanceof THREE.Mesh) hasMesh = true; });
    if (!hasMesh) throw new Error('Le modèle ne contient aucun maillage de voiture.');

    this.detachModel();
    if (this.detailsLayout !== detailsLayout) {
      this.detailsLayout = detailsLayout;
      this.syncIllumPreview('Details_I');
    }
    let skinNormals = false;
    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const origMats = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (origMats.some(material => hasExperimentalSkinNormalShader(material?.name ?? ''))) skinNormals = true;
      for (const m of origMats) {
        if (m && !this.importedMaterials.includes(m)) this.importedMaterials.push(m);
      }
      const slot = slotFromObject(obj);
      if (slot === 'wheels') ensureWheelTangentFrame(obj.geometry);
      obj.userData.paintSlot = slot;
      obj.material = this.materialForSlot(slot);
      obj.castShadow = true;
      obj.receiveShadow = true;
    });

    const span = fitModelToGround(model);
    this.skinNormalShader = skinNormals;
    this.skinMat.clearcoat = skinNormals ? 0 : this.exportPreviewActive ? 1 : this.coatIntensity;
    this.surfaceTextures.setSkinNormalEnabled(skinNormals);
    this.surfaceTextures?.setOfficialModel(kind === 'fbx');
    this.ambientOcclusion?.setOfficialModel(kind === 'fbx');
    this.modelRoot = model;
    this.uvAtlas=undefined;model.traverse(object=>{if(object instanceof THREE.Mesh&&object.geometry.getAttribute('_source_uv'))this.uvAtlas=REAL_UV_ATLAS;});
    this.surfaceTextures.setAtlasSource(this.uvAtlas?detailsLayout??'stock':undefined);
    this.ambientOcclusion.setAtlasSource(this.uvAtlas?detailsLayout??'stock':undefined);
    this.wheelAppearanceOfficial = kind === 'fbx';
    this.refreshWheelAppearance();
    this.syncIllumPreview();
    this.carRoot.add(model);
    this.vehicleRig = new VehicleRigPreview(model);
    this.vehiclePose = { ...REST_VEHICLE_POSE };
    this.scene.add(this.vehicleRig.guides);
    this.carBounds = new THREE.Box3().setFromObject(model);
    this.playerDisplay = PlayerDisplay.attach(model, kind === 'fbx', this.renderer.capabilities.getMaxAnisotropy());
    this.projectionTriangles = null;
    this.controls.minDistance = span * 0.12;
    this.controls.maxDistance = span * 6;
    this.applyHomeFraming();
    if (this.pendingView) this.restoreViewState(this.pendingView);
    this.hideLoadingOverlay();
    this.onModelReady?.();
    this.requestRender();
    return true;
  }

  private detachModel() {
    this.clearUvFocus(false);
    this.uvFocusScene = null;
    if (!this.modelRoot) return;
    this.playerDisplay?.dispose(); this.playerDisplay = null;
    this.vehicleRig?.dispose(); this.vehicleRig = null;
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
      if (this.projectionGuide) container.appendChild(this.projectionGuide);
      if (this.loading) container.appendChild(this.loadingEl);
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(container);
    }
    // React can replace a host while hot-reloading the modal. Reattach the
    // externally managed canvas even when the host reference itself survives.
    if (this.renderer.domElement.parentElement !== container) container.appendChild(this.renderer.domElement);
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
    const seed: { id: MapId; mat: THREE.MeshStandardMaterial }[] = [
      { id: 'Skin_R', mat: this.skinMat },
      { id: 'Details_R', mat: this.detailsMat },
      { id: 'Wheels_R', mat: this.wheelsMat },
    ];
    for (const { id, mat } of seed) {
      const { roughness, metalness } = decodeSurfaceMaterial(MAP_BY_ID[id].defaultFill);
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `rgb(255, ${roughness}, ${metalness})`;
      ctx.fillRect(0, 0, 4, 4);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.NoColorSpace;
      texture.flipY = true;
      this.rmPacks.set(id, { canvas, texture });
      mat.roughnessMap = texture;
      mat.metalnessMap = texture;
      mat.needsUpdate = true;
    }
  }

  private resize() {
    this.updateRenderVisibility();
    this.requestRender();
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
    if (aspectChanged && this.uvFocus) {
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      this.restoreViewState(uvFocusView(this.uvFocus.plan.bounds, direction, this.camera.fov, aspect, this.uvFocus.wheelDesignPoints));
    } else if (aspectChanged && !this.userNavigated) this.applyHomeFraming();
  }

  private onControlsStart = () => {
    this.userNavigated = true;
  };

  /** Relie les normales supplémentaires du skin importé, sans modifier ses DDS. */
  setSurfaceTextures(files: readonly Skin3DFile[]) {
    this.requestRender();
    this.surfaceTextures.setFiles(files);
    this.ambientOcclusion.setFiles(files);
  }

  setMaterialSurfaceOverlays(overlays: readonly MaterialSurfaceOverlay[]) {
    this.requestRender();
    this.surfaceTextures.setMaterialOverlays(overlays);
    this.ambientOcclusion.setMaterialOverlays(overlays);
  }

  setWheelSurface(value: WheelSurfaceSettings) {
    this.requestRender();
    this.surfaceTextures.setWheelSurface(value);
    this.ambientOcclusion.setWheelSurface(value);
    const next = normalizeWheelSurface(value);
    this.studioEnvironment.setTyreDetail(next.volume === true && next.strength > 0);
    if (next.mode === this.wheelSurface?.mode && next.strength === this.wheelSurface?.strength && next.volume === this.wheelSurface?.volume) return;
    this.wheelSurface = next;
    this.refreshWheelAppearance();
  }

  private refreshWheelAppearance() {
    if (this.baseSources?.has('Wheels_B')) this.syncDirtPreview('wheels');
    if (this.wheelRoughnessSource) this.updateRoughnessPack('Wheels_R', this.wheelRoughnessSource);
  }

  private wheelAppearanceCanvas(source: HTMLCanvasElement, channel: 'color' | 'roughmetal'): HTMLCanvasElement {
    const official = this.wheelAppearanceOfficial !== false || !!this.uvAtlas;
    if (!hasWheelTreadAppearance(channel === 'color' ? 'Wheels_B' : 'Wheels_R', this.wheelSurface, official)) return source;
    this.wheelAppearanceCanvases ??= new Map();
    const target = this.wheelAppearanceCanvases.get(channel) ?? document.createElement('canvas');
    this.wheelAppearanceCanvases.set(channel, target);
    const cavity = wheelTreadAppearanceCavity(this.wheelSurface, official, this.uvAtlas ? this.detailsLayout ?? 'stock' : undefined);
    return wheelTreadAppearanceCanvas(source, target, channel, this.wheelSurface, official, cavity);
  }

  setExportColorPreview(images: readonly ExportMaterialImage[]) {
    this.requestRender();
    this.exportColorPreview.set(images);
    this.exportPreviewActive = true;
    // This multiplier belongs only to workshop inspection, never to the ZIP.
    this.skinMat.clearcoat = this.skinNormalShader ? 0 : 1;
  }

  clearExportColorPreview() {
    this.requestRender();
    this.exportColorPreview.clear();
    this.exportPreviewActive = false;
    this.skinMat.clearcoat = this.skinNormalShader ? 0 : this.coatIntensity;
  }

  /** Branche/rafraîchit un canvas source comme texture d'une map. */
  setMapCanvas(id: MapId, source: HTMLCanvasElement, roles?: HTMLCanvasElement) {
    this.requestRender();
    if (isDirtMask(id)) {
      this.dirtMasks.set(MAP_BY_ID[id].group, source);
      this.syncDirtPreview(MAP_BY_ID[id].group);
      return;
    }
    if (MAP_BY_ID[id].kind === 'basecolor') {
      this.baseSources.set(id, source);
      this.syncDirtPreview(MAP_BY_ID[id].group);
      return;
    }
    // Les maps _R sont repackées séparément (canaux R/G → G/B).
    if (id === 'Skin_R' || id === 'Details_R' || id === 'Wheels_R') {
      if (id === 'Wheels_R') this.wheelRoughnessSource = source;
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

    this.attachMapCanvas(id, source);
  }

  /** Preview never modifies the editor canvases used by export. */
  setDirtPreview(amount: number, enabled = true) {
    this.requestRender();
    this.dirtAmount = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
    this.dirtEnabled = enabled;
    for (const family of ['skin', 'details', 'wheels'] as const) this.syncDirtPreview(family);
  }

  private syncDirtPreview(family: PaintFamily) {
    const id = MAPS.find((map) => map.group === family && map.kind === 'basecolor')!.id;
    const source = this.baseSources.get(id);
    if (!source?.width || !source.height) return;
    const mask = this.dirtMasks.get(family);
    if (!this.dirtEnabled || !this.dirtAmount || !mask?.width || !mask.height) {
      this.attachMapCanvas(id, source);
      return;
    }
    const canvas = this.dirtCanvases.get(id) ?? document.createElement('canvas');
    this.dirtCanvases.set(id, canvas);
    const scale = Math.min(1, mask.width / source.width, mask.height / source.height);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      this.textures.get(id)?.dispose();
      canvas.width = width; canvas.height = height;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const maskCtx = mask.getContext('2d', { willReadFrequently: true });
    if (!ctx || !maskCtx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dirt = maskCtx.getImageData(0, 0, mask.width, mask.height);
    base.data.set(previewDirtPixels(base, dirt, this.dirtAmount));
    ctx.putImageData(base, 0, 0);
    this.attachMapCanvas(id, canvas);
  }

  private attachMapCanvas(id: MapId, source: HTMLCanvasElement) {
    if (id === 'Wheels_B') source = this.wheelAppearanceCanvas(source, 'color');
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
    const size = `${source.width}x${source.height}`;
    if (tex.userData.skionSize && tex.userData.skionSize !== size) tex.dispose();
    tex.userData.skionSize = size;
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
    if (id === 'Wheels_R') source = this.wheelAppearanceCanvas(source, 'roughmetal');
    const { canvas, texture } = pack;
    if (canvas.width !== source.width || canvas.height !== source.height) {
      texture.dispose(); // WebGL allocates immutable texture storage for each size.
      canvas.width = source.width; canvas.height = source.height;
    }
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
    if (canvas.width !== w || canvas.height !== h) {
      state.texture?.dispose();
      canvas.width = w; canvas.height = h;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0);
    {
      const img = ctx.getImageData(0, 0, w, h);
      const mask = mapId === 'Details_I' ? speedLightMask(w, h, this.detailsLayout,this.uvAtlas) : null;
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
    this.requestRender();
    this.illumRole = role;
    this.syncIllumPreview();
    this.applyEmissive();
  }

  /** Intensité du vernis (clearcoat) sur la carrosserie (0..1). */
  setCoatIntensity(v: number) {
    this.requestRender();
    this.coatIntensity = Math.max(0, Math.min(1, v));
    this.skinMat.clearcoat = this.skinNormalShader ? 0 : this.exportPreviewActive ? 1 : this.coatIntensity;
    this.skinMat.needsUpdate = true;
  }

  /** Intensité globale de l'auto-illumination des détails (néon). */
  setEmissiveIntensity(v: number) {
    this.requestRender();
    this.emissiveIntensity = Math.max(0, v);
    this.applyEmissive();
  }

  /** Simule le freinage : allume les zones « feux de frein », la vitesse reste visible. */
  setBraking(on: boolean) {
    this.requestRender();
    this.braking = on;
    this.syncIllumPreview();
    this.applyEmissive();
  }

  /** Compatibility entry point for the former day/night toggle. */
  setNight(on: boolean) {
    this.setEnvironment({ ...this.previewEnvironment, venue: on ? 'stadium' : this.previewEnvironment.venue, mood: on ? 'night' : 'day' });
  }

  getEnvironment(): PreviewEnvironment { return { ...this.previewEnvironment }; }
  getBraking(): boolean { return this.braking; }

  setEnvironment(value: PreviewEnvironment) {
    this.requestRender();
    const next = resolvePreviewEnvironment(value);
    const preset = lightingPreset(next.mood);
    const lighting = previewLighting(next);
    this.previewEnvironment = next;
    this.night = lighting.headlights;
    this.renderer.toneMappingExposure = lighting.exposure;
    this.studioRoot.visible = next.venue === 'studio';
    this.studioEnvironment.root.visible = next.venue === 'studio';
    if (next.venue === 'stadium') {
      if (!this.stadium) { this.stadium = new StadiumEnvironment(); this.scene.add(this.stadium.root); }
      this.stadium.root.visible = true;
      this.stadium.setMood(next.mood);
      this.scene.background = null;
      this.scene.environment = this.stadium.environmentMap(this.renderer, next.mood);
      this.scene.environmentIntensity = preset.environmentIntensity;
      this.scene.fog = new THREE.Fog(preset.horizon, 38, 100);
    } else {
      if (this.stadium) this.stadium.root.visible = false;
      this.scene.environment = this.studioEnvironment.environmentMap(this.renderer);
      this.scene.environmentIntensity = STUDIO_LIGHTING.environmentIntensity;
      this.scene.background = new THREE.Color(STUDIO_LIGHTING.background);
      this.scene.fog = null;
    }
    this.syncIllumPreview();
    this.updateGroundVisibility();
  }

  /** Remove only the ground when working below it; lighting and reflections stay intact. */
  private updateGroundVisibility() {
    const aboveGround = this.camera.position.y >= 0.02;
    this.studioRoot.visible = this.previewEnvironment.venue === 'studio' && aboveGround;
    this.stadium?.setGroundVisible(aboveGround);
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
    if (poseIsActive(this.vehiclePose)) mode = 'navigate';
    if (mode !== this.interaction) this.finishInteraction();
    this.interaction = mode;
    this.edit3dEnabled = mode !== 'navigate';
    this.renderer.domElement.style.cursor = mode === 'image' ? 'grab' : this.edit3dEnabled ? 'crosshair' : '';
    this.applyMouseButtons();
    this.updateProjectionGuide();
  }

  hasVehicleRig() { return this.vehicleRig?.ready ?? false; }
  setVehiclePose(pose: VehiclePose) {
    this.requestRender();
    const changed = !this.vehiclePose || this.vehiclePose.steering !== pose.steering || this.vehiclePose.spin !== pose.spin || this.vehiclePose.reactor !== pose.reactor;
    if (poseIsActive(pose)) this.clearUvFocus(false);
    this.vehiclePose = { ...pose };
    if (poseIsActive(pose)) this.setInteraction('navigate');
    this.vehicleRig?.apply(pose);
    if (changed && this.vehicleRig?.ready) this.projectionTriangles = null;
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
      if (!this.moveKeys.size) this.lastFrame = 0;
      this.moveKeys.add(key);
      this.requestRender();
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
    const hit = this.raycaster.intersectObject(this.uvFocus?.isolated ? this.uvFocus.root : this.carRoot, true).find(hit => hit.object instanceof THREE.Mesh);
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
  private computeHome(dir = CarPreview.HOME_DIR, targetHeight = 0.4): { position: THREE.Vector3; target: THREE.Vector3 } | null {
    const box = this.carBounds;
    if (!box || box.isEmpty()) return null;
    // Cible : centre de la boîte, un peu rabaissé (vue en plongée : la voiture se
    // projette sinon dans la moitié basse du cadre).
    const target = box.getCenter(new THREE.Vector3());
    target.y = box.min.y + (box.max.y - box.min.y) * targetHeight;
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
    this.updateGroundVisibility();
  }

  /** Revient au cadrage initial (touche F ou bouton « Recadrer »). */
  resetCamera() {
    this.clearUvFocus(false);
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

  /** Look up at the chassis, with a slight tilt to keep camera orientation stable. */
  viewUnderbody() {
    this.clearUvFocus(false);
    const view = this.computeHome(new THREE.Vector3(0, -1, 0.08).normalize(), 0.5);
    if (!view) return;
    this.restoreViewState({ position: view.position.toArray() as Vec3, target: view.target.toArray() as Vec3 });
  }

  getViewState(): PreviewViewState {
    return { position: this.camera.position.toArray() as Vec3, target: this.controls.target.toArray() as Vec3 };
  }

  /** Focus only changes preview/camera state. Exact selected triangles share the
   * live paint material; isolated geometry is never added to carRoot or exports. */
  focusUvRegion(region: UvGuideIsland, occurrence?: number): boolean {
    if (!this.modelRoot || !this.carBounds) return false;
    const previous = this.uvFocus?.previous ?? this.getViewState();
    const minDistance = this.uvFocus?.minDistance ?? this.controls.minDistance, near = this.uvFocus?.near ?? this.camera.near;
    const plan = planUvFocus(this.getUvFocusScene(), region, this.getViewState(), this.camera.fov, this.camera.aspect, occurrence);
    if (!plan) { this.clearUvFocus(); return false; }
    const inspectTyre = region.family === 'wheels' && region.key === 'tyres:tread';
    let displayTriangles = plan.triangles;
    if (inspectTyre) {
      const center = plan.bounds.getCenter(new THREE.Vector3()), vehicleCenter = this.carBounds.getCenter(new THREE.Vector3());
      const direction = new THREE.Vector3(center.x >= vehicleCenter.x ? .8 : -.8, .75, center.z >= vehicleCenter.z ? 1.2 : -1.2);
      Object.assign(plan, uvFocusView(plan.bounds, direction, this.camera.fov, this.camera.aspect));
      // Keep the same physical wheel complete when inspecting its tread in isolation.
      const wheelBounds = plan.bounds.clone().expandByScalar(.05), point = new THREE.Vector3();
      displayTriangles = this.getUvFocusScene().filter(triangle => triangle.family === 'wheels'
        && triangle.points.every(position => wheelBounds.containsPoint(point.fromArray(position))));
    }
    this.clearUvFocus(false);
    const root = new THREE.Group(); root.name = 'uv-focus-preview';
    const isolatedMesh = this.focusedMesh(displayTriangles, region.family), geometry = isolatedMesh.geometry;
    root.add(isolatedMesh);
    const tyre = region.family === 'wheels';
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, tyre ? 180 : 55), new THREE.LineBasicMaterial({ color: 0x7be4c7, transparent: true, opacity: tyre ? .4 : .8, depthTest: tyre, depthWrite: false }));
    outline.renderOrder = 20; root.add(outline); this.scene.add(root);
    this.uvFocus = { region, plan, root, isolated: plan.visible < .55, previous, minDistance, near };
    const span = plan.bounds.getSize(new THREE.Vector3()).length();
    this.controls.minDistance = Math.min(minDistance, Math.max(.01, span * .08));
    this.camera.near = Math.min(near, Math.max(.0001, span * .02)); this.camera.updateProjectionMatrix();
    this.applyUvFocusVisibility(); this.restoreViewState({ position: plan.position, target: plan.target });
    this.emitUvFocus(); return true;
  }

  private focusedMesh(triangles: readonly ProjectionTriangle[], family: ProjectionTriangle['family']): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    const order = triangles.map(triangle => {
      const face = new THREE.Vector3(...triangle.points[1]).sub(new THREE.Vector3(...triangle.points[0]))
        .cross(new THREE.Vector3(...triangle.points[2]).sub(new THREE.Vector3(...triangle.points[0])));
      return triangle.normals && face.dot(new THREE.Vector3(...triangle.normals[0])) < 0 ? [0, 2, 1] : [0, 1, 2];
    });
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flatMap((triangle, i) => order[i].flatMap(j => triangle.points[j])), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(triangles.flatMap((triangle, i) => order[i].flatMap(j => triangle.uv[j])), 2));
    if (triangles.every(triangle => triangle.normals)) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(triangles.flatMap((triangle, i) => order[i].flatMap(j => triangle.normals![j])), 3));
    else geometry.computeVertexNormals();
    // AO uses the same native UV set in the original meshes.
    geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
    if (family === 'wheels') ensureWheelTangentFrame(geometry);
    const mesh = new THREE.Mesh(geometry, this.materialForSlot(family));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.paintSlot = family;
    return mesh;
  }

  /** The sidewall workshop uses the real wheel, its rim materials and current paint. */
  focusWheelForDesign(side: 'outer' | 'inner' = 'outer'): boolean {
    const guides = this.uvAtlas ? organizedAtlasGuides('wheels', this.detailsLayout) : WHEEL_PART_GUIDES;
    const tread = guides.find(region => region.key === 'tyres:tread');
    const occurrence = this.uvFocus?.plan.occurrence;
    if (!tread || !this.focusUvRegion(tread, occurrence) || !this.uvFocus || !this.carBounds) return false;
    const focus = this.uvFocus, projection = this.getProjectionTriangles();
    // The tread box omits the bulging sidewalls. Follow the original tyre's
    // connected vertices instead, including UV seams without clipping its lips.
    const vertexKey = (point: Vec3) => point.map(value => Math.round(value * 10_000)).join(',');
    const vertices = new Map<string, ProjectionTriangle[]>();
    for (const triangle of projection) {
      if (triangle.family !== 'wheels') continue;
      for (const point of triangle.points) {
        const key = vertexKey(point), neighbors = vertices.get(key) ?? [];
        neighbors.push(triangle); vertices.set(key, neighbors);
      }
    }
    const connected = new Set(focus.plan.triangles), tyre = [...connected];
    for (let i = 0; i < tyre.length; i++) for (const point of tyre[i].points) {
      const key = vertexKey(point), neighbors = vertices.get(key) ?? [];
      vertices.delete(key);
      for (const triangle of neighbors) if (!connected.has(triangle)) { connected.add(triangle); tyre.push(triangle); }
    }
    const wheelBounds = new THREE.Box3();
    for (const triangle of tyre) for (const position of triangle.points) wheelBounds.expandByPoint(new THREE.Vector3(...position));
    // The workshop is a material preview: selection outlines obscure markings.
    for (const object of [...focus.root.children]) {
      focus.root.remove(object);
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
      if (object instanceof THREE.LineSegments) (object.material as THREE.Material).dispose();
    }
    const wheel = this.focusedMesh(tyre, 'wheels'); focus.root.add(wheel);
    const framingPoints = tyre.flatMap(triangle => triangle.points);
    // The hub and rim can protrude past the tyre's axial bounds. Keep the
    // complete original faces rather than cutting them at the rubber profile.
    const diameter = Math.max(wheelBounds.max.y - wheelBounds.min.y, wheelBounds.max.z - wheelBounds.min.z);
    const bounds = wheelBounds.clone().expandByVector(new THREE.Vector3(diameter * .05, diameter * .01, diameter * .01)), point = new THREE.Vector3();
    for (const family of ['skin', 'details'] as const) {
      const triangles = projection.filter(triangle => triangle.family === family
        && triangle.points.every(position => bounds.containsPoint(point.fromArray(position))));
      if (triangles.length) { wheel.add(this.focusedMesh(triangles, family)); framingPoints.push(...triangles.flatMap(triangle => triangle.points)); }
    }
    this.setUvFocusIsolated(true);
    const center = wheelBounds.getCenter(new THREE.Vector3()), carCenter = this.carBounds.getCenter(new THREE.Vector3());
    const sideGuide = guides.find(region => region.key === 'tyres:outer'), axle = new THREE.Vector3();
    const flank = sideGuide ? uvFocusTriangles(tyre, sideGuide) : [];
    for (const triangle of flank) {
      const face = new THREE.Vector3(...triangle.points[1]).sub(new THREE.Vector3(...triangle.points[0]))
        .cross(new THREE.Vector3(...triangle.points[2]).sub(new THREE.Vector3(...triangle.points[0])));
      const normal = triangle.normals ? new THREE.Vector3(...triangle.normals[0]).add(new THREE.Vector3(...triangle.normals[1])).add(new THREE.Vector3(...triangle.normals[2])).normalize() : face.clone().normalize();
      axle.addScaledVector(normal, face.length());
    }
    if (axle.lengthSq() < 1e-10) axle.set(center.x >= carCenter.x ? 1 : -1, 0, 0);
    axle.normalize();
    const direction = axle.clone().multiplyScalar(side === 'inner' ? -1 : 1)
      .add(new THREE.Vector3(0, .13, center.z >= carCenter.z ? .15 : -.15));
    focus.plan.bounds = wheelBounds;
    focus.wheelDesignPoints = framingPoints;
    Object.assign(focus.plan, uvFocusView(wheelBounds, direction, this.camera.fov, this.camera.aspect, framingPoints));
    this.restoreViewState(focus.plan);
    this.requestRender(); return true;
  }

  private emitUvFocus() {
    const focus = this.uvFocus;
    this.onUvFocusChange?.(focus ? { label: focus.region.label, isolated: focus.isolated, occurrence: focus.plan.occurrence, occurrences: focus.plan.occurrences } : null);
  }
  private applyUvFocusVisibility() {
    const focus = this.uvFocus; if (!focus) return;
    if (this.modelRoot) this.modelRoot.visible = !focus.isolated;
    focus.root.children[0].visible = focus.isolated;
  }
  setUvFocusIsolated(isolated: boolean) {
    this.requestRender();
    if (!this.uvFocus) return;
    this.uvFocus.isolated = isolated; this.applyUvFocusVisibility(); this.emitUvFocus();
  }
  nextUvFocusOccurrence() {
    if (this.uvFocus) this.focusUvRegion(this.uvFocus.region, this.uvFocus.plan.occurrence + 1);
  }
  clearUvFocus(restoreCamera = true) {
    this.requestRender();
    this.camera.up.set(0, 1, 0);
    const focus = this.uvFocus; if (!focus) return;
    this.uvFocus = null;
    if (this.modelRoot) this.modelRoot.visible = true;
    this.scene.remove(focus.root);
    focus.root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
      if (object instanceof THREE.LineSegments) (object.material as THREE.Material).dispose();
    });
    // The selected mesh shares the editor material: never dispose that material.
    this.controls.minDistance = focus.minDistance; this.camera.near = focus.near; this.camera.updateProjectionMatrix();
    if (restoreCamera) this.restoreViewState(focus.previous);
    else this.updateGroundVisibility();
    this.emitUvFocus();
  }

  private getUvFocusScene(): readonly ProjectionTriangle[] {
    const projection = this.getProjectionTriangles();
    if (this.uvFocusScene?.projection === projection) return this.uvFocusScene.triangles;
    const triangles = [...projection];
    this.carRoot.traverse(object => {
      if (!(object instanceof THREE.Mesh) || ['skin','details','wheels','glass'].includes(object.userData.paintSlot) || !object.visible) return;
      const position=object.geometry.getAttribute('position'),index=object.geometry.index; if(!position)return;
      const count=index?.count??position.count;
      for(let i=0;i+2<count && triangles.length<=500_000;i+=3){
        const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(object.matrixWorld).toArray()) as [Vec3,Vec3,Vec3];
        // Non-paintable seats/mechanics can obstruct a piece, never match UV selection.
        triangles.push({family:'skin',points,uv:[[-100,-100],[-100,-100],[-100,-100]]});
      }
    });
    this.uvFocusScene={projection,triangles};return triangles;
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
    this.updateGroundVisibility();
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
    const hits = this.raycaster.intersectObject(this.uvFocus?.isolated ? this.uvFocus.root : this.carRoot, true);
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
      this.dragIsland = imageIslandAt(hit.family, hit.u, hit.v, this.detailsLayout,this.uvAtlas);
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
          (this.dragIsland && imageIslandAt(hit.family, hit.u, hit.v, this.detailsLayout,this.uvAtlas) !== this.dragIsland)) {
          boundary();
          return;
        }
        this.lastDragUV = hit;
        if (this.imageHandler?.move(hit.family, hit.u, hit.v, hit.anchor) === false) boundary();
      } else this.paintHandler?.move(hit.family, hit.u, hit.v);
    }
  }

  /** Triangles en espace monde avec leurs UV d'origine : une projection peut traverser plusieurs atlas. */
  projectImage(decal: DecalProjection, source: PixelSource, resolution?: number) {
    return bakeProjection(this.getProjectionTriangles(), decal, source, resolution);
  }

  getProjectionTriangles(): readonly ProjectionTriangle[] {
    if (!this.projectionTriangles) {
      this.carRoot.updateMatrixWorld(true);
      const triangles: ProjectionTriangle[] = [];
      this.carRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const family = object.userData.paintSlot as MaterialSlot;
        if (family !== 'skin' && family !== 'details' && family !== 'wheels') return;
        const geometry = object.geometry;
        const position = geometry.getAttribute('position'); const uv = geometry.getAttribute('uv');
        const sourceUv=geometry.getAttribute('_source_uv');
        const atlasUv=geometry.getAttribute('_atlas_uv');
        const normal = geometry.getAttribute('normal'), normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
        if (!position || !uv) return;
        const index = geometry.index;
        const count = index?.count ?? position.count;
        for (let i = 0; i + 2 < count; i += 3) {
          const ids = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset);
          triangles.push({ family, ...(sourceUv?{sourceUv:ids.map(id=>[sourceUv.getX(id),sourceUv.getY(id)]) as ProjectionTriangle['uv']}:{}), ...(atlasUv?{atlasUv:ids.map(id=>[atlasUv.getX(id),atlasUv.getY(id)]) as ProjectionTriangle['uv']}:{}), points: ids.map((id) => new THREE.Vector3().fromBufferAttribute(position, id).applyMatrix4(object.matrixWorld).toArray()) as [Vec3, Vec3, Vec3],
            ...(normal ? { normals: ids.map(id => new THREE.Vector3().fromBufferAttribute(normal, id).applyNormalMatrix(normalMatrix).toArray()) as [Vec3, Vec3, Vec3] } : {}),
            uv: ids.map((id) => [uv.getX(id), uv.getY(id)]) as ProjectionTriangle['uv'] });
        }
      });
      this.projectionTriangles = triangles;
    }
    return this.projectionTriangles;
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
    this.updateGroundVisibility();
    // Selection outlines/isolation are working aids, absent from exported icons.
    const focus = this.uvFocus;
    if (focus) { focus.root.visible = false; if (this.modelRoot) this.modelRoot.visible = true; }
    try { this.renderer.render(this.scene, this.camera); }
    finally { if (focus) { focus.root.visible = true; this.applyUvFocusVisibility(); } }
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d')!;
    const s = Math.min(src.width, src.height);
    ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    this.requestRender(); // Restore selection/isolation after the clean icon capture.
    return out;
  }

  dispose() {
    this.clearUvFocus(false);
    this.uvFocusScene = null; this.projectionTriangles = null;
    this.vehicleRig?.dispose();
    this.projectionGuide?.remove();
    this.disposed = true;
    this.loadGeneration++;
    this.frameLoop?.dispose();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
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
    dom.removeEventListener('webglcontextrestored', this.onControlsChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.dispose();
    this.playerDisplay?.dispose(); this.playerDisplay = null;
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
    this.surfaceTextures?.dispose();
    this.ambientOcclusion?.dispose();
    this.exportColorPreview.dispose();
    for (const t of this.textures.values()) t.dispose();
    for (const state of this.illumination.values()) state.texture?.dispose();
    for (const { texture } of this.rmPacks.values()) texture.dispose();
    for (const canvas of this.wheelAppearanceCanvases.values()) canvas.width = canvas.height = 1;
    this.wheelAppearanceCanvases.clear(); this.wheelRoughnessSource = null;
    this.stadium?.dispose();
    this.studioEnvironment.dispose();
    this.studioRoot.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.loadingEl.remove();
  }
}
