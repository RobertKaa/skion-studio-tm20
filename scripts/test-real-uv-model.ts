import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {patchNativeUvMesh,patchNativeUvPreview,restoreNativeUvMesh,restoreNativeUvPreview,validateUvModelRecipes} from '../src/realUvModel';
import {embeddedGlbData} from '../src/blenderParts';
import {patchDetailsSidesMesh,patchDetailsSidesPreview} from '../src/detailsSidesModel';
const bytes=async(p:string)=>new Uint8Array(await readFile(p));
const assets={manifest:JSON.parse(await readFile('public/models/uv-atlas/manifest.json','utf8')),bytes:await bytes('public/models/uv-atlas/recipes.bin')};
validateUvModelRecipes(assets.manifest);
await mkdir('work/uv-atlas/verified',{recursive:true});
for(const layout of ['stock','underbody-panel-v1','independent-v1'] as const){
 const extra=layout==='stock'?null:{manifest:JSON.parse(await readFile(`public/models/${layout==='underbody-panel-v1'?'underbody-panel':'details-sides'}/manifest.json`,'utf8')),bytes:await bytes(`public/models/${layout==='underbody-panel-v1'?'underbody-panel':'details-sides'}/patches.bin`),preview:await bytes(`public/models/${layout==='underbody-panel-v1'?'underbody-panel':'details-sides'}/details.glb`)};
 for(const dense of [false,true])for(const normal of [false,true]){
  let mesh=await bytes(`public/models/relief/${dense?'dense/':''}${normal?'normal':'standard'}.Mesh.gbx`);
  let preview=(await bytes(`public/models/relief/${dense?'dense/':''}preview.glb`)).buffer as ArrayBuffer;
  if(extra){mesh=await patchDetailsSidesMesh(mesh,extra);preview=patchDetailsSidesPreview(preview,extra.preview);}
  const {mesh:out,recipe}=await patchNativeUvMesh(mesh,layout,assets);
  assert.equal(out.length,recipe.resultByteLength);assert.notDeepEqual(out,mesh);
  let shift=0;
  for(const v of recipe.visuals){
   const mapping=new DataView(assets.bytes.buffer,assets.bytes.byteOffset+v.mapping.offset,v.mapping.length);
   for(const copy of v.copies)for(let i=0;i<v.newCount;i++){
    const old=mapping.getUint16(i*2,true),a=v.offset+copy.source+old*copy.stride,b=v.offset+shift+copy.target+i*copy.stride;
    for(let k=0;k<copy.stride;k++)assert.equal(out[b+k],mesh[a+k],`${copy.name} survives chart duplication at every LOD`);
   }shift+=v.resultLength-v.length;
  }
  const remapped=patchNativeUvPreview(preview,recipe,assets),before=embeddedGlbData(preview),after=embeddedGlbData(remapped);
  const read=(doc:typeof before,buffer:ArrayBuffer,id:number)=>{const a=doc.gltf.accessors[id],b=doc.gltf.bufferViews[a.bufferView],axes=a.type==='VEC3'?3:a.type==='VEC2'?2:1,offset=doc.binStart+(b.byteOffset??0)+(a.byteOffset??0),step=b.byteStride??axes*4,view=new DataView(buffer);return(i:number,c=0)=>a.componentType===5126?view.getFloat32(offset+i*step+c*4,true):view.getUint32(offset+i*step,true);};
  let moved=0,total=0;
  for(const node of before.gltf.nodes){if(node.mesh===undefined)continue;const v=recipe.visuals.find(r=>r.visualIndex===node.extras?.nativeVisualIndex);if(!v)continue;
   const p=before.gltf.meshes[node.mesh].primitives[0],q=after.gltf.meshes[node.mesh].primitives[0];
   const a=read(before,preview,p.indices),b=read(after,remapped,q.indices),pos=read(before,preview,p.attributes.POSITION),nextPos=read(after,remapped,q.attributes.POSITION),uv=read(before,preview,p.attributes.TEXCOORD_0),nextUv=read(after,remapped,q.attributes.TEXCOORD_0),source=read(after,remapped,q.attributes._SOURCE_UV);
   const count=before.gltf.accessors[p.indices].count;assert.equal(count,after.gltf.accessors[q.indices].count);
   for(let i=0;i<count;i++){const old=a(i),id=b(i);for(let c=0;c<3;c++)assert.equal(pos(old,c),nextPos(id,c),'No shape change');for(let c=0;c<2;c++)assert.equal(uv(old,c),source(id,c),'Original metric coordinates survive');const u=nextUv(id),vv=nextUv(id,1);assert(u>=-1e-5&&u<=1.00001&&vv>=-1e-5&&vv<=1.00001,'Actual UV inside atlas');total++;if(Math.abs(uv(old)-u)+Math.abs(uv(old,1)-vv)>.001)moved++;}
  }
  assert(moved/total>.95,'Actual UV coordinates moved, beyond an editor overlay');
  assert.deepEqual(await restoreNativeUvMesh(out,mesh,layout,assets),mesh,'Native UV return restores every original GBX byte');
  const restoredPreview=restoreNativeUvPreview(remapped,recipe),restored=embeddedGlbData(restoredPreview);
  for(const node of after.gltf.nodes){if(node.mesh===undefined)continue;const v=recipe.visuals.find(r=>r.visualIndex===node.extras?.nativeVisualIndex);if(!v)continue;
   const a=after.gltf.meshes[node.mesh].primitives[0].attributes,b=restored.gltf.meshes[node.mesh].primitives[0].attributes;
   assert.equal(b.TEXCOORD_0,a._SOURCE_UV);assert.equal(b._ATLAS_UV,a.TEXCOORD_0);assert.equal(b._SOURCE_UV,undefined);assert.equal(b.POSITION,a.POSITION,'Latest preview geometry retained');
  }
  assert.deepEqual(restored.gltf.animations,after.gltf.animations);assert.deepEqual(restored.gltf.skins,after.gltf.skins);
  const again=embeddedGlbData(patchNativeUvPreview(restoredPreview,recipe,assets));assert.equal(again.binSize,after.binSize,'Repeated layout switching does not grow preview buffers');
  const first=recipe.visuals[0],position=first.copies.find(c=>c.name==='Position')!;
  const changed=mesh.slice();new DataView(changed.buffer).setFloat32(first.offset+position.source,123.25,true);
  const patched=await patchNativeUvMesh(changed,layout,assets);new DataView(patched.mesh.buffer);
  const targetOffset=first.offset+position.target;assert.equal(new DataView(patched.mesh.buffer).getFloat32(targetOffset,true),123.25,'Existing relief vertex deformation survives');
  const newRelief=patched.mesh.slice(),mapping=new DataView(assets.bytes.buffer,assets.bytes.byteOffset+first.mapping.offset,first.mapping.length);
  for(let i=0;i<first.newCount;i++)if(mapping.getUint16(i*2,true)===0)new DataView(newRelief.buffer).setFloat32(targetOffset+i*position.stride,321.5,true);
  const latest=await restoreNativeUvMesh(newRelief,mesh,layout,assets);assert.equal(new DataView(latest.buffer).getFloat32(first.offset+position.source,true),321.5,'Relief changed after repacking survives return');
  const tampered=out.slice();tampered[first.offset]^=1;await assert.rejects(()=>restoreNativeUvMesh(tampered,mesh,layout,assets),'Unknown organized structure rejected without resetting geometry');
  await writeFile(`work/uv-atlas/verified/${layout}-${dense?'dense':'base'}-${normal?'normal':'standard'}.Mesh.gbx`,out);
  if(!normal)await writeFile(`work/uv-atlas/verified/${layout}-${dense?'dense':'base'}.glb`,new Uint8Array(remapped));
  console.log(`✓ ${recipe.id}: geometry/source UV preserved, ${(100*moved/total).toFixed(1)}% real UV moved`);
 }
}
const corrupt=assets.bytes.slice();corrupt[100]^=1;
await assert.rejects(()=>patchNativeUvMesh(new Uint8Array(20),'stock',{...assets,bytes:corrupt}));
const invalid=structuredClone(assets.manifest);invalid.sources[0].visuals[0].copies[0].target=0;
assert.throws(()=>validateUvModelRecipes(invalid));
console.log('✓ Authenticated asset and overlapping reconstruction ranges rejected');
