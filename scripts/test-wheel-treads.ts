import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getEnv } from 'fabric/node';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { decodeDDS } from '../src/dds';
import {
  applyWheelRelief, buildWheelNormalFile, decodeNormalVectors, DEFAULT_WHEEL_SURFACE, getWheelTreadNormal,
  getWheelTreadSwatch, isWheelSurfaceMode, isWheelTreadPreset, normalizeWheelSurface,
  WHEEL_SURFACE_PRESETS, withWheelNormalFile,
} from '../src/wheelSurface';
import {
  getWheelTreadOcclusion, sampleWheelTreadHeight, WHEEL_SIDEWALL_UV,
  WHEEL_TREAD_DEPTH_MM, WHEEL_TREAD_PRESET_MODES, WHEEL_TREAD_SIZE, WHEEL_TREAD_UV,
} from '../src/wheelTreads';

// Independent geometry evidence: the generated mask must stay on radial tread
// faces, not on the much steeper sidewalls of the actual checked-in model.
Object.assign(globalThis, { document: getEnv().document, window: getEnv().window });
const source = readFileSync(new URL('../src/assets/model/car/StadiumCAR2020_OffsetFix.fbx', import.meta.url));
const model = new FBXLoader().parse(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), '');
let wheelMesh: THREE.Mesh | undefined;
model.traverse((object) => { if (object instanceof THREE.Mesh && object.name === 'Wheels_01') wheelMesh = object; });
assert(wheelMesh, 'The real wheel mesh is used to validate the atlas');
const uv = wheelMesh.geometry.attributes.uv, normals = wheelMesh.geometry.attributes.normal, positions = wheelMesh.geometry.attributes.position;
const columns = new Set<number>();
let radial = 0, sidewall = 0;
const seam0: THREE.Vector3[] = [], seam1: THREE.Vector3[] = [];
for (let i = 0; i < uv.count; i++) {
  const u = uv.getX(i), v = uv.getY(i), nx = Math.abs(normals.getX(i));
  columns.add(Math.round(u * 1e6) / 1e6);
  if (u >= WHEEL_TREAD_UV.minU - 1e-6 && u <= WHEEL_TREAD_UV.maxU + 1e-6) {
    radial++; assert(nx < 0.1, 'Every authored tread column faces radially rather than towards the axle');
    if (Math.abs(v) < 1e-6) seam0.push(new THREE.Vector3().fromBufferAttribute(positions, i));
    if (Math.abs(v - 1) < 1e-6) seam1.push(new THREE.Vector3().fromBufferAttribute(positions, i));
  }
  if (Math.abs(u - .087248) < 1e-6 || Math.abs(u - .852508) < 1e-6) {
    sidewall++; assert(nx > .7, 'Sidewall reference columns have steep axial normals');
  }
}
assert(columns.has(WHEEL_TREAD_UV.minU) && columns.has(WHEEL_TREAD_UV.maxU), 'Mask boundaries are actual FBX quad edges');
assert(radial > 4000 && sidewall > 2000);
assert(seam0.length && seam1.length);
for (const point of seam0) assert(seam1.some((other) => other.distanceTo(point) < .01), 'UV V=0/1 really close one physical revolution');

assert.equal(WHEEL_SURFACE_PRESETS.length, WHEEL_TREAD_PRESET_MODES.length + 2);
assert.equal(new Set(WHEEL_SURFACE_PRESETS.map((preset) => preset.id)).size, WHEEL_SURFACE_PRESETS.length);
for (const { id } of WHEEL_SURFACE_PRESETS) {
  assert(isWheelSurfaceMode(id)); assert.equal(normalizeWheelSurface({ mode: id, strength: .65 }).mode, id);
}
for (const bad of [null, '', '__proto__', 'wet', {}, ['rain'], 5]) {
  assert(!isWheelSurfaceMode(bad)); assert(!isWheelTreadPreset(bad));
  assert.equal(normalizeWheelSurface({ mode: bad }).mode, DEFAULT_WHEEL_SURFACE.mode);
}
const nativeBytes = readFileSync(new URL('../src/assets/model/car/Wheels_N.dds', import.meta.url));
const native = decodeDDS(nativeBytes.buffer.slice(nativeBytes.byteOffset, nativeBytes.byteOffset + nativeBytes.byteLength))!;
const nativeNormal = decodeNormalVectors(nativeBytes.buffer.slice(nativeBytes.byteOffset, nativeBytes.byteOffset + nativeBytes.byteLength))!;
const nativeHash = createHash('sha256').update(nativeNormal.data).digest('hex');
// Independent GPU-style four-corner sampling oracle. Filtering X/Y before
// reconstructing Z avoids nearest-neighbour stair steps on moulded lettering.
function nativeBilinearXY(x: number, y: number, width: number, height: number): [number, number] {
  const sx = Math.max(0, Math.min(nativeNormal.width - 1, (x + .5) * nativeNormal.width / width - .5));
  const sy = y * (nativeNormal.height - 1) / (height - 1);
  const left = Math.floor(sx), top = Math.floor(sy);
  const right = Math.min(nativeNormal.width - 1, left + 1), bottom = Math.min(nativeNormal.height - 1, top + 1);
  const tx = sx - left, ty = sy - top;
  const corners = [[left, top], [right, top], [left, bottom], [right, bottom]];
  const weights = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const result: [number, number] = [0, 0];
  for (let corner = 0; corner < 4; corner++) {
    const offset = (corners[corner][1] * nativeNormal.width + corners[corner][0]) * 4;
    result[0] += nativeNormal.data[offset] * weights[corner];
    result[1] += nativeNormal.data[offset + 1] * weights[corner];
  }
  return result;
}
assert.deepEqual(WHEEL_TREAD_SIZE, { width: 2048, height: 4096 }, 'Sub-millimetre lamellae receive a 4× atlas rather than native-size undersampling');
assert.deepEqual(WHEEL_TREAD_SIZE, { width: native.width * 4, height: native.height * 4 });

// Measure topology from physical height samples, independently of the normal
// encoder: two principal channels, a thin shallower channel and a broad outer land.
function semiSlickChannels(threshold: number) {
  const channels: { first: number; last: number }[] = [];
  for (let x = 1; x < 1200; x++) {
    const across = x / 1200;
    const continuous = Array.from({ length: 32 }, (_, y) => sampleWheelTreadHeight('semi-slick', across, y / 32))
      .every((height) => height < -threshold);
    if (continuous) {
      const last = channels.at(-1);
      if (last && last.last === x - 1) last.last = x;
      else channels.push({ first: x, last: x });
    }
  }
  return channels;
}
const continuousChannels = semiSlickChannels(.0023), principalChannels = semiSlickChannels(.0038);
assert.equal(continuousChannels.length, 3, 'The circuit mould has two main channels and one shallow narrow channel');
assert.equal(principalChannels.length, 2, 'The thin outside channel does not become a third main drainage channel');
assert(continuousChannels[2].last - continuousChannels[2].first < (continuousChannels[0].last - continuousChannels[0].first) / 2,
  'The auxiliary outside channel stays substantially narrower than the principal channels');
const centres = continuousChannels.map(({ first, last }) => (first + last) / 2400);
assert(centres[0] < .3 && centres[1] < .5 && centres[2] > .6);
assert(centres[1] - centres[0] < centres[2] - centres[1] - .02, 'Unequal rib widths make the semi-slick asymmetric');
assert(1 - centres[2] > centres[0] + .025, 'The outer shoulder is wider than the inner shoulder');
let outerContact = 0, coolingPockets = 0;
for (let y = 0; y < 512; y++) {
  const height = sampleWheelTreadHeight('semi-slick', .78, y / 512);
  if (Math.abs(height) < .00008) outerContact++;
  if (height < -.001) coolingPockets++;
}
assert(outerContact > 512 * .9 && coolingPockets > 0, 'The outer contact land remains broad, with a few shallow blind cooling pockets');

// An all-over X/diamond lattice cuts through the centre and gives two diagonal
// cuts in every rib. The full-wet mould instead has a single curved V family,
// three longitudinal drains, and substantial rubber between the outlets.
for (const across of [.08, .32, .65, .95]) {
  let outlets = 0, recessed = 0, deepest = 0;
  const starts: number[] = [];
  let previous = sampleWheelTreadHeight('rain', across, 1 - 1 / 2048) < -.005;
  for (let y = 0; y < 2048; y++) {
    const height = sampleWheelTreadHeight('rain', across, y / 2048), cut = height < -.005;
    if (cut && !previous) { outlets++; starts.push(y / 2048); }
    if (cut) recessed++;
    deepest = Math.min(deepest, height); previous = cut;
  }
  assert(outlets >= 41 && outlets <= 44, 'Each rain rib has one set of curved drainage outlets, not crossed diagonal families');
  assert(recessed > 350 && recessed < 650 && deepest < -.008, 'Wide full-wet outlets retain substantial contact rubber between deep cuts');
  const gaps = starts.slice(1).map((start, index) => start - starts[index]);
  assert(Math.max(...gaps) / Math.min(...gaps) > 1.15, 'The mould uses actual variable pitch rather than a uniformly stamped grid');
}
for (const across of [.278, .5, .722]) for (let y = 0; y < 256; y++) {
  assert(sampleWheelTreadHeight('rain', across, y / 256) < -.0088, 'Three continuous deep longitudinal drains connect the curved V outlets');
}
const rainCuts = (across: number) => Array.from({ length: 4096 }, (_, row) => sampleWheelTreadHeight('rain', across, row / 4096) < -.005);
function bestRainLag(outer: number, inner: number) {
  const outside = rainCuts(outer), inside = rainCuts(inner);
  let bestLag = 0, bestScore = -1;
  for (let lag = -100; lag <= 100; lag++) {
    let score = 0;
    for (let row = 0; row < outside.length; row++) if (outside[row] && inside[(row + lag + 4096) % 4096]) score++;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return bestLag;
}
const leftLag = bestRainLag(.08, .4), rightLag = bestRainLag(.92, .6);
assert(leftLag > 20 && leftLag < 80 && Math.abs(leftLag - rightLag) <= 3,
  'Both shoulder outlets converge towards the centre in the same V phase');
// Independently sampled depth and void ratios distinguish the uses instead of
// accepting several renamed copies of the same procedural tread.
const voidRatios = new Map<string, number>();
for (const mode of WHEEL_TREAD_PRESET_MODES) {
  let deepest = 0, voids = 0;
  for (let across = 1; across < 100; across++) for (let turn = 0; turn < 256; turn++) {
    const height = sampleWheelTreadHeight(mode, across / 100, turn / 256);
    assert(Number.isFinite(height) && height <= 0);
    deepest = Math.min(deepest, height);
    if (height < -.004) voids++;
  }
  assert(Math.abs(deepest * 1000 + WHEEL_TREAD_DEPTH_MM[mode]) < .03, `${mode}: declared depth matches the height field`);
  assert.equal(WHEEL_SURFACE_PRESETS.find((preset) => preset.id === mode)!.depthMm, WHEEL_TREAD_DEPTH_MM[mode]);
  voidRatios.set(mode, voids / (99 * 256));
  for (const across of [-1, 0, 1, 2, NaN, Infinity]) assert.equal(sampleWheelTreadHeight(mode, across, .2), 0);
  for (const turn of [NaN, Infinity, -Infinity]) assert.equal(sampleWheelTreadHeight(mode, .5, turn), 0);
}
assert(voidRatios.get('mud')! > voidRatios.get('classic')! * 1.5, 'Mud voids are substantially more open than vintage ribs');
assert(voidRatios.get('winter')! > voidRatios.get('semi-slick')! * 1.5, 'Dense winter sipes differ from broad circuit lands');
assert(voidRatios.get('rain')! > voidRatios.get('road')! + .04, 'The full-wet sculpture has more open drainage than a high-performance road tyre');
const signatures = new Set<string>();
const thumbnailSignatures = new Set<string>();
let nativeLoads = 0;
for (const mode of WHEEL_TREAD_PRESET_MODES) {
  const image = getWheelTreadNormal(mode);
  assert.equal(getWheelTreadNormal(mode), image, 'An immediately reused profile has stable bounded cache identity');
  const composite = getWheelTreadNormal(mode, nativeNormal);
  assert.equal(getWheelTreadNormal(mode, nativeNormal), composite, 'Native-flank composites are cached by source identity and profile');
  const occlusion = getWheelTreadOcclusion(mode);
  assert.deepEqual([occlusion.width, occlusion.height], [image.width, image.height]);
  signatures.add(createHash('sha256').update(image.data).digest('hex'));
  let changed = 0, preservedFlanks = 0, filteredFlanks = 0, neutralFlanks = 0, unchangedTread = 0;
  let flatAO = 0, recessedAO = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4, u = (x + .5) / image.width;
    assert.equal(image.data[i + 3], 255);
    if (u <= WHEEL_TREAD_UV.minU || u >= WHEEL_TREAD_UV.maxU) {
      if (image.data[i] === 128 && image.data[i + 1] === 128 && image.data[i + 2] === 255) neutralFlanks++;
      assert.equal(occlusion.data[i], 255, 'New groove AO never paints stale native grooves onto the flanks');
    } else if (image.data[i] !== 128 || image.data[i + 1] !== 128) changed++;
    if (u >= WHEEL_TREAD_UV.minU && u <= WHEEL_TREAD_UV.maxU) {
      if (composite.data[i] === image.data[i] && composite.data[i + 1] === image.data[i + 1] && composite.data[i + 2] === image.data[i + 2]) unchangedTread++;
    }
    if ((u <= WHEEL_SIDEWALL_UV.inner || u >= WHEEL_SIDEWALL_UV.outer) && x % 7 === 0 && y % 5 === 0) {
      const filtered = nativeBilinearXY(x, y, image.width, image.height);
      if (Math.abs(composite.data[i] - filtered[0]) <= 1 && Math.abs(composite.data[i + 1] - filtered[1]) <= 1) preservedFlanks++;
      else assert.fail(`${mode}: bilinearly filtered native sidewall X/Y changed at ${x},${y}`);
      const sx = Math.min(nativeNormal.width - 1, Math.floor(u * nativeNormal.width));
      const sy = Math.min(nativeNormal.height - 1, Math.floor(y / (image.height - 1) * (nativeNormal.height - 1)));
      const j = (sy * nativeNormal.width + sx) * 4;
      if (Math.abs(composite.data[i] - nativeNormal.data[j]) > 2 || Math.abs(composite.data[i + 1] - nativeNormal.data[j + 1]) > 2) filteredFlanks++;
    }
    // Sparse independent physical samples catch AO applied to normals' bright
    // edge rather than to the actual recessed floor, without a pixel snapshot.
    if (x % 13 === 0 && y % 17 === 0) {
      const across = (u - WHEEL_TREAD_UV.minU) / (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU);
      const height = sampleWheelTreadHeight(mode, across, y / (image.height - 1));
      const shade = occlusion.data[i];
      assert.equal(occlusion.data[i + 1], shade); assert.equal(occlusion.data[i + 2], shade);
      if (height === 0) { flatAO++; assert.equal(shade, 255, 'Uncut rubber stays unoccluded'); }
      if (height < -.001) { recessedAO++; assert(shade < 245 && shade >= 70, 'Deep moulded floors receive bounded occlusion at their physical position'); }
    }
  }
  const treadColumns = Array.from({ length: image.width }, (_, x) => (x + .5) / image.width)
    .filter((u) => u >= WHEEL_TREAD_UV.minU && u <= WHEEL_TREAD_UV.maxU).length;
  assert.equal(unchangedTread, treadColumns * image.height, 'Native sidewalls never restore old grooves on the newly sculpted band');
  assert.equal(neutralFlanks, (image.width - treadColumns) * image.height, 'The uncomposited profile has no invented flank relief');
  assert(preservedFlanks > 50_000 && filteredFlanks > 1_000, 'A dense independent sample confirms moulded flanks retain filtered relief without nearest-neighbour duplication');
  assert(flatAO > 100 && recessedAO > 100);
  assert(changed > 15_000, `${mode}: an actual substantial sculpture is generated`);
  assert.deepEqual(image.data.subarray(0, image.width * 4), image.data.subarray((image.height - 1) * image.width * 4), 'Normal samples join exactly at the circumference seam');
  for (const across of [.02, .15, .35, .5, .69, .82, .98]) for (const turn of [.001, .13, .271, .68, .99]) {
    assert(Math.abs(sampleWheelTreadHeight(mode, across, turn) - sampleWheelTreadHeight(mode, across, turn + 1)) < 1e-12, 'Physical tread height is periodic');
  }
  const original = createHash('sha256').update(image.data).digest('hex');
  const reduced = applyWheelRelief(image, .4);
  let fullEnergy = 0, reducedEnergy = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    // The new micrometre-scale grain lives near the unavoidable ±0.5-byte
    // neutral quantisation floor. Measure actual mould walls, not that noise.
    if (Math.max(Math.abs(image.data[i] - 127.5), Math.abs(image.data[i + 1] - 127.5)) < 8) continue;
    fullEnergy += Math.abs(image.data[i] - 127.5) + Math.abs(image.data[i + 1] - 127.5);
    reducedEnergy += Math.abs(reduced.data[i] - 127.5) + Math.abs(reduced.data[i + 1] - 127.5);
  }
  assert(fullEnergy > 100_000, 'Substantial mould-wall slopes are available for the strength proof');
  assert(reducedEnergy > fullEnergy * .34 && reducedEnergy < fullEnergy * .46, 'Strength changes actual tangent normal amplitude');
  assert.equal(createHash('sha256').update(image.data).digest('hex'), original, 'A strength change preserves the cached source');
  const file = await buildWheelNormalFile({ mode, strength: 1 }, [], true, async () => { nativeLoads++; return nativeBytes; });
  assert(file); assert.equal(String.fromCharCode(...file.data.subarray(84, 88)), 'ATI2');
  const decoded = decodeDDS(file.data.slice().buffer)!;
  assert.equal(decoded.width, image.width); assert.equal(decoded.height, image.height);
  assert.equal(new DataView(file.data.buffer).getUint32(28, true), 13, 'The 2048×4096 BC5 contains its complete mip chain');
  let error = 0;
  for (let i = 0; i < image.data.length; i += 4) error += Math.abs(composite.data[i] - decoded.data[i]) + Math.abs(composite.data[i + 1] - decoded.data[i + 1]);
  assert(error / (image.width * image.height * 2) < 2.5, 'The actual exported BC5 preserves the preview normal vectors including moulded flanks');
  const custom = await buildWheelNormalFile({ mode, strength: 1 }, [{ name: 'Wheels_N.dds', data: file.data }], false);
  const customImage = decodeDDS(custom!.data.slice().buffer)!;
  assert.equal(customImage.width, 4, 'Preset atlas is never applied to arbitrary imported UVs');
  assert.deepEqual([...customImage.data.subarray(0, 2)], [128, 128]);
  const thumb = getWheelTreadSwatch(mode);
  assert.deepEqual([thumb.width, thumb.height], [72, 96]);
  thumbnailSignatures.add(createHash('sha256').update(thumb.data).digest('hex'));
}
assert.equal(nativeLoads, WHEEL_TREAD_PRESET_MODES.length, 'Each official preset export resolves the native sidewall source');
assert.equal(createHash('sha256').update(nativeNormal.data).digest('hex'), nativeHash, 'Flank composition never mutates the native source');
assert.equal(signatures.size, WHEEL_TREAD_PRESET_MODES.length); assert.equal(thumbnailSignatures.size, WHEEL_TREAD_PRESET_MODES.length, 'Every style has a distinct faithful sample');

// The bounded two-profile LRU keeps recent sliders responsive while evicting
// a third, less recently used 64 MiB surface pair.
const recentRoad = getWheelTreadNormal('road');
const olderRain = getWheelTreadNormal('rain');
assert.equal(getWheelTreadNormal('road'), recentRoad);
getWheelTreadNormal('gravel');
assert.notEqual(getWheelTreadNormal('rain'), olderRain, 'A third profile evicts the least recently used base atlas');
const recentComposite = getWheelTreadNormal('road', nativeNormal);
const olderComposite = getWheelTreadNormal('rain', nativeNormal);
assert.equal(getWheelTreadNormal('road', nativeNormal), recentComposite);
getWheelTreadNormal('gravel', nativeNormal);
assert.notEqual(getWheelTreadNormal('rain', nativeNormal), olderComposite, 'Native-flank composite cache is also bounded to two recent profiles');

// Uniform, deliberately extreme source normals expose how old shoulder marks
// are faded out before the new tread starts, independently of native artwork.
const shoulderSource = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
for (let i = 0; i < shoulderSource.data.length; i += 4) shoulderSource.data.set([200, 170, 220, 255], i);
const shoulderComposite = getWheelTreadNormal('road', shoulderSource);
const atU = (u: number) => (Math.floor(u * shoulderComposite.width)) * 4;
for (const [flank, band] of [[WHEEL_SIDEWALL_UV.inner, WHEEL_TREAD_UV.minU], [WHEEL_SIDEWALL_UV.outer, WHEEL_TREAD_UV.maxU]]) {
  let previousDistance = Infinity;
  for (let step = 0; step < 10; step++) {
    const u = flank + (band - flank) * step / 10, i = atU(u);
    const distance = Math.hypot(shoulderComposite.data[i] - 128, shoulderComposite.data[i + 1] - 128);
    assert(distance <= previousDistance + 1, 'Old shoulder normals fade monotonically towards the new band');
    previousDistance = distance;
  }
  assert(previousDistance < 8, 'The old shoulder pattern is almost neutral before the new band begins');
}
assert.deepEqual([getWheelTreadSwatch('rain', Infinity, -500).width, getWheelTreadSwatch('rain', Infinity, -500).height], [72, 32], 'Swatch allocation bounds reject oversized or malformed dimensions');
assert.throws(() => getWheelTreadNormal('evil' as never), /inconnu/);

const existing = [{ name: 'old/WHEELS_AO.DDS', data: new Uint8Array([11]) }, { name: 'Details_AO.dds', data: new Uint8Array([22]) }, { name: 'Wheels_N.dds', data: new Uint8Array([33]) }];
const old = existing.slice();
const normalFile = (await buildWheelNormalFile({ mode: 'smooth', strength: 1 }))!;
for (const mode of ['smooth', ...WHEEL_TREAD_PRESET_MODES] as const) {
  assert.deepEqual(withWheelNormalFile(existing, normalFile, { mode, strength: 1 }).map((entry) => entry.name), ['Details_AO.dds', 'Wheels_N.dds'], 'Replacement surfaces do not export stale imported tread AO');
}
assert.equal(withWheelNormalFile(existing, normalFile, { mode: 'relief', strength: .5 })[0], existing[0], 'Imported relief keeps its paired AO');
assert.deepEqual(withWheelNormalFile(existing, normalFile, { mode: 'relief', strength: 0 }).map((entry) => entry.name), ['Details_AO.dds', 'Wheels_N.dds']);
assert.deepEqual(existing, old, 'Export filtering never destroys source assets; switching back to imported relief restores them');
console.log(`✓ ${WHEEL_TREAD_PRESET_MODES.length} profils pneus : moules référencés, deux canaux circuit + auxiliaire, V pluie à pas variable, flancs FBX, AO sombre alignée, BC5 2048×4096/13 mips, custom sûr et cache LRU`);
