import assert from 'node:assert/strict';
import { setEnv, Canvas, type FabricObject } from 'fabric';
import { getEnv } from 'fabric/node';
import { buildUvAtlasLayout, atlasPoint, sourceUvPoint, drawUvAtlas } from '../src/uvAtlasLayout';
import { paintIslandsForModel, uvRegionAt } from '../src/blenderParts';
import { UNDERBODY_PANEL_LAYOUT } from '../src/underbodyPanel';
import type { UvGuideIsland } from '../src/uvGuideData';
import { EditorCore } from '../src/editor/EditorCore';
import { MAPS, MAP_BY_ID, type MapId } from '../src/maps';

for (const [family, details] of [['skin', undefined], ['details', undefined], ['details', UNDERBODY_PANEL_LAYOUT], ['wheels', undefined]] as const) {
  const islands = paintIslandsForModel(undefined, family, details), before = JSON.stringify(islands);
  const layout = buildUvAtlasLayout(islands); assert(layout.placements.length > 0);
  assert.equal(JSON.stringify(layout), JSON.stringify(buildUvAtlasLayout(islands)), 'Stable placements between channels and reloads');
  let moved = 0;
  for (const [i, p] of layout.placements.entries()) {
    const b = p.bounds; assert(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0000001 && b.y + b.h <= 1.0000001);
    const [a, bb, c, d] = p.matrix;
    assert(Math.abs(a * c + bb * d) < 1e-10); assert(Math.abs(Math.hypot(a, bb) - Math.hypot(c, d)) < 1e-10, 'No aspect distortion');
    const pt = p.part.region.polygons[0][0], at = atlasPoint(p, pt), back = sourceUvPoint(p, at);
    assert(Math.hypot(back.x - pt.x, back.y - pt.y) < 1e-10, 'Exact reverse coordinate mapping');
    if (Math.hypot(at.x - pt.x, at.y - pt.y) > .01) moved++;
    for (const q of layout.placements.slice(i + 1)) {
      const r = q.bounds;
      assert(b.x + b.w <= r.x + 1e-9 || r.x + r.w <= b.x + 1e-9 || b.y + b.h <= r.y + 1e-9 || r.y + r.h <= b.y + 1e-9, 'No overlapping elements in the new global sheet');
    }
  }
  assert(moved >= layout.placements.length * .8, 'Texture elements really change position');
  assert.equal(JSON.stringify(islands), before, 'Native geometry/UV guides are unchanged');
  console.log(`✓ Global ${family}${details ? ' independent panel' : ''}: ${layout.placements.length} shapes, no overlaps, exact inverse and preserved aspect`);
}

setEnv(getEnv()); const env = getEnv();
Object.assign(globalThis, { document: env.document, window: env.window, HTMLElement: env.window.HTMLElement, HTMLImageElement: env.window.HTMLImageElement, HTMLCanvasElement: env.window.HTMLCanvasElement });
const square = (x: number, y: number, w: number, h = w) => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const island: UvGuideIsland = {key:'blender:test',label:'Avec un trou',family:'skin',fillRule:'evenodd',polygons:[square(.1,.1,.25,.7),square(.17,.3,.08),square(.7,.3,.2)]};
const layout = buildUvAtlasLayout([island]); const p = layout.placements.find(p => p.part.element === 0)!;
assert.equal(p.matrix[0], 0, 'Long upright element rotates on the sheet without stretching');
const source = document.createElement('canvas'); source.width = source.height = 512;
const sourceCtx=source.getContext('2d')!, data=sourceCtx.createImageData(512,512);
for(let y=0;y<512;y++)for(let x=0;x<512;x++)data.data.set([Math.round(x/2),Math.round(y/2),80,255],(y*512+x)*4);sourceCtx.putImageData(data,0,0);
const output=document.createElement('canvas');output.width=output.height=2048;drawUvAtlas(output.getContext('2d')!,source,layout);
const sample=(u:number,v:number)=>{const pos=atlasPoint(p,{x:u,y:v});return output.getContext('2d')!.getImageData(Math.round(pos.x*2048),Math.round(pos.y*2048),1,1).data;};
assert.equal(sample(.2,.33)[3],0,'Holes stay transparent after repacking');
const color=sample(.25,.6);assert(Math.abs(color[0]-64)<=2&&Math.abs(color[1]-154)<=2&&color[3]>250,'Actual source texture pixels follow the rotated UV element');
assert.throws(()=>buildUvAtlasLayout([{...island,polygons:[square(NaN,0,1)]}]),/complexes/);
assert.throws(()=>buildUvAtlasLayout([{...island,polygons:[square(1e8,0,1)]}]),/complexes/);

// A stroke on the reorganized sheet must remain editable and clipped in native UV.
const states = new Map(MAPS.map(m=>{const canvas=new Canvas(undefined,{width:m.workRes,height:m.workRes,backgroundColor:'#123456',renderOnAddRemove:false,enableRetinaScaling:false}); const textureEl=document.createElement('canvas');textureEl.width=textureEl.height=1;return [m.id,{canvas,el:canvas.lowerCanvasEl,textureEl,suspendHistory:false,textureDirty:true,baseline:'',undo:[] as string[],redo:[] as string[],coalesceKey:null}];}));
const core=Object.create(EditorCore.prototype) as EditorCore;
Object.assign(core,{maps:states,activeMap:'Skin_B',tool:'draw',symmetry:false,blenderParts:[{...island,mesh:'sTest',fillRule:'evenodd'}],listeners:new Map(),projectionSources:new Map(),projectionBakes:new Map(),materialBakes:new Map(),materialSurfaces:[],materialInteractive:false,materialUpdateSequence:0,textureResolution:1024,illumRoles:new Map(),importedRoleMasks:new WeakMap(),previewDirty:new Set(),previewUpdates:new Set(),flushTexture:()=>{},isPanning:()=>false});
for(const m of MAPS)(core as unknown as {wireCanvas(id:MapId,state:unknown):void}).wireCanvas(m.id,states.get(m.id)!);
try {
  const state=states.get('Skin_B')!,res=MAP_BY_ID.Skin_B.workRes;core.resetMapBaseline('Skin_B');
  // Deliberately cross the outside of the element and its hole.
  const uvStart=sourceUvPoint(p,atlasPoint(p,{x:.02,y:.34}));
  core.paintBegin('Skin_B',uvStart.x*res,uvStart.y*res,{color:'#ff0000',size:40,clipKey:p.part.id,name:'Peinture UV'});
  core.paintMove(.4*res,.34*res);core.paintEnd();
  const path=state.canvas.getObjects()[0] as FabricObject & {name:string}; assert.equal(path.type,'path');assert.equal(path.name,'Peinture UV');assert(path.clipPath);assert(core.canUndo());
  const texture=core.getCanvasElement('Skin_B'),rgba=(u:number,v:number)=>[...texture.getContext('2d')!.getImageData(Math.floor(u*texture.width),Math.floor(v*texture.height),1,1).data];
  assert.equal(rgba(.14,.34)[0],255,'Native inside gets paint');assert.deepEqual(rgba(.2,.34),[18,52,86,255],'The hole gets no paint');assert.deepEqual(rgba(.38,.34),[18,52,86,255],'Neighbouring native UV receives no paint');
  const capture=await core.captureProject();assert(JSON.stringify(capture.maps.Skin_B).includes('Peinture UV'));
  await core.undo();assert.equal(state.canvas.getObjects().length,0,'One Undo removes the complete mapped stroke');
  assert(uvRegionAt([island],.14,.34));
  console.log('✓ Real pixels, hole clipping, hostile input bounds, editable native paint and single-step Undo');
} finally { for(const state of states.values())await state.canvas.dispose(); }
