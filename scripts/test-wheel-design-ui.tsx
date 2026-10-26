import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { getEnv } from 'fabric/node';
import { DEFAULT_WHEEL_DESIGN, WHEEL_DESIGN_PRESETS, type WheelDesignSettings } from '../src/wheelDesign';
import type { WheelDesignTarget } from '../src/ui/WheelDesignDialog';

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
let open = true, editing = true, session = 0, closed = 0;
let initial: WheelDesignSettings = { ...DEFAULT_WHEEL_DESIGN, radius: .84, width: .04, angle: 1 };
let target: WheelDesignTarget = 'inner';
let action: () => Promise<void> = async () => {};
const applications: { settings: WheelDesignSettings; target: WheelDesignTarget }[] = [];
const draw = () => root.render(open ? <WheelDesignDialog key={session} initial={initial} initialTarget={target} editing={editing}
  onApply={async (settings, side) => { applications.push({ settings: structuredClone(settings), target: side }); await action(); }}
  onClose={() => { closed++; open = false; draw(); }} /> : null);
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label)!;
const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const change = async (label: string, value: string) => act(async () => {
  const element = field(label); assert(element, `Field ${label} exists`);
  Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new desktop.Event('input', { bubbles: true }));
  element.dispatchEvent(new desktop.Event('change', { bubbles: true }));
});
const selectTarget = async (value: WheelDesignTarget) => act(async () => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Flanc à décorer"]')!;
  select.value = value; select.dispatchEvent(new desktop.Event('change', { bubbles: true }));
});
const key = (value: string, options: KeyboardEventInit = {}) => {
  const event = new desktop.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event); return event;
};
const reopen = async () => {
  session++; open = true; launcher.focus(); await act(async () => draw());
};
let globalKeys = 0;
const outsideKey = () => globalKeys++;
document.addEventListener('keydown', outsideKey);
try {
  launcher.focus(); await act(async () => draw());
  const initialCopy = structuredClone(initial);
  assert.equal(host.querySelector('[role="dialog"]')!.getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'Fermer l’atelier de flancs', 'Opening the studio captures focus');
  assert.equal(host.querySelector<HTMLSelectElement>('select')!.value, 'inner', 'Editing restores the current sidewall mask');
  assert.equal(host.querySelectorAll('.wheel-design-patterns button').length, WHEEL_DESIGN_PRESETS.length);
  assert.equal(field('Rayon du motif').value, '84');
  assert.equal(field('Largeur du motif').value, '4');
  assert.equal(field('Rotation du motif').value, '1');
  assert.equal(field('Rayon du motif').step, '0.1', 'Sidewall positioning supports a tenth of one percent');
  for (const canvas of host.querySelectorAll<HTMLCanvasElement>('canvas')) {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    assert(pixels.some((value, index) => index % 4 === 3 && value > 0), 'Every pattern thumbnail and preview draws visible artwork');
  }
  await act(async () => button('Repères techniques').click());
  assert.equal(host.querySelectorAll('[aria-pressed="true"]').length, 1, 'Only one pattern is active');
  await change('Rayon du motif', '87.3'); await change('Largeur du motif', '6.4');
  await change('Rotation du motif', '-23.5'); await change('Répétitions', '47');
  await selectTarget('both');
  assert.equal(field('Rayon du motif · curseur').value, '87.3', 'Numeric edits update the matching slider');
  assert.equal(field('Rotation du motif · curseur').value, '-23.5');
  assert.deepEqual(initial, initialCopy, 'Draft edits never mutate the source layer settings');
  assert.equal(applications.length, 0, 'Previewing and changing masks do not write a material layer');
  const ctrlSave = key('s', { ctrlKey: true }); assert(ctrlSave.defaultPrevented);
  const ctrlUndo = key('z', { ctrlKey: true }); assert(ctrlUndo.defaultPrevented);
  assert.equal(globalKeys, 0, 'The studio isolates global editor keyboard shortcuts');

  let finish: () => void = () => {};
  action = () => new Promise<void>(resolve => { finish = resolve; });
  await act(async () => { button('Appliquer au calque').click(); button('Appliquer au calque').click(); });
  assert.equal(applications.length, 1, 'Repeated clicks submit only one pending operation');
  assert.deepEqual(applications[0], { target: 'both', settings: { ...initialCopy, pattern: 'segments', radius: .873, width: .064, angle: -23.5, count: 47 } });
  assert(button('Application…').disabled);
  assert(field('Rayon du motif').matches(':disabled'), 'Pending application locks the controls');
  const closesBefore = closed;
  await act(async () => { key('Escape'); button('Annuler').click(); host.querySelector<HTMLElement>('.wheel-design-overlay')!.click(); });
  assert.equal(closed, closesBefore, 'Escape, cancel, and backdrop cannot interrupt an in-flight application');
  await act(async () => finish());
  assert(!button('Appliquer au calque').disabled);

  action = async () => { throw new Error('Calque verrouillé pendant l’application.'); };
  await act(async () => button('Appliquer au calque').click());
  assert.equal(host.querySelector('[role="alert"]')!.textContent, 'Calque verrouillé pendant l’application.');
  assert.equal(field('Rayon du motif').value, '87.3', 'Failures preserve the draft for correction');
  assert(!button('Appliquer au calque').disabled, 'A failure allows retry');
  action = async () => { throw 'unexpected'; };
  await act(async () => button('Appliquer au calque').click());
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /n’a pas pu être appliqué/);

  await act(async () => button('Marquage courbe').click());
  assert(!field('Répétitions'), 'Lettering exposes text-specific precision controls');
  const beforeEmptyText = applications.length;
  await change('Inscription du pneu', '');
  assert.equal(field('Inscription du pneu').value, '', 'An inscription can be cleared without resetting to the default text');
  await change('Rotation du motif', '12');
  assert.equal(field('Inscription du pneu').value, '', 'Other draft edits preserve the temporarily empty inscription');
  await act(async () => button('Appliquer au calque').click());
  assert.equal(applications.length, beforeEmptyText, 'An empty inscription never reaches the layer mutation callback');
  assert.match(host.querySelector('[role="alert"]')!.textContent!, /inscription de 1 à 28 caractères/);
  assert(!button('Appliquer au calque').disabled, 'An invalid inscription remains editable');
  await change('Inscription du pneu', 'TEAM SKION'); await change('Ouverture du texte', '210');
  await change('Code couleur · Couleur du motif', '#A1B2C3');
  await change('Rotation du motif', '999'); assert.equal(field('Rotation du motif').value, '180', 'Rotation is bounded');
  await change('Rayon du motif', '1'); assert.equal(field('Rayon du motif').value, '60', 'Radius cannot collapse onto the hub');
  await change('Largeur du motif', '999'); assert.equal(field('Largeur du motif').value, '16', 'Stroke width is bounded');
  await change('Rayon du motif', '98');
  assert.equal(field('Rayon du motif').value, '98', 'Changing radius preserves the requested radius');
  assert.equal(field('Largeur du motif').value, '4', 'A 98% radius allows a maximum width of 4% inside the tyre');
  assert.equal(field('Largeur du motif · curseur').value, '4', 'The coupled width remains visible in both precision controls');
  await change('Largeur du motif', '16');
  assert.equal(field('Largeur du motif').value, '16', 'Changing width preserves the requested width');
  assert.equal(field('Rayon du motif').value, '92', 'A 16% width moves the visible radius to 92% rather than silently clamping the drawing');
  assert.equal(field('Rayon du motif · curseur').value, '92');
  await change('Ouverture du texte', '999'); assert.equal(field('Ouverture du texte').value, '300', 'Text arc stays bounded');
  await change('Ouverture du texte', '210'); await selectTarget('outer');
  action = async () => {};
  await act(async () => button('Appliquer au calque').click());
  assert.equal(applications.at(-1)!.settings.pattern, 'lettering');
  assert.equal(applications.at(-1)!.settings.text, 'TEAM SKION');
  assert.equal(applications.at(-1)!.settings.color, '#a1b2c3');
  assert.equal(applications.at(-1)!.settings.arc, 210);
  assert.equal(applications.at(-1)!.settings.radius, .92, 'The applied radius matches the displayed radius after a coupled edit');
  assert.equal(applications.at(-1)!.settings.width, .16, 'The applied width matches the displayed width after a coupled edit');
  assert.equal(applications.at(-1)!.target, 'outer');
  const beforeCancel = applications.length;
  await act(async () => button('Annuler').click());
  assert.equal(applications.length, beforeCancel);
  assert.equal(document.activeElement, launcher, 'Closing restores focus to the launching control');

  editing = false; initial = { ...DEFAULT_WHEEL_DESIGN }; target = 'outer'; await reopen();
  assert(button('Ajouter le calque'), 'New designs use an explicit add action');
  const closeButton = host.querySelector<HTMLButtonElement>('[aria-label="Fermer l’atelier de flancs"]')!;
  const addButton = button('Ajouter le calque');
  await act(async () => { key('Tab', { shiftKey: true }); });
  assert.equal(document.activeElement, addButton, 'Shift+Tab wraps from first to last control');
  await act(async () => { key('Tab'); });
  assert.equal(document.activeElement, closeButton, 'Tab wraps from last to first control');
  launcher.focus(); await act(async () => { key('Tab'); });
  assert.equal(document.activeElement, closeButton, 'An escaped focus is recaptured inside the dialog');
  await act(async () => { key('Escape'); });
  assert(!host.querySelector('[role="dialog"]'));
  assert.equal(applications.length, beforeCancel, 'Escape discards a new draft without writes');
  assert.equal(document.activeElement, launcher);
  key('s', { ctrlKey: true }); assert.equal(globalKeys, 1, 'Closing removes the keyboard interception');
  console.log('✓ Atelier flancs desktop : brouillon isolé, cinq motifs, champs précis, cibles, application unique, erreurs, focus et clavier');
} finally {
  document.removeEventListener('keydown', outsideKey);
  await act(async () => root.unmount()); host.remove(); launcher.remove();
}
