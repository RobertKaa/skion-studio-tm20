import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { MAPS } from '../src/maps';
import { hydrateProject, projectLayerCount, readProjectFile, validateProjectDocument, validateProjectPng, writeProjectFile, type ProjectDocument } from '../src/projectFile';

const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
const document: ProjectDocument = { format: 'tm-skin-studio', version: 1, name: 'Essai local',
  editor: { maps: Object.fromEntries(MAPS.map((def) => [def.id, { objects: [], background: def.defaultFill }])) as ProjectDocument['editor']['maps'], speedColor: '#ffffff', illumRole: 'head' },
  workspace: { activeMap: 'Skin_B', view: '3d', camera: { position: [3, 2, 4], target: [0, .5, 0] }, coatIntensity: .7, neonIntensity: 2.1, night: true, braking: false }, model: null };
document.editor.maps.Skin_B.objects = [{ type: 'Image', id: 'logo', name: 'Logo Chrome', src: 'assets/image-0.png', visible: true, selectable: true,
  imageMaterialEnabled: true, imageMaterial: { roughness: 8, metalness: 255 },
  imageLight: { role: 'head', strength: .65 }, imageLightEnabled: false,
  decal: { source: 'assets/image-0.png', center: [0, 1, 0], normal: [0, 1, 0], tangent: [1, 0, 0], width: 1, height: .5, depth: .8, angle: 192, families: ['skin', 'details'], material: { roughness: 8, metalness: 255 } } },
  { type: 'Group', name: 'Groupe', layoutManager: { type: 'layoutManager', strategy: 'fit-content' }, objects: [{ type: 'Rect', fill: '#00ffaa', left: 50, top: 80 }], clipPath: { type: 'Polygon', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 40 }] } }];
document.editor.maps.Details_I.objects = [{ type: 'Path', illumRole: 'brake', stroke: '#ff0000', path: [['M', 0, 0], ['L', 30, 20]] }, { type: 'Group', name: 'Vitesse', objects: [] }];
const file = await writeProjectFile({ document, assets: new Map([['assets/image-0.png', png]]) });
const restored = await readProjectFile(file);
assert.deepEqual(restored.document, document, 'Tous les canaux, objets, masques, rôles et paramètres de projection restent éditables');
assert.deepEqual(restored.assets.get('assets/image-0.png'), png, 'L’image originale est contenue dans le fichier');
assert.equal(projectLayerCount(document), 3, 'Les fragments dérivés et le compteur système ne gonflent pas le nombre de calques');
const hydrated = hydrateProject(restored);
const logo = (hydrated.document.editor.maps.Skin_B.objects as Record<string, unknown>[])[0];
assert.ok(String(logo.src).startsWith('blob:'));
assert.equal((logo.decal as Record<string, unknown>).source, logo.src, 'Source et maître utilisent la même ressource du projet');
assert.deepEqual(new Uint8Array(await (await fetch(String(logo.src))).arrayBuffer()), png);
hydrated.urls.forEach((url) => URL.revokeObjectURL(url));
assert.equal((document.editor.maps.Skin_B.objects as Record<string, unknown>[])[0].src, 'assets/image-0.png', 'L’hydratation ne modifie pas le manifeste');
const custom = structuredClone(document);
custom.model = { mesh: 'assets/mesh.gbx', preview: 'assets/preview.glb', name: 'Voiture custom', passthrough: [{ name: 'Auxiliary.gbx', asset: 'assets/extra-0.bin' }] };
const binaries = new Map([['assets/image-0.png', png], ['assets/mesh.gbx', new Uint8Array([1, 2, 3])], ['assets/preview.glb', new Uint8Array([4, 5, 6])], ['assets/extra-0.bin', new Uint8Array([7, 8])]]);
const customHydrated = hydrateProject(await readProjectFile(await writeProjectFile({ document: custom, assets: binaries })));
assert.deepEqual(customHydrated.model!.mesh, binaries.get('assets/mesh.gbx'));
assert.deepEqual(new Uint8Array(customHydrated.model!.preview!), binaries.get('assets/preview.glb'));
assert.deepEqual(customHydrated.model!.passthrough[0].data, binaries.get('assets/extra-0.bin'));
customHydrated.urls.forEach((url) => URL.revokeObjectURL(url));
const badImage = structuredClone(custom); (badImage.editor.maps.Skin_B.objects as Record<string, unknown>[])[0].src = 'assets/mesh.gbx';
assert.throws(() => validateProjectDocument(badImage, new Set(binaries.keys())), /image invalide/);
const badVector = structuredClone(document); ((badVector.editor.maps.Skin_B.objects as Record<string, unknown>[])[0].decal as Record<string, unknown>).normal = ['x', 0, 0];
assert.throws(() => validateProjectDocument(badVector, new Set(['assets/image-0.png'])), /incomplète/);
const badObjects = structuredClone(document); badObjects.editor.maps.Skin_R.objects = [null];
assert.throws(() => validateProjectDocument(badObjects, new Set(['assets/image-0.png'])), /calque invalide/);
const invalid = structuredClone(document); invalid.version = 99 as 1;
assert.throws(() => validateProjectDocument(invalid, new Set(['assets/image-0.png'])), /version/);
const external = structuredClone(document); (external.editor.maps.Skin_B.objects as Record<string, unknown>[])[0].src = 'https://example.com/image.png';
assert.throws(() => validateProjectDocument(external, new Set(['assets/image-0.png'])), /absent/);
const malicious = JSON.parse(JSON.stringify(document).replace('"id":"logo"', '"__proto__":{"polluted":true},"id":"logo"'));
assert.throws(() => validateProjectDocument(malicious, new Set(['assets/image-0.png'])), /interdite/);
assert.equal(({} as Record<string, unknown>).polluted, undefined);
const missing = structuredClone(document); delete (missing.editor.maps as Partial<ProjectDocument['editor']['maps']>).Wheels_R;
assert.throws(() => validateProjectDocument(missing, new Set(['assets/image-0.png'])), /manquantes/);
const badRole = structuredClone(document); (badRole.editor.maps.Details_I.objects as Record<string, unknown>[])[0].illumRole = 'script';
assert.throws(() => validateProjectDocument(badRole, new Set(['assets/image-0.png'])), /lumineux/);
const badImageLight = structuredClone(document); (badImageLight.editor.maps.Skin_B.objects as Record<string, unknown>[])[0].imageLight = { role: 'head', strength: 999 };
assert.throws(() => validateProjectDocument(badImageLight, new Set(['assets/image-0.png'])), /lumière d’image/);
for (const imageLight of [{ role: 'script', strength: 1 }, { role: 'always', strength: NaN }]) {
  const invalidLight = structuredClone(document); (invalidLight.editor.maps.Skin_B.objects as Record<string, unknown>[])[0].imageLight = imageLight;
  assert.throws(() => validateProjectDocument(invalidLight, new Set(['assets/image-0.png'])), /lumière d’image/);
}
const badLightFlag = structuredClone(document); (badLightFlag.editor.maps.Skin_B.objects as Record<string, unknown>[])[0].imageLightEnabled = 'yes';
assert.throws(() => validateProjectDocument(badLightFlag, new Set(['assets/image-0.png'])), /lumière d’image/);
const badPng = new Uint8Array(png); new DataView(badPng.buffer).setUint32(16, 50_000);
assert.throws(() => validateProjectPng(badPng), /grande/);
assert.throws(() => validateProjectPng(new Uint8Array(0)), /PNG/);
const bigPngHeader = new Uint8Array(png); new DataView(bigPngHeader.buffer).setUint32(16, 4096); new DataView(bigPngHeader.buffer).setUint32(20, 8192);
await assert.rejects(writeProjectFile({ document, assets: new Map(Array.from({ length: 3 }, (_, i) => [`assets/image-${i}.png`, bigPngHeader])) }), /images trop volumineuses/);
const tooDeep = structuredClone(document); let nested: Record<string, unknown> = tooDeep.editor.maps.Skin_B;
for (let i = 0; i < 45; i++) { nested.next = {}; nested = nested.next as Record<string, unknown>; }
assert.throws(() => validateProjectDocument(tooDeep, new Set(['assets/image-0.png'])), /complexe/);
const unexpected = new JSZip(); unexpected.file('project.json', JSON.stringify(document)); unexpected.file('../evil.png', png);
await assert.rejects(readProjectFile(new Blob([await unexpected.generateAsync({ type: 'arraybuffer' })])), /inattendu/);
const oversized = new JSZip(); oversized.file('project.json', ' '.repeat(8 * 1024 * 1024 + 1));
await assert.rejects(readProjectFile(new Blob([await oversized.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })])), /volumineuse/);
console.log('✓ Projet : archive complète, originaux PNG, projection/matière, groupes, rôles lumineux, URLs locales, limites et entrées malveillantes');

const legacy = structuredClone(document);
delete (legacy.editor.maps as Partial<ProjectDocument['editor']['maps']>).Skin_I;
delete (legacy.editor.maps as Partial<ProjectDocument['editor']['maps']>).Wheels_I;
delete (legacy.editor.maps as Partial<ProjectDocument['editor']['maps']>).Details_DirtMask;
delete (legacy.editor.maps as Partial<ProjectDocument['editor']['maps']>).Wheels_DirtMask;
const oldZip = new JSZip(); oldZip.file('project.json', JSON.stringify(legacy)); oldZip.file('assets/image-0.png', png);
const upgraded = await readProjectFile(new Blob([await oldZip.generateAsync({ type: 'arraybuffer' })]));
assert.equal(Object.keys(upgraded.document.editor.maps).length, MAPS.length);
assert.deepEqual(upgraded.document.editor.maps.Skin_B, document.editor.maps.Skin_B, 'Migration sans altérer les images, calques ou matière du projet existant');
assert.equal(upgraded.document.editor.maps.Skin_I.background, '#000000');
assert.deepEqual(upgraded.document.editor.maps.Wheels_I.objects, []);
assert.equal(upgraded.document.editor.maps.Details_DirtMask.background, '#000000');
const elevenMaps = structuredClone(document);
delete (elevenMaps.editor.maps as Partial<ProjectDocument['editor']['maps']>).Details_DirtMask;
delete (elevenMaps.editor.maps as Partial<ProjectDocument['editor']['maps']>).Wheels_DirtMask;
elevenMaps.editor.maps.Skin_DirtMask.background = '#777777';
const elevenZip = new JSZip(); elevenZip.file('project.json', JSON.stringify(elevenMaps)); elevenZip.file('assets/image-0.png', png);
const upgradedEleven = await readProjectFile(new Blob([await elevenZip.generateAsync({ type: 'arraybuffer' })]));
assert.equal(Object.keys(upgradedEleven.document.editor.maps).length, MAPS.length);
assert.deepEqual(upgradedEleven.document.editor.maps.Skin_DirtMask, elevenMaps.editor.maps.Skin_DirtMask, 'Le masque de carrosserie existant reste intact');
assert.deepEqual(upgradedEleven.document.editor.maps.Skin_B, elevenMaps.editor.maps.Skin_B);
const dirtSettings = structuredClone(document); dirtSettings.workspace.dirtEnabled = false; dirtSettings.workspace.dirtPreview = .75;
assert.deepEqual((await readProjectFile(await writeProjectFile({ document: dirtSettings, assets: new Map([['assets/image-0.png', png]]) }))).document.workspace, dirtSettings.workspace);
for (const value of ['false', 0, null]) {
  const badDirt = structuredClone(document); (badDirt.workspace as unknown as Record<string, unknown>).dirtEnabled = value;
  assert.throws(() => validateProjectDocument(badDirt, new Set(['assets/image-0.png'])), /saleté invalide/);
}
for (const value of [NaN, Infinity, -.1, 1.1, '1']) {
  const badDirt = structuredClone(document); (badDirt.workspace as unknown as Record<string, unknown>).dirtPreview = value;
  assert.throws(() => validateProjectDocument(badDirt, new Set(['assets/image-0.png'])), /saleté invalide/);
}
const lightCodes = structuredClone(document);
lightCodes.editor.maps.Skin_I.objects = [{ type: 'Image', src: 'assets/image-0.png', illumRole: 'brake', illumCodes: { width: 2, height: 2, runs: [2, 0, 1, 3, 1, 97] } }];
const savedCodes = await readProjectFile(await writeProjectFile({ document: lightCodes, assets: new Map([['assets/image-0.png', png]]) }));
assert.deepEqual(savedCodes.document.editor.maps.Skin_I, lightCodes.editor.maps.Skin_I);
(lightCodes.editor.maps.Skin_I.objects as Record<string, unknown>[])[0].illumCodes = { width: 2, height: 2, runs: [5000000000, 3] };
assert.throws(() => validateProjectDocument(lightCodes, new Set(['assets/image-0.png'])), /masque/);
console.log('✓ Migration des projets neuf textures et conservation sécurisée des codes lumineux originaux');
