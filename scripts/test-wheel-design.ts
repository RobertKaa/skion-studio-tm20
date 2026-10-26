import assert from 'node:assert/strict';
import { getEnv } from 'fabric/node';
import { createMaterialDefinition, isLocalMaterialSource, isValidMaterialDefinition, isValidMaterialLayer } from '../src/materials/types';
import { exportMaterialPack, importMaterialFilesDetailed } from '../src/materials/import';
import {
  createWheelDesignDefinition, DEFAULT_WHEEL_DESIGN, drawWheelDesign, isValidWheelDesign,
  normalizeWheelDesign, WHEEL_DESIGN_PRESETS,
} from '../src/wheelDesign';

const env = getEnv();
Object.assign(globalThis, {
  document: env.document, window: env.window, HTMLElement: env.window.HTMLElement,
  HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement,
});

assert(isValidWheelDesign(DEFAULT_WHEEL_DESIGN));
assert.deepEqual(normalizeWheelDesign(undefined), DEFAULT_WHEEL_DESIGN);
assert.deepEqual(normalizeWheelDesign([]), DEFAULT_WHEEL_DESIGN);
assert.notEqual(normalizeWheelDesign(undefined), DEFAULT_WHEEL_DESIGN, 'UI drafts cannot mutate the frozen defaults');
for (const invalid of [null, [], 7, 'ring', { ...DEFAULT_WHEEL_DESIGN, source: 'https://example.com/a.png' },
  { ...DEFAULT_WHEEL_DESIGN, count: 12.5 }, { ...DEFAULT_WHEEL_DESIGN, width: NaN },
  { ...DEFAULT_WHEEL_DESIGN, radius: .98, width: .16 },
  { ...DEFAULT_WHEEL_DESIGN, radius: Infinity }, { ...DEFAULT_WHEEL_DESIGN, color: 'url(https://example.com)' },
  { ...DEFAULT_WHEEL_DESIGN, text: 'a\nB' }, { ...DEFAULT_WHEEL_DESIGN, text: '\u007f' },
  { ...DEFAULT_WHEEL_DESIGN, text: '\u202ereversed' }, { ...DEFAULT_WHEEL_DESIGN, text: ' ' },
  { ...DEFAULT_WHEEL_DESIGN, text: 'A'.repeat(29) }, { ...DEFAULT_WHEEL_DESIGN, pattern: '__proto__' },
  Object.assign(Object.create({ executable: true }), DEFAULT_WHEEL_DESIGN),
]) assert(!isValidWheelDesign(invalid), 'Unsafe or malformed settings must fail strict project validation');

const normalized = normalizeWheelDesign({ count: 10.7, radius: 4, width: -3, angle: -500, arc: 900, text: 'X\0Y', color: '#123456' });
assert.deepEqual(normalized, { ...DEFAULT_WHEEL_DESIGN, count: 11, radius: .98, width: .005, angle: -180, arc: 300, color: '#123456' });
assert(isValidWheelDesign(normalized));
assert(isValidWheelDesign({ ...DEFAULT_WHEEL_DESIGN, radius: .6, width: .005, count: 8, angle: -180, arc: 60 }));
assert(isValidWheelDesign({ ...DEFAULT_WHEEL_DESIGN, radius: .92, width: .16, count: 96, angle: 180, arc: 300 }));
assert.equal(normalizeWheelDesign({ ...DEFAULT_WHEEL_DESIGN, radius: .98, width: .16 }).radius, .92, 'UI normalization returns the actual fitting radius explicitly');

const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
const ctx = canvas.getContext('2d')!;
const alphaAt = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
const covered = () => {
  const data = ctx.getImageData(0, 0, 512, 512).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 127) count++;
  return count;
};
const signatures = new Set<string>();
for (const preset of WHEEL_DESIGN_PRESETS) {
  const settings = { ...DEFAULT_WHEEL_DESIGN, pattern: preset.id, color: '#e85a28' };
  const before = JSON.stringify(settings);
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 512, 512);
  drawWheelDesign(ctx, settings);
  assert.equal(JSON.stringify(settings), before, 'Drawing never changes the editable settings');
  assert.equal(alphaAt(256, 256), 0, `${preset.id} preserves the wheel centre`);
  assert.equal(alphaAt(0, 0), 0, `${preset.id} clears the background`);
  assert(covered() > 80, `${preset.id} produces visible source pixels`);
  assert(covered() < 512 * 512 * .3, `${preset.id} cannot cover the complete tyre`);
  signatures.add(canvas.toDataURL());
  const pixels = ctx.getImageData(0, 0, 512, 512).data;
  const sample = Array.from({ length: pixels.length / 4 }, (_, i) => i * 4).find(i => pixels[i + 3] === 255)!;
  assert.deepEqual(Array.from(pixels.slice(sample, sample + 3)), [232, 90, 40], 'The motif uses the exact chosen pigment');
  const material = createWheelDesignDefinition(settings);
  assert(isValidMaterialDefinition(material), `${preset.id} becomes a valid editable material`);
  assert(isLocalMaterialSource(material.textures.color!.src), 'Only an embedded PNG is generated');
  assert.equal(material.transform.projection, 'wheel-face');
  assert.equal(material.transform.mode, 'contain');
  assert.equal(material.transform.size, 256);
  assert.equal(material.color, '#ffffff', 'The source pigment is not tinted twice');
  assert.deepEqual(material.wheelDesign, settings);
  assert.notEqual(material.wheelDesign, settings, 'The stored metadata owns its copy');
  const png = Buffer.from(material.textures.color!.src.slice(22), 'base64');
  assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 1024);
  const reopened = JSON.parse(JSON.stringify(material));
  assert(isValidMaterialDefinition(reopened), 'Pattern controls survive a project metadata round trip');
  assert(isValidMaterialLayer({ definition: reopened, family: 'wheels', regions: [], exclusions: [] }));
  assert(!isValidMaterialLayer({ definition: reopened, family: 'skin', regions: [], exclusions: [] }), 'A tyre pattern cannot enter a body layer');
}
assert.equal(signatures.size, WHEEL_DESIGN_PRESETS.length, 'Every preset has a different drawing');

drawWheelDesign(ctx, { ...DEFAULT_WHEEL_DESIGN, pattern: 'ring', radius: .8, width: .06 });
assert(alphaAt(256, 51) > 250, 'A known radius lands at the requested source position');
assert.equal(alphaAt(256, 80), 0, 'The radial width remains bounded');
drawWheelDesign(ctx, { ...DEFAULT_WHEEL_DESIGN, pattern: 'double-ring', radius: .8, width: .1 });
assert.equal(alphaAt(256, 51), 0, 'Double rings have a real transparent separation');
assert(alphaAt(256, 43) > 240 && alphaAt(256, 59) > 240, 'Double rings sit on both sides of the specified radius');
const checker = { ...DEFAULT_WHEEL_DESIGN, pattern: 'checker' as const, count: 47 };
drawWheelDesign(ctx, checker);
const checkerRadius = (checker.radius + checker.width / 4) * 256;
let paintedCells = 0;
for (let cell = 0; cell < checker.count * 2; cell++) {
  const angle = (cell + .5) * Math.PI / checker.count - Math.PI / 2;
  const x = Math.round(256 + Math.cos(angle) * checkerRadius), y = Math.round(256 + Math.sin(angle) * checkerRadius);
  const alpha = alphaAt(x, y);
  if (cell % 2 === 0) {
    assert(alpha > 240, `Checker repetition ${cell / 2 + 1} starts with its exact outer cell`); paintedCells++;
  } else assert(alpha < 16, `Checker repetition ${(cell + 1) / 2} ends with its exact transparent outer cell`);
}
assert.equal(paintedCells, 47, 'An odd count renders exactly 47 repeated pairs, including the closure at one full turn');
drawWheelDesign(ctx, { ...DEFAULT_WHEEL_DESIGN, pattern: 'lettering', text: 'I', arc: 60 });
assert(covered() > 10);
const textPixels = ctx.getImageData(0, 0, 512, 512).data;
let weightedX = 0, weight = 0;
for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
  const alpha = textPixels[(y * 512 + x) * 4 + 3]; weightedX += x * alpha; weight += alpha;
}
assert(Math.abs(weightedX / weight - 256) < 3, 'A one-character inscription stays centred in its arc');

for (const preset of WHEEL_DESIGN_PRESETS) {
  drawWheelDesign(ctx, { ...DEFAULT_WHEEL_DESIGN, pattern: preset.id, radius: .92, width: .16, count: 96 });
  assert.equal(alphaAt(256, 256), 0, 'The widest fitting motifs preserve the unpainted centre');
}
drawWheelDesign(ctx, { ...DEFAULT_WHEEL_DESIGN, pattern: 'ring', radius: .98, width: .04 });
assert(alphaAt(256, 5) > 250, 'At the largest fitting radius the drawing uses exactly 98% of the wheel radius');
assert.equal(alphaAt(256, 12), 0, 'The largest fitting ring is never silently moved inward');
const broken = { ...DEFAULT_WHEEL_DESIGN, count: Infinity };
assert.throws(() => drawWheelDesign(ctx, broken), /invalides/);
assert.throws(() => createWheelDesignDefinition(broken), /invalides/);
assert(!isValidMaterialDefinition({ ...createMaterialDefinition(), wheelDesign: broken }));
assert(isValidMaterialDefinition(createMaterialDefinition()), 'Materials without motif metadata retain compatibility');
assert(!isValidMaterialDefinition({ ...createWheelDesignDefinition({ ...DEFAULT_WHEEL_DESIGN }), wheelDesign: { ...DEFAULT_WHEEL_DESIGN, unsafe: true } }));
const portable = createWheelDesignDefinition({ ...DEFAULT_WHEEL_DESIGN, pattern: 'lettering', text: 'STUDIO 01' });
const pack = await exportMaterialPack(portable);
const imported = await importMaterialFilesDetailed([new File([await pack.arrayBuffer()], 'Flanc.zip', { type: 'application/zip' })]);
assert.deepEqual(imported.definition.wheelDesign, portable.wheelDesign, 'An actual exported material pack preserves the construction settings');
assert.equal(imported.definition.textures.color!.src, portable.textures.color!.src, 'The pack round trip keeps the original PNG bytes');
assert.equal(imported.definition.transform.projection, 'wheel-face');
canvas.width = canvas.height = 1;
console.log('✓ Wheel sidewall motifs: strict metadata, bounded transparent geometry, distinct presets, circular lettering, PNG1024 and material round trips');
