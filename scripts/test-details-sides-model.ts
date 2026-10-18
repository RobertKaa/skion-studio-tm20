import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { embeddedGlbData } from '../src/blenderParts';
import { patchDetailsSidesMesh, patchDetailsSidesPreview, validateDetailsSidesManifest } from '../src/detailsSidesModel';

const bytes=async(path:string)=>new Uint8Array(await readFile(path));
const manifest=JSON.parse(await readFile('public/models/details-sides/manifest.json','utf8'));
const assets={manifest,bytes:await bytes('public/models/details-sides/patches.bin'),preview:await bytes('public/models/details-sides/details.glb')};
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
validateDetailsSidesManifest(manifest);
assert.throws(()=>validateDetailsSidesManifest({...manifest,previewAsset:{...manifest.previewAsset,file:'../preview.glb'}}));
assert.throws(()=>validateDetailsSidesManifest({...manifest,sources:[manifest.sources[0]]}));
const invalid=structuredClone(manifest);invalid.sources[0].patches[1].offset=0;
assert.throws(()=>validateDetailsSidesManifest(invalid),'Overlapping native patch ranges are refused');
for(const source of manifest.sources){
  const path=`public/models/relief/${source.id.startsWith('dense-')?'dense/':''}${source.id.endsWith('normal')?'normal':'standard'}.Mesh.gbx`;
  const original=await bytes(path),before=original.slice(),result=await patchDetailsSidesMesh(original,assets);
  assert.equal(hash(result),source.resultSha256,'Runtime patch matches the independently parsed/rebuilt native GBX');
  assert.deepEqual(original,before,'Never mutate the existing vehicle or its undo sources');
  const corrupt=original.slice();corrupt[source.patches[0].offset+100]^=1;
  await assert.rejects(()=>patchDetailsSidesMesh(corrupt,assets),'Only the audited Details nodes may be replaced');
  const relief=JSON.parse(await readFile(`public/models/relief/${source.id.startsWith('dense-')?'dense/':''}manifest.json`,'utf8'));
  const variant=source.id.endsWith('normal')?'normal':'standard',offset=relief.geometries[0].offsets[variant].positionOffset;
  assert(source.patches.every((p:{offset:number;length:number})=>offset<p.offset||offset>=p.offset+p.length));
  const deformed=original.slice(),view=new DataView(deformed.buffer);view.setFloat32(offset,view.getFloat32(offset,true)+.001,true);
  const patched=await patchDetailsSidesMesh(deformed,assets);
  const target=offset+source.patches.filter((p:{offset:number;length:number})=>p.offset+p.length<=offset).reduce((s:number,p:{dataLength:number;length:number})=>s+p.dataLength-p.length,0);
  assert.equal(new DataView(patched.buffer).getFloat32(target,true),view.getFloat32(offset,true),'Existing Body volume survives the UV separation');
}
for(const dense of [false,true]){
  const original=await bytes(`public/models/relief/${dense?'dense/':''}preview.glb`),before=original.slice();
  const result=patchDetailsSidesPreview(original.buffer,assets.preview),old=embeddedGlbData(original.buffer),next=embeddedGlbData(result);
  assert.deepEqual(original,before);
  assert.deepEqual(next.gltf.nodes,old.gltf.nodes,'Node hierarchy and native bindings remain intact');
  const read=(index:number)=>{
    const a=next.gltf.accessors[index],b=next.gltf.bufferViews[a.bufferView],size=a.type==='VEC3'?3:a.type==='VEC2'?2:1;
    const view=new DataView(result,next.binStart+(b.byteOffset??0)+(a.byteOffset??0));
    return (i:number,c=0)=>a.componentType===5126?view.getFloat32(i*(b.byteStride??size*4)+4*c,true):view.getUint32(i*4,true);
  };
  let left=0,right=0;
  for(const [i,mesh] of next.gltf.meshes.entries())for(const [j,primitive] of mesh.primitives.entries()){
    if(!String(next.gltf.materials[primitive.material].name).endsWith('_Details')){
      assert.deepEqual(primitive,old.gltf.meshes[i].primitives[j],'Other shaders and attributes stay unchanged');continue;
    }
    const pos=read(primitive.attributes.POSITION),uv=read(primitive.attributes.TEXCOORD_0),index=read(primitive.indices);
    const count=next.gltf.accessors[primitive.indices].count;
    for(let t=0;t<count;t+=3){
      const ids=[index(t),index(t+1),index(t+2)],x=ids.map(i=>pos(i)),u=ids.map(i=>uv(i));
      assert(!(Math.min(...x)<-1e-7&&Math.max(...x)>1e-7),'A face never interpolates across both texture halves');
      if(Math.min(...x)<-1e-7){assert(Math.max(...u)<=.500001);right++;}
      if(Math.max(...x)>1e-7){assert(Math.min(...u)>=.499999);left++;}
    }
  }
  assert(left>20000&&right>20000,'Both actual sides, including the central floor cut, are covered');
}
console.log('✓ Dessous indépendants : quatre variantes GBX, cinq LOD, séparation physique/UV, volume conservé, hiérarchie intacte et empreintes/quotas sûrs');
