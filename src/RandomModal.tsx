import { useState } from 'react';
import {
  DEFAULT_OPTIONS,
  FINISH_LABELS,
  NEON_LABELS,
  PATTERN_LABELS,
  THEME_DESCRIPTIONS,
  THEME_LABELS,
  type Coat,
  type DetailStyle,
  type Finish,
  type GeneratorOptions,
  type Harmony,
  type Neon,
  type Pattern,
  type Theme,
  type WheelStyle,
} from './generator';
import { ILLUM_ROLES, type IllumRole } from './maps';

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
  'chrome',
  'stealth',
  'cyber',
  'rally',
  'retro',
  'sponsor',
  'factory',
  'drift',
  'vintage',
  'esport',
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
        <option value="auto">🎲 Aléatoire</option>
        {Object.entries(labels).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function RandomModal({
  onGenerate,
  onClose,
  busy,
}: {
  onGenerate: (opts: GeneratorOptions) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [opts, setOpts] = useState<GeneratorOptions>({ ...DEFAULT_OPTIONS });
  const set = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) =>
    setOpts((o) => ({ ...o, [key]: value }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Skin aléatoire</h2>
          <button className="modal-close" onClick={onClose} title="Fermer">
            ✕
          </button>
        </div>

        <fieldset className="gen-theme">
          <legend>Thème / Livrée</legend>
          <label className="gen-field">
            <span>Style de livrée</span>
            <select value={opts.theme} onChange={(e) => set('theme', e.target.value as Theme)}>
              {THEME_ORDER.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            {opts.theme === 'random'
              ? 'Pioche une livrée cohérente au hasard (couleurs, motif, matériaux et néon accordés).'
              : opts.theme === 'full'
                ? 'Génération 100 % aléatoire (motifs et matériaux variés, style « bruit »).'
                : THEME_DESCRIPTIONS[opts.theme]}
          </p>
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
                  onChange={(e) =>
                    set('raceNumberValue', e.target.value.replace(/\D/g, ''))
                  }
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
                <select
                  value={opts.neonRole}
                  onChange={(e) => set('neonRole', e.target.value as IllumRole)}
                >
                  {ILLUM_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {NEON_ROLE_LABELS[r.id]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="gen-field">
              <span>Graine (vide = aléatoire)</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Ex. 123456"
                value={opts.seed}
                onChange={(e) => set('seed', e.target.value.replace(/\D/g, ''))}
              />
            </label>
          </fieldset>
        </div>

        <label className="gen-field gen-inline">
          <input
            type="checkbox"
            checked={!opts.clearExisting}
            onChange={(e) => set('clearExisting', !e.target.checked)}
          />
          <span>Conserver les calques existants (sinon, les textures sont remplacées)</span>
        </label>

        <p className="muted small">
          Le néon des détails est peint sur la map d'illumination <code>Details_I</code> (rôle
          « toujours allumé / phares / freins » réglable dans l'éditeur). Le néon/fluo de la
          carrosserie, lui, se choisit en jeu via la peinture (pas une texture). Chaque clic sur
          « Générer » produit une nouvelle variante — les éléments générés restent des calques
          éditables (Ctrl+Z pour annuler).
        </p>

        <div className="modal-actions">
          <button onClick={onClose}>Fermer</button>
          <button className="primary" disabled={busy} onClick={() => onGenerate(opts)}>
            {busy ? 'Génération…' : '🎲 Générer'}
          </button>
        </div>
      </div>
    </div>
  );
}
