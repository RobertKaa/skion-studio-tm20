import boundsData from './assets/uvAtlasBounds.json';
import { UV_GUIDE_BY_FAMILY, type UvGuideFamily, type UvGuideIsland } from './uvGuideData';
import { WHEEL_PART_GUIDES } from './wheelParts';
import { independentDetailsGuides, type DetailsLayout } from './detailsSides';
import { panelAtlasGuides, UNDERBODY_PANEL_LAYOUT } from './underbodyPanel';
import { buildUvAtlasLayout, atlasPoint, type UvAtlasLayout, type UvAtlasPlacement } from './uvAtlasLayout';
import { organizedUvParts } from './uvParts';
import type { ProjectionTriangle } from './three/decalProjection';
import type { MaterialRegion } from './materials/types';
export const REAL_UV_ATLAS = 'organized-v1' as const;
export type UvAtlasVersion = typeof REAL_UV_ATLAS;
export type AtlasSourceLayout = 'stock' | DetailsLayout;
export const validAtlasSource = (v:unknown):v is AtlasSourceLayout => ['stock','independent-v1',UNDERBODY_PANEL_LAYOUT].includes(String(v));
export function sourceAtlasGuides(family:UvGuideFamily,source:AtlasSourceLayout='stock'):UvGuideIsland[] {
  if(family==='wheels')return WHEEL_PART_GUIDES;
  const original=UV_GUIDE_BY_FAMILY[family];
  return family!=='details'||source==='stock'?original:source===UNDERBODY_PANEL_LAYOUT?panelAtlasGuides(original):independentDetailsGuides(original);
}
const layouts=new Map<string,UvAtlasLayout>();
export function realAtlasLayout(family:UvGuideFamily,source:AtlasSourceLayout='stock'):UvAtlasLayout {
  const key=`${source}:${family}`,saved=layouts.get(key);if(saved)return saved;
  const bounds=boundsData[source][family];
  const result=buildUvAtlasLayout(sourceAtlasGuides(family,source),{rotate:false,bounds});layouts.set(key,result);return result;
}
export function organizedAtlasGuides(family:UvGuideFamily,details?:DetailsLayout):UvGuideIsland[] {
  const layout=realAtlasLayout(family,details??'stock');
  return sourceAtlasGuides(family,details??'stock').map(island=>{
    const polygons=island.polygons.map((poly,index)=>{
      const placement=layout.placements.find(p=>p.part.parent.key===island.key&&p.part.element===index);
      if(placement)return poly.map(point=>atlasPoint(placement,point));
      // Even-odd holes use the transform of their surrounding shape.
      const owner=layout.placements.find(p=>p.part.parent.key===island.key&&p.part.region.polygons.includes(poly));
      return owner?poly.map(point=>atlasPoint(owner,point)):poly;
    });return {...island,polygons};
  });
}
/** Transfer actual layer pixels, including the lower LOD margin of each shape.
 * Primary UV orientation is retained, so tangent-space normals need no rotation. */
export function drawRealAtlas(ctx:CanvasRenderingContext2D,source:CanvasImageSource,layout:UvAtlasLayout) {
  const w=ctx.canvas.width,h=ctx.canvas.height;ctx.clearRect(0,0,w,h);
  for(const p of layout.placements){const b=p.part.bounds;ctx.save();ctx.scale(w,h);ctx.transform(...p.matrix);ctx.beginPath();ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();ctx.drawImage(source,0,0,1,1);ctx.restore();}
}
/** Reconstruct the source chart for tools authored against the native mesh. */
export function drawSourceAtlas(ctx:CanvasRenderingContext2D,source:CanvasImageSource,layout:UvAtlasLayout) {
  const w=ctx.canvas.width,h=ctx.canvas.height;ctx.clearRect(0,0,w,h);
  const size=source as {width?:number;height?:number};
  for(const p of layout.placements){const b=p.bounds,[a,bb,c,d,e,f]=p.matrix,det=a*d-bb*c;
    ctx.save();ctx.scale(w,h);ctx.transform(d/det,-bb/det,-c/det,a/det,(c*f-d*e)/det,(bb*e-a*f)/det);ctx.beginPath();ctx.rect(b.x,b.y,b.w,b.h);ctx.clip();
    // Inverse placement can magnify a whole 4K atlas dozens of times. Crop the
    // current chart before sampling rather than allocating that off-clip image.
    if(typeof size.width==='number'&&typeof size.height==='number'&&size.width>0&&size.height>0){
      const x=Math.max(0,Math.floor(b.x*size.width)-1),y=Math.max(0,Math.floor(b.y*size.height)-1),right=Math.min(size.width,Math.ceil((b.x+b.w)*size.width)+1),bottom=Math.min(size.height,Math.ceil((b.y+b.h)*size.height)+1);
      if(right>x&&bottom>y)ctx.drawImage(source,x,y,right-x,bottom-y,x/size.width,y/size.height,(right-x)/size.width,(bottom-y)/size.height);
    }
    else ctx.drawImage(source,0,0,1,1);ctx.restore();}
}
export function transferAtlasCanvas(source:HTMLCanvasElement,family:UvGuideFamily,layout:AtlasSourceLayout,reverse=false):HTMLCanvasElement {
  const target=document.createElement('canvas');target.width=source.width;target.height=source.height;
  if(source.width<=4&&source.height<=4){const pixels=source.getContext('2d')!.getImageData(0,0,source.width,source.height).data;if(pixels.every((v,i)=>v===pixels[i%4])){target.getContext('2d')!.drawImage(source,0,0);return target;}}
  (reverse?drawSourceAtlas:drawRealAtlas)(target.getContext('2d')!,source,realAtlasLayout(family,layout));return target;
}
export function placementMatrix(p:UvAtlasPlacement,res:number):[number,number,number,number,number,number] {
  const [a,b,c,d,e,f]=p.matrix;return[a,b,c,d,e*res,f*res];
}
export function mappedMaterialRegions(regions:MaterialRegion[],family:UvGuideFamily,source:AtlasSourceLayout,reverse=false):MaterialRegion[] {
  const layout=realAtlasLayout(family,source);
  return regions.map(region=>({...region,polygons:region.polygons.flatMap(poly=>layout.placements.flatMap(p=>{
    let points=poly;const box=reverse?p.bounds:p.part.bounds;
    for(const [axis,edge,sign] of [['x',box.x,1],['x',box.x+box.w,-1],['y',box.y,1],['y',box.y+box.h,-1]] as const){
      const next:typeof points=[];
      for(let i=0;i<points.length;i++){const a=points[(i+points.length-1)%points.length],b=points[i],aa=(a[axis]-edge)*sign>=0,bb=(b[axis]-edge)*sign>=0;
        if(aa!==bb){const t=(edge-a[axis])/(b[axis]-a[axis]);next.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}if(bb)next.push(b);}
      points=next;
    }
    const [a,b,c,d,e,f]=p.matrix,det=a*d-b*c;
    return points.length>=3?[points.map(point=>reverse?{x:(d*(point.x-e)-c*(point.y-f))/det,y:(a*(point.y-f)-b*(point.x-e))/det}:atlasPoint(p,point))]:[];
  }))})).filter(r=>r.polygons.length);
}
const geometrySources=new WeakMap<readonly ProjectionTriangle[],readonly ProjectionTriangle[]>();
export function sourceAtlasGeometry(geometry:readonly ProjectionTriangle[]):readonly ProjectionTriangle[] {
  const saved=geometrySources.get(geometry);if(saved)return saved;
  const result=geometry.map(t=>t.sourceUv?{...t,uv:t.sourceUv,atlasUv:t.uv}:t);geometrySources.set(geometry,result);return result;
}

/** Native UV → organized UV, using the same smallest-chart/nearest-chart
 * ownership rule as the native mesh recipes. Numeric height stays numeric. */
export function atlasCoordinateMap(family:UvGuideFamily,source:AtlasSourceLayout):(u:number,v:number)=>[number,number] {
  const layout=realAtlasLayout(family,source),parts=organizedUvParts(sourceAtlasGuides(family,source));
  const entries=parts.map(part=>({part,placement:layout.placements.find(p=>p.part.id===part.id)!}));
  const inside=(poly:{x:number;y:number}[],x:number,y:number)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};
  return(u,v)=>{const y=1-v;let best=entries[0],area=Infinity,distance=Infinity;
    for(const entry of entries){const p=entry.part,b=p.bounds,count=p.region.polygons.reduce((n,poly)=>n+Number(inside(poly,u,y)),0),hit=p.region.fillRule==='evenodd'?count%2!==0:count>0;
      if(hit&&p.area<area){best=entry;area=p.area;}
      if(area===Infinity){const d=Math.max(b.x-u,0,u-b.x-b.w)**2+Math.max(b.y-y,0,y-b.y-b.h)**2;if(d<distance){best=entry;distance=d;}}
    }
    const point=atlasPoint(best.placement,{x:u,y});return[point.x,1-point.y];
  };
}

export function organizedAtlasGeometry(geometry:readonly ProjectionTriangle[],source:AtlasSourceLayout):readonly ProjectionTriangle[] {
  const maps=new Map<UvGuideFamily,ReturnType<typeof atlasCoordinateMap>>();
  return geometry.map(t=>{let map=maps.get(t.family);if(!map){map=atlasCoordinateMap(t.family,source);maps.set(t.family,map);}return {...t,sourceUv:t.uv,uv:t.atlasUv??t.uv.map(p=>map!(...p)) as ProjectionTriangle['uv']};});
}
