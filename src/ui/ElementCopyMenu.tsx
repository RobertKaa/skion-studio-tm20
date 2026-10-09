import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ElementCopyContext } from '../editor/EditorCore';
import type { MapId } from '../maps';
import { Icon, type IconName } from './Icon';

interface Props {
  context: ElementCopyContext;
  targets: { id: MapId; label: string; icon: IconName }[];
  onCopy: (target: MapId) => Promise<void>;
  onClose: () => void;
}

export function ElementCopyMenu({ context, targets, onCopy, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [copying, setCopying] = useState(false);
  const [position, setPosition] = useState({ x: context.clientX, y: context.clientY });

  useLayoutEffect(() => {
    const menu = menuRef.current!;
    const previousFocus = document.activeElement;
    const fit = () => {
      const { width, height } = menu.getBoundingClientRect();
      setPosition({
        x: Math.max(8, Math.min(context.clientX, window.innerWidth - width - 8)),
        y: Math.max(8, Math.min(context.clientY, window.innerHeight - height - 8)),
      });
    };
    fit();
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('wheel', scroll, true);
    window.addEventListener('resize', fit);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('wheel', scroll, true);
      window.removeEventListener('resize', fit);
      if (menu.contains(document.activeElement) && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [context, expanded, onClose]);

  return createPortal(
    <div ref={menuRef} className="element-copy-menu" role="menu" aria-label={`Actions de ${context.name}`}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Tab') { onClose(); return; }
        if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); setExpanded(false); return; }
        if (event.key === 'ArrowRight' && !expanded) { event.preventDefault(); setExpanded(true); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      <div className="element-copy-menu__name" title={context.name}>{context.name}</div>
      {expanded ? <>
        <button type="button" className="element-copy-menu__back" role="menuitem" onClick={() => setExpanded(false)}>
          <span className="element-copy-menu__back-icon"><Icon name="chevronRight" size={14} /></span> Copier vers…
        </button>
        {targets.map((target) => <button key={target.id} type="button" role="menuitem" disabled={copying}
          onClick={async () => {
            setCopying(true);
            try { await onCopy(target.id); } finally { setCopying(false); }
          }}><Icon name={target.icon} size={16} /> {target.label}</button>)}
        <p className="element-copy-menu__hint">Ajout comme nouveau calque.<br />Position et couleurs conservées.</p>
      </> : <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={false} onClick={() => setExpanded(true)}>
        <Icon name="copy" size={16} /> Copier vers… <Icon name="chevronRight" size={14} />
      </button>}
    </div>, document.body,
  );
}
