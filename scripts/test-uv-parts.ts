import assert from 'node:assert/strict';
import {setEnv} from 'fabric';
import {getEnv} from 'fabric/node';
import {organizedUvParts,uvPartFrame,drawUvPart,uvSearchText} from '../src/uvParts';
import {paintIslandsForModel,blenderPartsFromGlb} from '../src/blenderParts';
import {readFileSync} from 'node:fs';
import {UNDERBODY_PANEL_LAYOUT} from '../src/underbodyPanel';
import {UV_GUIDE_BY_FAMILY,type UvGuideIsland} from '../src/uvGuideData';
const square=(x:number,y:number,w:number,h=w)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
for(const family of ['skin','details','wheels'] as const){
  const islands=paintIslandsForModel(undefined,family),before=JSON.stringify(islands),entries=organizedUvParts(islands);
  assert(entries.length>0);assert.equal(new Set(entries.map(p=>p.id)).size,entries.length);
  for(const p of entries){assert.equal(p.parent.polygons[p.element],p.region.polygons[0]);const frame=uvPartFrame(p.bounds,256,176);assert(frame.scale>0&&Number.isFinite(frame.scale));
    assert(Math.abs((p.bounds.w*frame.scale)/(p.bounds.h*frame.scale)-p.bounds.w/p.bounds.h)<1e-8,'Every tile retains the UV proportions');}
  assert.equal(JSON.stringify(islands),before,'Organization never changes model or atlas coordinates');
}
const panels=organizedUvParts(paintIslandsForModel(undefined,'details',UNDERBODY_PANEL_LAYOUT));assert(panels.some(p=>p.parent.key==='d_floor:panel:left'));assert(panels.some(p=>p.parent.key==='d_floor:panel:right'));
const prepared=readFileSync('public/models/relief/preview.glb'),nativeParts=blenderPartsFromGlb(prepared.buffer.slice(prepared.byteOffset,prepared.byteOffset+prepared.byteLength));
assert.deepEqual(paintIslandsForModel(nativeParts,'wheels').map(p=>p.key),['tyres:tread','tyres:outer','tyres:inner'],'Prepared relief previews use the same official tyre atlas');
assert.deepEqual(paintIslandsForModel(nativeParts,'wheels',UNDERBODY_PANEL_LAYOUT).map(p=>p.key),['tyres:tread','tyres:outer','tyres:inner']);
const hole:UvGuideIsland={key:'test',label:'Épaule',family:'skin',fillRule:'evenodd',polygons:[square(.1,.1,.6),square(.25,.25,.2),square(.8,.8,.1)]};
const entries=organizedUvParts([hole]);assert.deepEqual(entries.map(p=>p.element),[0,2]);assert.equal(entries[0].region.polygons.length,2,'A hole stays inside its surrounding contour');
assert.equal(uvSearchText('ÉPAULE  GAUCHE'),'epaule  gauche');
assert.throws(()=>organizedUvParts([{...hole,polygons:Array.from({length:1800},()=>square(.1,.1,.3))}]),/complexes/,'Bound malicious contour nesting before any canvas work');
assert.equal(organizedUvParts(UV_GUIDE_BY_FAMILY.details).length,UV_GUIDE_BY_FAMILY.details.reduce((s,i)=>s+i.polygons.length,0),'Every stock Details element is listed');
setEnv(getEnv());const doc=getEnv().document,source=doc.createElement('canvas');source.width=source.height=100;
source.getContext('2d')!.fillStyle='#da6c24';source.getContext('2d')!.fillRect(0,0,100,100);
const canvas=doc.createElement('canvas');canvas.width=canvas.height=200;drawUvPart(canvas.getContext('2d')!,source,entries[0]);
const frame=uvPartFrame(entries[0].bounds,200,200),at=(x:number,y:number)=>canvas.getContext('2d')!.getImageData(Math.round(x*frame.scale+frame.x),Math.round(y*frame.scale+frame.y),1,1).data;
assert(at(.2,.2)[3]>250);assert.equal(at(.3,.3)[3],0,'Thumbnail clipping keeps holes transparent');
console.log('✓ All families/elements organized without UV mutation, stable IDs, unchanged proportions, holes and bounded contour complexity');
