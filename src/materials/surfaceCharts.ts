import type { ProjectionTriangle, Vec3 } from '../three/decalProjection';

/** Keep each native UV panel intact. Its topology supplies a fold-free chart;
 * physical area sets density and the continuous wrap supplies global phase and
 * orientation. Reprojection still writes the original, unchanged game atlas. */
export function createSurfaceCharts(geometry:readonly ProjectionTriangle[], positions:readonly Vec3[], indices:Uint32Array,u:Float64Array,v:Float64Array) {
 const nodes=new Map<string,number>(),nextIndices=new Uint32Array(indices.length),nextPositions:Vec3[]=[],oldNodes:number[]=[],xy:[number,number][]=[],parents:number[]=[];
 const root=(i:number)=>{let n=i;while(parents[n]!==n)n=parents[n];while(parents[i]!==i){const next=parents[i];parents[i]=n;i=next;}return n;};
 geometry.forEach((triangle,f)=>{
  for(let c=0;c<3;c++){
   // An exported texel is shared by every face using these atlas coordinates.
   // A single chart coordinate prevents overlapping rims/trim from fighting
   // over that texel, even when their physical vertices are far apart.
   const old=indices[3*f+c],uv=triangle.uv[c],key=`${triangle.family}:${Math.round(uv[0]*1e6)}:${Math.round(uv[1]*1e6)}`;let node=nodes.get(key);
   if(node===undefined){node=nextPositions.length;if(node>=200_000)throw new Error('Ce modèle est trop complexe pour conserver les proportions du motif.');nodes.set(key,node);nextPositions.push(positions[old]);oldNodes.push(old);xy.push([uv[0],-uv[1]]);parents.push(node);}
   nextIndices[3*f+c]=node;
  }
  parents[root(nextIndices[3*f+1])]=root(nextIndices[3*f]);parents[root(nextIndices[3*f+2])]=root(nextIndices[3*f]);
 });
 const areas=new Map<number,[number,number]>();
 geometry.forEach((triangle,f)=>{
  const ids=[nextIndices[3*f],nextIndices[3*f+1],nextIndices[3*f+2]],component=root(ids[0]),p=triangle.points[0],e1=triangle.points[1].map((x,a)=>x-p[a]),e2=triangle.points[2].map((x,a)=>x-p[a]);
  const world=Math.hypot(e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0])/2;
  const [a,b,c]=ids.map(i=>xy[i]),atlas=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  const area=areas.get(component)??[0,0];area[0]+=world;area[1]+=atlas;areas.set(component,area);
 });
 const groups=new Map<number,number[]>();for(let i=0;i<nextPositions.length;i++){const component=root(i),group=groups.get(component)??[];group.push(i);groups.set(component,group);}
 const nextU=new Float64Array(nextPositions.length),nextV=new Float64Array(nextPositions.length),pinned=new Uint8Array(nextPositions.length);
 for(const [component,group] of groups){
  const [world,atlas]=areas.get(component)??[0,0],scale=atlas>1e-16?Math.sqrt(world/atlas):1;
  const mean=[0,0,0,0];for(const i of group){mean[0]+=xy[i][0];mean[1]+=xy[i][1];mean[2]+=u[oldNodes[i]];mean[3]+=v[oldNodes[i]];}for(let a=0;a<4;a++)mean[a]/=group.length;
  let a=0,b=0,c=0,d=0;
  for(const i of group){const x=xy[i][0]-mean[0],y=xy[i][1]-mean[1],du=u[oldNodes[i]]-mean[2],dv=v[oldNodes[i]]-mean[3];a+=x*du;b+=y*du;c+=x*dv;d+=y*dv;}
  const sign=Math.hypot(a+d,c-b)>=Math.hypot(a-d,c+b)?1:-1,length=Math.hypot(a+sign*d,c-sign*b),cos=length>1e-16?(a+sign*d)/length:1,sin=length>1e-16?(c-sign*b)/length:0;
  for(const i of group){const x=(xy[i][0]-mean[0])*scale,y=(xy[i][1]-mean[1])*scale;nextU[i]=mean[2]+cos*x-sign*sin*y;nextV[i]=mean[3]+sin*x+sign*cos*y;}
  // Anchor near the chart center rather than an arbitrary corner.
  let anchor=group[0],distance=Infinity;for(const i of group){const value=(xy[i][0]-mean[0])**2+(xy[i][1]-mean[1])**2;if(value<distance){anchor=i;distance=value;}}pinned[anchor]=1;
 }
 return {positions:nextPositions,indices:nextIndices,u:nextU,v:nextV,pinned,oldNodes,groups};
}

/** Normalize physical texel density, then align each intact panel to the
 * global wrap with a rigid transform. Rotation/translation cannot stretch it. */
export function alignSurfaceCharts(geometry:readonly ProjectionTriangle[],charts:ReturnType<typeof createSurfaceCharts>,referenceU:Float64Array,referenceV:Float64Array) {
 const {indices,oldNodes,groups,u,v}=charts,weights=new Float64Array(u.length),areas=new Map<number,[number,number]>(),components=new Uint32Array(u.length);
 for(const [component,group] of groups)for(const node of group)components[node]=component;
 geometry.forEach((triangle,f)=>{
  const ids=[indices[3*f],indices[3*f+1],indices[3*f+2]],p=triangle.points[0],a=triangle.points[1].map((x,i)=>x-p[i]),b=triangle.points[2].map((x,i)=>x-p[i]);
  const world=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;
  const mapped=Math.abs((u[ids[1]]-u[ids[0]])*(v[ids[2]]-v[ids[0]])-(u[ids[2]]-u[ids[0]])*(v[ids[1]]-v[ids[0]]))/2;
  const area=areas.get(components[ids[0]])??[0,0];area[0]+=world;area[1]+=mapped;areas.set(components[ids[0]],area);for(const i of ids)weights[i]+=world/3;
 });
 for(const [component,group] of groups){
  const [world,mapped]=areas.get(component)??[0,0];if(world<1e-16||mapped<1e-16)continue;
  const scale=Math.sqrt(world/mapped),mean=[0,0,0,0];
  for(const i of group){const weight=weights[i];mean[0]+=weight*u[i];mean[1]+=weight*v[i];mean[2]+=weight*referenceU[oldNodes[i]];mean[3]+=weight*referenceV[oldNodes[i]];}for(let a=0;a<4;a++)mean[a]/=world;
  let x=0,y=0;for(const i of group){const a=u[i]-mean[0],b=v[i]-mean[1],c=referenceU[oldNodes[i]]-mean[2],d=referenceV[oldNodes[i]]-mean[3];x+=weights[i]*(a*c+b*d);y+=weights[i]*(a*d-b*c);}
  const length=Math.hypot(x,y),cos=length>1e-16?x/length:1,sin=length>1e-16?y/length:0;
  for(const i of group){const x=(u[i]-mean[0])*scale,y=(v[i]-mean[1])*scale;u[i]=mean[2]+cos*x-sin*y;v[i]=mean[3]+sin*x+cos*y;}
 }
 // Remove numerical cracks at compatible panel joins. This threshold is a
 // fraction of a texel even at 4K; incompatible curves retain their boundary.
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 for(const p of charts.positions)for(let a=0;a<3;a++){low[a]=Math.min(low[a],p[a]);high[a]=Math.max(high[a],p[a]);}
 const tolerance=Math.max(1e-8,...high.map((x,a)=>x-low[a]))*1e-4,duplicates=new Map<number,number[]>();
 for(let i=0;i<oldNodes.length;i++){const group=duplicates.get(oldNodes[i])??[];group.push(i);duplicates.set(oldNodes[i],group);}
 for(const group of duplicates.values()){
  if(group.length<2)continue;const first=group[0];if(group.some(i=>Math.hypot(u[i]-u[first],v[i]-v[first])>tolerance))continue;
  const x=group.reduce((sum,i)=>sum+u[i],0)/group.length,y=group.reduce((sum,i)=>sum+v[i],0)/group.length;for(const i of group){u[i]=x;v[i]=y;}
 }
}
