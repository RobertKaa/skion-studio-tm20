import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EditorCore, Tool } from '../editor/EditorCore';
import { MAP_BY_ID, type MapId } from '../maps';
import type { UvGuideIsland } from '../uvGuideData';
import type { UvPartEntry } from '../uvParts';
import { buildUvAtlasLayout, drawUvAtlas, sourceUvPoint, uvAtlasPath, type UvAtlasPlacement } from '../uvAtlasLayout';
import { Icon } from './Icon';
import './uvGlobalAtlas.css';

export function UvGlobalAtlas({ editor, activeMap, islands, selected, tool, navigating, showGuide, channelView, hidden = false, onSelect, onEdit, onOriginal }: {
  editor: EditorCore | null; activeMap: MapId; islands: UvGuideIsland[]; selected: string;
  tool: Tool; navigating: boolean; showGuide: boolean; channelView?: 'roughness' | 'metalness' | 'data';
  hidden?: boolean;
  onSelect(part: UvPartEntry): void; onEdit(part: UvPartEntry): void; onOriginal(): void;
}) {
  const organization = useMemo(() => {
    try { return { layout: buildUvAtlasLayout(islands), error: '' }; }
    catch (error) { return { layout: { placements: [], groups: [] }, error: error instanceof Error ? error.message : 'Disposition indisponible.' }; }
  }, [islands]);
  const { layout } = organization;
  const [zoom, setZoom] = useState(1), [size, setSize] = useState(480), [revision, setRevision] = useState(0);
  const viewport = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const spaceHeld = useRef(false);
  const gesture = useRef<{ id: number; kind: 'paint'; placement: UvAtlasPlacement } | { id: number; kind: 'pan'; x: number; y: number; left: number; top: number } | null>(null);
  const chosen = layout.placements.find(p => p.part.id === selected);
  const finish = () => { if (gesture.current?.kind === 'paint') editor?.paintEnd(); gesture.current = null; };
  // Finish a captured stroke on unmount, surface/tool changes and focus loss.
  useEffect(() => {
    const end = () => { if (gesture.current?.kind === 'paint') editor?.paintEnd(); gesture.current = null; spaceHeld.current = false; };
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target as Element)?.closest?.('input, select, textarea, button, [contenteditable="true"]')) spaceHeld.current = true;
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') spaceHeld.current = false; };
    window.addEventListener('blur', end);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { end(); window.removeEventListener('blur', end); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [editor, activeMap, tool, islands, hidden]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize(Math.max(100, Math.min(entry.contentRect.width, entry.contentRect.height) - 32)); });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let frame = 0;
    const off = editor?.on('texture', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setRevision(v => v + 1); }); });
    return () => { off?.(); cancelAnimationFrame(frame); };
  }, [editor]);
  useEffect(() => {
    if (hidden) return;
    const target = canvas.current, texture = editor?.getCanvasElement(activeMap); if (!target || !texture) return;
    const pixels = Math.min(4096, Math.max(1024, Math.ceil(size * zoom * Math.min(window.devicePixelRatio || 1, 2))));
    if (target.width !== pixels) target.width = target.height = pixels;
    const ctx = target.getContext('2d'); if (ctx) drawUvAtlas(ctx, texture, layout);
  }, [editor, activeMap, layout, revision, size, zoom, hidden]);
  useEffect(() => { setZoom(1); viewport.current?.scrollTo?.(0, 0); }, [islands]);
  const center = (bounds: { x: number; y: number; w: number; h: number }, nextZoom: number) => {
    finish(); setZoom(nextZoom);
    requestAnimationFrame(() => {
      const vp = viewport.current; if (!vp) return;
      const extent = size * nextZoom;
      const marginX = Math.max(16, (vp.clientWidth - extent) / 2), marginY = Math.max(16, (vp.clientHeight - extent) / 2);
      vp.scrollTo({ left: marginX + (bounds.x + bounds.w / 2) * extent - vp.clientWidth / 2, top: marginY + (bounds.y + bounds.h / 2) * extent - vp.clientHeight / 2 });
    });
  };
  const zoomBy = (factor: number) => {
    const vp = viewport.current; if (!vp) return;
    const extent = size * zoom;
    const x = (vp.scrollLeft + vp.clientWidth / 2 - Math.max(16, (vp.clientWidth - extent) / 2)) / extent;
    const y = (vp.scrollTop + vp.clientHeight / 2 - Math.max(16, (vp.clientHeight - extent) / 2)) / extent;
    center({ x, y, w: 0, h: 0 }, Math.max(1, Math.min(12, zoom * factor)));
  };
  useEffect(() => {
    const vp = viewport.current; if (!vp) return;
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || gesture.current) return;
      event.preventDefault();
      if (tool === 'draw' && event.ctrlKey) { editor?.adjustBrushSize(event.deltaY < 0 ? 2 : -2); return; }
      const sheetRect = sheet.current?.getBoundingClientRect(); if (!sheetRect) return;
      const x = (event.clientX - sheetRect.left) / sheetRect.width, y = (event.clientY - sheetRect.top) / sheetRect.height;
      const nextZoom = Math.max(1, Math.min(12, zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2)));
      const rect = vp.getBoundingClientRect(), pointerX = event.clientX - rect.left, pointerY = event.clientY - rect.top;
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        const extent = size * nextZoom;
        vp.scrollTo(Math.max(16, (vp.clientWidth - extent) / 2) + x * extent - pointerX, Math.max(16, (vp.clientHeight - extent) / 2) + y * extent - pointerY);
      });
    };
    vp.addEventListener('wheel', wheel, { passive: false });
    return () => vp.removeEventListener('wheel', wheel);
  }, [size, zoom, tool, editor]);
  const sourcePoint = (event: ReactPointerEvent, placement: UvAtlasPlacement) => {
    const rect = sheet.current!.getBoundingClientRect();
    return sourceUvPoint(placement, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  };
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (gesture.current || (event.button !== 0 && event.button !== 1)) return;
    const vp = viewport.current;
    const id = (event.target as Element).closest('[data-part]')?.getAttribute('data-part');
    const placement = layout.placements.find(p => p.part.id === id);
    if ((navigating && !placement) || event.button === 1 || event.altKey || spaceHeld.current) {
      event.preventDefault(); if (!vp) return;
      gesture.current = { id: event.pointerId, kind: 'pan', x: event.clientX, y: event.clientY, left: vp.scrollLeft, top: vp.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (!placement || !editor) return;
    if (tool === 'draw') {
      event.preventDefault(); const uv = sourcePoint(event, placement), res = MAP_BY_ID[activeMap].workRes;
      editor.paintBegin(activeMap, uv.x * res, uv.y * res, { color: editor.brushColor, size: editor.brushSize, clipKey: placement.part.id, name: 'Peinture UV' });
      gesture.current = { id: event.pointerId, kind: 'paint', placement }; event.currentTarget.setPointerCapture(event.pointerId);
    } else if (tool === 'eyedropper') {
      const uv = sourcePoint(event, placement), res = MAP_BY_ID[activeMap].workRes, color = editor.pickColorAt(uv.x * res, uv.y * res);
      if (color) editor.pickHandler?.(color);
    } else onSelect(placement.part);
  };
  const pointerMove = (event: ReactPointerEvent) => {
    const active = gesture.current; if (!active || active.id !== event.pointerId) return;
    if (active.kind === 'pan') {
      viewport.current?.scrollTo(active.left + active.x - event.clientX, active.top + active.y - event.clientY); return;
    }
    const uv = sourcePoint(event, active.placement), res = MAP_BY_ID[activeMap].workRes;
    editor?.paintMove(uv.x * res, uv.y * res);
  };
  const reset = () => center({ x: .5, y: .5, w: 0, h: 0 }, 1);
  return <section hidden={hidden} className={`uv-global-atlas${channelView ? ` uv-global-atlas--${channelView}` : ''}${tool === 'draw' ? ' uv-global-atlas--draw' : ''}`} aria-label="Planche UV globale organisée" onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) return;
    if (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '0') {
      event.preventDefault(); event.stopPropagation();
      if (event.key === '0') reset(); else zoomBy(event.key === '-' ? 1 / 1.5 : 1.5);
    }
  }}>
    <div className="uv-atlas-toolbar">
      <label><Icon name="target" size={14} /><select aria-label="Cadrer une pièce sur la planche UV" value="" onChange={event => {
        const group = layout.groups.find(g => g.key === event.target.value);
        if (group) center(group, Math.max(1, Math.min(12, .85 / Math.max(group.w, group.h))));
      }}><option value="">Cadrer une pièce…</option>{layout.groups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label>
      <div className="uv-atlas-zoom"><button type="button" className="btn btn-ghost btn-sm" aria-label="Réduire la planche UV" disabled={zoom === 1} onClick={() => zoomBy(1 / 1.5)}><Icon name="minus" size={14} /></button><button type="button" className="btn btn-ghost btn-sm" title="Voir toute la planche UV" onClick={reset}>{Math.round(zoom * 100)} %</button><button type="button" className="btn btn-ghost btn-sm" aria-label="Agrandir la planche UV" disabled={zoom === 12} onClick={() => zoomBy(1.5)}><Icon name="plus" size={14} /></button></div>
    </div>
    <div className="uv-atlas-viewport" ref={viewport}>
      {organization.error || !layout.placements.length ? <div className="uv-atlas-empty" role="status"><p>{organization.error || 'Aucun contour UV disponible pour cette surface.'}</p><button type="button" className="btn btn-sm" onClick={onOriginal}>Afficher les UV d’origine</button></div> :
      <div className="uv-atlas-centering"><div className="uv-atlas-sheet" ref={sheet} style={{ width: size * zoom, height: size * zoom }}>
        <svg viewBox="0 0 1000 1000" className="uv-atlas-background" aria-hidden="true">{layout.groups.map(g => <rect key={g.key} x={g.x * 1000} y={g.y * 1000} width={g.w * 1000} height={g.h * 1000} rx={3} />)}</svg>
        <canvas ref={canvas} width={1024} height={1024} aria-label="Texture répartie sur les éléments UV réorganisés" />
        <svg className="uv-atlas-guide" viewBox="0 0 1000 1000" aria-label="Éléments de la planche UV" onPointerDown={pointerDown} onPointerMove={pointerMove}
          onPointerUp={event => { if (gesture.current?.id === event.pointerId) finish(); }} onPointerCancel={finish} onLostPointerCapture={finish}
          onDoubleClick={event => { const id = (event.target as Element).closest('[data-part]')?.getAttribute('data-part'); const part = layout.placements.find(p => p.part.id === id)?.part; if (part && tool !== 'draw' && tool !== 'eyedropper') onEdit(part); }}>
          {layout.placements.map((p, index) => <path key={p.part.id} data-part={p.part.id} d={uvAtlasPath(p.part)} transform={`matrix(${p.matrix.map(n => n * 1000).join(' ')})`}
            fillRule={p.part.region.fillRule ?? 'nonzero'} vectorEffect="non-scaling-stroke" className={`${showGuide ? 'has-guide ' : ''}${p.part.id === selected ? 'is-selected' : ''}`}
            role="button" aria-label={`Sélectionner ${p.part.region.label} sur la planche`} aria-pressed={p.part.id === selected} tabIndex={selected ? p.part.id === selected ? 0 : -1 : index === 0 ? 0 : -1}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(p.part); }
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault(); const next = layout.placements[(index + (event.key === 'ArrowRight' ? 1 : layout.placements.length - 1)) % layout.placements.length];
                onSelect(next.part); const paths = event.currentTarget.parentElement?.querySelectorAll<SVGPathElement>('[data-part]'); paths?.[layout.placements.indexOf(next)]?.focus();
              }
            }}><title>{p.part.region.label} · double-cliquer pour modifier en détail</title></path>)}
          {layout.groups.map(g => {
            const font = Math.min(13, g.header * 480), maxChars = Math.max(3, Math.floor((g.w - .012) * 1000 / (font * .64)));
            return <text key={g.key} x={(g.x + .006) * 1000} y={(g.y + g.header * .68) * 1000} fontSize={font}><title>{g.label}</title>{g.label.length > maxChars ? `${g.label.slice(0, maxChars - 1)}…` : g.label}</text>;
          })}
        </svg>
      </div></div>}
    </div>
    <div className="uv-atlas-footer"><div><strong>{chosen ? chosen.part.region.label : `${layout.placements.length} éléments · UV regroupés par pièce`}</strong><span>{tool === 'draw' ? 'Peignez directement sur une forme. Le trait reste dans ses contours.' : tool === 'eyedropper' ? 'Cliquez sur la texture pour prélever une couleur.' : 'Sélectionnez une forme pour la remplir ou lui appliquer une matière.'}</span><small>Molette : zoom · Alt + glisser ou bouton du milieu : déplacer</small></div>
      {chosen && <button type="button" className="btn btn-sm" onClick={() => onEdit(chosen.part)}><Icon name="pen" size={14} /> Modifier en détail</button>}
    </div>
  </section>;
}
