import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEnv } from 'fabric/node';
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Scene } from 'three';
import { CarPreview } from '../src/three/CarPreview';

// Use the actual official FBX and model replacement code, without a WebGL renderer.
Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const bytes = readFileSync(new URL('../public/models/car/StadiumCAR2020_OffsetFix.fbx', import.meta.url));
const official = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const carRoot = new Group(); const custom = new Group(); custom.name = 'Voiture custom';
const hat = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); hat.name = 'Chapeau'; custom.add(hat); carRoot.add(custom);
let disposed = false; hat.geometry.addEventListener('dispose', () => { disposed = true; });
let requests = 0; let ready = 0; let error = '';
const preview = Object.create(CarPreview.prototype) as CarPreview;
Object.assign(preview, {
  disposed: false, loadGeneration: 0, officialModelBuffer: null, carRoot, modelRoot: custom,
  importedMaterials: [hat.material], scene: new Scene(), vehicleRig: null, pendingView: null,
  renderer: { capabilities: { getMaxAnisotropy: () => 1 } }, playerDisplay: null,
  controls: {}, skinMat: new MeshPhysicalMaterial(), detailsMat: new MeshStandardMaterial(),
  wheelsMat: new MeshStandardMaterial(), glassMat: new MeshPhysicalMaterial(),
  surfaceTextures: { setSkinNormalEnabled: () => {}, setOfficialModel: () => {},setAtlasSource:()=>{} },
  ambientOcclusion: { setOfficialModel: () => {},setAtlasSource:()=>{} }, illumination: new Map(), coatIntensity: 1,
  fetchModelBuffer: async () => { requests++; return official; },
  applyHomeFraming: () => {}, hideLoadingOverlay: () => {},
  showLoadingError: (detail: string) => { error = detail; }, onModelReady: () => { ready++; },
});
await preview.loadOfficialModel();
assert.equal(carRoot.children.length, 1, 'Exactly one base vehicle replaces the custom model');
assert.equal(custom.parent, null);
assert.equal(carRoot.getObjectByName('Chapeau'), undefined, 'Reset removes the actual hat geometry');
assert(disposed, 'Old custom geometry is disposed');
assert.equal(ready, 1);
assert.equal(requests, 1);
let meshes = 0; carRoot.traverse((object) => { if (object instanceof Mesh) meshes++; });
assert(meshes > 0, 'The real official FBX loads successfully');
assert(!JSON.stringify(carRoot.toJSON()).toLowerCase().includes('chapeau'));
const firstDisplay = carRoot.getObjectByName('Player display — preview only');
assert(firstDisplay, 'Reset restores the fixed gameplay display on the official body');

Object.assign(preview, { fetchModelBuffer: async () => { throw new Error('Serveur indisponible'); } });
await preview.loadOfficialModel();
assert.equal(requests, 1, 'The pristine base remains available after a network interruption');
assert.equal(carRoot.children.length, 1, 'Repeated resets do not accumulate model roots');
assert.equal(ready, 2);
assert.equal(firstDisplay.parent, null, 'The previous gameplay display is detached before restoring the model');
let displays = 0; carRoot.traverse((object) => { if (object.userData.previewOnly) displays++; });
assert.equal(displays, 1, 'Repeated resets do not accumulate gameplay displays');

const baseRoot = carRoot.children[0]; const report = console.error;
console.error = () => {};
try {
  Object.assign(preview, { officialModelBuffer: null });
  await assert.rejects(preview.loadOfficialModel(), /Serveur indisponible/, 'A failed model load must reject instead of falsely confirming reset');
  assert.equal(carRoot.children[0], baseRoot, 'A fetch failure leaves the current model intact');
  assert.equal(error, 'Serveur indisponible');
  Object.assign(preview, { fetchModelBuffer: async () => official, parseModel: async () => new Group() });
  await assert.rejects(preview.loadOfficialModel(), /aucun maillage/, 'An empty model cannot be treated as a successful reset');
  assert.equal(carRoot.children[0], baseRoot);
  Object.assign(preview, { parseModel: async () => { (preview as unknown as { loadGeneration: number }).loadGeneration++; return new Group(); } });
  await assert.rejects(preview.loadOfficialModel(), /interrompu/, 'A superseded load cannot claim the requested base model was installed');
} finally { console.error = report; }
console.log('ok remise à zéro du modèle : FBX officiel réel, suppression du chapeau, répétition, base en cache, erreurs et interruptions signalées');
