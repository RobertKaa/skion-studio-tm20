import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import React,{act} from 'react';
import {setEnv} from 'fabric';
import {getEnv} from 'fabric/node';
import type {EditorCore} from '../src/editor/EditorCore';
import type {UvPartEntry} from '../src/uvParts';
import type {UvGuideIsland} from '../src/uvGuideData';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,context);}});
setEnv(getEnv());const desktop=getEnv().window;
Object.defineProperty(desktop,'innerWidth',{configurable:true,value:1400});Object.defineProperty(desktop,'innerHeight',{configurable:true,value:900});
Object.assign(globalThis,{React,window:desktop,document:desktop.document,HTMLElement:desktop.HTMLElement,HTMLInputElement:desktop.HTMLInputElement,HTMLCanvasElement:desktop.HTMLCanvasElement,IS_REACT_ACT_ENVIRONMENT:true,
  requestAnimationFrame:(fn:()=>void)=>desktop.setTimeout(fn,0),cancelAnimationFrame:(id:number)=>desktop.clearTimeout(id),
  IntersectionObserver:class{callback:(entries:{isIntersecting:boolean}[])=>void;constructor(cb:(entries:{isIntersecting:boolean}[])=>void){this.callback=cb;}observe(){this.callback([{isIntersecting:true}]);}disconnect(){}}
});
const {createRoot}=await import('react-dom/client');const {UvPartsBoard}=await import('../src/ui/UvPartsBoard');
const square=(x:number,w:number)=>[{x,y:.1},{x:x+w,y:.1},{x:x+w,y:.1+w},{x,y:.1+w}];
const islands:UvGuideIsland[]=[{key:'test',label:'ÉPAULE',family:'skin',polygons:[square(.05,.1),square(.4,.4)]},{key:'other',label:'DESSOUS',family:'skin',polygons:[square(.1,.2)]}];
const source=document.createElement('canvas');source.width=source.height=32;source.getContext('2d')!.fillStyle='red';source.getContext('2d')!.fillRect(0,0,32,32);
let subscriber:(()=>void)|undefined;const editor={getCanvasElement:()=>source,materialGeometry:()=>[],on:(_name:string,handler:()=>void)=>{subscriber=handler;return()=>{subscriber=undefined;};}} as unknown as EditorCore;
const chosen:UvPartEntry[]=[],edited:UvPartEntry[]=[],focused:UvGuideIsland[]=[];const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
const render=async(selected='')=>act(async()=>root.render(<UvPartsBoard editor={editor} activeMap="Skin_B" islands={islands} selected={selected} onSelect={p=>chosen.push(p)} onEdit={p=>edited.push(p)} onFocus={p=>focused.push(p)}/>));
try{
 await render();assert(host.textContent?.includes('3 éléments'));assert.equal(host.querySelectorAll('.uv-part-tile').length,2,'The overview groups the separate elements by piece');
 const overview=host.querySelector<HTMLButtonElement>('[aria-label="Ouvrir ÉPAULE · 2 éléments"]')!;assert(overview);await act(async()=>overview.click());
 assert.equal(focused[0],islands[0],'Opening a named piece also frames its actual 3D surface');
 const buttons=[...host.querySelectorAll<HTMLButtonElement>('.uv-part-tile')];assert.equal(buttons.length,2);
 assert.match(buttons[0].getAttribute('aria-label')!,/élément 2/,'Largest first while the source polygon index is retained');
 await act(async()=>buttons[0].click());assert.equal(chosen[0].id,'test:element:1');
 await render(chosen[0].id);assert.equal(host.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label'),'Sélectionner ÉPAULE · élément 2');
 await act(async()=>host.querySelector<HTMLButtonElement>('.uv-parts-tools button')!.click());assert.equal(edited[0].id,'test:element:1');
 const input=host.querySelector('input')!;await act(async()=>{Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype,'value')!.set!.call(input,'epaule');input.dispatchEvent(new desktop.Event('input',{bubbles:true}));});
 assert.equal(host.querySelectorAll('.uv-part-tile').length,2,'Search ignores accents');
 await act(async()=>{Object.getOwnPropertyDescriptor(desktop.HTMLInputElement.prototype,'value')!.set!.call(input,'introuvable');input.dispatchEvent(new desktop.Event('input',{bubbles:true}));});
 assert(host.querySelector('[role="status"]')?.textContent?.includes('Aucune pièce'));
 await act(async()=>{subscriber?.();await new Promise(resolve=>desktop.setTimeout(resolve,10));});
 assert.equal(JSON.stringify(islands[0].polygons[0]),JSON.stringify(square(.05,.1)));
 console.log('✓ Desktop pieces UI: stable selection, search, empty state, edit action and live texture subscription');
}finally{await act(async()=>root.unmount());host.remove();assert.equal(subscriber,undefined);}
