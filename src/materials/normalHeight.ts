import type { RGBAImage } from '../dds';
/** Frankot–Chellappa integration: project the normal slopes onto integrable
 * periodic gradients. Absolute scale and mean height cannot be recovered. */
export function estimateNormalHeight(image:RGBAImage,invertY=false):{values:Float32Array;width:number;height:number}{
 const {width:w,height:h,data}=image;
 if(w<2||h<2||w>512||h>512||!Number.isInteger(Math.log2(w))||!Number.isInteger(Math.log2(h))||data.length!==w*h*4||typeof invertY!=='boolean')throw new Error('La reconstruction des normales accepte une image de 2 à 512 pixels par axe, puissance de deux.');
 const fft=(r:Float64Array,i:Float64Array,inverse:boolean)=>{const n=r.length;for(let a=1,b=0;a<n;a++){let bit=n>>1;for(;b&bit;bit>>=1)b^=bit;b^=bit;if(a<b){[r[a],r[b]]=[r[b],r[a]];[i[a],i[b]]=[i[b],i[a]];}}
  for(let size=2;size<=n;size*=2){const angle=(inverse?2:-2)*Math.PI/size,cr=Math.cos(angle),ci=Math.sin(angle);for(let a=0;a<n;a+=size){let wr=1,wi=0;for(let b=0;b<size/2;b++){const p=a+b,q=p+size/2,tr=wr*r[q]-wi*i[q],ti=wr*i[q]+wi*r[q];r[q]=r[p]-tr;i[q]=i[p]-ti;r[p]+=tr;i[p]+=ti;const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;}}}if(inverse)for(let a=0;a<n;a++){r[a]/=n;i[a]/=n;}};
 const transform=(r:Float64Array,i:Float64Array,inverse=false)=>{const rowR=new Float64Array(w),rowI=new Float64Array(w),colR=new Float64Array(h),colI=new Float64Array(h);for(let y=0;y<h;y++){rowR.set(r.subarray(y*w,(y+1)*w));rowI.set(i.subarray(y*w,(y+1)*w));fft(rowR,rowI,inverse);r.set(rowR,y*w);i.set(rowI,y*w);}for(let x=0;x<w;x++){for(let y=0;y<h;y++){colR[y]=r[y*w+x];colI[y]=i[y*w+x];}fft(colR,colI,inverse);for(let y=0;y<h;y++){r[y*w+x]=colR[y];i[y*w+x]=colI[y];}}};
 const gx=new Float64Array(w*h),gy=new Float64Array(w*h),ix=new Float64Array(w*h),iy=new Float64Array(w*h);
 let valid=0;for(let p=0;p<w*h;p++){const at=p*4,nx=(data[at]-128)/127,ny=(data[at+1]-128)/127*(invertY?-1:1),nz=(data[at+2]-128)/127;if(nz>.02&&data[at+3]>0){gx[p]=Math.max(-8,Math.min(8,-nx/nz));gy[p]=Math.max(-8,Math.min(8,ny/nz));valid++;}}
 if(valid<w*h*.5)throw new Error('Cette image ne contient pas assez de normales tangentes valides. Vérifiez son canal et sa convention OpenGL / DirectX.');
 transform(gx,ix);transform(gy,iy);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const u=2*Math.PI*(x<=w/2?x:x-w)/w,v=2*Math.PI*(y<=h/2?y:y-h)/h,den=u*u+v*v,p=y*w+x,re=den?(u*ix[p]+v*iy[p])/den:0,im=den?-(u*gx[p]+v*gy[p])/den:0;gx[p]=re;ix[p]=im;}
 transform(gx,ix,true);let low=Infinity,high=-Infinity;for(const v of gx){low=Math.min(low,v);high=Math.max(high,v);}if(high-low<1e-5)throw new Error('Ces normales sont plates : aucun volume ne peut en être déduit.');
 return{width:w,height:h,values:Float32Array.from(gx,v=>(v-low)/(high-low))};
}
