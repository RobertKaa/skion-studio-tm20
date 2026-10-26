import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEnv } from 'fabric/node';
import * as THREE from 'three';
import JSZip from 'jszip';
import { applyWheelTreadAppearance, hasWheelTreadAppearance, wheelTreadAppearanceCanvas, wheelTreadAppearanceCavity } from '../src/wheelTreadAppearance';
import { CarPreview } from '../src/three/CarPreview';
import { StudioEnvironment } from '../src/three/StudioEnvironment';
import { buildSkinZipFromImages, encodeSkinMap, exportSkinZip } from '../src/skinZip';
import { compressExportMaterial } from '../src/exportColorPreview';
import { decodeDDS, type RGBAImage } from '../src/dds';
import { MAPS, type MapId } from '../src/maps';
import { DEFAULT_WHEEL_SURFACE, type WheelSurfaceSettings } from '../src/wheelSurface';
import { WHEEL_TREAD_PRESET_MODES } from '../src/wheelTreads';

const desktop = getEnv();
Object.assign(globalThis, { document: desktop.document, window: desktop.window });
function solid(width: number, height: number, rgba: number[]): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}
const hash = (image: RGBAImage) => createHash('sha256').update(image.data).digest('hex');
const colour = solid(64, 64, [184, 80, 40, 173]);
const finish = solid(64, 64, [180, 220, 17, 173]);
for (let y = 0; y < colour.height; y++) for (let x = 0; x < colour.width; x++) {
  const i = (y * colour.width + x) * 4;
  colour.data.set([x * 4, y * 4, (x * 3 + y * 5) % 256, (x * 7 + y * 11) % 256], i);
  finish.data.set([(x * 7) % 256, (y * 9) % 256, (x + y * 2) % 256, (x * 3 + y * 13) % 256], i);
}
// A deliberately black cavity detects any colour or material modulation.
const cavity = solid(64, 64, [0, 0, 0, 255]);
const before = [hash(colour), hash(finish), hash(cavity)];
const allModes = ['smooth', 'relief', ...WHEEL_TREAD_PRESET_MODES] as const;
for (const mode of allModes) for (const strength of [0, .25, .5, 1]) for (const official of [false, true]) {
  const settings = { mode, strength };
  for (const [source, channel] of [[colour, 'color'], [finish, 'roughmetal']] as const) {
    const result = applyWheelTreadAppearance(source, channel, settings, official, cavity);
    assert.equal(result, source, `${mode}/${strength}: the exact painted ${channel} source is retained`);
    assert.equal(result.data, source.data, 'No copied, recoloured or alpha-rounded pixel buffer is introduced');
    assert.deepEqual(result.data, source.data, 'All RGBA components, including grooves and sidewalls, remain bit-identical');
  }
  assert(!hasWheelTreadAppearance('Wheels_B', settings, official), 'A profile never schedules baked colour shadows');
  assert(!hasWheelTreadAppearance('Wheels_R', settings, official), 'A profile never overrides a painted material');
}
assert.deepEqual([hash(colour), hash(finish), hash(cavity)], before);
assert.equal(applyWheelTreadAppearance(colour, 'color', { mode: 'road', strength: 1 }, true,
  { ...cavity, data: new Uint8ClampedArray(0) }), colour, 'Colour passthrough does not decode or allocate a cavity map');
assert.equal(wheelTreadAppearanceCavity({ mode: 'road', strength: 1 }, false), undefined, 'Unknown custom UVs retain their separate safe relief fallback');

const canvas = (size: number, color: string) => {
  const result = document.createElement('canvas'); result.width = result.height = size;
  result.getContext('2d')!.fillStyle = color; result.getContext('2d')!.fillRect(0, 0, size, size); return result;
};
const base = canvas(4, '#b85028'), packed = canvas(4, '#b4dc11');
const rawBase = base.toDataURL(), rawPacked = packed.toDataURL();
const target = canvas(7, '#123456'), targetBefore = target.toDataURL();
for (const mode of allModes) for (const channel of ['color', 'roughmetal'] as const) {
  const source = channel === 'color' ? base : packed;
  assert.equal(wheelTreadAppearanceCanvas(source, target, channel, { mode, strength: 1 }, true, cavity, 2048), source);
  assert.deepEqual([target.width, target.height], [7, 7], 'The unused adapter target is not resized');
  assert.equal(target.toDataURL(), targetBefore, 'The unused adapter target is not painted');
}

// Exercise actual live bindings: switching every tread changes relief only.
const preview = Object.create(CarPreview.prototype) as CarPreview;
const studioEnvironment = new StudioEnvironment();
const wheelMat = new THREE.MeshStandardMaterial(), packCanvas = canvas(4, '#ffffff');
const packTexture = new THREE.CanvasTexture(packCanvas);
Object.assign(preview, {
  requestRender: () => {}, baseSources: new Map(), dirtMasks: new Map(), dirtCanvases: new Map(), textures: new Map(),
  dirtEnabled: true, dirtAmount: 0, wheelSurface: DEFAULT_WHEEL_SURFACE, wheelAppearanceOfficial: true, wheelAppearanceCanvases: new Map(),
  rmPacks: new Map([['Wheels_R', { canvas: packCanvas, texture: packTexture }]]),
  renderer: { capabilities: { getMaxAnisotropy: () => 1 } }, wheelsMat: wheelMat,
  surfaceTextures: { setWheelSurface: () => {} }, ambientOcclusion: { setWheelSurface: () => {} }, studioEnvironment,
});
preview.setMapCanvas('Wheels_B', base); preview.setMapCanvas('Wheels_R', packed);
const boundTexture = wheelMat.map, originalPack = packCanvas.toDataURL();
for (const mode of allModes) for (const strength of [0, .5, 1]) {
  preview.setWheelSurface({ mode, strength });
  assert.equal(wheelMat.map, boundTexture, 'Profile changes do not replace the painted colour GPU binding');
  assert.equal(wheelMat.map!.image, base);
  assert.equal(packCanvas.toDataURL(), originalPack, 'Packed roughness/metalness retain the painted values');
}
const lighting = () => studioEnvironment.root.children.filter(object => object instanceof THREE.Light)
  .map(object => ({ color: (object as THREE.Light).color.getHex(), intensity: (object as THREE.Light).intensity }));
const originalLighting = lighting();
for (const mode of ['gravel', 'mud'] as const) for (const strength of [0, .5, 1]) for (const volume of [false, true]) {
  preview.setWheelSurface({ mode, strength, volume });
  assert.equal(wheelMat.map, boundTexture, 'Geometric tread keeps the same painted GPU source');
  assert.equal(packCanvas.toDataURL(), originalPack, 'Geometric tread keeps the same painted finish');
  assert.deepEqual(lighting(), originalLighting, 'Detailed groove shadows never change studio light colour or brightness');
}
Object.assign(preview, { wheelAppearanceOfficial: false, uvAtlas: 'organized-v1' });
preview.setWheelSurface({ mode: 'winter', strength: 1 });
assert.equal(wheelMat.map!.image, base, 'Reorganized UVs also keep the original colour source');
assert.equal(base.toDataURL(), rawBase); assert.equal(packed.toDataURL(), rawPacked);

const maps = Object.fromEntries(MAPS.map(map => [map.id, solid(4, 4, [184, 80, 40, 255])])) as Record<MapId, RGBAImage>;
maps.Wheels_B = colour; maps.Wheels_R = finish;
const mapsBefore = [hash(maps.Wheels_B), hash(maps.Wheels_R)];
const baseline = {
  Wheels_B: encodeSkinMap('Wheels_B', maps.Wheels_B, { skinName: 'Untinted' }),
  Wheels_R: encodeSkinMap('Wheels_R', maps.Wheels_R, { skinName: 'Untinted' }),
};
for (const mode of WHEEL_TREAD_PRESET_MODES) {
  const wheelSurface: WheelSurfaceSettings = { mode, strength: 1 };
  const blob = await buildSkinZipFromImages(maps, { skinName: 'Untinted', wheelSurface, wheelOfficialModel: true, wheelCavity: cavity });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  for (const id of ['Wheels_B', 'Wheels_R'] as const) {
    const encoded = await zip.file(`${id}.dds`)!.async('uint8array');
    assert.deepEqual(encoded, baseline[id], `${mode}: profile selection never changes exported ${id} DDS bytes`);
    assert.deepEqual(compressExportMaterial(id, maps[id]).levels[0], decodeDDS(encoded.slice().buffer), 'DDS comparison receives the original painted source');
  }
}
assert.deepEqual([hash(maps.Wheels_B), hash(maps.Wheels_R)], mapsBefore);
const exportFlat = (wheelSurface?: WheelSurfaceSettings) => exportSkinZip('Flat source', {
  textureResolution: 1024, maxExportRes: 64, getMapCanvas: id => id === 'Wheels_R' ? packed : base,
  wheelSurface, wheelOfficialModel: true, wheelCavity: cavity,
});
const untouchedZip = await JSZip.loadAsync(await (await exportFlat()).arrayBuffer());
const profiledZip = await JSZip.loadAsync(await (await exportFlat({ mode: 'winter', strength: 1 })).arrayBuffer());
for (const id of ['Wheels_B', 'Wheels_R']) {
  const data = await profiledZip.file(`${id}.dds`)!.async('uint8array');
  assert.deepEqual(data, await untouchedZip.file(`${id}.dds`)!.async('uint8array'), 'DOM export preserves painted DDS bytes too');
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.deepEqual([header.getUint32(16, true), header.getUint32(12, true)], [4, 4], 'Uniform painted backgrounds retain their existing compact export');
}
assert.equal(base.toDataURL(), rawBase); assert.equal(packed.toDataURL(), rawPacked);
for (const texture of (preview as unknown as { textures: Map<string, THREE.Texture> }).textures.values()) texture.dispose();
packTexture.dispose(); wheelMat.dispose();
studioEnvironment.dispose();
console.log('✓ Tyre paint invariant: every profile/strength preserves exact RGBA, alpha, finish, canvas, GPU binding and original live/compressed/ZIP colour/material bytes');
