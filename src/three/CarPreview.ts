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
import type { MapId } from '../maps';

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
  private carRoot = new THREE.Group();
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
  private painting3d = false;
  private lockedFamily: PaintFamily | null = null;
  private paintHandler: Paint3DHandler | null = null;
  private onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);

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
    this.scene.background = new THREE.Color(0x15181d);
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

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointerleave', this.onPointerUp);

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
      roughness: 1,
      metalness: 1,
      // Vernis (Skin_CoatR) : couche de clearcoat modulée par la map.
      clearcoat: this.coatIntensity,
      clearcoatRoughness: 0.08,
    });
    this.detailsMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.35,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.wheelsMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.1,
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

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private async loadCarModel() {
    const generation = ++this.loadGeneration;

    try {
      const buffer = await this.fetchModelBuffer(CAR_MODEL_URL);
      if (this.disposed || generation !== this.loadGeneration) return;

      const loader = new FBXLoader();
      loader.setResourcePath(CAR_MODEL_RESOURCE_PATH);
      const model = loader.parse(buffer, CAR_MODEL_RESOURCE_PATH);

      if (this.disposed || generation !== this.loadGeneration) return;

      model.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const origMats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of origMats) {
          if (m && !this.importedMaterials.includes(m)) this.importedMaterials.push(m);
        }

        const slot = slotFromObject(obj);
        obj.material = this.materialForSlot(slot);
        obj.castShadow = true;
        obj.receiveShadow = true;
      });

      const span = fitModelToGround(model);
      this.carRoot.add(model);

      const targetY = span * 0.32;
      this.controls.target.set(0, targetY, 0);
      // Plage de zoom élargie : très proche pour inspecter le détail, un peu
      // plus loin pour la vue d'ensemble.
      this.controls.minDistance = span * 0.12;
      this.controls.maxDistance = span * 6;
      this.camera.position.set(span * 1.35, span * 0.75, span * 1.65);
      this.controls.update();

      this.hideLoadingOverlay();
    } catch (err) {
      if (this.disposed || generation !== this.loadGeneration) return;
      const message = err instanceof Error ? err.message : 'erreur inconnue';
      console.error('[CarPreview] Échec du chargement du modèle FBX :', err);
      this.showLoadingError(message);
    }
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
    this.loading = false;
    this.loadingEl.remove();
  }

  /**
   * Déplace le rendu 3D (canvas WebGL + overlay) vers un nouveau conteneur DOM,
   * par ex. pour passer de l'aperçu compact à la grande vue « Édition 3D ».
   * Ré-observe le redimensionnement et resynchronise immédiatement la taille.
   */
  mount(container: HTMLElement) {
    if (this.disposed || container === this.container) {
      this.resize();
      return;
    }
    this.container = container;
    container.appendChild(this.renderer.domElement);
    if (this.loading) container.appendChild(this.loadingEl);
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(container);
    this.resize();
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Branche/rafraîchit un canvas source comme texture d'une map. */
  setMapCanvas(id: MapId, source: HTMLCanvasElement) {
    // Les maps _R sont repackées séparément (canaux R/G → G/B).
    if (id === 'Skin_R' || id === 'Details_R' || id === 'Wheels_R') {
      this.updateRoughnessPack(id, source);
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
      } else if (id === 'Details_I') {
        // Auto-illumination : la couleur peinte devient l'émission.
        tex.colorSpace = THREE.SRGBColorSpace;
        this.detailsMat.emissiveMap = tex;
        this.applyEmissive();
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

  /** Applique l'intensité d'émission des détails (boostée au freinage). */
  private applyEmissive() {
    this.detailsMat.emissiveIntensity = this.emissiveIntensity * (this.braking ? 2.4 : 1);
    this.detailsMat.needsUpdate = true;
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

  /** Simule le freinage : booste l'émission des zones lumineuses. */
  setBraking(on: boolean) {
    this.braking = on;
    this.applyEmissive();
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
    this.edit3dEnabled = on;
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
    // Clic gauche : désactivé pour l'orbite (réservé à la peinture) ; clic droit
    // et molette continuent de tourner / zoomer.
    const buttons = this.controls.mouseButtons as {
      LEFT: THREE.MOUSE | null;
      MIDDLE: THREE.MOUSE | null;
      RIGHT: THREE.MOUSE | null;
    };
    buttons.LEFT = on ? null : THREE.MOUSE.ROTATE;
    buttons.RIGHT = on ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    if (!on && this.painting3d) {
      this.painting3d = false;
      this.lockedFamily = null;
      this.paintHandler?.end();
    }
  }

  /** Renvoie la famille de map + les UV du premier mesh peignable sous le pointeur. */
  private pickAt(e: PointerEvent): { family: PaintFamily; u: number; v: number } | null {
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
      const slot = slotFromObject(hit.object);
      if (slot === 'glass') continue; // le verre est transparent : on peint dessous
      const family: PaintFamily =
        slot === 'wheels' ? 'wheels' : slot === 'details' ? 'details' : 'skin';
      return { family, u: hit.uv.x, v: hit.uv.y };
    }
    return null;
  }

  private handlePointerDown(e: PointerEvent) {
    if (!this.edit3dEnabled || e.button !== 0 || !this.paintHandler) return;
    const hit = this.pickAt(e);
    if (!hit) return;
    this.painting3d = true;
    this.lockedFamily = hit.family;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.paintHandler.begin(hit.family, hit.u, hit.v);
    e.preventDefault();
  }

  private handlePointerMove(e: PointerEvent) {
    if (!this.painting3d || !this.paintHandler) return;
    const hit = this.pickAt(e);
    // On reste sur la même famille que le début du trait pour éviter de sauter
    // d'un îlot UV à l'autre en glissant sur une autre pièce.
    if (hit && hit.family === this.lockedFamily) {
      this.paintHandler.move(hit.family, hit.u, hit.v);
    }
  }

  private handlePointerUp(e: PointerEvent) {
    if (!this.painting3d) return;
    this.painting3d = false;
    this.lockedFamily = null;
    this.paintHandler?.end();
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
    this.disposed = true;
    this.loadGeneration++;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointerleave', this.onPointerUp);
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
    for (const { texture } of this.rmPacks.values()) texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.loadingEl.remove();
  }
}
