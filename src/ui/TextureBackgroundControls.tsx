import { useRef } from 'react';
import { COPY_COMPATIBLE_TARGETS, MAP_BY_ID, type MapId } from '../maps';
import { DEFAULT_BACKGROUND_PLACEMENT, type BackgroundFit, type BackgroundPlacement, type TextureBackgroundInfo } from '../editor/textureBackground';
import { Icon } from './Icon';
import { SliderField } from './controls';
import './textureBackground.css';

const FITS: { id: BackgroundFit; label: string; hint: string }[] = [
  { id: 'cover', label: 'Remplir', hint: 'Remplir la texture en recadrant les bords, sans déformer l’image' },
  { id: 'contain', label: 'Ajuster', hint: 'Afficher l’image entière, sans la déformer' },
  { id: 'stretch', label: 'Étirer', hint: 'Étirer l’image sur toute la texture' },
];

export function TextureBackgroundControls({ mapId, background, disabled, onChoose, onRemove, onFit, onFollowBody, onPlacement, onCopyBackground, onOpacity, onCommit }: {
  mapId: MapId;
  background: TextureBackgroundInfo | null;
  disabled: boolean;
  onChoose(file: File, mapId: MapId): void;
  onRemove(): void;
  onFit(fit: BackgroundFit): void;
  onFollowBody(): void;
  onPlacement(changes: Partial<BackgroundPlacement>): void;
  onCopyBackground(target: MapId): void;
  onOpacity(value: number): void;
  onCommit(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const targetMap = useRef(mapId);
  const placement = background?.placement ?? DEFAULT_BACKGROUND_PLACEMENT;
  return <div className="texture-background">
    <div className="texture-background-heading"><Icon name="image" size={15} /><strong>Image de fond</strong></div>
    <p className="hint">{background?.projection || !background && mapId.startsWith('Skin_') ? 'L’image suit les courbes de la carrosserie, sous la couleur et les calques.' : 'Sous la couleur de fond et les calques de cette texture.'}</p>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="Fichier de l’image de fond" hidden disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) onChoose(file, targetMap.current);
    }} />
    {background && <div className="texture-background-file">
      <img src={background.src} alt="" />
      <span title={background.name}>{background.name}</span>
      <button type="button" className="btn btn-sm" disabled={disabled} onClick={onRemove} aria-label="Retirer l’image de fond" title="Retirer l’image de fond"><Icon name="trash" size={14} /></button>
    </div>}
    <button type="button" className="btn btn-sm btn-full" disabled={disabled} onClick={() => { targetMap.current = mapId; input.current?.click(); }}>
      <Icon name={background ? 'upload' : 'image'} size={14} />{background ? 'Remplacer l’image de fond' : 'Ajouter une image de fond'}
    </button>
    {background && <>
      {mapId.startsWith('Skin_') && !background.projection && <button type="button" className="btn btn-sm btn-full" disabled={disabled} onClick={onFollowBody}>Adapter à la carrosserie</button>}
      <div className="texture-background-fit" role="group" aria-label="Cadrage de l’image de fond">
        {FITS.filter(fit => !background.projection || fit.id !== 'stretch').map((fit) => <button key={fit.id} type="button" className={`btn btn-sm${background.fit === fit.id ? ' is-active' : ''}`} aria-pressed={background.fit === fit.id} title={fit.hint} disabled={disabled} onClick={() => onFit(fit.id)}>{fit.label}</button>)}
      </div>
      {background.projection && <div className="texture-background-placement" role="group" aria-label="Placement de l’image sur la carrosserie">
        <SliderField label="Zoom de l’image" value={Math.round(placement.scale * 100)} min={10} max={400} format={value => `${value} %`} disabled={disabled} onChange={value => onPlacement({ scale: value / 100 })} onCommit={onCommit} />
        <SliderField label="Rotation de l’image" value={placement.angle} min={-180} max={180} format={value => `${value}°`} disabled={disabled} onChange={angle => onPlacement({ angle })} onCommit={onCommit} />
        <SliderField label="Position horizontale" value={Math.round(placement.offsetX / 2048 * 100)} min={-100} max={100} format={value => `${value} %`} disabled={disabled} onChange={value => onPlacement({ offsetX: value / 100 * 2048 })} onCommit={onCommit} />
        <SliderField label="Position verticale" value={Math.round(placement.offsetY / 2048 * 100)} min={-100} max={100} format={value => `${value} %`} disabled={disabled} onChange={value => onPlacement({ offsetY: value / 100 * 2048 })} onCommit={onCommit} />
        <button type="button" className="btn btn-sm btn-full" disabled={disabled} onClick={() => { onPlacement({ ...DEFAULT_BACKGROUND_PLACEMENT }); onCommit(); }}>Réinitialiser le placement</button>
      </div>}
      <SliderField label="Opacité de la couleur de fond" value={Math.round(background.colorOpacity * 100)} min={0} max={100} format={(value) => `${value} %`} disabled={disabled} onChange={(value) => onOpacity(value / 100)} onCommit={onCommit} />
      <p className="hint">À 0 %, l’image est visible. À 100 %, la couleur la recouvre.</p>
      <div className="texture-background-copy" role="group" aria-label="Copier l’image de fond et ses réglages">
        <strong>Copier le fond vers</strong>
        <div className="texture-background-fit">
          {COPY_COMPATIBLE_TARGETS[mapId].filter(target => ['roughmetal', 'illum'].includes(MAP_BY_ID[target].kind)).map(target => <button key={target} type="button" className="btn btn-sm" disabled={disabled} onClick={() => onCopyBackground(target)}><Icon name="copy" size={13} />{MAP_BY_ID[target].kind === 'illum' ? 'Néon / feux' : 'Matière'}</button>)}
        </div>
        <p className="hint">Image, placement et couleur copiés. Remplace le fond du canal choisi ; ses calques sont conservés.</p>
      </div>
    </>}
  </div>;
}
