import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React, { act } from 'react';
import { setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,context);}});
setEnv(getEnv());const desktop=getEnv().window;
Object.defineProperty(desktop,'innerWidth',{configurable:true,value:1400});Object.defineProperty(desktop,'innerHeight',{configurable:true,value:900});
Object.assign(globalThis,{React,document:desktop.document,window:desktop,HTMLElement:desktop.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=await import('react-dom/client'),{UvFocusNotice}=await import('../src/ui/UvFocusNotice');
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const isolated:boolean[]=[];let next=0,cleared=0;
const render=async(value=false,occurrences=4)=>act(async()=>root.render(<UvFocusNotice compact focus={{label:'Pneu · flanc intérieur',isolated:value,occurrence:1,occurrences}} onIsolate={v=>isolated.push(v)} onNext={()=>next++} onClear={()=>cleared++}/>));
try{
 await render();assert(host.querySelector('[role="status"]')?.textContent?.includes('Pneu · flanc intérieur'));assert(host.textContent?.includes('2/4'));
 const buttons=()=>[...host.querySelectorAll<HTMLButtonElement>('button')];await act(async()=>buttons()[0].click());assert.deepEqual(isolated,[true]);
 await render(true);assert.equal(buttons()[0].getAttribute('aria-pressed'),'true');assert(buttons()[0].textContent?.includes('Voir le contexte'));assert(host.textContent?.includes('Vue isolée'));
 await act(async()=>buttons()[0].click());assert.deepEqual(isolated,[true,false]);await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Voir une autre occurrence de ces UV"]')!.click());assert.equal(next,1);
 await act(async()=>buttons().at(-1)!.click());assert.equal(cleared,1);await render(false,1);assert(!host.querySelector('[aria-label="Voir une autre occurrence de ces UV"]'));
 console.log('✓ Desktop focus notice: isolation/context, shared occurrences, restore action and accessible state');
}finally{await act(async()=>root.unmount());host.remove();}
