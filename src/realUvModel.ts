import { embeddedGlbData } from './blenderParts';
import type { Skin3DProject } from './skin3d';
import { REAL_UV_ATLAS, validAtlasSource, type AtlasSourceLayout } from './realUvAtlas';
import { loadPreparedReliefTemplate } from './relief/template';
import { splitDetailsSidesModel } from './detailsSidesModel';
interface AssetRange { offset:number; length:number; sha256:string }
interface CopyRange { source:number; target:number; stride:number; name:string }
interface VisualRecipe { visualIndex:number; family:'skin'|'details'|'wheels'; oldCount:number; newCount:number;
  offset:number; length:number; resultLength:number; structureSha256:string; mapping:AssetRange; indices:AssetRange; uv:AssetRange;
  copies:CopyRange[]; fragments:{offset:number;asset:AssetRange}[];
  staticPreview?:Record<string,{asset:AssetRange;componentType:5126;type:'VEC2'|'VEC3'}> }
interface SourceRecipe { id:string; layout:AtlasSourceLayout; byteLength:number; resultByteLength:number; visuals:VisualRecipe[] }
export interface UvModelRecipes { version:1; sources:SourceRecipe[]; asset:{file:string;byteLength:number;sha256:string} }
export interface PreparedUvRecipes { manifest:UvModelRecipes; bytes:Uint8Array }
const MAX=64*1024*1024,integer=(v:number,max=MAX)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const fail=():never=>{throw new Error('Ce modèle ne correspond pas aux maillages Stadium compatibles avec la réorganisation UV. Le projet initial est conservé.');};
async function verify(bytes:Uint8Array,sha:string){const hash=await crypto.subtle.digest('SHA-256',bytes.slice().buffer);if([...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')!==sha)fail();}
export function validateUvModelRecipes(m:UvModelRecipes){
  if(!m||m.version!==1||!m.asset||m.asset.file!=='recipes.bin'||!integer(m.asset.byteLength)||!m.asset.byteLength||!/^[a-f0-9]{64}$/.test(m.asset.sha256)||!Array.isArray(m.sources)||![4,12,18].includes(m.sources.length))fail();
  const asset=(a:AssetRange)=>!!a&&integer(a.offset)&&integer(a.length)&&a.length>0&&a.offset+a.length<=m.asset.byteLength&&/^[a-f0-9]{64}$/.test(a.sha256);
  for(const s of m.sources){
    if(!validAtlasSource(s.layout)||!integer(s.byteLength)||!s.byteLength||!integer(s.resultByteLength)||!Array.isArray(s.visuals)||!s.visuals.length||s.visuals.length>64)fail();
    let end=0,expected=s.byteLength;const ids=new Set<number>();
    for(const v of s.visuals){
      if(!integer(v.visualIndex,1000)||ids.has(v.visualIndex)||!['skin','details','wheels'].includes(v.family)||!integer(v.oldCount,65535)||!v.oldCount||!integer(v.newCount,65535)||v.newCount<v.oldCount||!integer(v.offset)||v.offset<end||!integer(v.length)||!v.length||v.offset+v.length>s.byteLength||!integer(v.resultLength)||!v.resultLength||!/^[a-f0-9]{64}$/.test(v.structureSha256)||!asset(v.mapping)||v.mapping.length!==v.newCount*2||!asset(v.uv)||v.uv.length!==v.newCount*8||!asset(v.indices)||v.indices.length%12||!Array.isArray(v.copies)||v.copies.length>12||!Array.isArray(v.fragments)||v.fragments.length>16)fail();
      ids.add(v.visualIndex);end=v.offset+v.length;expected+=v.resultLength-v.length;
      if(v.staticPreview){
        if(!v.staticPreview.POSITION||!v.staticPreview.NORMAL||!v.staticPreview.TEXCOORD_0||Object.keys(v.staticPreview).length>4)fail();
        for(const [name,a]of Object.entries(v.staticPreview))if(!['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1'].includes(name)||a.componentType!==5126||a.type!==(name.startsWith('TEXCOORD')?'VEC2':'VEC3')||!asset(a.asset)||a.asset.length!==v.newCount*(a.type==='VEC2'?8:12))fail();
      }
      const targetRanges:[number,number][]=[];
      for(const c of v.copies){if(!['Position','Normal','BlendIndices','TexCoord1','TangentU'].includes(c.name)||!integer(c.source)||!integer(c.target)||![4,8,12,16].includes(c.stride)||c.source+c.stride*v.oldCount>v.length||c.target+c.stride*v.newCount>v.resultLength)fail();targetRanges.push([c.target,c.target+c.stride*v.newCount]);}
      for(const f of v.fragments){if(!integer(f.offset)||!asset(f.asset)||f.offset+f.asset.length>v.resultLength)fail();targetRanges.push([f.offset,f.offset+f.asset.length]);}
      targetRanges.sort((a,b)=>a[0]-b[0]);let at=0;for(const [a,b]of targetRanges){if(a!==at)fail();at=b;}if(at!==v.resultLength)fail();
    }if(expected!==s.resultByteLength)fail();
  }
}
let loading:Promise<PreparedUvRecipes>|undefined;
export function loadUvModelRecipes():Promise<PreparedUvRecipes>{
  if(loading)return loading;
  loading=(async()=>{const base=`${(import.meta.env?.BASE_URL??'/').replace(/\/$/,'')}/models/uv-atlas/`;
    const r=await fetch(`${base}manifest.json`,{signal:AbortSignal.timeout(30000)});if(!r.ok)fail();const text=await r.text();if(text.length>4*1024*1024)fail();const manifest=JSON.parse(text) as UvModelRecipes;validateUvModelRecipes(manifest);
    const b=await fetch(`${base}recipes.bin`,{signal:AbortSignal.timeout(30000)});if(!b.ok||Number(b.headers.get('content-length'))>MAX)fail();const bytes=new Uint8Array(await b.arrayBuffer());if(bytes.length!==manifest.asset.byteLength)fail();await verify(bytes,manifest.asset.sha256);return{manifest,bytes};
  })();loading.catch(()=>{loading=undefined;});return loading;
}
const data=(a:AssetRange,p:PreparedUvRecipes)=>p.bytes.subarray(a.offset,a.offset+a.length);
export async function patchNativeUvMesh(mesh:Uint8Array,layout:AtlasSourceLayout,prepared:PreparedUvRecipes):Promise<{mesh:Uint8Array;recipe:SourceRecipe}>{
  validateUvModelRecipes(prepared.manifest);if(prepared.bytes.length!==prepared.manifest.asset.byteLength)fail();await verify(prepared.bytes,prepared.manifest.asset.sha256);
  const recipe=prepared.manifest.sources.find(s=>s.layout===layout&&s.byteLength===mesh.length);if(!recipe||mesh[0]!==71||mesh[1]!==66||mesh[2]!==88||mesh[7]!==85)return fail();
  for(const v of recipe.visuals){const source=mesh.subarray(v.offset,v.offset+v.length),structure=source.slice();
    for(const c of v.copies)if(['Position','Normal','TangentU'].includes(c.name))structure.fill(0,c.source,c.source+c.stride*v.oldCount);
    await verify(structure,v.structureSha256);
    const mapping=new DataView(prepared.bytes.buffer,prepared.bytes.byteOffset+v.mapping.offset,v.mapping.length);for(let i=0;i<v.newCount;i++)if(mapping.getUint16(i*2,true)>=v.oldCount)fail();
  }
  const output=new Uint8Array(recipe.resultByteLength);let from=0,to=0;
  for(const v of recipe.visuals){output.set(mesh.subarray(from,v.offset),to);to+=v.offset-from;const target=output.subarray(to,to+v.resultLength),original=mesh.subarray(v.offset,v.offset+v.length);
    for(const f of v.fragments)target.set(data(f.asset,prepared),f.offset);
    const mapping=new DataView(prepared.bytes.buffer,prepared.bytes.byteOffset+v.mapping.offset,v.mapping.length);
    for(const c of v.copies)for(let i=0;i<v.newCount;i++){const old=mapping.getUint16(i*2,true);target.set(original.subarray(c.source+old*c.stride,c.source+(old+1)*c.stride),c.target+i*c.stride);}
    from=v.offset+v.length;to+=v.resultLength;
  }output.set(mesh.subarray(from),to);return{mesh:output,recipe};
}
export function patchNativeUvPreview(source:ArrayBuffer,recipe:SourceRecipe,prepared:PreparedUvRecipes,rememberSourceUv=true):ArrayBuffer {
  validateUvModelRecipes(prepared.manifest);
  const {gltf,binStart,binSize}=embeddedGlbData(source),json=structuredClone(gltf),chunks:Uint8Array[]=[new Uint8Array(source,binStart,binSize)];let length=binSize,replaced=0;
  const append=(bytes:Uint8Array,accessor:Record<string,unknown>)=>{
    const pad=(4-length%4)%4;if(pad){chunks.push(new Uint8Array(pad));length+=pad;}
    if(bytes.length>MAX-length)fail();
    const bufferView=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});chunks.push(bytes);length+=bytes.length;
    const id=json.accessors.length;json.accessors.push({...accessor,bufferView,byteOffset:0});return id;
  };
  const used=new Set<number>();
  for(const node of json.nodes??[]){const v=recipe.visuals.find(r=>r.visualIndex===node.extras?.nativeVisualIndex);if(!v||node.mesh===undefined||used.has(node.mesh))continue;used.add(node.mesh);
    const mesh=json.meshes[node.mesh];if(mesh?.primitives?.length!==1)fail();
    if(v.staticPreview){
      const primitive=mesh.primitives[0];
      primitive.attributes=Object.fromEntries(Object.entries(v.staticPreview).map(([name,a])=>[name,append(data(a.asset,prepared),{componentType:a.componentType,type:a.type,count:v.newCount})]));
      primitive.indices=append(data(v.indices,prepared),{componentType:5125,count:v.indices.length/4,type:'SCALAR'});replaced++;continue;
    }
    const restored=mesh.primitives[0];
    // A return to native UVs retains the chart seams and the alternate UV set.
    // Switching back can therefore reuse the same geometry and binary buffer.
    if(restored.attributes?._ATLAS_UV!==undefined){
      if(json.accessors[restored.attributes._ATLAS_UV]?.count!==v.newCount)fail();
      restored.attributes._SOURCE_UV=restored.attributes.TEXCOORD_0;
      restored.attributes.TEXCOORD_0=restored.attributes._ATLAS_UV;delete restored.attributes._ATLAS_UV;replaced++;continue;
    }
    const mapping=new DataView(prepared.bytes.buffer,prepared.bytes.byteOffset+v.mapping.offset,v.mapping.length);
    for(const primitive of mesh.primitives){const attributes:Record<string,number>={};let originalUv:number|undefined;
      if(!primitive.attributes||Object.keys(primitive.attributes).length>16)fail();
      for(const [name,id]of Object.entries(primitive.attributes) as [string,number][]){
        const a=gltf.accessors[id],b=gltf.bufferViews[a?.bufferView],size=({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4} as Record<number,number>)[a?.componentType],components=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16} as Record<string,number>)[a?.type];
        if(!a||!b||a.sparse||a.count!==v.oldCount||!size||!components||b.buffer!==0)fail();
        const step=size*components,stride=b.byteStride??step,offset=(b.byteOffset??0)+(a.byteOffset??0);if(!integer(offset)||stride<step||offset+(v.oldCount-1)*stride+step>binSize)fail();
        const bytes=new Uint8Array(v.newCount*step);for(let i=0;i<v.newCount;i++){const old=mapping.getUint16(i*2,true);bytes.set(new Uint8Array(source,binStart+offset+old*stride,step),i*step);}
        const accessor={...a,count:v.newCount};delete accessor.bufferView;delete accessor.byteOffset;
        const copied=append(bytes,accessor);if(name==='TEXCOORD_0')originalUv=copied;else attributes[name]=copied;
      }
      if(originalUv===undefined)return fail();if(rememberSourceUv)attributes._SOURCE_UV=originalUv;
      attributes.TEXCOORD_0=append(data(v.uv,prepared),{componentType:5126,count:v.newCount,type:'VEC2'});
      primitive.attributes=attributes;primitive.indices=append(data(v.indices,prepared),{componentType:5125,count:v.indices.length/4,type:'SCALAR'});
    }replaced++;
  }
  if(!replaced||length>MAX)fail();json.buffers=[{byteLength:length}];
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonLength=Math.ceil(encoded.length/4)*4;if(jsonLength>8*1024*1024||28+jsonLength+length>MAX)fail();
  const result=new Uint8Array(28+jsonLength+length),view=new DataView(result.buffer);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,result.length,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);result.fill(32,20,20+jsonLength);result.set(encoded,20);view.setUint32(20+jsonLength,length,true);view.setUint32(24+jsonLength,0x004e4942,true);let at=28+jsonLength;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result.buffer;
}
export async function reorganizeNativeModel(project:Skin3DProject,prepared?:PreparedUvRecipes):Promise<Skin3DProject>{
  if(project.uvAtlas===REAL_UV_ATLAS)return project;const preview=project.preview;if(!preview)return fail();
  const assets=prepared??await loadUvModelRecipes(),patched=await patchNativeUvMesh(project.mesh,project.detailsLayout??'stock',assets);
  return {...project,mesh:patched.mesh,preview:patchNativeUvPreview(preview,patched.recipe,assets),uvAtlas:REAL_UV_ATLAS};
}

/** Restore the native topology while retaining the latest vertex deformation.
 * Replaying the authenticated forward recipe checks every byte of the input,
 * including duplicated vertices, UVs, indices, weights and the surrounding GBX. */
export async function restoreNativeUvMesh(mesh:Uint8Array,original:Uint8Array,layout:AtlasSourceLayout,prepared:PreparedUvRecipes):Promise<Uint8Array>{
  validateUvModelRecipes(prepared.manifest);
  const recipe=prepared.manifest.sources.find(s=>s.layout===layout&&s.byteLength===original.length&&s.resultByteLength===mesh.length);if(!recipe)return fail();
  const result=original.slice();let shift=0;
  for(const v of recipe.visuals){
    const mapping=new DataView(prepared.bytes.buffer,prepared.bytes.byteOffset+v.mapping.offset,v.mapping.length);
    if(!v.staticPreview)for(let i=0;i<v.oldCount;i++)if(mapping.getUint16(i*2,true)!==i)fail();
    for(const c of v.copies)result.set(mesh.subarray(v.offset+shift+c.target,v.offset+shift+c.target+c.stride*v.oldCount),v.offset+c.source);
    shift+=v.resultLength-v.length;
  }
  const replay=await patchNativeUvMesh(result,layout,prepared);
  if(replay.mesh.length!==mesh.length||replay.mesh.some((value,i)=>value!==mesh[i]))fail();
  return result;
}

export function restoreNativeUvPreview(source:ArrayBuffer,recipe:SourceRecipe):ArrayBuffer {
  const {gltf,binStart,binSize}=embeddedGlbData(source),json=structuredClone(gltf);let replaced=0;
  const used=new Set<number>();
  for(const node of json.nodes??[]){const v=recipe.visuals.find(r=>r.visualIndex===node.extras?.nativeVisualIndex);if(!v||node.mesh===undefined||used.has(node.mesh))continue;used.add(node.mesh);
    const mesh=json.meshes[node.mesh];if(mesh?.primitives?.length!==1)fail();const p=mesh.primitives[0],a=p.attributes;
    if(a?._SOURCE_UV===undefined||json.accessors[a._SOURCE_UV]?.count!==v.newCount||json.accessors[a.TEXCOORD_0]?.count!==v.newCount)fail();
    a._ATLAS_UV=a.TEXCOORD_0;a.TEXCOORD_0=a._SOURCE_UV;delete a._SOURCE_UV;replaced++;
  }
  if(!replaced)fail();
  const encoded=new TextEncoder().encode(JSON.stringify(json)),jsonLength=Math.ceil(encoded.length/4)*4;
  if(jsonLength>8*1024*1024||28+jsonLength+binSize>MAX)fail();
  const output=new Uint8Array(28+jsonLength+binSize),view=new DataView(output.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,output.length,true);view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);output.fill(32,20,20+jsonLength);output.set(encoded,20);view.setUint32(20+jsonLength,binSize,true);view.setUint32(24+jsonLength,0x004e4942,true);output.set(new Uint8Array(source,binStart,binSize),28+jsonLength);return output.buffer;
}

export async function restoreNativeModel(project:Skin3DProject):Promise<Skin3DProject>{
  if(!project.uvAtlas)return project;if(!project.preview)return fail();
  const prepared=await loadUvModelRecipes(),layout=project.detailsLayout??'stock';
  const recipe=prepared.manifest.sources.find(s=>s.layout===layout&&s.resultByteLength===project.mesh.length);if(!recipe)return fail();
  const template=await loadPreparedReliefTemplate(recipe.id.includes('-full-')?'full':recipe.id.includes('-True-'));
  let original:Skin3DProject={name:project.name,mesh:template.variants[recipe.id.endsWith('-normal')?'normal':'standard'],preview:template.preview.slice().buffer,passthrough:[]};
  if(project.detailsLayout)original=await splitDetailsSidesModel(original,project.detailsLayout);
  const {uvAtlas,...rest}=project;void uvAtlas;
  return {...rest,mesh:await restoreNativeUvMesh(project.mesh,original.mesh,layout,prepared),preview:restoreNativeUvPreview(project.preview,recipe)};
}
