import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Canvas,FabricImage,Rect,setEnv} from 'fabric';
import {getEnv} from 'fabric/node';
import {embeddedGlbData} from '../src/blenderParts';
import {patchDetailsSidesMesh,patchDetailsSidesPreview,validateDetailsSidesManifest} from '../src/detailsSidesModel';
import {UNDERBODY_PANEL_LAYOUT,PANEL_SOURCE,panelPoint,insidePanel,PANEL_SCALE} from '../src/underbodyPanel';
import {EditorCore} from '../src/editor/EditorCore';
import {MAPS,type MapId} from '../src/maps';
import {createMaterialDefinition,isValidMaterialLayer,type MaterialLayer} from '../src/materials/types';
import {createTextureBackground,readTextureBackground,updateTextureBackground} from '../src/editor/textureBackground';
import {createBaseSkinProject} from '../src/baseSkin';
import {readProjectFile,writeProjectFile,hydrateProject} from '../src/projectFile';
import {buildSkinZipFromImages,importSkinZipFromBuffer} from '../src/skinZip';
import {type RGBAImage} from '../src/dds';

const bytes=async(path:string)=>new Uint8Array(await readFile(path));
const manifest=JSON.parse(await readFile('public/models/underbody-panel/manifest.json','utf8'));
const assets={manifest,bytes:await bytes('public/models/underbody-panel/patches.bin'),preview:await bytes('public/models/underbody-panel/details.glb')};
validateDetailsSidesManifest(manifest);assert.equal(manifest.layout,UNDERBODY_PANEL_LAYOUT);
let gameMesh:Uint8Array,gamePreview:ArrayBuffer;
for(const source of manifest.sources){
  const original=await bytes(`public/models/relief/${source.id.startsWith('dense-')?'dense/':''}${source.id.endsWith('normal')?'normal':'standard'}.Mesh.gbx`);
  const next=await patchDetailsSidesMesh(original,assets);
  assert.equal(createHash('sha256').update(next).digest('hex'),source.resultSha256);
  if(source.id==='standard')gameMesh=next;
}
for(const dense of [false,true]){
  const data=await bytes(`public/models/relief/${dense?'dense/':''}preview.glb`),original=embeddedGlbData(data.buffer),nextData=patchDetailsSidesPreview(data.buffer,assets.preview),next=embeddedGlbData(nextData);
  if(!dense)gamePreview=nextData;
  const reader=(document:typeof original,buffer:ArrayBuffer,index:number)=>{
    const a=document.gltf.accessors[index],b=document.gltf.bufferViews[a.bufferView],axes=a.type==='VEC3'?3:a.type==='VEC2'?2:1,view=new DataView(buffer,document.binStart+(b.byteOffset??0)+(a.byteOffset??0));
    return (i:number,c=0)=>a.componentType===5126?view.getFloat32(i*(b.byteStride??axes*4)+4*c,true):view.getUint32(i*4,true);
  };
  let left=0,right=0,other=0;
  for(const [i,mesh]of original.gltf.meshes.entries())for(const [j,p]of mesh.primitives.entries()){
    const q=next.gltf.meshes[i].primitives[j];
    if(!String(original.gltf.materials[p.material].name).endsWith('_Details')){assert.deepEqual(q,p);continue;}
    const oldIndex=reader(original,data.buffer,p.indices),newIndex=reader(next,nextData,q.indices),pos=reader(original,data.buffer,p.attributes.POSITION),newPos=reader(next,nextData,q.attributes.POSITION),uv=reader(original,data.buffer,p.attributes.TEXCOORD_0),newUV=reader(next,nextData,q.attributes.TEXCOORD_0);
    const count=original.gltf.accessors[p.indices].count;assert.equal(next.gltf.accessors[q.indices].count,count,'No extra physical floor or triangles');
    for(let t=0;t<count;t+=3){
      const ids=[oldIndex(t),oldIndex(t+1),oldIndex(t+2)],center={x:ids.reduce((s,i)=>s+uv(i),0)/3,y:1-ids.reduce((s,i)=>s+uv(i,1),0)/3};
      const panel=insidePanel(center.x,center.y),onRight=panel&&ids.reduce((s,i)=>s+pos(i),0)<0;
      if(panel){if(onRight)right++;else left++;}else other++;
      for(let c=0;c<3;c++){
        const a=ids[c],b=newIndex(t+c),expected=panelPoint({x:uv(a),y:1-uv(a,1)},onRight?'right':'base');
        for(let axis=0;axis<3;axis++)assert.equal(newPos(b,axis),pos(a,axis),'Every actual triangle keeps its original positions');
        assert(Math.abs(newUV(b)-expected.x)<1e-6&&Math.abs(1-newUV(b,1)-expected.y)<1e-6);
      }
    }
  }
  assert.equal(left,596);assert.equal(right,596);assert(other>59000,'All other Details stay in a single atlas');
}
console.log('✓ Panneau exact de la capture : 596 triangles par côté, aucun autre détail dédoublé, forme/triangles inchangés, quatre variantes natives');

setEnv(getEnv());const env=getEnv();
Object.assign(globalThis,{document:env.document,window:env.window,HTMLElement:env.window.HTMLElement,HTMLImageElement:env.window.HTMLImageElement,HTMLCanvasElement:env.window.HTMLCanvasElement});
type Layer=FabricImage&{id:string;name?:string;materialLayer?:MaterialLayer;linkedImageId?:string};
const states=new Map(MAPS.map(def=>{const canvas=new Canvas(undefined,{width:def.workRes,height:def.workRes,backgroundColor:'#123456',renderOnAddRemove:false,enableRetinaScaling:false});
  const textureEl=document.createElement('canvas');textureEl.width=textureEl.height=1;return [def.id,{canvas,el:canvas.lowerCanvasEl,textureEl,suspendHistory:false,textureDirty:true,baseline:'',undo:[] as string[],redo:[] as string[],coalesceKey:null}];}));
const core=Object.create(EditorCore.prototype) as EditorCore;
Object.assign(core,{maps:states,activeMap:'Details_B',tool:'select',symmetry:true,carAligned:true,blenderParts:[],listeners:new Map(),illumToolRole:'always',speedLightColor:'#ffffff',projectionSources:new Map(),projectionBakes:new Map(),materialBakes:new Map(),materialSurfaces:[],materialInteractive:false,materialUpdateSequence:0,textureResolution:1024,illumRoles:new Map(),importedRoleMasks:new WeakMap(),previewDirty:new Set(),previewUpdates:new Set(),flushTexture:()=>{},isPanning:()=>false,setActiveMap:(id:MapId)=>{core.activeMap=id;}});
for(const def of MAPS)(core as unknown as {wireCanvas(id:MapId,state:unknown):void}).wireCanvas(def.id,states.get(def.id)!);
const objects=(id:MapId)=>states.get(id)!.canvas.getObjects() as Layer[];
const pixel=(x:number,y:number)=>{const canvas=states.get('Details_B')!.canvas;canvas.renderAll();return [...canvas.getContext().getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data];};
const source=document.createElement('canvas');source.width=80;source.height=80;const ctx=source.getContext('2d')!;
ctx.fillStyle='#ff0000';ctx.fillRect(0,0,80,40);ctx.fillStyle='#00ff00';ctx.fillRect(0,40,80,40);const png=source.toDataURL('image/png');
const sample=Array.from({length:98},(_,y)=>Array.from({length:20},(_,x)=>({x:(x+1)/100,y:(y+1)/100}))).flat()
  .find(p=>[[0,0],[.005,0],[-.005,0],[0,.005],[0,-.005]].every(([x,y])=>insidePanel(p.x+x,p.y+y)))!;assert(sample);
try{
  const def=createMaterialDefinition();def.color='#ffffff';def.transform.mode='stretch';def.textures.color={src:png,name:'Original.png',component:'luminance',invert:false};await core.addMaterialLayer(def);
  const owner=objects('Details_B').find(o=>o.materialLayer)!;
  core.setSymmetry(false);core.fillColor='#3366ff';core.fillRegion({x:0,y:0,w:1,h:1,label:'DESSOUS · élément 1'},'d_floor:element:0');
  core.setSymmetry(true);
  const other=new Rect({left:1100,top:400,width:100,height:100,strokeWidth:0,fill:'#ffaa00'}) as Rect&{id:string;name:string};other.id='other-detail';other.name='Autre pièce';states.get('Details_B')!.canvas.add(other);
  states.get('Details_B')!.canvas.backgroundImage=createTextureBackground(await FabricImage.fromURL(png),2048,2048,'#123456',{name:'Original.png',fit:'stretch',colorOpacity:0});
  const before=pixel(sample.x,sample.y),body=JSON.stringify(states.get('Skin_B')!.canvas.toObject());
  await core.splitUnderbodyPanel();core.rebuildProjectionsForModel();
  assert.equal(objects('Details_B').filter(o=>o.materialLayer).length,2);
  assert(objects('Details_B').some(o=>o.name?.startsWith('Panneau inférieur gauche')));
  assert.equal(objects('Details_B').filter(o=>o.name?.includes('Autre pièce')).length,1,'Unrelated artwork is not duplicated');
  assert.equal(objects('Details_B').find(o=>o.id==='other-detail')!.scaleX,PANEL_SCALE);
  assert(objects('Details_B').some(o=>o.id===owner.id),'Source layer identity remains stable');
  assert.equal(JSON.stringify(states.get('Skin_B')!.canvas.toObject()),body);
  for(const placement of ['base','right'] as const){const p=panelPoint(sample,placement);assert.deepEqual(pixel(p.x,p.y),before,'Both panels keep the exact original drawing');}
  const right=objects('Details_B').find(o=>o.materialLayer?.atlasFrame?.placement==='right')!;
  assert(isValidMaterialLayer(right.materialLayer));assert.equal(right.materialLayer!.definition.textures.color!.src,png);
  const leftGuide=core.getGuideIslands('details').find(i=>i.key==='d_floor:panel:left')!,rightGuide=core.getGuideIslands('details').find(i=>i.key==='d_floor:panel:right')!;
  assert.equal(leftGuide.polygons[0].length,PANEL_SOURCE.length);assert.equal(rightGuide.polygons[0].length,PANEL_SOURCE.length);
  assert(!core.getGuideIslands('details').some(i=>i.key==='d_floor:side:left'));
  const count=objects('Details_B').length;core.fillColor='#ff00ff';core.fillRegion({x:0,y:0,w:1,h:1,label:leftGuide.label},leftGuide.key);
  core.fillColor='#00ffff';core.fillRegion({x:0,y:0,w:1,h:1,label:rightGuide.label},rightGuide.key);
  assert.equal(objects('Details_B').length,count+2,'Two explicit panels, no automatic symmetry');
  const leftPoint=panelPoint(sample,'base'),rightPoint=panelPoint(sample,'right');
  assert.deepEqual(pixel(leftPoint.x,leftPoint.y),[255,0,255,255]);assert.deepEqual(pixel(rightPoint.x,rightPoint.y),[0,255,255,255]);
  assert.equal(readTextureBackground(states.get('Details_B')!.canvas)!.src,png);
  updateTextureBackground(states.get('Details_B')!.canvas,{fit:'contain'});assert.equal(readTextureBackground(states.get('Details_B')!.canvas)!.layout,UNDERBODY_PANEL_LAYOUT);
  const content=await core.captureProject(),bundle=createBaseSkinProject({position:[3,2,4],target:[0,.5,0]});
  bundle.document.editor={maps:content.maps,speedColor:content.speedColor,illumRole:content.illumRole};
  for(const [path,blob]of content.assets){
    const array=blob.arrayBuffer?await blob.arrayBuffer():await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new env.window.FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});bundle.assets.set(path,new Uint8Array(array));
  }
  bundle.assets.set('assets/mesh.gbx',new Uint8Array([71,66,88,0]));bundle.document.model={name:'Panneau',mesh:'assets/mesh.gbx',preview:null,passthrough:[],detailsLayout:UNDERBODY_PANEL_LAYOUT};
  const saved=await readProjectFile(await writeProjectFile(bundle));assert.equal(hydrateProject(saved).model!.detailsLayout,UNDERBODY_PANEL_LAYOUT);
  const images={} as Record<MapId,RGBAImage>;
  for(const [id,state]of states){
    state.canvas.renderAll();const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    canvas.getContext('2d')!.drawImage(state.canvas.getElement(),0,0,512,512);images[id]={width:512,height:512,data:canvas.getContext('2d')!.getImageData(0,0,512,512).data};
  }
  const game=await buildSkinZipFromImages(images,{skinName:'Panneaux test',meshGbx:gameMesh!,previewGlb:gamePreview!,detailsLayout:UNDERBODY_PANEL_LAYOUT});
  const imported=await importSkinZipFromBuffer(await game.arrayBuffer());assert.equal(imported.skin3d!.detailsLayout,UNDERBODY_PANEL_LAYOUT);assert.equal(imported.failures.length,0);
  const color=imported.imported.find(entry=>entry.id==='Details_B')!.image;
  const rgb=(p:{x:number;y:number})=>[...color.data.slice((Math.floor(p.y*color.height)*color.width+Math.floor(p.x*color.width))*4,(Math.floor(p.y*color.height)*color.width+Math.floor(p.x*color.width))*4+3)];
  const l=rgb(leftPoint),r=rgb(rightPoint);assert(l[0]>200&&l[1]<40&&l[2]>200);assert(r[0]<40&&r[1]>200&&r[2]>200);
  assert(!isValidMaterialLayer({...right.materialLayer,atlasFrame:{placement:'right',reference:{x:0,y:0,w:NaN,h:1}}}));
  console.log('✓ Migration ciblée : autres pièces uniques, calques/sources/PBR conservés, deux couleurs indépendantes, fond recadrable, projet et ZIP réouvrables');
}finally{core.commitMaterialLayers();for(const state of states.values()){await state.canvas.dispose();state.textureEl.width=state.textureEl.height=0;}}
