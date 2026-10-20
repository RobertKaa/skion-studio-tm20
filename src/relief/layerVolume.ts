import type { RGBAImage } from '../dds';
import { patchReliefPreview } from './glb';
import { packReliefNormal, unpackReliefNormal, reliefGeometryFamily, reliefVertexKey } from './engine';
import type { PreparedReliefTemplate, ReliefPrototypeResult, ReliefVariant } from './types';
import { validateReliefAtlas } from './height';

/** Find an exact, unique native UV stream. Details-layout patches can move its
 * byte offset, but do not change the Body UV stream in the source atlas. */
function uniqueStream(bytes:Uint8Array,needle:Uint8Array,optional=false):number{
  let found=-1;
  for(let at=bytes.indexOf(needle[0]);at>=0&&at+needle.length<=bytes.length;at=bytes.indexOf(needle[0],at+1)){
    let same=true;for(let i=1;i<Math.min(16,needle.length);i++)if(bytes[at+i]!==needle[i]){same=false;break;}
    if(!same)continue;
    for(let i=16;i<needle.length;i++)if(bytes[at+i]!==needle[i]){same=false;break;}
    if(same){if(found>=0)throw new Error('Le modèle de relief précédent est ambigu.');found=at;}
  }
  if(found<0&&!optional)throw new Error('Le modèle précédent ne correspond pas à la surface de relief.');
  return found;
}

/** Keep volumes already present outside the current material mask. The base
 * must be an app-generated relief in the original UV frame, on the same template. */
export function retainOtherLayerVolumes(template:PreparedReliefTemplate,result:ReliefPrototypeResult,base:{mesh:Uint8Array;variant:ReliefVariant},mask:RGBAImage,vertexUv?:ReadonlyMap<number,readonly number[]>):ReliefPrototypeResult{
  validateReliefAtlas(mask);
  if(base.mesh.length>64*1024*1024||base.mesh[0]!==71||base.mesh[1]!==66||base.mesh[2]!==88||!['standard','normal'].includes(base.variant))throw new Error('Modèle précédent incompatible avec le volume du calque.');
  const source=template.variants[base.variant],previous=new DataView(base.mesh.buffer,base.mesh.byteOffset,base.mesh.byteLength);
  const mesh=result.project.mesh.slice(),out=new DataView(mesh.buffer),variant=result.stats.templateVariant;
  const positions:Float32Array[]=[],normals:Float32Array[]=[];
  const coverage=(u:number,v:number)=>{
    const x=Math.max(0,Math.min(1,u))*(mask.width-1),y=(1-Math.max(0,Math.min(1,v)))*(mask.height-1),a=Math.floor(x),b=Math.floor(y),tx=x-a,ty=y-b;
    const at=(xx:number,yy:number)=>mask.data[(Math.min(yy,mask.height-1)*mask.width+Math.min(xx,mask.width-1))*4+3];
    return at(a,b)*(1-tx)*(1-ty)+at(a+1,b)*tx*(1-ty)+at(a,b+1)*(1-tx)*ty+at(a+1,b+1)*tx*ty;
  };
  // Match the engine's welded UV seams across LODs: one seam cannot open merely
  // because its duplicate lies just outside a painted polygon.
  const touched=new Set<string>();
  if(result.options.mode!=='normal')for(const g of template.manifest.geometries)if(reliefGeometryFamily(g)===(result.options.family??'skin')){const uv=vertexUv?.get(g.visualIndex)??g.uv;for(let i=0;i<g.bodyVertices.length;i++)if(g.bodyVertices[i]&&coverage(uv[i*2],uv[i*2+1])>0)touched.add(reliefVertexKey(g,i));}
  for(const g of template.manifest.geometries){
    const uv=new Uint8Array(Float32Array.from(g.uv).buffer),originalUv=uniqueStream(source,uv);
    let oldUv=uniqueStream(base.mesh,uv,true),from=g.offsets[base.variant],previousCount=g.bodyVertices.length,shift=oldUv-originalUv;
    if(oldUv<0){
      if(!g.legacyVertexCount||!g.legacyOffsets)throw new Error('Le modèle précédent ne correspond pas à la surface de relief.');
      oldUv=uniqueStream(base.mesh,uv.subarray(0,g.legacyVertexCount*8));
      from=g.legacyOffsets[base.variant];previousCount=g.legacyVertexCount;shift=oldUv-g.legacyOffsets[base.variant].uvOffset;
    }
    const to=g.offsets[variant],normalStride=g.normalEncoding==='dec3n'?4:12;
    const p=new Float32Array(g.positions.length),n=new Float32Array(g.normals.length);
    for(let i=0;i<g.bodyVertices.length;i++){
      const keep=g.bodyVertices[i]&&!touched.has(reliefVertexKey(g,i));
      const oldPosition=from.positionOffset+shift+i*12,oldNormal=from.normalOffset+shift+i*normalStride;
      if(i<previousCount&&(oldPosition<0||oldNormal<0||oldPosition+12>base.mesh.length||oldNormal+normalStride>base.mesh.length))throw new Error('Géométrie précédente invalide.');
      if(keep&&i<previousCount){
        const values=[0,1,2].map(axis=>previous.getFloat32(oldPosition+axis*4,true));
        if(values.some(v=>!Number.isFinite(v))||Math.hypot(...values.map((v,k)=>v-g.positions[i*3+k]))>.081)throw new Error('Volume précédent hors des limites.');
        for(let axis=0;axis<3;axis++)out.setFloat32(to.positionOffset+i*12+axis*4,values[axis],true);
        const normal=g.normalEncoding==='dec3n'?unpackReliefNormal(previous.getUint32(oldNormal,true)):[0,1,2].map(axis=>previous.getFloat32(oldNormal+axis*4,true));
        if(normal.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...normal)-1)>.02)throw new Error('Normales précédentes invalides.');
        for(let b=0;b<normalStride;b++)mesh[to.normalOffset+i*normalStride+b]=base.mesh[oldNormal+b];
        if(g.tangents&&to.tangentOffset!==undefined){
          if(from.tangentOffset!==undefined){
            const oldTangent=from.tangentOffset+shift+i*4;
            if(oldTangent<0||oldTangent+4>base.mesh.length)throw new Error('Tangentes précédentes invalides.');
            mesh.set(base.mesh.subarray(oldTangent,oldTangent+4),to.tangentOffset+i*4);
          }else if(g.normalEncoding==='dec3n'&&previous.getUint32(oldNormal,true)!==new DataView(template.variants[variant].buffer,template.variants[variant].byteOffset,template.variants[variant].byteLength).getUint32(to.normalOffset+i*4,true)){
          const tangent=g.tangents.slice(i*3,i*3+3),dot=tangent.reduce((sum,v,k)=>sum+v*normal[k],0),orthogonal=tangent.map((v,k)=>v-dot*normal[k]),length=Math.hypot(...orthogonal);
          if(length>1e-8){const at=to.tangentOffset+i*4;out.setUint32(at,packReliefNormal(orthogonal.map(v=>v/length),out.getUint32(at,true)),true);}
          }
        }
      }
      if(keep&&i>=previousCount){
        const at=(i-previousCount)*2,a=g.parents![at],b=g.parents![at+1];
        for(let axis=0;axis<3;axis++){
          const displacement=(p[a*3+axis]-g.positions[a*3+axis]+p[b*3+axis]-g.positions[b*3+axis])/2;
          out.setFloat32(to.positionOffset+i*12+axis*4,g.positions[i*3+axis]+displacement,true);
        }
      }
      for(let axis=0;axis<3;axis++)p[i*3+axis]=out.getFloat32(to.positionOffset+i*12+axis*4,true);
      const normal=g.normalEncoding==='dec3n'?unpackReliefNormal(out.getUint32(to.normalOffset+i*normalStride,true)):[0,1,2].map(axis=>out.getFloat32(to.normalOffset+i*normalStride+axis*4,true));
      n.set(normal,i*3);
    }
    positions.push(p);normals.push(n);
  }
  return {...result,project:{...result.project,mesh,preview:patchReliefPreview(template.preview,template.manifest.geometries,positions,normals,variant)}};
}
