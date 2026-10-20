import type { ProjectionTriangle, Vec3 } from '../three/decalProjection';

export interface SurfaceLink {
  nodes: [number, number, number];
  factors: [number, number, number];
  delta: [number, number];
  weight: number;
  distance: number;
}

/** Native panels have small clearance gaps and different boundary tessellations.
 * Match boundary vertices to segments, rather than assuming matching vertices.
 * Reused atlas texels cannot acquire a second, contradictory placement. */
export function findSurfaceLinks(geometry: readonly ProjectionTriangle[], physicalIndices: Uint32Array,
  indices: Uint32Array, positions: readonly Vec3[], normals: readonly Vec3[], aliased: Uint8Array, span: number): SurfaceLink[] {
  const parents=Uint32Array.from({length:positions.length*3},(_,i)=>i);
  const root=(i:number)=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  type Edge = {a:number;b:number;i:number;j:number;uses:number;family:number;normal:Vec3;crease:boolean};
  const edges=new Map<string,Edge>();
  geometry.forEach((triangle,f)=>{
    const family=triangle.family==='skin'?0:triangle.family==='details'?1:2;
    const p=triangle.points[0],d1=triangle.points[1].map((v,i)=>v-p[i]),d2=triangle.points[2].map((v,i)=>v-p[i]);
    const n:Vec3=[d1[1]*d2[2]-d1[2]*d2[1],d1[2]*d2[0]-d1[0]*d2[2],d1[0]*d2[1]-d1[1]*d2[0]],length=Math.hypot(...n)||1;
    const normal=n.map(v=>v/length) as Vec3;
    for(let c=0;c<3;c++){
      const a=physicalIndices[3*f+c],b=physicalIndices[3*f+(c+1)%3];if(a===b)continue;
      parents[root(b*3+family)]=root(a*3+family);
      const key=`${triangle.family}:${Math.min(a,b)}:${Math.max(a,b)}`,edge=edges.get(key);
      if(edge){edge.uses++;if(Math.max(edge.normal[1],normal[1])>.7&&edge.normal.reduce((s,v,i)=>s+v*normal[i],0)<.85)edge.crease=true;}else{
        if(edges.size>=1_200_000)throw new Error('Les jonctions de ce modèle sont trop complexes pour suivre sa surface.');
        edges.set(key,{a,b,i:indices[3*f+c],j:indices[3*f+(c+1)%3],uses:1,family,normal,crease:false});
      }
    }
  });
  // A painted panel can be a closed thin shell: its upper lip is a crease,
  // not an open mesh edge. Include those lips as additional seam contacts.
  const boundary=[...edges.values()].filter(e=>(e.uses===1||e.crease)&&!aliased[e.i]&&!aliased[e.j]);
  const openNodes=new Set(boundary.filter(edge=>edge.uses===1).flatMap(edge=>[edge.i,edge.j]));
  const gap=span*.006,cells=new Map<string,number[]>(),vertices=new Map<number,{physical:number;family:number}>();let insertions=0;
  for(let e=0;e<boundary.length;e++){
    const edge=boundary[e],p=positions[edge.a],q=positions[edge.b];vertices.set(edge.i,{physical:edge.a,family:edge.family});vertices.set(edge.j,{physical:edge.b,family:edge.family});
    const lo=p.map((x,a)=>Math.floor(Math.min(x,q[a])/gap)),hi=p.map((x,a)=>Math.floor(Math.max(x,q[a])/gap));
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
      if(++insertions>1_200_000)throw new Error('Les jonctions de ce modèle sont trop complexes pour suivre sa surface.');
      const key=`${x}:${y}:${z}`,bucket=cells.get(key)??[];if(bucket.length<256)bucket.push(e);cells.set(key,bucket);
    }
  }
  const result:SurfaceLink[]=[],seen=new Set<number>();let comparisons=0;
  for(const [node,{physical,family}] of vertices){
    const p=positions[physical],n=normals[physical],cell=p.map(x=>Math.floor(x/gap));seen.clear();
    let nearest:Edge|undefined,t=0,best=gap*gap,lip:Edge|undefined,lipT=0,lipBest=(span*.002)**2;
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const candidates=cells.get(`${cell[0]+x}:${cell[1]+y}:${cell[2]+z}`);if(!candidates)continue;
      for(const e of candidates){
        if(seen.has(e))continue;seen.add(e);
        if(++comparisons>8_000_000)throw new Error('Les jonctions de ce modèle sont trop complexes pour suivre sa surface.');
        const edge=boundary[e];if(edge.family!==family||edge.i===node||edge.j===node||root(edge.a*3+family)===root(physical*3+family))continue;
        const a=positions[edge.a],b=positions[edge.b],d=b.map((v,i)=>v-a[i]),length=d.reduce((s,v)=>s+v*v,0);if(length<1e-18)continue;
        const fraction=Math.max(0,Math.min(1,d.reduce((s,v,i)=>s+v*(p[i]-a[i]),0)/length));
        const q=a.map((v,i)=>v+fraction*d[i]),squared=q.reduce((s,v,i)=>s+(v-p[i])**2,0);
        if (edge.uses > 1 && squared > (span*.002)**2) continue;
        // A panel's boundary often belongs to its thin return face. Its normal
        // can oppose the adjacent painted face despite the contours meeting.
        if(edge.uses>1){if(squared<lipBest){lipBest=squared;lip=edge;lipT=fraction;}}
        else if(squared<best){best=squared;nearest=edge;t=fraction;}
      }
    }
    // Preserve the existing open-edge constraints; lip vertices must not add
    // unrelated open-edge links or displace an established intake contact.
    for (const [candidate,fraction,squared] of [[openNodes.has(node)?nearest:undefined,t,best],[lip,lipT,lipBest]] as const) {
      if(!candidate)continue;
      const q=positions[candidate.a].map((v,i)=>v+fraction*(positions[candidate.b][i]-v)),d=p.map((v,i)=>v-q[i]);
      const u:Vec3=Math.hypot(n[0],n[1])>.05?[n[1],-n[0],0]:[1,0,0],v:Vec3=[-n[2]*n[0],-n[2]*n[1],1-n[2]*n[2]];
      const dot=(axis:Vec3)=>d.reduce((s,x,i)=>s+x*axis[i],0)/Math.max(1e-8,Math.hypot(...axis));
      const strength=Math.min(1,(span*.002)**2/Math.max(squared,1e-16));
      // A closed lip already has a stiff thin return. Couple its painted edge
      // without letting those sliver triangles dominate the body's metric.
      result.push({nodes:[node,candidate.i,candidate.j],factors:[1,fraction-1,-fraction],delta:[dot(u),dot(v)],weight:(candidate.uses>1?1:50)*strength*strength,distance:Math.sqrt(squared)});
    }
  }
  return result;
}
