import type { ProjectionTriangle, SurfaceAnchor, Vec3 } from '../three/decalProjection';
import type { MaterialLayer, MaterialProjection } from './types';
import { getSurfaceCoordinates } from './surfaceCoordinates';
import { getWheelCoordinates } from './wheelCoordinates';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v: Vec3): Vec3 => { const length = Math.hypot(...v) || 1; return v.map(x=>x/length) as Vec3; };
const finite = (v: number[]) => v.every(n=>Number.isFinite(n) && Math.abs(n)<1e6);
const axes = [
  { right: [1,0,0] as Vec3, up: [0,0,-1] as Vec3, normal: 1 }, // top, image Y follows vehicle Z
  { right: [0,0,1] as Vec3, up: [0,1,0] as Vec3, normal: 0 },
  { right: [1,0,0] as Vec3, up: [0,1,0] as Vec3, normal: 2 },
];
type Affine = [number, number, number];
const at = (f: Affine, x: number, y: number) => f[0]*x+f[1]*y+f[2];

export function materialDragFrame(projection: MaterialProjection, geometry: readonly ProjectionTriangle[], anchor: SurfaceAnchor, family?: MaterialLayer['family']) {
  const weights=axes.map(axis=>Math.abs(anchor.normal[axis.normal]));
  const index=projection==='top' || projection==='surface'?0:projection==='side'?1:projection==='front'?2:weights.indexOf(Math.max(...weights));
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(const t of geometry) for(const p of t.points) for(let i=0;i<3;i++){low[i]=Math.min(low[i],p[i]);high[i]=Math.max(high[i],p[i]);}
  const scale=2048/Math.max(1e-6,...high.map((v,i)=>v-low[i]));
  if (projection==='surface'||projection==='wheel'||projection==='wheel-face') {
    const wheel=projection==='wheel'||projection==='wheel-face'||family==='wheels';
    let surface;
    try{surface=wheel?getWheelCoordinates(geometry,projection==='wheel-face'):getSurfaceCoordinates(geometry);}
    catch(error){if(projection!=='surface')throw error;surface=getSurfaceCoordinates(geometry);}
    // The conformal chart can rotate and change density locally. Use the
    // actual coordinate gradients at the grabbed point, not a world-axis guess.
    let closest=Infinity,frame:{point:Vec3;right:Vec3;up:Vec3;scale:number}|undefined;
    geometry.forEach((triangle,index)=>{
      if(wheel&&triangle.family!=='wheels')return;
      const [p,q,r]=triangle.points;
      if(p.some((_,axis)=>anchor.point[axis]<Math.min(p[axis],q[axis],r[axis])-.01||anchor.point[axis]>Math.max(p[axis],q[axis],r[axis])+.01))return;
      const e1=sub(q,p),e2=sub(r,p),delta=sub(anchor.point,p),a=dot(e1,e1),b=dot(e1,e2),c=dot(e2,e2),det=a*c-b*b;
      if(det<1e-20)return;
      const s=(dot(delta,e1)*c-dot(delta,e2)*b)/det,t=(dot(delta,e2)*a-dot(delta,e1)*b)/det;
      if(s<-.001||t<-.001||s+t>1.001)return;
      const n=unit(cross(e1,e2)),distance=Math.abs(dot(delta,n));if(distance>=closest||distance>.01)return;
      const ids=[0,1,2].map(corner=>surface.triangleNodes[3*index+corner]);
      const gradient=(values:Float64Array):Vec3=>{const d1=values[ids[1]]-values[ids[0]],d2=values[ids[2]]-values[ids[0]],x=(d1*c-d2*b)/det,y=(d2*a-d1*b)/det;return e1.map((value,axis)=>x*value+y*e2[axis]) as Vec3;};
      closest=distance;frame={point:[...anchor.point],right:gradient(surface.transverse),up:gradient(surface.longitudinal).map(value=>-value) as Vec3,scale};
    });
    if(frame)return frame;
    const n=unit(anchor.normal),right=Math.hypot(n[0],n[1])>.05 ? unit([n[1],-n[0],0]) : unit([1-n[0]*n[0],-n[0]*n[1],-n[0]*n[2]]);
    const longitudinal:Vec3=[-n[2]*n[0],-n[2]*n[1],1-n[2]*n[2]];
    const up=(Math.hypot(...longitudinal)>.05 ? unit(longitudinal) : unit([0,-n[2],n[1]])).map(v=>-v) as Vec3;
    return {point:[...anchor.point] as Vec3,right,up,scale};
  }
  return {point:[...anchor.point] as Vec3,right:axes[index].right,up:axes[index].up,scale};
}

/** Coordinates are anchored to the complete car, never to an individual UV
 * island or selected mask. All families and material channels share this frame.
 * Meshes with reused UVs necessarily share their exported texels.
 */
export function createMaterialProjector(layer: MaterialLayer, geometry: readonly ProjectionTriangle[], size: number, frame: {width: number; height: number}) {
  const transform = layer.definition.transform, projection = transform.projection;
  if (!projection || projection === 'uv') return null;
  if (!geometry.length) throw new Error('Le modèle 3D doit être chargé pour aligner la matière sur la voiture.');
  if (geometry.length > 500000 || !Number.isInteger(size) || size < 1 || size > 4096) throw new Error('Projection de matière trop volumineuse.');
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width<=0 || frame.height<=0) throw new Error('Dimensions de texture invalides.');
  const low: Vec3 = [Infinity,Infinity,Infinity], high: Vec3 = [-Infinity,-Infinity,-Infinity];
  for (const triangle of geometry) {
    if (!triangle.points.every(p=>p.length===3 && finite(p)) || !triangle.uv.every(p=>p.length===2 && finite(p))
      || (triangle.normals && !triangle.normals.every(p=>p.length===3 && finite(p)))) throw new Error('Coordonnées de projection invalides.');
    for (const p of triangle.points) for (let i=0;i<3;i++) { low[i]=Math.min(low[i],p[i]); high[i]=Math.max(high[i],p[i]); }
  }
  const center = low.map((v,i)=>(v+high[i])/2) as Vec3;
  const scale = 2048/Math.max(1e-6,...high.map((v,i)=>v-low[i]));
  let wheelWrap = layer.family === 'wheels' && (projection === 'surface' || projection === 'wheel');
  const wheelFace = layer.family === 'wheels' && projection === 'wheel-face';
  if ((projection === 'wheel' || projection === 'wheel-face') && layer.family !== 'wheels') throw new Error('Cet alignement est réservé aux roues.');
  let surface;
  try{surface=wheelWrap||wheelFace?getWheelCoordinates(geometry,wheelFace):projection==='surface'?getSurfaceCoordinates(geometry):null;}
  catch(error){if(projection!=='surface')throw error;wheelWrap=false;surface=getSurfaceCoordinates(geometry);}
  // A saved "stretch" placement must not undo surface proportion preservation.
  const fitMode = surface && transform.mode === 'stretch' ? 'cover' : transform.mode;
  const chosen = projection === 'triplanar' ? [0,1,2] : [projection === 'top' || surface ? 0 : projection === 'side' ? 1 : 2];
  const angle = -transform.angle*Math.PI/180, cos=Math.cos(angle), sin=Math.sin(angle);
  const planes = chosen.map(index=> {
    const axis=axes[index];
    const extent = (v: Vec3) => v.reduce((sum,n,i)=>sum+Math.abs(n)*(high[i]-low[i]),0)*scale;
    const width=surface ? (surface.max[0]-surface.min[0])*scale : extent(axis.right);
    const height=surface ? (surface.max[1]-surface.min[1])*scale : extent(axis.up);
    const ratio=fitMode==='cover' ? Math.max(width/frame.width,height/frame.height) : Math.min(width/frame.width,height/frame.height);
    const w=fitMode==='repeat' ? transform.size : (fitMode==='stretch' ? width : frame.width*ratio)*transform.size/256;
    const h=fitMode==='repeat' ? transform.size*frame.height/frame.width : (fitMode==='stretch' ? height : frame.height*ratio)*transform.size/256;
    const safeW=Math.max(w,1e-6),safeH=Math.max(h,1e-6);
    let xx=cos*scale*(transform.flipX?-1:1)/safeW,xy=-sin*scale*(transform.flipX?-1:1)/safeW;
    let yx=sin*scale*(transform.flipY?-1:1)/safeH,yy=cos*scale*(transform.flipY?-1:1)/safeH;
    if(wheelWrap&&transform.mode==='repeat'){
      const period=getWheelCoordinates(geometry).circumference;
      let turnsX=Math.round(xy*period),turnsY=Math.round(yy*period);
      if(!turnsX&&!turnsY){if(Math.abs(xy)>Math.abs(yy))turnsX=Math.sign(xy)||1;else turnsY=Math.sign(yy)||1;}
      xy=turnsX/period;yy=turnsY/period;
      const orientation=(transform.flipX?-1:1)*(transform.flipY?-1:1);
      // Close on an integer lattice vector while keeping the source image's
      // aspect. A similarity adjusts pitch/angle, never stretches a square.
      xx=orientation*yy*frame.height/frame.width;
      yx=-orientation*xy*frame.width/frame.height;
    }
    return { ...axis, w:safeW, h:safeH, xx, xy, yx, yy };
  });
  const maskPoints=layer.regions.flatMap(region=>region.polygons.flat());
  const maskBounds=maskPoints.length ? {left:Math.min(...maskPoints.map(p=>p.x)),right:Math.max(...maskPoints.map(p=>p.x)),top:Math.min(...maskPoints.map(p=>p.y)),bottom:Math.max(...maskPoints.map(p=>p.y))} : null;
  const sharedWheelFaces=new Set<string>();
  const raster = geometry.map((triangle, triangleIndex)=> {
    if (triangle.family!==layer.family || maskBounds && (
      Math.max(...triangle.uv.map(p=>p[0]))<maskBounds.left || Math.min(...triangle.uv.map(p=>p[0]))>maskBounds.right ||
      Math.max(...triangle.uv.map(p=>1-p[1]))<maskBounds.top || Math.min(...triangle.uv.map(p=>1-p[1]))>maskBounds.bottom)) return null;
    if(wheelWrap||wheelFace){
      const key=triangle.uv.map(p=>p.map(v=>Math.round(v*1e6)).join(':')).sort().join('/');
      if(sharedWheelFaces.has(key))return null;sharedWheelFaces.add(key);
    }
    const edge=(v:number)=>Math.abs(v)<1e-6?0:Math.abs(v-1)<1e-6?1:v;
    const [p,q,r]=triangle.uv.map(([u,v])=>[edge(u)*size,(1-edge(v))*size]);
    const determinant=(q[1]-r[1])*(p[0]-r[0])+(r[0]-q[0])*(p[1]-r[1]);
    if (Math.abs(determinant)<1e-9) return null;
    const a: Affine=[(q[1]-r[1])/determinant,(r[0]-q[0])/determinant,0]; a[2]=-a[0]*r[0]-a[1]*r[1];
    const b: Affine=[(r[1]-p[1])/determinant,(p[0]-r[0])/determinant,0]; b[2]=-b[0]*r[0]-b[1]*r[1];
    const field = (values: number[]): Affine=> [a[0]*(values[0]-values[2])+b[0]*(values[1]-values[2]),a[1]*(values[0]-values[2])+b[1]*(values[1]-values[2]),a[2]*(values[0]-values[2])+b[2]*(values[1]-values[2])+values[2]];
    const e1=sub(triangle.points[1],triangle.points[0]), e2=sub(triangle.points[2],triangle.points[0]);
    const normal=unit(cross(e1,e2));
    const [uv0,uv1,uv2]=triangle.uv, du1=uv1[0]-uv0[0], dv1=uv1[1]-uv0[1], du2=uv2[0]-uv0[0], dv2=uv2[1]-uv0[1];
    const uvDet=du1*dv2-du2*dv1;
    const tangent=unit(e1.map((v,i)=>(v*dv2-e2[i]*dv1)/uvDet) as Vec3);
    const bitangent=unit(e1.map((v,i)=>(e2[i]*du1-v*du2)/uvDet) as Vec3);
    let transverse: number[] | undefined, longitudinal: number[] | undefined;
    const g11=dot(e1,e1),g12=dot(e1,e2),g22=dot(e2,e2),metricDet=g11*g22-g12*g12;
    const gradient=(values:number[]):Vec3=> {
      if (Math.abs(metricDet)<1e-20) return [0,0,0];
      const d1=values[1]-values[0],d2=values[2]-values[0];
      const a=(d1*g22-d2*g12)/metricDet,b=(d2*g11-d1*g12)/metricDet;
      return unit(e1.map((value,axis)=>a*value+b*e2[axis]) as Vec3);
    };
    if (surface) {
      const nodes=[0,1,2].map(corner=>surface.triangleNodes[triangleIndex*3+corner]);
      transverse=nodes.map(node=>surface.transverse[node]);
      longitudinal=nodes.map(node=>surface.longitudinal[node]);
    }
    const coordinates=planes.map(plane=> {
      const values=triangle.points.map((point,corner)=> {
        const delta=sub(point,center);
        const x=(transverse ? transverse[corner] : dot(delta,plane.right))-transform.offsetX/scale;
        const y=(longitudinal ? longitudinal[corner] : -dot(delta,plane.up))-transform.offsetY/scale;
        return [plane.xx*x+plane.xy*y+(transform.mode==='repeat'?0:.5),plane.yx*x+plane.yy*y+(transform.mode==='repeat'?0:.5)];
      });
      const right=gradient(values.map(v=>v[0])),up=gradient(values.map(v=>v[1])).map(v=>-v) as Vec3;
      return { u:field(values.map(v=>v[0])), v:field(values.map(v=>v[1])),
        tx:dot(right,tangent), ty:dot(up,tangent), bx:dot(right,bitangent), by:dot(up,bitangent) };
    });
    const normals=triangle.normals ?? [normal,normal,normal];
    return { a,b, coordinates, weights: planes.map(plane=>field(normals.map(n=>n[plane.normal]))),
      // Prefer the facing surface when several physical pieces reuse one UV island.
      priority: planes.length===1 ? normal[planes[0].normal] : 0,
      left:Math.max(0,Math.floor(Math.min(p[0],q[0],r[0])-.6)), right:Math.min(size-1,Math.ceil(Math.max(p[0],q[0],r[0])+.6)),
      top:Math.max(0,Math.floor(Math.min(p[1],q[1],r[1])-.6)), bottom:Math.min(size-1,Math.ceil(Math.max(p[1],q[1],r[1])+.6)),
      marginA:.6*Math.hypot(a[0],a[1]), marginB:.6*Math.hypot(b[0],b[1]), marginC:.6*Math.hypot(a[0]+b[0],a[1]+b[1]) };
  }).filter(t=>t!==null).sort((a,b)=>a.priority-b.priority);
  const work = raster.reduce((sum,t)=>sum+Math.max(0,t.right-t.left+1)*Math.max(0,t.bottom-t.top+1),0);
  if (work>12*size*size+geometry.length*9) throw new Error('Les UV de ce modèle sont trop superposés pour une projection de matière.');
  const repeat=transform.mode==='repeat';
  const wrap = (x:number,n:number)=>((x%n)+n)%n;
  return {
    /** Direct numeric sampling for displacement: never quantize a 16-bit height
     * source through Canvas2D. The UV index is bounded and built only on demand. */
    scalarSampler(source: {width:number;height:number;values:Float32Array}) {
      if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width<1 || source.height<1
        || source.width*source.height>16*1024*1024 || source.values.length!==source.width*source.height) throw new Error('Source de hauteur invalide.');
      const bins: (typeof raster)[] = Array.from({length:4096},()=>[]);
      for(const t of raster) {
        const left=Math.max(0,Math.floor(t.left/size*64)),right=Math.min(63,Math.floor(t.right/size*64));
        const top=Math.max(0,Math.floor(t.top/size*64)),bottom=Math.min(63,Math.floor(t.bottom/size*64));
        for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)bins[y*64+x].push(t);
      }
      const read=(u:number,v:number)=> {
        if (!repeat && (u<0||v<0||u>1||v>1)) return .5;
        const x=(repeat?wrap(u,1):u)*source.width-.5,y=(repeat?wrap(v,1):v)*source.height-.5;
        const a=Math.floor(x),b=Math.floor(y),tx=x-a,ty=y-b;
        const value=(x:number,y:number)=>source.values[(repeat?wrap(y,source.height):Math.max(0,Math.min(source.height-1,y)))*source.width+(repeat?wrap(x,source.width):Math.max(0,Math.min(source.width-1,x)))];
        return value(a,b)*(1-tx)*(1-ty)+value(a+1,b)*tx*(1-ty)+value(a,b+1)*(1-tx)*ty+value(a+1,b+1)*tx*ty;
      };
      return (u:number,v:number)=> {
        const x=Math.max(0,Math.min(1,u))*size,y=(1-Math.max(0,Math.min(1,v)))*size;
        const candidates=bins[Math.min(63,Math.floor(y/size*64))*64+Math.min(63,Math.floor(x/size*64))];
        for(let i=candidates.length-1;i>=0;i--) {
          const t=candidates[i],a=at(t.a,x,y),b=at(t.b,x,y);
          if(a < -1e-6 || b < -1e-6 || 1-a-b < -1e-6) continue;
          let value=0,total=0;
          for(let plane=0;plane<planes.length;plane++) {
            const weight=planes.length===1?1:Math.pow(Math.abs(at(t.weights[plane],x,y)),4);
            const coordinate=t.coordinates[plane];value+=weight*read(at(coordinate.u,x,y),at(coordinate.v,x,y));total+=weight;
          }
          return total?value/total:.5;
        }
        return .5;
      };
    },
    place(target: HTMLCanvasElement, source: HTMLCanvasElement, normalMap=false, constantFill=false) {
      const ctx=target.getContext('2d')!, sourceCtx=source.getContext('2d')!;
      const width=source.width, height=source.height, pixels=sourceCtx.getImageData(0,0,width,height).data;
      // A scalar finish is often constant. Its shared coverage was already
      // projected once, so repeating millions of bilinear samples is redundant.
      if (constantFill && !normalMap) {
        let uniform=true;
        for(let i=4;i<pixels.length;i++) if(pixels[i]!==pixels[i%4]){uniform=false;break;}
        if(uniform) { ctx.fillStyle=`rgba(${pixels[0]},${pixels[1]},${pixels[2]},${pixels[3]/255})`;ctx.fillRect(0,0,size,size);return; }
      }
      const output=ctx.createImageData(size,size), data=output.data;
      const sample=new Float64Array(4);
      const read=(u:number,v:number)=> {
        sample.fill(0);
        if (!repeat && (u<0 || v<0 || u>1 || v>1)) return;
        const x=(repeat?wrap(u,1):u)*width-.5, y=(repeat?wrap(v,1):v)*height-.5, ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
        for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) {
          const px=repeat?wrap(ix+dx,width):Math.max(0,Math.min(width-1,ix+dx)), py=repeat?wrap(iy+dy,height):Math.max(0,Math.min(height-1,iy+dy));
          const index=(py*width+px)*4, weight=(dx?fx:1-fx)*(dy?fy:1-fy), alpha=pixels[index+3]/255;
          for(let c=0;c<3;c++) sample[c]+=pixels[index+c]*weight*alpha;
          sample[3]+=alpha*weight;
        }
        if(sample[3]) for(let c=0;c<3;c++) sample[c]/=sample[3];
      };
      for (const triangle of raster) for(let y=triangle.top;y<=triangle.bottom;y++) for(let x=triangle.left;x<=triangle.right;x++) {
        const px=x+.5, py=y+.5, a=at(triangle.a,px,py), b=at(triangle.b,px,py), c=1-a-b;
        if(a < -triangle.marginA || b < -triangle.marginB || c < -triangle.marginC) continue;
        let red=0,green=0,blue=0,alpha=0,total=0;
        for(let plane=0;plane<planes.length;plane++) {
          const weight=planes.length===1?1:Math.pow(Math.abs(at(triangle.weights[plane],px,py)),4);
          if(weight<1e-8) continue;
          total+=weight;
          const coordinate=triangle.coordinates[plane]; read(at(coordinate.u,px,py),at(coordinate.v,px,py));
          if(!sample[3]) continue;
          if(normalMap) {
            const nx=sample[0]/127.5-1, ny=sample[1]/127.5-1, nz=Math.max(1e-6,sample[2]/127.5-1);
            const tx=coordinate.tx*nx+coordinate.ty*ny, by=coordinate.bx*nx+coordinate.by*ny, length=Math.hypot(tx,by,nz);
            sample[0]=(tx/length+1)*127.5; sample[1]=(by/length+1)*127.5; sample[2]=(nz/length+1)*127.5;
          }
          const covered=weight*sample[3]; red+=sample[0]*covered;green+=sample[1]*covered;blue+=sample[2]*covered;alpha+=covered;
        }
        const index=(y*size+x)*4;
        if(alpha && total) { data[index]=red/alpha;data[index+1]=green/alpha;data[index+2]=blue/alpha;data[index+3]=255*alpha/total; }
        else data.fill(0,index,index+4);
      }
      ctx.putImageData(output,0,0);
    },
  };
}
