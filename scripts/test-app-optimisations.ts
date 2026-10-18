import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { getEnv } from 'fabric/node';
import { setEnv } from 'fabric';
import * as THREE from 'three';
import { DemandRenderLoop } from '../src/three/DemandRenderLoop';
import { CarPreview } from '../src/three/CarPreview';
import { REST_VEHICLE_POSE } from '../src/three/vehiclePose';
import { MAPS, type MapId } from '../src/maps';
import { buildSkinZipFromImages, buildSkinZipFromEncodedMaps, encodeSkinMap, type BuildSkinZipOptions, type EncodedSkinMaps } from '../src/skinZip';
import { createSkinZipEncoder, type SkinZipEncoder } from '../src/workers/skinZipClient';
import type { SkinZipReply, SkinZipRequest } from '../src/workers/skinZipProtocol';
import type { RGBAImage } from '../src/dds';
import { encodeHorn } from '../src/horn';
import { REAL_UV_ATLAS } from '../src/realUvAtlas';

let serial = 0, time = 0;
const frames = new Map<number, FrameRequestCallback>();
const schedule = (callback: FrameRequestCallback) => { const id = ++serial; frames.set(id, callback); return id; };
const cancel = (id: number) => { frames.delete(id); };
const tick = () => { const pending = [...frames.values()]; frames.clear(); time += 16; for (const callback of pending) callback(time); };
let renders = 0, moving = false;
const loop = new DemandRenderLoop(() => { renders++; return moving; }, schedule, cancel);
for (let i = 0; i < 100; i++) loop.invalidate();
assert.equal(frames.size, 1, 'A burst of texture/camera changes requests one frame');
tick(); assert.equal(renders, 1); assert.equal(frames.size, 0);
for (let i = 0; i < 300; i++) tick();
assert.equal(renders, 1, 'Five seconds at rest do not produce GPU renders');
moving = true; loop.invalidate(); tick(); tick(); tick(); assert.equal(frames.size, 1);
moving = false; tick(); assert.equal(frames.size, 0, 'Camera damping continues until motion settles');
loop.invalidate(); loop.setActive(false); assert.equal(frames.size, 0);
loop.invalidate(); tick(); const asleep = renders;
loop.setActive(true); tick(); assert.equal(renders, asleep + 1, 'Returning to a visible pane renders pending changes');
loop.invalidate(); const stale = [...frames.values()][0]; loop.dispose(); stale(time); tick();
assert.equal(renders, asleep + 1, 'Disposal cancels frames and ignores late callbacks');
let reentrant = 0;
const nested = new DemandRenderLoop(() => { if (++reentrant === 1) nested.invalidate(); return false; }, schedule, cancel);
nested.invalidate(); tick(); tick(); assert.equal(reentrant, 2, 'Updates during rendering are not lost'); nested.dispose();

// Exercise actual preview entry points, using CPU materials instead of WebGL.
setEnv(getEnv());
Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
let previewFrames = 0;
const previewLoop = new DemandRenderLoop(() => { previewFrames++; return false; }, schedule, cancel);
const preview = Object.create(CarPreview.prototype) as CarPreview;
const mats = { skin: new THREE.MeshPhysicalMaterial(), details: new THREE.MeshStandardMaterial(), wheels: new THREE.MeshStandardMaterial() };
Object.assign(preview, {
  frameLoop: previewLoop, textures: new Map(), illumination: new Map(), baseSources: new Map(), dirtMasks: new Map(), dirtCanvases: new Map(),
  skinMat: mats.skin, detailsMat: mats.details, wheelsMat: mats.wheels,
  renderer: { capabilities: { getMaxAnisotropy: () => 1 } },
  studioRoot: new THREE.Group(), studioEnvironment: { root: new THREE.Group(), environmentMap: () => null },
  camera: { position: new THREE.Vector3(1, 2, 3) }, scene: new THREE.Scene(),
  previewEnvironment: { venue: 'studio', mood: 'day' }, vehiclePose: { ...REST_VEHICLE_POSE },
});
const source = document.createElement('canvas'); source.width = source.height = 8;
preview.setMapCanvas('Skin_B', source); preview.setBraking(true); preview.setEmissiveIntensity(2); preview.setCoatIntensity(.5);
preview.setEnvironment({ venue: 'studio', mood: 'day' }); preview.setVehiclePose({ ...REST_VEHICLE_POSE });
assert.equal(frames.size, 1); tick(); assert.equal(previewFrames, 1);
preview.setBraking(false); tick(); assert.equal(previewFrames, 2, 'A light switch wakes a stationary preview');
previewLoop.dispose(); for (const material of Object.values(mats)) material.dispose();

// Mimic native structured-clone and real encoding, including transfer ownership.
class LocalWorker {
  onmessage: ((event: { data: SkinZipReply }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = 0; maps = 0; transfers = 0;
  failInit = false; crashOnMap = false;
  private options?: BuildSkinZipOptions;
  private encoded: EncodedSkinMaps = {};
  postMessage(message: SkinZipRequest, transfer: Transferable[] = []) {
    const copy = structuredClone(message, { transfer });
    this.transfers += transfer.length;
    queueMicrotask(async () => {
      try {
        let blob: Blob | undefined;
        if (copy.command === 'init') { if (this.failInit) throw new Error('Worker unavailable'); this.options = copy.options; }
        else if (copy.command === 'map') {
          if (this.crashOnMap) { this.onerror?.({ preventDefault() {} }); return; }
          this.maps++;
          this.encoded[copy.id] = encodeSkinMap(copy.id, copy.image, { ...this.options!, ...(copy.roles ? { illumRolesByMap: { [copy.id]: copy.roles } } : {}) });
        } else blob = await buildSkinZipFromEncodedMaps(this.encoded, this.options!);
        this.onmessage?.({ data: { request: copy.request, blob } });
      } catch (error) { this.onmessage?.({ data: { request: copy.request, error: String(error) } }); }
    });
  }
  terminate() { this.terminated++; }
}
const image = (seed: number): RGBAImage => {
  const data = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) data.set([(x * 7 + seed) % 255, (y * 8 + seed) % 255, seed, 255], (y * 32 + x) * 4);
  return { width: 32, height: 32, data };
};
const images = Object.fromEntries(MAPS.map((map, index) => [map.id, image(20 + index)])) as Record<MapId, RGBAImage>;
const roles = image(0); for (let i = 0; i < roles.data.length; i += 4) roles.data[i] = i % 8 ? 3 : 103;
const horn = encodeHorn([Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 20) * .2)], 44100, 'Validation.mp3');
const options: BuildSkinZipOptions = { skinName: 'Streaming', horn, dirtEnabled: false, uvAtlas: REAL_UV_ATLAS,
  meshGbx: new Uint8Array([1, 2, 3]), previewGlb: new Uint8Array([4, 5, 6]).buffer,
  passthrough: [{ name: 'fakeshad.dds', data: new Uint8Array([7, 8, 9]) }] };
const optionsBefore = structuredClone(options);
const worker = new LocalWorker();
const noInline = () => { throw new Error('Must use the worker'); };
const encoder = await createSkinZipEncoder(options, noInline, () => worker as unknown as Worker);
for (const map of MAPS) {
  const pixels = structuredClone(images[map.id]);
  const mask = map.kind === 'illum' ? structuredClone(roles) : undefined;
  await encoder.addMap(map.id, pixels, mask);
  assert.equal(pixels.data.byteLength, 0, 'A completed channel leaves no duplicate main-thread pixel buffer');
  if (mask) assert.equal(mask.data.byteLength, 0);
}
const blob = await encoder.finish(); encoder.dispose(); encoder.dispose();
assert.equal(worker.maps, 13); assert.equal(worker.transfers, 16); assert.equal(worker.terminated, 1);
assert.deepEqual(options, optionsBefore, 'Mesh, preview, passthrough files and original horn are never detached or mutated');
const direct = await buildSkinZipFromImages(images, { ...options, illumRolesByMap: { Skin_I: roles, Details_I: roles, Wheels_I: roles } });
const [streamedZip, directZip] = await Promise.all([JSZip.loadAsync(await blob.arrayBuffer()), JSZip.loadAsync(await direct.arrayBuffer())]);
assert.deepEqual(Object.keys(streamedZip.files), Object.keys(directZip.files));
for (const name of Object.keys(directZip.files)) {
  assert.deepEqual(await streamedZip.file(name)!.async('uint8array'), await directZip.file(name)!.async('uint8array'), `${name}: streaming retains byte-identical DDS, mipmaps, lights, audio and model files`);
}
const inline: SkinZipEncoder = { addMap: async () => {}, finish: async () => new Blob(['fallback']), dispose() {} };
assert.equal(await createSkinZipEncoder(options, () => inline, () => null), inline);
assert.equal(await createSkinZipEncoder(options, () => inline, () => { throw new Error('CSP'); }), inline);
const failedStartup = new LocalWorker(); failedStartup.failInit = true;
assert.equal(await createSkinZipEncoder(options, () => inline, () => failedStartup as unknown as Worker), inline);
assert.equal(failedStartup.terminated, 1, 'Startup failures free the worker before safe inline fallback');
const crashed = new LocalWorker(); crashed.crashOnMap = true;
const interrupted = await createSkinZipEncoder(options, noInline, () => crashed as unknown as Worker);
await assert.rejects(interrupted.addMap('Skin_B', image(1)), /interrompue/); interrupted.dispose();
assert.equal(crashed.terminated, 1); assert.deepEqual(options, optionsBefore);
const boundedWorker = new LocalWorker();
const bounded = await createSkinZipEncoder(options, noInline, () => boundedWorker as unknown as Worker);
const first = bounded.addMap('Skin_B', image(2));
const next = image(3);
await assert.rejects(bounded.addMap('Skin_R', next), /déjà en cours/);
assert(next.data.byteLength > 0, 'A rejected concurrent channel keeps ownership of its pixels');
await first; bounded.dispose();
console.log('✓ Optimisations : zéro rendu 3D au repos, reprise/damping/visibilité, changements de scène, un canal en vol, export DDS/feux/klaxon/mesh identique, transferts sûrs et erreurs réessayables');
