import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STUDIO_LIGHTING } from '../previewEnvironment';

/** Neutral workshop lighting and softbox reflections, independent of the simulation. */
export class StudioEnvironment {
  readonly root = new THREE.Group();
  readonly reflectionScene = new RoomEnvironment();
  private sun = new THREE.DirectionalLight();
  private ambient = new THREE.HemisphereLight();
  private environmentTarget: THREE.WebGLRenderTarget | null = null;
  private tyreDetail = false;

  constructor() {
    this.root.name = 'studio-neutral-lighting';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: .5, far: 85 });
    this.sun.shadow.normalBias = .025;
    this.root.add(this.sun, this.sun.target, this.ambient);
    this.sun.position.set(...STUDIO_LIGHTING.sunPosition);
    this.sun.color.setHex(STUDIO_LIGHTING.sunColor);
    this.sun.intensity = STUDIO_LIGHTING.sunIntensity;
    this.ambient.color.setHex(STUDIO_LIGHTING.sky);
    this.ambient.groundColor.setHex(STUDIO_LIGHTING.ground);
    this.ambient.intensity = STUDIO_LIGHTING.ambientIntensity;
  }

  environmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
    if (this.environmentTarget) return this.environmentTarget.texture;
    const generator = new THREE.PMREMGenerator(renderer);
    try {
      this.environmentTarget = generator.fromScene(this.reflectionScene, .04);
      return this.environmentTarget.texture;
    } finally { generator.dispose(); }
  }

  /** Millimetre-scale lugs need a shadow texel and bias smaller than their grooves. */
  setTyreDetail(enabled: boolean) {
    if (enabled === this.tyreDetail) return;
    this.tyreDetail = enabled;
    this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    this.sun.shadow.mapSize.set(enabled ? 4096 : 2048, enabled ? 4096 : 2048);
    const extent = enabled ? 4 : 6;
    Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = enabled ? .001 : .025;
    this.sun.shadow.bias = enabled ? -.00001 : 0;
    this.sun.shadow.needsUpdate = true;
  }

  dispose() {
    this.reflectionScene.dispose(); this.environmentTarget?.dispose();
    this.environmentTarget = null; this.sun.dispose(); this.root.removeFromParent();
  }
}
