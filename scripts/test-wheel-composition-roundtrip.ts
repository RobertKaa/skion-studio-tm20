import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Canvas, FabricImage, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { EditorCore } from '../src/editor/EditorCore';
import { MAPS, type MapId } from '../src/maps';
import { createBaseSkinProject } from '../src/baseSkin';
import { hydrateProject, readProjectFile, validateProjectDocument, writeProjectFile } from '../src/projectFile';
import { DEFAULT_WHEEL_DESIGN, createWheelDesignDefinition } from '../src/wheelDesign';
import { createWheelArtworkDefinition, isValidWheelArtwork, type WheelDesignComposition } from '../src/wheelDesignComposition';
import { exportMaterialPack, importMaterialFilesDetailed } from '../src/materials/import';
import { getMaterialSourceCanvas, loadMaterialSources, renderMaterialLayer } from '../src/materials/render';
import { isValidMaterialDefinition, type MaterialLayer } from '../src/materials/types';
import { previewMeshMaterialSlot } from '../src/three/materialSlots';
import type { ProjectionTriangle } from '../src/three/decalProjection';
import { WHEEL_PART_GUIDES } from '../src/wheelParts';
import { decodeIllumCodes, type IllumCodes } from '../src/illumination';

setEnv(getEnv());
const env = getEnv();
Object.assign(globalThis, { document: env.document, window: env.window, HTMLElement: env.window.HTMLElement,
  HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement });
const logoCanvas = document.createElement('canvas'); logoCanvas.width = logoCanvas.height = 256;
const logoContext = logoCanvas.getContext('2d')!, logoPixels = logoContext.createImageData(256, 256);
let noise = 0x12345678;
for (let i = 0; i < logoPixels.data.length; i += 4) {
  for (let c = 0; c < 3; c++) { noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5; logoPixels.data[i + c] = noise >>> 24; }
  logoPixels.data[i + 3] = 255;
}
logoContext.putImageData(logoPixels, 0, 0);
const logo = logoCanvas.toDataURL('image/png'); logoCanvas.width = logoCanvas.height = 1;
assert(logo.length > 256 * 1024 && logo.length < 400_000, 'A real detailed logo exercises the previous project and pack limits');
const composition: WheelDesignComposition = { version: 2, elements: [
  { id: 'orange-ring', name: 'Filet orange', visible: true, locked: false, opacity: 1, emission: 1, emissionRole: 'brake',
    design: { ...DEFAULT_WHEEL_DESIGN, pattern: 'ring', color: '#ed6a34', radius: .93, width: .025 } },
  { id: 'mint-markers', name: 'Repères menthe', visible: true, locked: true, opacity: 1, emission: .8, emissionRole: 'always',
    design: { ...DEFAULT_WHEEL_DESIGN, pattern: 'segments', color: '#83ead0', radius: .67, width: .024, count: 24 } },
  { id: 'signature', name: 'Signature de course', visible: true, locked: false, opacity: 1,
    design: { ...DEFAULT_WHEEL_DESIGN, pattern: 'lettering', color: '#ffffff', radius: .83, width: .09,
      text: 'GARAGE 27', angle: 0, arc: 135, font: 'condensed', tracking: .08 } },
  { id: 'logo', name: 'Logo personnel', visible: true, locked: false, opacity: .85,
    design: { ...DEFAULT_WHEEL_DESIGN, pattern: 'image', radius: .80, width: .12, angle: 180,
      repetitions: 2, rotation: 0, imageData: logo } },
] };
assert(isValidWheelArtwork(composition));
const captured = structuredClone(composition), pending = createWheelArtworkDefinition(composition);
composition.elements[0].design.color = '#000000';
const definition = await pending;
assert.deepEqual(definition.wheelDesign, captured, 'Async application captures all nested settings before decoding logos');
assert.notEqual(definition.wheelDesign, composition);
definition.name = 'Ma signature personnelle'; definition.roughness = 73; definition.metalness = 29; definition.coat = 42;
definition.opacity = .91; definition.emissionColor = '#4ad3ed'; definition.emissionStrength = .25;
assert(isValidMaterialDefinition(definition));
assert(!isValidMaterialDefinition({ ...definition, transform: { ...definition.transform, projection: 'uv' } }), 'A composition keeps its circular sidewall projection');
assert(isValidMaterialDefinition(createWheelDesignDefinition({ ...DEFAULT_WHEEL_DESIGN })), 'Historical single motifs remain valid');

await loadMaterialSources(definition);
const source = getMaterialSourceCanvas(definition.textures.color!.src)!;
const rgba = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
let orange = 0, mint = 0;
for (let i = 0; i < rgba.length; i += 4) {
  if (rgba[i + 3] === 255 && rgba[i] === 237 && rgba[i + 1] === 106 && rgba[i + 2] === 52) orange++;
  if (rgba[i + 3] === 255 && rgba[i] === 131 && rgba[i + 1] === 234 && rgba[i + 2] === 208) mint++;
}
assert(orange > 100 && mint > 100, 'The actual material PNG preserves two independent exact pigments');
assert.equal(source.getContext('2d')!.getImageData(512, 512, 1, 1).data[3], 0, 'The wheel centre remains transparent');

const pack = await exportMaterialPack(definition), packZip = await JSZip.loadAsync(await pack.arrayBuffer());
const packManifest = await packZip.file('material.json')!.async('string');
assert(new TextEncoder().encode(packManifest).length > 256 * 1024, 'A detailed editable logo needs the new bounded pack capacity');
const imported = await importMaterialFilesDetailed([new File([await pack.arrayBuffer()], 'Composition.zip', { type: 'application/zip' })]);
assert.deepEqual(imported.definition.wheelDesign, captured, 'The real material pack reopens every element and the original logo');
assert.equal(imported.definition.textures.color!.src, definition.textures.color!.src);
const rejectPack = async (change: (manifest: Record<string, unknown>) => void) => {
  const zip = await JSZip.loadAsync(await pack.arrayBuffer()), manifest = JSON.parse(packManifest) as Record<string, unknown>;
  change(manifest); zip.file('material.json', JSON.stringify(manifest));
  const bytes = await zip.generateAsync({ type: 'arraybuffer' });
  await assert.rejects(() => importMaterialFilesDetailed([new File([bytes], 'Unsafe.zip', { type: 'application/zip' })]), /manifeste|invalide/);
};
await rejectPack(manifest => { (manifest.material as Record<string, unknown>).color = ['#ffffff']; });
await rejectPack(manifest => {
  const material = manifest.material as { wheelDesign: WheelDesignComposition };
  Object.defineProperty(material.wheelDesign.elements[0].design, '__proto__', { value: { polluted: true }, enumerable: true });
});
assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Forbidden properties inside elements cannot pollute prototypes');

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
const region = WHEEL_PART_GUIDES.find(part => part.key === 'tyres:outer')!;
const materialLayer: MaterialLayer = { definition, family: 'wheels', regions: [{ key: region.key, label: region.label, polygons: region.polygons }], exclusions: [] };
const rendered = renderMaterialLayer(materialLayer, 256, geometry), alpha = rendered.get('color')!.getContext('2d')!.getImageData(0, 0, 256, 256).data;
let painted = 0, transparent = 0;
for (const [channel, canvas] of rendered) {
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, 256, 256).data;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    if (x < Math.floor(region.polygons[0][0].x * 256)) assert.equal(pixels[i + 3], 0, `${channel}: inner sidewalls retain their paint`);
    if (alpha[i + 3] === 0) { assert(pixels[i + 3] <= 1, `${channel}: transparent composition pixels do not replace the finish`); transparent++; }
    if (channel === 'color' && pixels[i + 3] > 128) painted++;
  }
  canvas.width = canvas.height = 1;
}
assert(painted > 100 && transparent > 1000);

type Owner = FabricImage & { id: string; materialLayer?: MaterialLayer; imageOrder?: number };
const states = new Map(MAPS.map(map => {
  const canvas = new Canvas(undefined, { width: map.workRes, height: map.workRes, backgroundColor: '#123456', renderOnAddRemove: false, enableRetinaScaling: false });
  const textureEl = document.createElement('canvas'); textureEl.width = textureEl.height = 1;
  return [map.id, { canvas, el: canvas.lowerCanvasEl, textureEl, suspendHistory: false, textureDirty: true, baseline: '', undo: [] as string[], redo: [] as string[], coalesceKey: null }];
}));
const core = Object.create(EditorCore.prototype) as EditorCore;
let activeGeometry: readonly ProjectionTriangle[] = geometry;
Object.assign(core, { maps: states, activeMap: 'Wheels_B', tool: 'select', blenderParts: [], listeners: new Map(), objectUrls: [],
  speedLightColor: '#ffffff', illumToolRole: 'head', materialGeometry: () => activeGeometry, projectionSources: new Map(), projectionBakes: new Map(),
  materialBakes: new Map(), materialSurfaces: [], materialInteractive: false, materialUpdateSequence: 0, textureResolution: 1024,
  illumRoles: new Map(), importedRoleMasks: new WeakMap(), previewDirty: new Set(), previewUpdates: new Set(),
  flushTexture: () => {}, isPanning: () => false, setActiveMap: (id: MapId) => { core.activeMap = id; } });
for (const map of MAPS) (core as unknown as { wireCanvas(id: MapId, state: unknown): void }).wireCanvas(map.id, states.get(map.id)!);
for (const map of MAPS) core.resetMapBaseline(map.id);
const owners = () => states.get('Wheels_B')!.canvas.getObjects().filter(object => (object as Owner).materialLayer) as Owner[];
const blobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new env.window.FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  }));
};
try {
  const body = JSON.stringify(states.get('Skin_B')!.canvas.toJSON());
  await core.addMaterialLayer(definition, ['tyres:outer']);
  const owner = owners()[0], id = owner.id, order = owner.imageOrder;
  const light = states.get('Wheels_I')!.canvas.getObjects().find(object => (object as Owner & { linkedImageId?: string }).linkedImageId === id) as (Owner & { illumCodes?: IllumCodes });
  assert(light?.illumCodes, 'A mixed-role composition creates a per-pixel illumination role mask');
  const lightRoles = decodeIllumCodes(light.illumCodes);
  assert(lightRoles.includes(3) && lightRoles.includes(255), 'Brake and always-on elements retain distinct Trackmania alpha codes');
  (core as unknown as { syncIllumRoles(id: MapId, canvas: Canvas, size: number): void }).syncIllumRoles('Wheels_I', states.get('Wheels_I')!.canvas, 512);
  const exportRoles = (core as unknown as { illumRoles: Map<MapId, HTMLCanvasElement> }).illumRoles.get('Wheels_I')!;
  const exported = exportRoles.getContext('2d')!.getImageData(0, 0, 512, 512).data;
  assert(exported.some((value, index) => index % 4 === 0 && value === 3), 'Brake role reaches the exported illumination mask');
  assert(exported.some((value, index) => index % 4 === 0 && value === 255), 'Always-on role reaches the exported illumination mask');
  await core.undo(); assert.equal(owners().length, 0);
  await core.redo(); assert.equal(owners()[0].id, id);
  const revised = structuredClone(captured); revised.elements[2].design.text = 'MOTORSPORT 27'; revised.elements.reverse(); revised.elements[0].locked = true;
  const artwork = await createWheelArtworkDefinition(revised);
  const updated = { ...definition, wheelDesign: artwork.wheelDesign, textures: { ...definition.textures, color: artwork.textures.color } };
  const history = states.get('Wheels_B')!.undo.length;
  await core.updateMaterialLayerDefinition(id, updated);
  core.setSelectionMaterialMask(['tyres:outer', 'tyres:inner'], [], 'material-definition'); core.commitMaterialLayers(); core.endHistoryCoalescing();
  assert.equal(states.get('Wheels_B')!.undo.length, history + 1, 'Changing a composition and target remains one undo gesture');
  assert.equal(owners()[0].id, id); assert.equal(owners()[0].imageOrder, order);
  assert.equal(owners()[0].materialLayer!.definition.name, definition.name);
  for (const key of ['roughness', 'metalness', 'coat', 'opacity', 'emissionColor', 'emissionStrength'] as const) assert.equal(owners()[0].materialLayer!.definition[key], definition[key], `${key} stays editable and unchanged`);
  await core.undo(); assert.deepEqual(owners()[0].materialLayer!.definition.wheelDesign, captured);
  assert.deepEqual(owners()[0].materialLayer!.regions.map(item => item.key), ['tyres:outer']);
  await core.redo(); assert.deepEqual(owners()[0].materialLayer!.definition.wheelDesign, revised);
  assert.equal(JSON.stringify(states.get('Skin_B')!.canvas.toJSON()), body, 'Composition edits never repaint another family');

  const capturedProject = await core.captureProject(), bundle = createBaseSkinProject({ position: [3, 2, 4], target: [0, .5, 0] });
  bundle.document.editor = { maps: capturedProject.maps, speedColor: capturedProject.speedColor, illumRole: capturedProject.illumRole };
  for (const [path, blob] of capturedProject.assets) bundle.assets.set(path, await blobBytes(blob));
  const reopened = await readProjectFile(await writeProjectFile(bundle));
  const savedOwner = (reopened.document.editor.maps.Wheels_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!;
  const saved = savedOwner.materialLayer as MaterialLayer;
  assert.deepEqual(saved.definition.wheelDesign, revised, 'The project ZIP retains every element, logo byte, lock and order');
  const hydratedProject = hydrateProject(reopened);
  try {
    const hydratedOwner = (hydratedProject.document.editor.maps.Wheels_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!;
    assert.deepEqual((hydratedOwner.materialLayer as MaterialLayer).definition.wheelDesign, revised, 'Real hydration retains inline logo data instead of replacing it with a missing asset URL');
  } finally { hydratedProject.urls.forEach(url => URL.revokeObjectURL(url)); }

  const hydrated = structuredClone(reopened.document.editor.maps);
  const hydrate = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(hydrate); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.src === 'string') node.src = `data:image/png;base64,${Buffer.from(reopened.assets.get(node.src)!).toString('base64')}`;
    Object.values(node).forEach(hydrate);
  };
  hydrate(hydrated);
  const materialBakes = (core as unknown as { materialBakes: Map<string, { channels: Map<string, HTMLCanvasElement> }> }).materialBakes;
  const staleColor = materialBakes.get(id)!.channels.get('color')!;
  const staleContext = staleColor.getContext('2d')!;
  staleContext.clearRect(0, 0, staleColor.width, staleColor.height);
  staleContext.fillStyle = '#ff00ff'; staleContext.fillRect(0, 0, staleColor.width, staleColor.height);
  await core.loadProject(hydrated, { speedColor: capturedProject.speedColor, illumRole: capturedProject.illumRole, textureResolution: 1024 });
  assert.equal(owners()[0].id, id); assert.deepEqual(owners()[0].materialLayer!.definition.wheelDesign, revised);
  assert.deepEqual(owners()[0].materialLayer!.regions.map(item => item.key), ['tyres:outer', 'tyres:inner']);
  const reloadedColor = materialBakes.get(id)!.channels.get('color')!;
  assert.notEqual(reloadedColor, staleColor, 'Reloading the same owner rebakes its material even if its cache key is unchanged');
  assert.notEqual(reloadedColor.toDataURL(), staleColor.toDataURL(), 'A stale pre-correction texture is never restored to the live model');
  const modelHistory = states.get('Wheels_B')!.undo.slice(), originalGeometry = JSON.stringify(geometry), reloadedPng = reloadedColor.toDataURL();
  activeGeometry = geometry.map(triangle => ({ ...triangle, uv: triangle.uv.map(([u, v]) => [u, 1 - v]) as ProjectionTriangle['uv'] }));
  const changedGeometry = JSON.stringify(activeGeometry);
  core.rebuildProjectionsForModel();
  assert.notEqual(materialBakes.get(id)!.channels.get('color')!.toDataURL(), reloadedPng, 'Replacing the model UVs invalidates the previous material bake');
  assert.equal(JSON.stringify(geometry), originalGeometry); assert.equal(JSON.stringify(activeGeometry), changedGeometry, 'Rebaking never mutates either model geometry');
  assert.deepEqual(states.get('Wheels_B')!.undo, modelHistory, 'Model changes do not add or rewrite design history');
  assert.equal(owners()[0].id, id); assert.deepEqual(owners()[0].materialLayer!.definition.wheelDesign, revised);
  assert.deepEqual(owners()[0].materialLayer!.regions.map(item => item.key), ['tyres:outer', 'tyres:inner']);
  const unsafe = structuredClone(reopened.document), unsafeOwner = (unsafe.editor.maps.Wheels_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!;
  unsafeOwner.imageData = logo;
  assert.throws(() => validateProjectDocument(unsafe, new Set(reopened.assets.keys())), /texte trop long/, 'Large strings outside validated composition logos keep their previous bound');
  delete unsafeOwner.imageData; unsafeOwner['materialLayer.definition.wheelDesign.elements[0].design.imageData'] = logo;
  assert.throws(() => validateProjectDocument(unsafe, new Set(reopened.assets.keys())), /texte trop long/, 'A forged dotted property name cannot spoof the trusted metadata path');
  console.log('✓ Sidewall composition: exact pigments, detailed local logo, bounded pack/project round trips, original finish, owner/Undo, native masks and safe hydration');
} finally {
  core.commitMaterialLayers();
  for (const state of states.values()) { await state.canvas.dispose(); state.textureEl.width = state.textureEl.height = 0; }
}
