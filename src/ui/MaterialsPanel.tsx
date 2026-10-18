import { useEffect, useRef, useState } from 'react';
import type { UvGuideFamily, UvGuideIsland } from '../uvGuideData';
import { UV_GUIDE_BY_FAMILY } from '../uvGuideData';
import { detailsRegionOnSide, detailsSideLabel, detailsWholeSide } from '../detailsSides';
import { panelCanvasRegion, panelGuide } from '../underbodyPanel';
import { createMaterialDefinition, type MaterialChannel, type MaterialDefinition, type MaterialLayer, type MaterialTexture, type MaterialProjection } from '../materials/types';
import { MATERIAL_PRESETS } from '../materials/presets';
import { hasProceduralMaterialRelief, loadMaterialSources, renderMaterialLayer } from '../materials/render';
import { listMaterials, removeMaterial, saveMaterial, setMaterialFavorite, type StoredMaterial } from '../materials/library';
import { exportMaterialPack, importMaterialFilesDetailed } from '../materials/import';
import { SliderField, Swatch } from './controls';
import { Icon } from './Icon';
import './materialsPanel.css';

type Scope = 'selected' | 'parts' | 'all';
const CHANNEL_LABELS: Record<MaterialChannel, string> = {
  color: 'Couleur', roughness: 'Rugosité', metalness: 'Métal', roughmetal: 'Rugosité + métal',
  coat: 'Vernis', emission: 'Lumière', dirt: 'Salissure', normal: 'Relief', ao: 'Ombres (AO)', height: 'Hauteur (prototype)',
};
const CHANNELS = Object.keys(CHANNEL_LABELS) as MaterialChannel[];
const percent = (value: number) => `${Math.round(value * 100)} %`;
const bytePercent = (value: number) => `${Math.round(value / 255 * 100)} %`;
const fullRegion = { key: 'preview', label: 'Aperçu', polygons: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]] };
const alignedPreset = (definition: MaterialDefinition, projection: MaterialProjection = 'surface'): MaterialDefinition => ({
  ...definition,
  transform: { ...definition.transform, projection, ...(definition.transform.mode === 'stretch' ? { mode: 'cover' as const } : {}) },
});

/** The swatch uses the same material renderer as the actual atlas. */
function MaterialSwatch({ definition, family, large = false }: { definition: MaterialDefinition; family: UvGuideFamily; large?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    setUnavailable(false);
    void loadMaterialSources(definition).then(() => {
      if (disposed || !canvas.current) return;
      const swatch = { ...definition, transform: { ...definition.transform, projection: 'uv' as const } };
      const image = renderMaterialLayer({ definition: swatch, family, regions: [fullRegion], exclusions: [] }, 128).get('color');
      const context = canvas.current.getContext('2d');
      if (!image || !context) return;
      context.clearRect(0, 0, 128, 128);
      context.drawImage(image, 0, 0);
    }).catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; };
  }, [definition, family]);
  return <span className={`material-swatch${large ? ' material-swatch--large' : ''}`} style={{ backgroundColor: definition.color }}>
    <canvas ref={canvas} width={128} height={128} aria-hidden="true" />
    {unavailable && <span className="material-swatch-fallback" title="Image indisponible">!</span>}
  </span>;
}

export interface MaterialsPanelProps {
  family: UvGuideFamily;
  islands: UvGuideIsland[];
  selectedRegion: UvGuideIsland | null;
  selection: MaterialLayer | null;
  disabled: boolean;
  onApply(definition: MaterialDefinition, regions: string[], exclusions: string[]): void;
  onChange(definition: MaterialDefinition): void;
  onChangeMask(regions: string[], exclusions: string[]): void;
  onCommit(): void;
  onError(message: string): void;
}

export function MaterialsPanel({ family, islands, selectedRegion: chosenRegion, selection, disabled, onApply, onChange, onChangeMask, onCommit, onError }: MaterialsPanelProps) {
  const placement=selection?.atlasFrame?.placement;
  const selectedRegion = selection?.atlasSide && !chosenRegion?.key.includes(`:side:${selection.atlasSide}`)
    ||placement==='right'&&chosenRegion?.key!=='d_floor:panel:right'||placement==='base'&&chosenRegion?.key==='d_floor:panel:right'? null : chosenRegion;
  const wholeSideKey = selection?.atlasFrame ? panelCanvasRegion(selection.atlasFrame.placement).key : selection?.atlasSide ? detailsWholeSide(selection.atlasSide).key : null;
  const wheelPlacement=family==='wheels'&&islands.some(i=>i.key==='tyres:tread');
  const autoAlignment: MaterialProjection = wheelPlacement ? /^tyres:(inner|outer)/.test(selectedRegion?.key ?? '') ? 'wheel-face' : 'wheel' : 'surface';
  const [draft, setDraft] = useState(() => selection?.definition ?? alignedPreset(createMaterialDefinition('carbon'), autoAlignment));
  const [scope, setScope] = useState<Scope>(() => selection ? (selection.regions.length === 1 && selection.regions[0].key === wholeSideKey ? 'all' : selection.regions.length === 1 && selection.regions[0].key === selectedRegion?.key ? 'selected' : selection.regions.length ? 'parts' : 'all') : selectedRegion ? 'selected' : 'all');
  const [regions, setRegions] = useState<string[]>(() => selection?.regions.map((region) => region.key) ?? []);
  const [exclusions, setExclusions] = useState<string[]>(() => selection?.exclusions.map((region) => region.key) ?? []);
  const [library, setLibrary] = useState<StoredMaterial[]>([]);
  const [tab, setTab] = useState<'presets' | 'saved' | 'favorites'>('presets');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const [importQuality, setImportQuality] = useState<1024 | 2048 | 4096>(2048);
  const [libraryReady, setLibraryReady] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pendingChannel = useRef<MaterialChannel | null>(null);
  const pendingImportTarget = useRef<{ selection: MaterialLayer | null; family: UvGuideFamily } | null>(null);
  const pendingImageTarget = useRef<{ selection: MaterialLayer | null; family: UvGuideFamily } | null>(null);
  const pendingMask = useRef<string | null>(null);
  const selectionRef = useRef(selection);
  const familyRef = useRef(family);
  const selectedRegionRef = useRef(selectedRegion);
  const onErrorRef = useRef(onError);
  selectionRef.current = selection;
  familyRef.current = family;
  selectedRegionRef.current = selectedRegion;
  onErrorRef.current = onError;
  const selectedDefinition = selection?.definition;
  const selectionPresent = !!selection;
  useEffect(() => {
    if (!selectionPresent && family === 'wheels') setDraft(previous => ['surface','wheel','wheel-face'].includes(previous.transform.projection ?? '')
      ? { ...previous, transform: { ...previous.transform, projection: autoAlignment } } : previous);
  }, [autoAlignment, family, selectionPresent]);
  const maskKey = selection ? JSON.stringify([selection.regions.map((region) => region.key), selection.exclusions.map((region) => region.key)]) : '';

  useEffect(() => {
    if (selectedDefinition) setDraft(selectedDefinition);
  }, [selectedDefinition]);
  useEffect(() => {
    if (maskKey) {
      const [included, excluded] = JSON.parse(maskKey) as [string[], string[]];
      setRegions(included);
      setExclusions(excluded);
      if (pendingMask.current !== maskKey) setScope(included.length === 1 && included[0] === wholeSideKey ? 'all' : included.length === 1 && included[0] === selectedRegionRef.current?.key ? 'selected' : included.length ? 'parts' : 'all');
      pendingMask.current = null;
    }
  }, [maskKey, wholeSideKey]);
  useEffect(() => {
    if (!selectionPresent) {
      setRegions([]);
      setExclusions([]);
      setScope(selectedRegionRef.current ? 'selected' : 'all');
    }
  }, [family, selectionPresent]);
  const selectedRegionKey = selectedRegion?.key;
  useEffect(() => {
    if (!selectedRegionKey && selectionPresent && scope === 'selected') setScope(regions.length ? 'parts' : 'all');
  }, [selectedRegionKey, selectionPresent, scope, regions.length]);
  useEffect(() => {
    let disposed = false;
    void listMaterials().then((items) => { if (!disposed) { setLibrary(items); setLibraryReady(true); } })
      .catch((error: unknown) => { if (!disposed) { setLibraryReady(true); onErrorRef.current(error instanceof Error ? error.message : 'La bibliothèque est indisponible.'); } });
    return () => { disposed = true; };
  }, []);

  const unavailable = disabled || busy;
  const visibleIslands = placement==='right'?[panelGuide('right')]:selection?.atlasSide
    ? UV_GUIDE_BY_FAMILY.details.map(island => detailsRegionOnSide(island, selection.atlasSide!))
    : islands.filter((island) => island.family === family&&(placement!=='base'||island.key!=='d_floor:panel:right'));
  const visibleKeys = new Set(visibleIslands.map((island) => island.key));
  // Precise elements retain their names even when the parent guide only lists whole pieces.
  const retainedRegions = [...(selection?.family === family ? [...selection.regions, ...selection.exclusions] : []), ...(selectedRegion?.family === family ? [selectedRegion] : [])];
  for (const region of retainedRegions) if (!visibleKeys.has(region.key)) {
    visibleIslands.push({ ...region, family });
    visibleKeys.add(region.key);
  }
  const targetRegions = scope === 'all' ? (wholeSideKey ? [wholeSideKey] : []) : scope === 'selected' ? (selectedRegion ? [selectedRegion.key] : []) : regions;
  const targetValid = scope === 'all' || targetRegions.length > 0;
  const textureEntries = CHANNELS.filter((channel) => draft.textures[channel]);
  const materialImageCount = new Set(Object.values(draft.textures).flatMap((source) => source ? [source.src] : [])).size;
  const projection = draft.transform.projection ?? 'uv';
  const onCar = projection !== 'uv';
  const following = projection === 'surface' || projection === 'wheel' || projection === 'wheel-face';

  function change(next: MaterialDefinition, commit = false) {
    setDraft(next);
    setStatus('');
    setImportNotices([]);
    if (selection) { onChange(next); if (commit) onCommit(); }
  }
  function changeTransform(next: Partial<MaterialDefinition['transform']>) {
    change({ ...draft, transform: { ...draft.transform, ...next } });
  }
  function changeMask(nextScope: Scope, nextRegions = regions, nextExclusions = exclusions) {
    setScope(nextScope);
    setRegions(nextRegions);
    setExclusions(nextExclusions);
    const keys = nextScope === 'all' ? (wholeSideKey ? [wholeSideKey] : []) : nextScope === 'selected' ? (selectedRegion ? [selectedRegion.key] : []) : nextRegions;
    if (selection && (nextScope === 'all' || keys.length)) {
      pendingMask.current = JSON.stringify([keys, nextExclusions]);
      onChangeMask(keys, nextExclusions); onCommit();
    }
  }
  function updateTexture(channel: MaterialChannel, next: MaterialTexture | null) {
    const textures = { ...draft.textures };
    if (next) textures[channel] = next;
    else delete textures[channel];
    change({ ...draft, textures, ...(next && !draft.textures[channel] ? initialTextureSettings(channel) : {}) }, true);
  }
  function initialTextureSettings(channel: MaterialChannel): Partial<MaterialDefinition> {
    return {
      ...(channel === 'color' ? { color: '#ffffff' } : {}),
      ...(channel === 'emission' ? { emissionStrength: 1 } : {}),
      ...(channel === 'roughness' || channel === 'roughmetal' ? { roughness: 255 } : {}),
      ...(channel === 'metalness' || channel === 'roughmetal' ? { metalness: 255 } : {}),
      ...(channel === 'coat' ? { coat: 255 } : {}),
      ...(channel === 'dirt' ? { dirt: 255 } : {}),
    };
  }
  function moveTexture(from: MaterialChannel, to: MaterialChannel) {
    if (from === to) return;
    if (draft.textures[to]) { onError(`Une image est déjà affectée au canal « ${CHANNEL_LABELS[to]} ». Retirez-la avant de déplacer cette texture.`); return; }
    const textures = { ...draft.textures, [to]: draft.textures[from] };
    delete textures[from];
    change({ ...draft, textures, ...initialTextureSettings(to) }, true);
  }
  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    try { await operation(); }
    catch (error: unknown) { onError(error instanceof Error ? error.message : 'Impossible de terminer cette opération.'); }
    finally { setBusy(false); }
  }
  function requestImage(channel: MaterialChannel) {
    pendingChannel.current = channel;
    pendingImageTarget.current = { selection, family };
    imageInput.current?.click();
  }
  function targetUnchanged(target: { selection: MaterialLayer | null; family: UvGuideFamily }) {
    const unchanged = selectionRef.current === target.selection && familyRef.current === target.family;
    if (!unchanged) setStatus('Import annulé : le calque ou la surface a changé.');
    return unchanged;
  }
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'materiau'}.skion-material.zip`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const saved = library.filter((item) => tab !== 'favorites' || item.favorite);

  const libraryPanel = <details key="material-library" className="materials-library-disclosure" open={!selection}>
    <summary>{selection ? 'Changer ou importer un matériau' : 'Choisir un matériau'}</summary>
    <div className="materials-library">
      <div className="materials-tabs" role="tablist" aria-label="Bibliothèque de matériaux">
        {([['presets', 'Prêts à utiliser'], ['saved', 'Mes matériaux'], ['favorites', 'Favoris']] as const).map(([id, label]) =>
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="materials-grid" role="tabpanel" aria-label={tab === 'presets' ? 'Matériaux prêts à utiliser' : tab === 'favorites' ? 'Matériaux favoris' : 'Mes matériaux'}>
        {tab === 'presets' ? MATERIAL_PRESETS.map((preset) => <button key={preset.id} type="button" className={`material-card${draft.preset === preset.id && draft.name === preset.definition.name ? ' is-active' : ''}`} disabled={unavailable} title={preset.hint}
          onClick={() => change(alignedPreset(structuredClone(preset.definition), autoAlignment), true)}>
          <MaterialSwatch definition={preset.definition} family={family} />
          <span>{preset.label}</span>
        </button>) : saved.map((item) => <div className="material-saved" key={item.id}>
          <button type="button" className="material-card" disabled={unavailable} title={`Utiliser ${item.definition.name}`} onClick={() => change(alignedPreset(structuredClone(item.definition), autoAlignment), true)}>
            <MaterialSwatch definition={item.definition} family={family} /><span>{item.definition.name}</span>
          </button>
          <div className="material-saved-actions">
            <button type="button" disabled={unavailable} aria-label={`${item.favorite ? 'Retirer des' : 'Ajouter aux'} favoris : ${item.definition.name}`} aria-pressed={item.favorite}
              className={item.favorite ? 'is-favorite' : ''} onClick={() => void perform(async () => { await setMaterialFavorite(item.id, !item.favorite); setLibrary(await listMaterials()); })}>{item.favorite ? '★' : '☆'}</button>
            <button type="button" disabled={unavailable} aria-label={`Exporter ${item.definition.name}`} title="Exporter ce matériau" onClick={() => void perform(async () => download(await exportMaterialPack(item.definition), item.definition.name))}><Icon name="download" size={12} /></button>
            <button type="button" disabled={unavailable} aria-label={`Supprimer ${item.definition.name} de la bibliothèque`} title="Supprimer de la bibliothèque" onClick={() => void perform(async () => { await removeMaterial(item.id); setLibrary(await listMaterials()); })}><Icon name="trash" size={12} /></button>
          </div>
        </div>)}
        {tab !== 'presets' && saved.length === 0 && <p className="materials-empty">{!libraryReady ? 'Chargement…' : tab === 'favorites' ? 'Ajoutez une étoile à vos matériaux préférés.' : 'Personnalisez un matériau puis enregistrez-le ici.'}</p>}
      </div>
      <label className="material-select-row materials-import-quality">Qualité ZIP / EXR<select aria-label="Qualité ZIP / EXR" value={importQuality} disabled={unavailable}
        onChange={(event) => setImportQuality(Number(event.target.value) as 1024 | 2048 | 4096)}><option value={1024}>1K · légère</option><option value={2048}>2K · équilibrée</option><option value={4096}>4K · détaillée</option></select></label>
      <input ref={importInput} type="file" accept="image/png,image/jpeg,image/webp,.exr,.zip" multiple hidden aria-label="Importer des images ou un pack de matériau" disabled={unavailable}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = '';
          const target = pendingImportTarget.current ?? { selection, family }; pendingImportTarget.current = null;
          if (files.length) void perform(async () => {
            if (!targetUnchanged(target)) return;
            const imported = await importMaterialFilesDetailed(files, { maxTextureSize: importQuality });
            if (!targetUnchanged(target)) return;
            const compatible=!['wheel','wheel-face'].includes(imported.definition.transform.projection??'')||wheelPlacement;
            const next = imported.preservedPlacement&&compatible ? imported.definition : alignedPreset(imported.definition, autoAlignment);
            change(next, true);
            setImportNotices(imported.notices);
            setStatus('Images importées. Vérifiez leur affectation dans « Images et canaux ».');
          });
        }} />
      <button type="button" className="btn btn-sm btn-full" disabled={unavailable} onClick={() => { pendingImportTarget.current = { selection, family }; importInput.current?.click(); }}><Icon name="upload" size={14} />Importer des images ou un pack</button>
      <p className="materials-import-hint">PNG, JPG, WebP, EXR ou ZIP Blender / Skion. Plusieurs images peuvent être choisies ensemble.</p>
      <p className="materials-import-hint">La qualité limite la taille des images des ZIP et EXR pour garder l’éditeur fluide. Les PNG et JPG importés seuls gardent leur taille.</p>
    </div>
  </details>;

  const currentMaterial = <div key="current-material" className="material-current">
      <MaterialSwatch definition={draft} family={family} large />
      <div className="material-current-heading"><span>{selection ? 'Matériau du calque' : 'Nouveau matériau'}</span>
        <input aria-label="Nom du matériau" maxLength={80} value={draft.name} disabled={unavailable} onChange={(event) => {
          const name = event.target.value;
          if (name.trim()) change({ ...draft, name });
          else setDraft({ ...draft, name });
        }} onBlur={() => {
          if (!draft.name.trim()) setDraft({ ...draft, name: selection?.definition.name ?? 'Mon matériau' });
          onCommit();
        }} />
        <span className="material-current-status">{textureEntries.length ? `${textureEntries.length} image${textureEntries.length > 1 ? 's' : ''} associée${textureEntries.length > 1 ? 's' : ''}` : hasProceduralMaterialRelief(draft) ? 'Tissage intégré · couleur, finition et relief' : draft.preset === 'solid' ? 'Couleur unie · finition personnalisable' : 'Motif intégré · couleur et brillance'}</span>
      </div>
    </div>;

  return <div className="materials-panel" aria-busy={busy}>
    <div className="materials-intro">
      <div className="materials-intro-title"><Icon name="layers" size={16} /><strong>Matériaux</strong><span className="materials-local-badge">Sans installation</span></div>
      <p className="hint">Le motif épouse les courbes de la surface choisie : carrosserie, détails ou roues. Sa couleur et ses finitions se règlent ensemble.</p>
    </div>
    {selection ? currentMaterial : libraryPanel}
    {!selection && currentMaterial}
    <div className={`material-surface-follow${following ? ' is-active' : ''}`} role="group" aria-label="Application sur la surface 3D">
      <div className="material-surface-follow-title"><Icon name={family === 'wheels' ? 'circle' : 'box'} size={15} /><strong>{family === 'wheels' && following ? projection === 'wheel-face' ? 'Flanc vu de face' : 'Enroulement autour du pneu' : following ? 'Suivi de la surface 3D' : 'Placement depuis une vue ou la feuille UV'}</strong></div>
      <p>{family === 'wheels' ? 'La bande de roulement se déroule sur un tour complet. Les flancs disposent d’un placement circulaire pour préserver les proportions des images.' : following ? 'Le motif suit le volume des pièces, avec des proportions et une échelle cohérentes. Les zones choisies délimitent son application.' : 'Pour que ce matériau accompagne les courbes, activez le suivi de surface. Vos images et les pièces sélectionnées sont conservées.'}</p>
      {!following && <button type="button" className="btn btn-sm btn-full" disabled={unavailable} onClick={() => change(alignedPreset(draft, autoAlignment), true)}>{family === 'wheels' ? 'Adapter le motif aux roues' : 'Suivre la surface 3D'}</button>}
    </div>
    {importNotices.length > 0 && <details className="materials-import-report" role="status" aria-live="polite" aria-label="Informations d’import"><summary><span>Import terminé · voir le détail</span><span className="materials-import-count" title="Images du matériau">{materialImageCount} image{materialImageCount > 1 ? 's' : ''}</span></summary><ul>{importNotices.map((notice, index) => <li key={`${index}:${notice}`}>{notice}</li>)}</ul></details>}

    <fieldset className="materials-fields" disabled={unavailable}>
      <legend>Apparence</legend>
      <div className="material-color-row"><span>{draft.textures.color ? 'Teinte de l’image' : 'Couleur'}</span><Swatch value={draft.color} title="Couleur du matériau" showHex onChange={(color) => change({ ...draft, color })} /></div>
      <SliderField label={draft.textures.roughness || draft.textures.roughmetal ? 'Rugosité · image' : 'Rugosité'} value={draft.roughness} min={0} max={255} format={bytePercent}
        title={draft.textures.roughness || draft.textures.roughmetal ? '100 % conserve les valeurs de l’image. 0 % supprime sa rugosité.' : 'Faible : brillant. Élevée : mat.'} onChange={(roughness) => change({ ...draft, roughness })} onCommit={onCommit} />
      <SliderField label={draft.textures.metalness || draft.textures.roughmetal ? 'Métal · image' : 'Métal'} value={draft.metalness} min={0} max={255} format={bytePercent}
        title={draft.textures.metalness || draft.textures.roughmetal ? '100 % conserve les valeurs de l’image. 0 % supprime son effet métallique.' : 'Faible : peinture ou plastique. Élevée : métal.'} onChange={(metalness) => change({ ...draft, metalness })} onCommit={onCommit} />
      <SliderField label={draft.textures.coat ? 'Vernis · image' : 'Vernis'} value={draft.coat} min={0} max={255} format={bytePercent}
        title={draft.textures.coat ? '100 % conserve les valeurs de l’image. 0 % supprime son vernis.' : 'Intensité de la couche de vernis.'} onChange={(coat) => change({ ...draft, coat })} onCommit={onCommit} />
      <SliderField label="Opacité" value={draft.opacity} min={0} max={1} step={.01} format={percent} onChange={(opacity) => change({ ...draft, opacity })} onCommit={onCommit} />
    </fieldset>

    <details className="material-details" open>
      <summary>Placement du motif</summary>
      <fieldset className="materials-fields" disabled={unavailable}>
        <label className="material-select-row">Alignement<select aria-label="Alignement de la matière" value={projection}
          onChange={(event) => { const projection = event.target.value as MaterialDefinition['transform']['projection']; changeTransform({ projection, ...(['surface','wheel','wheel-face'].includes(projection ?? '') && draft.transform.mode === 'stretch' ? { mode: 'cover' as const } : {}) }); onCommit(); }}>
          {wheelPlacement && <><option value="wheel">Pneu · enroulement 360°</option><option value="wheel-face">Flanc · vue circulaire</option></>}
          {(family !== 'wheels' || projection === 'surface') && <option value="surface">{family === 'wheels' ? 'Pneu · suivi de surface' : 'Suivre la surface 3D'}</option>}
          <option value="top">Voiture · dessus</option>
          <option value="triplanar">Projection sur 3 axes</option>
          <option value="side">Voiture · côté</option>
          <option value="front">Voiture · face</option>
          <option value="uv">Feuille UV</option>
        </select></label>
        <p className="hint material-placement-hint">{family === 'wheels' && following
          ? projection === 'wheel-face' ? 'Pour une image ou un logo sur le flanc, choisissez Couvrir ou Contenir. Le placement suit une vue de face de la roue.' : 'Le placement utilise la largeur et la circonférence réelles du pneu. En mode Répéter, le pas et l’angle s’ajustent légèrement pour raccorder le motif après un tour, sans étirer l’image.'
          : projection === 'surface'
          ? 'Le motif accompagne les courbes de la pièce en préservant ses proportions. Répéter convient aux matières. Des raccords restent possibles aux courbes les plus fortes.'
          : projection === 'triplanar'
          ? 'Trois projections sont mélangées sur les courbes. Ce mode peut estomper ou dédoubler un motif : préférez Suivre la surface 3D pour un tissage.'
          : onCar ? 'L’image traverse les pièces depuis cette vue. Pour une illustration sur le capot et les épaules, choisissez Dessus puis Couvrir.'
          : 'L’image suit la feuille UV. Les pièces séparées sur cette feuille peuvent couper le motif en 3D.'}</p>
        <div className="material-fit" role="group" aria-label="Placement des textures">
          {([['repeat', 'Répéter'], ['cover', 'Couvrir'], ['contain', 'Contenir'], ['stretch', 'Étirer']] as const).map(([mode, label]) => <button type="button" key={mode} disabled={following && mode === 'stretch'} title={following && mode === 'stretch' ? 'Le suivi de surface conserve le format de l’image. Choisissez Couvrir ou Contenir.' : undefined} aria-pressed={(following && draft.transform.mode === 'stretch' ? 'cover' : draft.transform.mode) === mode} className={(following && draft.transform.mode === 'stretch' ? 'cover' : draft.transform.mode) === mode ? 'is-active' : ''}
            onClick={() => { changeTransform({ mode }); onCommit(); }}>{label}</button>)}
        </div>
        <SliderField label="Taille du motif" value={draft.transform.size} min={8} max={2048} step={8} format={(size) => onCar ? `${Math.round(size / (draft.transform.mode === 'repeat' ? 2048 : 256) * 1000) / 10} %` : `${size} px`} title={onCar ? (draft.transform.mode === 'repeat' ? 'Largeur du motif par rapport à la longueur de la voiture.' : '100 % ajuste l’image à la voiture.') : 'Taille sur une texture de référence de 2048 px.'} onChange={(size) => changeTransform({ size })} onCommit={onCommit} />
        <SliderField label="Rotation" value={draft.transform.angle} min={-180} max={180} format={(angle) => `${angle}°`} onChange={(angle) => changeTransform({ angle })} onCommit={onCommit} />
        <SliderField label="Décalage X" value={draft.transform.offsetX} min={-2048} max={2048} step={8} format={(offset) => onCar ? `${Math.round(offset / 2048 * 1000) / 10} %` : `${offset} px`} onChange={(offsetX) => changeTransform({ offsetX })} onCommit={onCommit} />
        <SliderField label="Décalage Y" value={draft.transform.offsetY} min={-2048} max={2048} step={8} format={(offset) => onCar ? `${Math.round(offset / 2048 * 1000) / 10} %` : `${offset} px`} onChange={(offsetY) => changeTransform({ offsetY })} onCommit={onCommit} />
        <div className="material-check-row">
          <label><input type="checkbox" checked={draft.transform.flipX} onChange={(event) => { changeTransform({ flipX: event.target.checked }); onCommit(); }} />Miroir X</label>
          <label><input type="checkbox" checked={draft.transform.flipY} onChange={(event) => { changeTransform({ flipY: event.target.checked }); onCommit(); }} />Miroir Y</label>
        </div>
        <p className="hint">Toutes les images utilisent le même placement. {onCar ? 'Les zones choisies limitent la peinture sans déplacer le motif. Les pièces qui partagent les mêmes UV restent liées.' : 'Augmentez la taille si le motif paraît lisse en 3D.'}</p>
      </fieldset>
    </details>

    <details className="material-details">
      <summary>Effets et lumière</summary>
      <fieldset className="materials-fields" disabled={unavailable}>
        <SliderField label={draft.textures.dirt ? 'Salissure · image' : 'Salissure'} value={draft.dirt} min={0} max={255} format={bytePercent}
          title={draft.textures.dirt ? '100 % conserve les valeurs de l’image. 0 % supprime sa salissure.' : 'Intensité de la salissure.'} onChange={(dirt) => change({ ...draft, dirt })} onCommit={onCommit} />
        <div className="material-color-row"><span>Lumière</span><Swatch value={draft.emissionColor} title="Couleur de la lumière" showHex onChange={(emissionColor) => change({ ...draft, emissionColor })} /></div>
        <SliderField label="Intensité" value={draft.emissionStrength} min={0} max={1} step={.01} format={percent} onChange={(emissionStrength) => change({ ...draft, emissionStrength })} onCommit={onCommit} />
        <label className="material-select-row">Activation<select aria-label="Activation de la lumière" value={draft.emissionRole} onChange={(event) => change({ ...draft, emissionRole: event.target.value as MaterialDefinition['emissionRole'] }, true)}><option value="always">Toujours</option><option value="head">Phares</option><option value="brake">Freinage</option></select></label>
        {(family !== 'skin' || draft.textures.normal || hasProceduralMaterialRelief(draft)) && <SliderField label="Relief" value={draft.normalStrength} min={0} max={2} step={.05} disabled={!draft.textures.normal && !hasProceduralMaterialRelief(draft)} title={family === 'skin' ? 'Intensité des normales dans le prototype. La carrosserie standard exportée conserve sa forme.' : 'Intensité du relief fourni par les normales.'} format={(value) => `${value.toFixed(2)}×`} onChange={(normalStrength) => change({ ...draft, normalStrength })} onCommit={onCommit} />}
        <p className="hint">{family === 'skin' ? 'Carrosserie : normales et hauteur utilisées dans le prototype. Le skin standard exporté conserve sa forme, sans normales personnalisées sur la carrosserie.' : hasProceduralMaterialRelief(draft) ? 'Le carbone génère les normales du tissage pour simuler le relief dans la lumière, sans modifier la forme de la voiture.' : draft.textures.normal ? 'L’image de normales simule le relief dans la lumière, sans modifier la forme de la voiture.' : 'Les presets ajoutent un motif et une finition. Ajoutez une image au canal Relief dans « Images et canaux » pour simuler un relief.'}</p>
        {draft.textures.ao && <SliderField label="Ombres AO" value={draft.aoStrength} min={0} max={1} step={.01} format={percent} onChange={(aoStrength) => change({ ...draft, aoStrength })} onCommit={onCommit} />}
      </fieldset>
    </details>

    <details className="material-details">
      <summary>Images et canaux {textureEntries.length > 0 && <span className="material-count">{textureEntries.length}</span>}</summary>
      <fieldset className="materials-fields" disabled={unavailable}>
        <p className="hint">L’affectation est détectée à l’import. Vous pouvez la corriger ici.</p>
        {textureEntries.map((channel) => {
          const source = draft.textures[channel]!;
          return <div className="material-source" key={channel}>
            <div className="material-source-heading"><img src={source.src} alt="" loading="lazy" /><div><strong>{CHANNEL_LABELS[channel]}</strong><span title={source.name}>{source.name}</span></div></div>
            <label className="material-select-row">Canal<select aria-label={`Affectation de ${source.name}`} value={channel} onChange={(event) => moveTexture(channel, event.target.value as MaterialChannel)}>
              {CHANNELS.map((target) => <option key={target} value={target}>{CHANNEL_LABELS[target]}</option>)}
            </select></label>
            {channel !== 'color' && channel !== 'normal' && channel !== 'emission' && channel !== 'roughmetal' && <div className="material-source-options"><label>Lecture<select aria-label={`Composante de ${CHANNEL_LABELS[channel]}`} value={source.component} onChange={(event) => updateTexture(channel, { ...source, component: event.target.value as MaterialTexture['component'] })}><option value="luminance">Gris</option><option value="r">Rouge (R)</option><option value="g">Vert (G)</option><option value="b">Bleu (B)</option></select></label><label><input type="checkbox" checked={source.invert} onChange={(event) => updateTexture(channel, { ...source, invert: event.target.checked })} />Inverser</label></div>}
            {channel === 'roughmetal' && <p className="hint">Image combinée : rugosité en rouge, métal en vert.</p>}
            {channel === 'normal' && <><label className="material-normal-convention"><input type="checkbox" aria-label="Normal DirectX (Y inversé)" checked={source.invert} onChange={(event) => updateTexture(channel, { ...source, invert: event.target.checked })} />Normal DirectX (Y inversé)</label><p className="hint">OpenGL par défaut. Activez cette option pour une image de normales DirectX.</p></>}
            {channel === 'normal' && family === 'skin' && <p className="hint">Carrosserie : utilisée dans le prototype ; export standard sans normales personnalisées. Les normales du skin standard sont prises en charge sur Détails et Roues.</p>}
            {channel === 'height' && <p className="hint">Clair : bosses ; sombre : creux. Cette carte sert au prototype de relief et reste dans votre projet. Le skin standard exporté conserve sa forme.</p>}
            <div className="material-source-actions"><button type="button" className="btn btn-sm" onClick={() => requestImage(channel)}>Remplacer</button><button type="button" className="btn btn-sm" onClick={() => updateTexture(channel, null)}>Retirer</button></div>
          </div>;
        })}
        <label className="material-select-row">Ajouter une image<select aria-label="Ajouter une image à un canal" value="" onChange={(event) => { if (event.target.value) requestImage(event.target.value as MaterialChannel); }}>
          <option value="">Choisir un canal…</option>{CHANNELS.filter((channel) => !draft.textures[channel]).map((channel) => <option key={channel} value={channel}>{CHANNEL_LABELS[channel]}</option>)}
        </select></label>
        <p className="hint">Les normales du skin standard sont prises en charge sur Détails et Roues. La hauteur sert au prototype. Les images restent dans votre projet.</p>
      </fieldset>
    </details>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp,.exr" hidden aria-label="Image pour le canal de matériau" disabled={unavailable} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = '';
      const channel = pendingChannel.current; pendingChannel.current = null;
      const target = pendingImageTarget.current ?? { selection, family }; pendingImageTarget.current = null;
      if (file && channel) void perform(async () => {
        if (!targetUnchanged(target)) return;
        const imported = await importMaterialFilesDetailed([file], { maxTextureSize: importQuality, targetChannel: channel });
        if (!targetUnchanged(target)) return;
        const source = imported.definition.textures[channel] ?? Object.values(imported.definition.textures).find(Boolean);
        if (!source) throw new Error('Aucune image utilisable dans ce fichier.');
        updateTexture(channel, source);
        setImportNotices(imported.notices);
        setStatus('Image importée dans le canal sélectionné.');
      });
    }} />

    <details className="material-details" open>
      <summary>Zones d’application</summary>
      <fieldset className="materials-fields" disabled={unavailable}>
        <div className="material-scope" role="group" aria-label="Portée du matériau">
          <button type="button" aria-pressed={scope === 'selected'} disabled={!selectedRegion} title={selectedRegion ? selectedRegion.label : 'Sélectionnez une pièce sur le guide UV'} className={scope === 'selected' ? 'is-active' : ''} onClick={() => changeMask('selected')}>Cette pièce</button>
          <button type="button" aria-pressed={scope === 'parts'} className={scope === 'parts' ? 'is-active' : ''} onClick={() => changeMask('parts', regions.length ? regions : selectedRegion ? [selectedRegion.key] : [])}>Plusieurs</button>
          <button type="button" aria-pressed={scope === 'all'} className={scope === 'all' ? 'is-active' : ''} onClick={() => changeMask('all')}>Tout</button>
        </div>
        {scope === 'selected' && <p className="material-zone-summary">{selectedRegion?.label ?? 'Sélectionnez une pièce sur le guide UV.'}</p>}
        {scope === 'parts' && <div className="material-region-list" aria-label="Pièces incluses">
          {visibleIslands.map((island) => <label key={island.key}><input type="checkbox" checked={regions.includes(island.key)} disabled={!!selection && regions.length === 1 && regions.includes(island.key)} title={selection && regions.length === 1 && regions.includes(island.key) ? 'Conservez au moins une pièce, ou choisissez « Tout ».' : undefined} onChange={(event) => changeMask('parts', event.target.checked ? [...regions, island.key] : regions.filter((key) => key !== island.key))} /><span>{island.label}</span></label>)}
          {visibleIslands.length === 0 && <p className="hint">Aucune pièce nommée pour cette surface. Choisissez « Tout ».</p>}
        </div>}
        {scope === 'parts' && regions.length === 0 && <p className="hint">Cochez au moins une pièce pour appliquer le matériau.</p>}
        {scope === 'all' && <p className="material-zone-summary">{placement==='right'?'Tout le panneau inférieur droit.':placement==='base'?'Tous les détails, sauf le panneau inférieur droit transféré.':selection?.atlasSide ? `Tous les détails du côté ${detailsSideLabel(selection.atlasSide)}.` : `Toute la surface ${family === 'skin' ? 'Carrosserie' : family === 'details' ? 'Détails' : 'Roues'}.`}</p>}
        {visibleIslands.length > 0 && <details className="material-exclusions"><summary>Exclure des pièces {exclusions.length > 0 && `(${exclusions.length})`}</summary><div className="material-region-list" aria-label="Pièces exclues">
          {visibleIslands.map((island) => <label key={island.key}><input type="checkbox" checked={exclusions.includes(island.key)} onChange={(event) => changeMask(scope, regions, event.target.checked ? [...exclusions, island.key] : exclusions.filter((key) => key !== island.key))} /><span>{island.label}</span></label>)}
        </div></details>}
      </fieldset>
    </details>

    {selection && libraryPanel}
    <div className="material-bottom-actions">
      <button type="button" className="btn btn-primary btn-full" disabled={unavailable || !targetValid || !draft.name.trim()} onClick={() => { onApply(structuredClone(draft), targetRegions, exclusions); setStatus('Calque de matériau créé.'); }}><Icon name="plus" size={14} />{selection ? 'Créer un calque séparé' : 'Ajouter le matériau'}</button>
      {selection && <p className="hint">Les réglages modifient le calque sélectionné. Son masque est conservé quand vous changez de matériau.</p>}
      <div className="material-library-actions"><button type="button" className="btn btn-sm" disabled={unavailable || !draft.name.trim()} onClick={() => void perform(async () => { await saveMaterial(draft); setLibrary(await listMaterials()); setTab('saved'); setStatus('Variante enregistrée dans Mes matériaux.'); })}><Icon name="save" size={13} />Enregistrer une variante</button>
        <button type="button" className="btn btn-sm" disabled={unavailable} onClick={() => void perform(async () => { download(await exportMaterialPack(draft), draft.name); setStatus('Pack de matériau exporté.'); })}><Icon name="download" size={13} />Pack</button></div>
      <p className="materials-status" role="status" aria-live="polite">{busy ? 'Traitement en cours…' : status}</p>
    </div>
  </div>;
}
