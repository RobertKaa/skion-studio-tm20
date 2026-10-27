import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { WHEEL_DESIGN_PRESETS, normalizeWheelDesign, type WheelDesignPattern, type WheelDesignSettings } from '../wheelDesign';
import {
  MAX_WHEEL_ELEMENTS, MAX_WHEEL_LOGO_CHARACTERS, WHEEL_COMPOSITION_STYLES, createWheelElement,
  drawWheelComposition, isValidWheelArtwork, loadWheelCompositionImages, normalizeWheelComposition,
  type WheelDesignArtwork, type WheelDesignComposition, type WheelDesignElement,
} from '../wheelDesignComposition';
import { importWheelLogo } from '../wheelDesignLogo';
import { Icon, type IconName } from './Icon';
import { Swatch } from './controls';
import './wheelDesign.css';

export type WheelDesignTarget = 'outer' | 'inner' | 'both';
/** An alpha mask in artwork coordinates, for the side currently shown in 3D. */
export type WheelDesignCoverage = { side: 'outer' | 'inner'; mask: HTMLCanvasElement | null; alignmentConflict?: boolean | null } | null;
const ICONS: Record<WheelDesignPattern, IconName> = { ring: 'circle', 'double-ring': 'circle', segments: 'target', checker: 'grid', lettering: 'type', chevrons: 'chevronRight', dots: 'more', emblem: 'star', image: 'image' };
const NAMES: Record<WheelDesignPattern, string> = { ring: 'Anneau', 'double-ring': 'Double filet', segments: 'Graduations', checker: 'Damier', lettering: 'Texte', chevrons: 'Chevrons', dots: 'Points', emblem: 'Emblème', image: 'Logo' };
const PIGMENTS = ['#f2efe6', '#b9c1c6', '#75d7ba', '#4ad3ed', '#a3f46c', '#f2cb5c', '#f06a32', '#f06c8b', '#b49cf8', '#172026'];
const RUBBERS = [
  { id: 'black', label: 'Pneu noir', color: '#242b2e' }, { id: 'graphite', label: 'Pneu graphite', color: '#596268' },
  { id: 'cream', label: 'Pneu clair', color: '#d1cec1' }, { id: 'transparent', label: 'Fond transparent', color: 'transparent' },
];
const percent = (value: number) => Math.round(value * 1000) / 10;
const clone = (composition: WheelDesignComposition) => structuredClone(composition);
const logoName = (name: string) => Array.from(name.replace(/\.[^.]+$/, '').trim()).filter(character => {
  const code = character.codePointAt(0)!;
  return code >= 32 && !(code >= 127 && code <= 159) && !(code >= 0x2028 && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069);
}).slice(0, 48).join('') || 'Logo personnel';

/** Transparent source shared by the workshop preview, editable layer, and export. */
function DesignCanvas({ composition, size, label, onError }: { composition: WheelDesignComposition; size: number; label: string; onError?(message: string): void }) {
  const ref = useRef<HTMLCanvasElement>(null), images = useRef(new Map<string, HTMLImageElement>()), sources = useRef(new Map<string, string>());
  const errorHandler = useRef(onError); errorHandler.current = onError;
  useEffect(() => {
    let alive = true;
    const safe = normalizeWheelComposition(composition);
    for (const element of safe.elements) {
      if (element.design.pattern === 'lettering' && !composition.elements.find(item => item.id === element.id)?.design.text.trim()) element.visible = false;
      if (sources.current.get(element.id) !== element.design.imageData) images.current.delete(element.id);
    }
    const paint = () => { const context = ref.current?.getContext('2d'); if (context) drawWheelComposition(context, safe, images.current); };
    try { paint(); } catch (cause) { errorHandler.current?.(cause instanceof Error ? cause.message : 'Aperçu indisponible.'); }
    void loadWheelCompositionImages(safe).then(loaded => {
      if (!alive) return;
      images.current = loaded; sources.current = new Map(safe.elements.map(element => [element.id, element.design.imageData ?? ''])); paint();
    }).catch(cause => { if (alive) errorHandler.current?.(cause instanceof Error ? cause.message : 'Le logo ne peut pas être affiché.'); });
    return () => { alive = false; };
  }, [composition]);
  return <canvas ref={ref} width={size} height={size} role="img" aria-label={label} />;
}

/** Draw guidance above the artwork; this canvas is never part of the exported image. */
function CoverageCanvas({ mask }: { mask: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !mask.width || !mask.height) return;
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    try {
      // Keep unavailable artwork visible as a ghost, with a distinct hatch.
      ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(9, 15, 19, .78)'; ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mask, 0, 0, size, size);
      ctx.globalCompositeOperation = 'source-atop'; ctx.strokeStyle = 'rgba(164, 188, 193, .2)'; ctx.lineWidth = 1;
      for (let x = -size; x < size * 2; x += 18) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + size, size); ctx.stroke();
      }
    } finally { ctx.restore(); }
  }, [mask]);
  return <canvas className="wheel-design-coverage" ref={ref} width={640} height={640} aria-hidden="true" />;
}

function PrecisionField({ label, value, min, max, step = .1, unit, onChange, onStart, onEnd }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string;
  onChange(value: number): void; onStart(): void; onEnd(): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) onChange(Math.max(min, Math.min(max, Number(draft))));
    setDraft(null); onEnd();
  };
  return <label className="wheel-design-field"><span>{label}</span>
    <div><input aria-label={label} type="number" min={min} max={max} step={step} value={draft ?? value} onFocus={onStart} onBlur={finish}
      onChange={event => { const next = event.target.value; setDraft(next); if (next !== '' && Number.isFinite(event.target.valueAsNumber) && event.target.valueAsNumber >= min && event.target.valueAsNumber <= max) onChange(event.target.valueAsNumber); }} /><span>{unit}</span></div>
    <input aria-label={label + ' · curseur'} type="range" min={min} max={max} step={step} value={value}
      onPointerDown={onStart} onPointerUp={onEnd} onPointerCancel={onEnd} onFocus={onStart} onBlur={onEnd} onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

/** Edits a draft; only applying it changes the captured layer and its history. */
export function WheelDesignDialog({ initial, initialTarget = 'outer', editing, onApply, onClose, modelPreview }: {
  initial?: WheelDesignArtwork; initialTarget?: WheelDesignTarget; editing: boolean;
  onApply(settings: WheelDesignArtwork, target: WheelDesignTarget): Promise<void>; onClose(): void;
  modelPreview?(composition: WheelDesignComposition, target: WheelDesignTarget, onCoverageChange: (coverage: WheelDesignCoverage) => void): ReactNode;
}) {
  const [composition, setComposition] = useState<WheelDesignComposition>(() => initial ? normalizeWheelComposition(initial) : clone(WHEEL_COMPOSITION_STYLES[0].composition));
  const current = useRef(composition); current.current = composition;
  const [selectedId, setSelectedId] = useState(() => composition.elements.at(-1)!.id), selectedRef = useRef(selectedId); selectedRef.current = selectedId;
  const [target, setTarget] = useState(initialTarget), [libraryTab, setLibraryTab] = useState<'elements' | 'styles'>('elements');
  const [previewMode, setPreviewMode] = useState<'split' | 'construction' | 'model'>(() => modelPreview ? 'split' : 'construction');
  const [guides, setGuides] = useState(true), [showCoverage, setShowCoverage] = useState(true), [rubber, setRubber] = useState('black');
  const [coverage, setCoverage] = useState<WheelDesignCoverage>(null);
  const [applying, setApplying] = useState(false), [importing, setImporting] = useState(false), [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null), dial = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const running = useRef(false), uploading = useRef(false), alive = useRef(true), uploadToken = useRef(0), importTarget = useRef<string | null>(null);
  const history = useRef<{ past: WheelDesignComposition[]; future: WheelDesignComposition[] }>({ past: [], future: [] });
  const transaction = useRef<{ before: WheelDesignComposition; saved: boolean; past: WheelDesignComposition[]; future: WheelDesignComposition[] } | null>(null);
  const dragging = useRef<{ pointer: number; before: WheelDesignComposition; past: WheelDesignComposition[]; future: WheelDesignComposition[];
    clientX: number; clientY: number; offsetX: number; offsetY: number; width: number; moved: boolean } | null>(null);
  const id = useId(), busy = applying || importing;
  const selected = composition.elements.find(element => element.id === selectedId) ?? composition.elements.at(-1)!;
  const settings = selected.design, locked = selected.locked, selectedIndex = composition.elements.indexOf(selected);
  const descriptor = WHEEL_DESIGN_PRESETS.find(preset => preset.id === settings.pattern)!;
  const begin = () => { if (!transaction.current) transaction.current = { before: clone(current.current), saved: false, past: [...history.current.past], future: [...history.current.future] }; };
  const end = () => {
    const group = transaction.current; transaction.current = null;
    if (group?.saved && JSON.stringify(group.before) === JSON.stringify(current.current)) {
      history.current = { past: group.past, future: group.future }; setComposition(clone(current.current));
    }
  };
  const blocked = () => running.current || uploading.current;
  const commit = (next: WheelDesignComposition) => {
    if (blocked() || JSON.stringify(next) === JSON.stringify(current.current)) return;
    const group = transaction.current;
    if (!group || !group.saved) {
      history.current.past.push(clone(group?.before ?? current.current)); if (history.current.past.length > 40) history.current.past.shift();
      if (group) group.saved = true;
    }
    history.current.future = []; current.current = next; setComposition(next); setError('');
    if (!next.elements.some(element => element.id === selectedRef.current)) setSelectedId(next.elements.at(-1)!.id);
  };
  const update = (change: (element: WheelDesignElement) => WheelDesignElement) => {
    if (!blocked()) commit({ version: 2, elements: current.current.elements.map(element => element.id === selectedRef.current ? change(element) : element) });
  };
  const patch = (change: Partial<WheelDesignSettings>) => {
    const active = current.current.elements.find(element => element.id === selectedRef.current);
    if (!active || active.locked || blocked()) return;
    update(element => {
      const next = { ...element.design, ...change };
      if (change.radius !== undefined) next.width = Math.min(next.width, 2 * (1 - next.radius));
      if (change.width !== undefined) next.radius = Math.min(next.radius, 1 - next.width / 2);
      return { ...element, design: { ...normalizeWheelDesign(next), text: change.text ?? element.design.text } };
    });
  };
  const cancelGesture = () => {
    const gesture = dragging.current;
    if (!gesture) return false;
    dragging.current = null; transaction.current = null;
    history.current = { past: gesture.past, future: gesture.future };
    current.current = gesture.before; setComposition(gesture.before); return true;
  };
  const undo = () => {
    if (blocked() || cancelGesture()) return; end(); const previous = history.current.past.pop(); if (!previous) return;
    history.current.future.push(clone(current.current)); current.current = previous; setComposition(previous); setError('');
    if (!previous.elements.some(element => element.id === selectedRef.current)) setSelectedId(previous.elements.at(-1)!.id);
  };
  const redo = () => {
    if (blocked() || cancelGesture()) return; end(); const next = history.current.future.pop(); if (!next) return;
    history.current.past.push(clone(current.current)); current.current = next; setComposition(next); setError('');
    if (!next.elements.some(element => element.id === selectedRef.current)) setSelectedId(next.elements.at(-1)!.id);
  };
  const add = (pattern: WheelDesignPattern) => {
    if (blocked() || dragging.current || current.current.elements.length >= MAX_WHEEL_ELEMENTS) return; end();
    if (pattern === 'image') { importTarget.current = null; fileInput.current?.click(); return; }
    const element = createWheelElement(pattern); commit({ version: 2, elements: [...current.current.elements, element] }); setSelectedId(element.id);
  };
  const duplicate = () => {
    if (blocked() || dragging.current || current.current.elements.length >= MAX_WHEEL_ELEMENTS) return;
    const element = current.current.elements.find(item => item.id === selectedRef.current)!;
    const imageTotal = current.current.elements.reduce((total, item) => total + (item.design.imageData?.length ?? 0), element.design.imageData?.length ?? 0);
    if (imageTotal > MAX_WHEEL_LOGO_CHARACTERS) { setError('Les logos de la composition dépasseraient la taille autorisée.'); return; }
    end(); const copy = { ...structuredClone(element), id: createWheelElement(element.design.pattern).id, name: (element.name.slice(0, 39) + ' · copie').slice(0, 48), locked: false };
    const elements = [...current.current.elements]; elements.splice(elements.indexOf(element) + 1, 0, copy); commit({ version: 2, elements }); setSelectedId(copy.id);
  };
  const remove = () => {
    const element = current.current.elements.find(item => item.id === selectedRef.current);
    if (blocked() || dragging.current || !element || element.locked || current.current.elements.length < 2) return; end();
    commit({ version: 2, elements: current.current.elements.filter(item => item.id !== element.id) });
  };
  const move = (delta: number) => {
    if (blocked() || dragging.current) return; end();
    const elements = [...current.current.elements], at = elements.findIndex(element => element.id === selectedRef.current), to = at + delta;
    if (at < 0 || to < 0 || to >= elements.length) return;
    [elements[at], elements[to]] = [elements[to], elements[at]]; commit({ version: 2, elements });
  };
  const choose = (elementId: string) => { if (!blocked() && !dragging.current) { end(); setSelectedId(elementId); setError(''); } };
  const changePattern = (pattern: WheelDesignPattern) => {
    if (locked || blocked() || dragging.current) return; end();
    update(element => { const replacement = createWheelElement(pattern); return { ...element,
      name: element.name === descriptor.label ? replacement.name : element.name,
      design: normalizeWheelDesign({ ...replacement.design, color: element.design.color, radius: element.design.radius, angle: element.design.angle }) }; });
  };
  const importLogo = async (file: File) => {
    if (blocked()) return;
    const token = ++uploadToken.current, targetId = importTarget.current;
    uploading.current = true; setImporting(true); setError(''); end();
    try {
      const imageData = await importWheelLogo(file);
      if (!alive.current || token !== uploadToken.current) return;
      const elements = current.current.elements, destination = targetId ? elements.find(element => element.id === targetId) : undefined;
      if (targetId && !destination) return;
      const imageTotal = elements.reduce((total, element) => total + (element.id === targetId ? 0 : element.design.imageData?.length ?? 0), imageData.length);
      if (imageTotal > MAX_WHEEL_LOGO_CHARACTERS) throw new Error('Les logos de la composition dépassent la taille autorisée.');
      if (!destination && elements.length >= MAX_WHEEL_ELEMENTS) throw new Error('La composition contient déjà 24 éléments.');
      const element = destination ? { ...destination, design: { ...destination.design, imageData } }
        : { ...createWheelElement('image'), name: logoName(file.name) };
      if (!destination) element.design.imageData = imageData;
      uploading.current = false; commit({ version: 2, elements: destination ? elements.map(item => item.id === targetId ? element : item) : [...elements, element] }); setSelectedId(element.id);
    } catch (cause) { if (alive.current && token === uploadToken.current) setError(cause instanceof Error ? cause.message : 'Le logo n’a pas pu être importé.'); }
    finally { if (alive.current && token === uploadToken.current) { uploading.current = false; setImporting(false); } }
  };
  const apply = async () => {
    if (blocked()) return; end(); const draft = current.current;
    const text = draft.elements.find(element => element.design.pattern === 'lettering' && (!element.design.text.trim() || Array.from(element.design.text).length > 64));
    if (text) { setError('L’inscription de « ' + text.name + ' » doit contenir de 1 à 64 caractères.'); setSelectedId(text.id); return; }
    const image = draft.elements.find(element => element.visible && element.design.pattern === 'image' && !element.design.imageData);
    if (image) { setError('Importez un logo pour « ' + image.name + ' » avant d’appliquer.'); setSelectedId(image.id); return; }
    if (!draft.elements.some(element => element.visible && element.opacity > 0)) { setError('Rendez au moins un élément visible avant d’appliquer.'); return; }
    if (!isValidWheelArtwork(draft)) { setError('Vérifiez le nom, le texte et les réglages de chaque élément.'); return; }
    running.current = true; setApplying(true); setError('');
    try { await onApply(clone(draft), target); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'La composition n’a pas pu être appliquée.'); }
    finally { running.current = false; if (alive.current) setApplying(false); }
  };
  const gesturePosition = (event: ReactPointerEvent<SVGCircleElement>) => {
    const gesture = dragging.current, rect = dial.current?.getBoundingClientRect();
    if (!gesture || !rect?.width || !rect.height) return;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 1) return;
    gesture.moved = true;
    const x = (event.clientX - rect.left) / rect.width - .5 - gesture.offsetX;
    const y = (event.clientY - rect.top) / rect.height - .5 - gesture.offsetY;
    const radius = Math.max(.6, Math.min(.98, Math.hypot(x, y) * 2));
    let angle = Math.atan2(y, x) * 180 / Math.PI + 90; angle = ((angle + 540) % 360) - 180;
    if (event.shiftKey) angle = Math.round(angle / 15) * 15;
    patch({ radius: Math.round(radius * 1000) / 1000, angle: Math.round(angle * 10) / 10, width: gesture.width });
  };
  const dragStart = (event: ReactPointerEvent<SVGCircleElement>) => {
    const active = current.current.elements.find(element => element.id === selectedRef.current), rect = dial.current?.getBoundingClientRect();
    if (!active || active.locked || blocked() || !active.visible || !rect?.width || !rect.height) return;
    event.preventDefault(); end(); begin();
    const angle = (active.design.angle - 90) * Math.PI / 180;
    dragging.current = { pointer: event.pointerId, before: clone(current.current), past: [...history.current.past], future: [...history.current.future],
      clientX: event.clientX, clientY: event.clientY, width: active.design.width, moved: false,
      offsetX: (event.clientX - rect.left) / rect.width - .5 - Math.cos(angle) * active.design.radius / 2,
      offsetY: (event.clientY - rect.top) / rect.height - .5 - Math.sin(angle) * active.design.radius / 2 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const dragEnd = (event: ReactPointerEvent<SVGCircleElement>, cancel = false) => {
    if (!dragging.current || dragging.current.pointer !== event.pointerId) return;
    if (cancel) cancelGesture(); else dragging.current = null;
    end(); event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const actions = useRef({ undo, redo, remove, duplicate, patch, cancelGesture }); actions.current = { undo, redo, remove, duplicate, patch, cancelGesture };
  useEffect(() => {
    alive.current = true; uploadToken.current++; const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const keydown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      const element = event.target as HTMLElement, input = element instanceof HTMLInputElement ? element : null;
      const textInput = element.isContentEditable || element.tagName === 'TEXTAREA' || !!input && ['text', 'number', 'search'].includes(input.type);
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!actions.current.cancelGesture() && !blocked()) close.current();
        return;
      }
      if (event.key === 'Tab') {
        const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="file"]), select:not(:disabled), [tabindex="0"]')].filter(control => !control.closest('[hidden]'));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !panel.current!.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.current!.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        if (!blocked()) { if (textInput) element.blur(); actions.current.duplicate(); }
        return;
      }
      if (!textInput && (event.ctrlKey || event.metaKey)) {
        const key = event.key.toLowerCase();
        if (key === 'z') { event.preventDefault(); if (event.shiftKey) actions.current.redo(); else actions.current.undo(); }
        else if (key === 'y') { event.preventDefault(); actions.current.redo(); }
      } else if (!textInput && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); actions.current.remove(); }
      else if (element.dataset.wheelHandle === 'true' && !blocked()) {
        const active = current.current.elements.find(item => item.id === selectedRef.current), design = active?.design;
        if (design && active.visible && !active.locked && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') actions.current.patch({ angle: Math.max(-180, Math.min(180, design.angle + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 15 : 1))) });
          else actions.current.patch({ radius: Math.max(.6, Math.min(.98, design.radius + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? .01 : .001))) });
        }
      } else if (textInput && event.key === 'Enter') { event.preventDefault(); element.blur(); }
    };
    const keyup = (event: KeyboardEvent) => event.stopImmediatePropagation();
    document.addEventListener('keydown', keydown, true); document.addEventListener('keyup', keyup, true);
    return () => { alive.current = false; document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup, true); previous?.focus(); };
  }, []);
  const field = (label: string, value: number, min: number, max: number, unit: string, onChange: (value: number) => void, step = .1) =>
    <PrecisionField label={label} value={value} min={min} max={max} step={step} unit={unit} onChange={onChange} onStart={begin} onEnd={end} />;
  const rubberColor = RUBBERS.find(item => item.id === rubber)!.color, radians = (settings.angle - 90) * Math.PI / 180;
  const handleX = 320 + Math.cos(radians) * settings.radius * 320, handleY = 320 + Math.sin(radians) * settings.radius * 320;
  const textPattern = settings.pattern === 'lettering', graphicPattern = settings.pattern === 'emblem' || settings.pattern === 'image';
  const repeatPattern = ['segments', 'checker', 'chevrons', 'dots'].includes(settings.pattern);
  return <div className="modal-overlay wheel-design-overlay" onClick={() => { if (!blocked()) onClose(); }}>
    <div className="wheel-design-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby={id + '-title'} onClick={event => event.stopPropagation()}>
      <header className="wheel-design-header"><div><span className="wheel-design-eyebrow">SKION / WHEEL STUDIO</span><h2 id={id + '-title'}>Votre signature. Sans limite de style.</h2><p>Superposez formes, inscriptions et logos. Chaque détail reste modifiable.</p></div>
        <div className="wheel-design-history" role="group" aria-label="Historique de l’atelier">
          <button type="button" className="iconbtn" aria-label="Annuler dans l’atelier" title="Annuler · Ctrl+Z" disabled={busy || !history.current.past.length} onClick={undo}><Icon name="undo" size={16} /></button>
          <button type="button" className="iconbtn" aria-label="Rétablir dans l’atelier" title="Rétablir · Ctrl+Maj+Z" disabled={busy || !history.current.future.length} onClick={redo}><Icon name="redo" size={16} /></button><span />
          <button type="button" className="iconbtn" aria-label="Fermer l’atelier de flancs" disabled={busy} onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
      </header>
      <div className="wheel-design-body">
        <aside className="wheel-design-library" aria-label="Composition du flanc">
          <div className="wheel-design-library-tabs" role="tablist" aria-label="Bibliothèque de l’atelier"><button type="button" role="tab" aria-selected={libraryTab === 'elements'} disabled={busy} onClick={() => setLibraryTab('elements')}>Éléments <span>{composition.elements.length}</span></button><button type="button" role="tab" aria-selected={libraryTab === 'styles'} disabled={busy} onClick={() => setLibraryTab('styles')}>Styles</button></div>
          <div className="wheel-design-library-scroll">
            {libraryTab === 'elements' ? <>
              <div className="wheel-design-section-heading"><span>AJOUTER</span><span>{composition.elements.length} / {MAX_WHEEL_ELEMENTS}</span></div>
              <div className="wheel-design-add-grid" role="group" aria-label="Ajouter un élément">{WHEEL_DESIGN_PRESETS.map(preset => <button type="button" key={preset.id} aria-label={'Ajouter · ' + preset.label} title={preset.description} disabled={busy || composition.elements.length >= MAX_WHEEL_ELEMENTS} onClick={() => add(preset.id)}><Icon name={ICONS[preset.id]} size={17} /><span>{NAMES[preset.id]}</span></button>)}</div>
              <div className="wheel-design-section-heading"><span>COMPOSITION</span><span>Premier plan en haut</span></div>
              <div className="wheel-design-stack" role="list" aria-label="Éléments du flanc">{[...composition.elements].reverse().map(element => <div key={element.id} role="listitem" className={'wheel-design-element' + (selected.id === element.id ? ' is-active' : '') + (!element.visible ? ' is-hidden' : '')}>
                <button type="button" className="wheel-design-element-select" aria-label={'Sélectionner · ' + element.name} aria-pressed={selected.id === element.id} disabled={busy} onClick={() => choose(element.id)}><DesignCanvas composition={{ version: 2, elements: [{ ...element, visible: true, opacity: 1 }] }} size={64} label={'Miniature · ' + element.name} /><span><strong>{element.name || 'Sans nom'}</strong><small>{NAMES[element.design.pattern]}</small></span></button>
                <button type="button" className="wheel-design-element-icon" disabled={busy} aria-label={(element.visible ? 'Masquer · ' : 'Afficher · ') + element.name} onClick={() => { end(); commit({ version: 2, elements: current.current.elements.map(item => item.id === element.id ? { ...item, visible: !item.visible } : item) }); }}><Icon name={element.visible ? 'eye' : 'eyeOff'} size={13} /></button>
                <button type="button" className="wheel-design-element-icon" disabled={busy} aria-label={(element.locked ? 'Déverrouiller · ' : 'Verrouiller · ') + element.name} onClick={() => { end(); commit({ version: 2, elements: current.current.elements.map(item => item.id === element.id ? { ...item, locked: !item.locked } : item) }); }}><Icon name={element.locked ? 'lock' : 'unlock'} size={12} /></button>
              </div>)}</div>
              <div className="wheel-design-stack-tools" role="group" aria-label="Actions sur l’élément sélectionné">
                <button type="button" className="iconbtn" disabled={busy || composition.elements.length >= MAX_WHEEL_ELEMENTS} aria-label="Dupliquer l’élément" title="Dupliquer · Ctrl+D" onClick={duplicate}><Icon name="copy" size={14} /></button>
                <button type="button" className="iconbtn" disabled={busy || selectedIndex === composition.elements.length - 1} aria-label="Monter l’élément" title="Monter au premier plan" onClick={() => move(1)}><Icon name="chevronUp" size={15} /></button>
                <button type="button" className="iconbtn" disabled={busy || selectedIndex === 0} aria-label="Descendre l’élément" title="Descendre à l’arrière-plan" onClick={() => move(-1)}><Icon name="chevronDown" size={15} /></button>
                <button type="button" className="iconbtn wheel-design-delete" disabled={busy || locked || composition.elements.length < 2} aria-label="Supprimer l’élément" title="Supprimer l’élément" onClick={remove}><Icon name="trash" size={14} /></button>
              </div>
            </> : <>
              <div className="wheel-design-section-heading"><span>POINTS DE DÉPART</span><span>{WHEEL_COMPOSITION_STYLES.length} styles</span></div><p className="wheel-design-library-note">Une composition complète, entièrement modifiable. Son chargement peut être annulé.</p>
              <div className="wheel-design-style-list">{WHEEL_COMPOSITION_STYLES.map(style => <button type="button" key={style.id} className="wheel-design-style" aria-label={'Charger le style · ' + style.label} disabled={busy} onClick={() => { end(); const next = clone(style.composition); commit(next); setSelectedId(next.elements.at(-1)!.id); }}><DesignCanvas composition={style.composition} size={112} label={'Style · ' + style.label} /><span><strong>{style.label}</strong><small>{style.description}</small></span></button>)}</div>
            </>}
          </div>
        </aside>
        <section className={'wheel-design-preview' + (rubber === 'transparent' ? ' wheel-design-preview--transparent' : '')} aria-label="Aperçu de la composition">
          <div className="wheel-design-preview-head"><span>VOTRE COMPOSITION EN DIRECT</span><div className="wheel-design-preview-options">
            {modelPreview && <label title="Afficher les zones visibles sur le modèle"><input type="checkbox" aria-label="Zones visibles du modèle" checked={showCoverage} disabled={!coverage?.mask || previewMode === 'model'} onChange={event => setShowCoverage(event.target.checked)} /> Zones visibles</label>}
            <label><input type="checkbox" checked={guides} disabled={previewMode === 'model'} onChange={event => setGuides(event.target.checked)} /> Repères 2D</label>
          </div></div>
          {modelPreview && <div className="wheel-design-view-tabs" role="group" aria-label="Vue de l’atelier"><button type="button" aria-pressed={previewMode === 'split'} onClick={() => setPreviewMode('split')}>Côte à côte</button><button type="button" aria-pressed={previewMode === 'construction'} onClick={() => setPreviewMode('construction')}>Construction</button><button type="button" aria-pressed={previewMode === 'model'} onClick={() => setPreviewMode('model')}>Roue 3D</button></div>}
          <div className={'wheel-design-stage' + (previewMode === 'split' && modelPreview ? ' is-split' : ' is-solo')}>
          <div className="wheel-design-stage-lane" hidden={previewMode === 'model'}>
          <span className="wheel-design-stage-caption">CONSTRUCTION 2D</span>
          <div className="wheel-design-dial-wrap">
          <div className="wheel-design-dial" ref={dial}>
            <svg viewBox="0 0 640 640" aria-hidden="true"><defs><radialGradient id={id + '-rubber'}><stop offset="58%" stopColor={rubberColor} /><stop offset="78%" stopColor={rubberColor} /><stop offset="100%" stopColor={rubber === 'cream' ? '#a29f96' : rubber === 'graphite' ? '#353d42' : rubberColor === 'transparent' ? 'transparent' : '#11171b'} /></radialGradient></defs>
              <circle cx="320" cy="320" r="315" fill={'url(#' + id + '-rubber)'} />{[306, 300, 292, 201, 195, 189].map(radius => <circle key={radius} cx="320" cy="320" r={radius} fill="none" stroke={rubber === 'cream' ? '#4d5256' : '#8a989f'} strokeOpacity=".18" strokeWidth="1" />)}
              <circle cx="320" cy="320" r="184" fill={rubber === 'transparent' ? 'transparent' : '#11171b'} stroke="#455259" strokeWidth="2" />
              {guides && <g stroke="#7be8c6" strokeOpacity=".32" fill="none" strokeWidth="1"><path d="M320 0V640M0 320H640" strokeDasharray="3 8" /><circle cx="320" cy="320" r={settings.radius * 320} strokeDasharray="4 7" />{Array.from({ length: 72 }, (_, index) => <path key={index} transform={'rotate(' + index * 5 + ' 320 320)'} d={'M320 1V' + (index % 3 === 0 ? 15 : 8)} />)}</g>}
            </svg>
            <DesignCanvas composition={composition} size={640} label="Aperçu circulaire de la composition" onError={setError} />
            {showCoverage && coverage?.mask && <CoverageCanvas mask={coverage.mask} />}
            <div className="wheel-design-center"><span>{Math.round(settings.angle * 10) / 10}<small>°</small></span><p>{NAMES[settings.pattern].toUpperCase()}</p><small>{selected.locked ? 'ÉLÉMENT VERROUILLÉ' : 'RAYON ' + percent(settings.radius) + ' %'}</small></div>
            {guides && <svg className="wheel-design-interaction" viewBox="0 0 640 640"><line x1="320" y1="320" x2={handleX} y2={handleY} stroke="#7be8c6" strokeWidth="1" strokeDasharray="3 8" strokeOpacity=".45" />
              <circle className="wheel-design-handle" cx={handleX} cy={handleY} r="28" role="button" tabIndex={locked || busy || !selected.visible ? -1 : 0} aria-label="Déplacer l’élément sur le flanc" aria-disabled={locked || busy || !selected.visible} data-wheel-handle="true"
                onPointerDown={dragStart} onPointerMove={event => { if (dragging.current?.pointer === event.pointerId) gesturePosition(event); }} onPointerUp={event => dragEnd(event)} onPointerCancel={event => dragEnd(event, true)} fill="transparent" stroke="none"><title>Glisser : angle et rayon · Maj : pas de 15° · flèches : réglage précis</title></circle><circle className="wheel-design-handle-marker" cx={handleX} cy={handleY} r="9" fill={locked ? '#7b8b91' : '#7be8c6'} stroke="#152027" strokeWidth="3" pointerEvents="none" /></svg>}
          </div>
          </div></div>
          {modelPreview && <div className="wheel-design-stage-lane wheel-design-model-lane" hidden={previewMode === 'construction'}><span className="wheel-design-stage-caption">SUR VOTRE ROUE · EN DIRECT</span><div className="wheel-design-model-host">{modelPreview(composition, target, setCoverage)}</div></div>}
          </div>
          {modelPreview && previewMode !== 'model' && <div className="wheel-design-coverage-legend" aria-live="polite">
            {!coverage?.mask ? <span>Zones du modèle en attente ou indisponibles.</span> : showCoverage ? <>
              <span><i className="is-visible" /> Visible de face</span><span><i className="is-hidden" /> Masqué ou vide</span>
              <span className="wheel-design-coverage-side">Face {coverage.side === 'outer' ? 'extérieure' : 'intérieure'}</span>
            </> : <span>Zones du modèle masquées · Face {coverage.side === 'outer' ? 'extérieure' : 'intérieure'}</span>}
          </div>}
          {coverage?.alignmentConflict && <p className="wheel-design-alignment-warning" role="status">Ce modèle partage une texture entre des roues orientées différemment : le placement peut varier selon la roue.</p>}
          {coverage && coverage.alignmentConflict === null && <p className="wheel-design-alignment-warning" role="status">L’alignement des roues ne peut pas être vérifié pour ce modèle.</p>}
          <div className="wheel-design-support" role="group" aria-label="Support d’aperçu" hidden={previewMode === 'model'}><span>SUPPORT 2D</span>{RUBBERS.map(item => <button type="button" key={item.id} aria-label={item.label} aria-pressed={rubber === item.id} title={item.label + ' · aperçu uniquement'} onClick={() => setRubber(item.id)} style={{ '--rubber': item.color } as CSSProperties} className={item.id === 'transparent' ? 'is-checker' : ''} />)}<small>Aperçu uniquement</small></div>
          <div className="wheel-design-measures"><span>ÉLÉMENTS<strong>{composition.elements.length} / {MAX_WHEEL_ELEMENTS}</strong></span><span>SÉLECTION<strong>{NAMES[settings.pattern]}</strong></span><span>CALQUE<strong>{editing ? 'ÉDITION' : '+ 1'}</strong></span></div>
          <p className="wheel-design-preview-note">{previewMode === 'model' ? 'Le brouillon apparaît sur votre roue sans changer le projet. Orbitez et zoomez pour contrôler les détails.' : 'Glissez la poignée pour placer l’élément. Maj aligne tous les 15°. Les valeurs précises restent disponibles.'}</p>
        </section>
        <section className="wheel-design-controls" aria-label="Réglages de l’élément">
          <fieldset disabled={busy || locked}><legend><span>ÉLÉMENT SÉLECTIONNÉ</span>{locked && <Icon name="lock" size={12} />}</legend>
            <label className="wheel-design-name">Nom<input aria-label="Nom de l’élément" type="text" maxLength={48} value={selected.name} onFocus={begin} onBlur={end} onChange={event => update(element => ({ ...element, name: event.target.value }))} /></label>
            <label className="wheel-design-type">Type<select aria-label="Type d’élément" value={settings.pattern} onChange={event => changePattern(event.target.value as WheelDesignPattern)}>{WHEEL_DESIGN_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
            {settings.pattern !== 'image' && <><div className="wheel-design-color"><span>Couleur du motif</span><Swatch value={settings.color} onChange={color => patch({ color })} title="Couleur du motif" showHex /></div><div className="wheel-design-palette" role="group" aria-label="Pigments">{PIGMENTS.map(color => <button type="button" key={color} aria-label={'Pigment ' + color} aria-pressed={settings.color.toLowerCase() === color} style={{ '--pigment': color } as CSSProperties} onClick={() => { end(); patch({ color }); }} />)}</div></>}
            <div className="wheel-design-divider"><span>Position & dimensions</span></div>
            <div className="wheel-design-fields">{field('Rayon du motif', percent(settings.radius), 60, 98, '%', value => patch({ radius: value / 100 }))}{field(settings.pattern === 'image' ? 'Taille du logo' : textPattern ? 'Taille du texte' : 'Largeur du motif', percent(settings.width), .5, 16, '%', value => patch({ width: value / 100 }))}{field('Rotation du motif', settings.angle, -180, 180, '°', angle => patch({ angle }))}{field('Opacité de l’élément', percent(selected.opacity), 0, 100, '%', opacity => { if (!locked) update(element => ({ ...element, opacity: opacity / 100 })); }, 1)}</div>
            <div className="wheel-design-divider"><span>Lumière de l’élément</span></div>
            <div className="wheel-design-extra-field">{field('Intensité lumineuse', percent(selected.emission ?? 0), 0, 100, '%', emission => { if (!locked) update(element => ({ ...element, emission: emission / 100 })); }, 1)}</div>
            <label className="wheel-design-type">Activation<select aria-label="Activation lumineuse de l’élément" value={selected.emissionRole ?? 'always'} onChange={event => { end(); update(element => ({ ...element, emission: element.emission ?? 0, emissionRole: event.target.value as 'always' | 'brake' })); }}><option value="always">Toujours</option><option value="brake">Au freinage</option></select></label>
            <p className="wheel-design-control-note">La lumière reprend les couleurs de cet élément. À 0 %, il ne s’éclaire pas.</p>
            {repeatPattern && <><div className="wheel-design-divider"><span>Rythme du motif</span></div><div className="wheel-design-fields">{field('Répétitions', settings.count, 8, 96, '×', count => patch({ count }), 1)}{field('Ouverture du motif', settings.sweep ?? 360, 5, 360, '°', sweep => patch({ sweep }), 1)}{settings.pattern !== 'dots' && field('Part pleine du motif', percent(settings.gap ?? (settings.pattern === 'checker' ? 1 : .55)), 5, settings.pattern === 'checker' ? 100 : 95, '%', gap => patch({ gap: gap / 100 }), 1)}{settings.pattern === 'checker' && field('Rangées du damier', settings.rows ?? 2, 1, 5, '×', rows => patch({ rows }), 1)}</div></>}
            {(settings.pattern === 'ring' || settings.pattern === 'double-ring') && <div className="wheel-design-extra-field">{field('Ouverture du motif', settings.sweep ?? 360, 5, 360, '°', sweep => patch({ sweep }), 1)}</div>}
            {textPattern && <div className="wheel-design-lettering"><div className="wheel-design-divider"><span>Votre inscription</span><small>{Array.from(settings.text).length} / 64</small></div>
              <label>Texte<input aria-label="Inscription du pneu" type="text" maxLength={64} value={settings.text} onFocus={begin} onBlur={end} onChange={event => patch({ text: event.target.value })} spellCheck={false} /></label>
              <label>Typographie<select aria-label="Police du texte" value={settings.font ?? 'sans'} onChange={event => { end(); patch({ font: event.target.value as WheelDesignSettings['font'] }); }}><option value="sans">Sans · classique</option><option value="condensed">Condensée · course</option><option value="serif">Sérif · héritage</option><option value="mono">Mono · technique</option></select></label>
              <div className="wheel-design-toggle-row"><label><input type="checkbox" aria-label="Texte en italique" checked={settings.italic ?? false} onChange={event => { end(); patch({ italic: event.target.checked }); }} /> Italique</label><label><input type="checkbox" aria-label="Inverser le sens du texte" checked={settings.reverse ?? false} onChange={event => { end(); patch({ reverse: event.target.checked }); }} /> Sens inversé</label></div>
              <label className="wheel-design-auto-spacing"><input type="checkbox" aria-label="Espacement automatique du texte" checked={settings.tracking === undefined} onChange={event => { end(); if (event.target.checked) update(element => { const design = { ...element.design }; delete design.tracking; return { ...element, design }; }); else patch({ tracking: .08 }); }} /> Répartir les lettres sur tout l’arc</label>
              <div className="wheel-design-fields">{field('Arc disponible du texte', settings.arc, 60, 300, '°', arc => patch({ arc }), 1)}<fieldset className="wheel-design-inline-fieldset" disabled={settings.tracking === undefined}>{field('Espacement du texte', percent(settings.tracking ?? .08), 0, 200, '%', tracking => patch({ tracking: tracking / 100 }), 1)}</fieldset>{field('Contour du texte', percent(settings.outline ?? 0), 0, 2.5, '%', outline => patch({ outline: outline / 100 }))}{field('Répétition du texte', settings.repetitions ?? 1, 1, 24, '×', repetitions => patch({ repetitions }), 1)}</div>
              <p className="wheel-design-control-note">L’arc définit la place disponible. L’espacement détermine l’ouverture réelle des lettres.</p>
              <div className="wheel-design-color"><span>Couleur du contour</span><Swatch value={settings.outlineColor ?? '#172026'} onChange={outlineColor => patch({ outlineColor })} title="Couleur du contour" showHex /></div>
            </div>}
            {settings.pattern === 'emblem' && <div className="wheel-design-lettering"><div className="wheel-design-divider"><span>Emblème</span></div><label>Symbole<select aria-label="Symbole de l’emblème" value={settings.emblem ?? 'star'} onChange={event => { end(); patch({ emblem: event.target.value as WheelDesignSettings['emblem'] }); }}><option value="star">Étoile</option><option value="bolt">Éclair</option><option value="diamond">Losange</option><option value="cross">Croix</option></select></label></div>}
            {settings.pattern === 'image' && <div className="wheel-design-logo"><div className="wheel-design-divider"><span>Votre logo</span></div><button type="button" className="btn btn-full" onClick={() => { importTarget.current = selected.id; fileInput.current?.click(); }}><Icon name="upload" size={14} />{settings.imageData ? 'Remplacer le logo' : 'Importer un logo'}</button><p>PNG, JPEG ou WebP local. Proportions, transparence et couleurs d’origine conservées.</p></div>}
            {graphicPattern && <div className="wheel-design-extra-field wheel-design-fields">{field('Répétition de l’emblème ou du logo', settings.repetitions ?? 1, 1, 24, '×', repetitions => patch({ repetitions }), 1)}{field('Rotation du symbole', settings.rotation ?? 0, -180, 180, '°', rotation => patch({ rotation }))}</div>}
          </fieldset>
          {locked && <div className="wheel-design-lock-note"><Icon name="lock" size={14} /><p>Élément verrouillé. Déverrouillez-le dans la composition pour modifier ses réglages.</p></div>}
        </section>
      </div>
      <footer className="wheel-design-footer"><div className="wheel-design-footer-info">{error ? <p role="alert" className="wheel-design-error">{error}</p> : <><strong>{importing ? 'Préparation du logo…' : composition.elements.length + ' éléments · 1 composition'}</strong><span>Un calque modifiable · Ctrl+Z / Ctrl+Maj+Z dans l’atelier</span></>}</div>
        <label className="wheel-design-target">Appliquer sur<select aria-label="Flanc à décorer" disabled={busy} value={target} onChange={event => setTarget(event.target.value as WheelDesignTarget)}><option value="outer">Flanc extérieur</option><option value="inner">Flanc intérieur</option><option value="both">Les deux flancs</option></select></label>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply()}>{applying ? 'Application…' : importing ? 'Import du logo…' : editing ? 'Appliquer au calque' : 'Ajouter le calque'}<Icon name="plus" size={15} /></button>
      </footer>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Fichier du logo" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importLogo(file); }} />
    </div>
  </div>;
}
