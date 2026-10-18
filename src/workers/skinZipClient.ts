import type { RGBAImage } from '../dds';
import type { MapId } from '../maps';
import type { BuildSkinZipOptions } from '../skinZip';
import type { SkinZipReply, SkinZipRequest } from './skinZipProtocol';

export interface SkinZipEncoder {
  addMap(id: MapId, image: RGBAImage, roles?: RGBAImage): Promise<void>;
  finish(): Promise<Blob>;
  dispose(): void;
}
type Command = SkinZipRequest extends infer T ? T extends SkinZipRequest ? Omit<T, 'request'> : never : never;
type WorkerFactory = () => Worker | null;

/** One uncompressed channel in flight. Only freshly captured pixel buffers transfer. */
export async function createSkinZipEncoder(
  options: BuildSkinZipOptions,
  inline: () => SkinZipEncoder,
  createWorker: WorkerFactory = () => typeof Worker === 'undefined' ? null : new Worker(new URL('./skinZip.worker.ts', import.meta.url), { type: 'module' }),
): Promise<SkinZipEncoder> {
  let worker: Worker | null;
  try { worker = createWorker(); } catch { return inline(); }
  if (!worker) return inline();
  const target = worker;
  let sequence = 0, disposed = false, finished = false;
  let failure: Error | null = null;
  const pending = new Map<number, { resolve(value?: Blob): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const stop = (error = new Error('Export interrompu. Réessayez le téléchargement.')) => {
    if (disposed) return;
    disposed = true; failure = error; target.terminate();
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
    pending.clear();
  };
  target.onmessage = (event: MessageEvent<SkinZipReply>) => {
    const result = event.data;
    const job = result && pending.get(result.request);
    if (!job) return;
    pending.delete(result.request); clearTimeout(job.timer);
    if (typeof result.error === 'string') { const error = new Error(result.error); job.reject(error); stop(error); }
    else job.resolve(result.blob);
  };
  target.onerror = event => { event.preventDefault?.(); stop(new Error('La compression a été interrompue. Réessayez le téléchargement.')); };
  target.onmessageerror = () => stop(new Error('Le résultat de la compression est illisible. Réessayez le téléchargement.'));
  const send = (command: Command, transfer: Transferable[] = []): Promise<Blob | undefined> => new Promise((resolve, reject) => {
    if (disposed) { reject(failure!); return; }
    if (pending.size) { reject(new Error('Un canal est déjà en cours de compression.')); return; }
    const request = ++sequence;
    const timer = setTimeout(() => stop(new Error('La compression ne répond plus. Réessayez le téléchargement.')), 120_000);
    pending.set(request, { resolve, reject, timer });
    try { target.postMessage({ ...command, request }, transfer); }
    catch (error) { stop(error instanceof Error ? error : new Error('Compression indisponible.')); }
  });
  try { await send({ command: 'init', options }); }
  catch { stop(); return inline(); } // No source pixels have transferred yet.
  return {
    async addMap(id, image, roles) {
      if (finished) throw new Error('Cet export est déjà terminé.');
      const buffers = [...new Set([image.data.buffer, ...(roles ? [roles.data.buffer] : [])])] as ArrayBuffer[];
      await send({ command: 'map', id, image, roles }, buffers);
    },
    async finish() {
      if (finished) throw new Error('Cet export est déjà terminé.');
      finished = true;
      const blob = await send({ command: 'finish' });
      if (!(blob instanceof Blob)) throw new Error('Le fichier exporté est illisible.');
      return blob;
    },
    dispose: () => stop(),
  };
}
