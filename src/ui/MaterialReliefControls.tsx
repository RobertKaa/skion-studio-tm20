import { surfaceRelief, type SurfaceReliefSettings } from '../materials/relief';
import { hasProceduralMaterialRelief } from '../materials/render';
import type { MaterialDefinition } from '../materials/types';
import { SliderField } from './controls';
import { Icon } from './Icon';

export function MaterialReliefControls({definition,family,disabled,onChange,onCommit,onVolume,onEstimate}:{definition:MaterialDefinition;family:'skin'|'details'|'wheels';disabled:boolean;onChange:(definition:MaterialDefinition)=>void;onCommit:()=>void;onVolume?:()=>void;onEstimate:()=>void}){
 const settings=surfaceRelief(definition),normal=!!definition.textures.normal,height=!!definition.textures.height,procedural=hasProceduralMaterialRelief(definition);
 const change=(patch:Partial<SurfaceReliefSettings>)=>onChange({...definition,surfaceRelief:{...settings,...patch}});
 return <section className="material-relief-section" aria-label="Relief et hauteur">
  <div className="material-relief-heading"><Icon name="box" size={16}/><strong>Relief & hauteur</strong><span>{height?'Hauteur détectée':normal?'Normales détectées':procedural?'Tissage intégré':'Sans relief'}</span></div>
  <div className="material-relief-route"><strong>{family==='skin'?'Relief en jeu':'Détails de surface'}</strong><p>{family==='skin'?'Une carte de hauteur produit le volume de carrosserie. Les normales peuvent servir à estimer cette hauteur.':'Les normales modifient les reflets. La hauteur peut aussi générer ces détails, sans changer la silhouette.'}</p>
   {family!=='skin'&&<>
   <label className="material-select-row">Source<select aria-label="Source des détails de surface" value={settings.source} disabled={disabled} onChange={e=>{change({source:e.target.value as SurfaceReliefSettings['source']});onCommit();}}>
    <option value="auto">Automatique</option><option value="normal" disabled={!normal&&!procedural}>Normales de la texture</option><option value="height" disabled={!height}>Détails depuis la hauteur</option><option value="combined" disabled={!normal||!height}>Normales + hauteur</option><option value="none">Désactivés</option>
   </select></label>
   <SliderField label="Intensité des détails" value={definition.normalStrength} min={0} max={2} step={.05} disabled={disabled||!normal&&!height&&!procedural||settings.source==='none'} format={v=>`${v.toFixed(2)}×`} onChange={normalStrength=>onChange({...definition,normalStrength})} onCommit={onCommit}/>
   {height&&<SliderField label="Détails issus de la hauteur" value={settings.heightStrength} min={0} max={4} step={.05} disabled={disabled||settings.source==='none'||settings.source==='normal'||settings.source==='auto'&&normal} format={v=>`${v.toFixed(2)}×`} onChange={heightStrength=>change({heightStrength})} onCommit={onCommit}/>}
   </>}
   <p className="material-game-status">{family==='skin'?'Carrosserie : seul le volume géométrique est confirmé en course. Les normales de texture ne sont pas proposées comme relief en jeu.':'Détails et roues : normales exportées en DDS BC5, y compris celles calculées depuis la hauteur.'}</p>
   {!normal&&!height&&!procedural&&<p>Ajoutez une image de normales ou de hauteur dans Textures.</p>}
   {definition.textures.ao&&<><SliderField label="Ombres AO" value={definition.aoStrength} min={0} max={1} step={.01} disabled={disabled} format={v=>`${Math.round(v*100)} %`} onChange={aoStrength=>onChange({...definition,aoStrength})} onCommit={onCommit}/><p>L’AO assombrit les creux ; elle ne crée ni bosses ni volume.</p></>}
  </div>
  {height&&<div className="material-height-levels"><strong>Lecture de la hauteur</strong><p>{definition.surfaceRelief?.heightOrigin==='normal-estimate'?'Hauteur estimée depuis les normales. Les profondeurs absolues ne sont pas connues.':family==='skin'?'Clair : bosses · sombre : creux. Les niveaux servent aux détails et au volume 3D.':'Clair : bosses · sombre : creux. Les niveaux servent à calculer les normales.'}</p>
   <SliderField label="Niveau neutre" value={settings.midpoint} min={0} max={1} step={.01} disabled={disabled} format={v=>`${Math.round(v*100)} %`} onChange={midpoint=>change({midpoint})} onCommit={onCommit}/>
   <SliderField label="Contraste de hauteur" value={settings.contrast} min={.1} max={4} step={.05} disabled={disabled} format={v=>`${v.toFixed(2)}×`} onChange={contrast=>change({contrast})} onCommit={onCommit}/>
   <p>{family==='skin'?'L’amplitude géométrique se règle en millimètres dans l’atelier.':'Ajustez le contraste et l’intensité des détails pour doser les normales générées.'}</p>
  </div>}
  {normal&&!height&&<div className="material-height-estimate"><p>Une hauteur peut être estimée depuis les normales pour préparer le volume, sans retrouver les profondeurs d’origine.{family!=='skin'?' Cette étape est facultative pour afficher les normales.':''}</p><button type="button" className="btn btn-sm btn-full" disabled={disabled} onClick={onEstimate}>Estimer une hauteur depuis les normales</button></div>}
  <div className="material-volume-route"><div><strong>Volume 3D · {family==='skin'?'Carrosserie':family==='details'?'Détails':'Roues'}</strong><span>Uniquement la famille sélectionnée</span></div><p>La hauteur déforme les surfaces de cette famille, y compris les pièces mobiles, en conservant leurs attaches. Les autres familles et leurs volumes sont conservés.</p><button type="button" className="btn btn-primary btn-full" disabled={disabled||!height&&!procedural||!onVolume} onClick={onVolume}><Icon name="box" size={14}/>Préparer le volume 3D</button>{!height&&!procedural&&<p>Importez une hauteur ou estimez-la depuis les normales pour préparer le volume.</p>}</div>
 </section>;
}
