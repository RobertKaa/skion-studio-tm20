import { useEffect, useRef } from 'react';
import {
  getWheelTreadSwatch,
  isWheelSurfaceMode,
  isWheelTreadPreset,
  WHEEL_SURFACE_PRESETS,
  type WheelSurfaceSettings,
} from '../wheelSurface';
import { Row, SliderField } from './controls';
import './wheelSurface.css';

/** These swatches use the actual tyre height field, without allocating a full atlas. */
export function WheelSurfaceControls({ value, onChange, officialModel }: {
  value: WheelSurfaceSettings;
  onChange(value: WheelSurfaceSettings): void;
  officialModel: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const selected = WHEEL_SURFACE_PRESETS.find((preset) => preset.id === value.mode) ?? WHEEL_SURFACE_PRESETS[0];
  const procedural = isWheelTreadPreset(value.mode);

  useEffect(() => {
    if (!isWheelTreadPreset(value.mode) || !canvas.current) return;
    const ctx = canvas.current.getContext('2d');
    if (!ctx) return;
    const swatch = getWheelTreadSwatch(value.mode, 72, 96);
    const pixels = ctx.createImageData(swatch.width, swatch.height);
    pixels.data.set(swatch.data);
    ctx.putImageData(pixels, 0, 0);
  }, [value.mode, officialModel]);

  return <>
    <Row label="Profil">
      <select aria-label="Relief des pneus" value={value.mode} onChange={(event) => {
        const mode = event.target.value;
        if (isWheelSurfaceMode(mode) && (officialModel || !isWheelTreadPreset(mode))) onChange({ ...value, mode });
      }}>
        <optgroup label="Profils prédéfinis">
          {WHEEL_SURFACE_PRESETS.filter((preset) => preset.id !== 'relief').map((preset) => <option key={preset.id} value={preset.id} disabled={!officialModel && isWheelTreadPreset(preset.id)}>{preset.label}</option>)}
        </optgroup>
        <optgroup label="Skin actuel">
          {WHEEL_SURFACE_PRESETS.filter((preset) => preset.id === 'relief').map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </optgroup>
      </select>
    </Row>
    <div className="wheel-profile-summary">
      {procedural && officialModel && <canvas ref={canvas} width={72} height={96} role="img" aria-label={`Motif du pneu : ${selected.label}`} />}
      <div>
        <strong>{selected.label}</strong>
        <p>{procedural && !officialModel ? 'Profil non applicable à ces UV : les pneus restent lisses.' : selected.description}</p>
      </div>
    </div>
    {value.mode !== 'smooth' && <SliderField label="Intensité du relief" value={value.strength} min={0} max={1} step={.05} format={(strength) => `${Math.round(strength * 100)} %`} onChange={(strength) => onChange({ ...value, strength })} />}
    {!officialModel && <p className="hint">Les profils prédéfinis utilisent les UV de la Stadium officielle. Sur ce modèle 3D, choisissez des pneus lisses ou le relief de son skin.</p>}
    {procedural && officialModel && <p className="hint">Flancs d’origine conservés : inscriptions moulées, stries et bourrelets. Les canaux et leurs ombres suivent le nouveau profil.</p>}
    <p className="hint">Relief identique dans l’aperçu et l’export. Le bouton « Relief 2D » permet de le voir sur la texture sans modifier votre peinture.</p>
  </>;
}
