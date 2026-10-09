import { LIGHTING_PRESETS, lightingPreset, type PreviewEnvironment } from '../previewEnvironment';
import { Icon } from './Icon';
import '../environment.css';

export function EnvironmentControls({ value, braking, onChange, onBraking }: {
  value: PreviewEnvironment; braking: boolean; onChange: (value: PreviewEnvironment) => void; onBraking: (value: boolean) => void;
}) {
  const preset = lightingPreset(value.mood);
  const simulated = value.venue === 'stadium';
  return <section className="environment-controls" aria-label="Environnement de test du skin">
    <div className="environment-heading">
      <span><Icon name="sun" size={15} /><strong>Environnement</strong><small>{simulated ? 'Aperçu simulé' : 'Éclairage neutre'}</small></span>
      <div className="environment-venues" role="group" aria-label="Décor de l’aperçu">
        <button type="button" aria-pressed={value.venue === 'studio'} onClick={() => onChange({ ...value, venue: 'studio' })}>Studio</button>
        <button type="button" aria-pressed={simulated} onClick={() => onChange({ ...value, venue: 'stadium' })}>Simulation</button>
      </div>
    </div>
    <div className="environment-settings">
      {simulated && <div className="environment-moods" role="group" aria-label="Ambiance lumineuse">
        {LIGHTING_PRESETS.map((mood) => <button type="button" key={mood.id} aria-label={mood.label} aria-pressed={value.mood === mood.id}
          title={mood.description} data-mood={mood.id} onClick={() => onChange({ ...value, mood: mood.id })}>
          <span className="environment-swatch" aria-hidden="true" /><span>{mood.shortLabel}</span>
        </button>)}
      </div>}
      <button type="button" className="environment-brake" aria-pressed={braking} onClick={() => onBraking(!braking)}>
        <span className="environment-brake-dot" aria-hidden="true" />Freinage
      </button>
    </div>
    <p className="environment-description" role="status">{simulated
      ? <><span>{preset.label}</span> · {preset.description}</>
      : 'Lumière neutre et constante pour travailler les couleurs et les matières.'}</p>
  </section>;
}
