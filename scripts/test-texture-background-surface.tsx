import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getEnv } from 'fabric/node';
import { FabricImage, StaticCanvas, Rect, setEnv } from 'fabric';
import { createTextureBackground, readTextureBackground, syncTextureBackgroundCanvas, updateTextureBackground, validTextureBackgroundSettings, DEFAULT_BACKGROUND_PLACEMENT } from '../src/editor/textureBackground';
import { EditorCore } from '../src/editor/EditorCore';
import type { ProjectionTriangle, Vec3 } from '../src/three/decalProjection';
import { createBaseSkinProject } from '../src/baseSkin';
import { readProjectFile, validateProjectDocument, writeProjectFile } from '../src/projectFile';
import { decodeDDS, encodeDDS } from '../src/dds';

registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
const { TextureBackgroundControls } = await import('../src/ui/TextureBackgroundControls');

setEnv(getEnv());
Object.assign(globalThis, { React, document: getEnv().document, window: getEnv().window,
  HTMLImageElement: getEnv().window.HTMLImageElement, HTMLCanvasElement: getEnv().window.HTMLCanvasElement,
  IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
const source = document.createElement('canvas'); source.width = 128; source.height = 64;
const ctx = source.getContext('2d')!, pixels = ctx.createImageData(128, 64);
for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) pixels.data.set([x * 2, y * 4, 30, 255], (y * 128 + x) * 4);
ctx.putImageData(pixels, 0, 0); const original = source.toDataURL();
const image = () => FabricImage.fromURL(original);
const pixel = (canvas: HTMLCanvasElement, u: number, v: number) => [...canvas.getContext('2d')!.getImageData(Math.floor(u * canvas.width), Math.floor(v * canvas.height), 1, 1).data];
const geometry: ProjectionTriangle[] = [];
for (let segment = 0; segment < 16; segment++) {
  const a = -Math.PI / 2 + segment * Math.PI / 16, b = a + Math.PI / 16;
  const points: Vec3[] = [[Math.sin(a), Math.cos(a), -1], [Math.sin(b), Math.cos(b), -1], [Math.sin(b), Math.cos(b), 1], [Math.sin(a), Math.cos(a), 1]];
  const left = segment < 8 ? .05 + segment * .05 : .55 + (segment - 8) * .05;
  const uv = [[left, .9], [left + .05, .9], [left + .05, .1], [left, .1]];
  for (const ids of [[0, 1, 2], [0, 2, 3]]) geometry.push({ family: 'skin', points: ids.map(i => points[i]) as ProjectionTriangle['points'],
    normals: ids.map(i => [points[i][0], points[i][1], 0]) as ProjectionTriangle['points'], uv: ids.map(i => uv[i]) as ProjectionTriangle['uv'] });
}
const settings = { name: 'Dégradé.png', fit: 'cover' as const, colorOpacity: 0, projection: 'surface' as const };
const canvas = new StaticCanvas(undefined, { width: 256, height: 256, backgroundColor: '#ffffff', enableRetinaScaling: false, renderOnAddRemove: false });
try {
  canvas.backgroundImage = createTextureBackground(await image(), 256, 256, '#ffffff', settings, geometry); syncTextureBackgroundCanvas(canvas);
  const rendered = () => { canvas.renderAll(); return canvas.getElement(); };
  const left = pixel(rendered(), .44, .5), right = pixel(rendered(), .56, .5);
  assert(Math.abs(left[0] - right[0]) < 10, 'Disconnected body UV charts share the same image at their physical seam');
  assert.deepEqual(pixel(rendered(), .01, .01), [255, 255, 255, 255], 'Only the actual body surface receives the image');
  assert.equal(canvas.getObjects().length, 0, 'The projected background remains below selectable layers');
  const before = pixel(rendered(), .2, .4);
  updateTextureBackground(canvas, { placement: { scale: 1, angle: 90, offsetX: 0, offsetY: 0 } }, geometry);
  const rotated = pixel(rendered(), .2, .4); assert.notDeepEqual(rotated, before, 'Rotation changes the surface image');
  updateTextureBackground(canvas, { placement: { scale: 2, angle: 0, offsetX: 0, offsetY: 0 } }, geometry);
  assert.notDeepEqual(pixel(rendered(), .2, .4), before, 'Zoom changes the image without moving its UV mask');
  updateTextureBackground(canvas, { placement: { scale: 1, angle: 0, offsetX: 200, offsetY: 100 } }, geometry);
  const moved = pixel(rendered(), .2, .4);
  assert.notEqual(moved[0], before[0], 'Horizontal placement changes the source X coordinate');
  assert.notEqual(moved[1], before[1], 'Vertical placement changes the source Y coordinate');
  updateTextureBackground(canvas, { colorOpacity: .5 });
  const blended = pixel(rendered(), .2, .4); assert(Math.abs(blended[0] - (moved[0] + 255) / 2) <= 1);
  updateTextureBackground(canvas, { fit: 'contain' }, geometry);
  assert.equal(readTextureBackground(canvas)!.placement!.offsetX, 200, 'Changing fit preserves placement');
  assert.equal(readTextureBackground(canvas)!.src, original, 'The original image stays editable and unmodified');
  const clone = new StaticCanvas(undefined, { width: 256, height: 256, enableRetinaScaling: false });
  try {
    await clone.loadFromJSON(canvas.toObject(['textureBackground'])); syncTextureBackgroundCanvas(clone); clone.renderAll();
    assert.deepEqual(readTextureBackground(clone), readTextureBackground(canvas));
    assert.deepEqual(pixel(clone.getElement(), .2, .4), pixel(rendered(), .2, .4), 'Restoration keeps the projected bitmap and overlay');
  } finally { await clone.dispose(); }
  const current = canvas.backgroundImage;
  updateTextureBackground(canvas, { placement: { scale: NaN, angle: 0, offsetX: 0, offsetY: 0 } }, geometry);
  assert.equal(canvas.backgroundImage, current, 'Invalid placement cannot mutate the background');
  assert.throws(() => createTextureBackground(new FabricImage(source), 256, 256, '#ffffff', settings, []), /carrosserie 3D/);
} finally { await canvas.dispose(); }
for (const placement of [null, [], {}, { ...DEFAULT_BACKGROUND_PLACEMENT, scale: Infinity }, { ...DEFAULT_BACKGROUND_PLACEMENT, scale: 0 }, { ...DEFAULT_BACKGROUND_PLACEMENT, angle: 181 }, { ...DEFAULT_BACKGROUND_PLACEMENT, offsetX: 2049 }, { ...DEFAULT_BACKGROUND_PLACEMENT, external: 'https://example.com' }]) {
  assert(!validTextureBackgroundSettings({ ...settings, placement }));
}
for (const projection of ['uv', '__proto__', {}]) assert(!validTextureBackgroundSettings({ ...settings, projection }));
assert(!validTextureBackgroundSettings({ ...settings, layout: 'independent-v1' }));

const host = document.createElement('div'); document.body.append(host); const core = new EditorCore(host);
const internal = core as unknown as { loadEditableImage(file: File): Promise<FabricImage> };
internal.loadEditableImage = image;
try {
  core.materialGeometry = () => geometry;
  await core.setTextureBackgroundFromFile({ name: 'Dégradé.png' } as File);
  assert.equal(core.getTextureBackground()!.projection, 'surface', 'Body imports use surface following by default');
  core.setTextureBackgroundPlacement({ scale: 1.2 }); core.setTextureBackgroundPlacement({ scale: 1.4 }); core.endHistoryCoalescing();
  await core.undo(); assert.equal(core.getTextureBackground()!.placement, undefined, 'One undo cancels the complete zoom gesture');
  await core.redo(); assert.equal(core.getTextureBackground()!.placement!.scale, 1.4);
  core.setTextureBackgroundPlacement({ angle: 35, offsetX: 120, offsetY: -90 }); core.endHistoryCoalescing();
  await core.setTextureBackgroundFromFile({ name: 'Remplacement.png' } as File);
  assert.deepEqual(core.getTextureBackground()!.placement, { scale: 1.4, angle: 35, offsetX: 120, offsetY: -90 });
  core.setBackgroundColor('#123456'); core.setBackgroundColorOpacity(.25); core.endHistoryCoalescing();
  const destinationLayer = new Rect({ left: 30, top: 30, width: 20, height: 20, fill: '#ff0000' }); core.getCanvas('Skin_R').add(destinationLayer);
  const sourceInfo = core.getTextureBackground();
  await core.copyTextureBackgroundToMap('Skin_B', 'Skin_R'); await core.copyTextureBackgroundToMap('Skin_B', 'Skin_I');
  for (const target of ['Skin_R', 'Skin_I'] as const) {
    assert.deepEqual(readTextureBackground(core.getCanvas(target)), sourceInfo, `${target} receives the editable original and every background setting`);
    assert.equal(core.getCanvas(target).backgroundColor, '#123456');
    assert.notEqual(core.getCanvas(target).backgroundImage, core.getCanvas('Skin_B').backgroundImage, 'The copy can be edited independently');
  }
  assert(core.getCanvas('Skin_R').getObjects().includes(destinationLayer), 'Copying the background preserves destination layers');
  core.setActiveMap('Skin_R'); await core.undo(); assert.equal(core.getTextureBackground(), null, 'One undo restores the previous destination background');
  await core.redo(); assert.equal(core.getTextureBackground()!.placement!.angle, 35);
  core.setTextureBackgroundPlacement({ angle: -20 }); core.endHistoryCoalescing();
  assert.equal(readTextureBackground(core.getCanvas('Skin_B'))!.placement!.angle, 35, 'Editing a copy does not modify the source'); core.setActiveMap('Skin_B');
  await assert.rejects(() => core.copyTextureBackgroundToMap('Skin_B', 'Details_R'), /même surface/);
  await core.setTextureBackgroundFromFile({ name: 'Détails.png' } as File, 'Details_B');
  assert.equal(readTextureBackground(core.getCanvas('Details_B'))!.projection, undefined, 'Other surfaces keep their existing atlas placement');
  const capture = await core.captureProject(), bundle = createBaseSkinProject({ position: [3, 2, 4], target: [0, .5, 0] });
  bundle.document.editor = { maps: capture.maps, speedColor: capture.speedColor, illumRole: capture.illumRole };
  for (const [path, blob] of capture.assets) {
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new (getEnv().window.FileReader)(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
    bundle.assets.set(path, new Uint8Array(bytes));
  }
  validateProjectDocument(bundle.document, new Set(bundle.assets.keys()));
  const reopened = await readProjectFile(await writeProjectFile(bundle)); assert.deepEqual(reopened.document, bundle.document);
  const maps = structuredClone(reopened.document.editor.maps);
  const hydrate = (node: unknown) => { if (!node || typeof node !== 'object') return; const record = node as Record<string, unknown>;
    if (typeof record.src === 'string') record.src = `data:image/png;base64,${Buffer.from(reopened.assets.get(record.src)!).toString('base64')}`;
    for (const value of Object.values(record)) if (value && typeof value === 'object') hydrate(value); };
  hydrate(maps); await core.loadProject(maps, reopened.document.editor);
  assert.deepEqual(core.getTextureBackground()!.placement, { scale: 1.4, angle: 35, offsetX: 120, offsetY: -90 });
  const output = core.getCanvas('Skin_B').toCanvasElement(.125), data = output.getContext('2d')!.getImageData(0, 0, output.width, output.height);
  const dds = decodeDDS(encodeDDS(data, 'BC1'))!;
  const p = pixel(output, .2, .4), offset = (Math.floor(output.height * .4) * output.width + Math.floor(output.width * .2)) * 4;
  assert(Math.abs(dds.data[offset] - p[0]) < 12, 'The transformed image reaches DDS export');
  const previous = core.getCanvas('Skin_B').backgroundImage;
  core.materialGeometry = () => geometry.map(triangle => ({ ...triangle, uv: triangle.uv.map(([u, v]) => [1 - u, v]) as ProjectionTriangle['uv'] }));
  core.rebuildProjectionsForModel(); assert.notEqual(core.getCanvas('Skin_B').backgroundImage, previous, 'Changing the model rebuilds the image from its original');
  assert.equal(core.getTextureBackground()!.placement!.angle, 35);
  core.batch('Skin_B', { clear: true }, c => { c.backgroundImage = createTextureBackground(new FabricImage(source), c.width, c.height, '#ffffff', { name: 'Ancien.png', fit: 'stretch', colorOpacity: .3 }); });
  await core.followBodyWithTextureBackground(); assert.equal(core.getTextureBackground()!.projection, 'surface'); assert.equal(core.getTextureBackground()!.fit, 'cover');
  await core.undo(); assert.equal(core.getTextureBackground()!.projection, undefined, 'Adapting a legacy background is undoable');
  core.materialGeometry = () => [];
  const unchanged = core.getCanvas('Skin_B').backgroundImage;
  await assert.rejects(() => core.setTextureBackgroundFromFile({ name: 'Sans modèle.png' } as File), /carrosserie 3D/);
  assert.equal(core.getCanvas('Skin_B').backgroundImage, unchanged, 'A missing model leaves the existing image intact');
} finally { core.dispose(); host.remove(); }

const uiHost = document.createElement('div'); document.body.append(uiHost); const root = createRoot(uiHost);
const placements: unknown[] = [], copies: string[] = []; let follows = 0;
const props = { mapId: 'Skin_B' as const, disabled: false, onChoose() {}, onRemove() {}, onFit() {}, onOpacity() {}, onCommit() {}, onFollowBody() { follows++; }, onPlacement(value: unknown) { placements.push(value); }, onCopyBackground(target: string) { copies.push(target); } };
try {
  await act(async () => root.render(<TextureBackgroundControls {...props} background={{ ...settings, src: original }} />));
  for (const label of ['Zoom de l’image', 'Rotation de l’image', 'Position horizontale', 'Position verticale']) assert(uiHost.querySelector(`input[aria-label="${label}"]`));
  assert(!uiHost.textContent!.includes('Étirer'), 'Surface placement only offers fits that preserve image proportions');
  await act(async () => (uiHost.querySelector('.texture-background-placement button') as HTMLButtonElement).click());
  assert.deepEqual(placements, [DEFAULT_BACKGROUND_PLACEMENT]);
  for (const button of uiHost.querySelectorAll('.texture-background-copy button')) await act(async () => (button as HTMLButtonElement).click());
  assert.deepEqual(copies.sort(), ['Skin_I', 'Skin_R']);
  await act(async () => root.render(<TextureBackgroundControls {...props} background={{ name: 'Ancien.png', fit: 'cover', colorOpacity: 0, src: original }} />));
  const adapt = [...uiHost.querySelectorAll('button')].find(button => button.textContent === 'Adapter à la carrosserie')!;
  await act(async () => adapt.click()); assert.equal(follows, 1);
  await act(async () => root.render(<TextureBackgroundControls {...props} disabled background={{ ...settings, src: original }} />));
  assert([...uiHost.querySelectorAll('input, button')].every(control => (control as HTMLInputElement).disabled), 'Busy controls cannot change placement');
} finally { await act(async () => root.unmount()); uiHost.remove(); }
console.log('Surface backgrounds: curved seams, zoom/rotation/offset, opacity, defaults, undo/redo, original sources, projects, DDS, model refresh, legacy adaptation, UI and validation OK.');
