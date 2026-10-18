import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorCore } from '../editor/EditorCore';
import type { MapId } from '../maps';
import type { UvGuideIsland } from '../uvGuideData';
import { drawUvPart, organizedUvParts, uvSearchText, type UvPartEntry } from '../uvParts';
import { Icon } from './Icon';
import type { ProjectionTriangle } from '../three/decalProjection';
import { drawWheelPart } from './wheelPartPreview';
import './uvPartsBoard.css';
const NO_GEOMETRY: readonly ProjectionTriangle[] = [];

function PartTile({ part, texture, revision, selected, onSelect, onEdit, geometry, overview }: {
  part: UvPartEntry; texture: HTMLCanvasElement | null; revision: number; selected: boolean;
  onSelect(): void; onEdit(): void;
  geometry: readonly ProjectionTriangle[];
  overview?: { count:number; onOpen():void };
}) {
  const tile = useRef<HTMLButtonElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [wheelPreview,setWheelPreview]=useState(false);
  useEffect(() => {
    if (!tile.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '160px' });
    observer.observe(tile.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if(!canvas.current)return;
    if(!visible){canvas.current.width=canvas.current.height=1;return;}
    if(!texture)return;
    if(canvas.current.width!==256||canvas.current.height!==176){canvas.current.width=256;canvas.current.height=176;}
    const ctx = canvas.current.getContext('2d');
    if(ctx){const wheel=drawWheelPart(ctx,texture,part,geometry);setWheelPreview(wheel);if(!wheel)drawUvPart(ctx,texture,part);}
  }, [visible, texture, part, revision, geometry]);
  return <button type="button" ref={tile} className={`uv-part-tile${selected ? ' is-selected' : ''}`} aria-pressed={overview&&overview.count>1?undefined:selected}
    aria-label={overview&&overview.count>1?`Ouvrir ${part.parent.label} · ${overview.count} éléments`:`Sélectionner ${part.region.label}`}
    onClick={overview&&overview.count>1?overview.onOpen:onSelect} onDoubleClick={overview&&overview.count>1?overview.onOpen:onEdit}>
    <span className="uv-part-art"><canvas ref={canvas} width={256} height={176} aria-hidden="true" />{selected && <span className="uv-part-selected"><Icon name="check" size={12} /></span>}</span>
    {overview&&<span className="uv-part-group-label">{part.parent.label}</span>}
    <span className="uv-part-caption"><span>{wheelPreview ? part.parent.key === 'tyres:tread' ? 'Déroulé sur 360°' : 'Vue circulaire' : overview?`${overview.count} élément${overview.count>1?'s':''}`:`Élément ${part.element + 1}`}</span><small>{overview&&overview.count>1?'Ouvrir →':`${Math.max(1, Math.round(part.bounds.w * (texture?.width??2048)))} × ${Math.max(1, Math.round(part.bounds.h * (texture?.height??2048)))}`}</small></span>
  </button>;
}

export function UvPartsBoard({ editor, activeMap, islands, selected, onSelect, onEdit, onFocus, channelView }: {
  editor: EditorCore | null; activeMap: MapId; islands: UvGuideIsland[]; selected: string;
  onSelect(part: UvPartEntry): void; onEdit(part: UvPartEntry): void;
  onFocus?(island: UvGuideIsland): void;
  channelView?: 'roughness' | 'metalness' | 'data';
}) {
  const [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [groupKey,setGroupKey]=useState('');
  const organization = useMemo(() => { try { return {parts:organizedUvParts(islands),error:''}; }
    catch(error){return {parts:[],error:error instanceof Error?error.message:'Cette disposition est indisponible.'};} }, [islands]);
  const parts=organization.parts;
  const term = uvSearchText(query);
  const filtered = useMemo(() => parts.filter(p => uvSearchText(`${p.parent.label} élément ${p.element + 1}`).includes(term)), [parts, term]);
  const texture = editor?.getCanvasElement(activeMap) ?? null;
  const geometry = editor?.materialGeometry?.() ?? NO_GEOMETRY;
  useEffect(() => {
    let frame = 0;
    const unsubscribe = editor?.on('texture', () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setRevision(v => v + 1); });
    });
    return () => { unsubscribe?.(); cancelAnimationFrame(frame); };
  }, [editor]);
  const allGroups=islands.map(island=>({island,items:parts.filter(p=>p.parent.key===island.key)})).filter(g=>g.items.length);
  const groups = islands.map(island => ({ island, items: filtered.filter(p => p.parent.key === island.key) })).filter(g => g.items.length && (!groupKey||groupKey==='*'||g.island.key===groupKey));
  const chosen = parts.find(p => p.id === selected);
  useEffect(()=>{if(groupKey&&groupKey!=='*'&&!islands.some(i=>i.key===groupKey))setGroupKey('');},[islands,groupKey]);
  const family=islands[0]?.family;
  useEffect(()=>{setQuery('');setGroupKey('');},[family]);
  const tile=(part:UvPartEntry,overview?:{count:number;onOpen():void})=><PartTile key={part.id} part={part} texture={texture} revision={revision} geometry={geometry} selected={overview?selected.startsWith(`${part.parent.key}:element:`):selected===part.id} overview={overview} onSelect={()=>onSelect(part)} onEdit={()=>onEdit(part)}/>;
  return <section className={`uv-parts-board${channelView ? ` uv-parts-board--${channelView}` : ''}`} aria-label="Pièces UV rangées">
    <div className="uv-parts-heading"><div><h2>Pièces rangées</h2><p>{allGroups.length} pièce{allGroups.length>1?'s':''} · {parts.length} élément{parts.length>1?'s':''} · proportions conservées</p></div><Icon name="guide" size={20} /></div>
    <div className="uv-parts-tools"><input type="search" aria-label="Rechercher une pièce UV" placeholder="Rechercher une pièce…" value={query} onChange={e => setQuery(e.target.value)} />
      {chosen && <button type="button" className="btn btn-sm" onClick={() => onEdit(chosen)}><Icon name="target" size={14} /> Modifier la sélection</button>}</div>
    <label className="uv-parts-filter">Afficher<select aria-label="Pièce UV affichée" value={groupKey} onChange={e=>setGroupKey(e.target.value)}><option value="">Vue d’ensemble</option><option value="*">Tous les éléments</option>{allGroups.map(g=><option key={g.island.key} value={g.island.key}>{g.island.label} · {g.items.length}</option>)}</select></label>
    <p className="uv-parts-help">{groupKey?'Un clic sélectionne la forme et la cadre en 3D. Double-cliquez pour l’agrandir dans l’atlas.':'Ouvrez une pièce pour retrouver ses éléments et la cadrer en 3D.'}</p>
    <div className="uv-parts-scroll">
      {!groupKey?<div className="uv-parts-grid uv-parts-grid--overview">{groups.map(({island,items})=>tile(items.toSorted((a,b)=>b.area-a.area)[0],{count:items.length,onOpen:()=>{setGroupKey(island.key);onFocus?.(island);}}))}</div>:groups.map(({ island, items }) => <section className="uv-parts-group" key={island.key} aria-label={island.label}>
        <h3>{island.label}<span>{items.length}</span></h3>
        <div className="uv-parts-grid">{items.toSorted((a, b) => b.area - a.area || a.element - b.element).map(part => tile(part))}</div>
      </section>)}
      {!groups.length && <p className="uv-parts-empty" role="status">{organization.error || (query ? `Aucune pièce ne correspond à « ${query} ».` : 'Aucun contour UV disponible pour cette surface.')}</p>}
    </div>
  </section>;
}
