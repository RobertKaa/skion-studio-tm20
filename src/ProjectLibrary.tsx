import { useEffect, useRef, useState } from 'react';
import { getProject, listProjects, removeProject, renameProject, trashProject, type LocalProject } from './projectStore';
import { projectError, PROJECT_EXTENSION } from './projectFile';
import { Icon } from './ui/Icon';

interface Props {
  currentId: string | null; needsSave: boolean;
  onClose(): void; onSave(copy: boolean): Promise<void>;
  onOpen(project: LocalProject): Promise<void>; onImport(file: File): Promise<void>;
  onDownloadCurrent(): Promise<{ file: Blob; name: string }>;
  onRenameCurrent(id: string, name: string): void; onDeleteCurrent(id: string): void;
}
function ProjectDownload({ project, disabled, label }: { project: Pick<LocalProject, 'file' | 'name'>; disabled: boolean; label?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(project.file); setUrl(next); return () => URL.revokeObjectURL(next); }, [project.file]);
  return <a className="btn btn-ghost btn-sm" aria-label={label || `Télécharger ${project.name}`} aria-disabled={disabled} href={disabled ? undefined : url} download={`${project.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'skin'}${PROJECT_EXTENSION}`} onClick={(event) => { if (disabled) event.preventDefault(); }}><Icon name="download" size={14} />{label}</a>;
}
function Thumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url ? <img src={url} alt="Aperçu du skin sauvegardé" /> : null;
}
export default function ProjectLibrary(props: Props) {
  const onClose = props.onClose;
  const panel = useRef<HTMLDivElement>(null); const input = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [loading, setLoading] = useState(true); const [working, setWorking] = useState(false);
  const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [trash, setTrash] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null); const [name, setName] = useState('');
  const [pending, setPending] = useState<LocalProject | File | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ file: Blob; name: string } | null>(null);
  const refresh = async () => { setProjects(await listProjects()); setLoading(false); };
  useEffect(() => { void refresh().catch((e) => { setError(projectError(e)); setLoading(false); }); }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!working) { if (pending) setPending(null); else if (removeId) setRemoveId(null); else onClose(); } }
      if (event.key === 'Tab') {
        const items = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')).filter((element) => element.getClientRects().length > 0);
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [working, pending, removeId, onClose]);
  const run = async (action: () => Promise<void>) => {
    setWorking(true); setError('');
    try { await action(); await refresh(); } catch (e) { setError(projectError(e)); } finally { setWorking(false); }
  };
  const open = async (item: LocalProject | File) => {
    if (item instanceof File) await props.onImport(item);
    else { const fresh = await getProject(item.id); if (!fresh || fresh.deletedAt) throw new Error('Ce projet est introuvable.'); await props.onOpen(fresh); }
  };
  const requestOpen = (item: LocalProject | File) => { if (props.needsSave) setPending(item); else void run(() => open(item)); };
  const visible = projects.filter((project) => !!project.deletedAt === trash && project.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const activeCount = projects.filter((p) => !p.deletedAt).length; const trashCount = projects.length - activeCount;
  return <div className="modal-overlay" onClick={() => { if (!working) props.onClose(); }}>
    <div ref={panel} className="modal project-library" role="dialog" aria-modal="true" aria-labelledby="projects-title" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><h2 id="projects-title">Mes projets</h2><p>Retrouvez tous vos calques, images et matières pour continuer l’édition.</p></div><button type="button" className="modal-close" aria-label="Fermer les projets" disabled={working} onClick={props.onClose}><Icon name="x" /></button></div>
      <div className="project-library-toolbar">
        <button type="button" className="btn btn-primary" disabled={working} onClick={() => void run(() => props.onSave(false))}><Icon name="save" size={15} /> Enregistrer le projet courant</button>
        <button type="button" className="btn" disabled={working} onClick={() => void run(() => props.onSave(true))}><Icon name="copy" size={15} /> Enregistrer une copie</button>
        <button type="button" className="btn" disabled={working} onClick={() => void run(async () => { setPrepared(await props.onDownloadCurrent()); })}><Icon name="download" size={15} /> Fichier projet…</button>
        <button type="button" className="btn" disabled={working} onClick={() => input.current?.click()}><Icon name="upload" size={15} /> Importer un projet</button>
      </div>
      {prepared && <div className="project-notice" role="status"><strong>Fichier projet prêt</strong><p>Il contient les images originales et tous les calques éditables.</p><ProjectDownload project={prepared} disabled={working} label={`Télécharger ${prepared.name}${PROJECT_EXTENSION}`} /></div>}
      <div className="project-library-filters"><div className="segmented"><button type="button" className={!trash ? 'is-active' : ''} onClick={() => setTrash(false)}>Projets · {activeCount}</button><button type="button" className={trash ? 'is-active' : ''} onClick={() => setTrash(true)}>Corbeille · {trashCount}</button></div><input aria-label="Rechercher un projet" placeholder="Rechercher un projet…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      {pending && <div className="project-notice" role="alert"><strong>Conserver vos modifications avant d’ouvrir ce projet ?</strong><p>Une copie garde le travail courant avec tous ses calques.</p><div className="btn-group"><button type="button" className="btn btn-primary" disabled={working} onClick={() => void run(async () => { await props.onSave(true); await open(pending); })}>Enregistrer une copie et ouvrir</button><button type="button" className="btn" disabled={working} onClick={() => void run(() => open(pending))}>Ouvrir sans enregistrer</button><button type="button" className="btn btn-ghost" disabled={working} onClick={() => setPending(null)}>Annuler l’ouverture</button></div></div>}
      {removeId && <div className="project-notice" role="alert"><strong>Supprimer définitivement ce projet ?</strong><p>Le fichier local et sa miniature seront retirés. Cette action ne pourra pas être annulée.</p><div className="btn-group"><button type="button" className="btn" onClick={() => setRemoveId(null)}>Conserver dans la corbeille</button><button type="button" className="btn btn-danger" disabled={working} onClick={() => void run(async () => { await removeProject(removeId); setRemoveId(null); })}>Confirmer la suppression définitive</button></div></div>}
      {error && <p className="project-error" role="alert">{error}</p>}
      <div className="project-library-content" aria-busy={working || loading}>
        {loading ? <p className="empty">Chargement des projets…</p> : !visible.length ? <div className="empty project-empty"><Icon name="folder" size={32} /><h3>{query ? 'Aucun projet trouvé' : trash ? 'La corbeille est vide' : 'Votre premier projet commence ici'}</h3><p>{trash ? 'Les projets supprimés restent récupérables ici.' : 'Enregistrez le skin courant pour retrouver chaque élément plus tard.'}</p></div> : <div className="project-grid">{visible.map((project) => <article className={`project-card ${project.id === props.currentId ? 'is-current' : ''}`} key={project.id}>
          <div className="project-thumbnail"><Thumbnail blob={project.thumbnail} />{project.id === props.currentId && <span>Projet courant</span>}</div>
          <div className="project-card-body">{renameId === project.id ? <div className="project-rename"><input aria-label="Nouveau nom du projet" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(async () => { await renameProject(project.id, name); props.onRenameCurrent(project.id, name.trim().slice(0, 120) || 'Sans titre'); setRenameId(null); }); }} /><button type="button" className="btn btn-sm" disabled={working} onClick={() => void run(async () => { await renameProject(project.id, name); props.onRenameCurrent(project.id, name.trim().slice(0, 120) || 'Sans titre'); setRenameId(null); })}>Valider</button></div> : <h3>{project.name}</h3>}
          <p>{project.layers} calque{project.layers > 1 ? 's' : ''} · {project.bytes < .1 * 1024 * 1024 ? '< 0,1' : (project.bytes / 1024 / 1024).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mo</p><time dateTime={new Date(project.updatedAt).toISOString()}>{new Date(project.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</time>
          <div className="project-card-actions">{trash ? <><button type="button" className="btn btn-sm" disabled={working} onClick={() => void run(() => trashProject(project.id, false))}>Restaurer</button><button type="button" className="btn btn-ghost btn-sm" disabled={working} onClick={() => setRemoveId(project.id)}>Supprimer définitivement</button></> : <><button type="button" className="btn btn-primary btn-sm" disabled={working || !!pending} onClick={() => requestOpen(project)}>Ouvrir</button><button type="button" className="btn btn-ghost btn-sm" aria-label={`Renommer ${project.name}`} disabled={working} onClick={() => { setName(project.name); setRenameId(project.id); }}><Icon name="pen" size={14} /></button><ProjectDownload project={project} disabled={working} /><button type="button" className="btn btn-ghost btn-sm" aria-label={`Mettre ${project.name} à la corbeille`} disabled={working} onClick={() => void run(async () => { await trashProject(project.id, true); props.onDeleteCurrent(project.id); })}><Icon name="trash" size={14} /></button></>}</div></div>
        </article>)}</div>}
      </div>
      <footer className="project-library-footer"><Icon name="info" size={15} /><p>Stockés dans ce navigateur, sur cet ordinateur. Téléchargez un fichier {PROJECT_EXTENSION} pour conserver une copie ailleurs.{trash && ' La corbeille utilise encore de l’espace local.'}</p></footer>
      <input ref={input} type="file" hidden accept={PROJECT_EXTENSION} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) requestOpen(file); }} />
    </div>
  </div>;
}
