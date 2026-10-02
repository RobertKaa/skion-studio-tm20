import { useEffect, useState, type RefObject } from 'react';
import {
  FINISH_LABELS,
  NEON_LABELS,
  PATTERN_LABELS,
  THEME_DESCRIPTIONS,
  THEME_LABELS,
  type Coat,
  type DetailStyle,
  type Finish,
  type GenerationSummary,
  type GeneratorOptions,
  type Harmony,
  type Neon,
  type Pattern,
  type Theme,
  type WheelStyle,
} from './generator';
import { ILLUM_ROLES, type IllumRole } from './maps';
import { Icon } from './ui/Icon';

const HARMONY_LABELS: Record<Exclude<Harmony, 'auto'>, string> = {
  mono: 'Monochrome',
  complementary: 'Complémentaire',
  analogous: 'Analogues',
  triadic: 'Triade',
};

const COAT_LABELS: Record<Exclude<Coat, 'auto'>, string> = {
  none: 'Aucun',
  light: 'Léger',
  full: 'Total',
};

const WHEEL_LABELS: Record<Exclude<WheelStyle, 'auto'>, string> = {
  dark: 'Sombres',
  accent: "Couleur d'accent",
  base: 'Couleur de base',
};

const DETAIL_LABELS: Record<Exclude<DetailStyle, 'auto'>, string> = {
  dark: 'Sombres',
  accent: "Couleur d'accent",
};

/** Ordre d'affichage des thèmes : livrées soignées d'abord, aléatoire complet en fin. */
const THEME_ORDER: Theme[] = [
  'random',
  'racingGT',
  'retro',
  'arrow',
  'wave',
  'chrome',
  'stealth',
  'cyber',
  'rally',
  'drift',
  'esport',
  'zevent',
  'full',
];

const NEON_ROLE_LABELS: Record<IllumRole, string> = Object.fromEntries(
  ILLUM_ROLES.map((r) => [r.id, r.label]),
) as Record<IllumRole, string>;

function OptionSelect<T extends string>({
  label,
  value,
  labels,
  onChange,
}: {
  label: string;
  value: T | 'auto';
  labels: Record<string, string>;
  onChange: (v: T | 'auto') => void;
}) {
  return (
    <label className="gen-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T | 'auto')}>
        <option value="auto">Aléatoire</option>
        {Object.entries(labels).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Dernier tirage affiché dans le panneau d'aperçu. */
interface LastRun {
  summary: GenerationSummary;
  /** Graine saisie par l'utilisateur (vide = aléatoire) au moment du tirage. */
  baseSeed: string;
  /** Décalage appliqué à une graine fixe pour que « Régénérer » varie. */
  variation: number;
}

export default function RandomModal({
  opts,
  onChange,
  onGenerate,
  onKeep,
  onCancel,
  generating,
  previewHostRef,
}: {
  opts: GeneratorOptions;
  onChange: (opts: GeneratorOptions) => void;
  /** Applique la génération à l'éditeur ; résout `null` en cas d'échec. */
  onGenerate: (opts: GeneratorOptions) => Promise<GenerationSummary | null>;
  /** Ferme en gardant le résultat. */
  onKeep: () => void;
  /** Ferme en restaurant l'état d'avant l'ouverture (ou ferme simplement si rien n'a été généré). */
  onCancel: () => void;
  generating: boolean;
  /** Conteneur dans lequel App monte l'aperçu 3D pendant que la modale est ouverte. */
  previewHostRef: RefObject<HTMLDivElement | null>;
}) {
  const set = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) =>
    onChange({ ...opts, [key]: value });

  const [last, setLast] = useState<LastRun | null>(null);
  /** Config telle qu'utilisée au dernier tirage, pour détecter « même config ⇒ variation ». */
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generated = last !== null;

  // Escape = Annuler (restaure l'état d'avant la modale).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!generating) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel, generating]);

  const run = async () => {
    if (generating) return;
    const key = JSON.stringify(opts);
    const fixedSeed = opts.seed.trim() !== '';
    // Graine fixe + config inchangée : on décale la graine pour obtenir une
    // nouvelle variante (affichée telle quelle, donc toujours reproductible).
    const variation = fixedSeed && key === lastKey && last ? last.variation + 1 : 0;
    const effective: GeneratorOptions =
      variation > 0 ? { ...opts, seed: String(Number(opts.seed.trim()) + variation) } : opts;
    setError(null);
    const summary = await onGenerate(effective);
    if (!summary) {
      setError('La génération a échoué. Modifiez les options et réessayez.');
      return;
    }
    setLast({ summary, baseSeed: opts.seed.trim(), variation });
    setLastKey(key);
  };

  const themeDescription =
    opts.theme === 'random'
      ? 'Pioche une livrée cohérente au hasard (couleurs, motif, matériaux et néon accordés).'
      : opts.theme === 'full'
        ? 'Génération 100 % aléatoire (motifs et matériaux variés, style « bruit »).'
        : THEME_DESCRIPTIONS[opts.theme];

  const fixedSeed = opts.seed.trim() !== '';
  const seedLocked = Boolean(last && last.baseSeed !== '' && last.baseSeed === opts.seed.trim() && last.variation === 0);

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        // Clic hors de la modale : ne ferme que s'il n'y a rien à perdre.
        if (!generated && !generating) onCancel();
      }}
    >
      <div className="modal modal--gen" role="dialog" aria-modal="true" aria-labelledby="gen-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="gen-title">Générer une livrée</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            disabled={generating}
            aria-label={generated ? 'Annuler et fermer' : 'Fermer'}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="gen-layout">
          <div className="modal-body gen-config">
            <fieldset className="gen-theme">
              <legend>Style de livrée</legend>
              <div className="theme-grid">
                {THEME_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`theme-card${opts.theme === t ? ' is-active' : ''}`}
                    aria-pressed={opts.theme === t}
                    onClick={() => set('theme', t)}
                  >
                    {THEME_LABELS[t]}
                  </button>
                ))}
              </div>
              <p className="hint">{themeDescription}</p>
            </fieldset>

            <div className="gen-grid">
              <fieldset>
                <legend>Couleurs</legend>
                <label className="gen-field gen-inline">
                  <input
                    type="checkbox"
                    checked={opts.randomBaseHue}
                    onChange={(e) => set('randomBaseHue', e.target.checked)}
                  />
                  <span>Teinte de base aléatoire</span>
                </label>
                {!opts.randomBaseHue && (
                  <label className="gen-field">
                    <span>Couleur de base</span>
                    <input
                      type="color"
                      value={opts.baseColor}
                      onChange={(e) => set('baseColor', e.target.value)}
                    />
                  </label>
                )}
                <label className="gen-field gen-inline">
                  <input
                    type="checkbox"
                    checked={opts.randomAccent}
                    onChange={(e) => set('randomAccent', e.target.checked)}
                  />
                  <span>Accent (« néon ») aléatoire</span>
                </label>
                {!opts.randomAccent && (
                  <label className="gen-field">
                    <span>Couleur d'accent</span>
                    <input
                      type="color"
                      value={opts.accentColor}
                      onChange={(e) => set('accentColor', e.target.value)}
                    />
                  </label>
                )}
                <OptionSelect
                  label="Harmonie des accents"
                  value={opts.harmony}
                  labels={HARMONY_LABELS}
                  onChange={(v) => set('harmony', v as Harmony)}
                />
              </fieldset>

              <fieldset>
                <legend>Motif carrosserie</legend>
                <OptionSelect
                  label="Motif"
                  value={opts.pattern}
                  labels={PATTERN_LABELS}
                  onChange={(v) => set('pattern', v as Pattern)}
                />
                <label className="gen-field">
                  <span>Complexité : {opts.complexity}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={opts.complexity}
                    onChange={(e) => set('complexity', Number(e.target.value))}
                  />
                </label>
                <label className="gen-field gen-inline">
                  <input
                    type="checkbox"
                    checked={opts.raceNumber}
                    onChange={(e) => set('raceNumber', e.target.checked)}
                  />
                  <span>Numéro de course (capot + flancs)</span>
                </label>
                {opts.raceNumber && (
                  <label className="gen-field">
                    <span>Numéro (vide = aléatoire)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="Ex. 27"
                      value={opts.raceNumberValue}
                      onChange={(e) => set('raceNumberValue', e.target.value.replace(/\D/g, ''))}
                    />
                  </label>
                )}
              </fieldset>

              <fieldset>
                <legend>Peinture</legend>
                <OptionSelect
                  label="Finition"
                  value={opts.finish}
                  labels={FINISH_LABELS}
                  onChange={(v) => set('finish', v as Finish)}
                />
                <OptionSelect
                  label="Vernis / paillettes"
                  value={opts.coat}
                  labels={COAT_LABELS}
                  onChange={(v) => set('coat', v as Coat)}
                />
                <label className="gen-field">
                  <span>Saleté : {opts.dirt}%</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={opts.dirt}
                    onChange={(e) => set('dirt', Number(e.target.value))}
                  />
                </label>
              </fieldset>

              <fieldset>
                <legend>Roues &amp; détails</legend>
                <OptionSelect
                  label="Roues"
                  value={opts.wheels}
                  labels={WHEEL_LABELS}
                  onChange={(v) => set('wheels', v as WheelStyle)}
                />
                <OptionSelect
                  label="Détails (aileron, châssis…)"
                  value={opts.details}
                  labels={DETAIL_LABELS}
                  onChange={(v) => set('details', v as DetailStyle)}
                />
                <OptionSelect
                  label="Néon détails (Details_I)"
                  value={opts.neon}
                  labels={NEON_LABELS}
                  onChange={(v) => set('neon', v as Neon)}
                />
                {opts.neon !== 'none' && (
                  <label className="gen-field">
                    <span>Rôle du néon</span>
                    <select value={opts.neonRole} onChange={(e) => set('neonRole', e.target.value as IllumRole)}>
                      {ILLUM_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {NEON_ROLE_LABELS[r.id]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </fieldset>

              <fieldset className="gen-span">
                <legend>Reproductibilité</legend>
                <label className="gen-field">
                  <span>Graine (vide = nouveau tirage à chaque fois)</span>
                  <div className="gen-seed-row">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Ex. 123456"
                      value={opts.seed}
                      onChange={(e) => set('seed', e.target.value.replace(/\D/g, '').slice(0, 12))}
                    />
                    {fixedSeed && (
                      <button type="button" className="btn btn-sm" onClick={() => set('seed', '')} title="Revenir à une graine aléatoire">
                        Vider
                      </button>
                    )}
                  </div>
                </label>
                <p className="hint">
                  {fixedSeed
                    ? 'Graine fixée : la même configuration redonne la même livrée. « Régénérer » sans rien changer essaie la graine suivante.'
                    : 'Notez la graine affichée sous l’aperçu pour retrouver une livrée plus tard.'}
                </p>
              </fieldset>
            </div>

            <p className="hint">
              Les éléments générés restent des calques éditables. Le néon des détails est peint sur{' '}
              <code>Details_I</code>. Pour ajouter une lumière sur la carrosserie ou les roues, utilisez ensuite leur canal Néon / feux.
            </p>
          </div>

          <div className="gen-preview" aria-live="polite">
            <div ref={previewHostRef} className="gen-preview-host" data-testid="gen-preview-host" />
            {!generated && !generating && !error && (
              <div className="gen-preview-empty">
                <Icon name="sparkles" size={18} />
                <p>Choisissez un style, puis cliquez sur « Générer ».</p>
                <small>La livrée actuelle est affichée en attendant ; l’aperçu se met à jour ici sans fermer la fenêtre.</small>
              </div>
            )}
            {generating && (
              <div className="gen-preview-busy">
                <div className="spinner" />
                <span>Génération…</span>
              </div>
            )}
            {error && !generating && <div className="gen-preview-error">{error}</div>}
            {last && !generating && (
              <div className="gen-preview-summary">
                <div className="gen-summary-main">
                  <b>{THEME_LABELS[last.summary.theme]}</b>
                  <span className="gen-sep" />
                  <span>{PATTERN_LABELS[last.summary.pattern]}</span>
                  <span className="gen-sep" />
                  <span>{FINISH_LABELS[last.summary.finish]}</span>
                </div>
                <div className="gen-summary-side">
                  <span className="gen-swatches" aria-label="Palette">
                    {[last.summary.palette.base, last.summary.palette.accent1, last.summary.palette.accent2].map((c, i) => (
                      <i key={i} style={{ background: c }} title={c.toUpperCase()} />
                    ))}
                  </span>
                  <span className="gen-seed">
                    Graine {last.summary.seed}
                    {last.variation > 0 && <small> ({last.baseSeed} + {last.variation})</small>}
                  </span>
                  {!seedLocked && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => set('seed', String(last.summary.seed))}
                      title="Reporter cette graine dans le champ « Graine » pour retrouver exactement cette livrée"
                    >
                      Fixer
                    </button>
                  )}
                </div>
              </div>
            )}
            <span className="gen-preview-hint">Glisser : tourner · molette : zoom</span>
          </div>
        </div>

        <div className="modal-actions">
          <label className="gen-field gen-inline">
            <input
              type="checkbox"
              checked={!opts.clearExisting}
              onChange={(e) => set('clearExisting', !e.target.checked)}
            />
            <span>Garder les calques existants</span>
          </label>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel} disabled={generating}>
            {generated ? 'Revenir à ma livrée' : 'Fermer'}
          </button>
          <button type="button" className="btn" onClick={onKeep} disabled={!generated || generating} title="Fermer en gardant la livrée générée">
            <Icon name="check" size={14} /> Garder cette livrée
          </button>
          <button type="button" className="btn btn-primary" disabled={generating} onClick={() => void run()}>
            <Icon name={generated ? 'rotate' : 'sparkles'} size={14} />{' '}
            {generating ? 'Génération…' : generated ? 'Régénérer' : 'Générer'}
          </button>
        </div>
      </div>
    </div>
  );
}
