import { materialPngBytes, inspectMaterialImage, MATERIAL_IMPORT_LIMITS, portableMaterialDefinition } from './import';
import { isValidMaterialDefinition, type MaterialDefinition } from './types';

export interface StoredMaterial {
  id: string;
  definition: MaterialDefinition;
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
}
export const MATERIAL_LIBRARY_LIMITS = { count: 30, bytes: 128 * 1024 * 1024 } as const;
const DB_NAME = 'skion-materials';
const STORE_NAME = 'materials';
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('La bibliothèque locale est indisponible. Exportez un pack pour conserver ce matériau.')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('La bibliothèque locale ne peut pas être ouverte.'));
    request.onblocked = () => reject(new Error('Fermez les autres onglets de Skion puis réessayez.'));
  });
  void database.catch(() => { database = undefined; });
  return database;
}

/** Storage boundary also lets unit tests exercise quota and update rules without a browser. */
export interface MaterialLibraryStorage {
  transaction<T>(mode: 'readonly' | 'readwrite', action: (records: StoredMaterial[]) => { records: StoredMaterial[]; value: T }): Promise<T>;
}
const indexedDbStorage: MaterialLibraryStorage = {
  async transaction<T>(mode: 'readonly' | 'readwrite', action: (records: StoredMaterial[]) => { records: StoredMaterial[]; value: T }) {
    const db = await openDatabase();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode); const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll(); let value: T; let failure: unknown;
      request.onsuccess = () => {
        try {
          const records = request.result as StoredMaterial[];
          const result = action(records); value = result.value;
          if (mode === 'readwrite') {
            const before = new Map(records.map((record) => [record.id, record]));
            const afterIds = new Set(result.records.map((record) => record.id));
            for (const record of records) if (!afterIds.has(record.id)) store.delete(record.id);
            for (const record of result.records) if (before.get(record.id) !== record) store.put(record);
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(failure ?? transaction.error ?? request.error ?? new Error('Sauvegarde du matériau interrompue.'));
      transaction.onerror = () => {
        const error = transaction.error ?? request.error;
        failure ??= error?.name === 'QuotaExceededError' ? new Error('Le stockage du navigateur est plein. Supprimez des matériaux ou exportez un pack.') : error;
      };
    });
  },
};

function validateId(id: string) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Référence de matériau invalide.');
}

/** Durable records embed PNG images; object URLs do not survive restarting the browser. */
export function materialLibraryBytes(definition: MaterialDefinition): number {
  if (!isValidMaterialDefinition(definition, (source) => /^data:image\/png;base64,/.test(source))) throw new Error('Matériau invalide : réimportez les textures avant de les enregistrer.');
  const sources = new Set<string>(); let bytes = 0; let pixels = 0;
  for (const texture of Object.values(definition.textures)) {
    if (!texture || sources.has(texture.src)) continue;
    sources.add(texture.src);
    const image = materialPngBytes(texture.src); bytes += image.length;
    if ((pixels += inspectMaterialImage(image).pixels) > MATERIAL_IMPORT_LIMITS.totalPixels || bytes > MATERIAL_IMPORT_LIMITS.totalBytes) throw new Error('Ce matériau contient trop d’images en haute résolution.');
  }
  // Count the actual JSON representation stored in IndexedDB, including base64 and metadata.
  return new TextEncoder().encode(JSON.stringify(definition)).length;
}

function validateStoredMaterial(material: StoredMaterial) {
  validateId(material.id);
  if (typeof material.favorite !== 'boolean' || !Number.isFinite(material.createdAt) || !Number.isFinite(material.updatedAt) ||
    material.createdAt < 0 || material.updatedAt < material.createdAt) throw new Error('La bibliothèque contient un matériau invalide.');
  return materialLibraryBytes(material.definition);
}

function validateLibrary(materials: StoredMaterial[], limits: { count: number; bytes: number }) {
  if (materials.length > limits.count) throw new Error('La bibliothèque est limitée à 30 matériaux. Supprimez un matériau avant d’en ajouter un.');
  let bytes = 0; const ids = new Set<string>();
  for (const material of materials) {
    const materialBytes = validateStoredMaterial(material);
    if (ids.has(material.id)) throw new Error('La bibliothèque contient une référence dupliquée.');
    ids.add(material.id); bytes += materialBytes + 200;
  }
  if (bytes > limits.bytes) throw new Error(`La bibliothèque est limitée à ${Math.max(1, Math.round(limits.bytes / 1024 / 1024))} Mo. Supprimez des matériaux ou exportez un pack.`);
}

export function createMaterialLibrary(storage: MaterialLibraryStorage = indexedDbStorage, limits: { count: number; bytes: number } = MATERIAL_LIBRARY_LIMITS,
  prepareDefinition: (definition: MaterialDefinition) => Promise<MaterialDefinition> = portableMaterialDefinition) {
  return {
    async listMaterials(): Promise<StoredMaterial[]> {
      return storage.transaction('readonly', (records) => {
        validateLibrary(records, limits);
        const list = [...records].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
        return { records, value: structuredClone(list) };
      });
    },
    async saveMaterial(definition: MaterialDefinition, id?: string): Promise<StoredMaterial> {
      if (id !== undefined) validateId(id);
      const snapshot = await prepareDefinition(definition); materialLibraryBytes(snapshot);
      return storage.transaction('readwrite', (records) => {
        const existing = id === undefined ? undefined : records.find((record) => record.id === id);
        if (id !== undefined && !existing) throw new Error('Ce matériau n’existe plus dans la bibliothèque.');
        const now = Math.max(Date.now(), existing?.updatedAt ?? 0);
        const material: StoredMaterial = { id: existing?.id ?? crypto.randomUUID(), definition: snapshot,
          createdAt: existing?.createdAt ?? now, updatedAt: now, favorite: existing?.favorite ?? false };
        const next = existing ? records.map((record) => record.id === material.id ? material : record) : [...records, material];
        validateLibrary(next, limits);
        return { records: next, value: structuredClone(material) };
      });
    },
    async removeMaterial(id: string): Promise<void> {
      validateId(id);
      return storage.transaction('readwrite', (records) => ({ records: records.filter((record) => record.id !== id), value: undefined }));
    },
    async setMaterialFavorite(id: string, favorite: boolean): Promise<StoredMaterial> {
      validateId(id); if (typeof favorite !== 'boolean') throw new Error('Valeur de favori invalide.');
      return storage.transaction('readwrite', (records) => {
        const existing = records.find((record) => record.id === id);
        if (!existing) throw new Error('Ce matériau n’existe plus dans la bibliothèque.');
        const material = { ...existing, favorite }; const next = records.map((record) => record.id === id ? material : record);
        validateLibrary(next, limits);
        return { records: next, value: structuredClone(material) };
      });
    },
  };
}

const library = createMaterialLibrary();
export const listMaterials = library.listMaterials;
export const saveMaterial = library.saveMaterial;
export const removeMaterial = library.removeMaterial;
export const setMaterialFavorite = library.setMaterialFavorite;
