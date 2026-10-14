import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEnv as getBrowserEnv, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { createMaterialDefinition, isLocalMaterialSource, isValidMaterialDefinition, isValidMaterialLayer, type MaterialDefinition, type MaterialLayer, type MaterialTexture } from '../src/materials/types';
import { createMaterialRenderSession, getMaterialSourceCanvas, hasProceduralMaterialRelief, loadMaterialSources, pinMaterialSources, renderMaterialLayer } from '../src/materials/render';
import { MATERIAL_PRESETS } from '../src/materials/presets';

setEnv(getEnv());
const document = getBrowserEnv().document;
function image(width: number, height: number, sample: (x: number, y: number) => number[]): string {
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  const ctx = source.getContext('2d')!, pixels = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.data.set(sample(x, y), (y * width + x) * 4);
  ctx.putImageData(pixels, 0, 0); return source.toDataURL('image/png');
}
const texture = (src: string, component: MaterialTexture['component'] = 'r', invert = false): MaterialTexture => ({ src, name: 'Texture.png', component, invert });
const rectangle = (x: number, y: number, width: number, height: number) => ({ key: 'rectangle', label: 'Rectangle', polygons: [[{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]] });
const layer = (definition: MaterialDefinition): MaterialLayer => ({ definition, family: 'skin', regions: [], exclusions: [] });
const pixel = (source: HTMLCanvasElement, x: number, y: number) => [...source.getContext('2d')!.getImageData(Math.floor(x * source.width), Math.floor(y * source.height), 1, 1).data];
const equalNear = (actual: number[], expected: number[], tolerance = 1) => assert(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `Expected ${actual} to be near ${expected}`);
const dispose = (maps: ReturnType<typeof renderMaterialLayer>) => { for (const canvas of maps.values()) canvas.width = canvas.height = 0; };

const definition = createMaterialDefinition(); definition.color = '#ffffff';
assert(isValidMaterialDefinition(definition));
assert(MATERIAL_PRESETS.every(preset => isValidMaterialDefinition(preset.definition)));
for (const invalid of [{ ...definition, roughness: NaN }, { ...definition, metalness: -1 }, { ...definition, opacity: 2 }, { ...definition, version: 2 }, { ...definition, color: 'url(https://example.com)' }, { ...definition, transform: { ...definition.transform, angle: Infinity } }, { ...definition, textures: { color: texture('https://example.com/image.png') } }]) assert(!isValidMaterialDefinition(invalid));
assert(!isLocalMaterialSource('data:image/svg+xml,<svg onload="alert(1)"/>'));
assert(!isLocalMaterialSource('data:image/png;base64,aW52YWxpZA=='));
assert(!isValidMaterialLayer({ ...layer(definition), regions: [{ ...rectangle(0, 0, 1, 1), polygons: [[{ x: NaN, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]] }] }));
assert(!isValidMaterialLayer({ ...layer(definition), definition: { ...definition, constructor: 'injected' } }));
const asset = { ...definition, textures: { color: texture('assets/texture.png') } };
assert(!isValidMaterialDefinition(asset));
assert(isValidMaterialDefinition(asset, source => source === 'assets/texture.png'), 'Transport may validate local project asset references explicitly');
console.log('ok strict validation rejects nonfinite controls, unsafe image sources and invalid UV masks');

await loadMaterialSources(definition);
let materialLayer = layer(definition); materialLayer.regions = [rectangle(.1, .1, .8, .8)]; materialLayer.exclusions = [rectangle(.4, .4, .2, .2)];
let maps = renderMaterialLayer(materialLayer, 128);
assert.deepEqual(pixel(maps.get('color')!, .2, .2), [255, 255, 255, 255]);
for (const canvas of maps.values()) {
  assert.equal(pixel(canvas, .05, .05)[3], 0, 'Maps remain transparent outside the selected UV region');
  assert.equal(pixel(canvas, .5, .5)[3], 0, 'Exclusions apply to every material channel');
}
assert(!maps.has('emission') && !maps.has('normal') && !maps.has('ao') && !maps.has('height'), 'Unused optional maps are not allocated');
assert.deepEqual(pixel(maps.get('roughmetal')!, .2, .2), [definition.roughness, definition.metalness, 0, 255]);
dispose(maps);
materialLayer = layer(definition);
materialLayer.regions = [{ ...rectangle(.1, .1, .8, .8), fillRule: 'evenodd', polygons: [...rectangle(.1, .1, .8, .8).polygons, ...rectangle(.4, .4, .2, .2).polygons] }];
maps = renderMaterialLayer(materialLayer, 128);
for (const canvas of maps.values()) { assert.equal(pixel(canvas, .2, .2)[3], 255); assert.equal(pixel(canvas, .5, .5)[3], 0, 'Evenodd UV geometry retains its interior holes'); }
dispose(maps);
materialLayer = layer(definition);
maps = renderMaterialLayer(materialLayer, 128); assert.equal(pixel(maps.get('color')!, .05, .05)[3], 255, 'An empty selection means the whole atlas'); dispose(maps);
console.log('ok common region mask, exclusions, full-atlas selection and sparse optional channels');

const colorSource = image(32, 16, x => x < 16 ? [200, 100, 20, 255] : [20, 100, 200, 255]);
const roughSource = image(16, 8, x => x < 8 ? [30, 160, 50, 255] : [220, 80, 150, 255]);
const metalSource = image(64, 32, x => x < 32 ? [60, 70, 120, 255] : [60, 190, 120, 255]);
const rich = createMaterialDefinition(); rich.color = '#ffffff'; rich.transform.mode = 'cover';
rich.roughness = rich.metalness = 255;
rich.textures = { color: texture(colorSource), roughness: texture(roughSource), metalness: texture(metalSource, 'g') };
await loadMaterialSources(rich);
maps = renderMaterialLayer(layer(rich), 128);
assert.deepEqual(pixel(maps.get('color')!, .2, .5), [200, 100, 20, 255]);
assert.deepEqual(pixel(maps.get('roughmetal')!, .2, .5), [30, 70, 0, 255]);
assert.deepEqual(pixel(maps.get('roughmetal')!, .8, .5), [220, 190, 0, 255]);
assert.equal(getMaterialSourceCanvas(colorSource)!.width, 32, 'The original image resolution is preserved');
pinMaterialSources([colorSource]);
const oversizedSet = Array.from({ length: 5 }, (_, index) => {
  const bytes = Buffer.from(colorSource.slice(22), 'base64');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); header.setUint32(16, 4096); header.setUint32(20, 4096);
  bytes[bytes.length - 1] = index;
  return `data:image/png;base64,${bytes.toString('base64')}`;
});
assert.throws(() => pinMaterialSources(oversizedSet), /64 millions/, 'A new over-budget set is rejected before image decoding');
assert.equal(getMaterialSourceCanvas(colorSource)!.width, 32, 'Budget rejection never evicts an existing project source');
pinMaterialSources([]);
dispose(maps);
rich.transform.flipX = true;
maps = renderMaterialLayer(layer(rich), 128);
assert.deepEqual(pixel(maps.get('color')!, .2, .5), [20, 100, 200, 255]);
assert.deepEqual(pixel(maps.get('roughmetal')!, .2, .5), [220, 190, 0, 255]); dispose(maps);
rich.transform.flipX = false; rich.transform.mode = 'repeat'; rich.transform.size = 256;
maps = renderMaterialLayer(layer(rich), 128);
for (const name of ['color', 'roughmetal'] as const) assert.deepEqual(pixel(maps.get(name)!, .02, .51), pixel(maps.get(name)!, .145, .51), 'Repeated maps share the exact same tile width');
dispose(maps);
rich.transform.mode = 'contain';
maps = renderMaterialLayer(layer(rich), 128);
for (const canvas of maps.values()) { assert.equal(pixel(canvas, .5, .1)[3], 0); assert.equal(pixel(canvas, .5, .5)[3], 255); }
dispose(maps);
console.log('ok image placement stays aligned across dimensions, R/G packing, mirror, repeat and contain');

const sessionA = createMaterialRenderSession(), sessionB = createMaterialRenderSession();
const isolated = createMaterialDefinition(); isolated.color = '#ffffff'; isolated.transform.mode = 'cover';
const isolatedSource = image(13, 7, () => [18, 94, 173, 255]); isolated.textures.color = texture(isolatedSource);
pinMaterialSources(oversizedSet.slice(0, 4));
await assert.rejects(loadMaterialSources(isolated), /64 millions/, 'The main project has its own full texture budget');
await Promise.all([sessionA.load(rich), sessionB.load(isolated)]);
assert.equal(getMaterialSourceCanvas(isolatedSource), undefined, 'Preview imports do not enter the current project cache');
const borrowedProjectSource = getMaterialSourceCanvas(colorSource)!;
maps = sessionB.render(layer(isolated), 128);
assert.deepEqual(pixel(maps.get('color')!, .5, .5), [18, 94, 173, 255]); dispose(maps);
maps = sessionA.render(layer(rich), 128);
assert.equal(pixel(maps.get('color')!, .5, .5)[3], 255); dispose(maps);
sessionA.dispose(); sessionA.dispose();
assert.equal(borrowedProjectSource.width, 32, 'Closing a preview never clears borrowed project originals');
maps = renderMaterialLayer(layer(rich), 128);
assert.equal(pixel(maps.get('color')!, .5, .5)[3], 255, 'Main rendering is restored after an isolated render'); dispose(maps);
assert.throws(() => sessionA.render(layer(rich), 128), /fermée/);
await assert.rejects(sessionA.load(rich), /fermée/);
const overBudgetDefinition = { ...isolated, textures: Object.fromEntries(['color', 'roughness', 'metalness', 'normal', 'height'].map((key, index) => [key, texture(oversizedSet[index])])) };
await assert.rejects(sessionB.load(overBudgetDefinition), /64 millions/, 'Isolated sessions preserve the same image budget');
maps = sessionB.render(layer(isolated), 128);
assert.deepEqual(pixel(maps.get('color')!, .5, .5), [18, 94, 173, 255], 'Budget rejection preserves the active preview source'); dispose(maps);
sessionB.dispose(); pinMaterialSources([]);
const replacingSession = createMaterialRenderSession();
await Promise.all([replacingSession.load(rich), replacingSession.load(isolated)]);
maps = replacingSession.render(layer(isolated), 128);
assert.deepEqual(pixel(maps.get('color')!, .5, .5), [18, 94, 173, 255], 'The last of two queued packs is complete and renderable'); dispose(maps);
assert.throws(() => replacingSession.render(layer(rich), 128), /Chargez/, 'A replaced pack is not retained in the bounded preview cache');
const failedReplacement = replacingSession.load(overBudgetDefinition);
const recoveredReplacement = replacingSession.load(rich);
await assert.rejects(failedReplacement, /64 millions/); await recoveredReplacement;
maps = replacingSession.render(layer(rich), 128);
assert.equal(pixel(maps.get('color')!, .5, .5)[3], 255, 'A failed queued import never blocks the next valid pack'); dispose(maps);
replacingSession.dispose();
const closingSession = createMaterialRenderSession();
const pendingDefinition = createMaterialDefinition(); pendingDefinition.textures.color = texture(image(19, 11, () => [7, 24, 59, 255]));
const pendingLoad = closingSession.load(pendingDefinition);
closingSession.dispose();
await assert.rejects(pendingLoad, /fermée/, 'A decode completing after disposal cannot revive the session');
assert.throws(() => closingSession.render(layer(pendingDefinition), 128), /fermée/);
console.log('ok isolated preview sessions preserve project sources, concurrent decoding, budgets and disposal');

const alphaSource = image(8, 8, () => [200, 100, 40, 128]);
const transparent = createMaterialDefinition(); transparent.color = '#ffffff'; transparent.opacity = .5; transparent.textures.color = texture(alphaSource);
transparent.roughness = 128; transparent.textures.roughness = texture(alphaSource);
await loadMaterialSources(transparent);
maps = renderMaterialLayer(layer(transparent), 128);
for (const canvas of maps.values()) equalNear([pixel(canvas, .5, .5)[3]], [64]);
equalNear([pixel(maps.get('roughmetal')!, .5, .5)[0]], [100], 2);
dispose(maps);
const gray = createMaterialDefinition(); gray.textures.coat = texture(roughSource, 'g', true); gray.textures.dirt = texture(roughSource, 'luminance'); gray.transform.mode = 'cover';
gray.coat = gray.dirt = 255;
await loadMaterialSources(gray);
maps = renderMaterialLayer(layer(gray), 128);
assert.deepEqual(pixel(maps.get('coat')!, .2, .5), [95, 95, 95, 255]);
const luminance = Math.round(30 * .2126 + 160 * .7152 + 50 * .0722);
assert.deepEqual(pixel(maps.get('dirt')!, .2, .5), [luminance, luminance, luminance, 255]); dispose(maps);
gray.coat = gray.dirt = 128;
maps = renderMaterialLayer(layer(gray), 128);
assert.deepEqual(pixel(maps.get('coat')!, .2, .5), [48, 48, 48, 255]);
assert.deepEqual(pixel(maps.get('dirt')!, .2, .5), [62, 62, 62, 255]); dispose(maps);
console.log('ok alpha is applied once and shared, scalar maps use numeric channels and luminance without color conversion');

const heightDefinition = createMaterialDefinition(); heightDefinition.color = '#ffffff'; heightDefinition.opacity = .5;
heightDefinition.textures.color = texture(colorSource);
heightDefinition.textures.height = texture(roughSource, 'g');
heightDefinition.transform.mode = 'cover';
await loadMaterialSources(heightDefinition);
const heightLayer = layer(heightDefinition); heightLayer.regions = [rectangle(.1, .1, .8, .8)]; heightLayer.exclusions = [rectangle(.4, .4, .2, .2)];
maps = renderMaterialLayer(heightLayer, 128);
equalNear(pixel(maps.get('height')!, .2, .5), [160, 160, 160, 128]);
assert.equal(pixel(maps.get('height')!, .05, .05)[3], 0, 'The height atlas does not displace outside the material mask');
assert.equal(pixel(maps.get('height')!, .5, .5)[3], 0, 'The height atlas follows the same exclusions as the color map');
assert.equal(pixel(maps.get('color')!, .2, .5)[3], pixel(maps.get('height')!, .2, .5)[3]); dispose(maps);
heightDefinition.transform.flipX = true; heightDefinition.textures.height!.invert = true;
maps = renderMaterialLayer(heightLayer, 128);
equalNear(pixel(maps.get('height')!, .2, .5), [175, 175, 175, 128], 2); dispose(maps);
heightDefinition.transform.flipX = false; heightDefinition.transform.angle = 90; heightDefinition.opacity = 1; heightDefinition.textures.height!.invert = false;
maps = renderMaterialLayer(heightLayer, 128);
assert(pixel(maps.get('height')!, .5, .2)[0] > pixel(maps.get('height')!, .5, .8)[0], 'Rotation turns the same height pattern with its other material images'); dispose(maps);
assert.equal(isValidMaterialDefinition(heightDefinition), true, 'Height is optional and valid in material schema version 1');
console.log('ok height atlas retains numeric components, inversion, transform, UV mask, exclusions and opacity');

const packedSource = image(4, 4, () => [50, 170, 240, 255]);
const normalSource = image(4, 4, () => [200, 170, 240, 255]);
const aoSource = image(4, 4, () => [40, 40, 40, 255]);
const extras = createMaterialDefinition(); extras.color = '#ffffff'; extras.textures = { roughmetal: texture(packedSource), normal: texture(normalSource), ao: texture(aoSource) };
extras.roughness = extras.metalness = 255;
extras.emissionStrength = .5; extras.emissionColor = '#804020'; extras.normalStrength = 0; extras.aoStrength = 0;
await loadMaterialSources(extras);
maps = renderMaterialLayer(layer(extras), 128);
assert.deepEqual(pixel(maps.get('roughmetal')!, .5, .5), [50, 170, 0, 255]);
assert.deepEqual(pixel(maps.get('normal')!, .5, .5), [128, 128, 255, 255]);
assert.deepEqual(pixel(maps.get('ao')!, .5, .5), [255, 255, 255, 255]);
assert.deepEqual(pixel(maps.get('emission')!, .5, .5), [64, 32, 16, 255]); dispose(maps);
extras.textures.roughness = texture(roughSource); extras.transform.mode = 'cover';
await loadMaterialSources(extras);
maps = renderMaterialLayer(layer(extras), 128);
assert.deepEqual(pixel(maps.get('roughmetal')!, .2, .5), [30, 170, 0, 255], 'A roughness texture replaces only R and retains the packed metal G'); dispose(maps);
extras.roughness = extras.metalness = 128;
maps = renderMaterialLayer(layer(extras), 128);
assert.deepEqual(pixel(maps.get('roughmetal')!, .2, .5), [15, 85, 0, 255], 'Scalar roughness and packed metal each receive their own intensity exactly once'); dispose(maps);
extras.roughness = extras.metalness = 0;
maps = renderMaterialLayer(layer(extras), 128);
assert.deepEqual(pixel(maps.get('roughmetal')!, .2, .5), [0, 0, 0, 255]); dispose(maps);
extras.roughness = 128; extras.metalness = 255; extras.textures.roughness!.invert = true;
maps = renderMaterialLayer(layer(extras), 128);
assert.deepEqual(pixel(maps.get('roughmetal')!, .2, .5), [113, 170, 0, 255], 'Component inversion happens before intensity scaling'); dispose(maps);
extras.textures.roughness!.invert = false;
extras.roughness = extras.metalness = 255;
delete extras.textures.roughness; extras.transform.mode = 'repeat';
extras.roughness = extras.metalness = 128;
maps = renderMaterialLayer(layer(extras), 128);
assert.deepEqual(pixel(maps.get('roughmetal')!, .5, .5), [25, 85, 0, 255], 'Packed R/G receives independent intensity factors'); dispose(maps);
extras.roughness = extras.metalness = 255;
extras.normalStrength = 1; extras.aoStrength = 1;
maps = renderMaterialLayer(layer(extras), 128);
const originalNormal = pixel(maps.get('normal')!, .5, .5);
assert(originalNormal[0] > 128 && originalNormal[1] > 128 && originalNormal[2] > 200);
assert.deepEqual(pixel(maps.get('ao')!, .5, .5), [40, 40, 40, 255]); dispose(maps);
extras.transform.flipX = true;
maps = renderMaterialLayer(layer(extras), 128);
equalNear(pixel(maps.get('normal')!, .5, .5), [255 - originalNormal[0], originalNormal[1], originalNormal[2], 255]); dispose(maps);
extras.transform.flipX = false; extras.transform.angle = 90;
maps = renderMaterialLayer(layer(extras), 128);
equalNear(pixel(maps.get('normal')!, .5, .5), [originalNormal[1], 255 - originalNormal[0], originalNormal[2], 255]); dispose(maps);
const conventions = createMaterialDefinition(); conventions.transform.mode = 'cover';
conventions.textures.normal = texture(image(8, 4, x => x < 4 ? [200, 170, 240, 255] : [80, 110, 240, 255]));
await loadMaterialSources(conventions);
maps = renderMaterialLayer(layer(conventions), 128);
const leftNormal = pixel(maps.get('normal')!, .2, .5), rightNormal = pixel(maps.get('normal')!, .8, .5); dispose(maps);
conventions.textures.normal!.invert = true;
maps = renderMaterialLayer(layer(conventions), 128);
equalNear(pixel(maps.get('normal')!, .2, .5), [leftNormal[0], 255 - leftNormal[1], leftNormal[2], 255]);
equalNear(pixel(maps.get('normal')!, .8, .5), [rightNormal[0], 255 - rightNormal[1], rightNormal[2], 255]); dispose(maps);
console.log('ok packed inputs, emission intensity, normal strength, tangent orientation and AO intensity');

for (const preset of MATERIAL_PRESETS) {
  const selected = layer(createMaterialDefinition(preset.id));
  maps = renderMaterialLayer(selected, 128);
  assert.equal(pixel(maps.get('color')!, .5, .5)[3], 255);
  assert.equal(pixel(maps.get('roughmetal')!, .5, .5)[2], 0);
  assert.equal(hasProceduralMaterialRelief(selected.definition), preset.id === 'carbon');
  assert.equal(maps.has('normal'), preset.id === 'carbon', 'Only the carbon preset supplies procedural normals');
  assert.equal(maps.has('height'), preset.id === 'carbon', 'Only the carbon preset supplies procedural height');
  dispose(maps);
}

// Old carbon definitions contain no image sources. Their physical strand
// crowns now drive height and normals, while their painted appearance is exact.
const carbon = createMaterialDefinition('carbon'); carbon.transform.mode = 'cover'; carbon.transform.size = 256;
const carbonBefore = structuredClone(carbon);
const carbonBase = renderMaterialLayer(layer(carbon), 256);
const canvasBytes = (source: HTMLCanvasElement) => source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
const canvasHash = (source: HTMLCanvasElement) => createHash('sha256').update(canvasBytes(source)).digest('hex');
const at = (source: HTMLCanvasElement, x: number, y: number) => pixel(source, x / source.width, y / source.height);
assert.equal(canvasHash(carbonBase.get('color')!), '906e83fde1ecea2e66508d2a62da657fa69508725cea9357f8459500bf8654a7', 'The original carbon colour tile is byte-identical');
assert.equal(canvasHash(carbonBase.get('roughmetal')!), '5064448a333af096e74deadc7538bfbbfcb9aeaabaf4f7020bfce073b52ea30d', 'The original carbon finish tile is byte-identical');
assert.equal(carbon.version, 1); assert.deepEqual(carbon.textures, {}); assert.deepEqual(carbon, carbonBefore, 'Old definitions need neither image assets nor a migration');
assert.deepEqual(at(carbonBase.get('height')!, 0, 4), [48, 48, 48, 255]);
assert.deepEqual(at(carbonBase.get('height')!, 8, 4), [208, 208, 208, 255]);
assert.equal(at(carbonBase.get('height')!, 4, 4)[0], at(carbonBase.get('height')!, 4, 20)[0], 'Alternate vertical/horizontal strands have the same physical crown');
assert(at(carbonBase.get('color')!, 8, 4)[0] > at(carbonBase.get('color')!, 0, 4)[0], 'The geometric crown coincides with the same visible strand');
assert(at(carbonBase.get('roughmetal')!, 8, 4)[0] < at(carbonBase.get('roughmetal')!, 0, 4)[0], 'The crown shares the existing finish pattern');
const verticalStrand = at(carbonBase.get('normal')!, 4, 4), horizontalStrand = at(carbonBase.get('normal')!, 4, 20);
assert(verticalStrand[0] < 100 && Math.abs(verticalStrand[1] - 128) <= 1, 'Rising height along image X tilts a vertical strand toward -X');
assert(Math.abs(horizontalStrand[0] - 128) <= 1 && horizontalStrand[1] > 150, 'Rising image Y tilts a horizontal strand toward OpenGL +Y');
for (const [x, y] of [[4, 4], [12, 4], [4, 20], [4, 28], [0, 4], [255, 4]]) {
  const n = at(carbonBase.get('normal')!, x, y);
  const h = (px: number, py: number) => at(carbonBase.get('height')!, (px + 256) % 256, (py + 256) % 256)[0];
  const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
  if (Math.abs(dx) > 3) assert((n[0] - 127.5) * dx < 0, 'Normal X follows the periodic numeric height gradient, including tile boundaries');
  if (Math.abs(dy) > 3) assert((n[1] - 127.5) * dy > 0, 'Normal Y follows the numeric height gradient');
  assert(Math.abs(Math.hypot(...n.slice(0, 3).map(value => value / 127.5 - 1)) - 1) < .015, 'Generated normals remain unit vectors');
}
carbon.color = '#000000';
maps = renderMaterialLayer(layer(carbon), 256);
assert(canvasBytes(maps.get('color')!).every((value, i) => i % 4 === 3 || value === 0));
for (const channel of ['height', 'normal'] as const) assert.equal(canvasHash(maps.get(channel)!), canvasHash(carbonBase.get(channel)!), 'Relief is independent of colour luminance and tint');
dispose(maps); carbon.color = carbonBefore.color;
carbon.normalStrength = 0;
maps = renderMaterialLayer(layer(carbon), 256);
assert.deepEqual(at(maps.get('normal')!, 4, 4), [128, 128, 255, 255]);
assert.equal(canvasHash(maps.get('height')!), canvasHash(carbonBase.get('height')!), 'Turning off optical relief never changes physical height'); dispose(maps);
carbon.normalStrength = 2;
maps = renderMaterialLayer(layer(carbon), 256);
assert(at(maps.get('normal')!, 4, 4)[0] < verticalStrand[0], 'Normal intensity scales the generated strand slopes'); dispose(maps); carbon.normalStrength = 1;

for (const transform of ['flipX', 'flipY', 'rotate'] as const) {
  carbon.transform.flipX = transform === 'flipX'; carbon.transform.flipY = transform === 'flipY'; carbon.transform.angle = transform === 'rotate' ? 90 : 0;
  maps = renderMaterialLayer(layer(carbon), 256);
  for (const [x, y] of [[4, 4], [12, 20], [85, 118]]) {
    const sx = transform === 'flipX' ? 255 - x : transform === 'rotate' ? y : x;
    const sy = transform === 'flipY' ? 255 - y : transform === 'rotate' ? 255 - x : y;
    for (const channel of ['height', 'color', 'roughmetal'] as const) equalNear(at(maps.get(channel)!, x, y), at(carbonBase.get(channel)!, sx, sy));
    const n = at(carbonBase.get('normal')!, sx, sy);
    const expected = transform === 'flipX' ? [255 - n[0], n[1], n[2], 255]
      : transform === 'flipY' ? [n[0], 255 - n[1], n[2], 255] : [n[1], 255 - n[0], n[2], 255];
    equalNear(at(maps.get('normal')!, x, y), expected, 2);
  }
  dispose(maps);
}
carbon.transform.flipX = carbon.transform.flipY = false; carbon.transform.angle = 0; carbon.transform.mode = 'repeat';
for (const size of [512, 1024]) {
  carbon.transform.size = size; maps = renderMaterialLayer(layer(carbon), 256);
  for (const channel of ['height', 'normal', 'color', 'roughmetal'] as const) equalNear(pixel(maps.get(channel)!, .11, .21), pixel(maps.get(channel)!, .11 + size / 2048, .21));
  dispose(maps);
}
carbon.transform.mode = 'cover'; carbon.transform.size = 256; carbon.opacity = .5;
const maskedCarbon = layer(carbon); maskedCarbon.regions = [rectangle(.1, .1, .8, .8)]; maskedCarbon.exclusions = [rectangle(.4, .4, .2, .2)];
maps = renderMaterialLayer(maskedCarbon, 256);
for (const source of maps.values()) {
  assert.equal(pixel(source, .05, .05)[3], 0); assert.equal(pixel(source, .5, .5)[3], 0);
  assert.equal(pixel(source, .2, .2)[3], 128, 'Procedural relief shares UV masks, exclusions and a single opacity application');
}
dispose(maps); carbon.opacity = 1;

const explicitCarbon = structuredClone(carbon);
explicitCarbon.textures.height = texture(image(4, 4, () => [91, 91, 91, 255]));
explicitCarbon.textures.normal = texture(normalSource);
await loadMaterialSources(explicitCarbon);
maps = renderMaterialLayer(layer(explicitCarbon), 256);
assert.deepEqual(at(maps.get('height')!, 4, 4), [91, 91, 91, 255]);
assert.deepEqual(at(maps.get('height')!, 8, 4), [91, 91, 91, 255], 'Explicit height replaces the procedural strand profile');
equalNear(at(maps.get('normal')!, 4, 4), [193, 166, 230, 255], 2);
assert.deepEqual(at(maps.get('normal')!, 4, 4), at(maps.get('normal')!, 8, 4), 'An explicit normal overrides rather than blends with the procedural slopes'); dispose(maps);
delete explicitCarbon.textures.height;
maps = renderMaterialLayer(layer(explicitCarbon), 256);
assert.equal(canvasHash(maps.get('height')!), canvasHash(carbonBase.get('height')!), 'Normal and height overrides are independent'); dispose(maps);
const carbonSession = createMaterialRenderSession(); await carbonSession.load(carbon);
maps = carbonSession.render(layer(carbon), 256);
for (const channel of ['height', 'normal', 'color', 'roughmetal'] as const) assert.equal(canvasHash(maps.get(channel)!), canvasHash(carbonBase.get(channel)!), 'Session and project rendering generate identical deterministic weave maps');
dispose(maps); carbonSession.dispose(); dispose(carbonBase);
console.log('ok carbon numeric strand height, unit OpenGL normals, unchanged colour/finish, deterministic sessions, rotation/scale/flips, masks, opacity and explicit source precedence');

function reducedVariation(source: HTMLCanvasElement) {
  const reduced = document.createElement('canvas'); reduced.width = reduced.height = 128;
  const ctx = reduced.getContext('2d')!; ctx.drawImage(source, 0, 0, 128, 128);
  const pixels = ctx.getImageData(0, 0, 128, 128).data;
  let sum = 0, squareSum = 0, min = 255, max = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const value = pixels[index]; sum += value; squareSum += value * value;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  const count = pixels.length / 4;
  reduced.width = reduced.height = 0;
  return { range: max - min, deviation: Math.sqrt(squareSum / count - (sum / count) ** 2) };
}

// A distant car minifies the atlas: testing only the native pixels misses motifs
// that turn into a flat color under texture filtering.
for (const preset of ['carbon', 'fabric', 'rubber'] as const) {
  const selected = createMaterialDefinition(preset);
  assert.equal(selected.transform.size, preset === 'rubber' ? 256 : 768);
  maps = renderMaterialLayer(layer(selected), 1024);
  const color = reducedVariation(maps.get('color')!);
  const roughness = reducedVariation(maps.get('roughmetal')!);
  assert(color.range >= (preset === 'rubber' ? 4 : 8) && color.deviation >= (preset === 'rubber' ? .8 : 2), `${preset} keeps visible color variation after atlas reduction: ${JSON.stringify(color)}`);
  assert(roughness.range >= 4 && roughness.deviation >= .6, `${preset} keeps nonuniform roughness after atlas reduction: ${JSON.stringify(roughness)}`);
  dispose(maps);
}
const existingCarbon = createMaterialDefinition('carbon'); existingCarbon.transform.size = 256;
maps = renderMaterialLayer(layer(existingCarbon), 128);
assert.equal(existingCarbon.transform.size, 256, 'Rendering keeps the placement of an existing material unchanged');
dispose(maps);
assert.equal(createMaterialDefinition().transform.size, 256, 'Image imports retain their original solid-material placement default');
console.log('ok built-in motifs retain visible color and roughness after distant-view filtering without changing saved placement');
assert.throws(() => renderMaterialLayer(layer(definition), 4097));
await assert.rejects(loadMaterialSources({ ...definition, textures: { color: texture('https://example.com/remote.png') } }));
console.log('Tous les tests du moteur de matériaux passent.');
