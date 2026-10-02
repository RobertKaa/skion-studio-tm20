import { useEffect, useRef } from 'react';

export function ConfirmDialog({ title, message, onCancel, onConfirm }: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const buttons = panel.current!.querySelectorAll<HTMLButtonElement>('button');
    buttons[0].focus();
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const next = document.activeElement === buttons[0] ? buttons[1] : buttons[0];
        next.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onCancel]);
  return <div className="modal-overlay" onClick={onCancel}>
    <div ref={panel} className="modal modal--confirm" role="dialog" aria-modal="true" aria-labelledby="clear-title" aria-describedby="clear-description" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><h2 id="clear-title">{title}</h2></div>
      <div className="modal-body"><p id="clear-description">{message}</p><p className="hint">Vous pourrez récupérer les calques avec Annuler ou Ctrl+Z.</p></div>
      <div className="modal-actions"><button type="button" className="btn" onClick={onCancel}>Annuler</button><button type="button" className="btn btn-danger" onClick={onConfirm}>Vider la texture</button></div>
    </div>
  </div>;
}
