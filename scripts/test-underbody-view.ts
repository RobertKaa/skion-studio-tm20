import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEnv } from 'fabric/node';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CarPreview, type PaintFamily } from '../src/three/CarPreview';
import { StadiumEnvironment } from '../src/three/StadiumEnvironment';
import type { SurfaceAnchor } from '../src/three/decalProjection';

Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const stage = document.createElement('canvas'); stage.width = stage.height = 640;
stage.getBoundingClientRect = () => ({ left: 0, top: 0, right: 640, bottom: 640, width: 640, height: 640, x: 0, y: 0, toJSON: () => ({}) });
const camera = new THREE.PerspectiveCamera(45, 1, .02, 200);
camera.position.set(5, 3, 6);
const controls = new OrbitControls(camera, stage);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI - .005;
const carRoot = new THREE.Group(); const studioRoot = new THREE.Group();
const stadium = new StadiumEnvironment();
const bytes = readFileSync(new URL('../public/models/car/StadiumCAR2020_OffsetFix.fbx', import.meta.url));
const official = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const preview = Object.create(CarPreview.prototype) as CarPreview;
Object.assign(preview, {
  disposed: false, loadGeneration: 0, officialModelBuffer: official, carRoot, modelRoot: null,
  scene: new THREE.Scene(), studioRoot, stadium, previewEnvironment: { venue: 'studio', mood: 'day' },
  camera, controls, importedMaterials: [], vehicleRig: null, pendingView: null,
  skinMat: new THREE.MeshPhysicalMaterial(), detailsMat: new THREE.MeshStandardMaterial(),
  wheelsMat: new THREE.MeshStandardMaterial(), glassMat: new THREE.MeshPhysicalMaterial(),
  surfaceTextures: { setSkinNormalEnabled: () => {}, setOfficialModel: () => {},setAtlasSource:()=>{} },
  ambientOcclusion: { setOfficialModel: () => {},setAtlasSource:()=>{} }, illumination: new Map(), coatIntensity: 1,
  hideLoadingOverlay: () => {}, showLoadingError: (error: string) => { throw new Error(error); },
  renderer: { domElement: stage, capabilities: { getMaxAnisotropy: () => 1 }, render: () => { assert.equal(studioRoot.visible, camera.position.y >= .02); } },
  raycaster: new THREE.Raycaster(), pointerNdc: new THREE.Vector2(),
});
type Hit = { family: PaintFamily; u: number; v: number; anchor: SurfaceAnchor };
const editor = preview as unknown as { pickAt: (event: PointerEvent) => Hit | null; handlePointerDown: (event: PointerEvent) => void; carBounds: THREE.Box3; userNavigated: boolean };
try {
  await preview.loadOfficialModel();
  carRoot.updateMatrixWorld(true);
  carRoot.traverse((item) => { if (item instanceof THREE.Mesh) item.geometry.computeBoundingSphere(); });
  assert(camera.position.y > 0); assert.equal(studioRoot.visible, true);
  const geometryBefore = carRoot.toJSON();
  preview.viewUnderbody();
  camera.updateMatrixWorld();
  assert(camera.position.y < editor.carBounds.min.y, 'The camera really moves under the vehicle');
  assert(controls.getPolarAngle() > Math.PI / 2, 'OrbitControls does not clamp the underside view back to the horizon');
  assert.equal(studioRoot.visible, false, 'The studio floor and grid no longer hide the chassis');
  assert.equal(stadium.root.getObjectByName('simulation-ground')!.visible, false, 'Simulation floor visibility follows the camera too');
  assert.equal(editor.userNavigated, true, 'Resizing the editor must preserve the chosen underside view');
  const below = preview.getViewState();
  assert.deepEqual(carRoot.toJSON(), geometryBefore, 'Camera navigation never moves or edits the model');

  let target: { event: PointerEvent; hit: Hit } | undefined;
  for (let y = 160; y <= 480 && !target; y += 20) for (let x = 160; x <= 480 && !target; x += 20) {
    const event = { clientX: x, clientY: y, button: 0, preventDefault: () => {} } as PointerEvent;
    const hit = editor.pickAt(event);
    if (hit && hit.family !== 'wheels' && hit.anchor.normal[1] < -.5) target = { event, hit };
  }
  assert(target, 'The real official FBX has a visible, UV-mapped body surface accessible from below');
  assert(Number.isFinite(target.hit.u) && Number.isFinite(target.hit.v));
  let placed: Hit | undefined;
  Object.assign(preview, { edit3dEnabled: true, interaction: 'place', imageHandler: {
    place: (family: PaintFamily, u: number, v: number, anchor: SurfaceAnchor) => { placed = { family, u, v, anchor }; },
  } });
  editor.handlePointerDown(target.event);
  assert.deepEqual(placed, target.hit, 'Clicking the underside reaches the same image-placement handler used by the app');
  const anchor = preview.projectionAnchorFromView(target.hit.anchor.point);
  assert(anchor.normal[1] < -.9, 'The image faces down from the chassis, towards the camera');
  const projected = preview.projectImage({ source: 'test-image', center: anchor.point, normal: anchor.normal, tangent: anchor.tangent,
    width: .6, height: .6, depth: .2, angle: 0, families: [target.hit.family] }, { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) });
  const body = projected.get(target.hit.family);
  assert(body && body.data.some((value, index) => index % 4 === 3 && value > 0), 'The actual image projector paints UV pixels on the underside');
  assert.equal(body.width, 2048, 'Editing underneath keeps the native texture precision');
  assert.deepEqual(carRoot.toJSON(), geometryBefore);

  preview.snapshot(64);
  preview.resetCamera();
  assert(camera.position.y > 0); assert.equal(studioRoot.visible, true);
  assert.equal(stadium.root.getObjectByName('simulation-ground')!.visible, true, 'Ground returns when recentering above the car');
  preview.restoreViewState(below);
  assert(camera.position.y < 0); assert.equal(studioRoot.visible, false, 'Saved views from underneath restore correctly');
  for (const aspect of [.6, 1, 2.2]) {
    camera.aspect = aspect; camera.updateProjectionMatrix(); preview.viewUnderbody(); camera.updateMatrixWorld();
    const box = editor.carBounds;
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      assert(Math.abs(corner.x) <= .93 && Math.abs(corner.y) <= .93, 'The whole model fits the underside framing at different scene proportions');
    }
  }

  const lights = stadium.root.children.filter((item) => item instanceof THREE.Light);
  for (const mood of ['sunrise', 'day', 'sunset', 'night'] as const) {
    stadium.setMood(mood);
    const lighting = lights.map((item) => (item as THREE.Light).intensity);
    stadium.setGroundVisible(false); stadium.setGroundVisible(true);
    assert.deepEqual(lights.map((item) => (item as THREE.Light).intensity), lighting, 'Hiding the road does not change any lighting mode');
  }
} finally {
  controls.dispose(); stadium.dispose();
  (preview as unknown as { vehicleRig?: { dispose: () => void } }).vehicleRig?.dispose();
  const geometries = new Set<THREE.BufferGeometry>();
  carRoot.traverse((item) => { if (item instanceof THREE.Mesh) geometries.add(item.geometry); });
  for (const geometry of geometries) geometry.dispose();
}
console.log('✓ Dessous : vrai modèle FBX, caméra libre, cadrage, sols Studio/Simulation, clic et projection d’image 2048, vue sauvegardée et éclairages préservés');
