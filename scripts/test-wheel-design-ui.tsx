import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act, useEffect } from 'react';
import { getEnv } from 'fabric/node';
import { DEFAULT_WHEEL_DESIGN, WHEEL_DESIGN_PRESETS } from '../src/wheelDesign';
import { WHEEL_COMPOSITION_STYLES, normalizeWheelComposition, type WheelDesignArtwork, type WheelDesignComposition } from '../src/wheelDesignComposition';
import type { WheelDesignCoverage, WheelDesignTarget } from '../src/ui/WheelDesignDialog';
registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
} });
const desktop = getEnv().window;
Object.defineProperty(desktop, 'innerWidth', { configurable: true, value: 1440 });
Object.defineProperty(desktop, 'innerHeight', { configurable: true, value: 900 });
Object.assign(globalThis, { React, document: desktop.document, window: desktop,
  HTMLElement: desktop.HTMLElement, HTMLInputElement: desktop.HTMLInputElement,
  HTMLCanvasElement: desktop.HTMLCanvasElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { WheelDesignDialog } = await import('../src/ui/WheelDesignDialog');
const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
const launcher = document.createElement('button'); launcher.textContent = 'Ouvrir le studio'; document.body.append(launcher);
let open = true, editing = true, session = 0, closed = 0, mounts = 0, unmounts = 0;
let initial: WheelDesignArtwork | undefined = { ...DEFAULT_WHEEL_DESIGN, radius: .84, width: .04, angle: 1 };
let target: WheelDesignTarget = 'inner', shownTarget: WheelDesignTarget;
let updateCoverage: (next: WheelDesignCoverage) => void = () => {};
let draft: WheelDesignComposition;
let action: () => Promise<void> = async () => {};
const applications: { artwork: WheelDesignComposition; target: WheelDesignTarget }[] = [];
export function ModelProbe({ composition, side }: { composition: WheelDesignComposition; side: WheelDesignTarget }) {
  draft = structuredClone(composition); shownTarget = side;
  useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
  return <div data-model-probe="true">Modele live</div>;
}
const draw = () => root.render(open ? <WheelDesignDialog key={session} initial={initial} initialTarget={target} editing={editing}
  modelPreview={(composition, side, onCoverageChange) => { updateCoverage = onCoverageChange; return <ModelProbe composition={composition} side={side} />; }}
  onApply={async (artwork, side) => { applications.push({ artwork: structuredClone(normalizeWheelComposition(artwork)), target: side }); await action(); }}
  onClose={() => { closed++; open = false; draw(); }} /> : null);
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)!;
const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const click = async (label: string) => act(async () => { const item = button(label) ?? field(label); assert(item, `Control ${label} exists`); item.click(); });
const change = async (label: string, value: string) => {
  await act(async () => {
    const element = field(label); assert(element, `Field ${label} exists`); element.focus();
    Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new desktop.Event('input', { bubbles: true }));
    element.dispatchEvent(new desktop.Event('change', { bubbles: true }));
  });
  await act(async () => field(label).blur());
};
const select = async (label: string, value: string) => act(async () => {
  const element = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  assert(element); element.value = value; element.dispatchEvent(new desktop.Event('change', { bubbles: true }));
});
const key = (value: string, options: KeyboardEventInit = {}) => {
  const event = new desktop.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event); return event;
};
const reopen = async () => { session++; open = true; launcher.focus(); await act(async () => draw()); };
const selected = () => draft.elements.find(element => element.name === field('Nom de l’élément')?.value)!;
const pointer = async (type: string, x: number, y: number, shiftKey = false) => act(async () => {
  const element = host.querySelector<SVGCircleElement>('[data-wheel-handle]')!;
  const event = new desktop.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, shiftKey });
  Object.defineProperty(event, 'pointerId', { value: 7 }); element.dispatchEvent(event);
});
let globalKeys = 0;
const outsideKey = () => globalKeys++;
document.addEventListener('keydown', outsideKey);
try {
  launcher.focus(); await act(async () => draw());
  const initialCopy = structuredClone(initial);
  assert.equal(host.querySelector('[role="dialog"]')!.getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'Fermer l’atelier de flancs');
  assert.equal(shownTarget!, 'inner'); assert.equal(draft!.elements.length, 1, 'Legacy design becomes one element');
  assert.equal(host.querySelectorAll('.wheel-design-add-grid button').length, 9);
  assert.equal(field('Rayon du motif').value, '84'); assert.equal(field('Rayon du motif').step, '0.1');
  await change('Rayon du motif', '87.3'); await change('Rotation du motif', '-23.5');
  assert.equal(selected().design.radius, .873); assert.equal(selected().design.angle, -23.5);
  assert.deepEqual(initial, initialCopy); assert.equal(applications.length, 0, 'Live drafts do not write material layers');
  await click('Construction'); await click('Roue 3D'); await click('Côte à côte');
  assert.equal(mounts, 1); assert.equal(unmounts, 0, 'View changes preserve the live model and camera');
  assert(field('Zones visibles du modèle').disabled, 'No area is invented when the real model is unavailable');
  assert.match(host.querySelector('.wheel-design-coverage-legend')!.textContent!, /en attente ou indisponibles/);
  const mask = document.createElement('canvas'); mask.width = mask.height = 64;
  mask.getContext('2d')!.fillRect(0, 0, 32, 64);
  const beforeCoverage = structuredClone(draft!);
  const artworkCanvas = host.querySelector<HTMLCanvasElement>('canvas[aria-label="Aperçu circulaire de la composition"]')!;
  const originalArtwork = artworkCanvas.toDataURL();
  await act(async () => updateCoverage({ side: 'outer', mask }));
  assert.match(host.querySelector('.wheel-design-coverage-legend')!.textContent!, /Visible de face.*Masqué ou vide.*Face extérieure/);
  const guide = host.querySelector<HTMLCanvasElement>('.wheel-design-coverage')!;
  assert(guide, 'Real coverage is drawn separately over the composition');
  assert.equal(guide.getContext('2d')!.getImageData(160, 320, 1, 1).data[3], 0, 'Actual visible pixels are unobscured');
  assert(guide.getContext('2d')!.getImageData(480, 320, 1, 1).data[3] > 100, 'Hidden or absent surface is dimmed');
  assert.equal(artworkCanvas.toDataURL(), originalArtwork, 'Coverage never paints into the artwork');
  await click('Zones visibles du modèle'); assert(!host.querySelector('.wheel-design-coverage'));
  assert.match(host.querySelector('.wheel-design-coverage-legend')!.textContent!, /Zones du modèle masquées/);
  await click('Zones visibles du modèle');
  await act(async () => updateCoverage({ side: 'inner', mask }));
  assert.match(host.querySelector('.wheel-design-coverage-legend')!.textContent!, /Face intérieure/);
  assert.deepEqual(draft!, beforeCoverage, 'Switching coverage sides never changes the draft to apply');
  await act(async () => updateCoverage({ side: 'inner', mask: null, alignmentConflict: true }));
  assert(field('Zones visibles du modèle').disabled, 'Unsupported geometry never presents a fabricated area');
  assert.match(host.querySelector('.wheel-design-alignment-warning')!.textContent!, /placement peut varier selon la roue/);
  await act(async () => updateCoverage(null));
  assert(!host.querySelector('.wheel-design-coverage')); assert(field('Zones visibles du modèle').disabled);
  await select('Flanc à décorer', 'both'); assert.equal(shownTarget!, 'both');
  const beforeSupport = structuredClone(draft!); await click('Pneu clair'); assert.deepEqual(draft!, beforeSupport);
  await change('Intensité lumineuse', '67'); await select('Activation lumineuse de l’élément', 'brake');
  assert.equal(selected().emission, .67); assert.equal(selected().emissionRole, 'brake');
  await click('Dupliquer l’élément'); assert.equal(draft!.elements.length, 2);
  assert.equal(selected().emission, .67); assert.equal(selected().emissionRole, 'brake', 'Duplicate retains its individual light settings');
  assert.equal(new Set(draft!.elements.map(element => element.id)).size, 2);
  const copyId = selected().id, copyName = selected().name;
  await click('Descendre l’élément'); assert.equal(draft!.elements[0].id, copyId);
  await click('Monter l’élément'); assert.equal(draft!.elements[1].id, copyId);
  await click('Masquer · ' + copyName); assert.equal(selected().visible, false);
  await click('Afficher · ' + copyName); await click('Verrouiller · ' + copyName);
  assert(field('Rayon du motif').matches(':disabled')); assert(button('Supprimer l’élément').disabled);
  await click('Déverrouiller · ' + copyName); await click('Supprimer l’élément'); assert.equal(draft!.elements.length, 1);
  await click('Annuler dans l’atelier'); assert.equal(draft!.elements.length, 2);
  await click('Rétablir dans l’atelier'); assert.equal(draft!.elements.length, 1);
  for (const preset of WHEEL_DESIGN_PRESETS.filter(item => item.id !== 'image')) {
    await click('Ajouter · ' + preset.label); assert.equal(selected().design.pattern, preset.id);
  }
  assert.equal(draft!.elements.length, 9);
  await click('Styles'); assert.equal(host.querySelectorAll('.wheel-design-style').length, 6);
  const beforeStyle = structuredClone(draft!);
  await click('Charger le style · ' + WHEEL_COMPOSITION_STYLES[2].label); assert.deepEqual(draft!, WHEEL_COMPOSITION_STYLES[2].composition);
  await click('Annuler dans l’atelier'); assert.deepEqual(draft!, beforeStyle); await click('Rétablir dans l’atelier');
  await click('Éléments ' + draft!.elements.length); await select('Type d’élément', 'lettering');
  await change('Inscription du pneu', ''); await change('Rotation du motif', '12');
  assert.equal(field('Inscription du pneu').value, ''); await click('Appliquer au calque'); assert.equal(applications.length, 0);
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /1 à 64/);
  await change('Inscription du pneu', 'TEAM SKION 2026'); await select('Police du texte', 'mono');
  await click('Texte en italique'); await click('Inverser le sens du texte');
  if (field('Espacement automatique du texte').checked) await click('Espacement automatique du texte');
  await change('Espacement du texte', '22'); await change('Contour du texte', '1.4'); await change('Répétition du texte', '2');
  assert.equal(selected().design.font, 'mono'); assert(selected().design.italic); assert(selected().design.reverse);
  assert.equal(selected().design.tracking, .22); assert(Math.abs(selected().design.outline! - .014) < 1e-12);
  await change('Rotation du motif', '999'); assert.equal(field('Rotation du motif').value, '180');
  await change('Rayon du motif', '1'); assert.equal(field('Rayon du motif').value, '60');
  await change('Taille du texte', '999'); assert.equal(field('Taille du texte').value, '16');
  await change('Rayon du motif', '98'); assert.equal(field('Taille du texte').value, '4');
  await change('Taille du texte', '16'); assert.equal(field('Rayon du motif').value, '92');
  await change('Arc disponible du texte', '999'); assert.equal(field('Arc disponible du texte').value, '300');
  await change('Rotation du motif', '0');
  const dial = host.querySelector<HTMLElement>('.wheel-design-dial')!;
  dial.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 640, width: 640, height: 640, toJSON() {} });
  const beforeDrag = structuredClone(draft!);
  const undoBeforeClick = button('Annuler dans l’atelier').disabled;
  await pointer('pointerdown', 590, 270); await pointer('pointerup', 590, 270);
  assert.deepEqual(draft!, beforeDrag, 'Grabbing an enlarged handle without moving never shifts the artwork');
  assert.equal(button('Annuler dans l’atelier').disabled, undoBeforeClick, 'A handle click adds no history entry');
  await pointer('pointerdown', 590, 270, true); await pointer('pointermove', 580, 380, true);
  assert.equal(Math.abs(selected().design.angle % 15), 0); await pointer('pointerup', 580, 380, true);
  const afterDrag = structuredClone(draft!);
  await click('Annuler dans l’atelier'); assert.deepEqual(draft!, beforeDrag, 'One drag is one undo action');
  await click('Rétablir dans l’atelier'); assert.deepEqual(draft!, afterDrag);
  await pointer('pointerdown', 530, 150); await pointer('pointermove', 390, 90);
  await act(async () => { key('Escape'); }); assert(host.querySelector('[role="dialog"]')); assert.deepEqual(draft!, afterDrag);
  await click('Annuler dans l’atelier'); assert.deepEqual(draft!, beforeDrag, 'Cancelled drag leaves history intact');
  host.querySelector<SVGCircleElement>('[data-wheel-handle]')!.focus();
  await act(async () => { key('ArrowRight', { shiftKey: true }); }); assert.equal(selected().design.angle, 15);
  field('Inscription du pneu').focus(); assert.equal(key('z', { ctrlKey: true }).defaultPrevented, false);
  button('Fermer l’atelier de flancs').focus();
  await act(async () => { assert(key('z', { ctrlKey: true }).defaultPrevented); }); assert.equal(selected().design.angle, 0);
  await act(async () => { key('y', { ctrlKey: true }); }); assert.equal(selected().design.angle, 15);
  assert(key('s', { ctrlKey: true }).defaultPrevented); assert.equal(globalKeys, 0);
  // Local raster import keeps the original PNG bytes and never creates an empty logo element.
  const logoCanvas = document.createElement('canvas'); logoCanvas.width = 48; logoCanvas.height = 24;
  logoCanvas.getContext('2d')!.fillStyle = '#e85a28'; logoCanvas.getContext('2d')!.fillRect(2, 2, 35, 15);
  const png = logoCanvas.toDataURL('image/png');
  const logo = new File([Buffer.from(png.split(',')[1], 'base64')], 'Sponsor 26.png', { type: 'image/png' });
  const upload = async (file: File) => {
    await act(async () => {
      const input = field('Fichier du logo'); Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new desktop.Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 40));
    });
    for (let count = 0; count < 100 && host.textContent?.includes('Préparation du logo…'); count++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  };
  await click('Ajouter · Logo personnel'); await upload(logo);
  assert.equal(selected().design.pattern, 'image'); assert.equal(selected().design.imageData, png); assert.equal(selected().name, 'Sponsor 26');
  assert(!field('Code couleur · Couleur du motif'));
  await click('Ajouter · Logo personnel'); await upload(new File(['<svg/>'], 'fake.png', { type: 'image/png' }));
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /PNG, JPEG ou WebP/); assert.equal(selected().design.imageData, png);
  let finish: () => void = () => {};
  action = () => new Promise<void>(resolve => { finish = resolve; });
  await act(async () => { button('Appliquer au calque').click(); button('Appliquer au calque').click(); });
  assert.equal(applications.length, 1); assert.equal(applications[0].target, 'both'); assert.deepEqual(applications[0].artwork, draft!);
  assert(button('Application…').disabled); assert(field('Rayon du motif').matches(':disabled'));
  const closesBefore = closed;
  await act(async () => { key('Escape'); button('Annuler').click(); host.querySelector<HTMLElement>('.wheel-design-overlay')!.click(); });
  assert.equal(closed, closesBefore); await act(async () => finish());
  action = async () => { throw new Error('Calque verrouillé pendant l’application.'); };
  await click('Appliquer au calque'); assert.equal(host.querySelector('[role="alert"]')!.textContent, 'Calque verrouillé pendant l’application.');
  assert.equal(selected().design.imageData, png); assert(!button('Appliquer au calque').disabled);
  await click('Annuler'); assert.equal(document.activeElement, launcher); assert.deepEqual(initial, initialCopy);
  editing = false; initial = undefined; target = 'outer'; action = async () => {}; await reopen();
  assert.equal(draft!.elements.length, 5);
  const originalElement = structuredClone(selected());
  field('Nom de l’élément').focus();
  await act(async () => { assert(key('d', { ctrlKey: true }).defaultPrevented, 'Ctrl+D never bookmarks the editor from a text field'); });
  assert.equal(draft!.elements.length, 6); assert.notEqual(selected().id, originalElement.id);
  assert.deepEqual(selected().design, originalElement.design);
  await click('Annuler dans l’atelier'); assert.equal(draft!.elements.length, 5);
  const firstControl = host.querySelector<HTMLButtonElement>('button:not(:disabled)')!, add = button('Ajouter le calque');
  firstControl.focus();
  await act(async () => { key('Tab', { shiftKey: true }); }); assert.equal(document.activeElement, add);
  await act(async () => { key('Tab'); }); assert.equal(document.activeElement, firstControl);
  launcher.focus(); await act(async () => { key('Tab'); }); assert.equal(document.activeElement, firstControl);
  const writes = applications.length;
  await act(async () => { key('Escape'); }); assert(!host.querySelector('[role="dialog"]'));
  assert.equal(applications.length, writes); assert.equal(document.activeElement, launcher);
  key('s', { ctrlKey: true }); assert.equal(globalKeys, 1); assert.equal(mounts, unmounts);
  console.log('✓ Atelier desktop : neuf éléments, six styles, pile, verrouillage, texte avancé, logo, poignée, historique, modèle live, application et focus');
} finally {
  document.removeEventListener('keydown', outsideKey);
  await act(async () => root.unmount()); host.remove(); launcher.remove();
}
