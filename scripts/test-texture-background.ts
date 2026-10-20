import assert from 'node:assert/strict';
import { getEnv } from 'fabric/node';
import { FabricImage, Rect, StaticCanvas, setEnv, type Canvas } from 'fabric';
import { createTextureBackground, readTextureBackground, syncTextureBackgroundCanvas, updateTextureBackground } from '../src/editor/textureBackground';
import { EditorCore } from '../src/editor/EditorCore';
import { createBaseSkinProject } from '../src/baseSkin';
import { MAPS, type MapId } from '../src/maps';
import { readProjectFile, validateProjectDocument, writeProjectFile } from '../src/projectFile';
import { decodeDDS, encodeDDS } from '../src/dds';
import { roleAlpha } from '../src/illumination';

setEnv(getEnv());
Object.assign(globalThis, {
  document: getEnv().document, window: getEnv().window,
  HTMLImageElement: getEnv().window.HTMLImageElement, HTMLCanvasElement: getEnv().window.HTMLCanvasElement,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
const source = document.createElement('canvas'); source.width = 64; source.height = 32;
const context = source.getContext('2d')!;
context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 32);
context.fillStyle = '#00ff00'; context.fillRect(16, 0, 32, 32);
context.fillStyle = '#0000ff'; context.fillRect(48, 0, 16, 32);
const original = source.toDataURL();
const image = () => FabricImage.fromURL(original);
const pixel = (canvas: HTMLCanvasElement, x: number, y: number) => [...canvas.getContext('2d')!.getImageData(x, y, 1, 1).data];
const small = new StaticCanvas(undefined, { width: 32, height: 32, backgroundColor: '#ffffff', enableRetinaScaling: false, renderOnAddRemove: false });
try {
  small.backgroundImage = createTextureBackground(await image(), 32, 32, '#ffffff', { name: 'Bandes.png', fit: 'cover', colorOpacity: 0 });
  syncTextureBackgroundCanvas(small);
  const rendered = () => { small.renderAll(); return small.getElement(); };
  assert.deepEqual(pixel(rendered(), 0, 0), [0, 255, 0, 255], 'Centered cover has no half-pixel seam at atlas edges');
  assert.deepEqual(pixel(rendered(), 31, 31), [0, 255, 0, 255]);
  assert.equal(small.getObjects().length, 0, 'The background cannot intercept layer selection or appear as an ordinary layer');
  updateTextureBackground(small, { colorOpacity: .5 });
  assert.deepEqual(pixel(rendered(), 16, 16), [128, 255, 128, 255], 'The color blends above the image');
  updateTextureBackground(small, { colorOpacity: 1 });
  assert.deepEqual(pixel(rendered(), 16, 16), [255, 255, 255, 255]);
  const sticker = new Rect({ left: 12, top: 12, width: 8, height: 8, strokeWidth: 0, fill: '#ffff00', originX: 'left', originY: 'top' });
  small.add(sticker);
  assert.deepEqual(pixel(rendered(), 16, 16), [255, 255, 0, 255], 'Ordinary layers remain above both backgrounds');
  small.remove(sticker); sticker.dispose();
  updateTextureBackground(small, { fit: 'contain', colorOpacity: 0 });
  assert.deepEqual(pixel(rendered(), 1, 1), [255, 255, 255, 255], 'Contain uses the existing fill for margins');
  assert.deepEqual(pixel(rendered(), 1, 16), [255, 0, 0, 255]);
  assert.deepEqual(pixel(rendered(), 30, 16), [0, 0, 255, 255]);
  updateTextureBackground(small, { fit: 'stretch' });
  assert.deepEqual(pixel(rendered(), 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(rendered(), 30, 30), [0, 0, 255, 255]);
  small.setViewportTransform([2, 0, 0, 2, -16, 0]);
  assert.deepEqual(pixel(rendered(), 1, 16), [0, 255, 0, 255], 'The image follows the texture zoom and pan');
  const data = small.toObject(['textureBackground']);
  const restored = new StaticCanvas(undefined, { width: 32, height: 32, enableRetinaScaling: false });
  try {
    await restored.loadFromJSON(data); syncTextureBackgroundCanvas(restored);
    assert.equal(restored.backgroundVpt, true);
    assert.deepEqual(readTextureBackground(restored), { name: 'Bandes.png', fit: 'stretch', colorOpacity: 0, src: original });
  } finally { await restored.dispose(); }
  assert.equal(source.toDataURL(), original, 'Cropping and color blending leave original pixels intact');
} finally { await small.dispose(); }

const host = document.createElement('div'); document.body.append(host);
const core = new EditorCore(host);
const internal = core as unknown as {
  loadEditableImage(file: File): Promise<FabricImage>;
  renderTextureCanvas(id: MapId, target: HTMLCanvasElement, resolution: number, roles: Map<MapId, HTMLCanvasElement>): boolean;
};
const roles = new Map<MapId, HTMLCanvasElement>();
try {
  await assert.rejects(() => core.setTextureBackgroundFromFile({ size: 33 * 1024 * 1024, type: 'image/png' } as File), /32 Mo/);
  await assert.rejects(() => core.setTextureBackgroundFromFile({ size: 10, type: 'audio/wav' } as File), /fichier image/);
  // Actual browser decoding is checked in the desktop UI; use deterministic PNGs
  // here because JSDOM cannot read browser blob: URLs.
  internal.loadEditableImage = image;
  const file = { name: 'Bandes.png' } as File;
  let resolveImage!: (image: FabricImage) => void;
  internal.loadEditableImage = () => new Promise((resolve) => { resolveImage = resolve; });
  const pending = core.setTextureBackgroundFromFile(file, 'Details_B');
  core.setActiveMap('Wheels_B'); resolveImage(await image()); await pending;
  assert(readTextureBackground(core.getCanvas('Details_B')));
  assert.equal(readTextureBackground(core.getCanvas('Wheels_B')), null, 'An asynchronous import stays on the chosen texture');
  assert.equal(core.activeMap, 'Wheels_B', 'Import never switches the active texture');
  core.setActiveMap('Skin_B'); internal.loadEditableImage = image;
  const count = core.getLayers().length;
  for (const map of MAPS) {
    await core.setTextureBackgroundFromFile(file, map.id);
    assert.equal(readTextureBackground(core.getCanvas(map.id))!.colorOpacity, 0);
  }
  assert.equal(core.getLayers().length, count);
  core.setBackgroundColor('#ffffff'); core.endHistoryCoalescing();
  core.setBackgroundColorOpacity(.25); core.setBackgroundColorOpacity(.5); core.endHistoryCoalescing();
  await core.undo(); assert.equal(core.getTextureBackground()!.colorOpacity, 0, 'One undo cancels a complete opacity gesture');
  await core.redo(); assert.equal(core.getTextureBackground()!.colorOpacity, .5);
  core.setTextureBackgroundFit('stretch');
  const output = document.createElement('canvas');
  const canvas = core.getCanvas('Skin_B');
  canvas.setViewportTransform([1.7, 0, 0, 1.7, -110, -85]);
  const viewport = [...canvas.viewportTransform];
  const render = () => assert(internal.renderTextureCanvas('Skin_B', output, 32, roles));
  render();
  assert.deepEqual(pixel(output, 1, 1), [255, 128, 128, 255], 'The export composes the source and color at texture coordinates');
  assert.deepEqual(canvas.viewportTransform, viewport, 'Export does not move the editor viewport');
  const expected = output.getContext('2d')!.getImageData(0, 0, 32, 32);
  const dds = decodeDDS(encodeDDS(expected, 'BC1'))!;
  assert(dds.data[0] > 245 && Math.abs(dds.data[1] - 128) < 8, 'The background reaches DDS encoding');
  const normalRender = canvas.toCanvasElement;
  canvas.toCanvasElement = () => { throw new Error('Force fallback'); };
  render();
  assert.deepEqual(output.getContext('2d')!.getImageData(0, 0, 32, 32).data, expected.data, 'Fallback composes the same group, crop and opacity');
  canvas.toCanvasElement = normalRender;
  core.setBackgroundColor('#000000'); core.endHistoryCoalescing(); render();
  assert.deepEqual(pixel(output, 1, 1), [127, 0, 0, 255], 'Changing the color updates the overlay above the image');
  core.removeTextureBackground(); assert.equal(core.getTextureBackground(), null); assert.equal(canvas.backgroundVpt, false);
  await core.undo(); assert.equal(core.getTextureBackground()!.name, file.name); assert.equal(canvas.backgroundVpt, true);
  assert.equal((canvas.backgroundImage as unknown as { canvas: Canvas }).canvas, canvas, 'Undo reconnects background ownership');
  core.setTextureBackgroundFit('contain'); core.setBackgroundColorOpacity(.4); core.endHistoryCoalescing();
  await core.setTextureBackgroundFromFile({ name: 'Remplacement.png' } as File);
  assert.equal(core.getTextureBackground()!.fit, 'contain'); assert.equal(core.getTextureBackground()!.colorOpacity, .4, 'Replacing keeps framing and overlay settings');

  core.setActiveMap('Wheels_I'); core.setIllumBackgroundRole('brake'); core.setActiveMap('Skin_B');
  assert(internal.renderTextureCanvas('Wheels_I', output, 32, roles));
  assert.equal(pixel(roles.get('Wheels_I')!, 5, 5)[0], roleAlpha('brake'), 'Illuminated background keeps its selected brake behavior');
  const capture = await core.captureProject();
  const bundle = createBaseSkinProject({ position: [3, 2, 4], target: [0, .5, 0] });
  bundle.document.editor = { maps: capture.maps, speedColor: capture.speedColor, illumRole: capture.illumRole };
  for (const [path, blob] of capture.assets) {
    // Canvas in JSDOM returns its own Blob implementation.
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const Reader = getEnv().window.FileReader; const reader = new Reader();
      reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
    });
    bundle.assets.set(path, new Uint8Array(bytes));
    const png = new DataView(bytes);
    assert.equal(png.getUint32(16), 64); assert.equal(png.getUint32(20), 32, 'Original PNG resolution is preserved');
  }
  validateProjectDocument(bundle.document, new Set(bundle.assets.keys()));
  const reopened = await readProjectFile(await writeProjectFile(bundle));
  assert.deepEqual(reopened.document, bundle.document, 'All backgrounds and settings survive project download/reopen');
  assert.deepEqual(reopened.assets, bundle.assets);
  const bg = reopened.document.editor.maps.Skin_B.backgroundImage as Record<string, unknown>;
  for (const invalid of [{ name: 'x', fit: 'unknown', colorOpacity: 0 }, { name: 'x', fit: 'cover', colorOpacity: -1 }, { name: 'x', fit: 'cover', colorOpacity: NaN }, { name: 'x', fit: 'cover', colorOpacity: 2 }]) {
    const bad = structuredClone(reopened.document); (bad.editor.maps.Skin_B.backgroundImage as Record<string, unknown>).textureBackground = invalid;
    assert.throws(() => validateProjectDocument(bad, new Set(reopened.assets.keys())), /fond/);
  }
  const external = structuredClone(reopened.document);
  ((external.editor.maps.Skin_B.backgroundImage as Record<string, unknown>).objects as Record<string, unknown>[])[0].src = 'https://example.com/track.png';
  assert.throws(() => validateProjectDocument(external, new Set(reopened.assets.keys())), /absent/);
  const incomplete = structuredClone(reopened.document);
  ((incomplete.editor.maps.Skin_B.backgroundImage as Record<string, unknown>).objects as unknown[]).pop();
  assert.throws(() => validateProjectDocument(incomplete, new Set(reopened.assets.keys())), /fond/);
  const maps = structuredClone(reopened.document.editor.maps);
  for (const map of Object.values(maps)) {
    const group = map.backgroundImage as Record<string, unknown>;
    const image = (group.objects as Record<string, unknown>[])[0];
    image.src = `data:image/png;base64,${Buffer.from(reopened.assets.get(String(image.src)) as Uint8Array).toString('base64')}`;
  }
  await core.loadProject(maps, reopened.document.editor);
  assert.deepEqual(core.getTextureBackground()!.name, (bg.textureBackground as { name: string }).name);
  assert.equal(core.getCanvas('Skin_B').backgroundVpt, true);
  assert.equal((core.getCanvas('Skin_B').backgroundImage as unknown as { canvas: Canvas }).canvas, core.getCanvas('Skin_B'), 'Project load transfers the background from the temporary canvas');
  core.clearMap(); assert.equal(core.getTextureBackground(), null); assert.equal(core.getCanvas('Skin_B').backgroundVpt, false);
  await core.undo(); assert(core.getTextureBackground());
  core.batch('Skin_B', { clear: true }, () => {}); assert.equal(core.getTextureBackground(), null); assert.equal(core.getCanvas('Skin_B').backgroundVpt, false);
  await core.loadProject(createBaseSkinProject({ position: [3, 2, 4], target: [0, .5, 0] }).document.editor.maps, { speedColor: '#ffffff', illumRole: 'always' });
  for (const map of MAPS) { assert.equal(readTextureBackground(core.getCanvas(map.id)), null); assert.equal(core.getCanvas(map.id).backgroundVpt, false); }
} finally { core.dispose(); host.remove(); }
console.log('Texture backgrounds: image/color/layer order, framing, desktop viewport, 13 maps, undo/redo, original PNGs, project roundtrip, DDS, lighting, reset and validation OK.');
