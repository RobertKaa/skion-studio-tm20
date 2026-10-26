import assert from 'node:assert/strict';
import {
  getWheelTreadNormal, getWheelTreadOcclusion, isWheelTreadPreset, sampleWheelTreadHeight,
  WHEEL_TREAD_DEPTH_MM, WHEEL_TREAD_PRESET_MODES, WHEEL_TREAD_SIZE, WHEEL_TREAD_UV,
  type WheelTreadPresetMode,
} from '../src/wheelTreads';

const failures: string[] = [];
const check = (condition: unknown, message = 'Realism constraint failed') => { if (!condition) failures.push(message); };
const WIDTH = .283, CIRCUMFERENCE = 2.289;
const limits: Record<WheelTreadPresetMode, { void: readonly [number, number]; plateau: number }> = {
  'semi-slick': { void: [.065, .30], plateau: .55 },
  road: { void: [.12, .40], plateau: .45 },
  rain: { void: [.18, .55], plateau: .35 },
  gravel: { void: [.20, .55], plateau: .35 },
  touring: { void: [.10, .40], plateau: .45 },
  winter: { void: [.18, .60], plateau: .30 },
  mud: { void: [.25, .70], plateau: .20 },
  classic: { void: [.045, .30], plateau: .55 },
};
const signatures = new Map<WheelTreadPresetMode, number[]>();
const measured: Record<string, { deepVoid: number; rubber: number; floorAO: number }> = {};

// Physical sampling, independent of the authored strokes and polygon recipes.
// A photo-real tread has broad contact lands, flat recessed floors and narrow walls;
// uniformly wavy grooves or an all-over grid cannot satisfy every family's limits.
check(WIDTH / (WHEEL_TREAD_SIZE.width * (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU)) < .0004,
  'Sub-millimetre sipes need a cross-tread texel smaller than 0.4 mm');
check(CIRCUMFERENCE / (WHEEL_TREAD_SIZE.height - 1) < .00065,
  'Longitudinal sampling must retain fine zigzag lamellae');

for (const mode of WHEEL_TREAD_PRESET_MODES) {
  const depth = WHEEL_TREAD_DEPTH_MM[mode] / 1000;
  let deep = 0, plateau = 0, samples = 0;
  const signature: number[] = [];
  for (let row = 0; row < 240; row++) for (let column = 0; column < 100; column++) {
    const across = .02 + (column + .5) / 100 * .96, turn = (row + .37) / 240;
    const height = sampleWheelTreadHeight(mode, across, turn);
    check(Number.isFinite(height), `${mode}: finite physical height`);
    check(height >= -depth - 1e-7 && height <= 1e-7, `${mode}: recessed sculpture respects its source depth`);
    if (height < -depth * .75) deep++;
    if (Math.abs(height) < .00008) plateau++;
    if (row % 8 === 0 && column % 5 === 0) signature.push(height / depth);
    samples++;
  }
  const deepVoid = deep / samples, rubber = plateau / samples, bounds = limits[mode];
  check(deepVoid >= bounds.void[0] && deepVoid <= bounds.void[1],
    `${mode}: full-depth void ${deepVoid.toFixed(3)} should lie between ${bounds.void.join(' and ')}`);
  check(rubber >= bounds.plateau, `${mode}: ${rubber.toFixed(3)} flat contact rubber remains between drainage features`);
  signatures.set(mode, signature);

  const normal = getWheelTreadNormal(mode), ao = getWheelTreadOcclusion(mode);
  assert.equal(normal.width, WHEEL_TREAD_SIZE.width); assert.equal(ao.height, WHEEL_TREAD_SIZE.height);
  let floorCount = 0, floorAO = 0, flatFloorCount = 0, topCount = 0;
  for (let y = 5; y < normal.height - 5; y += 19) for (let x = 3; x < normal.width - 3; x += 11) {
    const u = (x + .5) / normal.width, i = (y * normal.width + x) * 4;
    const across = (u - WHEEL_TREAD_UV.minU) / (WHEEL_TREAD_UV.maxU - WHEEL_TREAD_UV.minU);
    if (across <= 0 || across >= 1) {
      assert.equal(ao.data[i], 255, 'Tread cavity shadows never stain the editable sidewalls');
      continue;
    }
    const height = sampleWheelTreadHeight(mode, across, y / (normal.height - 1));
    if (height < -depth * .96) {
      floorCount++; floorAO += ao.data[i];
      if (normal.data[i + 2] > 246) flatFloorCount++;
    }
    if (Math.abs(height) < .00004) { topCount++; check(ao.data[i] > 238, `${mode}: contact lands do not inherit floor shadows`); }
  }
  check(floorCount > 50 && topCount > 100, `${mode}: substantial real floors and contact lands survive rasterisation`);
  check(floorAO / floorCount < 110, `${mode}: recessed floors must be visibly dark rather than merely engraved`);
  check(flatFloorCount / floorCount > .70, `${mode}: groove floors stay flat instead of forming rounded tubes`);
  assert.deepEqual(normal.data.subarray(0, normal.width * 4), normal.data.subarray((normal.height - 1) * normal.width * 4), `${mode}: normals close at the rotation seam`);
  assert.deepEqual(ao.data.subarray(0, ao.width * 4), ao.data.subarray((ao.height - 1) * ao.width * 4), `${mode}: shadow floors close at the rotation seam`);
  for (const across of [.03, .19, .38, .5, .69, .89, .97]) for (const turn of [.0003, .173, .391, .739, .9997]) {
    check(Math.abs(sampleWheelTreadHeight(mode, across, turn) - sampleWheelTreadHeight(mode, across, turn + 1)) < 1e-8);
    check(Math.abs(sampleWheelTreadHeight(mode, across, turn) - sampleWheelTreadHeight(mode, across, turn - 1)) < 1e-8);
  }
  for (const across of [0, 1, -1, 2, NaN, Infinity]) assert.equal(sampleWheelTreadHeight(mode, across, .4), 0);
  for (const turn of [NaN, Infinity, -Infinity]) assert.equal(sampleWheelTreadHeight(mode, .4, turn), 0);
  measured[mode] = { deepVoid, rubber, floorAO: floorAO / floorCount };
}

for (const [mode, samples] of signatures) for (const [other, otherSamples] of signatures) {
  if (mode >= other) continue;
  const difference = samples.reduce((sum, value, i) => sum + Math.abs(value - otherSamples[i]), 0) / samples.length;
  check(difference > .035, `${mode}/${other}: different tyre families need different topology, not just depth multipliers`);
}
check(measured.rain.deepVoid > measured.road.deepVoid + .04,
  'A full-wet tyre needs visibly more open drainage than the sport-road mould');
check(measured.gravel.deepVoid < measured.mud.deepVoid + .08,
  'Rally gravel blocks must retain more contact land than sparse mud-terrain lugs');

// Measure shoulder notch timing around a real revolution. Variable pitch is a
// manufactured sequence, so its spacing should vary without gaps or duplicated seams.
function cutsAlong(mode: WheelTreadPresetMode, across: number, threshold: number) {
  const count = 16384, cuts: { start: number; end: number; depth: number }[] = [];
  let current: { start: number; end: number; depth: number } | undefined;
  for (let row = 0; row <= count; row++) {
    const height = row === count ? 0 : sampleWheelTreadHeight(mode, across, row / count);
    if (height < -threshold) {
      if (!current) current = { start: row / count, end: row / count, depth: -height };
      current.end = row / count; current.depth = Math.max(current.depth, -height);
    } else if (current) { cuts.push(current); current = undefined; }
  }
  return cuts;
}
const shoulderCuts = cutsAlong('road', .09, .002);
check(shoulderCuts.length > 28 && shoulderCuts.length < 110, 'Road shoulder notches have realistic whole-revolution pitch');
const pitches = shoulderCuts.slice(1).map((cut, i) => cut.start - shoulderCuts[i].start);
const meanPitch = pitches.reduce((sum, value) => sum + value, 0) / pitches.length;
const pitchVariation = Math.sqrt(pitches.reduce((sum, value) => sum + (value - meanPitch) ** 2, 0) / pitches.length) / meanPitch;
check(pitchVariation > .06 && pitchVariation < .4, `Road pitch variation ${pitchVariation.toFixed(3)} avoids uniform stamped grids`);

// A winter lamella is a thin shallow opening inside a block, not another full
// drainage channel. Classify physical cuts without reading generator features.
let winterSipes = 0;
for (const across of [.13, .23, .37, .5, .63, .77, .87]) {
  for (const cut of cutsAlong('winter', across, .00065)) {
    const width = (cut.end - cut.start) * CIRCUMFERENCE;
    if (width >= .0002 && width <= .0025 && cut.depth < .007) winterSipes++;
  }
}
check(winterSipes > 100, `Winter blocks retain many genuinely fine shallow sipes (${winterSipes} measured)`);
for (const mode of ['__proto__', 'constructor', '', null, {}, []]) check(!isWheelTreadPreset(mode));
assert.throws(() => getWheelTreadNormal('__proto__' as never), /inconnu/);
console.log(JSON.stringify({ profiles: measured, roadPitchVariation: pitchVariation, winterSipes }));
assert.deepEqual(failures, [], 'Physical realism constraints');
console.log('✓ Tire realism: physical void/contact ratios, flat dark floors, distinct topology, variable pitch, fine winter lamellae, bounded sources and seamless atlases');
