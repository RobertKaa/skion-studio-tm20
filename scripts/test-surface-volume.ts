import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { decodeReliefManifest, verifyPreparedReliefTemplate, validateReliefManifest } from '../src/relief/template';
import { buildReliefPrototype, reliefVertexKey } from '../src/relief/engine';
import { retainOtherLayerVolumes } from '../src/relief/layerVolume';
import type { ReliefFamily } from '../src/relief/types';
import { patchNativeUvMesh, patchNativeUvPreview, restoreNativeUvMesh, validateUvModelRecipes, reorganizeNativeModel, restoreNativeModel } from '../src/realUvModel';
import { surfaceReliefUv } from '../src/surfaceLayouts';
import { splitDetailsSidesModel, restoreDetailsSidesModel } from '../src/detailsSidesModel';
import { validReliefSettings } from '../src/relief/settings';

const root='public/models/relief/';
const manifest=decodeReliefManifest(JSON.parse(await readFile(root+'full/manifest.json','utf8')));
assert.throws(()=>decodeReliefManifest({encoding:'unknown',geometries:[]}));
assert.throws(()=>decodeReliefManifest({encoding:'numeric-base64-v1',geometries:[{bodyVertices:'Ag=='}]}),'Nonboolean decoded masks are rejected');
assert.throws(()=>decodeReliefManifest({encoding:'numeric-base64-v1',geometries:[{positions:'!bad',bodyVertices:''}]}));
validateReliefManifest(manifest);
const bytes=async(path:string)=>new Uint8Array(await readFile(root+path));
const template={manifest,preview:await bytes(manifest.preview.url),variants:{standard:await bytes(manifest.variants.standard.url),normal:await bytes(manifest.variants.normal.url)},dependencies:await Promise.all(manifest.dependencies.map(async d=>({name:d.name,data:await bytes(d.url)})))};
await verifyPreparedReliefTemplate(template);
assert.deepEqual([...new Set(manifest.geometries.map(g=>g.family))].sort(),['details','skin','wheels']);
const full={width:4,height:4,data:new Uint8ClampedArray(64).fill(255)};
const baseline=new DataView(template.variants.standard.buffer);
const families=['skin','details','wheels'] as const;
const results=new Map<ReliefFamily,Awaited<ReturnType<typeof buildReliefPrototype>>>();
await mkdir('work/full-surface-volume',{recursive:true});
for(const family of families){
  const result=await buildReliefPrototype({template,family,mode:'geometry',scope:'vehicle',heightAtlas:full,strengthMm:6});
  results.set(family,result);
  const view=new DataView(result.project.mesh.buffer);let changed=0,untouched=0;
  for(const g of manifest.geometries){let perLod=0;const at=g.offsets.standard.positionOffset;
    if(g.family!==family){
      for(const [offset,size]of [[g.offsets.standard.normalOffset,g.bodyVertices.length*4],...(g.offsets.standard.tangentOffset!==undefined?[[g.offsets.standard.tangentOffset,g.bodyVertices.length*4]]:[])])assert.deepEqual(result.project.mesh.subarray(offset,offset+size),template.variants.standard.subarray(offset,offset+size),'Unrelated normals and tangents stay byte-identical');
    }
    for(let i=0;i<g.bodyVertices.length;i++)for(let axis=0;axis<3;axis++){
      const offset=at+i*12+axis*4,value=view.getFloat32(offset,true),old=baseline.getFloat32(offset,true);
      if(g.family!==family){assert.equal(value,old,'An unrelated paint family stays byte-identical');untouched++;}
      else if(value!==old){changed++;perLod++;}
    }
    if(g.family===family)assert(perLod>0,'Each geometry and LOD of the selected family gets real volume');
  }
  assert(changed>100&&untouched>100);assert(result.stats.maxDisplacementMm<6.001);
  const saved={version:1,source:'demo',material:null,sourceName:'Test',family,mode:'geometry',scope:'vehicle',textureResolution:2048,strengthMm:6,diagnostic:false,stats:result.stats,strengthByFamily:{skin:21.25,details:3,wheels:2},modeByFamily:{skin:'geometry',details:'combined',wheels:'normal'}};
  assert(validReliefSettings(JSON.parse(JSON.stringify(saved))),'Each family and independent amplitude/mode settings survive serialization');
  assert(!validReliefSettings({...saved,strengthByFamily:{skin:Infinity}}));assert(!validReliefSettings({...saved,modeByFamily:{details:'invalid'}}));
  if(family!=='skin'){
    const normal=await buildReliefPrototype({template,family,mode:'normal',scope:'vehicle',normalAtlas:full,strengthMm:0});
    assert.equal(normal.stats.templateVariant,'standard','Details/Wheels normals retain the original body shader');
    assert(normal.project.mesh.every((v,i)=>v===template.variants.standard[i]));
    assert.deepEqual(normal.project.passthrough.filter(f=>/_N\.dds$/i.test(f.name)).map(f=>f.name),[family==='details'?'Details_N.dds':'Wheels_N.dds']);
  }
  if(family==='skin'){
    const g=manifest.geometries.find(g=>g.visualIndex===2)!;
    for(const ids of [[9195,9238,9235],[9900,9877,9902],[9664,9661,9663]])for(const i of ids){
      assert(g.bodyVertices[i]);assert([18,25,26].includes(g.bindings![i]));
      assert([0,1,2].some(axis=>view.getFloat32(g.offsets.standard.positionOffset+i*12+axis*4,true)!==g.positions[i*3+axis]),'Every user-marked moving panel is included');
    }
  }
  await writeFile(`work/full-surface-volume/${family}.Mesh.gbx`,result.project.mesh);
  console.log(`✓ ${family}: isolated geometry, all LODs and native rig groups`);
}
const skin=results.get('skin')!,details=results.get('details')!,wheels=results.get('wheels')!;
const second=retainOtherLayerVolumes(template,details,{mesh:skin.project.mesh,variant:'standard'},full);
const third=retainOtherLayerVolumes(template,wheels,{mesh:second.project.mesh,variant:'standard'},full);
const merged=new DataView(third.project.mesh.buffer);
for(const g of manifest.geometries){const expected=new DataView(results.get(g.family!)!.project.mesh.buffer),at=g.offsets.standard.positionOffset;
  for(let i=0;i<g.positions.length;i++)assert.equal(merged.getFloat32(at+i*4,true),expected.getFloat32(at+i*4,true),'Applying another family preserves earlier volumes exactly');
  for(const offset of [g.offsets.standard.normalOffset,g.offsets.standard.tangentOffset].filter((v):v is number=>v!==undefined))assert(third.project.mesh.subarray(offset,offset+g.bodyVertices.length*4).every((v,i)=>v===new Uint8Array(expected.buffer)[offset+i]),'Earlier normals and tangents survive another family byte for byte');
}
const oldManifest=JSON.parse(await readFile(root+'dense/manifest.json','utf8'));
const oldTemplate={manifest:oldManifest,preview:await bytes(oldManifest.preview.url),variants:{standard:await bytes(oldManifest.variants.standard.url),normal:await bytes(oldManifest.variants.normal.url)},dependencies:await Promise.all(oldManifest.dependencies.map(async(d:{name:string;url:string})=>({name:d.name,data:await bytes(d.url)})))};
const legacy=(await buildReliefPrototype({template:oldTemplate,mode:'geometry',scope:'vehicle',heightAtlas:full,strengthMm:4})).project.mesh;
const migrated=retainOtherLayerVolumes(template,details,{mesh:legacy,variant:'standard'},full);
assert(migrated.project.preview);await writeFile('work/full-surface-volume/migrated.Mesh.gbx',migrated.project.mesh);
for(const g of manifest.geometries.filter(g=>g.family==='skin')){
  const old=new DataView(legacy.buffer,legacy.byteOffset,legacy.byteLength),now=new DataView(migrated.project.mesh.buffer);
  for(let i=0;i<g.legacyVertexCount!;i++)for(let axis=0;axis<3;axis++)assert.equal(now.getFloat32(g.offsets.standard.positionOffset+i*12+axis*4,true),old.getFloat32(g.legacyOffsets!.standard.positionOffset+i*12+axis*4,true),'Old body volumes survive the denser articulated template');
}
await writeFile('work/full-surface-volume/combined.Mesh.gbx',third.project.mesh);
console.log('✓ Successive families and migration preserve unrelated volumes; original vertex prefixes and rig remain reusable');

const layoutRoot='public/models/surface-layouts/';
const layouts={manifest:JSON.parse(await readFile(layoutRoot+'manifest.json','utf8')),bytes:new Uint8Array(await readFile(layoutRoot+'recipes.bin'))};
validateUvModelRecipes(layouts.manifest);
for(const layout of ['underbody-panel-v1','independent-v1'] as const){
  const patched=await patchNativeUvMesh(third.project.mesh,layout,layouts);
  const restored=await restoreNativeUvMesh(patched.mesh,third.project.mesh,layout,layouts);
  assert.equal(restored.length,third.project.mesh.length);assert(restored.every((v,i)=>v===third.project.mesh[i]),'UV separation preserves every earlier volume byte');
  const preview=patchNativeUvPreview(third.project.preview!,patched.recipe,layouts,false);
  assert(preview.byteLength>third.project.preview!.byteLength);
  for(const v of patched.recipe.visuals.filter(v=>v.staticPreview))assert.equal(v.copies.length,0,'Nonvolume decals remain authenticated static geometry');
  console.log(`✓ ${layout}: deformed Details, other families and preview survive UV separation and authenticated restoration`);
}
const mappedUv=await surfaceReliefUv(template,'independent-v1',layouts),maxU=new Map<string,number>();
for(const g of manifest.geometries.filter(g=>g.family==='details')){const uv=mappedUv.get(g.visualIndex)!;for(let i=0;i<g.bodyVertices.length;i++)maxU.set(reliefVertexKey(g,i),Math.max(maxU.get(reliefVertexKey(g,i))??-Infinity,uv[i*2]));}
const half=await buildReliefPrototype({template,family:'details',scope:'vehicle',mode:'geometry',heightAtlas:full,strengthMm:4,vertexUv:mappedUv,heightSample:u=>u>=.5?1:0});
const halfView=new DataView(half.project.mesh.buffer);let protectedLeft=0,movedRight=0;
for(const g of manifest.geometries.filter(g=>g.family==='details'))for(let i=0;i<g.bodyVertices.length;i++){
 const changed=[0,1,2].some(axis=>halfView.getFloat32(g.offsets.standard.positionOffset+i*12+axis*4,true)!==g.positions[i*3+axis]);
 if(maxU.get(reliefVertexKey(g,i))!<.4){assert(!changed,'Independent-side height samples the actual mapped UV, not the mirrored stock UV');protectedLeft++;}
 if(g.positions[i*3]>.1&&changed)movedRight++;
}
assert(protectedLeft>1000&&movedRight>1000);
console.log('✓ Independent Details height uses the selected physical side before native UV separation');

const originalFetch=globalThis.fetch;
globalThis.fetch=async(input)=>{const path=String(input);assert(path.startsWith('/models/')&&!path.includes('..'));const data=await readFile('public'+path);return new Response(data,{headers:{'content-length':String(data.length)}});};
try{
 for(const layout of ['stock','underbody-panel-v1','independent-v1'] as const){
  const native=layout==='stock'?third.project:await splitDetailsSidesModel(third.project,layout);
  const organized=await reorganizeNativeModel(native),restored=await restoreNativeModel(organized);
  assert(restored.mesh.every((v,i)=>v===native.mesh[i])&&restored.mesh.length===native.mesh.length,'Full rig and all family volumes survive organize/return');
  if(layout!=='stock'){const stock=await restoreDetailsSidesModel(restored,'standard');assert(stock.mesh.every((v,i)=>v===third.project.mesh[i])&&stock.mesh.length===third.project.mesh.length);}
  console.log(`✓ Full model ${layout}: production asset loaders, UV organize/return and volume restoration`);
 }
}finally{globalThis.fetch=originalFetch;}
