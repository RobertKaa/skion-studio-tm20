import { useEffect, useRef, useState } from 'react';
import {
  getWheelTreadSwatch,
  isWheelSurfaceMode,
  isWheelTreadPreset,
  WHEEL_SURFACE_PRESETS,
  type WheelSurfaceMode,
  type WheelSurfaceSettings,
  type WheelTreadPresetMode,
} from '../wheelSurface';
import { Row, SliderField } from './controls';
import { Icon } from './Icon';
import './wheelSurface.css';

const SHORT_LABELS: Record<WheelSurfaceMode, string> = {
  smooth: 'Slick', relief: 'Origine', 'semi-slick': 'Circuit', road: 'Sport', rain: 'Pluie',
  gravel: 'Terre', touring: 'Tourisme', winter: 'Hiver', mud: 'Boue', classic: 'Classique',
};

function TreadSwatch({ mode }: { mode: WheelTreadPresetMode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const swatch = getWheelTreadSwatch(mode, 64, 80);
    const pixels = ctx.createImageData(swatch.width, swatch.height);
    pixels.data.set(swatch.data);
    ctx.putImageData(pixels, 0, 0);
  }, [mode]);
  return <canvas ref={canvas} width={64} height={80} aria-hidden="true" />;
}

/** These swatches use the actual tyre height field, without allocating a full atlas. */
export function WheelSurfaceControls({ value, onChange, officialModel, onInspect, volumeAvailable = false, volumeBusy = false }: {
  value: WheelSurfaceSettings;
  onChange(value: WheelSurfaceSettings): void;
  officialModel: boolean;
  onInspect?(): void;
  volumeAvailable?: boolean;
  volumeBusy?: boolean;
}) {
  const selected = WHEEL_SURFACE_PRESETS.find((preset) => preset.id === value.mode) ?? WHEEL_SURFACE_PRESETS[0];
  const procedural = isWheelTreadPreset(value.mode);
  const offRoad = value.mode === 'gravel' || value.mode === 'mud';
  const volume = offRoad && value.volume === true;
  const [draftPercent, setDraftPercent] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const resetDraft = () => { draftRef.current = null; setDraftPercent(null); };
  useEffect(() => {
    if (!volumeBusy) resetDraft();
  }, [value.mode, value.strength, value.volume, volumeBusy]);
  const numericDraft = draftPercent === null || draftPercent === '' ? NaN : Number(draftPercent) / 100;
  const shownStrength = volume && Number.isFinite(numericDraft) ? Math.max(0, Math.min(1, numericDraft)) : value.strength;
  const depthMm = (selected.depthMm ?? 0) * shownStrength;
  const displayedDepth = depthMm.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const selectMode = (mode: WheelSurfaceMode) => {
    if (volumeBusy || mode === value.mode || !officialModel && isWheelTreadPreset(mode)) return;
    const next = { ...value, mode };
    delete next.volume;
    if ((mode === 'gravel' || mode === 'mud') && volumeAvailable) next.volume = true;
    onChange(next);
  };
  const changeStrength = (strength: number) => {
    if (volumeBusy || !Number.isFinite(strength)) return;
    const bounded = Math.max(0, Math.min(1, strength));
    if (volume) {
      const percent = String(Math.round(bounded * 100));
      draftRef.current = percent; setDraftPercent(percent);
    } else onChange({ ...value, strength: bounded });
  };
  const commitStrength = () => {
    if (!volume || volumeBusy || draftRef.current === null) return;
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft === '' || !Number.isFinite(Number(draft))) { resetDraft(); return; }
    const strength = Math.max(0, Math.min(1, Number(draft) / 100));
    if (strength !== value.strength) onChange({ ...value, strength });
    else resetDraft();
  };

  return <div className="wheel-surface-controls" aria-busy={volumeBusy || undefined}>
    <div className="wheel-library-heading"><span>SCULPTURES</span><span>{WHEEL_SURFACE_PRESETS.length} profils</span></div>
    {onInspect && <button type="button" className="btn btn-full" onClick={onInspect} disabled={!officialModel || volumeBusy}><Icon name="target" size={14} /> Inspecter le pneu en 3D</button>}
    <div className="wheel-profile-library" role="group" aria-label="Bibliothèque de sculptures des pneus">
      {WHEEL_SURFACE_PRESETS.map((preset) => <button
        type="button" key={preset.id} className="wheel-profile-card"
        aria-label={preset.label} aria-pressed={value.mode === preset.id}
        disabled={volumeBusy || !officialModel && isWheelTreadPreset(preset.id)}
        title={`${preset.label} · ${preset.description}`}
        onClick={() => selectMode(preset.id)}>
        <span className={`wheel-profile-art wheel-profile-art--${preset.id}`}>
          {isWheelTreadPreset(preset.id) ? <TreadSwatch mode={preset.id} />
            : preset.id === 'smooth' ? <span className="wheel-slick-swatch" />
            : <svg viewBox="0 0 64 80" aria-hidden="true"><circle cx="32" cy="40" r="23" /><circle cx="32" cy="40" r="14" /><path d="M32 13v7m0 40v7M5 40h7m40 0h7M13 21l5 5m28 28 5 5M13 59l5-5m28-28 5-5" /></svg>}
          {value.mode === preset.id && <span className="wheel-profile-check" aria-hidden="true">✓</span>}
        </span>
        <strong>{SHORT_LABELS[preset.id]}</strong>
        <span className="wheel-profile-category">{preset.category}</span>
      </button>)}
    </div>
    <Row label="Profil">
      <select aria-label="Relief des pneus" value={value.mode} disabled={volumeBusy} onChange={(event) => {
        const mode = event.target.value;
        if (isWheelSurfaceMode(mode)) selectMode(mode);
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
      <div>
        <div className="wheel-profile-summary-head"><strong>{selected.label}</strong>
          {selected.depthMm !== null && <span className="wheel-profile-depth" title={volume ? 'Profondeur géométrique actuelle dans l’aperçu et le modèle GBX exporté.' : 'Profondeur du dessin source. Rendu par texture de relief, sans modifier le maillage.'}>{volume ? `${displayedDepth} mm · 3D` : selected.depthMm ? `${selected.depthMm.toLocaleString('fr-FR')} mm` : 'Lisse'}</span>}
        </div>
        <p>{procedural && !officialModel ? 'Profil non applicable à ces UV : les pneus restent lisses.' : selected.description}</p>
      </div>
    </div>
    {offRoad && <div className="wheel-volume-setting">
      <label className={`toggle wheel-volume-toggle${!volumeAvailable || volumeBusy ? ' wheel-volume-toggle--disabled' : ''}`}>
        <input type="checkbox" aria-label="Crampons 3D" checked={volume} disabled={!volumeAvailable || volumeBusy} onChange={event => {
          if (!volumeAvailable || volumeBusy) return;
          const next = { ...value };
          if (event.target.checked) next.volume = true; else delete next.volume;
          onChange(next);
        }} />
        <span className="toggle-track" />
        <span className="toggle-label">Crampons 3D</span>
        <span className="wheel-volume-badge">Géométrie</span>
      </label>
      {volume && <div className="wheel-volume-depth"><span>Profondeur réelle</span><output aria-label="Profondeur réelle des crampons">{displayedDepth} mm</output></div>}
      <p className="hint">{volumeBusy ? 'Construction des crampons 3D…' : !volumeAvailable ? 'Ce modèle ne permet pas d’appliquer ces crampons 3D.' : volume ? 'Les crampons modifient la forme dans l’aperçu 3D et le modèle GBX exporté. La couleur et la matière peintes restent inchangées.' : 'Activez les crampons pour sculpter la roue. Sans cette option, le profil utilise des textures de relief.'}</p>
    </div>}
    {volumeBusy && <p className="hint wheel-volume-progress" role="status">Construction du pneu en cours…</p>}
    {value.mode !== 'smooth' && <div className="wheel-relief-strength">
      <SliderField label="Intensité du relief" value={shownStrength} min={0} max={1} step={.01} format={(strength) => `${Math.round(strength * 100)} %`} onChange={changeStrength} onCommit={volume ? commitStrength : undefined} disabled={volumeBusy} />
      <Row label="Valeur précise"><span className="wheel-percent-input"><input aria-label="Intensité précise du relief en pourcentage" type="number" min={0} max={100} step={1} value={volume ? draftPercent ?? Math.round(value.strength * 100) : Math.round(value.strength * 100)} disabled={volumeBusy} onChange={(event) => {
        if (volume) {
          if (!volumeBusy) { draftRef.current = event.target.value; setDraftPercent(event.target.value); }
        } else if (event.target.value !== '') changeStrength(event.target.valueAsNumber / 100);
      }} onBlur={volume ? commitStrength : undefined} onKeyDown={volume ? event => {
        if (event.key === 'Enter') { event.preventDefault(); commitStrength(); }
        else if (event.key === 'Escape') { event.preventDefault(); resetDraft(); }
      } : undefined} /><span>%</span></span></Row>
      {volume && <p className="hint">Relâchez le curseur ou validez la valeur précise avec Entrée pour appliquer la profondeur.</p>}
    </div>}
    {!officialModel && <p className="hint">Les profils prédéfinis utilisent les UV de la Stadium officielle. Sur ce modèle 3D, choisissez des pneus lisses ou le relief de son skin.</p>}
    {procedural && officialModel && <p className="hint">{volume ? 'Flancs moulés conservés. Le curseur règle la profondeur géométrique des crampons.' : 'Flancs moulés conservés. Profondeur nominale du dessin source ; rendu par texture de relief.'}</p>}
    <p className="hint wheel-profile-export">{volume ? 'Sculpture conservée dans le modèle GBX exporté.' : 'Relief exporté en DDS. « Relief 2D » permet d’inspecter les normales.'}</p>
  </div>;
}
