import assert from 'node:assert/strict';
import {Canvas,Rect,Group,setEnv} from 'fabric';
import {getEnv} from 'fabric/node';
import {EditorCore} from '../src/editor/EditorCore';
setEnv(getEnv());const env=getEnv();Object.assign(globalThis,{document:env.document,window:env.window,HTMLElement:env.window.HTMLElement,HTMLImageElement:env.window.HTMLImageElement,HTMLCanvasElement:env.window.HTMLCanvasElement});
const canvas=new Canvas(undefined,{width:256,height:256,backgroundColor:'#102030',enableRetinaScaling:false,renderOnAddRemove:false});
const core=Object.create(EditorCore.prototype) as EditorCore,state={canvas,el:canvas.lowerCanvasEl,textureEl:document.createElement('canvas'),suspendHistory:false,textureDirty:true,baseline:'',undo:[] as string[],redo:[] as string[],coalesceKey:null};
Object.assign(core,{maps:new Map([['Details_B',state]]),activeMap:'Details_B',listeners:new Map(),illumToolRole:'always',speedLightColor:'#ffffff',projectionSources:new Map(),projectionBakes:new Map(),materialBakes:new Map(),materialSurfaces:[],materialInteractive:false,materialUpdateSequence:0,illumRoles:new Map(),importedRoleMasks:new WeakMap(),previewDirty:new Set(),previewUpdates:new Set(),flushTexture:()=>{},isPanning:()=>false});
try{
 const rect=new Rect({left:0,top:0,originX:'left',originY:'top',width:2048,height:2048,fill:'#ff4060',strokeWidth:0,objectCaching:false,clipPath:new Rect({left:0,top:0,originX:'left',originY:'top',width:64,height:128,strokeWidth:0})});
 // The clip is expressed in the editable object's local coordinates.
 rect.clipPath!.set({left:-1024+32,top:-1024+64,originX:'center',originY:'center'});
 const fragment=(core as unknown as {boundedUvFragment(o:Rect,b:{x:number;y:number;w:number;h:number},r:number):Group}).boundedUvFragment(rect,{x:0,y:0,w:.5,h:.5},256);
 canvas.add(fragment);canvas.renderAll();const before=canvas.getContext().getImageData(0,0,256,256).data.slice();
 assert((fragment as unknown as {_cacheCanvas:HTMLCanvasElement})._cacheCanvas.width<512,'A 2K source clipped to a tiny chart never allocates a 2K cache');
 canvas.setActiveObject(fragment);assert(await core.ungroupSelection());canvas.discardActiveObject();canvas.renderAll();const after=canvas.getContext().getImageData(0,0,256,256).data;
 assert.deepEqual(after,before,'Ungroup transfers chart clipping to its editable child');assert(canvas.getObjects()[0] instanceof Rect);
 console.log('✓ Bounded chart cache and single-fragment ungroup preserve every pixel and editable shape');
}finally{await canvas.dispose();}
