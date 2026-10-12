import { useRef } from 'react';
import type { MapId } from '../maps';
import type { BackgroundFit, TextureBackgroundInfo } from '../editor/textureBackground';
import { Icon } from './Icon';
import { SliderField } from './controls';
import './textureBackground.css';

const FITS: { id: BackgroundFit; label: string; hint: string }[] = [
  { id: 'cover', label: 'Remplir', hint: 'Remplir la texture en recadrant les bords, sans déformer l’image' },
  { id: 'contain', label: 'Ajuster', hint: 'Afficher l’image entière, sans la déformer' },
  { id: 'stretch', label: 'Étirer', hint: 'Étirer l’image sur toute la texture' },
];

export function TextureBackgroundControls({ mapId, background, disabled, onChoose, onRemove, onFit, onOpacity, onCommit }: {
  mapId: MapId;
  background: TextureBackgroundInfo | null;
  disabled: boolean;
  onChoose(file: File, mapId: MapId): void;
  onRemove(): void;
  onFit(fit: BackgroundFit): void;
  onOpacity(value: number): void;
  onCommit(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const targetMap = useRef(mapId);
  return <div className="texture-background">
    <div className="texture-background-heading"><Icon name="image" size={15} /><strong>Image de fond</strong></div>
    <p className="hint">Sous la couleur de fond et les calques de cette texture.</p>
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
      <div className="texture-background-fit" role="group" aria-label="Cadrage de l’image de fond">
        {FITS.map((fit) => <button key={fit.id} type="button" className={`btn btn-sm${background.fit === fit.id ? ' is-active' : ''}`} aria-pressed={background.fit === fit.id} title={fit.hint} disabled={disabled} onClick={() => onFit(fit.id)}>{fit.label}</button>)}
      </div>
      <SliderField label="Opacité de la couleur de fond" value={Math.round(background.colorOpacity * 100)} min={0} max={100} format={(value) => `${value} %`} disabled={disabled} onChange={(value) => onOpacity(value / 100)} onCommit={onCommit} />
      <p className="hint">À 0 %, l’image est visible. À 100 %, la couleur la recouvre.</p>
    </>}
  </div>;
}
