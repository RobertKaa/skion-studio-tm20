import assert from 'node:assert/strict';
import { continuousImageUV, imageIslandAt, imageIslandClearance } from '../src/editor/imagePlacement';

assert.equal(imageIslandAt('skin', .5, .5), 'top', 'Le centre UV du capot est identifié');
assert.equal(imageIslandAt('skin', .5, 1 - .74), 'top', 'Les coordonnées Three.js sont retournées verticalement');
assert.equal(imageIslandAt('skin', -1, 2), undefined, 'Hors atlas : aucun masque de pièce');
assert.equal(imageIslandAt('wheels', -1, 2), undefined, 'Hors atlas des roues : aucun masque');
assert.equal(imageIslandAt('skin', 754 / 1024, 1 - 307 / 1024), 'shoulderL', 'Le point de pose testé appartient à l’épaule');
assert.notEqual(imageIslandAt('skin', 696 / 1024, 1 - 261 / 1024), 'shoulderL', 'Le centre qui ferait disparaître le logo sort de cette pièce');
const startingClearance = imageIslandClearance('skin', 'shoulderL', 754 / 1024, 1 - 307 / 1024);
assert.ok(startingClearance > 0, 'Le centre de pose est à l’intérieur de la pièce');
assert.ok(imageIslandClearance('skin', 'shoulderL', 715 / 1024, 1 - 277 / 1024) < startingClearance, 'Le bord étroit qui rognerait le logo est détecté');
assert.equal(imageIslandClearance('skin', 'shoulderL', -1, -1), -1, 'Hors pièce : aucune marge valide');
assert.equal(continuousImageUV({ u: .5, v: .5 }, { u: .53, v: .48 }), true, 'Un déplacement local est autorisé');
assert.equal(continuousImageUV({ u: .5, v: .5 }, { u: .9, v: .1 }), false, 'Une couture UV ne téléporte pas le logo');
assert.equal(continuousImageUV({ u: .5, v: .5 }, { u: NaN, v: .5 }), false, 'Une valeur invalide ne déplace pas le logo');
assert.equal(continuousImageUV({ u: .5, v: .5 }, { u: .5, v: Infinity }), false, 'Une valeur infinie est refusée');
console.log('✓ Placement image : 13 assertions');
