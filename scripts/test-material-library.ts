import assert from 'node:assert/strict';
import { createMaterialLibrary, materialLibraryBytes, MATERIAL_LIBRARY_LIMITS, type MaterialLibraryStorage, type StoredMaterial } from '../src/materials/library';
import { createMaterialDefinition } from '../src/materials/types';
import { portableMaterialDefinition } from '../src/materials/import';

function memoryStorage(): MaterialLibraryStorage {
  let records: StoredMaterial[] = [];
  // Serialize transactions like IndexedDB so quota checks and writes are atomic.
  let queue = Promise.resolve();
  return {
    transaction<T>(mode: 'readonly' | 'readwrite', action: (records: StoredMaterial[]) => { records: StoredMaterial[]; value: T }): Promise<T> {
      const operation = queue.then(() => {
        const result = action(structuredClone(records));
        if (mode === 'readwrite') records = structuredClone(result.records);
        return structuredClone(result.value);
      });
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}

const library = createMaterialLibrary(memoryStorage()); const definition = createMaterialDefinition('carbon');
const original = await library.saveMaterial(definition); assert.equal(original.favorite, false); assert.ok(original.id);
definition.name = 'Changed outside storage';
assert.equal((await library.listMaterials())[0].definition.name, 'Carbone', 'Saving snapshots does not retain mutable caller references');
original.definition.color = '#000000';
assert.equal((await library.listMaterials())[0].definition.color, createMaterialDefinition('carbon').color, 'Returned records do not mutate storage');
const variantDefinition = createMaterialDefinition('carbon'); variantDefinition.name = 'Carbone rouge'; variantDefinition.color = '#990000';
const variant = await library.saveMaterial(variantDefinition); assert.notEqual(variant.id, original.id);
assert.equal((await library.listMaterials()).length, 2, 'Saving a variant without an id preserves the original');
const favorite = await library.setMaterialFavorite(original.id, true); assert.equal(favorite.favorite, true);
assert.equal((await library.listMaterials())[0].id, original.id, 'Favorites precede recent entries');
const rename = createMaterialDefinition('carbon'); rename.name = 'Carbone fin';
const renamed = await library.saveMaterial(rename, original.id);
assert.equal(renamed.createdAt, original.createdAt); assert.equal(renamed.favorite, true);
assert.equal((await library.listMaterials()).find((entry) => entry.id === original.id)!.definition.name, 'Carbone fin');
assert.equal((await library.listMaterials()).length, 2, 'Updating an id replaces its definition atomically');
await library.removeMaterial(original.id); assert.equal((await library.listMaterials()).length, 1);
await library.removeMaterial(original.id); // Repeating a completed deletion is safe.
await assert.rejects(library.saveMaterial(rename, original.id), /n’existe plus/);
await assert.rejects(library.setMaterialFavorite(original.id, true), /n’existe plus/);
await assert.rejects(library.removeMaterial('../escape'), /Référence/);
await assert.rejects(library.saveMaterial({ ...rename, roughness: 999 }), /invalide/);

const remote = createMaterialDefinition(); remote.textures.color = { src: 'https://example.com/image.png', name: 'remote', component: 'r', invert: false };
await assert.rejects(library.saveMaterial(remote), /réimportez/);
const temporary = createMaterialDefinition(); temporary.textures.color = { src: 'blob:http://localhost:5173/12345678-1234-1234-1234-123456789012', name: 'temporary', component: 'r', invert: false };
assert.throws(() => materialLibraryBytes(temporary), /réimportez/, 'A durable record never stores an ephemeral object URL');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const textured = createMaterialDefinition(); textured.textures.color = { src: png, name: 'color.png', component: 'luminance', invert: false };
const savedImage = await library.saveMaterial(textured); assert.equal(savedImage.definition.textures.color!.src, png);
assert.ok(materialLibraryBytes(textured) > materialLibraryBytes(createMaterialDefinition()), 'Quota counts embedded base64 images and metadata');
const hydratedLibrary = createMaterialLibrary(memoryStorage(), MATERIAL_LIBRARY_LIMITS, (definition) => portableMaterialDefinition(definition, {
  async loadMaterialSources() {}, getMaterialSourceCanvas() { return { width: 1, height: 1, toDataURL() { return png; } }; },
}));
const durable = await hydratedLibrary.saveMaterial(temporary);
assert.equal(durable.definition.textures.color!.src, png, 'A material from a reopened project is converted into durable embedded PNG');
assert.equal(temporary.textures.color!.src.startsWith('blob:'), true, 'The active project stays untouched');

const crowded = createMaterialLibrary(memoryStorage());
await Promise.all(Array.from({ length: MATERIAL_LIBRARY_LIMITS.count }, (_, index) => crowded.saveMaterial({ ...rename, name: `Matériau ${index}` })));
assert.equal((await crowded.listMaterials()).length, 30);
await assert.rejects(crowded.saveMaterial(rename), /30 matériaux/);
assert.equal((await crowded.listMaterials()).length, 30, 'Quota rejection leaves all previous entries intact');
const updateAtCapacity = (await crowded.listMaterials())[0]; await crowded.saveMaterial({ ...rename, name: 'Updated at capacity' }, updateAtCapacity.id);
assert.equal((await crowded.listMaterials()).length, 30, 'The count cap still allows updates');

const oneSize = materialLibraryBytes(textured) + 200;
const full = createMaterialLibrary(memoryStorage(), { count: 30, bytes: oneSize + 1 });
const first = await full.saveMaterial(textured);
await assert.rejects(full.saveMaterial(textured), /bibliothèque est limitée/);
assert.equal((await full.listMaterials()).length, 1, 'Byte quota rejects new entries atomically');
await full.removeMaterial(first.id); assert.equal((await full.listMaterials()).length, 0);
await full.saveMaterial(textured);
console.log('✓ Bibliothèque : sauvegarde durable, variantes, renommage, favoris, suppression, quotas atomiques et refus des URL temporaires/externes');
