import { useRef } from 'react';
import type { MapId } from '../maps';
import { Icon } from './Icon';

export interface RegionImageTarget { mapId: MapId; key: string; label: string }

export function RegionImageFill({ target, disabled, onChoose }: {
  target: RegionImageTarget | null;
  disabled: boolean;
  onChoose(file: File, target: RegionImageTarget): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<RegionImageTarget | null>(null);
  return <>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
      aria-label="Image pour la sélection UV" hidden disabled={disabled} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        const chosenTarget = pending.current; pending.current = null;
        if (file && chosenTarget) onChoose(file, chosenTarget);
      }} />
    <button type="button" className="btn btn-sm btn-full" disabled={disabled || !target}
      title={target ? `Remplir uniquement ${target.label}, sans déformer l’image` : 'Sélectionnez une forme sur le guide 2D'}
      onClick={() => { if (target) { pending.current = { ...target }; input.current?.click(); } }}>
      <Icon name="image" size={14} /> Remplir avec une image
    </button>
  </>;
}
