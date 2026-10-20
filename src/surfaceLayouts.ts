import { loadPreparedReliefTemplate } from './relief/template';
import { patchNativeUvMesh, patchNativeUvPreview, restoreNativeUvMesh, validateUvModelRecipes, type PreparedUvRecipes } from './realUvModel';
import type { Skin3DProject } from './skin3d';
import type { DetailsLayout } from './detailsSides';
import type { PreparedReliefTemplate } from './relief/types';

let loading:Promise<PreparedUvRecipes>|undefined;
async function verify(data:PreparedUvRecipes){
 const hash=await crypto.subtle.digest('SHA-256',data.bytes.slice().buffer);
 if([...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')!==data.manifest.asset.sha256)throw new Error('Recettes UV modifiées ou incomplètes.');
}
async function recipes():Promise<PreparedUvRecipes>{
 if(loading)return loading;
 loading=(async()=>{
  const base=`${(import.meta.env?.BASE_URL??'/').replace(/\/$/,'')}/models/surface-layouts/`;
  const response=await fetch(base+'manifest.json',{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Recettes UV de relief indisponibles.');
  const text=await response.text();if(text.length>512*1024)throw new Error('Recettes UV trop volumineuses.');
  const manifest=JSON.parse(text);validateUvModelRecipes(manifest);
  const asset=await fetch(base+'recipes.bin',{signal:AbortSignal.timeout(30000)});
  if(!asset.ok||Number(asset.headers.get('content-length'))>64*1024*1024)throw new Error('Recettes UV indisponibles.');
  const bytes=new Uint8Array(await asset.arrayBuffer());if(bytes.length!==manifest.asset.byteLength)throw new Error('Recettes UV incomplètes.');
  const result={manifest,bytes};await verify(result);return result;
 })();loading.catch(()=>{loading=undefined;});return loading;
}
export async function splitSurfaceLayout(project:Skin3DProject,layout:DetailsLayout):Promise<Skin3DProject>{
 if(!project.preview)throw new Error('Aperçu du modèle manquant.');
 const prepared=await recipes(),{mesh,recipe}=await patchNativeUvMesh(project.mesh,layout,prepared);
 return{...project,mesh,preview:patchNativeUvPreview(project.preview,recipe,prepared,false),detailsLayout:layout};
}
export async function surfaceReliefUv(template:PreparedReliefTemplate,layout:DetailsLayout,prepared?:PreparedUvRecipes):Promise<ReadonlyMap<number,readonly number[]>>{
 const assets=prepared??await recipes();validateUvModelRecipes(assets.manifest);if(prepared)await verify(assets);
 const recipe=assets.manifest.sources.find(s=>s.layout===layout&&s.byteLength===template.variants.standard.length);
 if(!recipe)throw new Error('Coordonnées de relief indisponibles pour ce modèle.');
 const result=new Map<number,readonly number[]>();
 for(const geometry of template.manifest.geometries.filter(g=>g.family==='details')){
  const v=recipe.visuals.find(v=>v.visualIndex===geometry.visualIndex);
  if(!v||v.staticPreview||v.oldCount*2!==geometry.uv.length)throw new Error('Surface de relief incompatible avec ses UV.');
  const view=new DataView(assets.bytes.buffer,assets.bytes.byteOffset+v.uv.offset,v.uv.length);
  result.set(geometry.visualIndex,Array.from({length:geometry.uv.length},(_,i)=>view.getFloat32(i*4,true)));
 }
 return result;
}
/** Return bundled native UVs before sampling a new family, retaining each volume. */
export async function restoreSurfaceLayout(project:Skin3DProject,variant:'standard'|'normal'):Promise<Skin3DProject>{
 if(!project.detailsLayout)return project;
 const prepared=await recipes(),template=await loadPreparedReliefTemplate('full');
 const recipe=prepared.manifest.sources.find(s=>s.layout===project.detailsLayout&&s.byteLength===template.variants[variant].length&&s.resultByteLength===project.mesh.length);
 if(!recipe)throw new Error('Modèle de relief incompatible avec ses UV.');
 const original=template.variants[variant].slice();
 // These streams sit outside the Details reconstruction spans. Carry only
 // audited mutable data; the authenticated replay still checks the native rig.
 for(const g of template.manifest.geometries.filter(g=>g.family!=='details')){
  const offsets=g.offsets[variant],count=g.bodyVertices.length;
  for(const [offset,length]of [[offsets.positionOffset,count*12],[offsets.normalOffset,count*(g.normalEncoding==='dec3n'?4:12)],...(offsets.tangentOffset!==undefined?[[offsets.tangentOffset,count*4]]:[])]){
   const shift=recipe.visuals.filter(v=>v.offset+v.length<=offset).reduce((n,v)=>n+v.resultLength-v.length,0),from=offset+shift;
   if(from<0||from+length>project.mesh.length)throw new Error('Flux de volume précédent invalide.');
   original.set(project.mesh.subarray(from,from+length),offset);
  }
 }
 const mesh=await restoreNativeUvMesh(project.mesh,original,project.detailsLayout,prepared);
 const {detailsLayout,...rest}=project;void detailsLayout;return{...rest,mesh};
}
