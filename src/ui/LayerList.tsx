import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { LayerInfo } from '../editor/EditorCore';
import { Icon, type IconName } from './Icon';
import { IconButton } from './controls';
import './layerList.css';

export interface LayerListProps {
  layers: LayerInfo[];
  onSelect: (layer: LayerInfo, edit?: boolean) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onReorder: (sourceId: string, targetId: string, position: 'before' | 'after') => boolean | void;
  onDelete: (id: string) => void;
  onToggleLock: (id: string) => void;
  onToggleVisible: (id: string) => void;
}

const LAYER_ICONS: Record<string, IconName> = {
  rect: 'square', ellipse: 'circle', circle: 'circle', line: 'line', polygon: 'hexagon',
  path: 'brush', 'i-text': 'type', text: 'type', image: 'image', group: 'layers',
};
type Landing = { id: string; position: 'before' | 'after' };
type DragSession = {
  id: string; name: string; pointerId: number; startX: number; startY: number;
  x: number; y: number; started: boolean; landing: Landing | null; grip: HTMLButtonElement;
};

function scrollParent(list: HTMLElement): HTMLElement | null {
  const view = list.ownerDocument.defaultView;
  for (let parent = list.parentElement; parent; parent = parent.parentElement) {
    if (view && /auto|scroll/.test(view.getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/** Reorder only on release; moving the pointer never edits the project or its selection. */
export function LayerList(props: LayerListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const session = useRef<DragSession | null>(null);
  const frame = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ id: string; landing: Landing | null } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const helpId = useId();
  const signature = props.layers.map(layer => `${layer.id}:${Number(layer.linked)}`).join('|');
  const cancelRef = useRef<() => void>(() => {});

  useEffect(() => {
    const list = listRef.current;
    const view = list?.ownerDocument.defaultView;
    if (!list || !view) return;
    const document = list.ownerDocument;

    function finish(message?: string) {
      const current = session.current;
      session.current = null;
      if (frame.current !== null) view!.cancelAnimationFrame(frame.current);
      frame.current = null;
      if (current?.grip.hasPointerCapture?.(current.pointerId)) current.grip.releasePointerCapture(current.pointerId);
      setDrag(null);
      if (message) setAnnouncement(message);
    }
    function cancel() {
      finish(session.current?.started ? 'Déplacement annulé.' : undefined);
    }
    cancelRef.current = cancel;

    function locate(current: DragSession): Landing | null {
      const bounds = list!.getBoundingClientRect();
      const scroller = scrollParent(list!);
      const clip = scroller?.getBoundingClientRect();
      if (current.x < bounds.left || current.x > bounds.right ||
          current.y < Math.max(bounds.top, clip?.top ?? bounds.top) ||
          current.y > Math.min(bounds.bottom, clip?.bottom ?? bounds.bottom)) return null;
      const rows = [...list!.querySelectorAll<HTMLElement>('[data-layer-id]')];
      let landing: Landing | null = null;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (current.y < rect.top + rect.height / 2) {
          landing = { id: row.dataset.layerId!, position: 'before' }; break;
        }
      }
      if (!landing && rows.length) landing = { id: rows.at(-1)!.dataset.layerId!, position: 'after' };
      if (!landing || landing.id === current.id) return null;
      const ids = latest.current.layers.map(layer => layer.id);
      const source = ids.indexOf(current.id);
      const target = ids.indexOf(landing.id);
      if (source < 0 || target < 0) return null;
      const insertion = target + Number(landing.position === 'after');
      return insertion === source || insertion === source + 1 ? null : landing;
    }
    function update(current: DragSession) {
      const landing = locate(current);
      if (!dragEqual(current.landing, landing)) {
        current.landing = landing;
        setDrag({ id: current.id, landing });
      }
    }
    function scrollFrame() {
      frame.current = null;
      const current = session.current;
      if (!current?.started) return;
      const scroller = scrollParent(list!);
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        const inside = current.x >= bounds.left && current.x <= bounds.right && current.y >= bounds.top && current.y <= bounds.bottom;
        if (inside) {
          const edge = Math.min(44, bounds.height / 4);
          const velocity = current.y < bounds.top + edge ? -12 * (1 - (current.y - bounds.top) / edge)
            : current.y > bounds.bottom - edge ? 12 * (1 - (bounds.bottom - current.y) / edge) : 0;
          if (velocity) scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + velocity));
        }
      }
      update(current);
      frame.current = view!.requestAnimationFrame(scrollFrame);
    }
    function move(event: PointerEvent) {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (!current.started && Math.hypot(current.x - current.startX, current.y - current.startY) < 5) return;
      event.preventDefault();
      if (!current.started) {
        current.started = true;
        setAnnouncement(`Déplacement de ${current.name}. Relâchez à la position souhaitée ; Échap annule.`);
        setDrag({ id: current.id, landing: null });
        frame.current = view!.requestAnimationFrame(scrollFrame);
      }
      update(current);
    }
    function release(event: PointerEvent) {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      const landing = current.started ? locate(current) : null;
      const target = landing && latest.current.layers.find(layer => layer.id === landing.id);
      finish();
      if (landing && target) {
        const changed = latest.current.onReorder(current.id, landing.id, landing.position);
        setAnnouncement(changed === false ? 'Position inchangée.' : `${current.name} déplacé ${landing.position === 'before' ? 'au-dessus de' : 'sous'} ${target.material?.name ?? target.name}.`);
      } else if (current.started) setAnnouncement('Position inchangée.');
    }
    const pointerCancel = (event: PointerEvent) => { if (event.pointerId === session.current?.pointerId) cancel(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', pointerCancel);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('visibilitychange', visibility);
    view.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', pointerCancel);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('visibilitychange', visibility);
      view.removeEventListener('blur', cancel);
      finish(); cancelRef.current = () => {};
    };
  }, []);

  useEffect(() => { cancelRef.current(); }, [signature]);

  function start(layer: LayerInfo, event: ReactPointerEvent<HTMLButtonElement>) {
    if (layer.linked || event.button !== 0 || event.isPrimary === false) return;
    cancelRef.current();
    session.current = { id: layer.id, name: layer.material?.name ?? layer.name, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      started: false, landing: null, grip: event.currentTarget };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  return <>
    <span id={helpId} className="layer-drag-sr">Glissez la poignée pour changer l’ordre. Au clavier, utilisez les flèches haut et bas.</span>
    <span className="layer-drag-sr" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    <ul ref={listRef} className={`layer-list layer-list--sortable${drag ? ' is-dragging' : ''}`} aria-label="Calques">
      {props.layers.map(layer => <li key={layer.id} data-layer-id={layer.id}
        className={`layer-row${layer.material ? ' is-material' : ''}${layer.selected ? ' is-selected' : ''}${layer.visible ? '' : ' is-hidden'}${layer.locked ? ' is-locked' : ''}${drag?.id === layer.id ? ' is-drag-source' : ''}${drag?.landing?.id === layer.id ? ` is-drop-${drag.landing.position}` : ''}`}>
        <button type="button" className="layer-grip" disabled={layer.linked} aria-label={`Réordonner ${layer.material?.name ?? layer.name}`} aria-describedby={helpId}
          title={layer.linked ? 'Ordre lié à l’image ou au matériau source' : 'Glisser pour réordonner · flèches haut/bas au clavier'}
          onPointerDown={event => start(layer, event)} onClick={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault(); event.stopPropagation(); props.onMove(layer.id, event.key === 'ArrowUp' ? 'up' : 'down');
          }}><Icon name="grip" size={14} /></button>
        <button type="button" className="layer-select" aria-pressed={layer.selected} onClick={() => props.onSelect(layer)} onDoubleClick={() => props.onSelect(layer, true)}
          title={layer.locked ? `${layer.name} · déverrouillez ce calque pour le modifier` : layer.material ? `${layer.material.name} · ouvrir les réglages du matériau` : `${layer.name} · ${layer.linked ? 'réglages liés à l’image' : 'double-clic pour modifier'}`}>
          <Icon name={layer.material ? 'layers' : LAYER_ICONS[layer.type] ?? 'square'} size={14} className="layer-type" />
          <span className="layer-label"><span className="layer-name" title={layer.name}>{layer.material?.name ?? layer.name}</span>
            {layer.material && <span className="layer-material-link">{layer.material.linked ? 'Lié au matériau' : 'Matériau · couleur'}</span>}</span>
        </button>
        <span className="layer-actions" onClick={event => event.stopPropagation()}>
          {layer.material && <IconButton size="sm" icon="sliders" label={`Modifier le matériau ${layer.material.name}`} disabled={layer.locked} onClick={() => props.onSelect(layer, true)} tipSide="left" />}
          <IconButton size="sm" icon="chevronUp" label={layer.material?.linked ? 'Ordre lié au matériau' : 'Monter'} disabled={layer.linked} onClick={() => props.onMove(layer.id, 'up')} className="hover-only" tipSide="left" />
          <IconButton size="sm" icon="chevronDown" label={layer.material?.linked ? 'Ordre lié au matériau' : 'Descendre'} disabled={layer.linked} onClick={() => props.onMove(layer.id, 'down')} className="hover-only" tipSide="left" />
          <IconButton size="sm" icon="trash" label={layer.material ? `Supprimer le matériau ${layer.material.name}` : 'Supprimer'} danger onClick={() => props.onDelete(layer.id)} className="hover-only" tipSide="left" />
          <IconButton size="sm" icon={layer.locked ? 'lock' : 'unlock'} label={layer.material ? `${layer.locked ? 'Déverrouiller' : 'Verrouiller'} le matériau ${layer.material.name}` : layer.locked ? 'Déverrouiller' : 'Verrouiller'} active={layer.locked} onClick={() => props.onToggleLock(layer.id)} tipSide="left" />
          <IconButton size="sm" icon={layer.visible ? 'eye' : 'eyeOff'} label={layer.material ? `${layer.visible ? 'Masquer' : 'Afficher'} le matériau ${layer.material.name}` : layer.visible ? 'Masquer' : 'Afficher'} onClick={() => props.onToggleVisible(layer.id)} tipSide="left" />
        </span>
      </li>)}
    </ul>
  </>;
}

function dragEqual(left: Landing | null, right: Landing | null) {
  return left?.id === right?.id && left?.position === right?.position;
}
