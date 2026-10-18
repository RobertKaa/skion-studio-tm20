import type { ProjectionTriangle, Vec3 } from '../three/decalProjection';
import type { createSurfaceCharts } from './surfaceCharts';
import { findSurfaceLinks } from './surfaceLinks';

type Charts = ReturnType<typeof createSurfaceCharts>;

/** Connect physical seams before the final metric solve. Native UVs determine
 * where the output is written, not where the cloth restarts on the car. */
export function joinSurfaceSeams(geometry: readonly ProjectionTriangle[], charts: Charts, physicalIndices: Uint32Array,
  physicalPositions: readonly Vec3[], physicalNormals: readonly Vec3[], span: number) {
  const count=charts.u.length,parents=Uint32Array.from({length:count},(_,i)=>i),owner=new Uint32Array(count);
  const root=(i:number)=>{let n=i;while(parents[n]!==n)n=parents[n];while(parents[i]!==i){const next=parents[i];parents[i]=n;i=next;}return n;};
  for(const [component,group] of charts.groups)for(const node of group)owner[node]=component;
  const physicalNodes=new Map<number,Set<number>>(),firstPhysical=new Int32Array(count).fill(-1),aliased=new Uint8Array(count);
  for(let corner=0;corner<physicalIndices.length;corner++){
    const physical=physicalIndices[corner],node=charts.indices[corner];
    const nodes=physicalNodes.get(physical)??new Set<number>();nodes.add(node);physicalNodes.set(physical,nodes);
    if(firstPhysical[node]<0)firstPhysical[node]=physical;
    else if(Math.hypot(...physicalPositions[physical].map((x,a)=>x-physicalPositions[firstPhysical[node]][a]))>span*1e-5)aliased[node]=1;
  }
  let lowY=Infinity,highY=-Infinity;for(const p of physicalPositions){lowY=Math.min(lowY,p[1]);highY=Math.max(highY,p[1]);}
  const cutY=lowY+(highY-lowY)*.3;
  let comparisons=0;
  for(const [physical,nodes] of physicalNodes){
    // Keep an inconspicuous opening on the lower return. Welding a closed
    // body to a plane would collapse it. Reused texels stay canonical instead.
    if(physicalPositions[physical][1]<cutY&&physicalNormals[physical][1]<-.35)continue;
    const candidates=[...nodes].filter(node=>!aliased[node]);
    for(let a=0;a<candidates.length;a++)for(let b=a+1;b<candidates.length;b++){
      if(++comparisons>1_200_000)throw new Error('Les jonctions de ce modèle sont trop complexes pour suivre sa surface.');
      const from=candidates[a],to=candidates[b];
      const smallNativeCut=Math.hypot(charts.u[from]-charts.u[to],charts.v[from]-charts.v[to])<span*.04;
      if(owner[from]!==owner[to]||smallNativeCut)parents[root(to)]=root(from);
    }
  }
  // Preserve each face's unfolding orientation before merging its seam copies.
  const signs=new Int8Array(geometry.length);
  for(let f=0;f<geometry.length;f++){
    const [a,b,c]=[charts.indices[3*f],charts.indices[3*f+1],charts.indices[3*f+2]];
    signs[f]=(charts.u[b]-charts.u[a])*(charts.v[c]-charts.v[a])-(charts.u[c]-charts.u[a])*(charts.v[b]-charts.v[a])<0?-1:1;
  }
  const ids=new Map<number,number>(),remap=new Uint32Array(count),positions:Vec3[]=[],oldNodes:number[]=[],u:number[]=[],v:number[]=[],weights:number[]=[];
  for(let i=0;i<count;i++){
    const component=root(i);let next=ids.get(component);
    if(next===undefined){next=ids.size;ids.set(component,next);positions.push(charts.positions[i]);oldNodes.push(charts.oldNodes[i]);u.push(0);v.push(0);weights.push(0);}
    remap[i]=next;u[next]+=charts.u[i];v[next]+=charts.v[i];weights[next]++;
  }
  for(let i=0;i<u.length;i++){u[i]/=weights[i];v[i]/=weights[i];}
  const indices=Uint32Array.from(charts.indices,i=>remap[i]);
  const aliases=new Uint8Array(u.length);for(let i=0;i<count;i++)if(aliased[i])aliases[remap[i]]=1;
  const contacts=findSurfaceLinks(geometry,physicalIndices,indices,physicalPositions,physicalNormals,aliases,span);
  const links=contacts.filter(link=>link.distance<=span*.002);
  // Final density/alignment must use whole connected wraps, never individual
  // panels: otherwise it would tear apart the newly joined coordinates again.
  const connected=Uint32Array.from({length:u.length},(_,i)=>i);
  const component=(i:number)=>{while(connected[i]!==i){connected[i]=connected[connected[i]];i=connected[i];}return i;};
  for(let f=0;f<indices.length;f+=3){connected[component(indices[f+1])]=component(indices[f]);connected[component(indices[f+2])]=component(indices[f]);}
  for(const link of links)for(const node of link.nodes)connected[component(node)]=component(link.nodes[0]);
  const groups=new Map<number,number[]>();for(let i=0;i<u.length;i++){const key=component(i),group=groups.get(key)??[];group.push(i);groups.set(key,group);}
  const pinned=new Uint8Array(u.length);
  for(const group of groups.values()){
    let anchor=group[0],distance=Infinity;
    for(const i of group){const p=positions[i],score=Math.abs(p[0])+.2*Math.abs(p[2])+.2*(highY-p[1]);if(score<distance){anchor=i;distance=score;}}
    pinned[anchor]=1;
  }
  return {positions,indices,u:Float64Array.from(u),v:Float64Array.from(v),pinned,oldNodes,groups,signs,links,contacts};
}

/** A detached grille or trim does not need to pull and shrink the body cloth.
 * Fit its phase to the adjoining larger wrap with a rigid transform instead. */
export function alignDetachedSurfaceCharts(geometry: readonly ProjectionTriangle[], charts: ReturnType<typeof joinSurfaceSeams>) {
  const {indices,groups,u,v,contacts}=charts,owner=new Uint32Array(u.length),areas=new Map<number,number>();
  for(const [id,group] of groups)for(const node of group)owner[node]=id;
  geometry.forEach((triangle,f)=>{
    const [p,q,r]=triangle.points,a=q.map((x,i)=>x-p[i]),b=r.map((x,i)=>x-p[i]);
    const area=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2,id=owner[indices[3*f]];
    areas.set(id,(areas.get(id)??0)+area);
  });
  const ordered=[...groups.keys()].sort((a,b)=>(areas.get(b)??0)-(areas.get(a)??0));
  const nearby=new Map<number,typeof contacts>();
  for(const link of contacts){
    const [p,a,b]=link.nodes,one=owner[p],two=owner[a];if(one===two||owner[b]!==two)continue;
    const id=(areas.get(one)??0)<(areas.get(two)??0)?one:two;
    const list=nearby.get(id)??[];list.push(link);nearby.set(id,list);
  }
  for(const id of ordered){
    const pairs:{from:number[];to:number[];weight:number}[]=[];
    for(const link of nearby.get(id)??[]){
      const [p,a,b]=link.nodes,one=owner[p],two=owner[a];if(one===two||owner[b]!==two)continue;
      const area=areas.get(id)??0,other=id===one?two:one;if((id!==one&&id!==two)||(areas.get(other)??0)<=area)continue;
      const t=-link.factors[2],vertex=[u[p],v[p]],edge=[(1-t)*u[a]+t*u[b],(1-t)*v[a]+t*v[b]];
      pairs.push(id===one?{from:vertex,to:edge.map((x,i)=>x+link.delta[i]),weight:link.weight}:
        {from:edge,to:vertex.map((x,i)=>x-link.delta[i]),weight:link.weight});
    }
    if(!pairs.length)continue;
    const mean=[0,0,0,0];let total=0;
    for(const {from,to,weight} of pairs){total+=weight;for(let i=0;i<2;i++){mean[i]+=weight*from[i];mean[i+2]+=weight*to[i];}}
    for(let i=0;i<4;i++)mean[i]/=total;
    let a=0,b=0;for(const {from,to,weight} of pairs){const x=from[0]-mean[0],y=from[1]-mean[1],p=to[0]-mean[2],q=to[1]-mean[3];a+=weight*(x*p+y*q);b+=weight*(x*q-y*p);}
    const length=Math.hypot(a,b),cos=length>1e-12?a/length:1,sin=length>1e-12?b/length:0;
    for(const node of groups.get(id)!){const x=u[node]-mean[0],y=v[node]-mean[1];u[node]=mean[2]+cos*x-sin*y;v[node]=mean[3]+sin*x+cos*y;}
  }
}
