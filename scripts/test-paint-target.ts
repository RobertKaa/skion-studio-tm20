import assert from 'node:assert/strict';
import { resolvePaintMap } from '../src/maps';

assert.equal(resolvePaintMap('Skin_R', 'wheels'), 'Wheels_R');
assert.equal(resolvePaintMap('Wheels_R', 'details'), 'Details_R');
assert.equal(resolvePaintMap('Details_R', 'skin'), 'Skin_R');
assert.equal(resolvePaintMap('Skin_B', 'wheels'), 'Wheels_B');
assert.equal(resolvePaintMap('Skin_CoatR', 'skin'), 'Skin_CoatR');
assert.equal(resolvePaintMap('Skin_DirtMask', 'skin'), 'Skin_DirtMask');
assert.equal(resolvePaintMap('Skin_CoatR', 'wheels'), null);
assert.equal(resolvePaintMap('Details_I', 'skin'), 'Skin_I');
assert.equal(resolvePaintMap('Skin_I', 'wheels'), 'Wheels_I');
assert.equal(resolvePaintMap('Wheels_I', 'details'), 'Details_I');
console.log('ok peinture 3D : le canal est conservé entre familles et les canaux absents sont refusés');
