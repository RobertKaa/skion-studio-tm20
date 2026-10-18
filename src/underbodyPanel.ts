import { UV_GUIDE_BY_FAMILY, type UvGuideIsland } from './uvGuideData';
import type { MaterialLayer, MaterialRegion } from './materials/types';
import type { RGBAImage } from './dds';

export const UNDERBODY_PANEL_LAYOUT = 'underbody-panel-v1' as const;
export type PanelPlacement = 'base' | 'right';
export const PANEL_SCALE = .82;
export const PANEL_SOURCE = UV_GUIDE_BY_FAMILY.details.find(island => island.key === 'd_floor')!.polygons[0];
export const PANEL_BOUNDS = {
  x: Math.min(...PANEL_SOURCE.map(p => p.x)), y: Math.min(...PANEL_SOURCE.map(p => p.y)),
  w: Math.max(...PANEL_SOURCE.map(p => p.x)) - Math.min(...PANEL_SOURCE.map(p => p.x)),
  h: Math.max(...PANEL_SOURCE.map(p => p.y)) - Math.min(...PANEL_SOURCE.map(p => p.y)),
};
export const panelFrame = (placement: PanelPlacement) => ({ scale: PANEL_SCALE,
  x: placement === 'base' ? 0 : .826 - PANEL_BOUNDS.x * PANEL_SCALE,
  y: placement === 'base' ? 0 : .006 - PANEL_BOUNDS.y * PANEL_SCALE });
export const panelPoint = (p: {x:number;y:number}, placement: PanelPlacement) => {
  const frame=panelFrame(placement);return {x:p.x*frame.scale+frame.x,y:p.y*frame.scale+frame.y};
};
export function insidePanel(x:number,y:number):boolean {
  let hit=false;
  for(let i=0,j=PANEL_SOURCE.length-1;i<PANEL_SOURCE.length;j=i++){
    const a=PANEL_SOURCE[i],b=PANEL_SOURCE[j];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;
  }
  return hit;
}

/** Clipping keeps every migrated mask within the bounded editor atlas. */
export function panelRegion(region: MaterialRegion, placement: PanelPlacement): MaterialRegion {
  const clip=(points:{x:number;y:number}[])=>{
    for(const [axis,edge,sign] of [['x',0,1],['x',1,-1],['y',0,1],['y',1,-1]] as const){
      const next:typeof points=[];
      for(let i=0;i<points.length;i++){
        const a=points[(i+points.length-1)%points.length],b=points[i],insideA=(a[axis]-edge)*sign>=0,insideB=(b[axis]-edge)*sign>=0;
        if(insideA!==insideB){const t=(edge-a[axis])/(b[axis]-a[axis]);next.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
        if(insideB)next.push(b);
      }
      points=next;
    }
    return points;
  };
  return {...region,polygons:region.polygons.map(poly=>clip(poly.map(p=>panelPoint(p,placement)))).filter(poly=>poly.length>=3)};
}
export function panelGuide(side:'left'|'right'):UvGuideIsland {
  return {...panelRegion({key:`d_floor:panel:${side}`,label:`PANNEAU INFÉRIEUR ${side==='left'?'GAUCHE':'DROIT'}`,polygons:[PANEL_SOURCE]},side==='left'?'base':'right'),family:'details'};
}
export function panelAtlasGuides(legacy:readonly UvGuideIsland[]):UvGuideIsland[] {
  return legacy.flatMap(island=>island.key==='d_floor'
    ? [{...island,...panelRegion({...island,label:'DESSOUS · AUTRES ÉLÉMENTS',polygons:island.polygons.slice(1)},'base')},panelGuide('left'),panelGuide('right')]
    : [{...island,...panelRegion(island,'base')}]);
}
export function panelCanvasRegion(placement:PanelPlacement):MaterialRegion {
  if(placement==='right'){const {family:_family,...region}=panelGuide('right');return region;}
  return {key:'details:panel:base',label:'Détails · feuille principale',polygons:[[{x:0,y:0},{x:PANEL_SCALE,y:0},{x:PANEL_SCALE,y:PANEL_SCALE},{x:0,y:PANEL_SCALE}]]};
}
export function materialOnPanelAtlas(layer:MaterialLayer,placement:PanelPlacement):MaterialLayer {
  const points=layer.regions.flatMap(r=>r.polygons.flat()),x=points.length?Math.min(...points.map(p=>p.x)):0,y=points.length?Math.min(...points.map(p=>p.y)):0;
  const reference={x,y,w:points.length?Math.max(...points.map(p=>p.x))-x:1,h:points.length?Math.max(...points.map(p=>p.y))-y:1};
  const remap=(regions:MaterialRegion[])=>regions.map(r=>{
    const result=panelRegion(r,placement);
    if(placement==='base'&&r.key==='d_floor:element:0')return {...result,key:panelGuide('left').key,label:panelGuide('left').label};
    if(placement==='base'&&/^d_floor:element:\d+$/.test(r.key))return {...result,key:`d_floor:element:${Number(r.key.split(':').at(-1))-1}`};
    return result;
  }).filter(r=>r.polygons.length);
  return {...structuredClone(layer),atlasFrame:{placement,reference},regions:layer.regions.length?remap(layer.regions):[panelCanvasRegion(placement)],exclusions:remap(layer.exclusions)};
}
export function panelReferenceMaterial(layer:MaterialLayer):MaterialLayer {
  const {atlasFrame,atlasSide:_side,...source}=layer;
  const {x,y,w,h}=atlasFrame!.reference;
  return {...source,definition:{...source.definition,opacity:1},regions:[{key:'source-frame',label:'Placement original',polygons:[[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]]}],exclusions:[]};
}

/** Keep the source atlas once, and copy only this one shared UV panel. */
export function panelTexturePixels(source:RGBAImage,normal=false):RGBAImage {
  const {width,height}=source;
  if(!Number.isInteger(width)||width<2||width>4096||!Number.isInteger(height)||height<2||height>4096||source.data.length!==width*height*4)throw new Error('Texture du panneau invalide.');
  const data=new Uint8ClampedArray(source.data.length),base=panelFrame('base'),right=panelFrame('right');
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=(x+.5)/width,v=(y+.5)/height,placement=u<=PANEL_SCALE&&v<=PANEL_SCALE?base:right;
    const sx=(u-placement.x)/PANEL_SCALE,sy=(v-placement.y)/PANEL_SCALE,i=(y*width+x)*4;
    if(sx<0||sx>1||sy<0||sy>1||(placement===right&&!insidePanel(sx,sy))){data.set(normal?[128,128,255,255]:[255,255,255,255],i);continue;}
    const px=sx*width-.5,py=sy*height-.5,x0=Math.floor(px),y0=Math.floor(py),tx=px-x0,ty=py-y0;
    const sample=(a:number,b:number,c:number)=>source.data[(Math.max(0,Math.min(height-1,b))*width+Math.max(0,Math.min(width-1,a)))*4+c];
    for(let c=0;c<4;c++)data[i+c]=sample(x0,y0,c)*(1-tx)*(1-ty)+sample(x0+1,y0,c)*tx*(1-ty)+sample(x0,y0+1,c)*(1-tx)*ty+sample(x0+1,y0+1,c)*tx*ty;
    if(normal){const n=[0,1,2].map(c=>data[i+c]/127.5-1),length=Math.hypot(...n)||1;for(let c=0;c<3;c++)data[i+c]=(n[c]/length*.5+.5)*255;}
  }
  return {width,height,data};
}
