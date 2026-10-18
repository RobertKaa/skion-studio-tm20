import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import React,{act} from 'react';
import {getEnv} from 'fabric/node';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,context);}});
const desktop=getEnv().window;
Object.assign(globalThis,{React,window:desktop,document:desktop.document,HTMLElement:desktop.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=await import('react-dom/client');
const {DetailsSidesControl}=await import('../src/ui/DetailsSidesControl');
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
const selected:string[]=[];let copies=0;
const render=async(enabled=false,disabled=false)=>act(async()=>root.render(<DetailsSidesControl layout={enabled?'underbody-panel-v1':undefined}
  selected="left" disabled={disabled} onSeparate={()=>copies++} onSelect={side=>selected.push(side)}/>));
try{
  await render();assert.match(host.textContent!,/Dessous · Élément 1/);assert.match(host.textContent!,/projet initial est conservé/);
  await act(async()=>host.querySelector('button')!.click());assert.equal(copies,1);
  await render(true);const buttons=[...host.querySelectorAll('button')];
  assert.deepEqual(buttons.map(b=>b.textContent),['Panneau gauche','Panneau droit']);
  assert.equal(buttons[0].getAttribute('aria-pressed'),'true');assert.equal(buttons[1].getAttribute('aria-pressed'),'false');
  await act(async()=>buttons[1].click());assert.deepEqual(selected,['right']);
  await render(true,true);await act(async()=>host.querySelectorAll('button')[0].click());assert.deepEqual(selected,['right']);
  console.log('✓ Contrôle desktop : copie explicite, noms des deux côtés, sélection accessible et blocage pendant la conversion');
}finally{await act(async()=>root.unmount());host.remove();}
