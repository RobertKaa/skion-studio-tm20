import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import JSZip from 'jszip';
import { setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { createMaterialDefinition, type MaterialDefinition, type MaterialLayer } from '../src/materials/types';
import { createMaterialLibrary, type MaterialLibraryStorage, type StoredMaterial } from '../src/materials/library';
import { getMaterialSourceCanvas, loadMaterialSources } from '../src/materials/render';
import type { UvGuideIsland } from '../src/uvGuideData';
import { WHEEL_PART_GUIDES } from '../src/wheelParts';

// The desktop DOM provides a real Canvas2D backend. Styles are checked in the desktop browser.
registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
} });
setEnv(getEnv());
const desktop = getEnv().window;
Object.defineProperty(desktop, 'innerWidth', { configurable: true, value: 1400 });
Object.defineProperty(desktop, 'innerHeight', { configurable: true, value: 900 });
Object.assign(globalThis, {
  React, document: getEnv().document, window: desktop,
  HTMLElement: desktop.HTMLElement, HTMLInputElement: desktop.HTMLInputElement,
  HTMLCanvasElement: desktop.HTMLCanvasElement, HTMLImageElement: desktop.HTMLImageElement,
  MouseEvent: desktop.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true,
});
const { createRoot } = await import('react-dom/client');
const { MaterialsPanel } = await import('../src/ui/MaterialsPanel');

const polygon = (left: number) => [[{ x: left, y: .1 }, { x: left + .15, y: .1 }, { x: left + .15, y: .3 }, { x: left, y: .3 }]];
const islands: UvGuideIsland[] = [
  { key: 'top', label: 'CAPOT', family: 'skin', polygons: polygon(.1) },
  { key: 'left', label: 'FLANC GAUCHE', family: 'skin', polygons: polygon(.35) },
  { key: 'right', label: 'FLANC DROIT', family: 'skin', polygons: polygon(.6) },
  { key: 'detail', label: 'COCKPIT', family: 'details', polygons: polygon(.1) },
];
const preciseRegions: UvGuideIsland[] = [
  { key: 'body:element:2', label: 'CAPOT · élément précis', family: 'skin', polygons: polygon(.15) },
  { key: 'body:element:7', label: 'BOUCHON · élément précis', family: 'skin', polygons: polygon(.7) },
];
const resolveRegion = (key: string) => [...islands, ...preciseRegions].find((island) => island.key === key)!;
const png = document.createElement('canvas'); png.width = png.height = 16;
const context = png.getContext('2d')!; context.fillStyle = '#d16c41'; context.fillRect(0, 0, 16, 16);
const source = png.toDataURL('image/png');
const makeFile = (name: string) => new File([Buffer.from(source.split(',')[1], 'base64')], name, { type: 'image/png' });
function scalarExrFile(name = 'simple_roughness.exr') {
  const uint = (value: number) => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  const attribute = (name: string, type: string, value: Buffer) => Buffer.concat([Buffer.from(`${name}\0${type}\0`), uint(value.length), value]);
  const imageWindow = Buffer.alloc(16);
  const channels = Buffer.concat([Buffer.from('Y\0'), uint(2), uint(0), uint(1), uint(1), Buffer.from([0])]);
  const header = Buffer.concat([Buffer.from([118, 47, 49, 1, 2, 0, 0, 0]), attribute('channels', 'chlist', channels),
    attribute('compression', 'compression', Buffer.from([0])), attribute('dataWindow', 'box2i', imageWindow), attribute('displayWindow', 'box2i', imageWindow),
    attribute('lineOrder', 'lineOrder', Buffer.from([0])), attribute('pixelAspectRatio', 'float', uint(0x3f800000)),
    attribute('screenWindowCenter', 'v2f', Buffer.alloc(8)), attribute('screenWindowWidth', 'float', uint(0x3f800000)), Buffer.from([0])]);
  const table = Buffer.alloc(8); table.writeUInt32LE(header.length + 8);
  const sample = Buffer.alloc(4); sample.writeFloatLE(.5);
  return new File([Buffer.concat([header, table, uint(0), uint(4), sample])], name, { type: 'image/x-exr' });
}
const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
let selectedRegion: UvGuideIsland | null = islands[0];
let selection: MaterialLayer | null = null;
let family: 'skin' | 'details' | 'wheels' = 'skin';
let disabled = false;
let instanceKey = 'initial';
const applications: { definition: MaterialDefinition; regions: string[]; exclusions: string[] }[] = [];
const changes: MaterialDefinition[] = [];
const masks: { regions: string[]; exclusions: string[] }[] = [];
const errors: string[] = [];
let commits = 0;
const volumeRequests:{definition:MaterialDefinition;regions:string[];exclusions:string[]}[]=[];
function draw() {
  root.render(<MaterialsPanel key={instanceKey} family={family} islands={islands} selectedRegion={selectedRegion} selection={selection} disabled={disabled}
    onApply={(definition, regions, exclusions) => applications.push({ definition, regions, exclusions })}
    onChange={(definition) => { changes.push(structuredClone(definition)); if (selection) { selection = { ...selection, definition }; draw(); } }}
    onChangeMask={(regions, exclusions) => {
      masks.push({ regions: [...regions], exclusions: [...exclusions] });
      if (selection) { selection = { ...selection, regions: regions.map(resolveRegion), exclusions: exclusions.map(resolveRegion) }; draw(); }
    }}
    onCommit={() => commits++} onError={(message) => errors.push(message)} onOpenRelief={(definition,regions,exclusions)=>volumeRequests.push({definition,regions,exclusions})} />);
}
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
function button(text: string) {
  const result = buttons().find((item) => item.textContent?.trim() === text);
  assert(result, `Button '${text}' is accessible by its visible label`); return result;
}
function labelled<T extends HTMLElement>(label: string) {
  const result = host.querySelector<T>(`[aria-label="${label}"]`);
  assert(result, `Accessible field '${label}' exists`); return result;
}
const click = (text: string) => act(async () => { button(text).click(); });
const changeSelect = (label: string, value: string) => act(async () => {
  const field = labelled<HTMLSelectElement>(label); field.value = value; field.dispatchEvent(new window.Event('change', { bubbles: true }));
});
const changeInput = (label: string, value: string) => act(async () => {
  const field = labelled<HTMLInputElement>(label);
  Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new window.Event('input', { bubbles: true })); field.dispatchEvent(new window.Event('change', { bubbles: true }));
});
function regionCheckbox(group: string, name: string) {
  const list = labelled<HTMLElement>(group);
  const result = [...list.querySelectorAll('label')].find((item) => item.textContent?.trim() === name)?.querySelector<HTMLInputElement>('input');
  assert(result, `Region '${name}' can be chosen in '${group}'`); return result;
}
async function chooseFile(inputLabel: string, file: File) {
  const input = labelled<HTMLInputElement>(inputLabel);
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  for (let attempt = 0; host.querySelector('[aria-busy="true"]') && attempt < 100; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  assert(!host.querySelector('[aria-busy="true"]'), 'File operation settles and returns control to the user');
  assert.equal(input.value, '', 'The same file can be selected again after importing');
}

try {
  await act(async () => draw());
  assert.equal(window.innerWidth, 1400, 'Visual interaction checks use desktop dimensions');
  assert.equal(host.querySelector<HTMLDetailsElement>('.materials-library-disclosure')!.open, true, 'New materials show the library immediately');
  const quality = labelled<HTMLSelectElement>('Qualité ZIP / EXR');
  assert.equal(quality.value, '2048', 'ZIP and EXR import default to a practical 2K quality');
  assert.deepEqual([...quality.options].map((option) => option.value), ['1024', '2048', '4096'], 'Users can choose import quality without installing extra software');
  assert(labelled<HTMLInputElement>('Importer des images ou un pack de matériau').accept.includes('.exr'));
  assert(labelled<HTMLInputElement>('Image pour le canal de matériau').accept.includes('.exr'), 'EXR sources can also be assigned to an existing material channel');
  assert(errors.some((error) => /bibliothèque locale.*indisponible/i.test(error)), 'Unavailable local storage is reported without blocking material creation');
  assert.equal(button('Ajouter le matériau').disabled, false);
  await click('Ajouter le matériau');
  assert.equal(applications.at(-1)!.definition.transform.projection,'surface','A new material follows the actual model rather than its flat atlas');
  assert.deepEqual(applications.at(-1)!.regions, ['top'], 'A new material can target exactly the UV piece selected by the user');

  await click('Plusieurs');
  await act(async () => { regionCheckbox('Pièces incluses', 'FLANC GAUCHE').click(); });
  assert(!labelled<HTMLElement>('Pièces incluses').textContent!.includes('COCKPIT'), 'An unrelated surface family is never offered in the mask');
  await act(async () => { regionCheckbox('Pièces exclues', 'FLANC DROIT').click(); });
  await click('Ajouter le matériau');
  assert.deepEqual(applications.at(-1)!.regions, ['top', 'left']);
  assert.deepEqual(applications.at(-1)!.exclusions, ['right'], 'Several pieces and exclusions are passed together');

  await click('Tout'); await click('Ajouter le matériau');
  assert.deepEqual(applications.at(-1)!.regions, [], 'Whole-surface material uses the explicit full-surface convention');
  assert.deepEqual(applications.at(-1)!.exclusions, ['right'], 'Changing scope retains the exclusions');
  selectedRegion = null; await act(async () => draw());
  assert(button('Cette pièce').disabled, 'Selecting one piece is unavailable until a UV piece is selected');

  const definition = createMaterialDefinition('carbon');
  definition.name = 'Carbone personnel';
  definition.textures.roughness = { src: source, name: 'roughness.png', component: 'luminance', invert: false };
  selectedRegion = islands[1]; selection = { definition, family: 'skin', regions: [islands[0]], exclusions: [islands[2]] };
  await act(async () => draw());
  const editLibrary = host.querySelector<HTMLDetailsElement>('.materials-library-disclosure')!;
  assert.equal(editLibrary.open, false, 'Selecting an existing material prioritizes its controls over the preset library');
  assert.equal(editLibrary.querySelector('summary')!.textContent, 'Changer ou importer un matériau');
  assert(host.querySelector('.material-current')!.compareDocumentPosition(editLibrary) & desktop.Node.DOCUMENT_POSITION_FOLLOWING, 'The selected material appears before the optional replacement library');
  assert(editLibrary.closest('[hidden]'),'The optional library stays behind its own workspace tab while the selected material controls are shown');
  assert(host.textContent!.includes('Sa couleur et ses finitions se règlent ensemble.'));
  const legacySources=structuredClone(selection!.definition.textures);
  await click('Suivre la surface 3D');
  assert.equal(selection!.definition.transform.projection,'surface','A restored UV material can explicitly switch to surface following');
  assert.deepEqual(selection!.definition.textures,legacySources,'Switching to surface following retains the original sources');
  assert.deepEqual(selection!.regions.map(region=>region.key),['top']);
  assert.deepEqual(selection!.exclusions.map(region=>region.key),['right']);
  await act(async () => editLibrary.querySelector('summary')!.click());
  assert.equal(editLibrary.open, true, 'The optional library stays available through an accessible native disclosure');
  assert.equal(labelled<HTMLInputElement>('Nom du matériau').value, 'Carbone personnel', 'Opening the library preserves the selected material’s draft');
  const masksBeforePreset = masks.length;
  await click('Métal brossé');
  assert.equal(selection!.definition.preset, 'brushed');
  assert.deepEqual(selection!.regions.map((region) => region.key), ['top']);
  assert.deepEqual(selection!.exclusions.map((region) => region.key), ['right']);
  assert.equal(masks.length, masksBeforePreset, 'Choosing a preset replaces only its material, preserving the existing mask');
  assert(button('Créer un calque séparé'), 'Creating another layer is an explicit action while a material is selected');
  const appliedBeforeEdit = applications.length;
  await changeInput('Rotation', '37');
  await changeInput('Rugosité', '91');
  assert.equal(selection!.definition.transform.angle, 37, 'An accessible placement slider edits the selected material');
  assert.equal(selection!.definition.roughness, 91);
  assert.equal(applications.length, appliedBeforeEdit, 'Editing an existing material does not add unintended layers');
  await changeSelect('Alignement de la matière', 'top');
  assert.equal(selection!.definition.transform.projection, 'top');
  assert.deepEqual(selection!.regions.map(region=>region.key), ['top']);
  assert.deepEqual(selection!.exclusions.map(region=>region.key), ['right']);
  assert.equal(applications.length, appliedBeforeEdit, 'Changing the 3D alignment edits the existing owner');
  await changeSelect('Alignement de la matière', 'uv');
  assert.equal(selection!.definition.transform.projection, 'uv', 'Existing atlas artworks can retain their UV placement');
  await changeSelect('Alignement de la matière', 'surface');
  assert.equal(selection!.definition.transform.projection,'surface');
  assert(host.textContent!.includes('Le motif accompagne les courbes de la pièce'));
    assert(host.textContent!.includes('en préservant ses proportions'));
    assert.equal((Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Étirer') as HTMLButtonElement).disabled,true,'Surface placement cannot stretch the source image independently along either axis');
  assert(host.textContent!.includes('Projection sur 3 axes') && !host.textContent!.includes('envelopper en 3D'), 'The old blended projection no longer claims to follow the surface');
  assert.deepEqual(selection!.regions.map(region=>region.key),['top'],'Surface alignment retains the editable piece mask');

  await click('Cette pièce');
  assert.deepEqual(masks.at(-1), { regions: ['left'], exclusions: ['right'] });
  assert.equal(button('Cette pièce').getAttribute('aria-pressed'), 'true', 'Parent mask updates retain the mode selected by the user');
  await click('Tout'); assert.deepEqual(masks.at(-1)!.regions, []);
  await click('Plusieurs'); await act(async () => regionCheckbox('Pièces incluses', 'CAPOT').click());
  assert.deepEqual(masks.at(-1)!.regions, ['left', 'top']);
  await act(async () => regionCheckbox('Pièces exclues', 'FLANC DROIT').click());
  assert.deepEqual(masks.at(-1)!.exclusions, []);
  assert(commits > 0, 'Mask and preset actions close the editable history gesture');

  await changeInput('Nom du matériau', 'Métal personnalisé');
  await click('Mes matériaux'); await click('Prêts à utiliser');
  assert.equal(labelled<HTMLInputElement>('Nom du matériau').value, 'Métal personnalisé', 'Switching library tabs does not reset text edits');
  await changeInput('Nom du matériau', '');
  assert.equal(selection!.definition.name, 'Métal personnalisé', 'An empty draft name never invalidates the live material');
  assert(button('Créer un calque séparé').disabled, 'An incomplete name cannot create an invalid material');
  await act(async () => labelled<HTMLInputElement>('Nom du matériau').dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })));
  assert.equal(labelled<HTMLInputElement>('Nom du matériau').value, 'Métal personnalisé', 'Blurring an empty name restores the last valid name');

  await changeSelect('Ajouter une image à un canal', 'roughness');
  await chooseFile('Image pour le canal de matériau', makeFile('actual_roughness.png'));
  assert.equal(selection!.definition.textures.roughness?.name, 'actual_roughness.png');
  assert.equal(selection!.definition.transform.angle, 37);
  assert.equal(selection!.definition.roughness, 255, 'Adding the first roughness image preserves its native values at 100 percent');
  assert(labelled<HTMLInputElement>('Rugosité · image').closest('label')!.title.includes('100 % conserve les valeurs'), 'Texture strength explains how its percentage affects the image');
  assert.equal(selection!.definition.name, 'Métal personnalisé', 'Adding an image keeps existing placement, finish and naming edits');
  await changeInput('Rugosité · image', '91');
  await click('Remplacer');
  await chooseFile('Image pour le canal de matériau', makeFile('replacement_roughness.png'));
  assert.equal(selection!.definition.roughness, 91, 'Replacing a roughness source preserves the user’s edited image strength');
  await changeSelect('Affectation de replacement_roughness.png', 'dirt');
  assert(!selection!.definition.textures.roughness);
  assert.equal(selection!.definition.textures.dirt?.name, 'replacement_roughness.png', 'The user can correct the detected role without duplicating or losing the source');
  await changeSelect('Composante de Salissure', 'b');
  const invert = [...host.querySelectorAll('label')].find((label) => label.textContent?.trim() === 'Inverser')!.querySelector<HTMLInputElement>('input')!;
  await act(async () => invert.click());
  assert.equal(selection!.definition.textures.dirt?.component, 'b');
  assert.equal(selection!.definition.textures.dirt?.invert, true);
  assert.equal(selection!.definition.transform.angle, 37, 'Changing channel interpretation retains the shared texture placement');
  await changeSelect('Affectation de replacement_roughness.png', 'metalness');
  assert.equal(selection!.definition.metalness, 255, 'Reassigning a source to a new metalness channel starts at full image strength');
  await changeInput('Métal · image', '45');
  await changeSelect('Affectation de replacement_roughness.png', 'dirt');
  await changeSelect('Ajouter une image à un canal', 'color');
  await chooseFile('Image pour le canal de matériau', makeFile('photo_albedo.png'));
  assert.equal(selection!.definition.color, '#ffffff', 'The first color image is shown with its original colors');
  assert.equal(selection!.definition.textures.dirt?.component, 'b', 'Importing another channel preserves existing image interpretation');
  await click('Remplacer');
  await chooseFile('Image pour le canal de matériau', makeFile('replacement_albedo.png'));
  assert.equal(selection!.definition.roughness, 91, 'Replacing the color image keeps the edited roughness factor');
  assert.equal(selection!.definition.metalness, 45, 'Replacing the color image keeps the edited metallic factor');

  const editedLayer = selection;
  await changeSelect('Ajouter une image à un canal', 'roughness');
  const unrelated = createMaterialDefinition('fabric'); unrelated.name = 'Autre calque';
  selection = { definition: unrelated, family: 'skin', regions: [], exclusions: [] };
  await act(async () => draw());
  const changesBeforeReturningPicker = changes.length;
  await chooseFile('Image pour le canal de matériau', makeFile('picked_roughness.png'));
  assert.equal(changes.length, changesBeforeReturningPicker, 'A file picker opened for one layer cannot redirect its image to another selected layer');
  assert.equal(selection!.definition.name, 'Autre calque');
  assert.equal(Object.keys(selection!.definition.textures).length, 0);
  assert(host.textContent!.includes('Import annulé'), 'Cancelled stale imports explain the changed context to the user');
  selection = editedLayer; await act(async () => draw());

  const errorCount = errors.length;
  await click('Enregistrer une variante');
  assert(errors.length > errorCount && errors.at(-1)!.includes('bibliothèque locale'), 'A save failure is visible through the application error callback');
  assert.equal(button('Créer un calque séparé').disabled, false, 'A storage error leaves material editing available');

  await chooseFile('Importer des images ou un pack de matériau', new File(['invalid'], 'malicious.svg', { type: 'image/svg+xml' }));
  assert(/PNG.*(?:JPEG|JPG).*WebP/i.test(errors.at(-1)!), 'Unsupported file input is rejected with an actionable message');
  assert.equal(selection!.definition.textures.color?.name, 'replacement_albedo.png', 'A failed import retains the current material');

  const normalDefinition = createMaterialDefinition('rubber'); normalDefinition.textures.normal = { src: source, name: 'normal.png', component: 'luminance', invert: false };
  selection = { definition: normalDefinition, family: 'skin', regions: [], exclusions: [] }; await act(async () => draw());
  assert(host.textContent!.includes('export standard sans normales personnalisées'), 'A body normal source clearly distinguishes the prototype from standard game export');
  assert.equal(labelled<HTMLInputElement>('Intensité des détails').disabled, false, 'Body normals have an editable strength for the workshop');
  assert.equal(labelled<HTMLSelectElement>('Affectation de normal.png').disabled, false, 'A body normal channel remains editable instead of trapping the imported source');
  assert.equal([...labelled<HTMLSelectElement>('Ajouter une image à un canal').options].find(option => option.value === 'height')!.disabled, false, 'Height can be imported without Blender or another installation');
  assert.equal(button('Créer un calque séparé').disabled, false, 'A normal map never blocks applying the rest of a material to the body');
  family = 'details'; selection = { ...selection!, family }; selectedRegion = islands[3]; await act(async () => draw());
  assert.equal(labelled<HTMLInputElement>('Intensité des détails').disabled, false, 'A supported surface with a normal image exposes an active strength control');
  const withNormal = selection;
  selection = { ...selection!, definition: createMaterialDefinition('fabric') }; await act(async () => draw());
  assert.equal(labelled<HTMLInputElement>('Intensité des détails').disabled, true, 'A preset without a normal image cannot expose an ineffective active slider');
  assert(host.textContent!.includes('Ajoutez une image de normales ou de hauteur'), 'Missing normal images have an actionable explanation');
  selection = withNormal; await act(async () => draw());
  disabled = true; await act(async () => draw());
  assert(button('Créer un calque séparé').disabled, 'Busy/editor-disabled state blocks accidental layer creation');
  assert(labelled<HTMLSelectElement>('Qualité ZIP / EXR').disabled, 'Import settings cannot change while the editor is disabled');
  assert(labelled<HTMLInputElement>('Importer des images ou un pack de matériau').disabled);
  assert(labelled<HTMLInputElement>('Image pour le canal de matériau').disabled);

  disabled = false; family = 'skin'; selectedRegion = preciseRegions[0]; selection = null;
  await act(async () => draw());
  assert.equal(host.querySelector<HTMLDetailsElement>('.materials-library-disclosure')!.open, true, 'Returning to new-material creation reopens the library');
  await click('Ajouter le matériau');
  assert.deepEqual(applications.at(-1)!.regions, ['body:element:2']);
  selection = { definition: applications.at(-1)!.definition, family: 'skin', regions: [preciseRegions[0]], exclusions: [] };
  await act(async () => draw());
  assert.equal(button('Cette pièce').getAttribute('aria-pressed'), 'true', 'Creating a material on a precise selected element keeps the matching single-piece scope');
  assert(host.querySelector('.material-zone-summary')!.textContent!.includes('CAPOT · élément précis'), 'The applied precise element remains named in the material summary');

  selectedRegion = null; selection = { ...selection!, exclusions: [preciseRegions[1]] }; instanceKey = 'restored-project';
  await act(async () => draw());
  assert.equal(button('Plusieurs').getAttribute('aria-pressed'), 'true');
  assert.equal(regionCheckbox('Pièces incluses', 'CAPOT · élément précis').checked, true, 'Reloading a precise element absent from the parent guide retains its checked mask entry');
  assert.equal(regionCheckbox('Pièces exclues', 'BOUCHON · élément précis').checked, true, 'Reloading also retains precise exclusions absent from the guide');
  await act(async () => regionCheckbox('Pièces exclues', 'BOUCHON · élément précis').click());
  assert.deepEqual(masks.at(-1)!.exclusions, []);
  await act(async () => regionCheckbox('Pièces incluses', 'CAPOT').click());
  await act(async () => regionCheckbox('Pièces incluses', 'CAPOT · élément précis').click());
  assert.deepEqual(masks.at(-1)!.regions, ['top'], 'A restored precise mask entry can be replaced and removed through the normal piece checklist');
  await changeSelect('Ajouter une image à un canal', 'roughmetal');
  await chooseFile('Image pour le canal de matériau', makeFile('combined_R.png'));
  assert.equal(selection!.definition.roughness, 255);
  assert.equal(selection!.definition.metalness, 255, 'A combined map initializes both image factors at full strength');
  await changeSelect('Ajouter une image à un canal', 'coat');
  await chooseFile('Image pour le canal de matériau', makeFile('varnish_coat.png'));
  assert.equal(selection!.definition.coat, 255, 'The first varnish image starts at full intensity');
  assert(labelled<HTMLInputElement>('Vernis · image').closest('label')!.title.includes('100 % conserve les valeurs'));
  await changeInput('Vernis · image', '77');
  await act(async () => labelled<HTMLSelectElement>('Affectation de varnish_coat.png').closest('.material-source')!.querySelector<HTMLButtonElement>('button')!.click());
  await chooseFile('Image pour le canal de matériau', makeFile('replacement_coat.png'));
  assert.equal(selection!.definition.coat, 77, 'Replacing varnish retains its edited image intensity');
  await changeSelect('Affectation de replacement_coat.png', 'dirt');
  assert.equal(selection!.definition.dirt, 255, 'Reassigning an image to salissure starts at full intensity');
  assert(labelled<HTMLInputElement>('Salissure · image').closest('label')!.title.includes('100 % conserve les valeurs'));
  await changeInput('Salissure · image', '97');
  await act(async () => labelled<HTMLSelectElement>('Affectation de replacement_coat.png').closest('.material-source')!.querySelector<HTMLButtonElement>('button')!.click());
  await chooseFile('Image pour le canal de matériau', makeFile('replacement_dirt.png'));
  assert.equal(selection!.definition.dirt, 97, 'Replacing dirt retains its edited image intensity');
  await changeSelect('Affectation de replacement_dirt.png', 'coat');
  assert.equal(selection!.definition.coat, 255, 'Reassigning an image to varnish starts at full intensity');
  await changeSelect('Ajouter une image à un canal', 'dirt');
  await chooseFile('Image pour le canal de matériau', makeFile('fresh_dirt.png'));
  assert.equal(selection!.definition.dirt, 255, 'Adding a fresh dirt image starts at full intensity');
  const normalConvention = labelled<HTMLInputElement>('Normal DirectX (Y inversé)');
  assert.equal(normalConvention.checked, false, 'Normal maps use OpenGL by default');
  assert(host.textContent!.includes('OpenGL par défaut'));
  assert.equal(host.querySelector('[aria-label="Composante de Normales"]'), null, 'Normal maps expose a convention switch without scalar component interpretation');
  await act(async () => normalConvention.click());
  assert.equal(selection!.definition.textures.normal!.invert, true, 'DirectX convention is stored as the normal green-channel inversion');
  await act(async () => normalConvention.click());
  assert.equal(selection!.definition.textures.normal!.invert, false, 'The normal convention can be switched back to OpenGL');

  const archiveImage = document.createElement('canvas'); archiveImage.width = 1536; archiveImage.height = 16;
  archiveImage.getContext('2d')!.fillStyle = '#756657'; archiveImage.getContext('2d')!.fillRect(0, 0, 1536, 16);
  const archive = new JSZip();
  archive.file('document.blend', 'BLENDER-v304');
  archive.file('sample_color.png', Buffer.from(archiveImage.toDataURL('image/png').split(',')[1], 'base64'));
  archive.file('sample_displacement.png', Buffer.from(source.split(',')[1], 'base64'));
  const archiveBytes = await archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const zipFile = new File([archiveBytes], 'sample_blender.zip', { type: 'application/zip' });
  const retainedMask = { regions: selection!.regions.map((region) => region.key), exclusions: selection!.exclusions.map((region) => region.key) };
  await changeSelect('Qualité ZIP / EXR', '1024');
  await click('Importer des images ou un pack');
  const errorsBeforeArchive = errors.length;
  await chooseFile('Importer des images ou un pack de matériau', zipFile);
  assert.equal(errors.length, errorsBeforeArchive, `A supported Blender ZIP imports successfully: ${errors.at(-1) ?? ''}`);
  const importedColor = selection!.definition.textures.color;
  assert(importedColor, 'A Blender ZIP can supply its color image directly to the selected material');
  assert.equal(Buffer.from(importedColor.src.split(',')[1], 'base64').readUInt32BE(16), 1024, 'The selected ZIP quality is passed to the import pipeline');
  assert.deepEqual({ regions: selection!.regions.map((region) => region.key), exclusions: selection!.exclusions.map((region) => region.key) }, retainedMask, 'Importing a ZIP into an existing material preserves its selected UV mask');
  const report = labelled<HTMLDetailsElement>('Informations d’import');
  assert.equal(report.getAttribute('role'), 'status');
  assert.equal(report.getAttribute('aria-live'), 'polite');
  assert.equal(report.open, false, 'Import notices stay collapsed so the material controls remain easy to reach');
  assert(report.querySelector('summary')!.textContent!.includes('Import terminé · voir le détail'));
  assert(report.querySelector('.materials-import-count')!.textContent!.includes('2 images'), 'The collapsed report counts actual color and height sources');
  await act(async () => report.querySelector('summary')!.click());
  assert.equal(report.open, true, 'The import report can be expanded through its native accessible disclosure');
  assert(report.querySelectorAll('li').length >= 2, 'Import notices are shown as readable individual items');
  assert(/\.blend.*ignor|ignor.*\.blend/i.test(report.textContent!), 'The ZIP report explains that the Blender document was ignored');
  assert(/hauteur conservée.*Textures et relief/i.test(report.textContent!), 'The ZIP report explains height retention for the relief workshop');
  assert.equal(selection!.definition.textures.height!.name, 'sample_displacement.png', 'A Blender height map remains available after importing the whole pack');
  assert(host.textContent!.includes('Clair : bosses ; sombre : creux.'), 'The height channel explains its numeric meaning');
  await changeSelect('Composante de Hauteur / déplacement', 'r');
  assert.equal(selection!.definition.textures.height!.component, 'r');
  await changeSelect('Qualité ZIP / EXR', '4096');
  await click('Importer des images ou un pack');
  await chooseFile('Importer des images ou un pack de matériau', zipFile);
  assert.equal(Buffer.from(selection!.definition.textures.color!.src.split(',')[1], 'base64').readUInt32BE(16), 1536, 'Choosing 4K preserves an original source whose size fits that quality');
  await changeSelect('Ajouter une image à un canal', 'roughness');
  await chooseFile('Image pour le canal de matériau', scalarExrFile());
  assert(selection!.definition.textures.roughness!.src.startsWith('data:image/png;base64,'), 'An EXR channel becomes an editable local image');
  assert.equal(selection!.definition.textures.color!.name, importedColor.name, 'Importing EXR into one channel preserves the color image');
  const exrReport = labelled<HTMLDetailsElement>('Informations d’import');
  await act(async () => { if (!exrReport.open) exrReport.querySelector('summary')!.click(); });
  assert(/EXR/i.test(exrReport.textContent!) && /8\s*bits/i.test(exrReport.textContent!), 'The channel import report explains the EXR conversion to eight-bit maps');
  assert.deepEqual({ regions: selection!.regions.map((region) => region.key), exclusions: selection!.exclusions.map((region) => region.key) }, retainedMask, 'Adding an EXR channel keeps the existing material mask');
  await act(async () => labelled<HTMLSelectElement>('Affectation de simple_roughness.exr').closest('.material-source')!.querySelector<HTMLButtonElement>('button')!.click());
  await chooseFile('Image pour le canal de matériau', scalarExrFile('texture.exr'));
  assert.equal(selection!.definition.textures.roughness!.name, 'texture.exr');
  await act(async () => { await loadMaterialSources(selection!.definition); });
  const numericExr = getMaterialSourceCanvas(selection!.definition.textures.roughness!.src)!;
  assert.equal(numericExr.getContext('2d')!.getImageData(0, 0, 1, 1).data[0], 128, 'An EXR assigned explicitly to roughness preserves 0.5 as 128 even when its filename has no recognized role');
  await act(async () => labelled<HTMLSelectElement>('Affectation de sample_displacement.png').closest('.material-source')!.querySelector<HTMLButtonElement>('button')!.click());
  await chooseFile('Image pour le canal de matériau', scalarExrFile('height_input.exr'));
  assert.equal(selection!.definition.textures.height!.name, 'height_input.exr');
  await act(async () => { await loadMaterialSources(selection!.definition); });
  const heightExr = getMaterialSourceCanvas(selection!.definition.textures.height!.src)!;
  assert.equal(heightExr.getContext('2d')!.getImageData(0, 0, 1, 1).data[0], 128, 'An EXR assigned to height remains numeric data with no sRGB correction');
  const heightReport = labelled<HTMLDetailsElement>('Informations d’import');
  assert(heightReport.textContent!.includes('sans correction de couleur'));
  // A lone photo used to choose a top projection, even for vertical Details
  // and Wheels. Every Materials import must enter the geometry-based path.
  for(const surface of ['skin','details','wheels'] as const) {
    family=surface;selectedRegion=null;
    selection={definition:createMaterialDefinition('solid'),family,regions:[],exclusions:[]};
    instanceKey=`surface-image-${surface}`;await act(async()=>draw());
    await click('Importer des images ou un pack');
    await chooseFile('Importer des images ou un pack de matériau',makeFile('my_texture.png'));
    assert.equal(selection!.definition.transform.projection,'surface',`A standalone texture follows ${surface} geometry automatically`);
    assert.equal(selection!.definition.transform.mode,'repeat','A Materials texture repeats at a physical scale rather than projecting a photograph from above');
    assert.equal(selection!.definition.textures.color!.src,source,'The original image is retained');
    assert(host.querySelector('.material-surface-follow.is-active'),'The active 3D surface placement is visible near the material controls');
  }
  islands.push(...WHEEL_PART_GUIDES);family='wheels';selection=null;selectedRegion=WHEEL_PART_GUIDES[1];instanceKey='wheel-flank';await act(async()=>draw());
  assert.equal(labelled<HTMLSelectElement>('Alignement de la matière').value,'wheel-face','A named sidewall starts with the circular face placement');
  assert(button('Étirer').disabled,'The wheel placement cannot stretch the source format');
  await changeSelect('Alignement de la matière','wheel');assert(host.textContent!.includes('raccorder le motif après un tour'));
  selectedRegion=WHEEL_PART_GUIDES[0];instanceKey='wheel-tread';await act(async()=>draw());
  assert.equal(labelled<HTMLSelectElement>('Alignement de la matière').value,'wheel','The tread starts with physical 360 degree wrapping');
  family='skin';selectedRegion=islands[0];instanceKey='height-workflow';const heightDefinition=createMaterialDefinition();heightDefinition.surfaceOnly=true;heightDefinition.textures.height={src:source,name:'height.png',component:'r',invert:false};selection={definition:heightDefinition,family,regions:[islands[0]],exclusions:[islands[2]]};await act(async()=>draw());
  assert.equal(labelled<HTMLInputElement>('Niveau neutre').value,'0.5');await changeInput('Niveau neutre','0.3');assert.equal(selection!.definition.surfaceRelief!.midpoint,.3);
  await click('Préparer le volume 3D');assert.equal(volumeRequests.length,1);assert.equal(volumeRequests[0].definition.surfaceRelief!.midpoint,.3);assert.deepEqual(volumeRequests[0].regions,['top']);assert.deepEqual(volumeRequests[0].exclusions,['right']);
  const normalImage=document.createElement('canvas');normalImage.width=normalImage.height=64;const normalContext=normalImage.getContext('2d')!,normalPixels=normalContext.createImageData(64,64);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const nx=.5*Math.sin(x/64*2*Math.PI);normalPixels.data.set([128+nx*127,128,128+Math.sqrt(1-nx*nx)*127,255],(y*64+x)*4);}normalContext.putImageData(normalPixels,0,0);
  const normalPng=normalImage.toDataURL();selection={...selection!,definition:{...createMaterialDefinition(),surfaceOnly:true,textures:{normal:{src:normalPng,name:'normalmap.png',component:'r',invert:false}}}};await act(async()=>draw());
  assert(button('Préparer le volume 3D').disabled,'Normal-only sources need a height before preparing geometry');await click('Estimer une hauteur depuis les normales');
  for(let attempt=0;host.querySelector('[aria-busy="true"]')&&attempt<200;attempt++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
  assert(selection!.definition.textures.height,'The explicit normal integration creates a usable height source');assert.equal(selection!.definition.surfaceRelief!.heightOrigin,'normal-estimate');assert.equal(selection!.definition.textures.normal!.src,normalPng);assert(!button('Préparer le volume 3D').disabled);
} finally { await act(async () => root.unmount()); host.remove(); }

// Exercise the durable library rules through its storage boundary: no browser installation needed.
let records: StoredMaterial[] = [];
const storage: MaterialLibraryStorage = { async transaction(mode, action) {
  const result = action(structuredClone(records)); if (mode === 'readwrite') records = structuredClone(result.records); return result.value;
} };
const library = createMaterialLibrary(storage, { count: 2, bytes: 128 * 1024 });
const first = await library.saveMaterial(createMaterialDefinition('carbon'));
const second = await library.saveMaterial(createMaterialDefinition('brushed'));
await library.setMaterialFavorite(first.id, true);
assert.equal((await library.listMaterials())[0].id, first.id, 'Favoriting a material brings it to the front of the personal library');
assert.equal((await library.listMaterials())[0].favorite, true);
await library.setMaterialFavorite(first.id, false);
assert.equal((await library.listMaterials()).find((item) => item.id === first.id)!.favorite, false);
await assert.rejects(library.saveMaterial(createMaterialDefinition('rubber')), /limitée/);
assert.equal((await library.listMaterials()).length, 2, 'A quota failure preserves the existing variants');
await library.removeMaterial(second.id);
await assert.rejects(library.setMaterialFavorite(second.id, true), /n’existe plus/);
assert.equal((await library.listMaterials()).length, 1);
console.log('✓ Matériaux UI desktop : sélection UV, plusieurs pièces, surface entière, exclusions, presets et édition sans perdre le masque, sources/canaux, noms et placement préservés, erreurs import/stockage, favoris, relief et contrôles accessibles');
