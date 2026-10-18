import type { ProjectionTriangle, Vec3 } from '../three/decalProjection';
import { relaxSurfaceMetric } from './surfaceMetric';
import { createSurfaceCharts, alignSurfaceCharts } from './surfaceCharts';
import { joinSurfaceSeams, alignDetachedSurfaceCharts } from './surfaceSeams';

export interface SurfaceCoordinates {
  triangleNodes: Uint32Array;
  transverse: Float64Array;
  longitudinal: Float64Array;
  min: [number, number];
  max: [number, number];
}
const cache = new WeakMap<readonly ProjectionTriangle[], SurfaceCoordinates>();
const MAX_NODES = 200_000, MAX_EDGES = 1_200_000;
const fail = () => { throw new Error('Ce modèle est trop complexe pour suivre sa surface. Utilisez une projection depuis une vue.'); };
const dot = (a: number[], b: number[]) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit = (v: number[]): Vec3 => { const length = Math.hypot(...v) || 1; return v.map(value=>value/length) as Vec3; };

/** Build a common tangent wrap, stitch matching physical boundaries, then
 * jointly minimize distortion. Native UV islands only address the game atlas;
 * they no longer restart the material's phase on each body panel. */
export function getSurfaceCoordinates(geometry: readonly ProjectionTriangle[]): SurfaceCoordinates {
  const previous = cache.get(geometry); if (previous) return previous;
  if (!geometry.length || geometry.length>500_000) return fail();
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(const triangle of geometry)for(const point of triangle.points)for(let axis=0;axis<3;axis++){
    if(!Number.isFinite(point[axis]) || Math.abs(point[axis])>1e6)throw new Error('Coordonnées de surface invalides.');
    low[axis]=Math.min(low[axis],point[axis]);high[axis]=Math.max(high[axis],point[axis]);
  }
  const span=Math.max(1e-6,...high.map((v,i)=>v-low[i])),tolerance=Math.max(1e-7,span*1e-6);
  const centerX=(low[0]+high[0])/2,centerZ=(low[2]+high[2])/2;
  const vertices=new Map<string,number>(),positions:Vec3[]=[],normals:Vec3[]=[],parents:number[]=[],edgeSet=new Set<number>(),rawEdges:number[]=[];
  let triangleNodes=new Uint32Array(geometry.length*3);
  const root=(node:number)=>{let current=node;while(parents[current]!==current)current=parents[current];while(parents[node]!==node){const next=parents[node];parents[node]=current;node=next;}return current;};
  geometry.forEach((triangle,index)=>{
    const [p,q,r]=triangle.points,a=q.map((v,i)=>v-p[i]),b=r.map((v,i)=>v-p[i]);
    const face=unit([a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]);
    for(let corner=0;corner<3;corner++){
      const point=triangle.points[corner],key=point.map(v=>Math.round(v/tolerance)).join(':');let node=vertices.get(key);
      if(node===undefined){node=positions.length;if(node>=MAX_NODES)return fail();vertices.set(key,node);positions.push([...point]);parents.push(node);normals.push([0,0,0]);}
      triangleNodes[index*3+corner]=node;const normal=triangle.normals?.[corner]??face;
      for(let axis=0;axis<3;axis++)normals[node][axis]+=normal[axis];
    }
    for(let corner=0;corner<3;corner++){
      const first=triangleNodes[index*3+corner],second=triangleNodes[index*3+(corner+1)%3];if(first===second)continue;
      const from=Math.min(first,second),to=Math.max(first,second),key=from*MAX_NODES+to;if(edgeSet.has(key))continue;
      if(edgeSet.size>=MAX_EDGES)return fail();edgeSet.add(key);rawEdges.push(from,to);
    }
  });
  const count=positions.length,directionsU:Vec3[]=[],directionsV:Vec3[]=[];
  for(let node=0;node<count;node++){
    const n=normals[node]=unit(normals[node]);
    // +U runs rightward on the roof, then downward on the right side.
    directionsU.push(Math.hypot(n[0],n[1])>.05?unit([n[1],-n[0],0]):unit([1-n[0]*n[0],-n[0]*n[1],-n[0]*n[2]]));
    const longitudinal=[-n[2]*n[0],-n[2]*n[1],1-n[2]*n[2]];
    directionsV.push(Math.hypot(...longitudinal)>.05?unit(longitudinal):unit([0,-n[2],n[1]]));
  }
  // Small physical gaps separate trim panels in the native model. Couple close,
  // similarly oriented components so their cloth phase does not restart at
  // every part. Candidate count and total search work remain strictly bounded.
  for(let edge=0;edge<rawEdges.length;edge+=2)parents[root(rawEdges[edge+1])]=root(rawEdges[edge]);
  const components=Uint32Array.from(parents,(_,node)=>root(node));
  const gap=span*.008,buckets=new Map<string,number[]>();
  const cells=positions.map(p=>p.map(v=>Math.floor(v/gap)));
  for(let node=0;node<count;node++){
    const key=cells[node].join(':'),bucket=buckets.get(key)??[];
    if(bucket.length<256)bucket.push(node);buckets.set(key,bucket);
  }
  let comparisons=0;
  bridge: for(let node=0;node<count;node++){
    const cell=cells[node],point=positions[node];let nearest=-1,distance=gap*gap;
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const candidates=buckets.get(`${cell[0]+x}:${cell[1]+y}:${cell[2]+z}`);if(!candidates)continue;
      for(const other of candidates){
        if(++comparisons>8_000_000)break bridge;
        if(components[node]===components[other]||dot(normals[node],normals[other])<.65)continue;
        if(Math.abs(point[0]-centerX)<=tolerance&&Math.abs(positions[other][0]-centerX)<=tolerance&&point[1]<(low[1]+high[1])/2)continue;
        const p=positions[other],squared=(p[0]-point[0])**2+(p[1]-point[1])**2+(p[2]-point[2])**2;
        if(squared<distance){nearest=other;distance=squared;}
      }
    }
    if(nearest>=0){
      const from=Math.min(node,nearest),to=Math.max(node,nearest),key=from*MAX_NODES+to;
      if(!edgeSet.has(key)){if(edgeSet.size>=MAX_EDGES)return fail();edgeSet.add(key);rawEdges.push(from,to);}
    }
  }
  for(let node=0;node<count;node++)parents[node]=node;
  const edges:number[]=[],degrees=new Uint32Array(count);
  for(let edge=0;edge<rawEdges.length;edge+=2){
    const from=rawEdges[edge],to=rawEdges[edge+1],p=positions[from],q=positions[to];
    const crosses=Math.min(p[0],q[0])<centerX-tolerance&&Math.max(p[0],q[0])>=centerX-tolerance;
    const lower=(p[1]+q[1])/2<(low[1]+high[1])/2&&(normals[from][1]+normals[to][1])/2<.15;
    if(crosses&&lower)continue;
    edges.push(from,to);degrees[from]++;degrees[to]++;parents[root(to)]=root(from);
  }
  const offsets=new Uint32Array(count+1);for(let node=0;node<count;node++)offsets[node+1]=offsets[node]+degrees[node];
  const neighbors=new Uint32Array(edges.length),weights=new Float64Array(edges.length),cursor=offsets.slice();
  const diagonal=new Float64Array(count),rhsU=new Float64Array(count),rhsV=new Float64Array(count);
  for(let edge=0;edge<edges.length;edge+=2){
    const from=edges[edge],to=edges[edge+1],delta=positions[to].map((v,i)=>v-positions[from][i]),weight=1/Math.max(tolerance,Math.hypot(...delta));
    const du=dot(unit(directionsU[from].map((v,i)=>v+directionsU[to][i])),delta),dv=dot(unit(directionsV[from].map((v,i)=>v+directionsV[to][i])),delta);
    const forward=cursor[from]++,backward=cursor[to]++;neighbors[forward]=to;neighbors[backward]=from;weights[forward]=weights[backward]=weight;
    diagonal[from]+=weight;diagonal[to]+=weight;rhsU[from]-=weight*du;rhsU[to]+=weight*du;rhsV[from]-=weight*dv;rhsV[to]+=weight*dv;
  }
  const anchors=new Map<number,number>();
  const score=(node:number)=>Math.abs(positions[node][0]-centerX)+.2*Math.abs(positions[node][2]-centerZ)+.2*(high[1]-positions[node][1]);
  for(let node=0;node<count;node++){const component=root(node),old=anchors.get(component);if(old===undefined||score(node)<score(old))anchors.set(component,node);}
  const pinned=new Uint8Array(count);for(const node of anchors.values())pinned[node]=1;
  function solve(rhs:Float64Array,axis:0|2,origin:number){
    const result=Float64Array.from(positions,p=>p[axis]-origin),residual=new Float64Array(count),direction=new Float64Array(count),product=new Float64Array(count);
    const multiply=(input:Float64Array,output:Float64Array)=>{
      for(let node=0;node<count;node++){
        if(pinned[node]){output[node]=0;continue;}let value=diagonal[node]*input[node];
        for(let edge=offsets[node];edge<offsets[node+1];edge++)value-=weights[edge]*input[neighbors[edge]];output[node]=value;
      }
    };
    multiply(result,product);let energy=0,initial=0;
    for(let node=0;node<count;node++)if(!pinned[node]){const value=residual[node]=rhs[node]-product[node];direction[node]=value/Math.max(1e-12,diagonal[node]);energy+=value*direction[node];initial+=value*value;}
    const limit=initial*1e-8+1e-18;
    for(let iteration=0;iteration<320&&energy>1e-20;iteration++){
      multiply(direction,product);let denominator=0;for(let node=0;node<count;node++)denominator+=direction[node]*product[node];if(denominator<=1e-20)break;
      const step=energy/denominator;let nextEnergy=0,norm=0;
      for(let node=0;node<count;node++)if(!pinned[node]){result[node]+=step*direction[node];residual[node]-=step*product[node];nextEnergy+=residual[node]*residual[node]/Math.max(1e-12,diagonal[node]);norm+=residual[node]*residual[node];}
      if(norm<=limit)break;const beta=nextEnergy/energy;
      for(let node=0;node<count;node++)if(!pinned[node])direction[node]=residual[node]/Math.max(1e-12,diagonal[node])+beta*direction[node];energy=nextEnergy;
    }
    if(!result.every(v=>Number.isFinite(v)&&Math.abs(v)<span*100))throw new Error('Le suivi de cette surface ne peut pas être calculé.');return result;
  }
  const referenceU=solve(rhsU,0,centerX),referenceV=solve(rhsV,2,centerZ);
  const independent=createSurfaceCharts(geometry,positions,triangleNodes,referenceU,referenceV);
  const charts=joinSurfaceSeams(geometry,independent,triangleNodes,positions,normals,span);
  triangleNodes=charts.indices;
  const transverse=charts.u,longitudinal=charts.v,min:[number,number]=[Infinity,Infinity],max:[number,number]=[-Infinity,-Infinity];
  relaxSurfaceMetric(charts.positions,triangleNodes,transverse,longitudinal,charts.pinned,span,geometry,charts.signs,charts.links);
  alignSurfaceCharts(geometry,charts,referenceU,referenceV);
  alignDetachedSurfaceCharts(geometry,charts);
  if(!transverse.every(v=>Number.isFinite(v)&&Math.abs(v)<span*100)||!longitudinal.every(v=>Number.isFinite(v)&&Math.abs(v)<span*100))throw new Error('Le suivi de cette surface ne peut pas être calculé.');
  for(let node=0;node<transverse.length;node++){min[0]=Math.min(min[0],transverse[node]);max[0]=Math.max(max[0],transverse[node]);min[1]=Math.min(min[1],longitudinal[node]);max[1]=Math.max(max[1],longitudinal[node]);}
  const result={triangleNodes,transverse,longitudinal,min,max};cache.set(geometry,result);return result;
}
