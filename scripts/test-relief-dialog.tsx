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
    return { options: { mode: options.mode, strengthMm: options.strengthMm, normalStrength: options.normalStrength ?? 1, scope: options.scope ?? 'hood', textureResolution: options.textureResolution ?? 1024, diagnostic: options.diagnostic ?? false },
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
  assert.equal(button('Toute la voiture').getAttribute('aria-pressed'), 'true');
  assert.equal(builds.at(-1)!.mode, 'normal', 'An older material pack with normals only starts in the mode it supports');
  assert(button('Volume').disabled && button('Les deux').disabled, 'A normal image cannot masquerade as a height map');
  assert(host.textContent!.includes('Réimportez son ZIP avec une carte de hauteur'));
  assert(host.textContent!.includes('Surface densifiée'));
  assert(host.textContent!.includes('ajustez le volume'));
  await changeInput('Intensité des normales', '1.5');
  assert(button('Exporter le skin').disabled, 'Changing a source prevents exporting an outdated result');
  await settle();
  assert.equal(material.definition.normalStrength, 1, 'Normal strength changes only the workshop copy');
  await click('Exporter le skin'); await settle();
  assert.equal(exports.length, 1); assert.equal(exports[0].sourceName, 'Pierre conservée');
  assert(host.textContent!.includes('12.3 Mo · budget 24 Mo'), 'The export reports its real size against the prudent upload budget');
  for (const id of ['Skin_B', 'Details_B', 'Wheels_B'] as const) {
    assert.equal(exports[0].sizes.get(id), 2048, 'Material color maps use the selected export quality');
    assert.deepEqual(exports[0].colors.get(id), [160, 128, 240, 255], 'The repeated source covers each atlas, even beyond the original selected piece mask');
  }
  for (const id of ['Skin_R', 'Details_R', 'Wheels_R'] as const) assert.deepEqual(exports[0].colors.get(id), [definition.roughness, definition.metalness, 0, 255], 'The common finish reaches all three material families');
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
  await click('Toute la voiture'); await changeSelect('Résolution des textures du relief', '1024'); await settle();
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
  assert.equal(labelled<HTMLInputElement>('Intensité des normales').value, '1.5', 'React retains the workshop source settings across the effect restart');
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
  assert(!button('Normales').disabled && !button('Les deux').disabled, 'Procedural carbon supports all relief modes');
  assert(labelled<HTMLInputElement>('Intensité des normales').disabled, 'The procedural normal strength remains unavailable in geometry mode');
  assert(host.textContent!.includes('fibres fines') && host.textContent!.includes('sommets'), 'The carbon hint explains that fine detail is limited by mesh density');
  await click('Exporter le skin'); await settle();
  const carbonExport = exports.at(-1)!;
  assert.equal(carbonExport.sourceName, 'Carbone tissé');
  assert.notEqual(carbonExport.pixels, originalPixels, 'Carbon has its own appearance instead of reusing the stone editor paint');
  const carbonColor = carbonExport.colors.get('Skin_B')!;
  assert(carbonColor[0] < 80 && carbonColor[1] < 80 && carbonColor[2] < 80 && carbonColor[3] === 255, 'The carbon weave uses the existing dark material palette');
  for (const id of ['Skin_B', 'Details_B', 'Wheels_B'] as const) {
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
  await click('Normales'); await settle();
  const carbonNormals = builds.at(-1)!;
  assert.equal(carbonNormals.mode, 'normal'); assert(carbonNormals.normalAtlas, 'Procedural carbon supplies a tangent normal atlas in normal mode');
  const [lowNormal, highNormal] = range(carbonNormals.normalAtlas);
  assert(highNormal - lowNormal > 10, 'The carbon normal atlas contains actual strand slopes');
  assert(!labelled<HTMLInputElement>('Intensité des normales').disabled);
  await changeInput('Intensité des normales', '1.5'); await settle();
  assert.equal(loadedDefinitions.at(-1)!.normalStrength, 1.5, 'Procedural carbon normal strength is edited on its temporary definition');
  const [strongerLow, strongerHigh] = range(builds.at(-1)!.normalAtlas!);
  assert(strongerHigh - strongerLow > highNormal - lowNormal, 'Increasing procedural normal strength changes the rendered strand slopes');
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
  assert(host.textContent!.includes('Pack importé · carrosserie, détails et roues'));
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
  assert(button('Normales').disabled && button('Les deux').disabled, 'The geometry diagnostic keeps shader-based detail out of the comparison');
  await click('Exporter le skin'); await settle();
  const greyExport = exports.at(-1)!;
  for (const id of ['Skin_B', 'Details_B', 'Wheels_B'] as const) assert.deepEqual(greyExport.colors.get(id), [96, 96, 96, 255], 'The diagnostic removes photographic texture clues');
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
