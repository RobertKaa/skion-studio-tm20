import { INDEPENDENT_DETAILS, type DetailsLayout, type DetailsSide } from '../detailsSides';
import { UNDERBODY_PANEL_LAYOUT } from '../underbodyPanel';
import './detailsSides.css';

export function DetailsSidesControl({ layout, selected, disabled, targetSelected=true, organized=false, onLocate, onSeparate, onSelect }: {
  layout?: DetailsLayout;
  selected?: DetailsSide;
  disabled: boolean;
  targetSelected?: boolean;
  organized?:boolean;
  onLocate?(): void;
  onSeparate(): void;
  onSelect(side: DetailsSide): void;
}) {
  if(layout===INDEPENDENT_DETAILS)return <p className="hint">Cette copie utilise l’ancien découpage global. Ouvrez le projet initial pour séparer uniquement le panneau inférieur.</p>;
  if(organized&&!layout)return <p className="hint">Le panneau inférieur partage toujours sa texture gauche/droite. Pour le séparer, utilisez le projet initial dans « Mes projets », puis réorganisez ses UV.</p>;
  return <section className="details-sides" aria-label="Panneau inférieur gauche et droit">
    <div className="details-sides-title">Grand panneau inférieur</div>
    {layout === UNDERBODY_PANEL_LAYOUT ? <>
      <div className="details-sides-actions" role="group" aria-label="Sélection du panneau inférieur">
        {(['left', 'right'] as const).map(side => <button type="button" key={side} disabled={disabled}
          className={`btn${selected === side ? ' is-active' : ''}`} aria-pressed={selected === side}
          onClick={() => onSelect(side)}>Panneau {side === 'left' ? 'gauche' : 'droit'}</button>)}
      </div>
      <p className="hint">Deux formes UV distinctes pour ce panneau, une sur chaque flanc. Les autres pièces ne sont pas dédoublées.</p>
    </> : targetSelected ? <>
      <p className="hint">Dessous · Élément 1 : cette même forme UV est utilisée par le panneau gauche et le panneau droit.</p>
      <button type="button" className="btn btn-full" disabled={disabled} onClick={onSeparate}>Séparer ce panneau gauche/droite</button>
      <p className="hint">Crée une copie du projet avec deux formes indépendantes pour ce panneau. Le projet initial est conservé.</p>
    </> : <>
      <p className="hint">Pour décorer ses deux côtés séparément, sélectionnez Dessous · Élément 1.</p>
      <button type="button" className="btn btn-full" disabled={disabled} onClick={onLocate}>Choisir ce panneau sur le guide</button>
    </>}
  </section>;
}
