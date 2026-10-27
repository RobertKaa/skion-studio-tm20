import assert from 'node:assert/strict';
import { getEnv } from 'fabric/node';
import { DEFAULT_WHEEL_DESIGN, drawWheelDesign, isSafeWheelLogo, isValidWheelDesign, normalizeWheelDesign, type WheelDesignSettings } from '../src/wheelDesign';
import {
  createWheelArtworkDefinition, createWheelElement, drawWheelComposition, isValidWheelArtwork,
  loadWheelCompositionImages, MAX_WHEEL_ELEMENTS, mergeWheelArtworkDefinition, normalizeWheelComposition, WHEEL_COMPOSITION_STYLES,
  type WheelDesignComposition,
} from '../src/wheelDesignComposition';
import { isValidMaterialDefinition } from '../src/materials/types';

const env = getEnv();
Object.assign(globalThis, { document: env.document, window: env.window, HTMLElement: env.window.HTMLElement,
  HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement });
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
const context = canvas.getContext('2d')!;
const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
const alpha = (x: number, y: number) => pixel(x, y)[3];
const snapshot = () => canvas.toDataURL('image/png');
const element = (settings: Partial<WheelDesignSettings>, name = 'Élément') => ({ ...createWheelElement(settings.pattern ?? 'ring'), name,
  design: { ...DEFAULT_WHEEL_DESIGN, radius: .8, width: .08, ...settings } });
const composition = (...elements: WheelDesignComposition['elements']): WheelDesignComposition => ({ version: 2, elements });

assert(isValidWheelArtwork(DEFAULT_WHEEL_DESIGN), 'Original projects need no migration to remain valid');
const original = { ...DEFAULT_WHEEL_DESIGN, pattern: 'lettering' as const, text: 'ORIGINAL', angle: 17.3 };
const migrated = normalizeWheelComposition(original);
assert.equal(migrated.version, 2); assert.equal(migrated.elements.length, 1);
assert.deepEqual(migrated.elements[0].design, original);
migrated.elements[0].design.text = 'CHANGED'; assert.equal(original.text, 'ORIGINAL');
assert.deepEqual(normalizeWheelComposition(undefined).elements[0].design, DEFAULT_WHEEL_DESIGN);
assert.deepEqual(normalizeWheelComposition({ version: 2, elements: [] }).elements[0].design, DEFAULT_WHEEL_DESIGN);

const red = element({ color: '#e62814' }), blue = element({ color: '#1450dc' });
const layered = composition(red, blue), before = structuredClone(layered);
drawWheelComposition(context, layered);
assert.deepEqual(pixel(256, 51), [20, 80, 220, 255], 'Later elements cover earlier ones with their exact chosen pigment');
drawWheelComposition(context, composition(blue, red));
assert.deepEqual(pixel(256, 51), [230, 40, 20, 255], 'Reordering changes only the composition order');
drawWheelComposition(context, composition(red, { ...blue, visible: false }));
assert.deepEqual(pixel(256, 51), [230, 40, 20, 255], 'Hidden elements do not paint source pixels');
drawWheelComposition(context, composition({ ...blue, locked: true, opacity: .5 }));
assert(pixel(256, 51).slice(0, 3).every((channel, i) => Math.abs(channel - [20, 80, 220][i]) <= 1), 'Opacity retains pigment within one premultiplied-alpha rounding unit');
assert(Math.abs(alpha(256, 51) - 128) <= 1);
assert.equal(alpha(256, 256), 0); assert.equal(alpha(0, 0), 0);
assert.deepEqual(layered, before, 'Rendering does not mutate settings, order, names, visibility or locks');
const luminous = composition({ ...red, emission: .5 }, { ...blue, design: { ...blue.design, radius: .68 }, emission: 0 });
drawWheelComposition(context, luminous, new Map(), 'emission');
assert(pixel(256, 51).slice(0, 3).every((value, index) => Math.abs(value - [115, 20, 10][index]) <= 1), 'Only the luminous element emits its own colour at its selected intensity');
assert.deepEqual(pixel(256, 82), [0, 0, 0, 255], 'A non-luminous element is black on the emission texture');
drawWheelComposition(context, composition({ ...red, emission: 1 }, { ...blue, emission: 0 }), new Map(), 'emission');
assert.deepEqual(pixel(256, 51), [0, 0, 0, 255], 'An opaque non-luminous element hides the emission beneath it');
drawWheelComposition(context, composition({ ...red, emission: 1 }, { ...blue, emission: 0, opacity: .5 }), new Map(), 'emission');
assert(pixel(256, 51)[0] >= 114 && pixel(256, 51)[0] <= 116, 'A translucent element partially covers underlying emission');
assert.equal(normalizeWheelComposition(luminous).elements[0].emission, .5, 'Per-element light survives editing');
const litDefinition = await createWheelArtworkDefinition(luminous);
assert(isValidMaterialDefinition(litDefinition)); assert(litDefinition.textures.emission); assert.equal(litDefinition.emissionStrength, 1);
const savedDefinition = JSON.parse(JSON.stringify(litDefinition));
assert(isValidMaterialDefinition(savedDefinition)); assert.equal(savedDefinition.wheelDesign.elements[0].emission, .5, 'Project serialization preserves per-element light');
const legacyDefinition = await createWheelArtworkDefinition(layered);
assert(!legacyDefinition.textures.emission, 'Older compositions keep their existing global material settings');
const merged = mergeWheelArtworkDefinition({ ...legacyDefinition, emissionStrength: .2, emissionColor: '#aabbcc' }, litDefinition);
assert.equal(merged.emissionStrength, 1); assert.equal(merged.emissionColor, '#ffffff'); assert.equal(merged.textures.emission?.src, litDefinition.textures.emission?.src);
assert.equal(mergeWheelArtworkDefinition({ ...legacyDefinition, emissionStrength: .2 }, legacyDefinition).emissionStrength, .2);
const resetLight = mergeWheelArtworkDefinition(litDefinition, legacyDefinition);
assert.equal(resetLight.emissionStrength, 0); assert(!resetLight.textures.emission && !resetLight.textures.wheelEmissionRole, 'Replacing a lit composition with an unlit style removes stale light and roles');
assert(!isValidWheelArtwork(composition({ ...red, emission: Infinity })) && !isValidWheelArtwork(composition({ ...red, emission: -1 })) && !isValidWheelArtwork(composition({ ...red, emission: 1.1 })), 'Untrusted intensities are bounded');
assert(!isValidWheelArtwork(composition({ ...red, emissionRole: 'head' as 'always' })), 'Only supported per-element activation modes are accepted');
const copied = normalizeWheelComposition(layered); copied.elements[0].design.color = '#ffffff';
assert.equal(layered.elements[0].design.color, '#e62814', 'Draft elements never share nested settings with their source');

drawWheelDesign(context, { ...DEFAULT_WHEEL_DESIGN, radius: .8, width: .06, sweep: 90 });
assert(alpha(256, 51) > 250); assert.equal(alpha(51, 256), 0); assert.equal(alpha(256, 461), 0);
const checker = { ...DEFAULT_WHEEL_DESIGN, pattern: 'checker' as const, count: 24, radius: .8, width: .12 };
const checkerPoint = (fraction: number) => {
  const angle = fraction * Math.PI / checker.count - Math.PI / 2, radius = (checker.radius + checker.width / 4) * 256;
  return [Math.round(256 + Math.cos(angle) * radius), Math.round(256 + Math.sin(angle) * radius)] as const;
};
drawWheelDesign(context, checker);
assert(alpha(...checkerPoint(.1)) > 240, 'Legacy checker cells retain their complete angular coverage');
drawWheelDesign(context, { ...checker, gap: .5 });
assert(alpha(...checkerPoint(.1)) < 16 && alpha(...checkerPoint(.5)) > 240, 'The filled fraction visibly opens space around each checker cell');
assert(isValidWheelDesign({ ...checker, gap: 1 }), 'A full cell remains an explicit precise control value');
const signatures = new Set<string>();
const text = { ...DEFAULT_WHEEL_DESIGN, pattern: 'lettering' as const, text: 'CUSTOM SIGNATURE 07', radius: .82, width: .11, arc: 155 };
for (const options of [{}, { font: 'mono' as const }, { font: 'serif' as const }, { font: 'condensed' as const },
  { italic: true }, { outline: .012, outlineColor: '#e64022' }, { tracking: .24 }, { reverse: true }, { repetitions: 2 }]) {
  drawWheelDesign(context, { ...text, ...options }); signatures.add(snapshot());
}
assert.equal(signatures.size, 9, 'Font, italic, outline, tracking, direction and repetition visibly change the same inscription');
assert(isValidWheelDesign({ ...DEFAULT_WHEEL_DESIGN, text: 'A'.repeat(64) }));
assert(!isValidWheelDesign({ ...DEFAULT_WHEEL_DESIGN, text: 'A'.repeat(65) }));
assert(!isValidWheelDesign({ ...DEFAULT_WHEEL_DESIGN, font: { toString: () => { throw new Error('Untrusted coercion'); } } }));
assert.equal(normalizeWheelDesign({ ...DEFAULT_WHEEL_DESIGN, font: { toString: () => { throw new Error('Untrusted coercion'); } } }).font, undefined);

const logo = document.createElement('canvas'); logo.width = 64; logo.height = 32;
const logoContext = logo.getContext('2d')!;
logoContext.fillStyle = '#f02030'; logoContext.fillRect(0, 0, 32, 16);
logoContext.fillStyle = '#20d040'; logoContext.fillRect(32, 0, 32, 16);
const logoData = logo.toDataURL('image/png'), logoBefore = logoData;
assert(isSafeWheelLogo(logoData));
const imageElement = element({ pattern: 'image', imageData: logoData, width: .12, repetitions: 1 });
const logos = composition(imageElement);
const images = await loadWheelCompositionImages(logos);
const movedImages = await loadWheelCompositionImages(composition({ ...imageElement, design: { ...imageElement.design, angle: 15 } }));
assert.equal(images.get(imageElement.id), movedImages.get(imageElement.id), 'Moving a logo reuses its decoded image');
drawWheelComposition(context, logos, images);
assert.deepEqual(pixel(245, 43), [240, 32, 48, 255], 'Imported red pigment is not tinted with the element colour');
assert.deepEqual(pixel(268, 43), [32, 208, 64, 255], 'Imported second pigment and image proportions survive');
assert.equal(alpha(256, 60), 0, 'Original transparent pixels remain transparent');
assert.equal(alpha(256, 256), 0, 'Even a custom logo keeps the central wheel opening clear');
assert.equal(logo.toDataURL('image/png'), logoBefore, 'Decoding and rendering never resize or repaint the original logo');
const imageDefinition = await createWheelArtworkDefinition(logos);
assert(isValidMaterialDefinition(imageDefinition)); assert.deepEqual(imageDefinition.wheelDesign, logos);
assert.notEqual(imageDefinition.wheelDesign, logos);
assert.equal(imageDefinition.transform.projection, 'wheel-face'); assert.equal(imageDefinition.color, '#ffffff');
assert.equal(imageDefinition.roughness, 180); assert.equal(imageDefinition.metalness, 0);
const png = Buffer.from(imageDefinition.textures.color!.src.slice(22), 'base64');
assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 1024);
const legacyLogo = await createWheelArtworkDefinition(imageElement.design);
assert.deepEqual(legacyLogo.wheelDesign, imageElement.design, 'An extended legacy logo has correct pixels without silently replacing its metadata');
assert.equal(legacyLogo.textures.color!.src, imageDefinition.textures.color!.src);

for (const bad of ['https://example.com/logo.png', 'blob:unsafe', 'data:image/svg+xml;base64,PHN2Zz4=',
  'data:text/html;base64,PHNjcmlwdD4=', logoData + 'A', 'data:image/png;base64,' + 'A'.repeat(400_000)]) assert(!isSafeWheelLogo(bad));
const largeHeader = Buffer.from(logoData.slice(22), 'base64'); largeHeader.writeUInt32BE(513, 16);
assert(!isSafeWheelLogo(`data:image/png;base64,${largeHeader.toString('base64')}`), 'Oversized PNG headers are rejected before decoding');
const originalPNG = Buffer.from(logoData.slice(22), 'base64'), animationChunk = Buffer.alloc(20);
animationChunk.writeUInt32BE(8, 0); animationChunk.write('acTL', 4); animationChunk.writeUInt32BE(2000, 8);
assert(!isSafeWheelLogo(`data:image/png;base64,${Buffer.concat([originalPNG.subarray(0, 33), animationChunk, originalPNG.subarray(33)]).toString('base64')}`), 'Animation frames cannot evade the decoded-pixel budget');
assert(!isSafeWheelLogo(`data:image/png;base64,${originalPNG.subarray(0, originalPNG.length - 12).toString('base64')}`), 'Truncated PNG chunks cannot enter persisted logo metadata');
const noise = document.createElement('canvas'); noise.width = noise.height = 256;
const noiseContext = noise.getContext('2d')!, noisePixels = noiseContext.createImageData(256, 256);
let seed = 218173;
for (let i = 0; i < noisePixels.data.length; i++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  noisePixels.data[i] = i % 4 === 3 ? 255 : seed & 255;
}
noiseContext.putImageData(noisePixels, 0, 0);
const noisyLogo = noise.toDataURL('image/png');
assert(isSafeWheelLogo(noisyLogo) && noisyLogo.length > 200_000);
assert(!isValidWheelArtwork(composition(...Array.from({ length: 4 }, () => element({ pattern: 'image', imageData: noisyLogo })))), 'The complete composition has a logo-byte budget in addition to each PNG budget');
noise.width = noise.height = 1;
for (const bad of [null, [], { version: 3, elements: [red] }, { version: 2, elements: [] },
  composition({ ...red, id: '../source' }), composition({ ...red, name: 'A\u202eB' }),
  composition({ ...red, opacity: Infinity }), composition({ ...red, locked: 'yes' as unknown as boolean }),
  composition(red, { ...blue, id: red.id }), { ...layered, unsafe: true },
  composition({ ...red, design: { ...red.design, imageData: 'https://example.com/logo.png' } }),
  composition(...Array.from({ length: MAX_WHEEL_ELEMENTS + 1 }, () => createWheelElement('ring'))),
  composition(...Array.from({ length: 6 }, () => element({ pattern: 'lettering', text: 'A'.repeat(64), repetitions: 24 }))),
]) assert(!isValidWheelArtwork(bad), 'Malformed composition data cannot reach the renderer or a persisted material');
await assert.rejects(() => createWheelArtworkDefinition(composition({ ...red, visible: false })), /visible/);
await assert.rejects(() => createWheelArtworkDefinition(composition(element({ pattern: 'image' }))), /Importez un logo/);

const styles = new Set<string>();
for (const preset of WHEEL_COMPOSITION_STYLES) {
  assert(isValidWheelArtwork(preset.composition), preset.label);
  assert(preset.composition.elements.length >= 3 && preset.composition.elements.length <= 7);
  const before = JSON.stringify(preset.composition); drawWheelComposition(context, preset.composition); styles.add(snapshot());
  assert.equal(JSON.stringify(preset.composition), before); assert.equal(alpha(256, 256), 0); assert.equal(alpha(0, 0), 0);
}
assert.equal(styles.size, 6, 'Six ready-made identities remain different editable compositions');
assert.deepEqual(layered, before);
canvas.width = canvas.height = logo.width = logo.height = 1;
console.log('✓ Compositions flancs : anciens motifs, ordre/alpha/visibilité, typographie, arcs, logos PNG exacts, cache, styles et données hostiles bornées');
