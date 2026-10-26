import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_WHEEL_DESIGN, WHEEL_DESIGN_PRESETS, drawWheelDesign, isValidWheelDesign, normalizeWheelDesign, type WheelDesignSettings } from '../wheelDesign';
import { Icon } from './Icon';
import { Swatch } from './controls';
import './wheelDesign.css';

export type WheelDesignTarget = 'outer' | 'inner' | 'both';

function DesignCanvas({ settings, size, label }: { settings: WheelDesignSettings; size: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext('2d');
    if (context) drawWheelDesign(context, normalizeWheelDesign(settings));
  }, [settings]);
  return <canvas ref={ref} width={size} height={size} role="img" aria-label={label} />;
}

function PrecisionField({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange(value: number): void;
}) {
  return <label className="wheel-design-field">
    <span>{label}</span>
    <div><input aria-label={label} type="number" min={min} max={max} step={step} value={value}
      onChange={event => { if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber)) onChange(Math.max(min, Math.min(max, event.target.valueAsNumber))); }} /><span>{unit}</span></div>
    <input aria-label={`${label} · curseur`} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

/** Edits a draft; only applying it changes the captured layer and its history. */
export function WheelDesignDialog({ initial, initialTarget = 'outer', editing, onApply, onClose }: {
  initial?: WheelDesignSettings; initialTarget?: WheelDesignTarget; editing: boolean;
  onApply(settings: WheelDesignSettings, target: WheelDesignTarget): Promise<void>; onClose(): void;
}) {
  const [settings, setSettings] = useState(() => normalizeWheelDesign(initial ?? DEFAULT_WHEEL_DESIGN));
  const [target, setTarget] = useState(initialTarget);
  const [guides, setGuides] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null), close = useRef(onClose), running = useRef(false);
  close.current = onClose;
  const id = useId();
  const patch = (change: Partial<WheelDesignSettings>) => setSettings(current => {
    const next = { ...current, ...change };
    if (change.radius !== undefined) next.width = Math.min(next.width, 2 * (1 - next.radius));
    if (change.width !== undefined) next.radius = Math.min(next.radius, 1 - next.width / 2);
    return { ...normalizeWheelDesign(next), text: change.text ?? current.text };
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (!running.current) close.current(); }
      if (event.key === 'Tab') {
        const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !panel.current!.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.current!.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      } else if ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) event.preventDefault();
    };
    const keyup = (event: KeyboardEvent) => event.stopImmediatePropagation();
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keyup', keyup, true);
    return () => { document.removeEventListener('keydown', keydown, true); document.removeEventListener('keyup', keyup, true); previous?.focus(); };
  }, []);

  const apply = async () => {
    if (running.current) return;
    if (!isValidWheelDesign(settings)) { setError('Saisissez une inscription de 1 à 28 caractères, sans caractère de contrôle.'); return; }
    running.current = true; setApplying(true); setError('');
    try { await onApply(settings, target); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Le motif n’a pas pu être appliqué.'); }
    finally { running.current = false; setApplying(false); }
  };
  const selected = WHEEL_DESIGN_PRESETS.find(preset => preset.id === settings.pattern);
  const percent = (value: number) => Math.round(value * 1000) / 10;
  return <div className="modal-overlay wheel-design-overlay" onClick={() => { if (!running.current) onClose(); }}>
    <div className="wheel-design-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={event => event.stopPropagation()}>
      <header className="wheel-design-header">
        <div><span className="wheel-design-eyebrow">SKION / WHEEL STUDIO</span><h2 id={`${id}-title`}>L’art du détail.</h2><p>{editing ? 'Affinez le motif de ce calque.' : 'Composez un flanc, au dixième de pour cent près.'}</p></div>
        <button type="button" className="iconbtn" aria-label="Fermer l’atelier de flancs" disabled={applying} onClick={onClose}><Icon name="x" size={18} /></button>
      </header>
      <div className="wheel-design-body">
        <div className="wheel-design-preview">
          <div className="wheel-design-preview-head"><span>VUE DE CONSTRUCTION</span><label><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} /> Repères</label></div>
          <div className="wheel-design-dial">
            <svg viewBox="0 0 640 640" aria-hidden="true">
              <defs><radialGradient id={`${id}-rubber`}><stop offset="58%" stopColor="#101518" /><stop offset="76%" stopColor="#30383c" /><stop offset="94%" stopColor="#191f23" /><stop offset="100%" stopColor="#0c1013" /></radialGradient></defs>
              <circle cx="320" cy="320" r="315" fill={`url(#${id}-rubber)`} />
              {[306, 300, 292, 201, 195, 189].map(radius => <circle key={radius} cx="320" cy="320" r={radius} fill="none" stroke="#657177" strokeOpacity=".18" strokeWidth="1" />)}
              <circle cx="320" cy="320" r="184" fill="#11171b" stroke="#455259" strokeWidth="2" />
              <circle cx="320" cy="320" r="173" fill="none" stroke="#2a353b" strokeWidth="4" />
              {guides && <g stroke="#7be8c6" strokeOpacity=".3" fill="none" strokeWidth="1"><path d="M320 0V640M0 320H640" strokeDasharray="3 8" /><circle cx="320" cy="320" r={settings.radius * 320} strokeDasharray="4 7" />{Array.from({ length: 72 }, (_, index) => <path key={index} transform={`rotate(${index * 5} 320 320)`} d={`M320 1V${index % 3 === 0 ? 15 : 8}`} />)}</g>}
            </svg>
            <DesignCanvas settings={settings} size={640} label={`Aperçu circulaire : ${selected?.label ?? settings.pattern}`} />
            <div className="wheel-design-center"><span>{String(settings.angle).padStart(2, '0')}<small>°</small></span><p>ROTATION</p></div>
          </div>
          <div className="wheel-design-measures"><span>RAYON <strong>{percent(settings.radius)} %</strong></span><span>LARGEUR <strong>{percent(settings.width)} %</strong></span><span>CALQUE <strong>{editing ? 'ÉDITION' : '+ 1'}</strong></span></div>
          <p className="wheel-design-preview-note">Combinez plusieurs calques pour composer votre signature.</p>
        </div>
        <div className="wheel-design-controls">
          <fieldset disabled={applying}>
            <legend>01 <span>Choisir un motif</span></legend>
            <div className="wheel-design-patterns" role="group" aria-label="Motifs de flanc">
              {WHEEL_DESIGN_PRESETS.map(preset => <button type="button" key={preset.id} className={settings.pattern === preset.id ? 'is-active' : ''} aria-label={preset.label} aria-pressed={settings.pattern === preset.id} onClick={() => patch({ pattern: preset.id, width: preset.id === 'lettering' ? .075 : preset.id === 'checker' ? .08 : preset.id === 'segments' ? .05 : .018 })}>
                <DesignCanvas settings={{ ...DEFAULT_WHEEL_DESIGN, pattern: preset.id, width: preset.id === 'lettering' ? .12 : preset.id === 'checker' ? .12 : .035 }} size={80} label={preset.label} /><span>{preset.label}</span>
              </button>)}
            </div>
            <div className="wheel-design-divider">02 <span>Régler avec précision</span></div>
            <div className="wheel-design-color"><span>Couleur du motif</span><Swatch value={settings.color} onChange={color => patch({ color })} title="Couleur du motif" showHex /></div>
            <div className="wheel-design-fields">
              <PrecisionField label="Rayon du motif" value={percent(settings.radius)} min={60} max={98} step={.1} unit="%" onChange={value => patch({ radius: value / 100 })} />
              <PrecisionField label="Largeur du motif" value={percent(settings.width)} min={.5} max={16} step={.1} unit="%" onChange={value => patch({ width: value / 100 })} />
              <PrecisionField label="Rotation du motif" value={settings.angle} min={-180} max={180} step={.1} unit="°" onChange={angle => patch({ angle })} />
              {(settings.pattern === 'segments' || settings.pattern === 'checker') && <PrecisionField label="Répétitions" value={settings.count} min={8} max={96} step={1} unit="×" onChange={count => patch({ count })} />}
            </div>
            {settings.pattern === 'lettering' && <div className="wheel-design-lettering"><label>Inscription<input aria-label="Inscription du pneu" type="text" maxLength={28} value={settings.text} onChange={event => patch({ text: event.target.value })} spellCheck={false} /></label><PrecisionField label="Ouverture du texte" value={settings.arc} min={60} max={300} step={1} unit="°" onChange={arc => patch({ arc })} /></div>}
            <div className="wheel-design-divider">03 <span>Placer sur le pneu</span></div>
            <label className="wheel-design-target">Zone d’application<select aria-label="Flanc à décorer" value={target} onChange={event => setTarget(event.target.value as WheelDesignTarget)}><option value="outer">Flanc extérieur</option><option value="inner">Flanc intérieur</option><option value="both">Les deux flancs</option></select></label>
            <p className="hint">Les quatre pneus partagent leurs UV. Le motif suit les flancs ; la bande de roulement reste libre.</p>
          </fieldset>
        </div>
      </div>
      <footer className="wheel-design-footer"><div>{error ? <p role="alert" className="wheel-design-error">{error}</p> : <><strong>{selected?.label}</strong><span>Calque indépendant · modifiable · Ctrl+Z pour annuler</span></>}</div><button type="button" className="btn" disabled={applying} onClick={onClose}>Annuler</button><button type="button" className="btn btn-primary" disabled={applying} onClick={() => void apply()}>{applying ? 'Application…' : editing ? 'Appliquer au calque' : 'Ajouter le calque'}<Icon name="plus" size={15} /></button></footer>
    </div>
  </div>;
}
