import { TEXTURE_RESOLUTIONS, isTextureResolution, type TextureResolution } from '../editor/resolution';
import { Icon } from './Icon';

export function TextureResolutionControl({ value, disabled, onChange }: {
  value: TextureResolution;
  disabled?: boolean;
  onChange: (value: TextureResolution) => void;
}) {
  return (
    <label className="texture-resolution" title="Résolution des treize canaux du skin. 1024 allège les textures ; 4096 privilégie les détails. Les calques et images originales sont conservés.">
      <Icon name="layers" size={14} />
      <span>Textures</span>
      <select aria-label="Résolution des textures du skin" value={value} disabled={disabled}
        onChange={(event) => { const size = Number(event.target.value); if (isTextureResolution(size)) onChange(size); }}>
        {TEXTURE_RESOLUTIONS.map((size) => <option key={size} value={size}>{size} px</option>)}
      </select>
    </label>
  );
}
