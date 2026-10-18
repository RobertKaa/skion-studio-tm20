import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import type { EditorCore, Tool } from '../src/editor/EditorCore';
import type { UvGuideIsland } from '../src/uvGuideData';
import { buildUvAtlasLayout, atlasPoint } from '../src/uvAtlasLayout';
import { MAP_BY_ID } from '../src/maps';
registerHooks({load(url, context, next) { return url.endsWith('.css') ? {format:'module',source:'export {};',shortCircuit:true} : next(url,context); }});
setEnv(getEnv()); const desktop=getEnv().window;
Object.defineProperty(desktop,'innerWidth',{configurable:true,value:1400});Object.defineProperty(desktop,'innerHeight',{configurable:true,value:900});
Object.assign(globalThis,{React,window:desktop,document:desktop.document,HTMLElement:desktop.HTMLElement,HTMLInputElement:desktop.HTMLInputElement,HTMLCanvasElement:desktop.HTMLCanvasElement,IS_REACT_ACT_ENVIRONMENT:true,
  requestAnimationFrame:(fn:()=>void)=>desktop.setTimeout(fn,0),cancelAnimationFrame:(id:number)=>desktop.clearTimeout(id),
  ResizeObserver:class{callback:(entries:{contentRect:{width:number;height:number}}[])=>void;constructor(cb:(entries:{contentRect:{width:number;height:number}}[])=>void){this.callback=cb;}observe(){this.callback([{contentRect:{width:720,height:520}}]);}disconnect(){}}
});
desktop.HTMLElement.prototype.scrollTo=function(){};
desktop.SVGElement.prototype.setPointerCapture=function(){};
const {createRoot}=await import('react-dom/client'),{UvGlobalAtlas}=await import('../src/ui/UvGlobalAtlas');
const poly=[{x:.1,y:.2},{x:.3,y:.2},{x:.3,y:.8},{x:.1,y:.8}];
const islands:UvGuideIsland[]=[{key:'first',label:'ÉPAULE',family:'skin',polygons:[poly]},{key:'other',label:'AILERON',family:'skin',polygons:[poly.map(p=>({x:p.x+.4,y:p.y}))]}];
const source=document.createElement('canvas');source.width=source.height=32;source.getContext('2d')!.fillStyle='red';source.getContext('2d')!.fillRect(0,0,32,32);
let subscriber:(()=>void)|undefined;const began:unknown[][]=[],moved:number[][]=[],picked:string[]=[],selected:string[]=[],edited:string[]=[],sizes:number[]=[];let ended=0,original=0;
const editor={getCanvasElement:()=>source,on:(_event:string,cb:()=>void)=>{subscriber=cb;return()=>{subscriber=undefined;};},brushColor:'#ff0000',brushSize:18,
  paintBegin:(...args:unknown[])=>began.push(args),paintMove:(...args:number[])=>moved.push(args),paintEnd:()=>ended++,adjustBrushSize:(delta:number)=>sizes.push(delta),pickColorAt:()=> '#abcdef',pickHandler:(color:string)=>picked.push(color)} as unknown as EditorCore;
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
const render=async(tool:Tool='region',chosen='',data=islands,hidden=false)=>act(async()=>root.render(<UvGlobalAtlas editor={editor} activeMap="Skin_B" islands={data} selected={chosen} tool={tool} navigating={false} hidden={hidden} showGuide channelView="roughness" onSelect={p=>selected.push(p.id)} onEdit={p=>edited.push(p.id)} onOriginal={()=>original++}/>));
const fire=async(target:Element,type:string,x=0,y=0,button=0)=>act(async()=>{const event=new desktop.MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);});
const frame=()=>{const sheet=host.querySelector<HTMLElement>('.uv-atlas-sheet')!;sheet.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,width:400,height:400,right:400,bottom:400,toJSON:()=>{}});};
try {
  await render();assert.equal(host.querySelectorAll('[data-part]').length,2);assert.equal(host.querySelectorAll('.uv-part-tile').length,0,'One global texture sheet, not another thumbnail grid');
  assert(host.querySelector('.uv-global-atlas--roughness'));assert(subscriber);
  const path=host.querySelector<SVGPathElement>('[data-part]')!;
  await fire(path,'pointerdown');assert.equal(selected[0],'first:element:0');
  await render('region',selected[0]);assert.equal(host.querySelector('[aria-pressed="true"]')?.getAttribute('data-part'),'first:element:0');
  await act(async()=>host.querySelector<HTMLButtonElement>('.uv-atlas-footer button')!.click());assert.equal(edited[0],selected[0]);
  await fire(path,'dblclick');assert.equal(edited.length,2);
  const layout=buildUvAtlasLayout(islands),placement=layout.placements.find(p=>p.part.id===selected[0])!;
  const point=atlasPoint(placement,{x:.2,y:.5}),next=atlasPoint(placement,{x:.2,y:.6}),res=MAP_BY_ID.Skin_B.workRes;
  await render('draw');frame();
  await fire(path,'pointerdown',point.x*400,point.y*400);
  assert.equal(began.length,1);assert(Math.abs(Number(began[0][1])-.2*res)<1e-7&&Math.abs(Number(began[0][2])-.5*res)<1e-7,'Pointer maps back through the rotated placement');
  assert.equal((began[0][3] as {clipKey:string}).clipKey,'first:element:0');
  await fire(path,'pointermove',next.x*400,next.y*400);assert(Math.abs(moved[0][1]-.6*res)<1e-7);
  await fire(path,'pointerup');assert.equal(ended,1);
  const zoomText=()=>host.querySelector('.uv-atlas-zoom')!.textContent;
  const beforeWheel=zoomText();await act(async()=>host.querySelector('.uv-atlas-viewport')!.dispatchEvent(new desktop.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,ctrlKey:true})));
  assert.deepEqual(sizes,[2]);assert.equal(zoomText(),beforeWheel,'Ctrl+wheel changes brush size, not the hidden Fabric viewport or sheet zoom');
  await act(async()=>desktop.dispatchEvent(new desktop.KeyboardEvent('keydown',{code:'Space'})));const strokes=began.length;await fire(path,'pointerdown',point.x*400,point.y*400);await fire(path,'pointerup');assert.equal(began.length,strokes,'Space+drag is navigation even with the brush selected');await act(async()=>desktop.dispatchEvent(new desktop.KeyboardEvent('keyup',{code:'Space'})));
  await fire(path,'pointerdown',point.x*400,point.y*400);await render('eyedropper');assert.equal(ended,2,'Switching tools completes an active stroke once');frame();
  await fire(path,'pointerdown',point.x*400,point.y*400);assert.deepEqual(picked,['#abcdef']);
  const before=began.length;await fire(path,'pointerdown',point.x*400,point.y*400,1);await fire(path,'pointerup');assert.equal(began.length,before,'Middle-button navigation never paints');
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Agrandir la planche UV"]')!.click());const enlarged=zoomText();assert(enlarged?.includes('150'));
  await render('region','',islands,true);assert(host.querySelector('.uv-global-atlas')!.hasAttribute('hidden'));await render('region');assert.equal(zoomText(),enlarged,'Returning from detailed editing preserves the global framing');
  await act(async()=>{subscriber?.();await new Promise(resolve=>desktop.setTimeout(resolve,10));});
  await render('region','',[{...islands[0],polygons:[poly.map(p=>({...p,x:NaN}))]}]);assert(host.querySelector('[role="status"]')?.textContent?.includes('complexes'));
  await act(async()=>host.querySelector<HTMLButtonElement>('.uv-atlas-empty button')!.click());assert.equal(original,1);
  console.log('✓ Desktop global UV UI: real sheet, selection/detail edit, mapped brush/pipette, gesture cleanup and bounded-error fallback');
}finally{await act(async()=>root.unmount());host.remove();assert.equal(subscriber,undefined);}
