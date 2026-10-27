import assert from 'node:assert/strict';
import { Canvas, Circle, FabricImage, Group, Rect, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { EditorCore } from '../src/editor/EditorCore';
import { MAPS } from '../src/maps';
import type { MaterialSurfaceOverlay } from '../src/materials/surfaceMaps';

setEnv(getEnv());
const env = getEnv();
Object.assign(globalThis, { document: env.document, window: env.window, HTMLElement: env.window.HTMLElement,
  HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement });
const solid = (color: string) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
  const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 4, 4); return canvas;
};
const states = new Map(MAPS.map(map => {
  const canvas = new Canvas(undefined, { width: 2048, height: 2048, backgroundColor: '#102030', renderOnAddRemove: false,
    enableRetinaScaling: false, preserveObjectStacking: true, skipOffscreen: true });
  return [map.id, { canvas, textureDirty: false, undo: ['existing undo'], redo: ['existing redo'] }];
}));
const wheel = states.get('Wheels_B')!.canvas, roughness = states.get('Wheels_R')!.canvas;
const background = new FabricImage(solid('#000080'), { left: 0, top: 0, scaleX: 512, scaleY: 512, opacity: .5 });
wheel.backgroundImage = background;
const below = new Rect({ left: 64, top: 64, width: 640, height: 640, strokeWidth: 0, fill: '#ff0000', opacity: .5 });
const edited = Object.assign(new FabricImage(solid('#ff00ff'), { left: 64, top: 64, scaleX: 160, scaleY: 160, opacity: .7 }), { id: 'edited' });
const above = new Rect({ left: 64, top: 64, width: 640, height: 640, strokeWidth: 0, fill: '#0000ff', opacity: .5 });
const hidden = new Rect({ left: 0, top: 0, width: 2048, height: 2048, fill: '#ffff00', visible: false });
const reference = Object.assign(new Rect({ left: 0, top: 0, width: 2048, height: 2048, fill: '#00ff00', selectable: false }), { referenceOnly: true });
const grouped = new Group([
  new Rect({ left: 0, top: 0, width: 200, height: 200, strokeWidth: 0, fill: '#00ff00', opacity: .7 }),
  Object.assign(new Rect({ left: 0, top: 0, width: 200, height: 200, fill: '#ff00ff' }), { referenceOnly: true }),
], { left: 1024, top: 1024, opacity: .6, objectCaching: true,
  clipPath: new Circle({ radius: 80, originX: 'center', originY: 'center' }) });
wheel.add(below, edited, above, hidden, grouped, reference);
const proxy = Object.assign(new FabricImage(solid('#ffff00'), { left: 64, top: 64, scaleX: 160, scaleY: 160 }), { id: 'roughness-proxy', linkedImageId: 'edited' });
roughness.add(new Rect({ left: 64, top: 64, width: 640, height: 640, strokeWidth: 0, fill: '#440000' }), proxy,
  new Rect({ left: 64, top: 64, width: 640, height: 640, strokeWidth: 0, fill: '#880000', opacity: .25 }));
const other = Object.assign(new FabricImage(solid('#ffffff'), { left: 1800, top: 1800 }), { id: 'other' });
const invisible = Object.assign(new FabricImage(solid('#ffffff'), { visible: false }), { id: 'invisible' });
wheel.add(other, invisible);
for (const state of states.values()) state.canvas.renderAll();
wheel.setActiveObject(edited);
const cache = (grouped as unknown as { _cacheCanvas?: HTMLCanvasElement })._cacheCanvas;
const cacheSize = cache ? [cache.width, cache.height] : undefined;
for (const state of states.values()) state.canvas.setViewportTransform([2.75, 0, 0, 2.75, -12000, -9000]);
const normal = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 255, 255]) };
const ownSurface: MaterialSurfaceOverlay = { family: 'wheels', normal }, otherSurface: MaterialSurfaceOverlay = { family: 'wheels', ao: normal };
const hiddenSurface: MaterialSurfaceOverlay = { family: 'wheels', normal };
const surfaces = [ownSurface, otherSurface, hiddenSurface];
const core = Object.create(EditorCore.prototype) as EditorCore;
let refreshes = 0, flushes = 0;
Object.assign(core, { maps: states, materialInteractive: true, materialSurfaces: surfaces,
  materialBakes: new Map([['edited', { surfaces: ownSurface }], ['other', { surfaces: otherSurface }], ['invisible', { surfaces: hiddenSurface }]]),
  refreshLinkedImages: () => { refreshes++; }, flushTexture: () => { flushes++; } });
Object.assign(core, { getPreviewIllumRoleCanvas: () => solid('#ffffff') });
const metadata = () => JSON.stringify([...states].map(([id, state]) => ({ id, scene: state.canvas.toJSON(), undo: state.undo,
  redo: state.redo, viewport: state.canvas.viewportTransform, skipOffscreen: state.canvas.skipOffscreen, dirty: state.textureDirty,
  objects: state.canvas.getObjects().map(object => ({ visible: object.visible, opacity: object.opacity, dirty: object.dirty })) })));
const before = metadata(), sourceViewport = wheel.viewportTransform, sourcePixels = wheel.lowerCanvasEl.toDataURL();
const pixel = (canvas: HTMLCanvasElement, x: number, y: number) => Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
const referencePixel = (...layers: [string, number][]) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  for (const [color, opacity] of layers) { context.globalAlpha = opacity; context.fillStyle = color; context.fillRect(0, 0, 1, 1); }
  return pixel(canvas, 0, 0);
};
const equalPixel = (actual: number[], expected: number[], message: string) => {
  assert(actual.every((value, i) => Math.abs(value - expected[i]) <= 1), `${message}: ${actual} != ${expected}`);
};
const snapshots = core.captureWheelDesignPreviewMaps('edited');
const unedited = core.captureWheelDesignPreviewMaps();
try {
  assert.equal(refreshes, 1); assert.equal(flushes, 1, 'Pending material painting is settled once before capture');
  assert.equal(snapshots.size, MAPS.length); assert.equal(unedited.size, MAPS.length);
  for (const { below, above } of snapshots.values()) assert.deepEqual([below.width, below.height, above.width, above.height], [512, 512, 512, 512]);
  const color = snapshots.get('Wheels_B')!;
  equalPixel(pixel(color.below, 32, 32), referencePixel(['#102030', 1], ['#000080', .5], ['#ff0000', .5]), 'Background image and lower paint retain their original colour and opacity');
  equalPixel(pixel(color.above, 32, 32), [0, 0, 255, 128], 'The upper layer stays separate and translucent');
  const groupCenter = grouped.getCenterPoint(), groupBounds = grouped.getBoundingRect();
  assert.equal(pixel(color.above, Math.round(groupCenter.x / 4), Math.round(groupCenter.y / 4))[3], 107, 'Clipped groups retain group and child opacity without tracing guides');
  assert.equal(pixel(color.above, Math.ceil(groupBounds.left / 4) + 1, Math.ceil(groupBounds.top / 4) + 1)[3], 0, 'Group clipping retains transparent corners');
  equalPixel(pixel(snapshots.get('Wheels_R')!.below, 32, 32), [68, 0, 0, 255], 'A linked material proxy is excluded at the same position as its owner');
  equalPixel(pixel(snapshots.get('Wheels_R')!.above, 32, 32), [136, 0, 0, 64], 'The finish layer above the edited owner remains above the live draft');
  equalPixel(pixel(snapshots.get('Skin_B')!.below, 32, 32), [16, 32, 48, 255], 'Other maps keep their complete existing paint');
  assert.equal(pixel(snapshots.get('Skin_B')!.above, 32, 32)[3], 0);
  assert.equal(pixel(unedited.get('Wheels_B')!.above, 32, 32)[3], 0, 'A new artwork is placed above the complete existing stack');
  assert.notDeepEqual(pixel(unedited.get('Wheels_B')!.below, 32, 32), pixel(color.below, 32, 32), 'New and edited sessions differ: an edited artwork is never painted twice');
  assert.equal(wheel.viewportTransform, sourceViewport, 'Capture never replaces the live viewport array');
  assert.equal(wheel.lowerCanvasEl.toDataURL(), sourcePixels, 'The visible editor backing store is unchanged');
  assert.equal(wheel.getActiveObject(), edited);
  assert.equal(metadata(), before, 'Scene hashes, visibility, opacity, viewports, dirty flags and undo histories stay unchanged');
  assert.equal((grouped as unknown as { _cacheCanvas?: HTMLCanvasElement })._cacheCanvas, cache);
  assert.deepEqual(cache ? [cache.width, cache.height] : undefined, cacheSize, 'Existing object caches are neither reused nor resized by detached rendering');
  assert.equal(core.getMaterialSurfaceOverlays(), surfaces, 'Existing main-preview overlay calls retain their exact array');
  assert.deepEqual(core.getMaterialSurfaceOverlays('edited'), [otherSurface], 'The old normal/AO owner and invisible owners do not ghost into the workshop');
  assert.equal(metadata(), before);
  color.below.width = 1;
  assert.equal(wheel.width, 2048, 'Releasing a detached snapshot cannot release the editor canvas');
  console.log('✓ Wheel workshop snapshots: owner/proxy exclusion, real stack/opacity/background/clipping, offscreen pan, immutable editor/cache/history and separate normal/AO owners');
} finally {
  for (const map of [snapshots, unedited]) for (const { below, above } of map.values()) below.width = below.height = above.width = above.height = 1;
  for (const state of states.values()) await state.canvas.dispose();
}
