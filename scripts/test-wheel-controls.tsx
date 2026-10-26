import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { getEnv } from 'fabric/node';
import { WHEEL_SURFACE_PRESETS, type WheelSurfaceSettings } from '../src/wheelSurface';

registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
} });
const desktop = getEnv().window;
Object.assign(globalThis, { React, document: desktop.document, window: desktop,
  HTMLElement: desktop.HTMLElement, HTMLInputElement: desktop.HTMLInputElement, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import('react-dom/client');
const { WheelSurfaceControls } = await import('../src/ui/WheelSurfaceControls');
const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
let settings: WheelSurfaceSettings = { mode: 'smooth', strength: 1 };
let officialModel = true;
let volumeAvailable = false;
let volumeBusy = false;
let inspections = 0;
const changes: WheelSurfaceSettings[] = [];
const draw = () => root.render(<WheelSurfaceControls value={settings} officialModel={officialModel} volumeAvailable={volumeAvailable} volumeBusy={volumeBusy} onInspect={() => inspections++} onChange={value => {
  settings = value; changes.push(value); draw();
}} />);
const field = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const input = async (value: string) => act(async () => {
  const element = field('Intensité précise du relief en pourcentage');
  Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new desktop.Event('input', { bubbles: true }));
  element.dispatchEvent(new desktop.Event('change', { bubbles: true }));
});
try {
  await act(async () => draw());
  const cards = () => [...host.querySelectorAll<HTMLButtonElement>('.wheel-profile-card')];
  assert.equal(cards().length, WHEEL_SURFACE_PRESETS.length, 'Every tyre profile has a selectable visual card');
  const inspect = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Inspecter le pneu en 3D'))!;
  await act(async () => inspect().click()); assert.equal(inspections, 1, 'The tyre inspection action is reachable from the profile library');
  assert.equal(host.querySelectorAll('canvas').length, 8, 'Only small procedural swatches allocate a canvas');
  for (const canvas of host.querySelectorAll('canvas')) {
    assert.deepEqual([canvas.width, canvas.height], [64, 80]);
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, 64, 80).data;
    assert(pixels.some((value, index) => index % 4 === 0 && value > 0), 'Swatches show real rendered tread pixels');
  }
  assert.equal(host.querySelectorAll('[aria-pressed="true"]').length, 1);
  assert(!field('Intensité précise du relief en pourcentage'), 'Slick does not expose a misleading relief slider');
  await act(async () => cards().find(button => button.getAttribute('aria-label') === 'Hiver lamellisé')!.click());
  assert.equal(settings.mode, 'winter');
  assert.equal(host.querySelector<HTMLSelectElement>('select[aria-label="Relief des pneus"]')!.value, 'winter');
  assert.equal(field('Intensité du relief').step, '0.01', 'The slider supports one-percent precision');
  await input('37'); assert.equal(settings.strength, .37);
  assert.equal(field('Intensité du relief').value, '0.37', 'Number and slider stay synchronized');
  await input('900'); assert.equal(settings.strength, 1, 'Oversized input is bounded');
  await input('-20'); assert.equal(settings.strength, 0, 'Negative input is bounded');
  const count = changes.length; await input(''); assert.equal(changes.length, count, 'Clearing input does not silently erase relief');

  const choose = async (label: string) => act(async () => cards().find(button => button.getAttribute('aria-label') === label)!.click());
  const actualDepth = () => host.querySelector<HTMLOutputElement>('output[aria-label="Profondeur réelle des crampons"]');
  const profileSelect = () => host.querySelector<HTMLSelectElement>('select[aria-label="Relief des pneus"]')!;
  volumeAvailable = true; settings = { mode: 'road', strength: .5 };
  await act(async () => draw());
  await choose('Rallye terre');
  assert.deepEqual(settings, { mode: 'gravel', strength: .5, volume: true }, 'Choosing a supported off-road profile enables its geometry at the current intensity');
  assert(field('Crampons 3D').checked);
  assert.equal(actualDepth()?.textContent, '5,3 mm', 'The displayed geometric depth reflects the current intensity');
  assert(host.textContent?.includes('modèle GBX exporté'), 'The volume control identifies its preview and export effect');
  await act(async () => field('Crampons 3D').click());
  assert(!Object.hasOwn(settings, 'volume'), 'Turning geometry off removes the persisted volume flag');
  assert(!actualDepth(), 'A texture-only profile does not claim a real geometric depth');
  const uncheckedCount = changes.length;
  await choose('Rallye terre');
  assert.equal(changes.length, uncheckedCount, 'Re-clicking the selected profile respects an explicit geometry opt-out');
  assert(!field('Crampons 3D').checked);
  await choose('Tout-terrain boue');
  assert.deepEqual(settings, { mode: 'mud', strength: .5, volume: true }, 'A newly selected mud profile also enables available geometry');
  assert.equal(actualDepth()?.textContent, '7 mm');
  const numericDraftCount = changes.length;
  await input('37');
  assert.equal(settings.strength, .5, 'Typing a geometric depth keeps the applied parent intensity intact');
  assert.equal(changes.length, numericDraftCount, 'Typing does not rebuild geometry for each digit');
  assert.equal(actualDepth()?.textContent, '5,2 mm', 'The draft previews the precise depth before applying');
  await act(async () => field('Intensité précise du relief en pourcentage').dispatchEvent(new desktop.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.equal(settings.strength, .37);
  assert.equal(changes.length, numericDraftCount + 1, 'Enter applies one rebuild for the complete numeric edit');
  const escapeCount = changes.length;
  await input('68');
  await act(async () => field('Intensité précise du relief en pourcentage').dispatchEvent(new desktop.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(field('Intensité précise du relief en pourcentage').value, '37', 'Escape restores the applied precision value');
  assert.equal(changes.length, escapeCount);
  await input('');
  assert.equal(field('Intensité précise du relief en pourcentage').value, '', 'A geometric numeric draft may be freely cleared');
  await act(async () => { field('Intensité précise du relief en pourcentage').focus(); field('Intensité précise du relief en pourcentage').blur(); });
  assert.equal(settings.strength, .37);
  assert.equal(field('Intensité précise du relief en pourcentage').value, '37', 'Blurring an empty draft restores the prior value');
  assert.equal(changes.length, escapeCount);
  await input('49');
  await act(async () => { field('Intensité précise du relief en pourcentage').focus(); field('Intensité précise du relief en pourcentage').blur(); });
  assert.equal(settings.strength, .49, 'Blurring a complete numeric draft commits the edit');
  const sliderCount = changes.length;
  for (const strength of ['0.41', '0.62', '0.84']) await act(async () => {
    const slider = field('Intensité du relief');
    Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype, 'value')!.set!.call(slider, strength);
    slider.dispatchEvent(new desktop.Event('input', { bubbles: true }));
    slider.dispatchEvent(new desktop.Event('change', { bubbles: true }));
  });
  assert.equal(settings.strength, .49, 'Dragging a geometric slider does not mutate the applied intensity');
  assert.equal(changes.length, sliderCount, 'Continuous pointer movement schedules no intermediate geometry rebuild');
  assert.equal(field('Intensité du relief').value, '0.84', 'The slider follows the complete drag while the parent stays stable');
  await act(async () => field('Intensité du relief').dispatchEvent(new desktop.Event('pointerup', { bubbles: true })));
  assert.equal(settings.strength, .84);
  assert.equal(changes.length, sliderCount + 1, 'Releasing the slider applies exactly one geometry rebuild');
  await act(async () => {
    field('Intensité du relief').dispatchEvent(new desktop.Event('pointerup', { bubbles: true }));
    field('Intensité du relief').focus(); field('Intensité du relief').blur();
  });
  assert.equal(changes.length, sliderCount + 1, 'Release followed by blur cannot duplicate the geometry commit');

  volumeBusy = true; await act(async () => draw());
  assert.equal(host.querySelector('.wheel-surface-controls')?.getAttribute('aria-busy'), 'true');
  assert.equal(cards().filter(button => button.disabled).length, WHEEL_SURFACE_PRESETS.length);
  assert(profileSelect().disabled && inspect().disabled && field('Crampons 3D').disabled);
  assert(field('Intensité du relief').disabled && field('Intensité précise du relief en pourcentage').disabled, 'All geometry-affecting controls pause during the asynchronous rebuild');
  assert(host.querySelector('[role="status"]')?.textContent?.includes('Construction'));
  const busySettings = { ...settings }, busyCount = changes.length, busyInspections = inspections;
  await choose('Routier sportif');
  await act(async () => { field('Crampons 3D').click(); inspect().click(); });
  await input('88');
  await act(async () => {
    profileSelect().value = 'rain';
    profileSelect().dispatchEvent(new desktop.Event('change', { bubbles: true }));
  });
  assert.deepEqual(settings, busySettings, 'Disabled controls and queued DOM input cannot race a geometry rebuild');
  assert.equal(changes.length, busyCount);
  assert.equal(inspections, busyInspections);

  volumeBusy = false; await act(async () => draw());
  await choose('Routier sportif');
  assert.equal(settings.mode, 'road');
  assert(!Object.hasOwn(settings, 'volume'), 'Returning to a road profile removes off-road geometry');
  assert(!field('Crampons 3D'), 'The off-road volume option does not clutter road profiles');
  volumeAvailable = false; await act(async () => draw());
  await choose('Rallye terre');
  assert(!Object.hasOwn(settings, 'volume'), 'An unavailable geometry layout retains texture-only off-road profiles');
  assert(field('Crampons 3D').disabled && !field('Crampons 3D').checked);
  assert(host.textContent?.includes('Ce modèle ne permet pas'), 'Unsupported geometry is explained beside its disabled control');
  const unavailableCount = changes.length;
  await act(async () => field('Crampons 3D').click());
  assert.equal(changes.length, unavailableCount);

  officialModel = false; await act(async () => draw());
  assert(inspect().disabled, 'Native tyre inspection does not invent a placement on unknown custom UVs');
  assert.equal(cards().filter(button => button.disabled).length, 8, 'Procedural atlases cannot be applied to arbitrary model UVs');
  const before = changes.length;
  await act(async () => cards().find(button => button.getAttribute('aria-label') === 'Rallye terre')!.click());
  assert.equal(changes.length, before, 'Disabled cards cannot change custom-model relief');
  await act(async () => cards().find(button => button.getAttribute('aria-label') === 'Relief d’origine / importé')!.click());
  assert.equal(settings.mode, 'relief', 'Custom models retain access to imported relief');
  assert(!host.querySelector('.wheel-profile-depth'), 'Imported depth is not invented');
  console.log('✓ Pneus desktop : profils, profondeur 3D exacte, opt-out, transitions, reconstruction protégée et UV custom');
} finally {
  await act(async () => root.unmount()); host.remove();
}
