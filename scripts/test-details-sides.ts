import assert from 'node:assert/strict';
import { Canvas, FabricImage, Rect, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { EditorCore } from '../src/editor/EditorCore';
import { MAPS, type MapId } from '../src/maps';
import { INDEPENDENT_DETAILS, detailsWholeSide, splitDetailsPixels } from '../src/detailsSides';
import { createMaterialDefinition, isValidMaterialLayer, type MaterialLayer } from '../src/materials/types';
import { createTextureBackground, readTextureBackground, syncTextureBackgroundCanvas, updateTextureBackground } from '../src/editor/textureBackground';
import { createBaseSkinProject } from '../src/baseSkin';
import { hydrateProject, readProjectFile, validateProjectDocument, writeProjectFile } from '../src/projectFile';
import { buildSkinZipFromImages, importSkinZipFromBuffer, speedLightMask } from '../src/skinZip';
import { decodeDDS, type RGBAImage } from '../src/dds';
import JSZip from 'jszip';
import { imageIslandAt } from '../src/editor/imagePlacement';
import { createHeightSampler } from '../src/relief/heightSource';
import { canonicalDetailsMaterial } from '../src/detailsSides';

setEnv(getEnv());
const env=getEnv();
Object.assign(globalThis,{document:env.document,window:env.window,HTMLElement:env.window.HTMLElement,
  HTMLImageElement:env.window.HTMLImageElement,HTMLCanvasElement:env.window.HTMLCanvasElement});
type ImageLayer=FabricImage & {id:string;name?:string;mirrorOf?:string;materialLayer?:MaterialLayer;linkedImageId?:string};
const states=new Map(MAPS.map(def=>{
  const canvas=new Canvas(undefined,{width:def.workRes,height:def.workRes,backgroundColor:'#123456',renderOnAddRemove:false,enableRetinaScaling:false});
  const textureEl=document.createElement('canvas');textureEl.width=textureEl.height=1;
  return [def.id,{canvas,el:canvas.lowerCanvasEl,textureEl,suspendHistory:false,textureDirty:true,baseline:'',undo:[] as string[],redo:[] as string[],coalesceKey:null}];
}));
const core=Object.create(EditorCore.prototype) as EditorCore;
Object.assign(core,{maps:states,activeMap:'Details_B',tool:'select',symmetry:true,carAligned:true,
  blenderParts:[],listeners:new Map(),illumToolRole:'always',speedLightColor:'#ffffff',projectionSources:new Map(),projectionBakes:new Map(),
  materialBakes:new Map(),materialSurfaces:[],materialInteractive:false,materialUpdateSequence:0,textureResolution:1024,
  illumRoles:new Map(),importedRoleMasks:new WeakMap(),previewDirty:new Set(),previewUpdates:new Set(),
  flushTexture:()=>{},isPanning:()=>false,setActiveMap:(id:MapId)=>{core.activeMap=id;}});
const internals=core as unknown as {wireCanvas(id:MapId,state:unknown):void};
for(const def of MAPS)internals.wireCanvas(def.id,states.get(def.id)!);
const objects=(id:MapId)=>states.get(id)!.canvas.getObjects() as ImageLayer[];
const owners=()=>objects('Details_B').filter(o=>o.materialLayer);
const pixel=(id:MapId,x:number,y:number)=>{
  const canvas=states.get(id)!.canvas;canvas.renderAll();return [...canvas.getContext().getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data];
};
const source=document.createElement('canvas');source.width=80;source.height=40;
const ctx=source.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,40,40);ctx.fillStyle='#00ff00';ctx.fillRect(40,0,40,40);
const original=source.toDataURL('image/png');
const asBytes=async(blob:Blob)=>{
  if(blob.arrayBuffer)return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new env.window.FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);}));
};
try{
  const definition=createMaterialDefinition('solid');definition.color='#ffffff';definition.roughness=60;definition.metalness=100;
  definition.transform.mode='stretch';definition.textures.color={src:original,name:'Source.png',component:'luminance',invert:false};
  await core.addMaterialLayer(definition);
  const before=structuredClone(owners()[0].materialLayer!);
  for(const id of ['Details_R','Details_I','Details_DirtMask'] as const){
    const rectangle=new Rect({left:100,top:150,width:200,height:100,fill:'#abcdef',strokeWidth:0}) as Rect & {id:string;name:string;mirrorOf?:string};
    rectangle.id=`paint-${id}`;rectangle.name=`Dessin ${id}`;rectangle.mirrorOf='former-partner';states.get(id)!.canvas.add(rectangle);
  }
  states.get('Details_B')!.canvas.backgroundImage=createTextureBackground(await FabricImage.fromURL(original),2048,2048,'#123456',{name:'Fond.png',fit:'stretch',colorOpacity:0});
  const skinBefore=JSON.stringify(states.get('Skin_B')!.canvas.toObject());
  await core.splitDetailsSides();core.rebuildProjectionsForModel();
  assert.equal(owners().length,2);
  for(const side of ['left','right'] as const){
    const owner=owners().find(o=>o.materialLayer!.atlasSide===side)!;
    assert(owner);assert.equal(owner.mirrorOf,undefined);assert.deepEqual(owner.materialLayer!.definition,before.definition);
    assert.equal(owner.materialLayer!.regions[0].key,detailsWholeSide(side).key);
    assert(isValidMaterialLayer(owner.materialLayer));
    assert.match(core.getLayers().find(layer=>layer.id===owner.id)!.material!.name,side==='left'?/^Côté gauche/:/^Côté droit/);
    const height={width:2,height:2,bits:16 as const,values:new Float32Array([0,.25,.75,1])};
    const layer=structuredClone(owner.materialLayer!);layer.definition.textures.height={src:original,name:'Hauteur.png',component:'red',invert:false};
    const mask={width:2,height:2,data:new Uint8ClampedArray(16).fill(255)};
    const sample=createHeightSampler(height,layer,mask),legacy=createHeightSampler(height,canonicalDetailsMaterial(layer),mask);
    const offset=side==='left'?.5:0;
    for(const [u,v] of [[.2,.3],[.8,.7]])assert(Math.abs(sample(offset+u*.5,v)-legacy(u,v))<1e-6,'Numeric height samples keep the exact source frame');
    assert.equal(sample(side==='left'?.2:.8,.5),0);
  }
  assert.equal(new Set(owners().map(o=>o.id)).size,2);
  assert.equal(JSON.stringify(states.get('Skin_B')!.canvas.toObject()),skinBefore,'The body atlas stays untouched');
  assert.deepEqual(pixel('Details_B',.1,.5),[255,0,0,255]);assert.deepEqual(pixel('Details_B',.35,.5),[0,255,0,255]);
  assert.deepEqual(pixel('Details_B',.6,.5),[255,0,0,255]);assert.deepEqual(pixel('Details_B',.85,.5),[0,255,0,255]);
  for(const id of ['Details_R','Details_I','Details_DirtMask'] as const){
    const drawings=objects(id).filter(o=>o.name?.startsWith('Dessin'));
    assert.equal(drawings.length,2);assert(drawings.every(o=>!o.mirrorOf));
    assert.equal(Math.abs(drawings[0].left-drawings[1].left),1024);
    assert.equal(drawings[0].scaleX,.5);assert.equal(drawings[0].scaleY,1);
  }
  const background=readTextureBackground(states.get('Details_B')!.canvas)!;
  assert.equal(background.src,original);assert.equal(background.layout,INDEPENDENT_DETAILS);
  const right=owners().find(o=>o.materialLayer!.atlasSide==='right')!,left=owners().find(o=>o.materialLayer!.atlasSide==='left')!;
  core.selectLayer(left.id);
  const next=structuredClone(left.materialLayer!.definition);next.color='#0000ff';next.textures={};
  await core.setSelectionMaterialDefinition(next);core.commitMaterialLayers();
  assert.deepEqual(pixel('Details_B',.75,.5),[0,0,255,255]);assert.deepEqual(pixel('Details_B',.35,.5),[0,255,0,255]);
  core.setSelectionMaterialMask([],[]);assert.equal(owners().find(o=>o.id===left.id)!.materialLayer!.regions[0].key,'details:side:left','All remains constrained to its side');
  core.deleteLayer(left.id);assert(owners().some(o=>o.id===right.id),'Deleting a side with symmetry enabled keeps the other side');
  assert.deepEqual(pixel('Details_B',.6,.5),[255,0,0,255],'Removing the left material reveals the original left background');
  updateTextureBackground(states.get('Details_B')!.canvas,{fit:'contain'});syncTextureBackgroundCanvas(states.get('Details_B')!.canvas);
  const b=states.get('Details_B')!.canvas.backgroundImage! as import('fabric').Group;
  assert.equal(b.getObjects().length,3);assert.equal((b.item(0) as FabricImage).getSrc(),original);assert.equal((b.item(1) as FabricImage).getSrc(),original);
  assert.equal(b.item(1).left-b.item(0).left,1024);assert.equal(b.item(0).scaleX,b.item(1).scaleX);
  core.clearSelection();core.fillColor='#ff00ff';
  const count=objects('Details_B').length;
  const floor=core.getGuideIslands('details').find(i=>i.key==='d_floor:side:left')!;
  assert(floor.polygons.some(poly=>{const p=poly.reduce((a,p)=>({x:a.x+p.x/poly.length,y:a.y+p.y/poly.length}),{x:0,y:0});return imageIslandAt('details',p.x,1-p.y,INDEPENDENT_DETAILS)===floor.key;}),'3D UV picking resolves the new left floor');
  core.fillRegion({x:0,y:0,w:1,h:1,label:floor.label},floor.key);
  assert.equal(objects('Details_B').length,count+1,'A named side is filled once even with global symmetry enabled');
  assert(!core.getGuideIslands('details').some(i=>i.key==='d_floor'));
  const captured=await core.captureProject(),bundle=createBaseSkinProject({position:[3,2,4],target:[0,.5,0]});
  bundle.document.editor={maps:captured.maps,speedColor:captured.speedColor,illumRole:captured.illumRole};
  for(const [path,blob] of captured.assets)bundle.assets.set(path,await asBytes(blob));
  bundle.assets.set('assets/mesh.gbx',new Uint8Array([71,66,88,0]));
  bundle.document.model={name:'Test',mesh:'assets/mesh.gbx',preview:null,passthrough:[],detailsLayout:INDEPENDENT_DETAILS};
  for(const ref of JSON.stringify(bundle.document).matchAll(/assets\/[^"\\]+/g)) assert(bundle.assets.has(ref[0]),`Missing ${ref[0]} among ${[...bundle.assets.keys()]}`);
  const stored=await readProjectFile(await writeProjectFile(bundle)),hydrated=hydrateProject(stored);
  assert.equal(hydrated.model!.detailsLayout,INDEPENDENT_DETAILS);
  assert.equal((stored.document.editor.maps.Details_B.backgroundImage as {textureBackground:{layout:string}}).textureBackground.layout,INDEPENDENT_DETAILS);
  const bad=structuredClone(stored.document);(bad.model as {detailsLayout:string}).detailsLayout='unexpected';assert.throws(()=>validateProjectDocument(bad));
  const invalidLayer={...right.materialLayer,family:'skin'};assert(!isValidMaterialLayer(invalidLayer));
  const numeric:RGBAImage={width:4,height:1,data:new Uint8ClampedArray([10,20,30,255,30,40,50,255,90,100,110,255,110,120,130,255])};
  assert.deepEqual([...splitDetailsPixels(numeric).data],[20,30,40,255,100,110,120,255,20,30,40,255,100,110,120,255]);
  const images=Object.fromEntries(MAPS.map(m=>[m.id,{width:64,height:64,data:new Uint8ClampedArray(64*64*4)}])) as Record<MapId,RGBAImage>;
  const zipBlob=await buildSkinZipFromImages(images,{skinName:'Deux côtés',meshGbx:new Uint8Array([71,66,88,0]),previewGlb:new ArrayBuffer(4),detailsLayout:INDEPENDENT_DETAILS});
  const zipBytes=await zipBlob.arrayBuffer(),zip=await JSZip.loadAsync(zipBytes),imported=await importSkinZipFromBuffer(zipBytes);
  assert.equal(imported.skin3d!.detailsLayout,INDEPENDENT_DETAILS);assert(zip.file('preview.glb'));
  const illum=decodeDDS(await zip.file('Details_I.dds')!.async('arraybuffer')),mask=speedLightMask(64,64,INDEPENDENT_DETAILS);
  assert.equal(mask.some(Boolean),true);for(let i=0;i<mask.length;i++)if(mask[i])assert(illum.data[i*4]>200);
  console.log('✓ Dessous : calques/sources/PBR indépendants, symétrie désolidarisée, fonds recadrables, projet/ZIP réouvrables et feux remappés');
}finally{
  core.commitMaterialLayers();for(const state of states.values()){await state.canvas.dispose();state.textureEl.width=state.textureEl.height=0;}
}
