import assert from 'node:assert/strict';
import { Canvas, FabricImage, Rect, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { EditorCore } from '../src/editor/EditorCore';
import { MAPS, type MapId } from '../src/maps';
import type { BlenderPart } from '../src/blenderParts';
import { createMaterialDefinition, type MaterialLayer } from '../src/materials/types';
import { createBaseSkinProject } from '../src/baseSkin';
import { readProjectFile, validateProjectDocument, writeProjectFile } from '../src/projectFile';
import { selectLayerInspector, selectionInspector } from '../src/ui/layerNavigation';

setEnv(getEnv());
const env = getEnv();
Object.assign(globalThis, { document: env.document, window: env.window,
  HTMLElement: env.window.HTMLElement, HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement });
const source = document.createElement('canvas'); source.width = 80; source.height = 40;
source.getContext('2d')!.fillStyle = '#dc5014'; source.getContext('2d')!.fillRect(0, 0, 80, 40);
const original = source.toDataURL('image/png');
const rectangle = (key: string, x: number, y: number, width: number, height: number, family: BlenderPart['family'] = 'skin'): BlenderPart => ({ key, label: key, family, mesh: 'Test', polygons: [[{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]] });
type LayerImage = FabricImage & { id: string; materialLayer?: MaterialLayer; linkedImageId?: string; linkedImageKind?: string; illumRole?: string; imageOrder?: number };
const states = new Map(MAPS.map(def => {
  const canvas = new Canvas(undefined, { width: def.workRes, height: def.workRes, backgroundColor: '#123456', renderOnAddRemove: false, enableRetinaScaling: false });
  const textureEl = document.createElement('canvas'); textureEl.width = textureEl.height = 1;
  return [def.id, { canvas, el: canvas.lowerCanvasEl, textureEl, suspendHistory: false, textureDirty: true, baseline: '', undo: [] as string[], redo: [] as string[], coalesceKey: null }];
}));
const core = Object.create(EditorCore.prototype) as EditorCore;
Object.assign(core, { maps: states, activeMap: 'Skin_B', tool: 'select', symmetry: true, carAligned: true,
  blenderParts: [], listeners: new Map(), illumToolRole: 'brake', speedLightColor: '#ffffff', projectionSources: new Map(), projectionBakes: new Map(),
  materialBakes: new Map(), materialSurfaces: [], materialInteractive: false, materialUpdateSequence: 0, textureResolution: 1024,
  illumRoles: new Map(), importedRoleMasks: new WeakMap(), previewDirty: new Set(), previewUpdates: new Set(),
  flushTexture: () => {}, isPanning: () => false,
  // The UI viewport is outside the scope of this headless integration fixture.
  setActiveMap: (id: MapId) => { core.activeMap = id; },
});
const internals = core as unknown as { wireCanvas(id: MapId, state: unknown): void; materialInteractive: boolean };
for (const def of MAPS) internals.wireCanvas(def.id, states.get(def.id)!);
core.setSpeedLightColor('#ffffff');
for (const def of MAPS) core.resetMapBaseline(def.id);
const parts = [rectangle('material:selection', .1, .1, .8, .8), rectangle('material:hole', .4, .4, .2, .2), rectangle('material:details', .1, .1, .8, .8, 'details')];
core.setBlenderParts(parts);
const images = (id: MapId) => states.get(id)!.canvas.getObjects() as LayerImage[];
const owner = () => images(core.activeMap).find(image => image.materialLayer)!;
const pixel = (canvas: HTMLCanvasElement, x: number, y: number) => [...canvas.getContext('2d')!.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data];
const exportPixel = (id: MapId, x = .2, y = .2) => pixel(core.getExportCanvasElement(id), x, y);
const linked = (id: MapId, parent: string) => images(id).find(image => image.linkedImageId === parent)!;
const blobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new env.window.FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(bytes);
};

try {
  const definition = createMaterialDefinition();
  definition.color = '#ffffff'; definition.roughness = 50; definition.metalness = 150; definition.coat = 99; definition.dirt = 88;
  definition.emissionColor = '#40a080'; definition.emissionStrength = .4; definition.emissionRole = 'brake';
  definition.textures.color = { src: original, name: 'Native.png', component: 'luminance', invert: false };
  await core.addMaterialLayer(definition, ['material:selection'], ['material:hole']);
  let master = owner(), masterId = master.id;
  assert.equal(images('Skin_B').filter(image => image.materialLayer).length, 1, 'Symmetry never duplicates a selected material');
  for (const id of ['Skin_R', 'Skin_CoatR', 'Skin_I', 'Skin_DirtMask'] as const) assert.equal(linked(id, masterId).linkedImageId, masterId);
  assert.deepEqual(exportPixel('Skin_B'), [220, 80, 20, 255]);
  assert.deepEqual(exportPixel('Skin_R'), [50, 150, 0, 255]);
  assert.deepEqual(exportPixel('Skin_CoatR'), [99, 99, 99, 255]);
  assert.deepEqual(exportPixel('Skin_DirtMask'), [88, 88, 88, 255]);
  assert.deepEqual(exportPixel('Skin_I'), [26, 64, 51, 255]);
  assert.equal(linked('Skin_I', masterId).illumRole, 'brake');
  for (const id of ['Skin_B', 'Skin_R', 'Skin_CoatR', 'Skin_I', 'Skin_DirtMask'] as const) {
    assert.deepEqual(exportPixel(id, .05, .05), [18, 52, 86, 255], 'Neighbouring UV pixels are untouched');
    assert.deepEqual(exportPixel(id, .5, .5), [18, 52, 86, 255], 'Excluded UV pixels are untouched');
  }
  const read = core.getSelectionMaterialLayer()!; read.definition.roughness = 222;
  assert.equal(core.getSelectionMaterialLayer()!.definition.roughness, 50, 'Public selection data is an independent copy');
  await core.undo(); assert(!images('Skin_B').some(image => image.materialLayer));
  for (const id of ['Skin_R', 'Skin_CoatR', 'Skin_I', 'Skin_DirtMask'] as const) assert(!images(id).some(image => image.linkedImageId === masterId));
  await core.redo(); master = owner(); assert.equal(master.id, masterId);
  assert.equal(master.materialLayer!.definition.textures.color!.src, original, 'Undo retains the original texture source');
  assert.deepEqual(exportPixel('Skin_R'), [50, 150, 0, 255]);
  console.log('ok unified owner, masks, linked R/G/vernis/light/dirt and undo/redo source retention');

  assert.deepEqual(core.getLayers().find(layer => layer.id === masterId)!.material,
    { name: definition.name, ownerId: masterId, linked: false }, 'The colour owner is identified as an editable material');
  const materialChildId = linked('Skin_R', masterId).id;
  core.setActiveMap('Skin_R');
  assert.deepEqual(core.getLayers().find(layer => layer.id === materialChildId)!.material,
    { name: definition.name, ownerId: masterId, linked: true }, 'A finish layer identifies the same material rather than an unrelated image');
  const sourceHistoryBeforeLinkedEdit = states.get('Skin_B')!.undo.length;
  const finishHistoryBeforeLinkedEdit = states.get('Skin_R')!.undo.length;
  const finishLayer = core.getLayers().find(layer => layer.id === materialChildId)!;
  assert.equal(selectLayerInspector(core, finishLayer), 'materials', 'A single finish-layer click opens material controls after resolving its owner');
  assert.equal(core.activeMap, 'Skin_B'); assert.equal(core.getSelection(), master);
  assert.equal(selectionInspector(core), 'materials', 'The general edit-selection action opens the same material editor');
  core.setActiveMap('Skin_R');
  assert.equal(selectLayerInspector(core, core.getLayers().find(layer => layer.id === materialChildId)!, true), 'materials', 'Explicit edit and double-click do not fall back to image-only controls');
  assert.equal(core.getSelectionMaterialLayer()!.definition.name, definition.name, 'Selecting a finish exposes its owner material for editing');
  const linkedEdit = core.getSelectionMaterialLayer()!.definition; linkedEdit.roughness = 180;
  await core.setSelectionMaterialDefinition(linkedEdit); core.commitMaterialLayers();
  assert.deepEqual(exportPixel('Skin_R'), [180, 150, 0, 255], 'Editing the selected owner regenerates its finish pixels');
  assert.equal(states.get('Skin_B')!.undo.length, sourceHistoryBeforeLinkedEdit + 1);
  assert.equal(states.get('Skin_R')!.undo.length, finishHistoryBeforeLinkedEdit, 'A linked finish edit uses only its material owner history');
  await core.undo(); master = owner();
  assert.deepEqual(exportPixel('Skin_R'), [50, 150, 0, 255]);
  core.toggleLock(masterId);
  core.setActiveMap('Skin_R'); states.get('Skin_R')!.canvas.discardActiveObject();
  assert.equal(core.getLayers().find(layer => layer.id === materialChildId)!.locked, true);
  assert.equal(selectLayerInspector(core, core.getLayers().find(layer => layer.id === materialChildId)!, true), 'layers');
  assert.equal(core.activeMap, 'Skin_R', 'Selecting a locked finish does not silently switch to its owner');
  assert.equal(core.getSelectionMaterialLayer(), null, 'A locked finish cannot open a new material for editing');
  core.toggleLock(materialChildId);
  assert.equal(core.activeMap, 'Skin_B'); assert.equal(master.selectable, true);
  states.get('Skin_B')!.canvas.setActiveObject(master);
  console.log('ok material layer metadata, linked-owner selection/editing/history and locked finish selection');

  core.toggleVisible(masterId);
  for (const id of ['Skin_R', 'Skin_CoatR', 'Skin_I', 'Skin_DirtMask'] as const) assert.equal(linked(id, masterId).visible, false);
  assert.equal(core.getMaterialSurfaceOverlays().length, 0);
  assert.deepEqual(exportPixel('Skin_B'), [18, 52, 86, 255]);
  core.toggleVisible(masterId);
  states.get('Skin_B')!.canvas.setActiveObject(master);
  await core.duplicateSelection();
  const duplicate = core.getSelection() as LayerImage;
  assert.notEqual(duplicate.id, masterId); assert.equal(duplicate.left, master.left); assert.equal(duplicate.top, master.top);
  assert.equal(images('Skin_B').filter(image => image.materialLayer).length, 2);
  assert.equal(images('Skin_R').filter(image => image.linkedImageId).length, 2);
  const copiedDefinition = core.getSelectionMaterialLayer()!.definition; copiedDefinition.roughness = 200;
  await core.setSelectionMaterialDefinition(copiedDefinition); core.commitMaterialLayers();
  assert.equal(master.materialLayer!.definition.roughness, 50, 'Changing a duplicate never changes the original definition');
  assert.deepEqual(exportPixel('Skin_R'), [200, 150, 0, 255]);
  core.deleteSelection();
  assert.equal(images('Skin_B').filter(image => image.materialLayer).length, 1);
  assert.equal(images('Skin_R').filter(image => image.linkedImageId).length, 1);
  assert.deepEqual(exportPixel('Skin_R'), [50, 150, 0, 255]);
  console.log('ok visibility propagates, duplication is independent, deletion removes generated channels');

  states.get('Skin_B')!.canvas.setActiveObject(master);
  const edited = core.getSelectionMaterialLayer()!.definition; edited.roughness = 120;
  await core.setSelectionMaterialDefinition(edited);
  assert((master.getElement() as HTMLCanvasElement).width <= 512, 'Slider feedback uses a bounded interactive texture');
  assert.equal(master.scaleX, 4, 'Interactive raster pixels remain aligned with the 2048px UV coordinates');
  assert(internals.materialInteractive);
  const full = core.getExportCanvasElement('Skin_B');
  assert.equal(full.width, 1024); assert.equal(master.scaleX, 2, 'Export reconstructs at final resolution from native sources after interactive input');
  assert(!internals.materialInteractive);
  assert.deepEqual(exportPixel('Skin_R'), [120, 150, 0, 255]);
  core.setSelectionMaterialMask([], []);
  assert.deepEqual(exportPixel('Skin_B', .05, .05), [220, 80, 20, 255], 'Empty scope means the complete surface');
  core.setSelectionMaterialMask(['material:selection'], ['material:hole']);
  console.log('ok settled/export rendering rebuilds from native data and full-surface mask remains editable');

  const captured = await core.captureProject();
  const bundle = createBaseSkinProject({ position: [3, 2, 4], target: [0, .5, 0] });
  bundle.document.editor = { maps: captured.maps, speedColor: captured.speedColor, illumRole: captured.illumRole };
  for (const [path, blob] of captured.assets) bundle.assets.set(path, await blobBytes(blob));
  assert.equal(bundle.assets.size, 2, 'Only a compact owner placeholder and one original image are stored');
  const savedImage = (captured.maps.Skin_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!;
  const savedLayer = savedImage.materialLayer as MaterialLayer;
  const originalBytes = bundle.assets.get(savedLayer.definition.textures.color!.src) as Uint8Array;
  const header = new DataView(originalBytes.buffer, originalBytes.byteOffset, originalBytes.byteLength);
  assert.equal(header.getUint32(16), 80); assert.equal(header.getUint32(20), 40, 'Saving never archives the low-resolution bake');
  assert.deepEqual(originalBytes,new Uint8Array(Buffer.from(original.split(',')[1],'base64')),'The exact original PNG is saved, without canvas re-encoding');
  for (const map of Object.values(captured.maps)) assert(!(map.objects as Record<string, unknown>[]).some(object => object.linkedImageId), 'Generated channel fragments are excluded from the project');
  const reopened = await readProjectFile(await writeProjectFile(bundle));
  const reopenedLayer = ((reopened.document.editor.maps.Skin_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!.materialLayer as MaterialLayer);
  assert.equal(reopenedLayer.definition.roughness, 120); assert.equal(reopenedLayer.exclusions[0].key, 'material:hole');
  const unsafe = structuredClone(reopened.document);
  const unsafeLayer = ((unsafe.editor.maps.Skin_B.objects as Record<string, unknown>[]).find(object => object.materialLayer)!.materialLayer as MaterialLayer);
  unsafeLayer.definition.textures.color!.src = 'https://example.com/remote.png';
  assert.throws(() => validateProjectDocument(unsafe, new Set(reopened.assets.keys())), /matériau|image/);
  const nodeHydrated = structuredClone(reopened.document.editor.maps);
  const hydrate = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(hydrate); return; }
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (typeof object.src === 'string') object.src = `data:image/png;base64,${Buffer.from(reopened.assets.get(object.src) as Uint8Array).toString('base64')}`;
    Object.values(object).forEach(hydrate);
  };
  hydrate(nodeHydrated);
  await core.loadProject(nodeHydrated, { speedColor: captured.speedColor, illumRole: captured.illumRole, textureResolution: 1024 });
  assert.deepEqual(exportPixel('Skin_R'), [120, 150, 0, 255]);
  master = images('Skin_B').find(image => image.materialLayer)!; masterId = master.id;
  assert.equal(images('Skin_R').filter(image => image.linkedImageId === masterId).length, 1);
  console.log('ok original PNG project roundtrip, compact serialization, safe sources and generated-channel reconstruction');

  states.get('Skin_B')!.canvas.setActiveObject(master);
  const stripe = document.createElement('canvas'); stripe.width = 80; stripe.height = 40;
  const stripeCtx = stripe.getContext('2d')!;
  stripeCtx.fillStyle = '#dc5014'; stripeCtx.fillRect(0, 0, 40, 40);
  stripeCtx.fillStyle = '#1450dc'; stripeCtx.fillRect(40, 0, 40, 40);
  const stripeSource = stripe.toDataURL('image/png');
  const dragDefinition = core.getSelectionMaterialLayer()!.definition;
  dragDefinition.roughness = 255;
  dragDefinition.textures.color!.src = stripeSource;
  dragDefinition.textures.roughness = { src: stripeSource, name: 'StripeRoughness.png', component: 'r', invert: false };
  await core.setSelectionMaterialDefinition(dragDefinition); core.commitMaterialLayers(); core.endHistoryCoalescing();
  const beforeDragPosition = { left: master.left, top: master.top };
  const beforeMask = JSON.stringify([master.materialLayer!.regions, master.materialLayer!.exclusions]);
  const beforeHistory = states.get('Skin_B')!.undo.length;
  const beforeColor = exportPixel('Skin_B', .15, .2);
  assert.deepEqual(beforeColor, [220, 80, 20, 255]);
  assert(core.beginImageDrag('Skin_B', .15 * 2048, .2 * 2048), 'The material can be grabbed from a painted point on the car');
  assert(core.moveImageDrag(.15 * 2048 + 64, .2 * 2048 + 32));
  assert(core.moveImageDrag(.15 * 2048 + 128, .2 * 2048 + 64));
  assert.equal(states.get('Skin_B')!.undo.length, beforeHistory, 'Intermediate 3D drag samples do not add history entries');
  core.endImageDrag(); core.commitMaterialLayers();
  assert.equal(states.get('Skin_B')!.undo.length, beforeHistory + 1, 'A completed drag creates exactly one undo entry');
  assert.equal(master.materialLayer!.definition.transform.offsetX, 128);
  assert.equal(master.materialLayer!.definition.transform.offsetY, 64);
  assert.deepEqual({ left: master.left, top: master.top }, beforeDragPosition, 'Dragging the motif keeps the material owner anchored to its UV bounds');
  assert.equal(JSON.stringify([master.materialLayer!.regions, master.materialLayer!.exclusions]), beforeMask);
  assert.deepEqual(exportPixel('Skin_B', .15, .2), [20, 80, 220, 255]);
  assert.equal(exportPixel('Skin_R', .15, .2)[0], 20, 'Roughness follows the exact same moved image frame as color');
  assert.deepEqual(exportPixel('Skin_B', .5, .5), [18, 52, 86, 255], 'Dragging never moves the material into an excluded island');
  await core.undo(); master = images('Skin_B').find(image => image.materialLayer)!;
  assert.equal(master.materialLayer!.definition.transform.offsetX, 0); assert.equal(master.materialLayer!.definition.transform.offsetY, 0);
  assert.deepEqual(exportPixel('Skin_B', .15, .2), beforeColor);
  assert.equal(exportPixel('Skin_R', .15, .2)[0], 220);
  console.log('ok 3D motif dragging moves all texture channels, retains UV masks and records one undo gesture');

  core.activeMap = 'Details_B';
  const detail = createMaterialDefinition(); detail.color = '#ffffff';
  const normal = document.createElement('canvas'); normal.width = normal.height = 8;
  normal.getContext('2d')!.fillStyle = '#b482ee'; normal.getContext('2d')!.fillRect(0, 0, 8, 8);
  detail.textures.normal = { src: normal.toDataURL('image/png'), name: 'Normal.png', component: 'luminance', invert: false };
  detail.textures.ao = { src: original, name: 'AO.png', component: 'r', invert: false };
  await core.addMaterialLayer(detail, ['material:details']);
  const overlay = core.getMaterialSurfaceOverlays().find(surface => surface.family === 'details')!;
  assert(overlay.normal && overlay.ao); assert.equal(overlay.normal.width, 1024);
  const index = (Math.floor(.2 * 1024) * 1024 + Math.floor(.2 * 1024)) * 4;
  assert(overlay.normal.data[index] > 128); assert.equal(overlay.ao.data[index], 220); assert.equal(overlay.ao.data[index + 3], 255);
  const outside = (Math.floor(.05 * 1024) * 1024 + Math.floor(.05 * 1024)) * 4;
  assert.equal(overlay.normal.data[outside + 3], 0); assert.equal(overlay.ao.data[outside + 3], 0);
  console.log('ok normal/AO overlays use the same UV mask and final rendering resolution');

  // The legacy editor saved a unified material directly on Skin_R, leaving Skin_B unchanged in 3D.
  const legacyMaps = structuredClone(nodeHydrated);
  const legacyBaseObjects = legacyMaps.Skin_B.objects as Record<string, unknown>[];
  const legacyImage = legacyBaseObjects.find(object => object.materialLayer)!;
  const legacyMetadata = structuredClone(legacyImage.materialLayer);
  delete legacyImage.imageOrder;
  const artwork = Object.assign(new Rect({ left: 0, top: 0, originX: 'left', originY: 'top', width: 2048, height: 2048, fill: '#7a1d92', strokeWidth: 0 }), { id: 'legacy-artwork', name: 'Existing artwork' });
  legacyMaps.Skin_B.objects = [artwork.toObject(['id', 'name'])];
  (legacyMaps.Skin_R.objects as Record<string, unknown>[]).push(legacyImage);
  core.activeMap = 'Skin_R';
  await core.loadProject(legacyMaps, { speedColor: captured.speedColor, illumRole: captured.illumRole, textureResolution: 1024 });
  let migrated = images('Skin_B').find(image => image.materialLayer)!;
  assert(migrated, 'The legacy owner is restored onto the family colour map');
  assert.equal(migrated.id, legacyImage.id);
  assert.deepEqual(migrated.materialLayer, legacyMetadata, 'Migration retains texture sources, masks and every material setting');
  assert.equal(migrated.visible, true); assert.equal(migrated.opacity, 1);
  assert(Number.isFinite(migrated.imageOrder), 'An old owner without an order gains one shared by its derived channels');
  assert.equal(images('Skin_B').filter(image => image.id === 'legacy-artwork').length, 1, 'Existing skin artwork is retained');
  assert.deepEqual(exportPixel('Skin_B'), [220, 80, 20, 255], 'The material motif now reaches the texture used by the 3D paint');
  assert.deepEqual(exportPixel('Skin_B', .05, .05), [122, 29, 146, 255]);
  assert.deepEqual(exportPixel('Skin_B', .5, .5), [122, 29, 146, 255], 'The legacy exclusion remains transparent over existing artwork');
  assert.deepEqual(exportPixel('Skin_R'), [120, 150, 0, 255], 'Skin_R receives roughness/metal values instead of the colour bitmap');
  assert(!images('Skin_R').some(image => image.materialLayer));
  for (const id of ['Skin_R', 'Skin_CoatR', 'Skin_I', 'Skin_DirtMask'] as const) assert.equal(images(id).filter(image => image.linkedImageId === migrated.id).length, 1);
  assert((JSON.parse(states.get('Skin_B')!.undo[0]).objects as Record<string, unknown>[]).some(object => object.materialLayer), 'Project baselines are captured after owner migration');
  assert(!(JSON.parse(states.get('Skin_R')!.undo[0]).objects as Record<string, unknown>[]).some(object => object.materialLayer));

  core.activeMap = 'Skin_B'; states.get('Skin_B')!.canvas.setActiveObject(migrated);
  const oldChannelHistory = states.get('Skin_R')!.undo.length;
  const migratedDefinition = core.getSelectionMaterialLayer()!.definition; migratedDefinition.roughness = 190;
  await core.setSelectionMaterialDefinition(migratedDefinition); core.commitMaterialLayers();
  assert.equal(states.get('Skin_R')!.undo.length, oldChannelHistory, 'Material edits now belong to the colour owner history');
  await core.undo();
  migrated = images('Skin_B').find(image => image.materialLayer)!;
  assert.equal(migrated.materialLayer!.definition.roughness, 120, 'Undo restores the migrated material rather than removing it');
  assert.deepEqual(exportPixel('Skin_R'), [120, 150, 0, 255]);

  // Restoring a stale channel snapshot must replace an already migrated owner without making duplicates.
  const restoredOwner = await migrated.clone(['id', 'materialLayer', 'imageOrder']) as LayerImage;
  const preservedOrder = migrated.imageOrder;
  const sourceHistory = states.get('Skin_R')!.undo.length, targetHistory = states.get('Skin_B')!.undo.length;
  states.get('Skin_R')!.suspendHistory = true;
  try { states.get('Skin_R')!.canvas.add(restoredOwner); } finally { states.get('Skin_R')!.suspendHistory = false; }
  core.activeMap = 'Skin_R'; states.get('Skin_R')!.canvas.setActiveObject(restoredOwner);
  core.refreshLinkedImages(); core.refreshLinkedImages();
  assert.equal(core.activeMap, 'Skin_B'); assert.equal(core.getSelection(), restoredOwner, 'The selected legacy owner follows its colour map after migration');
  assert.equal(images('Skin_B').filter(image => image.id === restoredOwner.id).length, 1);
  assert.equal(restoredOwner.imageOrder, preservedOrder);
  assert.equal(images('Skin_R').filter(image => image.linkedImageId === restoredOwner.id).length, 1);
  assert.equal(states.get('Skin_R')!.undo.length, sourceHistory); assert.equal(states.get('Skin_B')!.undo.length, targetHistory, 'Reparenting and rebuilding do not append undo snapshots');
  assert(core.takePreviewUpdates().has('Skin_B'), 'The repaired colour texture is published to the 3D preview');
  console.log('ok legacy channel-owner migration, preserved artwork/masks, one derived map, selection and migrated undo history');
  const ordinaryLayer = core.getLayers().find(layer => layer.id === 'legacy-artwork')!;
  assert(!ordinaryLayer.material);
  assert.equal(selectLayerInspector(core, ordinaryLayer), 'layers', 'Ordinary artwork retains single-click selection in the layer list');
  assert.equal(selectionInspector(core), 'props');
  assert.equal(selectLayerInspector(core, ordinaryLayer, true), 'props', 'Ordinary artwork retains its usual element editor');
  core.setActiveMap('Skin_B');
  const png16 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACEAAAAAAHTY67AAAAEklEQVR4nGNgYGhgYGhg/P8fAAiKAwCNUwMgAAAAAElFTkSuQmCC';
  const heightDefinition=createMaterialDefinition(); heightDefinition.name='Hauteur 16 bits';
  heightDefinition.textures.height={src:`data:image/png;base64,${png16}`,name:'height16.png',component:'r',invert:false};
  await core.addMaterialLayer(heightDefinition);
  const highPrecision=await core.captureProject();
  const heightOwner=(highPrecision.maps.Skin_B.objects as {materialLayer?:MaterialLayer}[]).find(object=>object.materialLayer?.definition.name==='Hauteur 16 bits')!;
  const heightBytes=await blobBytes(highPrecision.assets.get(heightOwner.materialLayer!.definition.textures.height!.src)!);
  assert.deepEqual(heightBytes,new Uint8Array(Buffer.from(png16,'base64')),'Material save preserves every original 16-bit PNG byte');
  assert.equal(heightBytes[24],16);
  const projected=createMaterialDefinition();projected.name='Matière alignée';projected.color='#ffffff';
  projected.transform={...projected.transform,projection:'top',mode:'stretch',size:256};
  projected.textures.color={src:original,name:'Native.png',component:'r',invert:false};
  core.materialGeometry=()=>[];
  await core.addMaterialLayer(projected);
  const projectedOwner=images('Skin_B').find(image=>image.materialLayer?.definition.name==='Matière alignée')!;
  assert(projectedOwner,'A projected owner survives restoration before the model loads');
  core.materialGeometry=()=>[
    {family:'skin',points:[[-1,0,-1],[1,0,-1],[1,0,1]],uv:[[0,1],[1,1],[1,0]]},
    {family:'skin',points:[[-1,0,-1],[1,0,1],[-1,0,1]],uv:[[0,1],[1,0],[0,0]]},
  ];
  core.rebuildProjectionsForModel();
  assert.equal((projectedOwner.getElement() as HTMLCanvasElement).width,1024,'The model-ready callback rebuilds projected textures');
  const worldProject=await core.captureProject();
  const worldBundle=createBaseSkinProject({position:[3,2,4],target:[0,.5,0]});
  worldBundle.document.editor={maps:worldProject.maps,speedColor:worldProject.speedColor,illumRole:worldProject.illumRole};
  for(const [path,blob] of worldProject.assets)worldBundle.assets.set(path,await blobBytes(blob));
  const worldSaved=await readProjectFile(await writeProjectFile(worldBundle));
  const worldLayer=(worldSaved.document.editor.maps.Skin_B.objects as {materialLayer?:MaterialLayer}[]).find(object=>object.materialLayer?.definition.name==='Matière alignée')!.materialLayer!;
  assert.equal(worldLayer.definition.transform.projection,'top','Project files preserve editable 3D alignment');
  const pointer={point:[0,0,0] as [number,number,number],normal:[0,1,0] as [number,number,number],tangent:[1,0,0] as [number,number,number]};
  assert(core.beginImageDrag('Skin_B',200,200,pointer));
  core.moveImageDrag(1700,1800,{...pointer,point:[.1,0,0]});
  const moved=core.getSelectionMaterialLayer()!.definition.transform;
  assert(Math.abs(moved.offsetX-102.4)<1e-6 && moved.offsetY===0,'Crossing a UV seam moves the pattern by physical distance');
  core.endImageDrag();core.commitMaterialLayers();
  console.log('ok pending model restoration, projected export/rebuild, editable project roundtrip and physical 3D dragging across UV seams');
  core.activeMap='Skin_B';const keptColor=exportPixel('Skin_B',.2,.2),keptFinish=exportPixel('Skin_R',.2,.2);
  const reliefOnly=createMaterialDefinition();reliefOnly.surfaceOnly=true;reliefOnly.textures.height={src:original,name:'height.png',component:'r',invert:false};
  await core.addMaterialLayer(reliefOnly);assert.deepEqual(exportPixel('Skin_B',.2,.2),keptColor,'A height-only owner does not repaint the body');assert.deepEqual(exportPixel('Skin_R',.2,.2),keptFinish,'A height-only owner does not replace roughness/metalness');assert(core.getSelectionMaterialLayer()!.definition.surfaceOnly);
  const isolatedProject=await core.captureProject();assert((isolatedProject.maps.Skin_B.objects as {materialLayer?:MaterialLayer}[]).some(o=>o.materialLayer?.definition.surfaceOnly),'Editable height-only owners survive project serialization');
  const targeted=core.getSelection() as LayerImage,initialMask=structuredClone(targeted.materialLayer),initialOrder=targeted.imageOrder,ownerCount=images('Skin_B').filter(image=>image.materialLayer).length;
  await core.updateMaterialLayerDefinition(targeted.id,{...reliefOnly,normalStrength:1.25});
  assert.equal((core.getSelection() as LayerImage).id,targeted.id,'The volume workshop updates the existing owner instead of adding a global layer');
  assert.equal(images('Skin_B').filter(image=>image.materialLayer).length,ownerCount);assert.deepEqual(targeted.materialLayer!.regions,initialMask!.regions);assert.deepEqual(targeted.materialLayer!.exclusions,initialMask!.exclusions);
  assert.equal(targeted.imageOrder,initialOrder,'The owner keeps its position in the paint stack');
  await assert.rejects(()=>core.updateMaterialLayerDefinition('missing-owner',reliefOnly),/indisponible/);
} finally {
  core.commitMaterialLayers();
  for (const state of states.values()) { await state.canvas.dispose(); state.textureEl.width = state.textureEl.height = 0; }
}
console.log('Tous les tests des calques de matériau passent.');


