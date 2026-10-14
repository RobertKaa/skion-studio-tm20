import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { getEnv } from 'fabric/node';
import type { LayerInfo } from '../src/editor/EditorCore';

registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
} });
const desktop = getEnv().window;
Object.defineProperty(desktop, 'innerWidth', { configurable: true, value: 1400 });
Object.assign(globalThis, { React, window: desktop, document: desktop.document, HTMLElement: desktop.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { LayerList } = await import('../src/ui/LayerList');
const host = document.createElement('div'); document.body.append(host);
host.style.overflowY = 'auto';
const root = createRoot(host);
const base: LayerInfo[] = Array.from({ length: 6 }, (_, index) => ({
  id: `layer-${index}`, name: `Calque ${index}`, type: index === 3 ? 'image' : 'rect', visible: true, locked: false, selected: index === 2, linked: index === 4,
  ...(index === 3 ? { material: { name: 'Pierre', ownerId: 'layer-3', linked: false } } : {}),
  ...(index === 4 ? { material: { name: 'Pierre', ownerId: 'layer-3', linked: true } } : {}),
}));
let layers = base.map(layer => ({ ...layer }));
const reorders: [string, string, 'before' | 'after'][] = [];
const moves: [string, 'up' | 'down'][] = [];
const selections: [string, boolean | undefined][] = [];
const deletes: string[] = []; const locks: string[] = []; const visibility: string[] = [];
const bubbledKeys: string[] = [];
const appKey = (event: KeyboardEvent) => { bubbledKeys.push(event.key); };
desktop.addEventListener('keydown', appKey);
const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
desktop.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
desktop.cancelAnimationFrame = id => { frames.delete(id); };
const rect = (top: number, height: number) => ({ x: 0, y: top, top, left: 0, bottom: top + height, right: 320, width: 320, height, toJSON: () => ({}) });
host.getBoundingClientRect = () => rect(0, 160);
Object.defineProperties(host, { clientHeight: { value: 160 }, scrollHeight: { value: 240 } });
function draw() {
  root.render(<LayerList layers={layers} onSelect={(layer, edit) => selections.push([layer.id, edit])}
    onMove={(id, direction) => moves.push([id, direction])} onReorder={(source, target, position) => { reorders.push([source, target, position]); return true; }}
    onDelete={id => deletes.push(id)} onToggleLock={id => locks.push(id)} onToggleVisible={id => visibility.push(id)} />);
}
function geometry() {
  const list = host.querySelector<HTMLElement>('.layer-list')!;
  list.getBoundingClientRect = () => rect(-host.scrollTop, layers.length * 40);
  for (const [index, row] of [...host.querySelectorAll<HTMLElement>('[data-layer-id]')].entries()) {
    row.getBoundingClientRect = () => rect(index * 40 - host.scrollTop, 40);
    const grip = row.querySelector<HTMLButtonElement>('.layer-grip')!;
    let capture: number | null = null;
    grip.setPointerCapture = id => { capture = id; };
    grip.hasPointerCapture = id => capture === id;
    grip.releasePointerCapture = () => { capture = null; };
  }
}
function row(id: string) { return host.querySelector<HTMLElement>(`[data-layer-id="${id}"]`)!; }
function pointer(type: string, target: EventTarget, x: number, y: number, pointerId = 1, button = 0) {
  const event = new desktop.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
  target.dispatchEvent(event);
}
const start = (id: string, y: number, button = 0) => act(async () => pointer('pointerdown', row(id).querySelector('.layer-grip')!, 10, y, 1, button));
const move = (y: number, x = 10, pointerId = 1) => act(async () => pointer('pointermove', document, x, y, pointerId));
const release = (y: number, x = 10) => act(async () => pointer('pointerup', document, x, y));
const status = () => host.querySelector('[role="status"]')!.textContent!;

try {
  await act(async () => draw()); geometry();
  assert.equal(window.innerWidth, 1400, 'Interaction tests use desktop dimensions');
  assert(row('layer-4').querySelector<HTMLButtonElement>('.layer-grip')!.disabled, 'A linked finish cannot be reordered separately');
  assert.equal(row('layer-3').querySelector('.layer-material-link')!.textContent, 'Matériau · couleur');
  assert.equal(row('layer-4').querySelector('.layer-material-link')!.textContent, 'Lié au matériau');
  assert.equal(host.querySelectorAll('[aria-label="Réordonner Pierre"]').length, 2, 'Identical names retain separate stable layer identities');

  await start('layer-0', 12); await move(15); await release(15);
  assert.equal(reorders.length, 0, 'A small click movement never reorders the project');
  assert.equal(selections.length, 0, 'The reorder grip never opens the inspector or changes selection');
  await start('layer-0', 12); await move(100);
  assert(row('layer-0').classList.contains('is-drag-source'));
  assert(row('layer-3').classList.contains('is-drop-before'), 'The insertion line follows the lower half of the hovered row');
  assert.equal(reorders.length, 0, 'Pointer moves are a preview until release');
  await release(100);
  assert.deepEqual(reorders.at(-1), ['layer-0', 'layer-3', 'before']);
  assert(!host.querySelector('.is-dragging'));
  assert(!row('layer-0').querySelector<HTMLButtonElement>('.layer-grip')!.hasPointerCapture(1));
  assert(status().includes('Calque 0 déplacé au-dessus de Pierre'));
  assert.equal(frames.size, 0, 'Drop stops the animation and releases its pointer capture');

  await start('layer-3', 132); await move(5); await release(5);
  assert.deepEqual(reorders.at(-1), ['layer-3', 'layer-0', 'before'], 'A material can be dragged directly to the first row');
  host.scrollTop = 80;
  await start('layer-0', 5); await move(155); await release(155);
  assert.deepEqual(reorders.at(-1), ['layer-0', 'layer-5', 'after'], 'A layer can be dropped after the very last row');
  host.scrollTop = 0;
  const count = reorders.length;
  await start('layer-1', 52); await move(79); await release(79);
  assert.equal(reorders.length, count, 'Dropping next to the same neighbours is a no-op');
  await start('layer-0', 12); await move(155); await release(155, 500);
  assert.equal(reorders.length, count, 'Dropping outside the list never modifies order');
  assert.equal(frames.size, 0);
  await start('layer-0', 12); await move(110);
  const keysBeforeEscape = bubbledKeys.length;
  await act(async () => document.dispatchEvent(new desktop.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
  await release(110);
  assert.equal(reorders.length, count); assert.equal(status(), 'Déplacement annulé.');
  assert.equal(bubbledKeys.length, keysBeforeEscape, 'Cancelling a drag prevents the app Escape shortcut from deselecting the current object');
  await act(async () => document.dispatchEvent(new desktop.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
  assert.equal(bubbledKeys.at(-1), 'Escape', 'Escape remains available to the app when no drag is active');
  await start('layer-0', 12); await move(110);
  await act(async () => pointer('pointercancel', document, 10, 110)); await release(110);
  assert.equal(reorders.length, count, 'Pointer cancellation discards the preview');
  await start('layer-0', 12); await move(110);
  await act(async () => desktop.dispatchEvent(new desktop.Event('blur'))); await release(110);
  assert.equal(reorders.length, count, 'Leaving the window cancels an unfinished drag');
  await start('layer-0', 12, 2); await move(110); await release(110);
  assert.equal(reorders.length, count, 'Only the primary mouse button can begin reordering');
  await start('layer-0', 12); await move(110, 10, 2);
  assert(!host.querySelector('.is-dragging'), 'A second pointer cannot take over the active gesture');
  await release(12);

  await start('layer-0', 12); await move(110);
  layers = layers.slice(1); await act(async () => draw()); geometry(); await release(110);
  assert.equal(reorders.length, count, 'Removing a source during drag cancels without a stale callback');
  assert(!host.querySelector('.is-dragging')); assert.equal(frames.size, 0);
  layers = base.map(layer => ({ ...layer })); await act(async () => draw()); geometry();

  await start('layer-0', 12); await move(155);
  const tick = frames.entries().next().value!; frames.delete(tick[0]);
  await act(async () => tick[1](16));
  assert(host.scrollTop > 0, 'A long list scrolls automatically near its lower edge');
  await move(10);
  const topTick = frames.entries().next().value!; frames.delete(topTick[0]);
  const oldScroll = host.scrollTop; await act(async () => topTick[1](32));
  assert(host.scrollTop < oldScroll, 'The upper edge scrolls back to earlier layers');
  await release(10, 500); host.scrollTop = 0;

  const keysBeforeArrow = bubbledKeys.length;
  await act(async () => row('layer-2').querySelector<HTMLButtonElement>('.layer-grip')!.dispatchEvent(new desktop.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' })));
  assert.deepEqual(moves.at(-1), ['layer-2', 'up'], 'The grip supports keyboard reordering');
  assert.equal(bubbledKeys.length, keysBeforeArrow, 'Reordering with a grip arrow key cannot also move the camera or selected object');
  await act(async () => row('layer-2').querySelector<HTMLButtonElement>('[aria-label="Descendre"]')!.click());
  assert.deepEqual(moves.at(-1), ['layer-2', 'down'], 'Existing arrow buttons remain available');
  await act(async () => row('layer-2').querySelector<HTMLButtonElement>('.layer-select')!.click());
  assert.deepEqual(selections.at(-1), ['layer-2', undefined]);
  await act(async () => row('layer-2').querySelector<HTMLButtonElement>('.layer-select')!.dispatchEvent(new desktop.MouseEvent('dblclick', { bubbles: true })));
  assert.deepEqual(selections.at(-1), ['layer-2', true]);
  await act(async () => row('layer-3').querySelector<HTMLButtonElement>('[aria-label="Modifier le matériau Pierre"]')!.click());
  assert.deepEqual(selections.at(-1), ['layer-3', true]);
  await act(async () => {
    row('layer-2').querySelector<HTMLButtonElement>('[aria-label="Supprimer"]')!.click();
    row('layer-2').querySelector<HTMLButtonElement>('[aria-label="Verrouiller"]')!.click();
    row('layer-2').querySelector<HTMLButtonElement>('[aria-label="Masquer"]')!.click();
  });
  assert.deepEqual([deletes, locks, visibility], [['layer-2'], ['layer-2'], ['layer-2']], 'Action buttons still operate on their own layer');
  layers = []; await act(async () => draw());
  assert.equal(host.querySelectorAll('[data-layer-id]').length, 0, 'An empty list leaves no stale draggable rows');
  layers = base.map(layer => ({ ...layer })); await act(async () => draw()); geometry();
  await start('layer-0', 12); await move(110);
} finally { await act(async () => root.unmount()); host.remove(); desktop.removeEventListener('keydown', appKey); }
assert.equal(frames.size, 0, 'Unmount always stops auto scrolling');
console.log('✓ Calques UI desktop : drag avec seuil et indicateur, annulation, hors liste, ordre inchangé, linked, changement de liste, scroll automatique, clavier et boutons existants');
