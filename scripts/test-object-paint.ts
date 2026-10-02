import assert from 'node:assert/strict';
import { FabricObject, Group, Line, Path, Rect } from 'fabric';
import { applyObjectPaint, applyObjectStyle, readObjectPaint } from '../src/editor/objectPaint';

const capot = new Rect({ width: 80, height: 100, fill: '#5a3c00' });
const toit = new Rect({ width: 40, height: 60, fill: '#8c0000' });
const piece = new Group([capot, new Group([toit])]);
assert.equal(readObjectPaint(piece).mixed, true);
piece.dirty = false;
(piece.getObjects()[1] as Group).dirty = false;
applyObjectPaint(piece, '#08ff00');
assert.equal(capot.fill, '#08ff00');
assert.equal(toit.fill, '#08ff00');
assert.equal(piece.dirty, true);
assert.equal(piece.getObjects()[1].dirty, true);
assert.deepEqual(readObjectPaint(piece), { color: '#08ff00', mixed: false, editable: true });
console.log('ok matière d’une pièce composée : chaque polygone et chaque cache sont mis à jour');

const line = new Line([0, 0, 40, 40], { stroke: '#000000' });
const brush = new Path('M 0 0 L 40 40', { fill: null, stroke: '#000000' });
applyObjectPaint(new Group([line, brush]), '#eb0000');
assert.equal(line.stroke, '#eb0000');
assert.equal(brush.stroke, '#eb0000');
assert.equal(brush.fill, null);
console.log('ok matière appliquée aux traits et au pinceau via leur contour');

const translucent = new Rect({ fill: 'rgba(90,60,0,0.4)' });
applyObjectPaint(translucent, '#08ff00');
assert.equal(translucent.fill, 'rgba(8,255,0,0.4)');
console.log('ok l’alpha du remplissage est conservé');

class Raster extends FabricObject { static type = 'Image'; }
const image = new Raster({ fill: '#123456' });
applyObjectPaint(image, '#08ff00');
assert.equal(image.fill, '#123456');
assert.equal(readObjectPaint(image).editable, false);
console.log('ok aucun réglage de peinture fictif sur une image');

applyObjectStyle(piece, { fill: '#ff5500', opacity: 0.5 });
assert.equal(capot.fill, '#ff5500');
assert.equal(toit.fill, '#ff5500');
assert.equal(piece.opacity, 0.5);
assert.equal(capot.opacity, 1);
console.log('ok couleur du groupe propagée, opacité portée par le groupe une seule fois');
