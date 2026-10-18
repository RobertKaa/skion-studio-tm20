import type { RGBAImage } from '../dds';
import type { PreparedReliefTemplate } from './types';
import { verifyPreparedReliefTemplate } from './template';
import { packReliefNormal } from './engine';
import { patchReliefPreview } from './glb';

/** Research export: encode sampled tangent normals as native vertex normals.
 * No position, topology, shader, UV, skeleton or physics resource is changed.
 * Game visibility must be established with the paired diagnostic archives. */
export async function bakeVertexNormalDiagnostic(template:PreparedReliefTemplate,image:RGBAImage,strength=1){
 if(!Number.isFinite(strength)||strength<0||strength>2||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>4096||image.height>4096||image.data.length!==image.width*image.height*4)throw new Error('Diagnostic de normales invalide.');
 await verifyPreparedReliefTemplate(template);const mesh=template.variants.standard.slice(),view=new DataView(mesh.buffer),changed:number[]=[];
 const normals=template.manifest.geometries.map(g=>{const count=g.positions.length/3,tangents=new Float64Array(count*3),bitangents=new Float64Array(count*3),out=Float32Array.from(g.normals);let written=0;
  for(let f=0;f<g.indices.length;f+=3){const ids=g.indices.slice(f,f+3),p=ids.map(i=>g.positions.slice(i*3,i*3+3)),uv=ids.map(i=>g.uv.slice(i*2,i*2+2)),a=p[1].map((v,k)=>v-p[0][k]),b=p[2].map((v,k)=>v-p[0][k]),u=uv[1][0]-uv[0][0],v=uv[1][1]-uv[0][1],uu=uv[2][0]-uv[0][0],vv=uv[2][1]-uv[0][1],det=u*vv-uu*v;if(Math.abs(det)<1e-12)continue;for(const id of ids)for(let axis=0;axis<3;axis++){tangents[id*3+axis]+=(a[axis]*vv-b[axis]*v)/det;bitangents[id*3+axis]+=(b[axis]*u-a[axis]*uu)/det;}}
  for(let i=0;i<count;i++){if(!g.bodyVertices[i])continue;const n=g.normals.slice(i*3,i*3+3),t=Array.from(tangents.subarray(i*3,i*3+3)),dot=t.reduce((s,x,k)=>s+x*n[k],0);for(let k=0;k<3;k++)t[k]-=dot*n[k];const length=Math.hypot(...t);if(length<1e-10)continue;for(let k=0;k<3;k++)t[k]/=length;
   const cross=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]],sign=cross.reduce((s,x,k)=>s+x*bitangents[i*3+k],0)<0?-1:1,b=cross.map(x=>x*sign);
   const x=Math.max(0,Math.min(image.width-1,g.uv[i*2]*(image.width-1))),y=Math.max(0,Math.min(image.height-1,(1-g.uv[i*2+1])*(image.height-1))),left=Math.floor(x),top=Math.floor(y),tx=x-left,ty=y-top;
   const sample=(c:number)=>{const at=(xx:number,yy:number)=>image.data[(Math.min(image.height-1,yy)*image.width+Math.min(image.width-1,xx))*4+c];return at(left,top)*(1-tx)*(1-ty)+at(left+1,top)*tx*(1-ty)+at(left,top+1)*(1-tx)*ty+at(left+1,top+1)*tx*ty;};
   const weight=sample(3)/255*strength,sx=(sample(0)-128)/127*weight,sy=(sample(1)-128)/127*weight,sz=Math.max(.001,1+((sample(2)-128)/127-1)*Math.min(1,weight)),normal=n.map((v,k)=>v*sz+t[k]*sx+b[k]*sy),norm=Math.hypot(...normal);if(norm<1e-10)continue;
   const values=normal.map(v=>v/norm);if(values.every((v,k)=>Math.abs(v-n[k])<1e-6))continue;out.set(values,i*3);written++;
   const offset=g.offsets.standard.normalOffset+i*(g.normalEncoding==='dec3n'?4:12);if(g.normalEncoding==='dec3n')view.setUint32(offset,packReliefNormal(values,view.getUint32(offset,true)),true);else for(let k=0;k<3;k++)view.setFloat32(offset+k*4,values[k],true);
  }changed.push(written);return out;
 });
 return{mesh,preview:patchReliefPreview(template.preview,template.manifest.geometries,template.manifest.geometries.map(g=>Float32Array.from(g.positions)),normals,'standard'),changed};
}
