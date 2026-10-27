import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { getEnv } from 'fabric/node';
import { setEnv } from 'fabric';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { createMaterialRenderSession } from '../src/materials/render';
import type { MaterialDefinition, MaterialLayer } from '../src/materials/types';
import type { MapId } from '../src/maps';
import { createWheelArtworkDefinition, createWheelElement, type WheelDesignArtwork, type WheelDesignComposition } from '../src/wheelDesignComposition';
import type { WheelDesignPreviewContext } from '../src/wheelDesignPreview';
import { WHEEL_PART_GUIDES } from '../src/wheelParts';
import type { ProjectionTriangle } from '../src/three/decalProjection';
import { previewMeshMaterialSlot } from '../src/three/materialSlots';
import type { CarPreview } from '../src/three/CarPreview';
import type { WheelDesignModelPreviewRuntime } from '../src/ui/WheelDesignModelPreview';
import { composeMaterialSurface } from '../src/materials/surfaceMaps';

registerHooks({ load(url, context, next) { return url.endsWith('.css')
  ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
const env = getEnv(); setEnv(env);
Object.assign(globalThis, { React, document: env.document, window: env.window, HTMLElement: env.window.HTMLElement,
  HTMLCanvasElement: env.window.HTMLCanvasElement, HTMLImageElement: env.window.HTMLImageElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(env.window, 'innerWidth', { configurable: true, value: 1440 });
Object.defineProperty(env.window, 'innerHeight', { configurable: true, value: 900 });
const { createRoot } = await import('react-dom/client');
const { WheelDesignModelPreview } = await import('../src/ui/WheelDesignModelPreview');

const textureLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
const bytes = readFileSync('public/models/car/StadiumCAR2020_OffsetFix.fbx');
let model: THREE.Group;
try { model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); }
finally { THREE.TextureLoader.prototype.load = textureLoad; }
model.updateMatrixWorld(true);
const geometry: ProjectionTriangle[] = [];
model.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  const material = Array.isArray(object.material) ? object.material[0] : object.material;
  if (previewMeshMaterialSlot(material.name, object.name) !== 'wheels') return;
  const position = object.geometry.getAttribute('position'), uv = object.geometry.getAttribute('uv'), index = object.geometry.index;
  for (let face = 0; face < (index?.count ?? position.count); face += 3) {
    const indices = [0, 1, 2].map(corner => index?.getX(face + corner) ?? face + corner);
    geometry.push({ family: 'wheels',
      points: indices.map(vertex => new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld).toArray()) as ProjectionTriangle['points'],
      uv: indices.map(vertex => [uv.getX(vertex), uv.getY(vertex)]) as ProjectionTriangle['uv'] });
  }
});
assert(geometry.length > 1000, 'Live preview projects through actual Stadium wheel UV geometry');
const canvas = (colour: string, size = 128) => {
  const result = document.createElement('canvas'); result.width = result.height = size;
  const context = result.getContext('2d')!; context.fillStyle = colour; context.fillRect(0, 0, size, size); return result;
};
const transparent = () => { const result = canvas('#00000000'); return result; };
const sourcePNG = (colour: string) => { const result = canvas(colour, 4), data = result.toDataURL('image/png'); result.width = result.height = 1; return data; };
const artwork = (colour: string): WheelDesignComposition => ({ version: 2, elements: [{ ...createWheelElement('ring'),
  design: { ...createWheelElement('ring').design, color: colour, radius: .82, width: .08 } }] });
const region = WHEEL_PART_GUIDES.find(item => item.key === 'tyres:outer')!;
const initialArtwork = artwork('#f08020');
const ownerDefinition = await createWheelArtworkDefinition(initialArtwork);
ownerDefinition.color = '#80c0ff'; ownerDefinition.opacity = .7;
ownerDefinition.roughness = 73; ownerDefinition.metalness = 28; ownerDefinition.emissionStrength = .8;
ownerDefinition.emissionColor = '#4090f0'; ownerDefinition.dirt = 61;
ownerDefinition.normalStrength = .6; ownerDefinition.aoStrength = .8;
ownerDefinition.textures.normal = { src: sourcePNG('#9470f4'), name: 'Existing normal', component: 'r', invert: false };
ownerDefinition.textures.ao = { src: sourcePNG('#8c8c8c'), name: 'Existing cavity', component: 'r', invert: false };
const owner: MaterialLayer = { definition: ownerDefinition, family: 'wheels',
  regions: [{ key: region.key, label: region.label, polygons: region.polygons }], exclusions: [] };
const maps = new Map<MapId, { below: HTMLCanvasElement; above: HTMLCanvasElement }>();
for (const [id, base] of [['Wheels_B', '#1f2c37'], ['Wheels_R', '#402010'], ['Wheels_I', '#000000'], ['Wheels_DirtMask', '#0c0c0c'], ['Skin_B', '#556677']] as const) {
  const above = transparent();
  if (id === 'Wheels_B') { const c = above.getContext('2d')!; c.fillStyle = '#1feea3'; c.fillRect(0, 0, 128, 24); }
  maps.set(id, { below: canvas(base), above });
}
const context: WheelDesignPreviewContext = { maps, modelPreview: new ArrayBuffer(16), nativeSurfaceLayout: true,
  wheelSurface: { mode: 'mud', strength: .67, volume: true }, pose: { steering: 13, spin: 37, reactor: 'up' },
  surfaceFiles: [{ name: 'Wheels_N.dds', data: new Uint8Array([1, 4, 9]) }],
  surfaceOverlays: [{ family: 'skin', normal: { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 255, 90]) } },
    { family: 'wheels', normal: { width: 1, height: 1, data: new Uint8ClampedArray([210, 128, 220, 255]) } }], surfaceOverlayInsertIndex: 1,
  ownerOpacity: .55, ownerVisible: true, initialTarget: 'outer', layer: owner };
const originalMaps = [...maps].map(([id, entry]) => [id, entry.below.toDataURL(), entry.above.toDataURL()]);
const originalOwner = structuredClone(owner), originalFiles = structuredClone(context.surfaceFiles);
const originalOverlays = structuredClone(context.surfaceOverlays);
const checkSources = () => {
  assert.deepEqual([...maps].map(([id, entry]) => [id, entry.below.toDataURL(), entry.above.toDataURL()]), originalMaps,
    'Every below/above paint snapshot stays byte-identical');
  assert.deepEqual(owner, originalOwner, 'A live draft never updates the editable material owner');
  assert.deepEqual(context.surfaceFiles, originalFiles, 'Imported normals and game files remain read-only');
  assert.deepEqual(context.surfaceOverlays, originalOverlays, 'Existing PBR surface overlays remain read-only');
};
type Preview = ReturnType<WheelDesignModelPreviewRuntime['createPreview']>;
type SurfaceOverlays = Parameters<CarPreview['setMaterialSurfaceOverlays']>[0];
interface BoundMap { id: MapId; source: HTMLCanvasElement; data: Uint8ClampedArray; width: number; height: number; roles?: Uint8ClampedArray }
const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const tick = async (milliseconds = 65) => { await act(async () => { await delay(milliseconds); }); };
const wait = async (condition: () => boolean, message: string) => {
  const until = performance.now() + 12_000;
  while (!condition() && performance.now() < until) await tick(45);
  assert(condition(), message);
};
const deferred = () => {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};
function harness(options: { definitionGate?: ReturnType<typeof deferred>; sessionGate?: ReturnType<typeof deferred> } = {}) {
  const events: string[] = [], focus: string[] = [], bound: BoundMap[] = [], definitions: MaterialDefinition[] = [], areas: string[] = [], areaMasks: boolean[] = [], braking: boolean[] = [];
  const generated: MaterialDefinition[] = [], rendered: MaterialLayer[] = [], channels: HTMLCanvasElement[] = [], overlays: SurfaceOverlays[] = [];
  const colourReferences: Uint8ClampedArray[] = [];
  let previews = 0, sessions = 0, previewDisposed = 0, sessionDisposed = 0, activeDefinitions = 0, maxDefinitions = 0, definitionCalls = 0, loadCalls = 0;
  let instance!: Preview;
  const runtime: WheelDesignModelPreviewRuntime = {
    createPreview(target) {
      assert(host.contains(target)); previews++; events.push('create');
      instance = { onModelReady: null,
        async loadCustomPreview(data, settings) {
          assert.equal(data, context.modelPreview); assert.deepEqual(settings, { nativeSurfaceLayout: true, detailsLayout: undefined });
          events.push('custom'); instance.onModelReady?.();
        },
        setMapCanvas(id, source, roles) {
          assert(![...maps.values()].some(entry => entry.below === source || entry.above === source), 'GPU bindings use owned copies rather than editor snapshots');
          bound.push({ id, source, width: source.width, height: source.height,
            data: source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data,
            ...(roles ? { roles: roles.getContext('2d')!.getImageData(0, 0, roles.width, roles.height).data } : {}) }); events.push(`map:${id}`);
        },
        setSurfaceTextures(files) { assert.equal(files, context.surfaceFiles); events.push('surfaces'); },
        setWheelSurface(settings) { assert.deepEqual(settings, context.wheelSurface); events.push('tread'); },
        setVehiclePose(pose) { assert.deepEqual(pose, context.pose); events.push('pose'); },
        getProjectionTriangles() { return geometry; },
        getViewState() { return { position: [1, 2, 3], target: [0, 0, 0] }; },
        focusWheelForDesign(side = 'outer') { focus.push(side); events.push(`focus:${side}`); return true; },
        setMaterialSurfaceOverlays(value) { overlays.push(structuredClone(value)); },
        setBraking(value) { braking.push(value); },
        dispose() { previewDisposed++; events.push('dispose'); },
      };
      return instance;
    },
    async createDefinition(value: WheelDesignArtwork) {
      definitionCalls++; activeDefinitions++; maxDefinitions = Math.max(maxDefinitions, activeDefinitions);
      try {
        if (definitionCalls === 1 && options.definitionGate) await options.definitionGate.promise;
        const result = await createWheelArtworkDefinition(value); generated.push(structuredClone(result)); return result;
      } finally { activeDefinitions--; }
    },
    createVisibleArea(triangles, side, options) {
      assert.equal(triangles, geometry); assert.deepEqual(options.pose, context.pose); assert.equal(options.definition, context.layer!.definition);
      assert.deepEqual(options.center, [0, 0, 0]); areas.push(side); areaMasks.push(!!options.layer); return canvas('#ffffff', 16);
    },
    createSession() {
      sessions++; const actual = createMaterialRenderSession();
      return {
        async load(value) {
          definitions.push(structuredClone(value)); loadCalls++;
          if (loadCalls === 1 && options.sessionGate) await options.sessionGate.promise;
          await actual.load(value);
        },
        render(layer, size, triangles) {
          assert.equal(triangles, geometry); rendered.push(structuredClone(layer));
          const result = actual.render(layer, size, triangles); channels.push(...result.values());
          const source = result.get('color');
          if (source) {
            const sampled = transparent(), sampledContext = sampled.getContext('2d')!;
            sampledContext.drawImage(source, 0, 0, 128, 128);
            colourReferences.push(sampledContext.getImageData(0, 0, 128, 128).data);
            sampled.width = sampled.height = 1;
          }
          return result;
        },
        dispose() { sessionDisposed++; actual.dispose(); },
      };
    },
  };
  return { runtime, events, focus, bound, definitions, generated, rendered, channels, overlays, colourReferences, areas, areaMasks, braking,
    counters: () => ({ previews, sessions, previewDisposed, sessionDisposed, definitionCalls, maxDefinitions }),
    ready: async () => { await act(async () => { instance.onModelReady?.(); }); },
    current: () => instance,
  };
}
let currentArtwork = initialArtwork, target: 'outer' | 'inner' | 'both' = 'outer';
let currentContext = context;
let coverage: import('../src/ui/WheelDesignDialog').WheelDesignCoverage = null;
const onCoverageChange = (value: typeof coverage) => { coverage = value; };
const draw = async (test: ReturnType<typeof harness>) => {
  await act(async () => root.render(<WheelDesignModelPreview artwork={currentArtwork} target={target} context={currentContext} onCoverageChange={onCoverageChange} runtime={test.runtime} />));
};
const unmount = async () => { await act(async () => root.render(null)); };
const latestBound = (test: ReturnType<typeof harness>, id: MapId) => test.bound.findLast(item => item.id === id)!;
const rgba = (map: BoundMap, x: number, y: number) => Array.from(map.data.slice((y * map.width + x) * 4, (y * map.width + x) * 4 + 4));

try {
  const test = harness(); await draw(test);
  assert.equal(test.counters().previews, 1); assert.equal(test.bound.length, 0, 'The preview waits for the actual model before painting');
  await test.ready(); await wait(() => test.rendered.length === 1 && test.bound.length >= 9, 'Initial projected artwork finishes');
  await wait(() => coverage?.side === 'outer', 'Coverage follows the selected wheel');
  assert.deepEqual(test.areas, ['outer']); assert.deepEqual(test.areaMasks, [true], 'The original material mask is used for its original target');
  assert.deepEqual(test.events.slice(0, 5), ['create', 'custom', 'surfaces', 'tread', 'pose']);
  assert(test.focus.includes('outer'));
  const first = latestBound(test, 'Wheels_B');
  assert.deepEqual(rgba(first, 120, 8), [31, 238, 163, 255], 'An opaque paint layer above the owner still covers the live draft');
  assert.deepEqual(rgba(first, 64, 80), [31, 44, 55, 255], 'Transparent atlas gaps retain the painting below the owner');
  let livePixels = 0;
  for (let y = 24; y < first.height; y++) for (let x = 0; x < first.width; x++) {
    const p = rgba(first, x, y); if (p[0] !== 31 || p[1] !== 44 || p[2] !== 55) livePixels++;
  }
  assert(livePixels > 20, 'The real material session produces visible projected pigment between surrounding layers');
  const overlay = test.colourReferences[0];
  let opacityChecked = false;
  for (let y = 24; y < first.height && !opacityChecked; y++) for (let x = 0; x < first.width; x++) {
    const offset = (y * first.width + x) * 4, mask = overlay[offset + 3] / 255;
    if (mask < .5) continue;
    const actual = rgba(first, x, y);
    for (let channel = 0; channel < 3; channel++) {
      const weight = mask * context.ownerOpacity;
      const expected = overlay[offset + channel] * weight + [31, 44, 55][channel] * (1 - weight);
      assert(Math.abs(actual[channel] - expected) <= 2, 'Material opacity and owner opacity multiply without repainting the underlying source');
    }
    opacityChecked = true; break;
  }
  assert(opacityChecked, 'A fully projected tinted mark exercises real owner-opacity composition');
  const loaded = test.definitions[0];
  for (const key of ['color', 'opacity', 'roughness', 'metalness', 'emissionColor', 'emissionStrength', 'dirt', 'normalStrength', 'aoStrength', 'transform'] as const) {
    assert.deepEqual(loaded[key], ownerDefinition[key], `Existing ${key} stays in the 3D draft`);
  }
  assert.deepEqual(loaded.textures.normal, ownerDefinition.textures.normal); assert.deepEqual(loaded.textures.ao, ownerDefinition.textures.ao);
  assert.equal(loaded.textures.color!.src, (await createWheelArtworkDefinition(initialArtwork)).textures.color!.src,
    'The live projection uses exactly the same source PNG as applying the composition');
  assert.deepEqual(test.rendered[0].regions, owner.regions, 'Editing without changing sides retains the exact existing material mask');
  assert(test.overlays.at(-1)!.some(overlay => overlay.family === 'wheels' && overlay.normal && overlay.ao), 'Existing normal/AO properties reach the production surface overlay');
  const currentSurfaces = test.overlays.at(-1)!;
  assert.deepEqual(currentSurfaces.at(-1), context.surfaceOverlays![1], 'A later wheel material stays above the live draft normal map');
  const wheelNormals = currentSurfaces.filter(overlay => overlay.family === 'wheels').flatMap(overlay => overlay.normal ? [overlay.normal] : []);
  assert.deepEqual(composeMaterialSurface(null, wheelNormals, true, 1), composeMaterialSurface(null, [context.surfaceOverlays![1].normal!], true, 1),
    'An opaque normal layer above the owner has the same final vector as the applied material stack');
  assert(test.channels.every(source => source.width === 1 && source.height === 1), 'Temporary material channel canvases are released after each paint');
  const focusCount = test.focus.length;
  currentArtwork = artwork('#21d090'); await draw(test);
  await wait(() => test.rendered.length === 2, 'Changed artwork reaches the live wheel');
  assert.equal(test.counters().previews, 1); assert.equal(test.counters().sessions, 1);
  assert.equal(test.focus.length, focusCount, 'Changing artwork keeps orbit/zoom rather than resetting its camera');
  assert.notDeepEqual(latestBound(test, 'Wheels_B').data, first.data, 'The wheel painting actually changes when the source composition changes');
  target = 'inner'; await draw(test); await wait(() => test.rendered.length === 3, 'The inner side receives a fresh projection');
  await wait(() => coverage?.side === 'inner', 'Coverage follows the inner face');
  assert.deepEqual(test.areas, ['outer', 'inner']); assert.deepEqual(test.areaMasks, [true, false], 'Changing the target uses the new whole-side mask');
  assert.equal(test.focus.at(-1), 'inner');
  assert.deepEqual(test.rendered.at(-1)!.regions.map(item => item.key), ['tyres:inner']);
  target = 'both'; await draw(test); await wait(() => test.rendered.length === 4, 'Both sidewalls receive the same current draft');
  assert.deepEqual(test.rendered.at(-1)!.regions.map(item => item.key), ['tyres:outer', 'tyres:inner']);
  const outerButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Extérieur')!;
  await act(async () => outerButton.click()); assert.equal(test.focus.at(-1), 'outer');
  assert.equal(test.counters().previews, 1, 'Looking at the other side reuses the same renderer');
  currentArtwork = { version: 2, elements: currentArtwork.elements.map(element => ({ ...element, visible: false })) };
  const beforeClear = test.bound.length; await draw(test); await wait(() => test.bound.length > beforeClear, 'Hiding all elements clears the old live draft');
  assert.deepEqual(rgba(latestBound(test, 'Wheels_B'), 120, 90), [31, 44, 55, 255]);
  assert.deepEqual(test.overlays.at(-1), context.surfaceOverlays, 'Clearing a draft also clears its former normal/AO overlays');
  const blankText = createWheelElement('lettering'); blankText.design.text = '';
  currentArtwork = { version: 2, elements: [blankText] };
  const blankCount = test.bound.length; await draw(test); await wait(() => test.bound.length > blankCount, 'Temporarily empty text leaves no stale marks');
  assert(!host.textContent?.includes('invalides')); checkSources();
  currentArtwork = artwork('#f08020'); currentArtwork.elements[0].emission = 1; currentArtwork.elements[0].emissionRole = 'brake';
  const beforeLight = test.rendered.length; await draw(test); await wait(() => test.rendered.length > beforeLight, 'Brake lights reach the live wheel');
  assert(latestBound(test, 'Wheels_I').roles?.some((value, index) => index % 4 === 0 && value === 3), 'Live preview receives the projected brake-role pixels');
  const brakeButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Freinage')!;
  await act(async () => brakeButton.click()); assert.equal(test.braking.at(-1), true, 'The workshop can simulate braking');
  const boundCopies = new Set(test.bound.map(item => item.source)); await unmount();
  assert.equal(test.counters().previewDisposed, 1); assert.equal(test.counters().sessionDisposed, 1);
  assert.equal(test.current().onModelReady, null); assert([...boundCopies].every(source => source.width === 1 && source.height === 1));
  checkSources();

  const gate = deferred(), race = harness({ definitionGate: gate });
  currentArtwork = artwork('#ff3300'); target = 'outer'; currentContext = context;
  await draw(race); await race.ready(); await wait(() => race.counters().definitionCalls === 1, 'An initial definition can be in flight');
  const baseMaps = race.bound.length;
  currentArtwork = artwork('#3377ff'); await draw(race);
  currentArtwork = artwork('#77cc33'); target = 'inner'; await draw(race);
  currentArtwork = artwork('#e6cc22'); await draw(race);
  assert.equal(race.counters().definitionCalls, 1, 'Rapid edits queue one latest build instead of concurrent source decodes');
  await act(async () => gate.resolve());
  await wait(() => race.counters().definitionCalls === 2 && race.rendered.length === 1, 'Only the newest queued target is projected');
  assert.equal(race.counters().maxDefinitions, 1);
  assert.deepEqual(race.rendered[0].regions.map(item => item.key), ['tyres:inner']);
  assert.deepEqual(race.generated.at(-1)!.wheelDesign, currentArtwork);
  assert.equal(race.bound.length - baseMaps, 4, 'An obsolete outer target does not flash its old pigment into the wheel');
  await unmount(); checkSources();

  const loadGate = deferred(), stale = harness({ sessionGate: loadGate });
  currentArtwork = artwork('#cc2200'); target = 'outer'; await draw(stale); await stale.ready();
  await wait(() => stale.definitions.length === 1, 'The old session source load is pending');
  currentArtwork = artwork('#22ccaa'); await draw(stale);
  await act(async () => loadGate.resolve());
  await wait(() => stale.counters().definitionCalls === 2
    && JSON.stringify(stale.rendered.at(-1)?.definition.wheelDesign) === JSON.stringify(currentArtwork), 'The newest artwork survives an old async decode');
  assert.equal(stale.rendered.length, 1, 'An old artwork with the same target cannot overwrite the newer draft');
  assert.deepEqual(stale.rendered[0].definition.wheelDesign, currentArtwork);
  await unmount(); checkSources();

  const failureGate = deferred(), oldFailure = harness({ definitionGate: failureGate });
  currentArtwork = artwork('#aa3300'); target = 'outer'; await draw(oldFailure); await oldFailure.ready();
  await wait(() => oldFailure.counters().definitionCalls === 1, 'An old definition is waiting');
  target = 'inner'; currentArtwork = artwork('#0044ee'); await draw(oldFailure);
  await act(async () => failureGate.reject(new Error('OLD TARGET FAILURE')));
  assert(!host.textContent?.includes('OLD TARGET FAILURE'), 'A rejected obsolete target never surfaces as the current draft error');
  await wait(() => oldFailure.rendered.length === 1, 'The new target still renders after an obsolete failure');
  await unmount(); checkSources();

  const closeGate = deferred(), closing = harness({ definitionGate: closeGate });
  target = 'outer'; currentArtwork = artwork('#80aabb'); await draw(closing); await closing.ready();
  await wait(() => closing.counters().definitionCalls === 1, 'A close can occur while PNG creation is pending');
  const countBeforeClose = closing.bound.length; await unmount();
  await act(async () => closeGate.resolve()); await tick();
  assert.equal(closing.bound.length, countBeforeClose, 'Unmounted previews never bind a late PNG or mutate the closed editor');
  assert.equal(closing.counters().previewDisposed, 1); assert.equal(closing.counters().sessionDisposed, 1); checkSources();
  console.log('✓ Atelier 3D : vrais FBX/PNG/PBR, peinture below/draft/above intacte, caméra stable, cibles, dernière génération et nettoyage');
} finally {
  await act(async () => root.unmount()); host.remove();
  for (const { below, above } of maps.values()) below.width = below.height = above.width = above.height = 1;
  model.traverse(object => { if (object instanceof THREE.Mesh) {
    object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  } });
}
