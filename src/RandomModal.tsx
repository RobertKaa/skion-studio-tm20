import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import {
  FINISH_LABELS, NEON_LABELS, PATTERN_LABELS, THEME_CATALOG, THEME_LABELS,
  type GeneratorOptions,
} from './generatorCatalog';
import type { GenerationSummary } from './generator';
import { LIGHTING_PRESETS, type PreviewEnvironment } from './previewEnvironment';
import { Icon } from './ui/Icon';
import './randomModal.css';

const TIRE_LABELS: Record<GeneratorOptions['tire'], string> = {
  auto: 'Accordés à la livrée', slick: 'Slick · piste sèche',
  semiSlick: 'Semi-slick · route & piste', wet: 'Pluie · rainures profondes', rally: 'Rallye · gomme sculptée',
};
const LIGHT_LABELS: Record<GeneratorOptions['lights'], string> = {
  auto: 'Signature du style', brake: 'Freinage · rouge discret',
  endurance: 'Endurance · repères & freinage', street: 'Tuning · néons, nuit & freinage', none: 'Affichage de vitesse uniquement',
};
const HARMONY_LABELS = { mono: 'Monochrome', complementary: 'Complémentaire', analogous: 'Analogues', triadic: 'Triade' };
const COAT_LABELS = { none: 'Aucun', light: 'Léger', full: 'Total' };
const WHEEL_LABELS = { dark: 'Sombres', accent: 'Couleur d’accent', base: 'Couleur de base' };
const DETAIL_LABELS = { dark: 'Sombres', accent: 'Couleur d’accent' };

function SelectField<T extends string>({ label, value, labels, onChange, autoLabel = 'Accordé au style' }: {
  label: string; value: T | 'auto'; labels: Record<string, string>;
  onChange: (value: T | 'auto') => void; autoLabel?: string;
}) {
  const labelId = useId();
  return <label className="gen-field"><span id={labelId}>{label}</span><select aria-labelledby={labelId} value={value} onChange={(event) => onChange(event.target.value as T | 'auto')}>
    {!Object.hasOwn(labels, 'auto') && <option value="auto">{autoLabel}</option>}
    {Object.entries(labels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
  </select></label>;
}

interface LastRun { summary: GenerationSummary; baseSeed: string; variation: number; }

export default function RandomModal({ opts, onChange, onGenerate, onKeep, onCancel, generating, previewHostRef, onPreviewHost, previewEnvironment, onEnvironmentChange, braking, onBrakingChange }: {
  opts: GeneratorOptions; onChange: (opts: GeneratorOptions) => void;
  /** Aperçu temporaire ; App conserve le checkpoint jusqu’à validation. */
  onGenerate: (opts: GeneratorOptions) => Promise<GenerationSummary | null>;
  onKeep: () => void; onCancel: () => void; generating: boolean;
  previewHostRef: RefObject<HTMLDivElement | null>;
  onPreviewHost?: (host: HTMLDivElement) => void;
  previewEnvironment?: PreviewEnvironment;
  onEnvironmentChange?: (value: PreviewEnvironment) => void;
  braking?: boolean;
  onBrakingChange?: (value: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<'catalog' | 'settings'>('catalog');
  const [category, setCategory] = useState<'all' | 'competition' | 'street' | 'fantasy'>('all');
  const [last, setLast] = useState<LastRun | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const generated = last !== null;
  const changed = generated && JSON.stringify(opts) !== lastKey;
  const selected = THEME_CATALOG.find((entry) => entry.id === opts.theme);
  const set = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) => onChange({ ...opts, [key]: value });
  const setPreviewHost = useCallback((host: HTMLDivElement | null) => {
    previewHostRef.current = host;
    if (host) onPreviewHost?.(host);
  }, [previewHostRef, onPreviewHost]);

  // Focus initial, tabulation contenue et retour au déclencheur à la fermeture.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('.gen-dismiss')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!generating && !runningRef.current) onCancel();
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')).filter((node) => node.getClientRects().length > 0);
      const first = nodes[0]; const final = nodes[nodes.length - 1];
      if (!first || !final) return;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); final.focus(); }
      else if (!event.shiftKey && (document.activeElement === final || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, generating]);

  const run = async (newVariation = false) => {
    if (generating || runningRef.current) return;
    runningRef.current = true;
    const key = JSON.stringify(opts);
    const fixedSeed = opts.seed.trim() !== '';
    const advanceSeed = fixedSeed && (newVariation || key === lastKey && last !== null);
    const variation = advanceSeed ? last?.baseSeed === opts.seed.trim() ? last.variation + 1 : 1 : 0;
    const effective = variation > 0 ? { ...opts, seed: String(Number(opts.seed.trim()) + variation) } : opts;
    setError(null);
    try {
      const summary = await onGenerate(effective);
      if (!summary) { setError('L’aperçu n’a pas pu être créé. Réessayez ou revenez à votre livrée.'); return; }
      setLast({ summary, baseSeed: opts.seed.trim(), variation }); setLastKey(key);
    } catch { setError('L’aperçu n’a pas pu être créé. Réessayez ou revenez à votre livrée.'); }
    finally { runningRef.current = false; }
  };

  const rememberSeed = () => {
    if (!last) return;
    const seed = String(last.summary.seed);
    const next = { ...opts, seed };
    onChange(next);
    // Mémoriser une graine ne change pas la composition déjà affichée.
    if (!changed) { setLastKey(JSON.stringify(next)); setLast({ ...last, baseSeed: seed, variation: 0 }); }
  };

  return <div className="modal-overlay gen-overlay" onClick={() => { if (!generated && !generating && !runningRef.current) onCancel(); }}>
    <div ref={dialogRef} className="modal modal--gen gen-studio" role="dialog" aria-modal="true" aria-busy={generating} aria-labelledby="gen-title" aria-describedby="gen-description" onClick={(event) => event.stopPropagation()}>
      <header className="modal-head gen-header">
        <div><span className="gen-eyebrow">Atelier de livrées</span><h2 id="gen-title">Une identité pour chaque piste.</h2><p id="gen-description">Choisissez une inspiration, générez des variations, puis affinez votre préférée.</p></div>
        <button type="button" className="modal-close gen-dismiss" onClick={onCancel} disabled={generating} aria-label={generated ? 'Revenir à ma livrée et fermer' : 'Fermer'}><Icon name="x" size={18} /></button>
      </header>
      <div className="gen-layout">
        <div className="gen-config">
          <div className="gen-section-tabs" role="tablist" aria-label="Configuration de la livrée" onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const next = event.key === 'Home' ? 'catalog' : event.key === 'End' ? 'settings' : section === 'catalog' ? 'settings' : 'catalog';
            setSection(next); document.getElementById(`gen-${next === 'catalog' ? 'catalog' : 'settings'}-tab`)?.focus();
          }}>
            <button type="button" id="gen-catalog-tab" role="tab" aria-controls="gen-catalog-panel" aria-selected={section === 'catalog'} className={section === 'catalog' ? 'is-active' : ''} onClick={() => setSection('catalog')}><span>01</span> Choisir une livrée</button>
            <button type="button" id="gen-settings-tab" role="tab" aria-controls="gen-settings-panel" aria-selected={section === 'settings'} className={section === 'settings' ? 'is-active' : ''} onClick={() => setSection('settings')}><span>02</span> Personnaliser</button>
          </div>
          <div className="gen-config-scroll">
            {section === 'catalog' ? <section id="gen-catalog-panel" role="tabpanel" aria-labelledby="gen-catalog-tab" className="gen-catalog">
              <div className="gen-catalog-tools">
                <div className="gen-category" aria-label="Famille de livrée">{([{ id: 'all', label: 'Toutes' }, { id: 'competition', label: 'Compétition' }, { id: 'street', label: 'Tuning' }, { id: 'fantasy', label: 'Fantaisie' }] as const).map((item) => <button key={item.id} type="button" aria-pressed={category === item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div>
                <button type="button" className={`gen-surprise${opts.theme === 'random' ? ' is-active' : ''}`} aria-pressed={opts.theme === 'random'} onClick={() => set('theme', 'random')} title={`Choisir l’une des ${THEME_CATALOG.length} inspirations du catalogue au hasard`}><Icon name="sparkles" size={13} /> Surprenez-moi</button>
              </div>
              <p className="gen-family-note">{category === 'competition' ? 'Endurance, Grand Prix, rallye et stock-car : les codes de compétition sur la Stadium.' : category === 'street' ? 'Tuning des années 2000 : grands vinyles, candy, chrome et néons sur la Stadium.' : category === 'fantasy' ? 'Cristaux, nébuleuses et circuits arcaniques : une transformation imaginaire de la Stadium.' : 'Compétition, tuning des années 2000 et fantaisie, adaptés aux lignes de la Stadium.'}</p>
              <div className="gen-variation-note"><div><strong>Un style, plusieurs livrées.</strong><p>Composition, palette et matières automatiques varient. Vos choix manuels sont conservés.</p></div><button type="button" className="btn btn-sm" onClick={() => void run(generated)} disabled={generating}><Icon name="rotate" size={13} /> Nouvelle variation</button></div>
              <p className="gen-catalog-note">Exemples sur la Stadium · les couleurs et la composition de votre variation peuvent changer</p>
              <div className="gen-catalog-grid">{THEME_CATALOG.filter((entry) => category === 'all' || entry.category === category).map((entry, index) => <button type="button" key={entry.id} className={`gen-livery-card${opts.theme === entry.id ? ' is-active' : ''}`} aria-pressed={opts.theme === entry.id} onClick={() => set('theme', entry.id)}>
                <div className="gen-livery-visual"><img className="gen-livery-image" src={`${import.meta.env.BASE_URL}liveries/${entry.id}.webp?v=prism-1`} alt="" width={768} height={432} loading={index < 4 ? 'eager' : 'lazy'} decoding="async" draggable={false} /><span className="gen-card-check"><Icon name="check" size={13} /></span></div>
                <div className="gen-livery-caption"><div className="gen-livery-title"><strong>{entry.label}</strong><span className="gen-palette-mini" aria-label="Palette indicative">{entry.colors.slice(0, 3).map((color, index) => <i key={index} style={{ background: color }} />)}</span></div><p>{entry.description}</p><div className="gen-livery-tags">{entry.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div></div>
              </button>)}</div>
              <div className="gen-direction"><div><strong>{selected?.label ?? 'Un style choisi pour vous'}</strong><p>{selected ? 'Trois compositions et plusieurs palettes pour explorer cette inspiration.' : `Un style parmi ${THEME_CATALOG.length} inspirations, puis une composition et une palette assorties.`}</p></div><button type="button" className="btn btn-sm" onClick={() => setSection('settings')}>Personnaliser <Icon name="chevronRight" size={13} /></button></div>
            </section> : <section id="gen-settings-panel" role="tabpanel" aria-labelledby="gen-settings-tab" className="gen-settings">
              <div className="gen-settings-intro"><span className="gen-eyebrow">Votre direction</span><h3>{THEME_LABELS[opts.theme]}</h3><p>Les réglages automatiques varient dans le style choisi. Fixez une couleur ou une matière pour la garder entre les variations.</p><p>Compositions calibrées pour les UV Stadium : vérifiez l’alignement sur les modèles personnalisés.</p></div>
              <fieldset><legend>Palette &amp; peinture</legend>
                <div className="gen-palette-fields">
                  <div className="gen-color-control"><label className="gen-field"><span>Couleur principale</span><span className="gen-color-chip"><input type="color" value={opts.baseColor} disabled={opts.randomBaseHue} onChange={(event) => set('baseColor', event.target.value)} /><span>{opts.randomBaseHue ? 'Palette variable' : opts.baseColor.toUpperCase()}</span></span></label><label className="gen-field gen-inline"><input type="checkbox" checked={opts.randomBaseHue} onChange={(event) => set('randomBaseHue', event.target.checked)} /><span>Automatique</span></label></div>
                  <div className="gen-color-control"><label className="gen-field"><span>Couleur d’accent</span><span className="gen-color-chip"><input type="color" value={opts.accentColor} disabled={opts.randomAccent} onChange={(event) => set('accentColor', event.target.value)} /><span>{opts.randomAccent ? 'Accordée au style' : opts.accentColor.toUpperCase()}</span></span></label><label className="gen-field gen-inline"><input type="checkbox" checked={opts.randomAccent} onChange={(event) => set('randomAccent', event.target.checked)} /><span>Automatique</span></label></div>
                </div>
                <SelectField label="Finition de la peinture" value={opts.finish} labels={FINISH_LABELS} onChange={(value) => set('finish', value)} />
                <p className="gen-help">{opts.theme === 'fantasy' ? 'La peinture suit ce réglage. Les décors cristallins et leurs accents lumineux conservent leurs matières.' : 'La peinture suit ce réglage. Marquages mats, décors chrome selon le style ; les pièces carbone gardent leur matière.'}</p>
              </fieldset>
              <fieldset><legend>Identité &amp; composition</legend>
                {selected?.category === 'fantasy' ? <p className="gen-help">Les motifs remplacent les numéros de course et les sponsors.</p> : selected?.category === 'street' ? <p className="gen-help">Une signature d’atelier, sans numéro de course.</p> : <>
                  <label className="gen-field gen-inline"><input type="checkbox" checked={opts.raceNumber} onChange={(event) => set('raceNumber', event.target.checked)} /><span>Afficher un numéro de course</span></label>
                  {opts.raceNumber && <label className="gen-field"><span>Numéro de course</span><input type="text" inputMode="numeric" maxLength={3} placeholder="Automatique, ou ex. 27" value={opts.raceNumberValue} onChange={(event) => set('raceNumberValue', event.target.value.replace(/\D/g, '').slice(0, 3))} /></label>}
                </>}
                <label className="gen-field"><span className="gen-range-label">Densité des détails <output>{opts.complexity}%</output></span><input type="range" min={0} max={100} value={opts.complexity} onChange={(event) => set('complexity', Number(event.target.value))} /><span className="gen-range-ends"><span>Épurée</span><span>Affirmée</span></span></label>
              </fieldset>
              <fieldset><legend>Roues &amp; patine</legend>
                <SelectField label="Texture des pneus" value={opts.tire} labels={TIRE_LABELS} onChange={(value) => set('tire', value)} />
                <label className="gen-field"><span className="gen-range-label">Usure visuelle <output>{opts.wear}%</output></span><input type="range" min={0} max={100} value={opts.wear} onChange={(event) => set('wear', Number(event.target.value))} /><span className="gen-range-ends"><span>Sortie d’atelier</span><span>Retour de course</span></span></label>
                <p className="gen-help">Patine des pneus et traces sur les surfaces exposées, visibles dans l’aperçu.</p>
                <label className="gen-field"><span className="gen-range-label">Saleté autorisée en jeu <output>{opts.dirt}%</output></span><input type="range" min={0} max={100} value={opts.dirt} onChange={(event) => set('dirt', Number(event.target.value))} /><span className="gen-range-ends"><span>Protégée</span><span>Exposée</span></span></label>
                <p className="gen-help">0 % protège les surfaces. 100 % laisse la saleté du jeu s’accumuler ; ce réglage n’ajoute pas de boue à la livrée.</p>
              </fieldset>
              <fieldset><legend>Signature lumineuse</legend>
                <SelectField label="Éclairage" value={opts.lights} labels={LIGHT_LABELS} onChange={(value) => set('lights', value)} />
                <p className="gen-help">{opts.theme === 'fantasy' ? 'En automatique, motifs et cristaux composent la signature lumineuse. Testez Nuit et Freinage dans l’aperçu.' : 'Freinage, repères de nuit et accents permanents selon le style. Testez Nuit et Freinage dans l’aperçu.'} L’affichage de vitesse d’origine reste actif.</p>
              </fieldset>
              <details className="gen-advanced"><summary><Icon name="sliders" size={14} /> Réglages avancés <Icon name="chevronDown" size={13} /></summary><div className="gen-advanced-fields">
                <SelectField label="Harmonie des couleurs" value={opts.harmony} labels={HARMONY_LABELS} onChange={(value) => set('harmony', value)} />
                <SelectField label="Motif · remplace la composition du style" value={opts.pattern} labels={PATTERN_LABELS} onChange={(value) => set('pattern', value)} autoLabel="Composition du style" />
                <SelectField label="Vernis" value={opts.coat} labels={COAT_LABELS} onChange={(value) => set('coat', value)} />
                <SelectField label="Couleur des jantes" value={opts.wheels} labels={WHEEL_LABELS} onChange={(value) => set('wheels', value)} />
                <SelectField label="Accents des détails" value={opts.details} labels={DETAIL_LABELS} onChange={(value) => set('details', value)} />
                <SelectField label="Couleur des accents lumineux" value={opts.neon} labels={NEON_LABELS} onChange={(value) => set('neon', value)} />
                <label className="gen-field"><span>Graine · pour retrouver une composition</span><div className="gen-seed-row"><input type="text" inputMode="numeric" placeholder="Automatique, ou ex. 123456" value={opts.seed} onChange={(event) => set('seed', event.target.value.replace(/\D/g, '').slice(0, 12))} />{opts.seed && <button type="button" className="btn btn-sm" onClick={() => set('seed', '')}>Vider</button>}</div></label>
                <p className="gen-help">Graine vide : variation automatique. Même graine et mêmes réglages : même livrée. « Nouvelle variation » essaie la graine suivante si elle est fixée.</p>
              </div></details>
            </section>}
          </div>
        </div>
        <section className="gen-preview" aria-label="Aperçu 3D de la livrée">
          <div className="gen-preview-topline"><span className={`gen-preview-status${generated ? ' is-generated' : ''}`}><i />{generated ? 'Aperçu temporaire' : 'Votre livrée actuelle'}</span><span className="gen-3d-label">3D · en direct</span></div>
          {previewEnvironment && onEnvironmentChange && <div className="gen-preview-checks" role="group" aria-label="Vérifier la livrée sous différentes lumières">
            <label><Icon name="sun" size={13} /><select aria-label="Éclairage de l’aperçu" value={previewEnvironment.venue === 'studio' ? 'studio' : previewEnvironment.mood} onChange={(event) => {
              const mood = LIGHTING_PRESETS.find((preset) => preset.id === event.target.value)?.id;
              onEnvironmentChange(mood ? { venue: 'stadium', mood } : { ...previewEnvironment, venue: 'studio' });
            }}><option value="studio">Studio · neutre</option>{LIGHTING_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
            {onBrakingChange && <button type="button" aria-pressed={Boolean(braking)} onClick={() => onBrakingChange(!braking)}><i /> Freinage</button>}
          </div>}
          <div className="gen-preview-stage">
            <div ref={setPreviewHost} className="gen-preview-host" data-testid="gen-preview-host" />
            {generating && <div className="gen-preview-busy" role="status"><div className="spinner" /><span>Composition de la livrée…</span></div>}
            {error && !generating && <div className="gen-preview-error" role="alert">{error}</div>}
            <span className="gen-preview-hint">Glisser pour tourner · molette pour zoomer · F pour recadrer</span>
          </div>
          {!generated && !generating && !error && <div className="gen-preview-intro"><Icon name="sparkles" size={17} /><div><strong>Générez votre première variation.</strong><p>Explorez les résultats avant d’appliquer. Votre livrée actuelle peut être restaurée.</p></div></div>}
          {last && !generating && <div className="gen-result" aria-live="polite">
            <div className="gen-result-heading"><h3>{THEME_LABELS[last.summary.theme]}</h3><span className="gen-swatches" aria-label="Palette générée">{[last.summary.palette.base, last.summary.palette.accent1, last.summary.palette.accent2].map((color, index) => <i key={index} style={{ background: color }} title={color.toUpperCase()} />)}</span></div>
            {(last.summary.composition || last.summary.paletteName) && <p className="gen-result-identity" title={last.summary.inspiration}>{[last.summary.composition, last.summary.paletteName].filter(Boolean).join(' · ')}</p>}
            <div className="gen-result-tags"><span>{FINISH_LABELS[last.summary.finish]}</span><span>{last.summary.stockTyres ? TIRE_LABELS[last.summary.tire] : 'Textures des roues personnalisées conservées'}</span><span>{last.summary.layers} calques éditables</span></div>
            <div className="gen-result-seed"><span>Graine {last.summary.seed}{last.variation > 0 && <small> · variation {last.variation}</small>}</span><button type="button" onClick={rememberSeed} title="Conserver cette graine dans les réglages">Conserver la graine <Icon name="lock" size={11} /></button></div>
            {changed && <p className="gen-pending" role="status"><Icon name="info" size={13} /> Réglages modifiés : prévisualisez pour les voir.</p>}
          </div>}
        </section>
      </div>
      <footer className="modal-actions gen-actions">
        <label className="gen-field gen-inline gen-keep-layers"><input type="checkbox" checked={!opts.clearExisting} onChange={(event) => set('clearExisting', !event.target.checked)} disabled={generating} /><span>Conserver mes calques</span></label>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={generating}>{generated ? 'Revenir à ma livrée' : 'Fermer'}</button>
        <button type="button" className={`btn${generated && !changed ? '' : ' btn-primary'}`} onClick={() => void run(generated && !changed)} disabled={generating}><Icon name={generated && !changed ? 'rotate' : 'sparkles'} size={14} />{generating ? 'Création…' : generated && !changed ? 'Nouvelle variation' : generated ? 'Prévisualiser les réglages' : 'Générer une variation'}</button>
        {generated && <button type="button" className="btn btn-primary" onClick={onKeep} disabled={generating || changed || Boolean(error)} title={changed ? 'Prévisualisez les nouveaux réglages avant de les appliquer' : 'Garder cette livrée et revenir à l’éditeur'}><Icon name="check" size={14} /> Appliquer cette livrée</button>}
      </footer>
    </div>
  </div>;
}
