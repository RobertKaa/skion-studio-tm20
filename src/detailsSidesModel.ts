import { embeddedGlbData } from './blenderParts';
import { INDEPENDENT_DETAILS, splitDetailsPixels, type DetailsLayout } from './detailsSides';
import { UNDERBODY_PANEL_LAYOUT, panelTexturePixels } from './underbodyPanel';
import type { Skin3DFile, Skin3DProject } from './skin3d';
import { decodeNormalVectors } from './wheelSurface';
import { decodeAmbientOcclusion } from './three/previewAmbientOcclusion';
import { encodeDDS } from './dds';

interface Asset { file:string; byteLength:number; sha256:string }
interface Patch { offset:number; length:number; sha256:string; dataOffset:number; dataLength:number; dataSha256:string }
interface Source { id:string; byteLength:number; resultByteLength:number; patches:Patch[] }
interface Manifest { version:1; layout:DetailsLayout; sources:Source[]; patchAsset:Asset; previewAsset:Asset }
interface Prepared { manifest:Manifest; bytes:Uint8Array; preview:Uint8Array }
const MAX_BYTES=64*1024*1024;
const fail=()=>{throw new Error('La séparation des côtés est indisponible pour ce modèle. Les modèles personnalisés doivent conserver leurs propres UV.');};
const integer=(v:number,max=MAX_BYTES)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const sha=(v:string)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);

export function validateDetailsSidesManifest(m:Manifest):void {
  if(!m||m.version!==1||![INDEPENDENT_DETAILS,UNDERBODY_PANEL_LAYOUT].includes(m.layout)||!Array.isArray(m.sources)||m.sources.length!==4)fail();
  for(const [a,file] of [[m.patchAsset,'patches.bin'],[m.previewAsset,'details.glb']] as const)if(!a||a.file!==file||!integer(a.byteLength)||!a.byteLength||!sha(a.sha256))fail();
  const lengths=new Set<number>();
  for(const s of m.sources){
    if(!s||!['standard','normal','dense-standard','dense-normal'].includes(s.id)||!integer(s.byteLength)||!s.byteLength||lengths.has(s.byteLength)||!integer(s.resultByteLength)||!s.resultByteLength||!Array.isArray(s.patches)||!s.patches.length||s.patches.length>32)fail();
    lengths.add(s.byteLength);let end=0,expected=s.byteLength;
    for(const p of s.patches){
      if(!p||!integer(p.offset)||!integer(p.length)||!p.length||p.offset<end||p.offset+p.length>s.byteLength||!integer(p.dataOffset)||!integer(p.dataLength)||!p.dataLength||p.dataOffset+p.dataLength>m.patchAsset.byteLength||!sha(p.sha256)||!sha(p.dataSha256))fail();
      end=p.offset+p.length;expected+=p.dataLength-p.length;
    }
    if(expected!==s.resultByteLength)fail();
  }
}

async function verify(bytes:Uint8Array,expected:string){
  const hash=await crypto.subtle.digest('SHA-256',bytes.slice().buffer);
  if([...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')!==expected)fail();
}

const prepared=new Map<DetailsLayout,Promise<Prepared>>();
async function loadPrepared(layout:DetailsLayout=UNDERBODY_PANEL_LAYOUT):Promise<Prepared>{
  const cached=prepared.get(layout);if(cached)return cached;
  const base=`${(import.meta.env?.BASE_URL??'/').replace(/\/$/,'')}/models/${layout===UNDERBODY_PANEL_LAYOUT?'underbody-panel':'details-sides'}/`;
  const pending=(async()=>{
    const response=await fetch(`${base}manifest.json`,{signal:AbortSignal.timeout(20_000)});
    if(!response.ok)fail();const text=await response.text();if(text.length>64*1024)fail();
    const manifest=JSON.parse(text) as Manifest;validateDetailsSidesManifest(manifest);if(manifest.layout!==layout)fail();
    const load=async(a:Asset)=>{
      const r=await fetch(`${base}${a.file}`,{signal:AbortSignal.timeout(20_000)});if(!r.ok||Number(r.headers.get('content-length'))>MAX_BYTES)fail();
      const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==a.byteLength||bytes.length>MAX_BYTES)fail();await verify(bytes,a.sha256);return bytes;
    };
    const [bytes,preview]=await Promise.all([load(manifest.patchAsset),load(manifest.previewAsset)]);
    return {manifest,bytes,preview};
  })();
  prepared.set(layout,pending);pending.catch(()=>{if(prepared.get(layout)===pending)prepared.delete(layout);});return pending;
}

/** Patch only audited Details node spans; volume changes to Body stay intact. */
export async function patchDetailsSidesMesh(mesh:Uint8Array,assets?:Prepared):Promise<Uint8Array>{
  const data=assets??await loadPrepared();validateDetailsSidesManifest(data.manifest);
  const source=data.manifest.sources.find(s=>s.byteLength===mesh.length);if(!source||mesh[0]!==71||mesh[1]!==66||mesh[2]!==88||mesh[7]!==85)return fail();
  for(const p of source.patches){await verify(mesh.subarray(p.offset,p.offset+p.length),p.sha256);await verify(data.bytes.subarray(p.dataOffset,p.dataOffset+p.dataLength),p.dataSha256);}
  const result=new Uint8Array(source.resultByteLength);let from=0,to=0;
  for(const p of source.patches){result.set(mesh.subarray(from,p.offset),to);to+=p.offset-from;result.set(data.bytes.subarray(p.dataOffset,p.dataOffset+p.dataLength),to);to+=p.dataLength;from=p.offset+p.length;}
  result.set(mesh.subarray(from),to);return result;
}

/** Append replacement attributes and keep every other primitive/node untouched. */
export function patchDetailsSidesPreview(source:ArrayBuffer,replacement:Uint8Array):ArrayBuffer{
  const original=embeddedGlbData(source),next=embeddedGlbData(replacement.slice().buffer),json=structuredClone(original.gltf);
  const chunks:Uint8Array[]=[new Uint8Array(source,original.binStart,original.binSize).slice()];let length=original.binSize,replaced=0;
  const accessorMap=new Map<number,number>();
  const copyAccessor=(index:number)=>{
    const existing=accessorMap.get(index);if(existing!==undefined)return existing;
    const a=next.gltf.accessors?.[index],b=next.gltf.bufferViews?.[a?.bufferView];
    if(!a||!b||a.sparse||b.buffer!==0||!integer(b.byteOffset??0)||!integer(b.byteLength)||!b.byteLength||(b.byteOffset??0)+b.byteLength>next.binSize||!integer(a.count,1_000_000))return fail();
    const padding=(4-length%4)%4;if(padding){chunks.push(new Uint8Array(padding));length+=padding;}
    const bytes=new Uint8Array(replacement.buffer,replacement.byteOffset+next.binStart+(b.byteOffset??0),b.byteLength).slice();
    const view=json.bufferViews.length;json.bufferViews.push({...b,byteOffset:length});chunks.push(bytes);length+=bytes.length;
    const out=json.accessors.length;json.accessors.push({...a,bufferView:view});accessorMap.set(index,out);return out;
  };
  for(const node of json.nodes??[]){
    if(node.mesh===undefined)continue;
    const mesh=json.meshes?.[node.mesh];if(!mesh?.primitives?.some((p:{material:number})=>String(json.materials?.[p.material]?.name??'').endsWith('_Details')))continue;
    const vi=node.extras?.nativeVisualIndex,other=next.gltf.nodes?.find((n:{extras?:{nativeVisualIndex?:number}})=>n.extras?.nativeVisualIndex===vi);
    if(!Number.isInteger(vi)||!other)return fail();
    const primitives=next.gltf.meshes?.[other.mesh]?.primitives;if(!Array.isArray(primitives)||primitives.length!==mesh.primitives.length)fail();
    mesh.primitives=primitives.map((p:{attributes:Record<string,number>;indices:number},i:number)=>({
      ...mesh.primitives[i],attributes:Object.fromEntries(Object.entries(p.attributes).map(([key,value])=>[key,copyAccessor(value)])),indices:copyAccessor(p.indices),
    }));replaced++;
  }
  if(!replaced||replaced!==next.gltf.meshes.length||length>MAX_BYTES)fail();
  json.buffers=[{byteLength:length}];
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonLength=Math.ceil(encoded.length/4)*4;
  if(jsonLength>8*1024*1024||28+jsonLength+length>MAX_BYTES)fail();
  const result=new Uint8Array(28+jsonLength+length),view=new DataView(result.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,result.length,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);
  result.fill(32,20,20+jsonLength);result.set(encoded,20);view.setUint32(20+jsonLength,length,true);view.setUint32(24+jsonLength,0x004e4942,true);
  let at=28+jsonLength;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result.buffer;
}

const nativeUrls:Record<string,URL>={
  'Details_N.dds':new URL('./assets/model/car/Details_N.dds',import.meta.url),
  'Details_AO.dds':new URL('./assets/model/car/Details_AO.dds',import.meta.url),
};
/** Imported overrides win; only missing native maps are supplied for a stock car. */
export async function splitDetailsSurfaceFiles(files:readonly Skin3DFile[],native=false,layout:DetailsLayout=UNDERBODY_PANEL_LAYOUT):Promise<Skin3DFile[]>{
  const result=new Map(files.map(f=>[f.name.toLowerCase(),f]));
  for(const name of ['Details_N.dds','Details_AO.dds']){
    let bytes=result.get(name.toLowerCase())?.data;
    if(!bytes&&native){const r=await fetch(nativeUrls[name],{signal:AbortSignal.timeout(15_000)});if(!r.ok)fail();bytes=new Uint8Array(await r.arrayBuffer());}
    if(!bytes)continue;
    const normal=name==='Details_N.dds',image=normal?decodeNormalVectors(bytes.slice().buffer):decodeAmbientOcclusion(bytes.slice().buffer);if(!image)fail();
    result.set(name.toLowerCase(),{name,data:new Uint8Array(encodeDDS(layout===UNDERBODY_PANEL_LAYOUT?panelTexturePixels(image!,normal):splitDetailsPixels(image!,normal),normal?'BC5':'BC4',{colorSpace:'linear'}))});
  }
  return [...result.values()];
}

export async function splitDetailsSidesModel(project:Skin3DProject,layout:DetailsLayout=UNDERBODY_PANEL_LAYOUT):Promise<Skin3DProject>{
  if(project.detailsLayout===layout)return project;
  if(project.detailsLayout)return fail();
  if(!project.preview)return fail();
  // Full-family relief needs UV duplication that copies its current deformation.
  if(project.mesh.length>11*1024*1024){const {splitSurfaceLayout}=await import('./surfaceLayouts');return splitSurfaceLayout(project,layout);}
  const assets=await loadPrepared(layout),mesh=await patchDetailsSidesMesh(project.mesh,assets),preview=patchDetailsSidesPreview(project.preview,assets.preview);
  return {...project,mesh,preview,detailsLayout:layout};
}

/** Restore source UVs before a new relief operation, without losing Body volume. */
export async function restoreDetailsSidesModel(project:Skin3DProject,variant:'standard'|'normal'):Promise<Skin3DProject>{
  if(!project.detailsLayout)return project;
  if(project.mesh.length>11*1024*1024){const {restoreSurfaceLayout}=await import('./surfaceLayouts');return restoreSurfaceLayout(project,variant);}
  const assets=await loadPrepared(project.detailsLayout),source=assets.manifest.sources.find(s=>s.resultByteLength===project.mesh.length&&s.id.endsWith(variant));
  if(!source)return fail();
  const {loadPreparedReliefTemplate}=await import('./relief/template'),template=await loadPreparedReliefTemplate(source.id.startsWith('dense-'));
  const original=template.variants[variant],mesh=new Uint8Array(source.byteLength);let from=0,to=0;
  for(const p of source.patches){
    const size=p.offset-to;mesh.set(project.mesh.subarray(from,from+size),to);from+=size;to+=size;
    await verify(project.mesh.subarray(from,from+p.dataLength),p.dataSha256);
    mesh.set(original.subarray(p.offset,p.offset+p.length),to);to+=p.length;from+=p.dataLength;
  }
  mesh.set(project.mesh.subarray(from),to);
  const replay=await patchDetailsSidesMesh(mesh,assets);if(replay.length!==project.mesh.length||replay.some((v,i)=>v!==project.mesh[i]))return fail();
  const {detailsLayout,...rest}=project;void detailsLayout;return{...rest,mesh};
}
