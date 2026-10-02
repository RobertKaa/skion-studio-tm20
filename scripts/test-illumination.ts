import assert from 'node:assert/strict';
import { decodeIllumCodes, encodeIllumCodes, importLightPixels, imageLightBitmap, lightIsOn, roleAlpha, roleFromAlpha, validIllumCodes } from '../src/illumination';
import { applyIllumRole } from '../src/skinZip';

for (const role of ['always', 'head', 'brake'] as const) {
  assert.equal(roleFromAlpha(roleAlpha(role)), role);
  for (const night of [false, true]) for (const braking of [false, true]) {
    assert.equal(lightIsOn(role, night, braking), role === 'always' || (role === 'head' ? night : braking));
    assert.equal(lightIsOn(role, night, braking, true), true);
  }
}
const image = { width: 3, height: 1, data: new Uint8ClampedArray([0, 200, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255]) };
const roles = { width: 3, height: 1, data: new Uint8ClampedArray([103, 0, 0, 255, 3, 0, 0, 255, 255, 0, 0, 255]) };
const encoded = applyIllumRole(image, 'always', undefined, '#ffffff', roles);
assert.equal(encoded.data[3], 103);
assert.equal(encoded.data[7], 3);
assert.equal(encoded.data[11], 255);
assert.equal(encoded.data[1], 200);
const original = { width: 3, height: 1, data: new Uint8ClampedArray([255, 120, 40, 255, 80, 240, 160, 128, 20, 30, 40, 0]) };
const copy = new Uint8ClampedArray(original.data);
assert.deepEqual(imageLightBitmap(original, .5), new Uint8ClampedArray([128, 60, 20, 255, 40, 120, 80, 128, 10, 15, 20, 0]));
assert.deepEqual(original.data, copy, 'L’original et sa matière ne sont pas modifiés');
assert.deepEqual(imageLightBitmap(original, 2), copy, 'L’intensité exportable reste bornée à 100 %');
for (const strength of [-1, NaN, 0]) {
  const dark = imageLightBitmap(original, strength);
  assert.equal(dark[0], 0); assert.equal(dark[3], 255); assert.equal(dark[7], 128); assert.equal(dark[11], 0);
}
console.log('Illumination : rôles individuels, simulations indépendantes et encodage validés.');

const raw = { width: 2, height: 2, data: new Uint8ClampedArray([255, 100, 50, 0, 180, 220, 60, 3, 100, 110, 120, 97, 10, 20, 30, 255]) };
const imported = importLightPixels(raw, 2);
assert.deepEqual(imported.codes, new Uint8Array([0, 3, 97, 255]));
assert.equal(imported.pixels.data[0], 255, 'L’alpha zéro ne détruit pas la couleur d’un feu de frein');
assert.equal(imported.pixels.data[3], 255, 'Le motif reste opaque et éditable');
assert.deepEqual(decodeIllumCodes(encodeIllumCodes(2, 2, imported.codes)), imported.codes, 'Les codes originaux restent exacts');
assert.deepEqual(encodeIllumCodes(2, 2, new Uint8Array([3, 3, 3, 3])).runs, [4, 3]);
for (const invalid of [{ width: 2, height: 2, runs: [5, 3] }, { width: 2, height: 2, runs: [4, 256] }, { width: 2, height: 2, runs: [3, 3] }, { width: 2000, height: 2000, runs: [4000000, 3] }]) assert.equal(validIllumCodes(invalid), false);
