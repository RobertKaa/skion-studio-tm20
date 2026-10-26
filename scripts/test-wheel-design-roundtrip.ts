import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Canvas, FabricImage, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { EditorCore } from '../src/editor/EditorCore';
import { MAPS, type MapId } from '../src/maps';
import { createBaseSkinProject } from '../src/baseSkin';
import { readProjectFile, validateProjectDocument, writeProjectFile } from '../src/projectFile';
import { createWheelDesignDefinition, DEFAULT_WHEEL_DESIGN } from '../src/wheelDesign';
import { loadMaterialSources, renderMaterialLayer } from '../src/materials/render';
import type { MaterialLayer } from '../src/materials/types';
import { previewMeshMaterialSlot } from '../src/three/materialSlots';
import type { ProjectionTriangle } from '../src/three/decalProjection';
import { WHEEL_PART_GUIDES } from '../src/wheelParts';

setEnv(getEnv());
const env = getEnv();
Object.assign(globalThis, { document: env.document, window: env.window, HTMLElement: env.window.HTMLElement,
  HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement });
const originalLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
const raw = readFileSync('public/models/car/StadiumCAR2020_OffsetFix.fbx');
let model: THREE.Group;
try { model = new FBXLoader().parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), ''); }
finally { THREE.TextureLoader.prototype.load = originalLoad; }
model.updateMatrixWorld(true);
const geometry: ProjectionTriangle[] = [];
model.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  if (previewMeshMaterialSlot(material.name, object.name) !== 'wheels') return;
  const positions = object.geometry.getAttribute('position'), uv = object.geometry.getAttribute('uv'), index = object.geometry.index;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const ids = [0, 1, 2].map(corner => index?.getX(i + corner) ?? i + corner);
    geometry.push({ family: 'wheels',
      points: ids.map(id => new THREE.Vector3().fromBufferAttribute(positions, id).applyMatrix4(object.matrixWorld).toArray()) as ProjectionTriangle['points'],
      uv: ids.map(id => [uv.getX(id), uv.getY(id)]) as ProjectionTriangle['uv'] });
  }
});
assert(geometry.length > 1000, 'The integration fixture uses the real wheel geometry');
const definition = createWheelDesignDefinition({ ...DEFAULT_WHEEL_DESIGN, pattern: 'checker', color: '#e95f27' });
const region = WHEEL_PART_GUIDES.find(part => part.key === 'tyres:outer')!;
const layer: MaterialLayer = { definition, family: 'wheels', regions: [{ key: region.key, label: region.label, polygons: region.polygons }], exclusions: [] };
await loadMaterialSources(definition);
const rendered = renderMaterialLayer(layer, 256, geometry);
const color = rendered.get('color')!.getContext('2d')!.getImageData(0, 0, 256, 256).data;
let painted = 0, holes = 0;
for (const [channel, image] of rendered) {
  const pixels = image.getContext('2d')!.getImageData(0, 0, 256, 256).data;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const alpha = pixels[(y * 256 + x) * 4 + 3];
    if (x < Math.floor(region.polygons[0][0].x * 256)) assert.equal(alpha, 0, `${channel}: only the chosen outer sidewall changes`);
    if (color[(y * 256 + x) * 4 + 3] === 0) { holes++; assert(alpha <= 1, `${channel}: clear motif pixels preserve the underlying finish`); }
    if (channel === 'color' && alpha > 240) painted++;
  }
  image.width = image.height = 1;
}
assert(painted > 100 && holes > 1000, 'The projected motif has visible marks and truly transparent gaps');

type Owner = FabricImage & { id: string; materialLayer?: MaterialLayer; linkedImageId?: string; imageOrder?: number };
const states = new Map(MAPS.map(map => {
  const canvas = new Canvas(undefined, { width: map.workRes, height: map.workRes, backgroundColor: '#123456', renderOnAddRemove: false, enableRetinaScaling: false });
  const textureEl = document.createElement('canvas'); textureEl.width = textureEl.height = 1;
  return [map.id, { canvas, el: canvas.lowerCanvasEl, textureEl, suspendHistory: false, textureDirty: true, baseline: '', undo: [] as string[], redo: [] as string[], coalesceKey: null }];
}));
const core = Object.create(EditorCore.prototype) as EditorCore;
Object.assign(core, { maps: states, activeMap: 'Wheels_B', tool: 'select', blenderParts: [], listeners: new Map(), objectUrls: [],
  speedLightColor: '#ffffff', illumToolRole: 'head', materialGeometry: () => geometry, projectionSources: new Map(), projectionBakes: new Map(),
  materialBakes: new Map(), materialSurfaces: [], materialInteractive: false, materialUpdateSequence: 0, textureResolution: 1024,
  illumRoles: new Map(), importedRoleMasks: new WeakMap(), previewDirty: new Set(), previewUpdates: new Set(),
  flushTexture: () => {}, isPanning: () => false, setActiveMap: (id: MapId) => { core.activeMap = id; } });
for (const map of MAPS) (core as unknown as { wireCanvas(id: MapId, state: unknown): void }).wireCanvas(map.id, states.get(map.id)!);
for (const map of MAPS) core.resetMapBaseline(map.id);
const owners = () => states.get('Wheels_B')!.canvas.getObjects().filter(object => (object as Owner).materialLayer) as Owner[];
const blobBytes = async (blob: Blob) => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new env.window.FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
};
try {
  await core.addMaterialLayer(definition, ['tyres:outer']);
  const owner = owners()[0], id = owner.id, order = owner.imageOrder;
  assert.deepEqual(owner.materialLayer!.definition.wheelDesign, definition.wheelDesign);
  assert.equal(owners().length, 1);
  await core.undo(); assert.equal(owners().length, 0, 'One undo removes the motif and generated channels');
  await core.redo(); assert.equal(owners()[0].id, id, 'Redo retains the same editable owner');
  const updated = createWheelDesignDefinition({ ...DEFAULT_WHEEL_DESIGN, pattern: 'lettering', text: 'TEST MOTORSPORT', angle: 17.5 });
  const historyBeforeEdit = states.get('Wheels_B')!.undo.length;
  await core.updateMaterialLayerDefinition(id, updated);
  core.setSelectionMaterialMask(['tyres:outer', 'tyres:inner'], [], 'material-definition');
  core.commitMaterialLayers(); core.endHistoryCoalescing();
  assert.equal(states.get('Wheels_B')!.undo.length, historyBeforeEdit + 1, 'Changing design and target creates one undo gesture');
  assert.equal(owners()[0].id, id); assert.equal(owners()[0].imageOrder, order);
  assert.deepEqual(owners()[0].materialLayer!.regions.map(region => region.key), ['tyres:outer', 'tyres:inner']);
  assert.equal(owners()[0].materialLayer!.definition.wheelDesign!.angle, 17.5);
  await core.undo(); assert.equal(owners()[0].materialLayer!.definition.wheelDesign!.pattern, 'checker', 'An edit is reversible without replacing the owner');
  assert.deepEqual(owners()[0].materialLayer!.regions.map(region => region.key), ['tyres:outer'], 'One undo restores both original design and application target');
  await core.redo(); assert.equal(owners()[0].materialLayer!.definition.wheelDesign!.pattern, 'lettering');

  const captured = await core.captureProject(), bundle = createBaseSkinProject({ position: [3, 2, 4], target: [0, .5, 0] });
  bundle.document.editor = { maps: captured.maps, speedColor: captured.speedColor, illumRole: captured.illumRole };
  for (const [path, blob] of captured.assets) bundle.assets.set(path, await blobBytes(blob));
  const reopened = await readProjectFile(await writeProjectFile(bundle));
  const saved = ((reopened.document.editor.maps.Wheels_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!.materialLayer as MaterialLayer);
  assert.deepEqual(saved.definition.wheelDesign, updated.wheelDesign, 'All precision and lettering settings survive the real project ZIP');
  const png = bundle.assets.get(saved.definition.textures.color!.src)!;
  assert.equal(Buffer.from(png).readUInt32BE(16), 1024, 'The project archives the original motif source, not its bake');
  const hydrated = structuredClone(reopened.document.editor.maps);
  const hydrate = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(hydrate); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.src === 'string') record.src = `data:image/png;base64,${Buffer.from(reopened.assets.get(record.src)!).toString('base64')}`;
    Object.values(record).forEach(hydrate);
  };
  hydrate(hydrated);
  await core.loadProject(hydrated, { speedColor: captured.speedColor, illumRole: captured.illumRole, textureResolution: 1024 });
  assert.equal(owners()[0].id, id); assert.deepEqual(owners()[0].materialLayer!.definition.wheelDesign, updated.wheelDesign);
  assert.deepEqual(owners()[0].materialLayer!.regions.map(region => region.key), ['tyres:outer', 'tyres:inner']);
  const unsafe = structuredClone(reopened.document);
  const unsafeOwner = (unsafe.editor.maps.Wheels_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!;
  (unsafeOwner.materialLayer as MaterialLayer).definition.wheelDesign!.text = 'EVIL\u202eTEXT';
  assert.throws(() => validateProjectDocument(unsafe, new Set(reopened.assets.keys())), /matériau/);
  console.log('✓ Wheel motif integration: real FBX, transparent PBR mask, outer-sidewall isolation, stable owner/Undo, original PNG project ZIP and editable restored metadata');
} finally {
  core.commitMaterialLayers();
  for (const state of states.values()) { await state.canvas.dispose(); state.textureEl.width = state.textureEl.height = 0; }
}
