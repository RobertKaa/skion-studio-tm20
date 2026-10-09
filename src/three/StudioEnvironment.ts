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

  dispose() {
    this.reflectionScene.dispose(); this.environmentTarget?.dispose();
    this.environmentTarget = null; this.sun.dispose(); this.root.removeFromParent();
  }
}
