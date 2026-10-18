import * as THREE from 'three';
import type { UvGuideIsland } from '../uvGuideData';
import type { ProjectionTriangle, Vec3 } from './decalProjection';

export interface UvFocusPlan {
  triangles: readonly ProjectionTriangle[];
  bounds: THREE.Box3;
  position: Vec3;
  target: Vec3;
  visible: number;
  occurrence: number;
  occurrences: number;
}
const v = (p: Vec3) => new THREE.Vector3(...p);
const area = (t: ProjectionTriangle) => v(t.points[1]).sub(v(t.points[0])).cross(v(t.points[2]).sub(v(t.points[0]))).length() / 2;
function inside(polygon: {x:number;y:number}[], x: number, y: number) {
  let hit = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if ((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) hit=!hit;
  }
  return hit;
}

/** UV origin is at the top in the editor, at the bottom in Three. Bounding-box
 * rejection keeps small element clicks cheap even on a subdivided relief mesh. */
export function uvFocusTriangles(triangles: readonly ProjectionTriangle[], region: UvGuideIsland) {
  if (triangles.length>500_000) return [];
  let points=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const polygon of region.polygons) for (const p of polygon) {
    if (++points>50_000 || !Number.isFinite(p.x)||!Number.isFinite(p.y)) return [];
    minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);
  }
  let work=0;
  const selected: ProjectionTriangle[]=[];
  for (const t of triangles) {
    if (t.family!==region.family) continue;
    const x=(t.uv[0][0]+t.uv[1][0]+t.uv[2][0])/3,y=1-(t.uv[0][1]+t.uv[1][1]+t.uv[2][1])/3;
    if (x<minX||x>maxX||y<minY||y>maxY)continue;
    if ((work+=points)>12_000_000) return [];
    const count=region.polygons.reduce((sum,p)=>sum+(inside(p,x,y)?1:0),0);
    if ((region.fillRule==='evenodd'?count%2:count>0) && t.points.every(p=>p.every(Number.isFinite)))selected.push(t);
  }
  return selected;
}

/** Shared UV can describe opposite panels or four tyres. Split them by physical
 * connectivity; framing the union would zoom out to the entire car. */
function occurrences(triangles: readonly ProjectionTriangle[]) {
  const parents=triangles.map((_,i)=>i),corners=new Map<string,number>();
  const root=(a:number):number=>{while(parents[a]!==a){parents[a]=parents[parents[a]];a=parents[a];}return a;};
  triangles.forEach((t,i)=>{for(const p of t.points){const key=p.map(n=>Math.round(n*100000)).join(',');const previous=corners.get(key);if(previous!==undefined)parents[root(i)]=root(previous);else corners.set(key,i);}});
  const groups=new Map<number,ProjectionTriangle[]>();
  triangles.forEach((t,i)=>{const id=root(i),group=groups.get(id)??[];group.push(t);groups.set(id,group);});
  const entries=[...groups.values()].map(tris=>{
    const bounds=new THREE.Box3();let weight=0;const center=new THREE.Vector3(),normal=new THREE.Vector3(),weighted:{triangle:ProjectionTriangle;area:number}[]=[];
    for(const t of tris){const w=area(t);if(w<1e-12)continue;weight+=w;const a=v(t.points[0]),b=v(t.points[1]),c=v(t.points[2]);
      weighted.push({triangle:t,area:w});
      bounds.expandByPoint(a);bounds.expandByPoint(b);bounds.expandByPoint(c);center.addScaledVector(a.clone().add(b).add(c).multiplyScalar(1/3),w);
      const n=t.normals?v(t.normals[0]).add(v(t.normals[1])).add(v(t.normals[2])).normalize():b.clone().sub(a).cross(c.clone().sub(a)).normalize();normal.addScaledVector(n,w);
    }
    return {triangles:tris,bounds,weight,center:center.divideScalar(weight||1),normal:normal.normalize(),ranked:weighted.sort((a,b)=>b.area-a.area).map(p=>p.triangle)};
  }).filter(g=>g.weight>1e-12).sort((a,b)=>b.weight-a.weight);
  return entries.filter(g=>g.weight>=entries[0].weight*.01).slice(0,16);
}

type Node = { box: number[]; start: number; end: number; left?: Node; right?: Node };
/** A bounded spatial index, reused for repeated clicks. Visibility rays stop at
 * the first obstruction; they do not depend on material sidedness or triangle order. */
class VisibilityIndex {
  indices: number[];
  boxes: Float64Array;
  root: Node;
  triangles: readonly ProjectionTriangle[];
  constructor(triangles: readonly ProjectionTriangle[]) {
    this.triangles=triangles;this.indices=triangles.map((_,i)=>i);this.boxes=new Float64Array(triangles.length*6);
    triangles.forEach((t,i)=>{for(let axis=0;axis<3;axis++){this.boxes[i*6+axis]=Math.min(...t.points.map(p=>p[axis]));this.boxes[i*6+axis+3]=Math.max(...t.points.map(p=>p[axis]));}});
    const build=(start:number,end:number,depth:number):Node=>{
      const box=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(let j=start;j<end;j++){const id=this.indices[j]*6;for(let a=0;a<3;a++){box[a]=Math.min(box[a],this.boxes[id+a]);box[a+3]=Math.max(box[a+3],this.boxes[id+a+3]);}}
      const node:Node={box,start,end};if(end-start<=12||depth>=32)return node;
      const spans=[0,1,2].map(a=>box[a+3]-box[a]),axis=spans.indexOf(Math.max(...spans)),pivot=(box[axis]+box[axis+3])/2;
      let lo=start,hi=end-1;
      while(lo<=hi){const id=this.indices[lo]*6;if((this.boxes[id+axis]+this.boxes[id+axis+3])/2<pivot)lo++;else{[this.indices[lo],this.indices[hi]]=[this.indices[hi],this.indices[lo]];hi--;}}
      const mid=lo===start||lo===end?Math.floor((start+end)/2):lo;node.left=build(start,mid,depth+1);node.right=build(mid,end,depth+1);return node;
    };
    this.root=build(0,triangles.length,0);
  }
  blocked(origin:THREE.Vector3,target:THREE.Vector3,epsilon:number) {
    const direction=target.clone().sub(origin),max=direction.length()-epsilon;direction.normalize();
    const inv=[direction.x,direction.y,direction.z].map(n=>Math.abs(n)<1e-14?Infinity:1/n),coords=origin.toArray();
    const ray=new THREE.Ray(origin,direction),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),hit=new THREE.Vector3();
    const visit=(node:Node):boolean=>{
      let near=0,far=max;
      for(let axis=0;axis<3;axis++){
        if(!Number.isFinite(inv[axis])){if(coords[axis]<node.box[axis]||coords[axis]>node.box[axis+3])return false;continue;}
        let t0=(node.box[axis]-coords[axis])*inv[axis],t1=(node.box[axis+3]-coords[axis])*inv[axis];if(t0>t1)[t0,t1]=[t1,t0];near=Math.max(near,t0);far=Math.min(far,t1);if(near>far)return false;
      }
      if(node.left&&node.right)return visit(node.left)||visit(node.right);
      for(let i=node.start;i<node.end;i++){
        const t=this.triangles[this.indices[i]];a.fromArray(t.points[0]);b.fromArray(t.points[1]);c.fromArray(t.points[2]);
        if(ray.intersectTriangle(a,b,c,false,hit)&&hit.distanceTo(origin)<max)return true;
      }
      return false;
    };
    return visit(this.root);
  }
}
const indices=new WeakMap<readonly ProjectionTriangle[],VisibilityIndex>();

/** Perspective framing uses every box corner, including depth and narrow panels. */
export function uvFocusView(bounds:THREE.Box3,direction:THREE.Vector3,fov:number,aspect:number) {
  const target=bounds.getCenter(new THREE.Vector3()),dir=direction.clone().normalize();
  if(Math.abs(dir.y)>.995)dir.z+=.025;dir.normalize();
  const forward=dir.clone().negate(),right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize(),up=new THREE.Vector3().crossVectors(right,forward).normalize();
  const tanV=Math.tan(THREE.MathUtils.degToRad(fov)/2)*.78,tanH=tanV*Math.max(.1,aspect);
  let distance=.04;const corner=new THREE.Vector3();
  for(let i=0;i<8;i++){corner.set(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z).sub(target);const z=corner.dot(forward);distance=Math.max(distance,Math.abs(corner.dot(right))/tanH-z,Math.abs(corner.dot(up))/tanV-z);}
  return {target:target.toArray() as Vec3,position:target.clone().addScaledVector(dir,distance).toArray() as Vec3};
}

export function planUvFocus(triangles:readonly ProjectionTriangle[],region:UvGuideIsland,view:{position:Vec3;target:Vec3},fov:number,aspect:number,occurrence?:number):UvFocusPlan|null {
  if(!Number.isFinite(fov)||fov<1||fov>150||!Number.isFinite(aspect)||aspect<=0||!view.position.every(Number.isFinite))return null;
  const selected=uvFocusTriangles(triangles,region);if(!selected.length)return null;
  const groups=occurrences(selected);if(!groups.length)return null;
  let index=indices.get(triangles);if(!index){index=new VisibilityIndex(triangles);indices.set(triangles,index);}
  const visibilityDistance=Math.max(...[0,1,2].map(axis=>index.root.box[axis+3]-index.root.box[axis]))*3+.1;
  let best:{score:number;plan:UvFocusPlan}|null=null;
  for(const [instance,group] of groups.entries()){
    if(occurrence!==undefined&&instance!==((occurrence%groups.length)+groups.length)%groups.length)continue;
    const current=v(view.position).sub(group.center).normalize();
    const dirs=[current,group.normal,new THREE.Vector3(0,1,.05),new THREE.Vector3(0,-1,.05)];
    for(let i=0;i<12;i++){const z=1-2*(i+.5)/12,r=Math.sqrt(1-z*z),angle=i*2.3999632297;dirs.push(new THREE.Vector3(r*Math.cos(angle),z,r*Math.sin(angle)));}
    if(group.normal.lengthSq()>.5){for(const axis of [new THREE.Vector3(.45,.2,0),new THREE.Vector3(-.45,.2,0),new THREE.Vector3(0,.2,.45),new THREE.Vector3(0,.2,-.45)])dirs.push(group.normal.clone().add(axis).normalize());}
    const ranked=group.ranked,samples=Array.from({length:Math.min(16,ranked.length)},(_,i)=>ranked[Math.floor(i*ranked.length/Math.min(16,ranked.length))]);
    const epsilon=Math.max(1e-5,group.bounds.getSize(new THREE.Vector3()).length()*1e-4);
    for(const dir of dirs){
      if(dir.lengthSq()<.5)continue;
      const framing=uvFocusView(group.bounds,dir,fov,aspect),position=group.center.clone().addScaledVector(dir,visibilityDistance);let seen=0,facing=0,front=0;
      for(const t of samples){const a=v(t.points[0]),b=v(t.points[1]),c=v(t.points[2]),point=a.clone().add(b).add(c).multiplyScalar(1/3);
        const normal=t.normals?v(t.normals[0]).add(v(t.normals[1])).add(v(t.normals[2])).normalize():b.sub(a).cross(c.sub(a)).normalize();
        const incidence=Math.max(0,normal.dot(position.clone().sub(point).normalize()));facing+=incidence;
        if(incidence>.035){front++;if(!index.blocked(position,point,epsilon))seen++;}
      }
      const visible=front?seen/front:0;
      // Visibility dominates. Similar clear angles favour a face-on view and
      // the physical occurrence closest to the user's current viewpoint.
      const score=visible*10+front/samples.length*2+facing/samples.length*.65+dir.dot(current)*.15-Math.log1p(v(view.position).distanceTo(group.center))*.1;
      if(!best||score>best.score)best={score,plan:{...framing,bounds:group.bounds,triangles:group.triangles,visible,occurrence:instance,occurrences:groups.length}};
    }
  }
  return best?.plan??null;
}
