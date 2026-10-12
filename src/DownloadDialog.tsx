import { useEffect, useRef, useState } from 'react';
import { ProjectDownload } from './ProjectLibrary';
import { projectError } from './projectFile';
import { Icon } from './ui/Icon';
import { HornPicker } from './ui/HornPicker';
import { prepareHorn, type SkinHorn } from './horn';

export default function DownloadDialog({ onClose, onPrepareProject, onExport, horn, onHornChange }: {
  onClose(): void;
  onPrepareProject(): Promise<{ file: Blob; name: string }>;
  onExport(): Promise<boolean>;
  horn: SkinHorn | null;
  onHornChange(horn: SkinHorn | null): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [prepared, setPrepared] = useState<{ file: Blob; name: string } | null>(null);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false); workingRef.current = working;
  const [error, setError] = useState('');

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      // Le navigateur peut annuler la dernière saisie même si son champ a perdu le focus.
      if ((event.ctrlKey || event.metaKey) && ['z', 'y', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!workingRef.current) onClose();
      }
      if (event.key === 'Tab') {
        const items = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], audio[controls]'));
        const first = items[0]; const last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);

  useEffect(() => { if (prepared) panel.current?.querySelector<HTMLAnchorElement>('.download-format a')?.focus(); }, [prepared]);
  useEffect(() => { setPrepared(null); }, [horn]);

  const run = async (action: () => Promise<void>) => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true); setError('');
    try { await action(); } catch (error) { setError(projectError(error)); } finally { workingRef.current = false; setWorking(false); }
  };

  return <div className="modal-overlay" onClick={() => { if (!working) onClose(); }}>
    <div ref={panel} className="modal download-dialog" role="dialog" aria-modal="true" aria-labelledby="download-title" aria-describedby="download-description" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head">
        <div><h2 id="download-title">Télécharger votre travail</h2><p id="download-description">Choisissez le fichier selon ce que vous voulez faire.</p></div>
        <button type="button" className="modal-close" aria-label="Fermer les téléchargements" disabled={working} onClick={onClose}><Icon name="x" /></button>
      </div>
      <HornPicker horn={horn} disabled={working} onChoose={(file) => void run(async () => {
        const next = await prepareHorn(file, file.name);
        onHornChange(next); setPrepared(null);
      })} onRemove={() => { onHornChange(null); setPrepared(null); setError(''); }} />
      {working && <p className="download-progress" role="status">Préparation en cours…</p>}
      <div className="download-formats" aria-busy={working}>
        <section className="download-format">
          <Icon name="layers" size={24} />
          <h3>Continuer à modifier</h3><span className="download-extension">Projet éditable · .tmskin</span>
          <p>Conserve tous les calques, images, réglages et le klaxon. À rouvrir dans Skion Studio, sur cet appareil ou un autre.</p>
          {prepared
            ? <ProjectDownload project={prepared} disabled={working} label={`Télécharger ${prepared.name}.tmskin`} />
            : <button type="button" className="btn" disabled={working} onClick={() => void run(async () => { setPrepared(await onPrepareProject()); })}><Icon name="download" size={15} /> Préparer le projet .tmskin</button>}
          {prepared && <span className="hint" role="status">Projet prêt : cliquez pour télécharger le fichier.</span>}
        </section>
        <section className="download-format">
          <Icon name="box" size={24} />
          <h3>Jouer avec votre skin</h3><span className="download-extension">Skin Trackmania · .zip</span>
          <p>Textures{horn ? ' et klaxon' : ''} prêtes pour le jeu. Pour garder vos calques modifiables, conservez aussi le projet .tmskin.</p>
          <button type="button" className="btn btn-primary" disabled={working} onClick={() => void run(async () => {
            if (await onExport()) onClose();
            else throw new Error('L’éditeur n’est pas encore prêt. Réessayez dans un instant.');
          })}><Icon name="download" size={15} /> Exporter pour Trackmania</button>
        </section>
      </div>
      {error && <p className="download-error" role="alert">{error}</p>}
      <p className="download-storage"><Icon name="info" size={15} /> « Enregistrer » conserve votre projet dans ce navigateur. Le téléchargement crée une copie à garder ailleurs.</p>
    </div>
  </div>;
}
