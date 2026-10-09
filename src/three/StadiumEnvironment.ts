import * as THREE from 'three';
import { lightingPreset, type LightingMood } from '../previewEnvironment';
import { applyMoodSky, createMoodSky, type MoodSky } from './moodSky';

/** Local procedural test circuit: no remote assets, game files or per-frame cubemap capture. */
export class StadiumEnvironment {
  readonly root = new THREE.Group();
  private ground = new THREE.Group();
  private sky: MoodSky;
  private sun = new THREE.DirectionalLight();
  private ambient = new THREE.HemisphereLight();
  private lamps: THREE.SpotLight[] = [];
  private lampMaterial = new THREE.MeshStandardMaterial({ color: 0xc4d3dd, emissive: 0xc4e4ff });
  private environmentMaps = new Map<LightingMood, THREE.WebGLRenderTarget>();

  constructor() {
    this.root.name = 'skin-test-stadium';
    this.ground.name = 'simulation-ground';
    this.root.add(this.ground);
    this.sky = createMoodSky();
    this.root.add(this.sky);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: .5, far: 85 });
    this.sun.shadow.normalBias = .025;
    this.root.add(this.sun, this.sun.target, this.ambient);

    const asphalt = new THREE.MeshStandardMaterial({ color: 0x343b43, roughness: .88 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x42644c, roughness: 1 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x60717d, roughness: .85 });
    const seats = new THREE.MeshStandardMaterial({ color: 0x254b5c, roughness: .75 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe0e7e8, roughness: .65 });
    const red = new THREE.MeshStandardMaterial({ color: 0xab4d49, roughness: .65 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x768896, roughness: .4, metalness: .6 });
    const box = (size: [number, number, number], position: [number, number, number], material: THREE.Material, parent = this.root) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position); mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    box([120, .1, 120], [0, -.13, 0], grass, this.ground);
    box([11, .1, 110], [0, -.065, 0], asphalt, this.ground);
    for (const x of [-5.1, 5.1]) {
      box([.09, .012, 105], [x, -.009, 0], white, this.ground);
      for (let z = -52; z <= 52; z += 2) box([.65, .07, 2], [x * 1.09, -.02, z], z % 4 === 0 ? red : white, this.ground);
    }
    // Dashed markings leave the car on a clean central patch.
    for (let z = -49; z < 50; z += 7) if (Math.abs(z) > 5) box([.1, .012, 3], [0, -.009, z], white, this.ground);
    for (const side of [-1, 1]) {
      box([.4, .8, 95], [side * 9, .4, 0], concrete);
      for (let tier = 0; tier < 4; tier++) {
        box([1.5, .6, 90], [side * (13 + tier * 1.5), .3 + tier * .65, 0], concrete);
        box([1.1, .07, 90], [side * (13 + tier * 1.5), .63 + tier * .65, 0], seats);
      }
      box([9, .2, 94], [side * 15.5, 6, 0], metal);
      for (const z of [-32, -12, 12, 32]) {
        box([.16, 6, .16], [side * 19, 3, z], metal);
        box([.15, 10, .15], [side * 8.3, 5, z], metal);
        box([1.8, .25, .55], [side * 8.3, 10, z], this.lampMaterial);
      }
    }
    // Two non-shadowed floodlights keep night readable on mobile without eight shadow passes.
    for (const x of [-8, 8]) {
      const lamp = new THREE.SpotLight(0xc4e4ff, 0, 45, Math.PI / 3, .7, 2);
      lamp.position.set(x, 10, x > 0 ? -8 : 8); lamp.target.position.set(0, 0, 0);
      this.root.add(lamp, lamp.target); this.lamps.push(lamp);
    }
    this.setMood('day');
  }

  setMood(mood: LightingMood) {
    const preset = lightingPreset(mood);
    applyMoodSky(this.sky, preset);
    this.sun.color.setHex(preset.sunColor); this.sun.position.set(...preset.sunPosition); this.sun.intensity = preset.sunIntensity;
    this.ambient.color.setHex(preset.sky); this.ambient.groundColor.setHex(0x555b46); this.ambient.intensity = preset.ambientIntensity;
    for (const lamp of this.lamps) lamp.intensity = preset.floodlights ? 190 : 0;
    this.lampMaterial.emissiveIntensity = preset.floodlights ? 4 : 0;
  }

  setGroundVisible(visible: boolean) { this.ground.visible = visible; }

  environmentMap(renderer: THREE.WebGLRenderer, mood: LightingMood): THREE.Texture {
    const cached = this.environmentMaps.get(mood);
    if (cached) return cached.texture;
    this.setMood(mood);
    const scene = new THREE.Scene();
    const capture = this.root.clone(true);
    // Reflections retain the road even when its visible geometry is hidden for editing.
    capture.getObjectByName(this.ground.name)!.visible = true;
    // Reflections need no shadow pass: avoid allocating shadow maps on temporary lights.
    capture.traverse((object) => { object.castShadow = false; object.receiveShadow = false; });
    scene.add(capture);
    const generator = new THREE.PMREMGenerator(renderer);
    try {
      const target = generator.fromScene(scene, .04, .1, 150, { size: 128, position: new THREE.Vector3(0, 1, 0) });
      this.environmentMaps.set(mood, target);
      return target.texture;
    } finally { generator.dispose(); }
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const target of this.environmentMaps.values()) target.dispose();
    this.environmentMaps.clear(); this.sun.dispose(); this.root.removeFromParent();
  }
}
