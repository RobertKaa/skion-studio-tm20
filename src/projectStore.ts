export interface LocalProject {
  id: string; name: string; createdAt: number; updatedAt: number; deletedAt: number | null;
  layers: number; file: Blob; thumbnail: Blob; bytes: number;
}
const DB_NAME = 'tm-skin-studio-projects';
let database: Promise<IDBDatabase> | null = null;
function db() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Les sauvegardes locales ne sont pas disponibles. Utilisez un fichier projet.')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error('Fermez les autres onglets de Skin Studio puis réessayez.')); };
  });
  return database;
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction('projects', mode); const request = action(tx.objectStore('projects'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Transaction de sauvegarde interrompue.'));
    tx.onerror = () => reject(tx.error ?? request.error);
  });
}
export async function listProjects() { return (await transaction('readonly', (store) => store.getAll()) as LocalProject[]).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function getProject(id: string) { return await transaction('readonly', (store) => store.get(id)) as LocalProject | undefined; }
export async function putProject(project: LocalProject) { await transaction('readwrite', (store) => store.put(project)); }
async function changeProject(id: string, update: (project: LocalProject) => LocalProject | null) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction('projects', 'readwrite'); const store = tx.objectStore('projects'); const request = store.get(id);
    let error: unknown;
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('Projet introuvable.');
        const next = update(request.result as LocalProject); if (next) store.put(next); else store.delete(id);
      } catch (e) { error = e; tx.abort(); }
    };
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(error ?? tx.error ?? request.error);
    tx.onerror = () => reject(tx.error ?? request.error);
  });
}
export async function renameProject(id: string, name: string) {
  const project = await getProject(id); if (!project) throw new Error('Projet introuvable.');
  const nextName = name.trim().slice(0, 120) || 'Sans titre';
  const bundle = await readProjectFile(project.file); bundle.document.name = nextName;
  const file = await writeProjectFile(bundle);
  await changeProject(id, (fresh) => {
    if (fresh.updatedAt !== project.updatedAt) throw new Error('Ce projet a changé dans un autre onglet. Réessayez le renommage.');
    return { ...fresh, name: nextName, file, bytes: file.size + fresh.thumbnail.size, updatedAt: Date.now() };
  });
}
export async function trashProject(id: string, trash: boolean) {
  await changeProject(id, (project) => ({ ...project, deletedAt: trash ? Date.now() : null }));
  if (trash && lastProjectId() === id) rememberProject(null);
}
export async function removeProject(id: string) { await changeProject(id, (project) => { if (!project.deletedAt) throw new Error('Placez d’abord le projet dans la corbeille.'); return null; }); }
export function lastProjectId(): string | null { try { return localStorage.getItem('tm-skin:last-project'); } catch { return null; } }
export function rememberProject(id: string | null) { try { if (id) localStorage.setItem('tm-skin:last-project', id); else localStorage.removeItem('tm-skin:last-project'); } catch { /* La bibliothèque fonctionne sans préférence de réouverture. */ } }
import { readProjectFile, writeProjectFile } from './projectFile';
