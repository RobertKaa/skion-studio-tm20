import type { ProjectionTriangle, Vec3 } from '../three/decalProjection';
import type { SurfaceLink } from './surfaceLinks';

/** Solve the connected wrap with conformal residuals and a small unit-scale
 * penalty. Local rotation updates prevent a joined accessory from shrinking
 * while preserving the source aspect. Nothing changes the native game UVs. */
export function relaxSurfaceMetric(positions: readonly Vec3[], indices: Uint32Array,
  u: Float64Array, v: Float64Array, pinned: Uint8Array, span: number, geometry: readonly ProjectionTriangle[], signs?: Int8Array, links: readonly SurfaceLink[] = []) {
  const count=positions.length, entries=new Map<number,[number,number]>(),diagonal=new Float64Array(count);
  const density=.02,faces:{ids:number[];gx:number[];gy:number[];area:number;sign:number}[]=[];
  const add=(i:number,j:number,l:number,h:number)=>{const a=Math.min(i,j),b=Math.max(i,j),key=a*count+b;const old=entries.get(key)??[0,0];old[0]+=l;old[1]+=i<j?h:-h;entries.set(key,old);};
  for(let f=0;f<indices.length;f+=3){
    const ids=[indices[f],indices[f+1],indices[f+2]],[p,q,r]=geometry[f/3].points;
    const e1=q.map((x,a)=>x-p[a]),e2=r.map((x,a)=>x-p[a]),l=Math.hypot(...e1);if(l<span*1e-8)continue;
    const a=e1.reduce((s,x,i)=>s+x*e2[i],0)/l,b=Math.sqrt(Math.max(0,e2.reduce((s,x)=>s+x*x,0)-a*a));if(b<span*1e-8)continue;
    const du1=(u[ids[1]]-u[ids[0]])/l,dv1=(v[ids[1]]-v[ids[0]])/l,du2=(u[ids[2]]-u[ids[0]]-du1*a)/b,dv2=(v[ids[2]]-v[ids[0]]-dv1*a)/b;
    const sign=signs?.[f/3]??(du1*dv2-du2*dv1<0?-1:1),gx=[-1/l,1/l,0],gy=[(a/l-1)/b,-a/l/b,1/b],area=l*b/2;
    faces.push({ids,gx,gy,area,sign});
    for(let i=0;i<3;i++)for(let j=i;j<3;j++){
      const copies=i!==j&&ids[i]===ids[j]?2:1;
      add(ids[i],ids[j],copies*(1+density)*area*(gx[i]*gx[j]+gy[i]*gy[j]),sign*area*(gy[i]*gx[j]-gx[i]*gy[j]));
    }
  }
  for(const link of links)for(let a=0;a<3;a++)for(let b=a;b<3;b++){
    const copies=a!==b&&link.nodes[a]===link.nodes[b]?2:1;
    add(link.nodes[a],link.nodes[b],copies*link.weight*link.factors[a]*link.factors[b],0);
  }
  const degree=new Uint32Array(count);
  for(const [key,[l]] of entries){const i=Math.floor(key/count),j=key-i*count;if(i===j)diagonal[i]+=l;else{degree[i]++;degree[j]++;}}
  const offsets=new Uint32Array(count+1);for(let i=0;i<count;i++)offsets[i+1]=offsets[i]+degree[i];
  const neighbors=new Uint32Array(offsets[count]),weights=new Float64Array(offsets[count]),coupling=new Float64Array(offsets[count]),cursor=offsets.slice();
  for(const [key,[l,h]] of entries){const i=Math.floor(key/count),j=key-i*count;if(i!==j){const a=cursor[i]++,b=cursor[j]++;neighbors[a]=j;neighbors[b]=i;weights[a]=weights[b]=l;coupling[a]=h;coupling[b]=-h;}}
  const tether=1e-6,referenceU=u.slice(),referenceV=v.slice(),rhsU=new Float64Array(count),rhsV=new Float64Array(count);
  for(let i=0;i<count;i++){rhsU[i]=tether*diagonal[i]*referenceU[i];rhsV[i]=tether*diagonal[i]*referenceV[i];diagonal[i]*=1+tether;}
  for(const link of links)for(let c=0;c<3;c++){const i=link.nodes[c],weight=link.weight*link.factors[c];rhsU[i]+=weight*link.delta[0];rhsV[i]+=weight*link.delta[1];}
  const phaseU=rhsU.slice(),phaseV=rhsV.slice();
  const ru=new Float64Array(count),rv=new Float64Array(count),du=new Float64Array(count),dv=new Float64Array(count),pu=new Float64Array(count),pv=new Float64Array(count);
  const multiply=(x:Float64Array,y:Float64Array,ox:Float64Array,oy:Float64Array)=>{for(let i=0;i<count;i++){if(pinned[i]){ox[i]=oy[i]=0;continue;}let a=diagonal[i]*x[i],b=diagonal[i]*y[i];for(let e=offsets[i];e<offsets[i+1];e++){const j=neighbors[e],l=weights[e],h=coupling[e];a+=l*x[j]+h*y[j];b+=l*y[j]-h*x[j];}ox[i]=a;oy[i]=b;}};
  for(let pass=0;pass<6;pass++){
  rhsU.set(phaseU);rhsV.set(phaseV);
  for(const {ids,gx,gy,area,sign} of faces){
    let j00=0,j01=0,j10=0,j11=0;for(let c=0;c<3;c++){const i=ids[c];j00+=gx[c]*u[i];j01+=gy[c]*u[i];j10+=gx[c]*v[i];j11+=gy[c]*v[i];}
    const a=j00+sign*j11,b=j10-sign*j01,length=Math.hypot(a,b),cos=length>1e-12?a/length:1,sin=length>1e-12?b/length:0;
    for(let c=0;c<3;c++){const i=ids[c];rhsU[i]+=density*area*(gx[c]*cos-gy[c]*sign*sin);rhsV[i]+=density*area*(gx[c]*sin+gy[c]*sign*cos);}
  }
  multiply(u,v,pu,pv);let energy=0,initial=0;
  for(let i=0;i<count;i++){const a=ru[i]=pinned[i]?0:rhsU[i]-pu[i],b=rv[i]=pinned[i]?0:rhsV[i]-pv[i],d=Math.max(1e-12,diagonal[i]);du[i]=a/d;dv[i]=b/d;energy+=(a*a+b*b)/d;initial+=a*a+b*b;}
  for(let iteration=0;iteration<(pass===0?1400:400)&&energy>1e-20;iteration++){
    multiply(du,dv,pu,pv);let denominator=0;for(let i=0;i<count;i++)denominator+=du[i]*pu[i]+dv[i]*pv[i];if(denominator<=1e-20)break;
    const step=energy/denominator;let next=0,norm=0;
    for(let i=0;i<count;i++)if(!pinned[i]){u[i]+=step*du[i];v[i]+=step*dv[i];ru[i]-=step*pu[i];rv[i]-=step*pv[i];const square=ru[i]*ru[i]+rv[i]*rv[i];next+=square/Math.max(1e-12,diagonal[i]);norm+=square;}
    if(norm<initial*1e-9+1e-18)break;const beta=next/energy;
    for(let i=0;i<count;i++)if(!pinned[i]){const d=Math.max(1e-12,diagonal[i]);du[i]=ru[i]/d+beta*du[i];dv[i]=rv[i]/d+beta*dv[i];}energy=next;
  }
  }
}

