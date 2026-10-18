import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { previewMeshMaterialSlot } from '../src/three/materialSlots';
import { getSurfaceCoordinates } from '../src/materials/surfaceCoordinates';
import type { ProjectionTriangle } from '../src/three/decalProjection';

// Same static geometry, family detection and 4.2-unit fit as CarPreview. No
// image/network loading: this regression measures the mesh's physical metric.
const originalLoader=THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load=function(){return new THREE.Texture();};
const bytes=readFileSync('public/models/car/StadiumCAR2020_OffsetFix.fbx');
let model:THREE.Group;
try {model=new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
finally {THREE.TextureLoader.prototype.load=originalLoader;}
const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());model.scale.setScalar(4.2/Math.max(size.x,size.y,size.z));
box.setFromObject(model);const center=box.getCenter(new THREE.Vector3());model.position.set(-center.x,-box.min.y,-center.z);model.updateMatrixWorld(true);
const geometry:ProjectionTriangle[]=[];
model.traverse(object=>{
 if(!(object instanceof THREE.Mesh))return;
 const material=Array.isArray(object.material)?object.material[0]:object.material;
 const family=previewMeshMaterialSlot(material.name,object.name);if(family!=='skin'&&family!=='details'&&family!=='wheels')return;
 const pos=object.geometry.getAttribute('position'),uv=object.geometry.getAttribute('uv'),normal=object.geometry.getAttribute('normal'),index=object.geometry.index;
 if(!pos||!uv)return;
 const nm=new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
 for(let i=0;i<(index?.count??pos.count);i+=3){const ids=[0,1,2].map(o=>index?index.getX(i+o):i+o);
 geometry.push({family,points:ids.map(id=>new THREE.Vector3().fromBufferAttribute(pos,id).applyMatrix4(object.matrixWorld).toArray()) as ProjectionTriangle['points'],
 normals:ids.map(id=>new THREE.Vector3().fromBufferAttribute(normal,id).applyNormalMatrix(nm).toArray()) as ProjectionTriangle['normals'],uv:ids.map(id=>[uv.getX(id),uv.getY(id)]) as ProjectionTriangle['uv']});
 }
});
const surface=getSurfaceCoordinates(geometry),rows:{ratio:number;area:number}[]=[];
geometry.forEach((t,i)=>{
 if(t.family!=='skin')return;
 const p=new THREE.Vector3(...t.points[0]),e1=new THREE.Vector3(...t.points[1]).sub(p),e2=new THREE.Vector3(...t.points[2]).sub(p);
 const l=e1.length(),a=e1.dot(e2)/l,b=Math.sqrt(Math.max(0,e2.lengthSq()-a*a));if(b<1e-8)return;
 const ids=[0,1,2].map(c=>surface.triangleNodes[3*i+c]),u=ids.map(n=>surface.transverse[n]),v=ids.map(n=>surface.longitudinal[n]);
 const j00=(u[1]-u[0])/l,j10=(v[1]-v[0])/l,j01=(u[2]-u[0]-j00*a)/b,j11=(v[2]-v[0]-j10*a)/b;
 const x=j00*j00+j10*j10,y=j01*j01+j11*j11,z=j00*j01+j10*j11,d=Math.sqrt((x-y)**2+4*z*z);
 const max=Math.sqrt(Math.max(0,(x+y+d)/2)),min=Math.sqrt(Math.max(1e-20,(x+y-d)/2));
 assert(Number.isFinite(max/min));rows.push({ratio:max/min,area:l*b/2});
});
// Singular-value ratios measure elongation independently of camera angle,
// rotation, source image size or UV-island distortion. Weight by physical area.
const total=rows.reduce((s,r)=>s+r.area,0),ordered=rows.toSorted((a,b)=>a.ratio-b.ratio);
const percentile=(fraction:number)=>{let sum=0;for(const row of ordered){sum+=row.area;if(sum>=fraction*total)return row.ratio;}return Infinity;};
assert(total>5,'The actual body, including side panels, must be inspected');
// Joining a doubly curved body needs some strain. These limits apply to the
// connected wrap, alongside the seam checks below; isolated conformal islands
// can score better while placing completely different texels at their joins.
assert(percentile(.5)<1.03,`Median motif elongation ${percentile(.5)} must remain below 3%`);
assert(percentile(.9)<1.1,`90% of the body must preserve aspect within 10% (${percentile(.9)})`);
assert(percentile(.99)<1.5,'Residual concentrated distortion cannot spread across the car');
assert.equal(surface,getSurfaceCoordinates(geometry),'The bounded solve is cached for subsequent material edits');
console.log(`ok real car proportions: median ${percentile(.5).toFixed(3)}, 90th percentile ${percentile(.9).toFixed(3)} (1 = no elongation)`);

// Reproduce the shoulder/intake failure on the shipped model. Check both
// coincident seam copies and boundaries separated by real clearance gaps.
// The latter often have different subdivisions: comparing vertices alone
// missed the discontinuity visible in the user's checker/circle screenshot.
const points:number[][]=[],pointIds=new Map<string,number>(),parents:number[]=[],corners=new Map<number,{node:number;point:number[]}[]>();
const edges=new Map<string,{a:number;b:number;na:number;nb:number;uses:number}>(),occurrences=new Map<number,Set<number>>();
const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
geometry.forEach((t,f)=>{
 if(t.family!=='skin')return;
 const ids=t.points.map((p,c)=>{
  const key=p.map(x=>Math.round(x/4.2e-6)).join(':');let id=pointIds.get(key);
  if(id===undefined){id=points.length;pointIds.set(key,id);points.push(p);parents.push(id);}
  const node=surface.triangleNodes[3*f+c],list=corners.get(id)??[];
  if(!list.some(x=>x.node===node))list.push({node,point:p});corners.set(id,list);
  const used=occurrences.get(node)??new Set<number>();used.add(id);occurrences.set(node,used);return id;
 });
 for(let c=0;c<3;c++){
  const a=ids[c],b=ids[(c+1)%3];parents[root(b)]=root(a);
  const key=`${Math.min(a,b)}:${Math.max(a,b)}`,old=edges.get(key);
  if(old)old.uses++;else edges.set(key,{a,b,na:surface.triangleNodes[3*f+c],nb:surface.triangleNodes[3*f+(c+1)%3],uses:1});
 }
});
const coord=(node:number)=>[surface.transverse[node],surface.longitudinal[node]];
for(const list of corners.values()){
 const p=list[0].point;if(Math.abs(p[0])>=.95||p[1]<=.45||Math.abs(p[2])>=1.5)continue;
 for(let a=0;a<list.length;a++)for(let b=a+1;b<list.length;b++){
  const one=coord(list[a].node),two=coord(list[b].node);
  assert(Math.hypot(one[0]-two[0],one[1]-two[1])<4.2e-4,'Coincident upper-body seam copies cannot restart the image');
 }
}
// Joined copies are represented by a single node; count their original UV
// copies separately to ensure that this check covers a nonempty body seam.
let sharedCorners=0;const sourceUvs=new Map<string,Set<string>>();
geometry.forEach(t=>{if(t.family==='skin')t.points.forEach((p,c)=>{
 if(Math.abs(p[0])>=.95||p[1]<=.45||Math.abs(p[2])>=1.5)return;
 const key=p.map(x=>Math.round(x/4.2e-6)).join(':'),set=sourceUvs.get(key)??new Set<string>();set.add(t.uv[c].join(':'));sourceUvs.set(key,set);
});});
for(const set of sourceUvs.values())if(set.size>1)sharedCorners++;
assert(sharedCorners>=140,'The actual body UV seams must be covered, even after their nodes have been stitched');
const counts=new Map<number,number>();for(let i=0;i<points.length;i++){const id=root(i);counts.set(id,(counts.get(id)??0)+1);}
const body=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
const boundary=[...edges.values()].filter(e=>e.uses===1&&(occurrences.get(e.na)?.size??0)===1&&(occurrences.get(e.nb)?.size??0)===1);
const bodyEdges=boundary.filter(e=>root(e.a)===body),candidates=new Map<string,{id:number;node:number}>();
for(const edge of boundary)if(root(edge.a)!==body)for(const [id,node] of [[edge.a,edge.na],[edge.b,edge.nb]])candidates.set(`${id}:${node}`,{id,node});
let contacts=0,worst=0;
for(const {id,node} of candidates.values()){
 const p=points[id];if(Math.abs(p[0])<.55||Math.abs(p[0])>1||p[1]<.45||p[2]<-1||p[2]>0)continue;
 let distance=Infinity,nearest:number[]|undefined;
 for(const edge of bodyEdges){
  const a=points[edge.a],b=points[edge.b],d=b.map((x,i)=>x-a[i]),l=d.reduce((s,x)=>s+x*x,0);if(l<1e-18)continue;
  const t=Math.max(0,Math.min(1,d.reduce((s,x,i)=>s+x*(p[i]-a[i]),0)/l)),q=a.map((x,i)=>x+t*d[i]),gap=Math.hypot(...q.map((x,i)=>x-p[i]));
  if(gap<distance){distance=gap;const ca=coord(edge.na),cb=coord(edge.nb);nearest=ca.map((x,i)=>x+t*(cb[i]-x));}
 }
 if(distance>.0084||!nearest)continue;
 const uv=coord(node),gap=Math.hypot(...uv.map((x,i)=>x-nearest![i]));worst=Math.max(worst,gap);
 assert(gap<distance*1.5+.002,`Intake/body join ${p}: ${gap}m texture jump across only ${distance}m clearance`);contacts++;
}
assert(contacts>=40,'Both real intake boundaries must be checked, including unmatched segment subdivisions');
console.log(`ok real car seams: ${sharedCorners} coincident boundaries, ${contacts} intake contacts; max physical texture step ${(worst*1000).toFixed(1)}mm`);
