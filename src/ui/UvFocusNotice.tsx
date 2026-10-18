import type { UvPreviewFocus } from '../three/CarPreview';
import { Icon } from './Icon';
import './uvFocusNotice.css';

export function UvFocusNotice({ focus, compact, onIsolate, onNext, onClear }: {
  focus: UvPreviewFocus; compact?: boolean; onIsolate(value: boolean): void; onNext(): void; onClear(): void;
}) {
  return <div className={`uv-focus-notice${compact ? ' uv-focus-notice--compact' : ''}`} aria-label="Cadrage de la pièce 3D">
    <div className="uv-focus-caption" role="status"><Icon name="target" size={14} /><strong title={focus.label}>{focus.label}</strong><span>{focus.isolated ? 'Vue isolée' : 'Cadrage 3D'}</span></div>
    <div className="uv-focus-actions">
      <button type="button" className="btn btn-ghost btn-sm" aria-pressed={focus.isolated} onClick={() => onIsolate(!focus.isolated)} title={focus.isolated ? 'Réafficher les autres pièces autour de cet élément' : 'Masquer les autres pièces pour voir cet élément sans obstacle'}><Icon name={focus.isolated ? 'eye' : 'eyeOff'} size={12} />{focus.isolated ? 'Voir le contexte' : 'Isoler'}</button>
      {focus.occurrences > 1 && <button type="button" className="btn btn-ghost btn-sm" aria-label="Voir une autre occurrence de ces UV" title="Ces UV sont partagées par plusieurs éléments de la voiture" onClick={onNext}><Icon name="rotate" size={12} />{focus.occurrence + 1}/{focus.occurrences}</button>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} title="Quitter le cadrage de la pièce et retrouver la vue précédente"><Icon name="x" size={12} />Tout revoir</button>
    </div>
  </div>;
}
