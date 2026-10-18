import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Canvas,FabricImage,Rect,IText,Group,setEnv} from 'fabric';
import {getEnv} from 'fabric/node';
import {EditorCore} from '../src/editor/EditorCore';
import {MAPS,type MapId} from '../src/maps';
import {realAtlasLayout,transferAtlasCanvas,REAL_UV_ATLAS} from '../src/realUvAtlas';
import {atlasPoint} from '../src/uvAtlasLayout';
import {createTextureBackground,readTextureBackground,updateTextureBackground} from '../src/editor/textureBackground';
import {createMaterialDefinition,type MaterialLayer} from '../src/materials/types';
import {renderMaterialLayer} from '../src/materials/render';
import {createBaseSkinProject} from '../src/baseSkin';
import {readProjectFile,writeProjectFile,hydrateProject} from '../src/projectFile';
import {buildSkinZipFromImages,importSkinZipFromBuffer} from '../src/skinZip';
import type {RGBAImage} from '../src/dds';
setEnv(getEnv());const env=getEnv();Object.assign(globalThis,{document:env.document,window:env.window,HTMLElement:env.window.HTMLElement,HTMLImageElement:env.window.HTMLImageElement,HTMLCanvasElement:env.window.HTMLCanvasElement});
const states=new Map(MAPS.map(def=>{const canvas=new Canvas(undefined,{width:def.workRes,height:def.workRes,backgroundColor:'#123456',renderOnAddRemove:false,enableRetinaScaling:false}),textureEl=document.createElement('canvas');textureEl.width=textureEl.height=1;return[def.id,{canvas,el:canvas.lowerCanvasEl,textureEl,suspendHistory:false,textureDirty:true,baseline:'',undo:[] as string[],redo:[] as string[],coalesceKey:null}];}));
const core=Object.create(EditorCore.prototype) as EditorCore;
Object.assign(core,{maps:states,activeMap:'Details_B',tool:'select',symmetry:false,carAligned:true,blenderParts:[],listeners:new Map(),illumToolRole:'always',speedLightColor:'#ffffff',projectionSources:new Map(),projectionBakes:new Map(),materialBakes:new Map(),materialSurfaces:[],materialInteractive:false,materialUpdateSequence:0,textureResolution:1024,illumRoles:new Map(),importedRoleMasks:new WeakMap(),previewDirty:new Set(),previewUpdates:new Set(),flushTexture:()=>{},isPanning:()=>false,setActiveMap:(id:MapId)=>{core.activeMap=id;}});
for(const def of MAPS)(core as unknown as {wireCanvas(id:MapId,state:unknown):void}).wireCanvas(def.id,states.get(def.id)!);
type Owner=FabricImage&{id:string;name:string;materialLayer?:MaterialLayer};
const source=document.createElement('canvas');source.width=source.height=256;const ctx=source.getContext('2d')!,image=ctx.createImageData(256,256);
for(let y=0;y<256;y++)for(let x=0;x<256;x++)image.data.set([x,y,64,255],(y*256+x)*4);ctx.putImageData(image,0,0);const png=source.toDataURL('image/png');
const sample=(canvas:HTMLCanvasElement,p:{x:number;y:number})=>[...canvas.getContext('2d')!.getImageData(Math.floor(p.x*canvas.width),Math.floor(p.y*canvas.height),1,1).data];
try{
 for(const family of ['skin','details','wheels'] as const){const layout=realAtlasLayout(family);assert(layout.placements.length>2);for(const p of layout.placements){assert.equal(p.matrix[1],0);assert.equal(p.matrix[2],0);assert.equal(p.matrix[0],p.matrix[3],'No image stretching');}
  const target=transferAtlasCanvas(source,family,'stock'),back=transferAtlasCanvas(target,family,'stock',true);
  for(const p of layout.placements.slice(0,12)){const q={x:p.part.bounds.x+p.part.bounds.w*.43,y:p.part.bounds.y+p.part.bounds.h*.43},a=sample(source,q),b=sample(target,atlasPoint(p,q));assert(Math.abs(a[0]-b[0])<6&&Math.abs(a[1]-b[1])<6,'Chart transfer matches moved native UV');}target.width=target.height=back.width=back.height=1;
 }
 const canvas=states.get('Details_B')!.canvas,res=canvas.width;
 canvas.backgroundImage=createTextureBackground(await FabricImage.fromURL(png),res,res,'#123456',{name:'Source.png',fit:'stretch',colorOpacity:0});
 const rect=new Rect({left:0,top:0,width:res,height:res,fill:'#00eedd',strokeWidth:0,opacity:.5}) as Rect&{id:string;name:string};rect.id='drawing';rect.name='Dessin éditable';canvas.add(rect);
 const text=new IText('UV',{left:20,top:20,fontSize:70}) as IText&{id:string};text.id='text';canvas.add(text);
 const first=realAtlasLayout('details').placements[0],center={x:(first.part.bounds.x+first.part.bounds.w/2)*res,y:(first.part.bounds.y+first.part.bounds.h/2)*res};
 canvas.add(new Rect({originX:'left',originY:'top',left:center.x-15,top:center.y-15,width:30,height:30,fill:'#ff4455',strokeWidth:0,clipPath:new Rect({originX:'left',originY:'top',left:center.x-15,top:center.y-15,width:15,height:30,absolutePositioned:true,strokeWidth:0})}));
 const def=createMaterialDefinition();def.preset='solid';def.color='#abcdee';const layer:MaterialLayer={definition:def,family:'skin',regions:[],exclusions:[]};
 const material=new FabricImage(document.createElement('canvas')) as Owner;material.id='material';material.name='Matériau';material.materialLayer=layer;states.get('Skin_B')!.canvas.add(material);
 const before=canvas.toCanvasElement();console.log('Migrating editable layers');await core.reorganizeUvAtlas();console.log('Migrated');
 assert.equal(core.getGuideIslands('details').length,realAtlasLayout('details').groups.length);
 const group=canvas.getObjects().find(o=>(o as Owner).id==='drawing');assert(group instanceof Group);assert(group.getObjects().every(o=>o instanceof Group&&o.getObjects()[0] instanceof Rect),'Editable vectors with bounded chart caches, no flattening');
 assert(canvas.getObjects().some(o=>o instanceof IText||o instanceof Group&&o.getObjects().some(c=>c instanceof IText||c instanceof Group&&c.getObjects()[0] instanceof IText)),'Text remains text');
 assert.equal((states.get('Skin_B')!.canvas.getObjects().find(o=>(o as Owner).id==='material') as Owner).materialLayer!.nativeAtlas,'stock');
 assert.equal(readTextureBackground(canvas)!.src,png,'Original background source retained');
 assert.equal(readTextureBackground(canvas)!.uvAtlas!.family,'details');canvas.renderAll();
 for(const p of realAtlasLayout('details').placements.slice(0,12)){const q={x:p.part.bounds.x+p.part.bounds.w*.43,y:p.part.bounds.y+p.part.bounds.h*.43},a=sample(before,q),b=sample(canvas.getElement(),atlasPoint(p,q));assert(a.every((v,i)=>Math.abs(v-b[i])<5),`Editable/background chart transfer ${p.part.id}: ${a} / ${b}`);}
 for(const dx of [-7,7]){const q={x:(center.x+dx)/res,y:center.y/res},a=sample(before,q),b=sample(canvas.getElement(),atlasPoint(first,q));assert(a.every((v,i)=>Math.abs(v-b[i])<5),`Absolute clip ${dx}: ${a} / ${b}`);}
 canvas.setActiveObject(group);assert(await core.ungroupSelection());canvas.renderAll();
 for(const p of realAtlasLayout('details').placements.slice(0,8)){const q={x:p.part.bounds.x+p.part.bounds.w*.43,y:p.part.bounds.y+p.part.bounds.h*.43},a=sample(before,q),b=sample(canvas.getElement(),atlasPoint(p,q));assert(a.every((v,i)=>Math.abs(v-b[i])<5),'Ungroup retains fragment transforms and clipping');}
 updateTextureBackground(canvas,{fit:'contain'});assert.equal(readTextureBackground(canvas)!.src,png,'Fit remains editable');
 const rendered=renderMaterialLayer({...layer,nativeAtlas:'stock'},128,[]);assert(rendered.get('color'));for(const c of rendered.values())c.width=c.height=1;
 const content=await core.captureProject(),bundle=createBaseSkinProject({position:[3,2,4],target:[0,.5,0]});bundle.document.editor={maps:content.maps,speedColor:content.speedColor,illumRole:content.illumRole};
 for(const [path,blob]of content.assets){const data=blob.arrayBuffer?await blob.arrayBuffer():await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new env.window.FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});bundle.assets.set(path,new Uint8Array(data));}
 bundle.assets.set('assets/mesh.gbx',new Uint8Array([71,66,88,0]));bundle.document.model={name:'UV réels',mesh:'assets/mesh.gbx',preview:null,passthrough:[],uvAtlas:REAL_UV_ATLAS};
 const saved=await readProjectFile(await writeProjectFile(bundle));assert.equal(hydrateProject(saved).model!.uvAtlas,REAL_UV_ATLAS);
 const images={} as Record<MapId,RGBAImage>;for(const [id,state]of states){state.canvas.renderAll();const c=document.createElement('canvas');c.width=c.height=256;c.getContext('2d')!.drawImage(state.canvas.getElement(),0,0,256,256);images[id]={width:256,height:256,data:c.getContext('2d')!.getImageData(0,0,256,256).data};}
 const mesh=new Uint8Array(await readFile('work/uv-atlas/verified/stock-base-standard.Mesh.gbx')),preview=await readFile('work/uv-atlas/verified/stock-base.glb');
 const zip=await buildSkinZipFromImages(images,{skinName:'UV réels',meshGbx:mesh,previewGlb:preview.buffer.slice(preview.byteOffset,preview.byteOffset+preview.byteLength),uvAtlas:REAL_UV_ATLAS});
 const imported=await importSkinZipFromBuffer(await zip.arrayBuffer());assert.equal(imported.failures.length,0);assert.equal(imported.skin3d!.uvAtlas,REAL_UV_ATLAS);assert.deepEqual(imported.skin3d!.mesh,mesh);
 const editPoint={x:first.part.bounds.x+first.part.bounds.w*.43,y:first.part.bounds.y+first.part.bounds.h*.43},organizedPoint=atlasPoint(first,editPoint);
 const afterEdit=new Rect({originX:'center',originY:'center',left:organizedPoint.x*res,top:organizedPoint.y*res,width:12,height:12,fill:'#f5359b',strokeWidth:0}) as Rect&{id:string};afterEdit.id='new-edit';canvas.add(afterEdit);canvas.renderAll();
 const edited=sample(canvas.getElement(),organizedPoint);
 const newMaterial=new FabricImage(document.createElement('canvas')) as Owner;newMaterial.id='new-material';newMaterial.name='Nouveau matériau';newMaterial.materialLayer={...structuredClone(layer),definition:{...def,color:'#ff11aa'}};states.get('Skin_B')!.canvas.add(newMaterial);
 console.log('Returning to original UVs with subsequent edits');await core.restoreUvAtlas();canvas.renderAll();
 assert.equal(readTextureBackground(canvas)!.uvAtlas,undefined,'Native background source/fit restored without a baked replacement');
 assert.equal(readTextureBackground(canvas)!.fit,'contain');assert.equal(readTextureBackground(canvas)!.src,png);
 assert.equal((states.get('Skin_B')!.canvas.getObjects().find(o=>(o as Owner).id==='material') as Owner).materialLayer!.nativeAtlas,undefined);
 const migratedNew=(states.get('Skin_B')!.canvas.getObjects().find(o=>(o as Owner).id==='new-material') as Owner).materialLayer!;
 assert.equal(migratedNew.organizedAtlas,'stock','Materials added after repacking remain editable in their authoring frame');assert.equal(migratedNew.definition.color,'#ff11aa');
 const restoredPixel=sample(canvas.getElement(),editPoint);assert(edited.every((v,i)=>Math.abs(v-restoredPixel[i])<8),`New artwork survives return: ${edited} / ${restoredPixel}`);
 assert(canvas.getObjects().some(o=>(o as Owner).id==='new-edit'),'New editable layer identity retained');
 const nativeContent=await core.captureProject();assert(!JSON.stringify(nativeContent.maps).includes('"nativeAtlas":"stock"'),'Restored original material no longer needs forward mapping');
 await core.reorganizeUvAtlas();canvas.renderAll();const repeated=sample(canvas.getElement(),organizedPoint);assert(edited.every((v,i)=>Math.abs(v-repeated[i])<8),`A second forward conversion retains edits: ${edited} / ${repeated}`);
 assert.equal((states.get('Skin_B')!.canvas.getObjects().find(o=>(o as Owner).id==='new-material') as Owner).materialLayer!.organizedAtlas,undefined,'Opposite material mappings cancel on roundtrip');
 console.log('✓ Real atlas pixel transfer, editable vectors/text, live materials, original background/fit, project and game ZIP roundtrip');
}finally{core.commitMaterialLayers();for(const state of states.values())await state.canvas.dispose();}
