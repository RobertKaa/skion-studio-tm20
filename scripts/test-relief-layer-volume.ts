import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildReliefPrototype} from '../src/relief/engine';
import {retainOtherLayerVolumes} from '../src/relief/layerVolume';
import type {RGBAImage} from '../src/dds';
const root='public/models/relief/',manifest=JSON.parse(await readFile(root+'dense/manifest.json','utf8'));
const bytes=async(path:string)=>new Uint8Array(await readFile(root+path));
const template={manifest,preview:await bytes(manifest.preview.url),variants:{standard:await bytes(manifest.variants.standard.url),normal:await bytes(manifest.variants.normal.url)},dependencies:await Promise.all(manifest.dependencies.map(async(d:{name:string;url:string})=>({name:d.name,data:await bytes(d.url)})))};
const atlas=(inside:(u:number,v:number)=>boolean):RGBAImage=>{const data=new Uint8ClampedArray(128*128*4);for(let y=0;y<128;y++)for(let x=0;x<128;x++)data.set([255,255,255,inside(x/127,1-y/127)?255:0],(y*128+x)*4);return{width:128,height:128,data};};
const a=atlas(u=>u<.35),b=atlas((u,v)=>u>.65&&!(v>.4&&v<.6));
const first=await buildReliefPrototype({template,mode:'geometry',scope:'vehicle',heightAtlas:a,strengthMm:6});
const second=await buildReliefPrototype({template,mode:'geometry',scope:'vehicle',heightAtlas:b,strengthMm:12});
const source=first.project.mesh.slice();const merged=retainOtherLayerVolumes(template,second,{mesh:first.project.mesh,variant:'standard'},b);
assert.deepEqual(first.project.mesh,source);assert.notDeepEqual(merged.project.mesh,second.project.mesh);
const neutral=await buildReliefPrototype({template,mode:'geometry',scope:'vehicle',heightAtlas:b,strengthMm:0});
const reset=retainOtherLayerVolumes(template,neutral,{mesh:merged.project.mesh,variant:'standard'},b);
let kept=0,added=0,cleared=0;
const changedGroups=new Set<string>(),key=(p:number[])=>p.map(v=>Math.round(v*1e6)).join(',');
const before=new DataView(first.project.mesh.buffer),next=new DataView(second.project.mesh.buffer),stock=new DataView(template.variants.standard.buffer),out=new DataView(merged.project.mesh.buffer),zero=new DataView(reset.project.mesh.buffer);
for(const g of manifest.geometries)for(let i=0;i<g.bodyVertices.length;i++){const at=g.offsets.standard.positionOffset+i*12;if([0,1,2].some(k=>next.getFloat32(at+k*4,true)!==stock.getFloat32(at+k*4,true)))changedGroups.add(key(g.positions.slice(i*3,i*3+3)));}
for(const g of manifest.geometries){let perLodKept=0,perLodAdded=0;for(let i=0;i<g.bodyVertices.length;i++){
  const at=g.offsets.standard.positionOffset+i*12,position=(view:DataView)=>[0,1,2].map(k=>view.getFloat32(at+k*4,true)),s=position(stock),old=position(before),n=position(next),m=position(out);
  if(n.some((v,k)=>v!==s[k])){assert.deepEqual(m,n,'The current layer gets its own volume');perLodAdded++;assert.deepEqual(position(zero),s,'Zero amplitude clears the target layer');cleared++;}
  else if(old.some((v,k)=>v!==s[k])&&!changedGroups.has(key(g.positions.slice(i*3,i*3+3)))){assert.deepEqual(m,old,'An earlier layer keeps its volume outside the current mask');assert.deepEqual(position(zero),old);perLodKept++;}
  if(!g.bodyVertices[i])assert.deepEqual(m,s,'Articulated parts keep their positions');
 }assert(perLodKept>0&&perLodAdded>0,'Both layers survive on every native LOD');kept+=perLodKept;added+=perLodAdded;}
assert(kept>1000&&added>1000&&cleared>1000);
const normalOnly=await buildReliefPrototype({template,mode:'normal',scope:'vehicle',heightAtlas:b,strengthMm:3});
const normalKept=retainOtherLayerVolumes(template,normalOnly,{mesh:first.project.mesh,variant:'standard'},{width:1,height:1,data:new Uint8ClampedArray(4)});
const normalView=new DataView(normalKept.project.mesh.buffer);
for(const g of manifest.geometries)for(let i=0;i<g.bodyVertices.length;i++)for(let axis=0;axis<3;axis++)assert.equal(normalView.getFloat32(g.offsets.normal.positionOffset+i*12+axis*4,true),before.getFloat32(g.offsets.standard.positionOffset+i*12+axis*4,true),'A normal-only layer does not erase existing geometry');
const fromNormal=retainOtherLayerVolumes(template,second,{mesh:normalKept.project.mesh,variant:'normal'},b);
assert.deepEqual(fromNormal.project.mesh,merged.project.mesh,'Existing volume survives either native shader layout');
assert.throws(()=>retainOtherLayerVolumes(template,second,{mesh:new Uint8Array(20),variant:'standard'},b),/incompatible/);
console.log(`✓ Volume par calque : ${kept} positions antérieures conservées, ${added} positions ciblées, exclusions et remise à zéro, cinq LOD et articulations intacts`);
