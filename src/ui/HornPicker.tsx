import { useEffect, useRef, useState } from 'react';
import { hornDuration, normalizeHornAudio, type SkinHorn } from '../horn';
import { Icon } from './Icon';

export function HornPicker({ horn, disabled, onChoose, onRemove }: {
  horn: SkinHorn | null;
  disabled: boolean;
  onChoose(file: File): void;
  onRemove(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!horn) { setUrl(''); return; }
    const next = URL.createObjectURL(new Blob([new Uint8Array(normalizeHornAudio(horn.data))], { type: 'audio/wav' }));
    setUrl(next);
    const audio = player.current;
    if (audio) audio.volume = 1;
    return () => { audio?.pause(); URL.revokeObjectURL(next); };
  }, [horn]);
  useEffect(() => { if (disabled) player.current?.pause(); }, [disabled]);

  return <section className="download-horn" aria-labelledby="horn-title" aria-describedby="horn-help">
    <div className="download-horn-heading"><Icon name="volume" size={20} /><h3 id="horn-title">Klaxon du skin</h3><span>Facultatif</span></div>
    <p id="horn-help">Ajoutez un son MP3, WAV ou OGG de 10 secondes maximum. Son volume sera renforcé automatiquement pour le jeu, avec une protection contre la saturation. La préécoute correspond au son exporté. Le son d’origine reste conservé dans votre projet.</p>
    <input ref={input} type="file" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" aria-label="Fichier audio du klaxon" hidden disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) onChoose(file);
    }} />
    <div className="download-horn-actions">
      <button type="button" className="btn" disabled={disabled} onClick={() => input.current?.click()}><Icon name="upload" size={15} />{horn ? 'Changer le son' : 'Ajouter un son'}</button>
      {horn ? <>
        <div className="download-horn-file" role="status"><strong title={horn.name}>{horn.name}</strong><span>{hornDuration(horn.data).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} s · WAV mono · {Math.ceil(horn.data.length / 1024)} Ko</span></div>
        <button type="button" className="btn download-horn-remove" disabled={disabled} onClick={onRemove} aria-label="Retirer le klaxon"><Icon name="trash" size={15} />Retirer</button>
      </> : <span className="download-horn-empty">Aucun son personnalisé</span>}
    </div>
    {horn && <audio ref={player} src={url || undefined} controls={!disabled} preload="metadata" aria-label="Écouter le klaxon exporté" />}
    <span className="hint">Conversion sur votre appareil · 10 Mo maximum · Aucun envoi du son</span>
  </section>;
}
