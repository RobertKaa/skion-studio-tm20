import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import JSZip from 'jszip';
import { setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { createMaterialDefinition, type MaterialDefinition, type MaterialLayer } from '../src/materials/types';
import { createMaterialRenderSession } from '../src/materials/render';
import type { BuildReliefOptions, PreparedReliefTemplate, ReliefPrototypeResult } from '../src/relief/engine';
import type { MapId } from '../src/maps';
import type { PreviewViewState } from '../src/three/CarPreview';
import type { ReliefPrototypeRuntime } from '../src/ui/ReliefPrototypeDialog';
import type { RGBAImage } from '../src/dds';
import type { ReliefSettings } from '../src/relief/settings';
import type { WheelSurfaceSettings } from '../src/wheelSurface';
import { WHEEL_TREAD_UV } from '../src/wheelTreads';

registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
setEnv(getEnv());
const desktop = getEnv().window;
Object.defineProperty(desktop, 'innerWidth', { configurable: true, value: 1400 });
Object.defineProperty(desktop, 'innerHeight', { configurable: true, value: 900 });
Object.assign(globalThis, { React, document: getEnv().document, window: desktop, HTMLElement: desktop.HTMLElement,
  HTMLCanvasElement: desktop.HTMLCanvasElement, HTMLInputElement: desktop.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { ReliefPrototypeDialog } = await import('../src/ui/ReliefPrototypeDialog');

const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
canvas.getContext('2d')!.fillStyle = '#7c8f9a'; canvas.getContext('2d')!.fillRect(0, 0, 8, 8);
const originalPixels = canvas.toDataURL();
const maps = new Map<MapId, HTMLCanvasElement>((['Skin_B', 'Skin_R', 'Skin_CoatR', 'Details_B', 'Details_R', 'Wheels_B', 'Wheels_R', 'Skin_I', 'Skin_DirtMask'] as const).map(id => [id, canvas]));
const normalCanvas = document.createElement('canvas'); normalCanvas.width = normalCanvas.height = 4;
normalCanvas.getContext('2d')!.fillStyle = '#a080f0'; normalCanvas.getContext('2d')!.fillRect(0, 0, 4, 4);
const originalNormalPixels = normalCanvas.toDataURL();
const definition = createMaterialDefinition(); definition.name = 'Pierre conservée'; definition.color = '#ffffff'; definition.transform.mode = 'contain';
definition.textures.normal = { src: normalCanvas.toDataURL('image/png'), name: 'rock_normal.png', component: 'luminance', invert: false };
definition.textures.color = { src: normalCanvas.toDataURL('image/png'), name: 'rock_color.png', component: 'luminance', invert: false };
definition.textures.height = { src: normalCanvas.toDataURL('image/png'), name: 'rock_height.png', component: 'r', invert: false };
const region = { key: 'piece', label: 'Pièce', polygons: [[{ x: .1, y: .1 }, { x: .2, y: .1 }, { x: .2, y: .2 }, { x: .1, y: .2 }]] };
const material: MaterialLayer = { definition, family: 'skin', regions: [region], exclusions: [] };
const originalMaterial = structuredClone(material);
const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
const opener = document.createElement('button'); document.body.append(opener); opener.focus();
let closed = 0, disposed = 0, loads = 0, editorShortcuts = 0;
let materialDisposed = 0;
const materialSessions: { loads: number; renders: number; disposed: number; heightSources: string[] }[] = [];
const retainedSources: { src: string; width: number }[] = [];
const loadedDefinitions: MaterialDefinition[] = [];
const applications: { result: ReliefPrototypeResult; settings: ReliefSettings; appearance?: MaterialDefinition }[] = [];
const builds: BuildReliefOptions[] = [];
const exports: { result: ReliefPrototypeResult; pixels: string; sourceName: string; sizes: Map<MapId, number>; colors: Map<MapId, number[]> }[] = [];
const selectedFiles = [{ name: 'Details_N.dds', data: new Uint8Array([4]) }];
const template = { manifest: { geometries: [{ uv: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2], hoodWeights: [1, 1, 1] }] } } as unknown as PreparedReliefTemplate;
let view: PreviewViewState = { position: [2, 1, 3], target: [0, 0, 0] };
const runtime = {
  createMaterialSession() {
    const session = createMaterialRenderSession(), record = { loads: 0, renders: 0, disposed: 0, heightSources: [] as string[] };
    materialSessions.push(record);
    return {
    async load(definition: MaterialDefinition) {
      loadedDefinitions.push(structuredClone(definition));
      if (definition.textures.height) {
        const source = definition.textures.height.src; const header = Buffer.from(source.slice(22, 66), 'base64');
        retainedSources.push({ src: source, width: header.readUInt32BE(16) });
      }
      await session.load(definition);
      record.loads++; if (definition.textures.height) record.heightSources.push(definition.textures.height.src);
    }, render(layer: MaterialLayer, size: number) { const rendered = session.render(layer, size); record.renders++; return rendered; },
    dispose() { session.dispose(); record.disposed++; materialDisposed++; },
  }; },
  createPreview() { return {
    setMapCanvas() {}, setSurfaceTextures() {}, setWheelSurface() {}, setCoatIntensity() {}, setDirtPreview() {},
    async loadCustomPreview() { loads++; }, getViewState() { return view; }, restoreViewState(value: PreviewViewState) { view = value; }, resetCamera() {},
    snapshot(size: number) { const icon = document.createElement('canvas'); icon.width = icon.height = size; return icon; }, dispose() { disposed++; },
  }; },
  async loadTemplate() { return template; },
  async build(options: BuildReliefOptions): Promise<ReliefPrototypeResult> {
    builds.push(options); await new Promise(resolve => setTimeout(resolve, 15));
    return { options: { family:options.family, mode: options.mode, strengthMm: options.strengthMm, normalStrength: options.normalStrength ?? 1, scope: options.scope ?? 'hood', textureResolution: options.textureResolution ?? 1024, diagnostic: options.diagnostic ?? false },
      project: { mesh: new Uint8Array([1]), preview: new ArrayBuffer(1), passthrough: [], name: 'Prototype' }, normalAtlas: null,
      stats: { affectedVertices: options.mode === 'normal' ? 0 : 20, hoodVertices: 20, eligibleVertices: 20, triangleCount: 30, maxDisplacementMm: options.strengthMm, templateVariant: options.mode === 'geometry' ? 'standard' : 'normal' } };
  },
};
window.addEventListener('keydown', () => editorShortcuts++);
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
function button(label: string) { const item = buttons().find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label); assert(item, `Accessible button ${label}`); return item; }
function labelled<T extends HTMLElement>(label: string) { const item = host.querySelector<T>(`[aria-label="${label}"]`); assert(item, `Accessible control ${label}`); return item; }
function range(atlas: RGBAImage, channel = 0): [number, number] {
  let minimum = 255, maximum = 0;
  for (let i = 0; i < atlas.data.length; i += 4) if (atlas.data[i + 3]) {
    minimum = Math.min(minimum, atlas.data[i + channel]); maximum = Math.max(maximum, atlas.data[i + channel]);
  }
  return [minimum, maximum];
}
const click = (label: string) => act(async () => button(label).click());
async function settle() {
  for (let attempt = 0; attempt < 200; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    if (!host.querySelector('.relief-building') && !host.textContent!.includes('Import des textures…') && !host.textContent!.includes('Création du skin…')) return;
  }
  assert.fail('Prototype returns control within the bounded desktop interaction check');
}
async function changeInput(label: string, value: string) {
  await act(async () => {
    const input = labelled<HTMLInputElement>(label);
    Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true })); input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}
async function changeSelect(label: string, value: string) {
  await act(async () => { const select = labelled<HTMLSelectElement>(label); select.value = value; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
}
async function exportFixture(result: ReliefPrototypeResult, outputMaps: ReadonlyMap<MapId, HTMLCanvasElement>, icon: HTMLCanvasElement, sourceName: string) {
  assert.equal(icon.width, 256); assert.notEqual(outputMaps.get('Skin_B'), canvas, 'Export receives isolated canvas copies');
  exports.push({ result, pixels: outputMaps.get('Skin_B')!.toDataURL(), sourceName,
    sizes: new Map([...outputMaps].map(([id, source]) => [id, source.width])),
    colors: new Map([...outputMaps].map(([id, source]) => [id, [...source.getContext('2d')!.getImageData(Math.floor(source.width * .75), Math.floor(source.height * .75), 1, 1).data]])) });
  return 12_345_678;
}
async function renderDialog(nextRuntime: ReliefPrototypeRuntime = runtime) {
  await act(async () => root.render(<ReliefPrototypeDialog name="MonSkin" maps={maps} material={material} surfaceFiles={selectedFiles} runtime={nextRuntime}
    onClose={() => closed++} onExport={exportFixture} onApply={async(result,settings,_maps,appearance)=> { applications.push({result,settings,appearance}); }} />));
}
try {
  await renderDialog();
  assert.equal(window.innerWidth, 1400, 'All dialog checks run on desktop');
  assert.equal(host.querySelector('[role="dialog"]')!.getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement, button('Fermer l’atelier de relief'));
  assert(button('Exporter le skin').disabled, 'Export stays unavailable until a matching build is ready');
  await settle();
  assert.equal(builds.at(-1)!.scope, 'vehicle', 'The prototype defaults to the whole vehicle');
  assert.equal(builds.at(-1)!.textureResolution, 2048, 'The default uses crisp 2K textures');
  assert.equal(labelled<HTMLSelectElement>('Résolution des textures du relief').value, '2048');
  assert.deepEqual([...labelled<HTMLSelectElement>('Résolution des textures du relief').options].map(option => option.value), ['1024', '2048', '4096']);
  assert.equal(button('Toute la surface Carrosserie').getAttribute('aria-pressed'), 'true');
  assert.equal(builds.at(-1)!.mode, 'geometry');
  assert.equal(builds.at(-1)!.family, 'skin');
  assert(!buttons().some(b=>['Normales','Les deux'].includes(b.textContent?.trim()??'')), 'Body offers only the game-confirmed geometry route');
  assert(host.textContent!.includes('Carrosserie uniquement'));
  await changeInput('Amplitude du volume', '11');
  assert(button('Exporter le skin').disabled, 'Changing a source prevents exporting an outdated result');
  await settle();
  assert.equal(material.definition.normalStrength, 1, 'Normal strength changes only the workshop copy');
  await click('Exporter le skin'); await settle();
  assert.equal(exports.length, 1); assert.equal(exports[0].sourceName, 'Pierre conservée');
  assert(host.textContent!.includes('12.3 Mo · budget 24 Mo'), 'The export reports its real size against the prudent upload budget');
  for (const id of ['Skin_B'] as const) {
    assert.equal(exports[0].sizes.get(id), 2048, 'Material color maps use the selected export quality');
    assert.deepEqual(exports[0].colors.get(id), [160, 128, 240, 255], 'The repeated source covers each atlas, even beyond the original selected piece mask');
  }
  assert.deepEqual(exports[0].colors.get('Skin_R'), [definition.roughness, definition.metalness, 0, 255]);
  for(const id of ['Details_B','Details_R','Wheels_B','Wheels_R'] as const){assert.deepEqual(exports[0].colors.get(id),[124,143,154,255]);assert.equal(exports[0].sizes.get(id),8,'Other families retain their exact texture size');}
  assert.equal(exports[0].sizes.get('Skin_I'), 8, 'Unmodified lighting maps are preserved without pointless upscaling');
  assert.deepEqual(exports[0].colors.get('Skin_I'), [124, 143, 154, 255]);
  assert.equal(material.definition.transform.mode, 'contain', 'Repeat is forced only on the temporary source copy');
  assert.equal(canvas.toDataURL(), originalPixels);

  button('Appliquer au projet').focus();
  await act(async () => document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, button('Fermer l’atelier de relief'), 'Tab wraps from the last action back into the modal');
  await act(async () => document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, button('Appliquer au projet'), 'Shift+Tab wraps back to the final action');
  await act(async () => document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })));
  assert.equal(editorShortcuts, 0, 'Editor shortcuts cannot mutate the main project behind the workshop');

  await click('Capot'); await settle();
  assert.equal(builds.at(-1)!.scope, 'hood', 'The original capot-only experiment remains available');
  await click('Exporter le skin'); await settle();
  assert.equal(exports.at(-1)!.pixels, originalPixels, 'A selected material on the hood keeps the original texture instead of compositing it twice');
  await click('Toute la surface Carrosserie'); await changeSelect('Résolution des textures du relief', '1024'); await settle();
  assert.equal(builds.at(-1)!.textureResolution, 1024);

  // React preserves component state during a runtime/HMR dependency refresh.
  // An effect-owned renderer must be recreated after disposing its old cache.
  assert.equal(materialSessions.length, 1); assert(materialSessions[0].loads > 0 && materialSessions[0].renders > 0);
  const exportsBeforeRefresh = exports.length;
  await renderDialog({ ...runtime });
  assert.equal(materialSessions.length, 2, 'Refreshing the preview runtime creates a new material session');
  assert.equal(materialSessions[0].disposed, 1, 'The previous material session is disposed exactly once on effect cleanup');
  assert.equal(materialSessions[1].disposed, 0, 'The replacement session remains usable');
  assert.equal(disposed, 1, 'Refreshing the runtime also releases the previous independent preview');
  await settle();
  assert.equal(builds.at(-1)!.textureResolution, 1024, 'The runtime refresh preserves the selected quality');
  assert.equal(labelled<HTMLInputElement>('Amplitude du volume').value, '11', 'React retains the workshop source settings across the effect restart');
  assert(materialSessions[1].loads > 0 && materialSessions[1].renders > 0, 'The retained material is decoded and rendered by the replacement real cache');
  assert(!button('Exporter le skin').disabled, 'A rebuilt source remains exportable after a runtime refresh');
  await click('Exporter le skin'); await settle();
  assert.equal(exports.length, exportsBeforeRefresh + 1, 'The refreshed preview exports its newly built maps');
  assert.equal(exports.at(-1)!.sourceName, 'Pierre conservée');
  assert.equal(exports.at(-1)!.sizes.get('Skin_B'), 1024);
  assert.equal(canvas.toDataURL(), originalPixels); assert.equal(normalCanvas.toDataURL(), originalNormalPixels);
  assert.deepEqual(material, originalMaterial, 'Cache cleanup preserves the main editor source images and material');

  // The built-in carbon must create numeric weave relief with no imported
  // image, using the same isolated renderer and preserving source settings.
  await click('Motif démo'); await settle();
  await click('Amplifier pour le test · jusqu’à 8 cm'); await changeInput('Amplitude du volume', '40'); await settle();
  assert.equal(builds.at(-1)!.diagnostic, true);
  await click('Carbone tissé'); await settle();
  const carbonBuild = builds.at(-1)!;
  assert.equal(carbonBuild.mode, 'geometry', 'Carbon starts with the standard geometric shader');
  assert.equal(carbonBuild.strengthMm, .5, 'Carbon resets an amplified stone/test amplitude to a small strand height');
  assert.equal(carbonBuild.diagnostic, false, 'Carbon does not inherit exaggerated diagnostic deformation');
  assert.equal(carbonBuild.scope, 'vehicle'); assert.equal(carbonBuild.textureResolution, 1024, 'Carbon keeps the selected zone and quality');
  assert.equal(button('Carbone tissé').getAttribute('aria-pressed'), 'true');
  assert.equal(labelled<HTMLInputElement>('Taille du motif').value, '768');
  assert.equal(loadedDefinitions.at(-1)!.preset, 'carbon');
  assert.deepEqual(loadedDefinitions.at(-1)!.textures, {}, 'Carbon relief is generated without importing or fabricating texture image files');
  assert(carbonBuild.heightAtlas, 'The real renderer supplies procedural height without a texture pack');
  assert.equal(carbonBuild.heightAtlas.width, 1024);
  const [lowHeight, highHeight] = range(carbonBuild.heightAtlas);
  assert(highHeight - lowHeight > 100, 'Carbon strand crowns generate a nonuniform numeric height atlas');
  assert.equal(carbonBuild.normalAtlas, undefined, 'Geometric carbon isolates actual volume from experimental normals');
  assert(!buttons().some(b=>['Normales','Les deux'].includes(b.textContent?.trim()??'')));
  assert(!host.querySelector('[aria-label="Intensité des normales"]'), 'Body only exposes geometry settings');
  assert(host.textContent!.includes('fibres fines') && host.textContent!.includes('surface densifiée'), 'The carbon hint explains that fine detail is limited by mesh density');
  await click('Exporter le skin'); await settle();
  const carbonExport = exports.at(-1)!;
  assert.equal(carbonExport.sourceName, 'Carbone tissé');
  assert.notEqual(carbonExport.pixels, originalPixels, 'Carbon has its own appearance instead of reusing the stone editor paint');
  const carbonColor = carbonExport.colors.get('Skin_B')!;
  assert(carbonColor[0] < 80 && carbonColor[1] < 80 && carbonColor[2] < 80 && carbonColor[3] === 255, 'The carbon weave uses the existing dark material palette');
  for (const id of ['Skin_B'] as const) {
    assert.deepEqual(carbonExport.colors.get(id), carbonColor, 'The carbon colour reaches all three vehicle material families');
    assert.equal(carbonExport.sizes.get(id), 1024);
  }
  assert.equal(canvas.toDataURL(), originalPixels); assert.equal(normalCanvas.toDataURL(), originalNormalPixels);
  assert.deepEqual(material, originalMaterial, 'Selecting carbon leaves the editor material, masks and image sources intact');
  await click('Comparer sans relief'); await settle();
  assert.equal(builds.at(-1)!.heightAtlas, undefined); assert.equal(builds.at(-1)!.normalAtlas, undefined);
  assert.equal(builds.at(-1)!.strengthMm, 0);
  await click('Exporter sans relief'); await settle();
  assert.equal(exports.at(-1)!.sourceName, 'Carbone tissé', 'The baseline keeps the carbon source instead of reverting to selected stone');
  assert.equal(exports.at(-1)!.pixels, carbonExport.pixels, 'Carbon comparison keeps exactly the same woven colour');
  for (const [id, color] of carbonExport.colors) assert.deepEqual(exports.at(-1)!.colors.get(id), color, 'Comparison keeps carbon finishes and untouched editor maps as well');
  await click('Revenir au relief'); await settle();
  assert.equal(builds.at(-1)!.mode,'geometry','Body carbon stays on the geometric route');
  assert.deepEqual(material, originalMaterial);
  assert.deepEqual(selectedFiles, [{ name: 'Details_N.dds', data: new Uint8Array([4]) }], 'Procedural tests do not replace the editor surface files');
  assert.equal(materialSessions.length, 2, 'Changing to a procedural source reuses the current owned renderer');
  assert.equal(materialSessions[0].disposed, 1); assert.equal(materialSessions[1].disposed, 0);

  await click('Motif démo'); await settle();
  assert.equal(builds.at(-1)!.mode, 'geometry'); assert(builds.at(-1)!.heightAtlas, 'The demonstration supplies an actual numeric height atlas');
  await changeInput('Amplitude du volume', '5'); await settle();
  assert.equal(builds.at(-1)!.strengthMm, 5);
  await click('Comparer sans relief'); await settle();
  assert.equal(builds.at(-1)!.mode, 'geometry'); assert.equal(builds.at(-1)!.strengthMm, 0, 'Comparison removes geometry and normals while preserving the same texture');
  assert.equal(builds.at(-1)!.normalAtlas, undefined);
  assert(!button('Exporter sans relief').disabled, 'The baseline has its own explicit export action');
  await click('Exporter sans relief'); await settle();
  assert.equal(exports.at(-1)!.result.options.strengthMm, 0, 'A comparison export uses the displayed baseline geometry');
  assert.equal(exports.at(-1)!.result.options.mode, 'geometry', 'The baseline never includes experimental Skin normals');
  await click('Revenir au relief'); await settle();
  assert(!button('Exporter le skin').disabled);

  const heightPng = Buffer.from(normalCanvas.toDataURL('image/png').split(',')[1], 'base64');
  const input = labelled<HTMLInputElement>('Importer des textures pour le relief');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([heightPng], 'stone_height.png', { type: 'image/png' })] });
  await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true }))); await settle();
  assert(host.textContent!.includes('Pack importé · Carrosserie uniquement'));
  assert(builds.at(-1)!.heightAtlas); assert.equal(input.value, '');
  assert(materialSessions[1].heightSources.includes(normalCanvas.toDataURL('image/png')), 'Import after the effect restart loads height pixels into the live replacement session');
  assert.equal(materialSessions[0].disposed, 1, 'A later import never revives or redisposes the retired session');
  assert(!button('Exporter le skin').disabled, 'A subsequent imported source remains exportable after the effect restart');
  assert.equal(builds.at(-1)!.mode, 'geometry', 'Importing a height texture preserves the standard volume path instead of silently enabling the experimental shader');
  await click('Relief marqué · 20 mm'); await settle();
  assert.equal(builds.at(-1)!.mode, 'geometry'); assert.equal(builds.at(-1)!.strengthMm, 20); assert.equal(builds.at(-1)!.diagnostic, false);
  assert.equal(builds.at(-1)!.normalAtlas, undefined, 'The amplified texture test isolates geometry from the shader');
  await click('Exporter le skin'); await settle();
  assert.equal(exports.at(-1)!.sourceName, 'stone_height');
  assert.equal(exports.at(-1)!.pixels, originalPixels, 'A height-only image preserves the existing appearance instead of adding a default paint color');
  assert.equal(canvas.toDataURL(), originalPixels, 'Imported color and relief never change the source editor canvas');
  assert.deepEqual(material, originalMaterial, 'The original material, textures, transform and masks remain untouched');

  const originalHeight = document.createElement('canvas'); originalHeight.width = originalHeight.height = 1536;
  originalHeight.getContext('2d')!.fillStyle = '#777777'; originalHeight.getContext('2d')!.fillRect(0, 0, 1536, 1536);
  const originalHeightSource = originalHeight.toDataURL('image/png');
  const zip = new JSZip(); zip.file('stone_height.png', Buffer.from(originalHeightSource.split(',')[1], 'base64'));
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([await zip.generateAsync({ type: 'arraybuffer' })], 'stone.zip')] });
  await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true }))); await settle();
  assert.equal(builds.at(-1)!.textureResolution, 1024);
  assert.equal(retainedSources.at(-1)!.width, 1536, 'A ZIP imported in 1K mode still retains its higher-resolution original source');
  assert.equal(retainedSources.at(-1)!.src, originalHeightSource);
  assert.equal(builds.at(-1)!.mode, 'geometry'); assert.equal(builds.at(-1)!.strengthMm, 20, 'Reimporting another height source retains the chosen volume amplitude');
  await changeSelect('Résolution des textures du relief', '2048'); await settle();
  assert.equal(builds.at(-1)!.heightAtlas!.width, 2048);
  assert.equal(retainedSources.at(-1)!.src, originalHeightSource, 'Returning to 2K samples the intact source instead of upscaling a previous 1K conversion');
  await changeSelect('Résolution des textures du relief', '4096');
  assert(button('Exporter le skin').disabled, 'A pending 4K build cannot export an earlier 2K result');
  await changeSelect('Résolution des textures du relief', '2048'); await settle();
  assert.equal(retainedSources.at(-1)!.width, 1536);
  await click('Test géométrique gris'); await settle();
  assert.equal(builds.at(-1)!.diagnostic, true, 'Large amplitude is explicitly opted into by the diagnostic preset');
  assert.equal(builds.at(-1)!.strengthMm, 80);
  assert.equal(builds.at(-1)!.scope, 'hood'); assert.equal(builds.at(-1)!.mode, 'geometry');
  assert.equal(builds.at(-1)!.normalAtlas, undefined);
  assert(!buttons().some(b=>['Normales','Les deux'].includes(b.textContent?.trim()??'')));
  await click('Exporter le skin'); await settle();
  const greyExport = exports.at(-1)!;
  assert.deepEqual(greyExport.colors.get('Skin_B'),[96,96,96,255]);
  for(const id of ['Details_B','Wheels_B'] as const)assert.deepEqual(greyExport.colors.get(id),[124,143,154,255],'Diagnostic respects selected family');
  assert.deepEqual(greyExport.colors.get('Skin_R'), [180, 0, 0, 255]);
  assert.deepEqual(greyExport.colors.get('Skin_CoatR'), [0, 0, 0, 255]);
  await click('Comparer sans relief'); await settle(); await click('Exporter sans relief'); await settle();
  assert.equal(exports.at(-1)!.pixels, greyExport.pixels, 'The severe and baseline exports use exactly the same neutral appearance');
  assert.equal(exports.at(-1)!.result.options.strengthMm, 0);
  await click('Revenir au relief'); await settle();
  await click('Amplifier pour le test · jusqu’à 8 cm'); await settle();
  assert.equal(builds.at(-1)!.diagnostic, false);
  assert.equal(builds.at(-1)!.strengthMm, 30, 'Leaving diagnostic amplitude returns safely to the regular 30mm limit');
  assert.equal(labelled<HTMLInputElement>('Amplitude du volume').max, '30');
  assert.equal(canvas.toDataURL(), originalPixels); assert.deepEqual(material, originalMaterial);
  assert(loads >= 5, 'Mode and source changes update only the independent preview');
  assert(button('Appliquer au projet').disabled, 'The standalone grey diagnostic cannot silently repaint the main project');
  await click('Carbone tissé'); await settle();
  await click('Comparer sans relief'); await settle();
  assert(button('Appliquer au projet').disabled, 'A comparison cannot replace the saved relief');
  await click('Revenir au relief'); await settle(); await click('Appliquer au projet'); await settle();
  assert.equal(applications.length,1); assert.equal(closed,1);
  assert.equal(applications[0].settings.strengthMm,.5); assert.equal(applications[0].settings.scope,'hood');
  assert.equal(applications[0].settings.material!.definition.preset,'carbon','Editable original sources are retained');
  assert.equal(applications[0].appearance!.transform.mode,'stretch','The hood paint carries its baked UV feather');
  assert(applications[0].appearance!.textures.color!.src.startsWith('data:image/png;base64,'));
  assert.equal(canvas.toDataURL(),originalPixels,'Application delegates a matching snapshot without mutating editor inputs');
  await act(async () => document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  assert.equal(closed, 2, 'Escape dispatches one close after the application close callback');
} finally {
  await act(async () => root.unmount()); host.remove();
  assert.equal(disposed, 2, 'The runtime refresh and closing each release their independent 3D preview');
  assert.equal(materialDisposed, 2, 'The runtime refresh and closing each release their own temporary material renderer');
  assert(materialSessions.every(session => session.disposed === 1), 'Every owned material session is disposed exactly once');
  assert.equal(document.activeElement, opener, 'Closing restores focus to the control that opened the workshop'); opener.remove();
}
console.log('✓ Prototype relief desktop : carbone procédural hauteur/normales et comparaison intacte, voiture entière répétée, capot, qualité 1K/2K/4K, ZIP original conservé, source isolée, export prêt/stale, import hauteur, cache recréé après refresh, raccourcis protégés, focus et nettoyage');

// Production entry from a material owner: its mask is a hard boundary.
const scopedHost=document.createElement('div');document.body.append(scopedHost);const scopedRoot=createRoot(scopedHost);
const scopedMaterial=structuredClone(originalMaterial);scopedMaterial.definition.textures.height={src:normalCanvas.toDataURL(),name:'height.png',component:'r',invert:false};
scopedMaterial.exclusions=[{key:'hole',label:'Trou',polygons:[[{x:.14,y:.14},{x:.16,y:.14},{x:.16,y:.16},{x:.14,y:.16}]]}];
const scopedOriginal=structuredClone(scopedMaterial);
const scopedButton=(name:string)=>{const value=[...scopedHost.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);assert(value,name);return value;};
async function settleScoped(){for(let i=0;i<200;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});if(!scopedHost.querySelector('.relief-building')&&!scopedButton('Exporter le skin').disabled)return;}assert.fail('Scoped relief settles');}
try{
  await act(async()=>scopedRoot.render(<ReliefPrototypeDialog name="Projet" maps={maps} material={scopedMaterial} surfaceFiles={[]} runtime={runtime} preserveMaterialMask onClose={()=>{}} onExport={exportFixture} onApply={async(result,settings,_maps,appearance)=>{applications.push({result,settings,appearance});}}/>));
  await settleScoped();assert(scopedHost.textContent!.includes('Carrosserie · calque « Pierre conservée »'));
  assert(scopedHost.querySelector('[aria-label="Calque ciblé"]'));assert(!scopedHost.querySelector('[aria-label="Zone du relief"]'),'No vehicle-wide scope override is offered for a selected layer');
  assert(![...scopedHost.querySelectorAll('button')].some(b=>b.textContent?.trim()==='Carbone tissé'),'Changing to a demonstration cannot discard the selected layer mask');
  const scopedBuild=builds.at(-1)!;assert.equal(scopedBuild.mode,'geometry');assert.equal(scopedBuild.scope,'vehicle');assert(scopedBuild.heightAtlas);
  const mask=scopedBuild.heightAtlas!;const alphaAt=(x:number,y:number)=>mask.data[(Math.floor(y*mask.height)*mask.width+Math.floor(x*mask.width))*4+3];
  assert(alphaAt(.12,.12)>0);assert.equal(alphaAt(.15,.15),0,'Excluded pieces receive no displacement');assert.equal(alphaAt(.8,.8),0,'Outside the selected layer no height is passed to the engine');
  await act(async()=>scopedButton('Exporter le skin').click());await settleScoped();
  for(const id of ['Skin_B','Skin_R','Details_B','Details_R','Wheels_B','Wheels_R'] as const)assert.deepEqual(exports.at(-1)!.colors.get(id),[124,143,154,255],`${id}: workshop changes volume without repainting the stack or other families`);
  await act(async()=>scopedButton('Appliquer au projet').click());await settleScoped();
  const scoped=applications.at(-1)!;assert.equal(scoped.settings.appearanceScope,'skin');assert.deepEqual(scoped.settings.material!.regions,scopedMaterial.regions);assert.deepEqual(scoped.settings.material!.exclusions,scopedMaterial.exclusions);assert.equal(scoped.appearance,undefined);
  assert.deepEqual(scopedMaterial,scopedOriginal,'Opening and exporting preserves the source owner');
}finally{await act(async()=>scopedRoot.unmount());scopedHost.remove();}
console.log('✓ Volume du calque : masque et exclusions exacts, portée verrouillée, pile couleur intacte, roues/détails préservés, application limitée à Skin');

for(const family of ['details','wheels'] as const){
 const target=document.createElement('div');document.body.append(target);const familyRoot=createRoot(target);
 const normalOnly:MaterialLayer={...structuredClone(material),family,regions:[],exclusions:[]};delete normalOnly.definition.textures.height;
 const find=(name:string)=>{const b=[...target.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===name);assert(b,name);return b;};
 const done=async()=>{for(let i=0;i<200;i++){await act(async()=>{await new Promise(r=>setTimeout(r,10));});if(!target.querySelector('.relief-building'))return;}assert.fail('Family preview settles');};
 try{
  await act(async()=>familyRoot.render(<ReliefPrototypeDialog family={family} name="Famille" maps={maps} material={normalOnly} surfaceFiles={[]} runtime={runtime} onClose={()=>{}} onExport={exportFixture} onApply={async(result,settings)=>{applications.push({result,settings});}}/>));
  await done();assert.equal(builds.at(-1)!.family,family);assert.equal(builds.at(-1)!.scope,'vehicle');assert.equal(builds.at(-1)!.mode,'normal');assert(find('Volume').disabled);assert(!find('Normales').disabled);
  assert(![...target.querySelectorAll('button')].some(b=>b.textContent?.trim()==='Capot'),'No body scope in another family');
  await act(async()=>find('Carbone tissé').click());await done();assert.equal(builds.at(-1)!.mode,'geometry');assert.equal(builds.at(-1)!.family,family);
  await act(async()=>find('Exporter le skin').click());await done();
  const prefix=family==='details'?'Details':'Wheels',last=exports.at(-1)!;
  for(const map of ['Skin_B','Details_B','Wheels_B'] as const){if(map.startsWith(prefix))assert.notDeepEqual(last.colors.get(map),[124,143,154,255]);else{assert.deepEqual(last.colors.get(map),[124,143,154,255]);assert.equal(last.sizes.get(map),8);}}
  await act(async()=>find('Les deux').click());await done();assert.equal(builds.at(-1)!.mode,'combined');assert(builds.at(-1)!.normalAtlas);assert(builds.at(-1)!.heightAtlas);
  await act(async()=>find('Appliquer au projet').click());await done();assert.equal(applications.at(-1)!.settings.family,family);assert.equal(applications.at(-1)!.settings.material!.family,family);
 }finally{await act(async()=>familyRoot.unmount());target.remove();}
}
console.log('✓ Détails/Roues : normales, volume et combinaison disponibles, couleur et géométrie ciblent uniquement la famille active');

// Changing tyre relief must never recolour or resample the independent
// workshop's painted colour and material maps, including recessed floors.
const tyreHost = document.createElement('div'); document.body.append(tyreHost); const tyreRoot = createRoot(tyreHost);
const floorU = WHEEL_TREAD_UV.minU + .233 * (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU);
const sampledPixel = (source: HTMLCanvasElement, u: number, v: number) => [...source.getContext('2d')!.getImageData(Math.floor(u * source.width), Math.floor(v * source.height), 1, 1).data];
const tyreBindings: { id: MapId; source: HTMLCanvasElement; width: number; height: number; floor: number[]; flank: number[] }[] = [];
const tyreModes: WheelSurfaceSettings[] = [];
const tyreRuntime: ReliefPrototypeRuntime = { ...runtime, createPreview() {
  return { ...runtime.createPreview(),
    setMapCanvas(id, source) {
      if (id === 'Wheels_B' || id === 'Wheels_R') tyreBindings.push({ id, source, width: source.width, height: source.height,
        floor: sampledPixel(source, floorU, .33), flank: sampledPixel(source, .97, .33) });
    }, setWheelSurface(settings) { tyreModes.push({ ...settings }); },
  };
} };
const tyreButton = (label: string) => {
  const control = [...tyreHost.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
  assert(control, label); return control;
};
async function settleTyres() {
  for (let attempt = 0; attempt < 200; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    if (!tyreHost.querySelector('.relief-building') && !tyreButton('Exporter le skin').disabled) return;
  }
  assert.fail('Procedural tyre workshop settles');
}
let tyreExports = 0, tyreApplications = 0;
try {
  await act(async () => tyreRoot.render(<ReliefPrototypeDialog name="Pneus conservés" maps={maps} material={material} surfaceFiles={selectedFiles}
    wheelSurface={{ mode: 'road', strength: 1 }} runtime={tyreRuntime} onClose={() => {}}
    onExport={async (_result, outputMaps) => {
      for (const id of ['Wheels_B', 'Wheels_R'] as const) {
        assert.equal(outputMaps.get(id)!.toDataURL(), originalPixels, 'The exporter receives exactly the painted colour and material maps');
        assert.equal(outputMaps.get(id)!.width, 8);
      }
      tyreExports++;
    }} onApply={async (_result, _settings, outputMaps) => {
      for (const id of ['Wheels_B', 'Wheels_R'] as const) assert.equal(outputMaps.get(id)!.toDataURL(), originalPixels, 'Applying relief does not bake cavity darkness into editable paint');
      tyreApplications++;
    }} />));
  const initialWheelBindings = tyreBindings.slice(-2).map(binding => binding.source);
  assert.equal(initialWheelBindings.length, 2);
  assert(initialWheelBindings.every(source => source === canvas), 'Initial preview binds the original painted canvas without a derived colour/material copy');
  await settleTyres();
  assert(initialWheelBindings.every(source => source.width === 8), 'Completing the relief build does not resize the original colour/material source');
  for (const id of ['Wheels_B', 'Wheels_R'] as const) {
    const binding = tyreBindings.findLast(entry => entry.id === id)!;
    assert.notEqual(binding.source, canvas, 'The independent preview never mutates the source wheel canvas');
    assert.deepEqual([binding.width, binding.height], [8, 8], 'Relief selection does not upsample the painted colour or finish');
    assert.deepEqual(binding.flank, [124, 143, 154, 255], 'Sidewall artwork retains its exact appearance');
    assert.deepEqual(binding.floor, [124, 143, 154, 255], 'Recessed-floor colour and finish also retain the exact painted RGBA values');
    assert.equal(binding.source.toDataURL(), originalPixels, 'The complete painted map remains unchanged, not only its sampled pixels');
  }
  assert.deepEqual(tyreModes.at(-1), { mode: 'relief', strength: 1 }, 'Generated wheel DDS normals remain authoritative in the independent preview');
  assert.equal(canvas.toDataURL(), originalPixels);
  const beforeRebuild = tyreBindings.slice(-2).map(binding => binding.source);
  await act(async () => tyreButton('Relief marqué · 20 mm').click()); await settleTyres();
  assert(beforeRebuild.every(source => source.width === 0), 'A rebuild releases its superseded working-map copies');
  for (const id of ['Wheels_B', 'Wheels_R'] as const) {
    const binding = tyreBindings.findLast(entry => entry.id === id)!;
    assert.deepEqual([binding.width, binding.height], [8, 8]);
    assert.deepEqual(binding.floor, [124, 143, 154, 255], 'Changing relief depth cannot bake a colour or material difference into the floor');
  }
  await act(async () => tyreButton('Exporter le skin').click()); await settleTyres();
  assert.equal(tyreExports, 1);
  await act(async () => tyreButton('Appliquer au projet').click()); await settleTyres();
  assert.equal(tyreApplications, 1); assert.equal(canvas.toDataURL(), originalPixels);
} finally {
  const lastCopies = tyreBindings.slice(-2).map(binding => binding.source);
  await act(async () => tyreRoot.unmount()); tyreHost.remove();
  assert(lastCopies.every(source => source.width === 0), 'Closing releases the active working-map copies');
  assert.equal(canvas.toDataURL(), originalPixels, 'Closing the workshop retains the source painting');
}
console.log('✓ Pneus du relief : couleur/matière et RGBA des creux conservés, aucune dérivation ni mise à l’échelle, normales DDS séparées et sources intactes après reconstruction/export/application');
