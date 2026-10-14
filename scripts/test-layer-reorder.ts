import assert from 'node:assert/strict';
import { Canvas, FabricImage, Rect, setEnv, type FabricObject } from 'fabric';
import { getEnv } from 'fabric/node';
import { EditorCore } from '../src/editor/EditorCore';
import { MAPS, type MapId } from '../src/maps';
import { createMaterialDefinition, type MaterialLayer } from '../src/materials/types';

setEnv(getEnv());
const env = getEnv();
Object.assign(globalThis, { document: env.document, window: env.window, MouseEvent: env.window.MouseEvent,
  HTMLElement: env.window.HTMLElement, HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement });
type Tagged = FabricObject & { id: string; mirrorOf?: string; linkedImageId?: string; imageOrder?: number; materialLayer?: MaterialLayer };
const states = new Map(MAPS.map(def => {
  const canvas = new Canvas(undefined, { width: def.workRes, height: def.workRes, backgroundColor: def.defaultFill,
    renderOnAddRemove: false, enableRetinaScaling: false });
  const textureEl = document.createElement('canvas'); textureEl.width = textureEl.height = 1;
  return [def.id, { canvas, el: canvas.lowerCanvasEl, textureEl, suspendHistory: false, textureDirty: true,
    baseline: '', undo: [] as string[], redo: [] as string[], coalesceKey: null }];
}));
const core = Object.create(EditorCore.prototype) as EditorCore;
Object.assign(core, { maps: states, activeMap: 'Skin_B', tool: 'select', symmetry: false, carAligned: true,
  blenderParts: [], listeners: new Map(), illumToolRole: 'brake', speedLightColor: '#ffffff',
  projectionSources: new Map(), projectionBakes: new Map(), materialBakes: new Map(), materialSurfaces: [],
  materialInteractive: false, materialUpdateSequence: 0, textureResolution: 1024,
  illumRoles: new Map(), importedRoleMasks: new WeakMap(), previewDirty: new Set(), previewUpdates: new Set(),
  flushTexture: () => {}, isPanning: () => false, setActiveMap: (id: MapId) => { core.activeMap = id; } });
const internals = core as unknown as { wireCanvas(id: MapId, state: unknown): void };
for (const def of MAPS) internals.wireCanvas(def.id, states.get(def.id)!);
const state = states.get('Skin_B')!, canvas = state.canvas;
const rect = (id: string) => Object.assign(new Rect({ width: 20, height: 20, fill: '#123456' }), { id, name: id }) as Tagged;
const layers = () => core.getLayers().map(layer => layer.id);
const objects = (id: MapId) => states.get(id)!.canvas.getObjects() as Tagged[];
const reset = (...layers: Tagged[]) => {
  canvas.discardActiveObject(); state.suspendHistory = true;
  try { canvas.remove(...canvas.getObjects()); canvas.add(...layers); } finally { state.suspendHistory = false; }
  core.resetMapBaseline('Skin_B');
};
try {
  reset(rect('a'), rect('b'), rect('c'), rect('d'), rect('e'));
  canvas.setActiveObject(canvas.getObjects()[0]);
  const selection = core.getSelection(), history = state.undo.length;
  assert(core.moveLayerRelative('a', 'e', 'before'));
  assert.deepEqual(layers(), ['a', 'e', 'd', 'c', 'b'], 'Dragging upward uses top-first visible order');
  assert.equal(core.getSelection(), selection, 'Reordering retains the current selection');
  assert.equal(state.undo.length, history + 1, 'One completed drag adds exactly one undo step');
  assert(state.textureDirty, 'Changing stacking publishes the changed texture');
  await core.undo(); assert.deepEqual(layers(), ['e', 'd', 'c', 'b', 'a']);
  await core.redo(); assert.deepEqual(layers(), ['a', 'e', 'd', 'c', 'b']);
  assert(core.moveLayerRelative('a', 'c', 'after'));
  assert.deepEqual(layers(), ['e', 'd', 'c', 'a', 'b'], 'Dragging downward inserts after its target');
  assert(core.moveLayerRelative('b', 'd', 'after'));
  assert.deepEqual(layers(), ['e', 'd', 'b', 'c', 'a']);
  assert(core.moveLayerRelative('e', 'a', 'after'));
  assert.deepEqual(layers(), ['d', 'b', 'c', 'a', 'e'], 'The last row accepts a drop below it');
  const unchanged = state.undo.length;
  assert.equal(core.moveLayerRelative('d', 'b', 'before'), false);
  assert.equal(core.moveLayerRelative('a', 'a', 'after'), false);
  assert.equal(core.moveLayerRelative('missing', 'a', 'before'), false);
  assert.equal(core.moveLayerRelative('a', 'missing', 'before'), false);
  states.get('Wheels_B')!.canvas.add(rect('other-map'));
  assert.equal(core.moveLayerRelative('a', 'other-map', 'before'), false, 'Ids from another channel are rejected');
  assert.equal(core.moveLayerRelative('a', 'd', 'invalid' as 'before'), false);
  assert.equal(state.undo.length, unchanged, 'No-op and invalid drops leave history untouched');
  const locked = canvas.getObjects().find(object => (object as Tagged).id === 'e')!;
  locked.set({ selectable: false, evented: false, visible: false });
  assert(core.moveLayerRelative('e', 'd', 'before'), 'Hidden or locked layers can still be reordered');
  assert.equal(layers()[0], 'e');
  console.log('ok arbitrary before/after insertion, endpoints, selection, one-step undo/redo, validation and locked layers');

  const a = rect('a'), mirrorA = Object.assign(rect('mirror-a'), { mirrorOf: 'a' }); a.mirrorOf = mirrorA.id;
  const b = rect('b'), mirrorB = Object.assign(rect('mirror-b'), { mirrorOf: 'b' }); b.mirrorOf = mirrorB.id;
  reset(a, mirrorA, rect('middle'), b, mirrorB, rect('top'));
  core.symmetry = true;
  assert(core.moveLayerRelative('a', 'b', 'before'));
  assert.deepEqual(layers(), ['top', 'mirror-a', 'a', 'mirror-b', 'b', 'middle'], 'Both linked mirrors move above the target mirror pair');
  const pairedHistory = state.undo.length;
  assert.equal(core.moveLayerRelative('a', 'mirror-a', 'after'), false);
  assert.equal(state.undo.length, pairedHistory, 'Dropping onto the same pair is a no-op');
  core.moveLayer('a', 'down'); assert.deepEqual(layers(), ['top', 'mirror-b', 'b', 'mirror-a', 'a', 'middle']);
  core.moveLayer('a', 'top'); assert.deepEqual(layers().slice(0, 2), ['mirror-a', 'a']);
  core.moveLayer('a', 'bottom'); assert.deepEqual(layers().slice(-2), ['mirror-a', 'a']);
  const bottomHistory = state.undo.length; core.moveLayer('a', 'down'); assert.equal(state.undo.length, bottomHistory);
  core.symmetry = false;
  assert(core.moveLayerRelative('a', 'top', 'before'));
  assert.equal(layers().indexOf('mirror-a'), layers().length - 1, 'Disabling symmetry allows independent mirror ordering');
  console.log('ok mirror groups, mirror drop rejection and arrows share the same reorder operation');

  reset();
  const firstDefinition = createMaterialDefinition(); firstDefinition.name = 'First'; firstDefinition.roughness = 30;
  firstDefinition.coat = 50; firstDefinition.dirt = 70; firstDefinition.emissionStrength = .4;
  await core.addMaterialLayer(firstDefinition);
  const first = core.getSelection() as Tagged;
  const artwork = rect('artwork'); canvas.add(artwork);
  const secondDefinition = createMaterialDefinition(); secondDefinition.name = 'Second'; secondDefinition.roughness = 180;
  secondDefinition.coat = 190; secondDefinition.dirt = 210; secondDefinition.emissionStrength = .4;
  await core.addMaterialLayer(secondDefinition);
  const second = core.getSelection() as Tagged;
  const children = (id: MapId) => objects(id).filter(object => object.linkedImageId).map(object => object.linkedImageId);
  const channels = ['Skin_R', 'Skin_CoatR', 'Skin_I', 'Skin_DirtMask'] as const;
  for (const id of channels) assert.deepEqual(children(id), [first.id, second.id]);
  const materialHistory = state.undo.length;
  const channelHistory = channels.map(id => states.get(id)!.undo.length);
  assert(core.moveLayerRelative(first.id, second.id, 'before'));
  assert.deepEqual(layers(), [first.id, second.id, artwork.id]);
  for (const id of channels) assert.deepEqual(children(id), [second.id, first.id], 'Linked finish channels follow their owner order');
  assert.equal(state.undo.length, materialHistory + 1);
  assert.deepEqual(channels.map(id => states.get(id)!.undo.length), channelHistory, 'Generated channels add no independent undo entry');
  await core.undo(); assert.deepEqual(layers(), [second.id, artwork.id, first.id]);
  for (const id of channels) assert.deepEqual(children(id), [first.id, second.id]);
  await core.redo(); for (const id of channels) assert.deepEqual(children(id), [second.id, first.id]);
  const snapshot = JSON.parse(state.undo.at(-1)!);
  assert.deepEqual(snapshot.objects.map((object: Tagged) => object.id), [artwork.id, second.id, first.id]);
  assert(snapshot.objects.find((object: Tagged) => object.id === first.id).imageOrder >
    snapshot.objects.find((object: Tagged) => object.id === second.id).imageOrder, 'Persistent owner ranks agree with canvas stacking');
  core.setActiveMap('Skin_R');
  const child = objects('Skin_R').find(object => object.linkedImageId === first.id)!;
  const childTarget = objects('Skin_R').find(object => object.linkedImageId === second.id)!;
  const derivedHistory = states.get('Skin_R')!.undo.length;
  assert.equal(core.moveLayerRelative(child.id, childTarget.id, 'after'), false);
  assert.equal(states.get('Skin_R')!.undo.length, derivedHistory, 'Generated material layers cannot diverge from the owner');
  core.setActiveMap('Skin_B');
  console.log('ok material owner order, linked finishes, persistent ranks and one local undo/redo');

  // Timestamp orders around 1e15 have only eight representable values per unit.
  // Repeated midpoint moves must not silently tie and desynchronise finishes.
  const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = 1;
  const images = [0, .125, .25].map((offset, index) => Object.assign(new FabricImage(bitmap), {
    id: `rank-${index}`, imageOrder: 1e15 + offset,
  }) as Tagged);
  reset(...images);
  assert(core.moveLayerRelative('rank-0', 'rank-1', 'before'));
  assert.deepEqual(layers(), ['rank-2', 'rank-0', 'rank-1']);
  const orderedImages = canvas.getObjects() as Tagged[];
  assert(orderedImages[0].imageOrder! < orderedImages[1].imageOrder! && orderedImages[1].imageOrder! < orderedImages[2].imageOrder!);
  await core.undo(); assert.deepEqual(layers(), ['rank-2', 'rank-1', 'rank-0']);
  console.log('ok midpoint precision exhaustion rebalances local owners and remains undoable');
} finally {
  core.commitMaterialLayers();
  for (const item of states.values()) { await item.canvas.dispose(); item.textureEl.width = item.textureEl.height = 0; }
}
console.log('Tous les tests de réorganisation des calques passent.');
