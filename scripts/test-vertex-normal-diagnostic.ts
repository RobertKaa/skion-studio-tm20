import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bakeVertexNormalDiagnostic} from '../src/relief/vertexNormals';
import {embeddedGlbData} from '../src/blenderParts';
for(const dense of [false,true]){
 const root='public/models/relief/',manifest=JSON.parse(await readFile(root+(dense?'dense/':'')+'manifest.json','utf8')),bytes=async(path:string)=>new Uint8Array(await readFile(root+path));
 const template={manifest,preview:await bytes(manifest.preview.url),variants:{standard:await bytes(manifest.variants.standard.url),normal:await bytes(manifest.variants.normal.url)},dependencies:await Promise.all(manifest.dependencies.map(async(d:{name:string;url:string})=>({name:d.name,data:await bytes(d.url)})))};
 const data=new Uint8ClampedArray(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const nx=.5*Math.sin(x/64*4*Math.PI),ny=.3*Math.cos(y/64*4*Math.PI);data.set([128+nx*127,128+ny*127,128+Math.sqrt(1-nx*nx-ny*ny)*127,255],(y*64+x)*4);}
 const source=template.variants.standard.slice(),result=await bakeVertexNormalDiagnostic(template,{width:64,height:64,data});assert(result.changed.every(n=>n>0),'Every LOD receives explicit native normals');assert.deepEqual(template.variants.standard,source,'Source bytes remain immutable');
 const allowed=new Uint8Array(source.length);for(const g of manifest.geometries)allowed.fill(1,g.offsets.standard.normalOffset,g.offsets.standard.normalOffset+g.normals.length/3*(g.normalEncoding==='dec3n'?4:12));
 for(let i=0;i<source.length;i++)if(source[i]!==result.mesh[i])assert(allowed[i],'Only declared normal bytes may differ: positions, indices, UVs, bindings and shaders stay identical');
 const before=embeddedGlbData(template.preview.slice().buffer),after=embeddedGlbData(result.preview);assert.deepEqual(before.gltf.skins,after.gltf.skins);assert.deepEqual(before.gltf.animations,after.gltf.animations);
 await assert.rejects(()=>bakeVertexNormalDiagnostic(template,{width:NaN,height:64,data}));console.log(`✓ ${dense?'Dense':'Base'} vertex-normal diagnostic: all five LODs, native normal spans only, intact sources, positions, shaders and rig`);
}
