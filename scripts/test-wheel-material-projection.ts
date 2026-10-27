import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js';
import {Canvas,FabricImage,setEnv} from 'fabric';
import {getEnv} from 'fabric/node';
import {getWheelCoordinates,hasWheelFaceAlignmentConflict} from '../src/materials/wheelCoordinates';
import {createMaterialProjector} from '../src/materials/projection';
import {createMaterialDefinition,isValidMaterialDefinition,isValidMaterialLayer,type MaterialLayer} from '../src/materials/types';
import {loadMaterialSources,renderMaterialLayer} from '../src/materials/render';
import {exportMaterialPack,importMaterialFilesDetailed} from '../src/materials/import';
import {previewMeshMaterialSlot} from '../src/three/materialSlots';
import type {ProjectionTriangle} from '../src/three/decalProjection';
import {WHEEL_TREAD_UV} from '../src/wheelTreads';
import {WHEEL_PART_GUIDES} from '../src/wheelParts';
import {EditorCore} from '../src/editor/EditorCore';
import {MAPS,type MapId} from '../src/maps';
import {embeddedGlbData} from '../src/blenderParts';
import {drawWheelPart} from '../src/ui/wheelPartPreview';
import {organizedUvParts} from '../src/uvParts';
import {organizedAtlasGeometry} from '../src/realUvAtlas';

const original=THREE.TextureLoader.prototype.load;THREE.TextureLoader.prototype.load=function(){return new THREE.Texture();};
const raw=readFileSync('public/models/car/StadiumCAR2020_OffsetFix.fbx');let model:THREE.Group;
try{model=new FBXLoader().parse(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');}finally{THREE.TextureLoader.prototype.load=original;}
let box=new THREE.Box3().setFromObject(model);const size=box.getSize(new THREE.Vector3());model.scale.setScalar(4.2/Math.max(size.x,size.y,size.z));
box=new THREE.Box3().setFromObject(model);const center=box.getCenter(new THREE.Vector3());model.position.set(-center.x,-box.min.y,-center.z);model.updateMatrixWorld(true);
const geometry:ProjectionTriangle[]=[];
model.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return;const mat=Array.isArray(o.material)?o.material[0]:o.material;
  const family=previewMeshMaterialSlot(mat.name,o.name);if(family!=='wheels')return;
  const p=o.geometry.getAttribute('position'),uv=o.geometry.getAttribute('uv'),n=o.geometry.getAttribute('normal'),index=o.geometry.index,nm=new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
  for(let i=0;i<(index?.count??p.count);i+=3){const ids=[0,1,2].map(c=>index?.getX(i+c)??i+c);geometry.push({family,
    points:ids.map(id=>new THREE.Vector3().fromBufferAttribute(p,id).applyMatrix4(o.matrixWorld).toArray()) as ProjectionTriangle['points'],
    normals:ids.map(id=>new THREE.Vector3().fromBufferAttribute(n,id).applyNormalMatrix(nm).toArray()) as ProjectionTriangle['normals'],
    uv:ids.map(id=>[uv.getX(id),uv.getY(id)]) as ProjectionTriangle['uv']});}
});
const initial=JSON.stringify(geometry),surface=getWheelCoordinates(geometry);assert.equal(surface,getWheelCoordinates(geometry));
assert(surface.circumference>2.4&&surface.circumference<2.7,'Actual wheel circumference, in the same physical units as the car');
const rows:{ratio:number;area:number}[]=[];
geometry.forEach((t,f)=>{
  const u=t.uv.reduce((s,p)=>s+p[0],0)/3;if(u<WHEEL_TREAD_UV.minU||u>WHEEL_TREAD_UV.maxU)return;
  const p=new THREE.Vector3(...t.points[0]),a=new THREE.Vector3(...t.points[1]).sub(p),b=new THREE.Vector3(...t.points[2]).sub(p),l=a.length(),x=a.dot(b)/l,y=Math.sqrt(Math.max(0,b.lengthSq()-x*x));if(y<1e-9)return;
  const ids=[0,1,2].map(c=>surface.triangleNodes[f*3+c]),u2=ids.map(i=>surface.transverse[i]),v2=ids.map(i=>surface.longitudinal[i]);
  const aa=(u2[1]-u2[0])/l,ba=(v2[1]-v2[0])/l,ab=(u2[2]-u2[0]-aa*x)/y,bb=(v2[2]-v2[0]-ba*x)/y;
  const m=aa*aa+ba*ba,n=ab*ab+bb*bb,z=aa*ab+ba*bb,d=Math.sqrt((m-n)**2+4*z*z);
  rows.push({ratio:Math.sqrt(Math.max(0,(m+n+d)/2))/Math.sqrt(Math.max(1e-20,(m+n-d)/2)),area:l*y/2});
});
rows.sort((a,b)=>a.ratio-b.ratio);const total=rows.reduce((s,v)=>s+v.area,0);let sum=0,p90=0;
for(const row of rows){sum+=row.area;if(sum>=total*.9){p90=row.ratio;break;}}
assert(total>1,'Actual tread geometry is covered');assert(p90<1.12,`90% of actual tread keeps aspect within 12% (${p90})`);
const face=getWheelCoordinates(geometry,true);assert.equal(face,getWheelCoordinates(geometry,true));
assert(Math.abs(face.max[0]-face.min[0]-(face.max[1]-face.min[1]))<.015,'Face view keeps a circular wheel round');
function assertPhysicalFaceOrientation(mesh:readonly ProjectionTriangle[],label:string,expectConflict=false) {
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(const triangle of mesh)for(const point of triangle.points)for(let axis=0;axis<3;axis++){
    low[axis]=Math.min(low[axis],point[axis]);high[axis]=Math.max(high[axis],point[axis]);
  }
  const mid=low.map((value,axis)=>(value+high[axis])/2);
  // The opposite wheels reuse the same UV texels. +X is the canonical readable
  // exterior; calibrating from both sides would cancel the horizontal axis.
  const reference=mesh.filter(triangle=>triangle.points.every(point=>point[0]>mid[0]&&point[2]<mid[2]));
  const bounds=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
  for(const triangle of reference)for(const point of triangle.points)for(let axis=0;axis<3;axis++){
    bounds[0][axis]=Math.min(bounds[0][axis],point[axis]);bounds[1][axis]=Math.max(bounds[1][axis],point[axis]);
  }
  const center=bounds[0].map((value,axis)=>(value+bounds[1][axis])/2);
  const corners=reference.flatMap(triangle=>triangle.points.map((point,corner)=>({point,uv:triangle.uv[corner],source:(triangle.sourceUv??triangle.uv)[corner]})))
    .filter(corner=>corner.source[0]>WHEEL_TREAD_UV.maxU+.015&&corner.point[0]>center[0]);
  assert(corners.length>20,`${label}: actual exterior sidewall is available`);
  const top=corners.reduce((a,b)=>a.point[1]>b.point[1]?a:b),right=corners.reduce((a,b)=>a.point[2]<b.point[2]?a:b);
  const definition=createMaterialDefinition();definition.transform={...definition.transform,projection:'wheel-face',mode:'cover',size:256};
  const projector=createMaterialProjector({definition,family:'wheels',regions:[],exclusions:[]},mesh,512,{width:64,height:64})!;
  const source=(axis:0|1)=>Float32Array.from({length:64*64},(_,index)=>((axis===0?index%64:Math.floor(index/64))+.5)/64);
  const horizontal=projector.scalarSampler({width:64,height:64,values:source(0)}),vertical=projector.scalarSampler({width:64,height:64,values:source(1)});
  assert(Math.abs(horizontal(...top.uv)-.5)<.035,`${label}: the physical top samples the horizontal image centre (${horizontal(...top.uv)})`);
  assert(vertical(...top.uv)<.09,`${label}: the physical top samples the top of the source rather than the native V phase (${vertical(...top.uv)})`);
  assert(horizontal(...right.uv)>.91,`${label}: image right follows physical screen right on the +X exterior (${horizontal(...right.uv)})`);
  assert(Math.abs(vertical(...right.uv)-.5)<.035,`${label}: image right remains level (${vertical(...right.uv)})`);
  assert.equal(hasWheelFaceAlignmentConflict(mesh),expectConflict,`${label}: shared-UV phase conflicts are reported`);
  assert.equal(hasWheelFaceAlignmentConflict([...mesh].reverse()),expectConflict,`${label}: detection does not depend on triangle order`);
  for(const sideX of [-1,1])for(const sideZ of [-1,1]) {
    const wheel=mesh.filter(triangle=>triangle.points.every(point=>(point[0]-mid[0])*sideX>0&&(point[2]-mid[2])*sideZ>0));
    for(const side of ['outer','inner'] as const) {
      const vertices=wheel.flatMap(triangle=>triangle.points.map((point,corner)=>({point,uv:triangle.uv[corner],source:(triangle.sourceUv??triangle.uv)[corner]})))
        .filter(vertex=>side==='outer' ? vertex.source[0]>WHEEL_TREAD_UV.maxU+.015 : vertex.source[0]<WHEEL_TREAD_UV.minU-.015);
      assert(vertices.length>20,`${label}: ${sideX},${sideZ} ${side} sidewall exists`);
      const top=vertices.reduce((a,b)=>a.point[1]>b.point[1]?a:b);
      const x=horizontal(...top.uv),y=vertical(...top.uv);
      if(expectConflict&&sideX<0){
        const deviation=Math.abs(Math.atan2(x-.5,.5-y)*180/Math.PI);
        assert(deviation>110&&deviation<130,`${label}: ${sideX},${sideZ} ${side} conflict is approximately 120° (${deviation}°)`);
      } else assert(Math.abs(x-.5)<.035&&y<.09,
        `${label}: ${sideX},${sideZ} ${side} wheel top maps to the artwork top (${x},${y}; UV ${top.uv})`);
    }
  }
  return {top,right};
}
const physicalFace=assertPhysicalFaceOrientation(geometry,'Official FBX');
assert.equal(hasWheelFaceAlignmentConflict([]),null,'An absent model cannot be described as aligned or conflicting');
const unmeasurable=geometry.map(triangle=>({...triangle,uv:triangle.uv.map(()=>[.5,.5]) as ProjectionTriangle['uv']}));
assert.equal(hasWheelFaceAlignmentConflict(unmeasurable),null,'Degenerate UV data produces an indeterminate alignment');
assertPhysicalFaceOrientation(organizedAtlasGeometry(geometry,'stock'),'Organized FBX atlas with native sourceUv');
assertPhysicalFaceOrientation([...geometry].reverse(),'Reordered official FBX');
assert.equal(JSON.stringify(geometry),initial,'No mesh/UV mutation is needed for the editor or game');
console.log(`✓ Physical tyre wrap, circular flanks, real FBX aspect p90=${p90.toFixed(3)}, source mesh intact`);

const def=createMaterialDefinition();def.color='#ffffff';def.roughness=255;def.transform={...def.transform,projection:'wheel',size:248};
const layer:MaterialLayer={definition:def,family:'wheels',regions:[],exclusions:[]};
const values=Float32Array.from({length:32*16},(_,i)=>.5+.2*Math.sin(i%32/32*Math.PI*2)+.2*Math.cos(Math.floor(i/32)/16*Math.PI*2));
for(const angle of [0,37,90,-60])for(const flipX of [false,true])for(const flipY of [false,true]){
  def.transform.angle=angle;def.transform.flipX=flipX;def.transform.flipY=flipY;
  const sample=createMaterialProjector(layer,geometry,256,{width:32,height:16})!.scalarSampler({width:32,height:16,values});
  for(const u of [.25,.45,.7])assert(Math.abs(sample(u,0)-sample(u,1))<.0001,`Closed circumference at ${angle}°, flip ${flipX}/${flipY}: ${u} => ${sample(u,0)} / ${sample(u,1)}`);
}
def.transform.angle=0;def.transform.flipX=def.transform.flipY=false;
assert(isValidMaterialDefinition(def));def.transform.projection='wheel-face';assert(isValidMaterialDefinition(def));
assert(!isValidMaterialLayer({...layer,family:'skin'}),'A wheel-only placement cannot be persisted on a body layer');
await assert.rejects(async()=>createMaterialProjector({...layer,family:'skin'},geometry,128,{width:32,height:16}),/réservé/);
console.log('✓ Seam closure for rotated/mirrored rectangular patterns and strict projection validation');

setEnv(getEnv());const env=getEnv();Object.assign(globalThis,{document:env.document,window:env.window,HTMLElement:env.window.HTMLElement,HTMLImageElement:env.window.HTMLImageElement,HTMLCanvasElement:env.window.HTMLCanvasElement});
{
  const source=document.createElement('canvas');source.width=source.height=64;
  const ctx=source.getContext('2d')!,pixels=ctx.createImageData(64,64);
  for(let y=0;y<14;y++)for(let x=20;x<44;x++)pixels.data.set([y*4,x*4,72,255],(y*64+x)*4);
  ctx.putImageData(pixels,0,0);const image=source.toDataURL('image/png');
  const normal=document.createElement('canvas');normal.width=normal.height=8;const normalContext=normal.getContext('2d')!;
  normalContext.fillStyle='rgb(200,128,240)';normalContext.fillRect(0,0,8,8);
  const definition=createMaterialDefinition();definition.color='#ffffff';definition.roughness=definition.metalness=255;
  definition.transform={...definition.transform,projection:'wheel-face',mode:'cover',size:256};
  const texture={src:image,name:'Top source.png',component:'r' as const,invert:false};
  definition.textures={color:texture,roughness:texture,metalness:{...texture,component:'g'},
    normal:{...texture,src:normal.toDataURL('image/png')}};
  await loadMaterialSources(definition);
  const maps=renderMaterialLayer({definition,family:'wheels',regions:[],exclusions:[]},512,geometry);
  const read=(channel:'color'|'roughmetal'|'normal',uv:readonly[number,number])=>{
    const c=maps.get(channel)!;return c.getContext('2d')!.getImageData(Math.min(c.width-1,Math.floor(uv[0]*c.width)),Math.min(c.height-1,Math.floor((1-uv[1])*c.height)),1,1).data;
  };
  const colour=read('color',physicalFace.top.uv),finish=read('roughmetal',physicalFace.top.uv),projectedNormal=read('normal',physicalFace.top.uv);
  assert(colour[3]>240&&colour[0]<35&&Math.abs(colour[1]-128)<15,'The unchanged top source patch appears at the physical wheel top');
  assert(Math.abs(finish[0]-colour[0])<2&&Math.abs(finish[1]-colour[1])<2,'Roughness and metalness sample the exact same physical source position as colour');
  assert(Math.abs(projectedNormal[3]-colour[3])<2,'The normal map shares the top artwork coverage');
  assert(projectedNormal[1]>175&&Math.abs(projectedNormal[0]-128)<25,'Source normal X follows physical image-right through the native V tangent at the wheel top');
  assert.equal(read('color',physicalFace.right.uv)[3],0,'The top source patch does not rotate onto the right side');
  assert.equal(definition.textures.color!.src,image,'Correcting wheel orientation never rewrites the source PNG');
  for(const canvas of maps.values())canvas.width=canvas.height=1;source.width=source.height=normal.width=normal.height=1;
}
const source=document.createElement('canvas');source.width=64;source.height=32;const ctx=source.getContext('2d')!,pixels=ctx.createImageData(64,32);
for(let y=0;y<32;y++)for(let x=0;x<64;x++)pixels.data.set([x*4,y*8,48,255],(y*64+x)*4);ctx.putImageData(pixels,0,0);
const png=source.toDataURL('image/png');def.textures.color={src:png,name:'Aspect 2:1.png',component:'r',invert:false};def.textures.roughness={...def.textures.color};
const pixel=(c:HTMLCanvasElement,u:number,v:number)=>c.getContext('2d')!.getImageData(Math.floor(u*c.width),Math.floor(v*c.height),1,1).data;
await loadMaterialSources(def);
for(const dense of [false,true]){
  const bytes=readFileSync(`public/models/relief/${dense?'dense/':''}preview.glb`),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{gltf,view,binStart}=embeddedGlbData(buffer);
  const read=(id:number)=>{const a=gltf.accessors[id],b=gltf.bufferViews[a.bufferView],axes=a.type==='VEC3'?3:a.type==='VEC2'?2:1,offset=binStart+(b.byteOffset??0)+(a.byteOffset??0),stride=b.byteStride??axes*4;
    return(i:number,c=0)=>a.componentType===5126?view.getFloat32(offset+i*stride+c*4,true):view.getUint32(offset+i*stride,true);};
  const native:ProjectionTriangle[]=[];
  for(const mesh of gltf.meshes)for(const p of mesh.primitives){if(!gltf.materials[p.material].name.endsWith('_Wheels'))continue;
    const pos=read(p.attributes.POSITION),uv=read(p.attributes.TEXCOORD_0),n=read(p.attributes.NORMAL),indices=read(p.indices);
    for(let at=0;at<gltf.accessors[p.indices].count;at+=3){const ids=[0,1,2].map(c=>indices(at+c));native.push({family:'wheels',points:ids.map(i=>[pos(i),pos(i,1),pos(i,2)]) as ProjectionTriangle['points'],uv:ids.map(i=>[uv(i),uv(i,1)]) as ProjectionTriangle['uv'],normals:ids.map(i=>[n(i),n(i,1),n(i,2)]) as ProjectionTriangle['normals']});}
  }
  const result=getWheelCoordinates(native);assert(result.circumference>2.2&&result.circumference<2.4,'Native helpers cannot inflate the wheel metric');
  assertPhysicalFaceOrientation(native,`Native ${dense?'dense':'standard'} GLB`,true);
  if(!dense)assertPhysicalFaceOrientation(organizedAtlasGeometry(native,'stock'),'Organized native GLB atlas with native sourceUv',true);
  const thumbnail=document.createElement('canvas');thumbnail.width=256;thumbnail.height=176;
  for(const part of organizedUvParts(WHEEL_PART_GUIDES)){
    assert(drawWheelPart(thumbnail.getContext('2d')!,source,part,native),'Native relief tyre previews must draw physically rather than falling back to flat UVs');
    if(part.parent.key!=='tyres:tread')assert.equal(pixel(thumbnail,.5,.5)[3],0,'The tyre sidewall stays an annulus; angle aliasing must never fill its central hole');
  }
  def.transform.projection='wheel';const preview=renderMaterialLayer(layer,128,native);assert(pixel(preview.get('color')!,.5,.5)[3]>240,'Native geometry produces visible tyre color');for(const c of preview.values())c.width=c.height=1;
}
def.transform.projection='wheel';
const rendered=renderMaterialLayer(layer,256,geometry);
for(const u of [.3,.5,.7])for(const v of [.2,.5,.8])assert(Math.abs(pixel(rendered.get('color')!,u,v)[0]-pixel(rendered.get('roughmetal')!,u,v)[0])<2,'Color/finish share the corrected tyre projection');
for(const c of rendered.values())c.width=c.height=1;
console.log('✓ Sidewall alignment: four FBX wheels aligned; native/dense/organized UVs expose 120° mirrored-side conflict; color, PBR and normal share the source');
def.transform.projection='wheel-face';const archive=await exportMaterialPack(def);const pack=await importMaterialFilesDetailed([new File([await archive.arrayBuffer()],'Wheel.zip',{type:'application/zip'})]);
assert.equal(pack.definition.transform.projection,'wheel-face');assert(pack.preservedPlacement);
assert.equal(WHEEL_PART_GUIDES.reduce((sum,p)=>sum+p.polygons[0][1].x-p.polygons[0][0].x,0),1);

type Image=FabricImage&{id:string;materialLayer?:MaterialLayer;linkedImageId?:string};
const states=new Map(MAPS.map(m=>{const canvas=new Canvas(undefined,{width:m.workRes,height:m.workRes,backgroundColor:'#123456',renderOnAddRemove:false,enableRetinaScaling:false});const textureEl=document.createElement('canvas');textureEl.width=textureEl.height=1;return [m.id,{canvas,el:canvas.lowerCanvasEl,textureEl,suspendHistory:false,textureDirty:true,baseline:'',undo:[] as string[],redo:[] as string[],coalesceKey:null}];}));
const core=Object.create(EditorCore.prototype) as EditorCore;Object.assign(core,{maps:states,activeMap:'Wheels_B',tool:'select',blenderParts:[],listeners:new Map(),objectUrls:[],materialGeometry:()=>geometry,projectionSources:new Map(),projectionBakes:new Map(),materialBakes:new Map(),materialSurfaces:[],materialInteractive:false,materialUpdateSequence:0,textureResolution:1024,illumRoles:new Map(),importedRoleMasks:new WeakMap(),previewDirty:new Set(),previewUpdates:new Set(),flushTexture:()=>{},isPanning:()=>false,setActiveMap:(id:MapId)=>{core.activeMap=id;}});
for(const m of MAPS)(core as unknown as {wireCanvas(id:MapId,state:unknown):void}).wireCanvas(m.id,states.get(m.id)!);
try{
  const image=await FabricImage.fromURL(png) as Image;image.id='wheel-original';image.opacity=.7;states.get('Wheels_B')!.canvas.add(image);states.get('Wheels_B')!.canvas.setActiveObject(image);core.resetMapBaseline('Wheels_B');
  assert(await core.adaptSelectionToWheel('wheel'));assert.equal(image.id,'wheel-original');assert.equal(image.opacity,.7);assert.equal(image.materialLayer!.definition.transform.projection,'wheel');
  assert.equal(image.materialLayer!.regions[0].key,'tyres:tread');assert.equal(image.materialLayer!.definition.textures.color!.src,png,'The original source image stays editable');
  const captured=await core.captureProject();assert(JSON.stringify(captured.maps.Wheels_B).includes('wheel-original'));assert(JSON.stringify(captured.maps.Wheels_B).includes('tyres:tread'));
  await core.undo();assert(!((core.getSelection() as Image|null)?.materialLayer));assert(states.get('Wheels_B')!.canvas.getObjects().some(o=>(o as Image).id==='wheel-original'));
  (core as unknown as {loadEditableImage(file:File):Promise<FabricImage>}).loadEditableImage=async()=>FabricImage.fromURL(png);
  const inserted=await core.fillRegionWithImage(new File(['test'],'logo.png'),'tyres:outer:element:0','Wheels_B') as Image;
  assert.equal(inserted.materialLayer!.definition.transform.projection,'wheel-face','New sidewall image fills use the circular placement automatically');
  assert.equal(inserted.materialLayer!.regions[0].key,'tyres:outer:element:0');assert.equal(inserted.materialLayer!.definition.textures.color!.src,png);
  console.log('✓ Matched PBR maps, editable material pack, existing image conversion with identity/source/opacity and Undo preserved');
}finally{core.commitMaterialLayers();for(const state of states.values()){await state.canvas.dispose();state.textureEl.width=state.textureEl.height=0;}}
