import type { RGBAImage } from '../dds';
import type { MaterialDefinition } from './types';

export interface SurfaceReliefSettings {
  source: 'auto' | 'normal' | 'height' | 'combined' | 'none';
  heightStrength: number;
  midpoint: number;
  contrast: number;
  heightOrigin?: 'normal-estimate';
}
export const DEFAULT_SURFACE_RELIEF: SurfaceReliefSettings = { source:'auto',heightStrength:1,midpoint:.5,contrast:1 };
export const surfaceRelief = (definition:MaterialDefinition):SurfaceReliefSettings => definition.surfaceRelief??DEFAULT_SURFACE_RELIEF;
export function calibratedHeight(value:number,definition:MaterialDefinition):number {
  const settings=surfaceRelief(definition);return Math.max(0,Math.min(1,(value-settings.midpoint)*settings.contrast+.5));
}
export function detailSources(definition:MaterialDefinition):{normal:boolean;height:boolean} {
  const mode=surfaceRelief(definition).source,normal=!!definition.textures.normal,height=!!definition.textures.height;
  return {normal:normal&&['auto','normal','combined'].includes(mode),height:height&&(mode==='height'||mode==='combined'||mode==='auto'&&!normal)};
}
/** Differentiate numeric height in its source frame; +Y normals point upward
 * while image rows point downward. Tile edges wrap only in repeat mode. */
export function heightNormals(image:RGBAImage,strength:number,repeat:boolean):RGBAImage {
  if(!Number.isFinite(strength)||strength<0||strength>4||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>4096||image.height>4096||image.data.length!==image.width*image.height*4)throw new Error('Carte de hauteur invalide.');
  const {width:w,height:h}=image,data=new Uint8ClampedArray(image.data.length);
  const sample=(x:number,y:number)=>image.data[((repeat?(y+h)%h:Math.max(0,Math.min(h-1,y)))*w+(repeat?(x+w)%w:Math.max(0,Math.min(w-1,x))))*4]/255;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const nx=-(sample(x+1,y)-sample(x-1,y))*strength*w/32,ny=(sample(x,y+1)-sample(x,y-1))*strength*h/32,length=Math.hypot(nx,ny,1),i=(y*w+x)*4;
    data.set([(nx/length+1)*127.5,(ny/length+1)*127.5,(1/length+1)*127.5,image.data[i+3]],i);
  }
  return{width:w,height:h,data};
}
/** Combine slopes, preserving a flat base and renormalizing the result. */
export function combineDetailNormals(base:RGBAImage,detail:RGBAImage):RGBAImage {
  if(base.width!==detail.width||base.height!==detail.height||base.data.length!==detail.data.length)throw new Error('Dimensions des normales incompatibles.');
  const data=new Uint8ClampedArray(base.data.length);
  for(let i=0;i<data.length;i+=4){const a=[base.data[i]/127.5-1,base.data[i+1]/127.5-1,Math.max(.01,base.data[i+2]/127.5-1)],b=[detail.data[i]/127.5-1,detail.data[i+1]/127.5-1,Math.max(.01,detail.data[i+2]/127.5-1)];
    const x=a[0]*b[2]+b[0]*a[2],y=a[1]*b[2]+b[1]*a[2],z=a[2]*b[2],length=Math.hypot(x,y,z)||1;data.set([(x/length+1)*127.5,(y/length+1)*127.5,(z/length+1)*127.5,base.data[i+3]],i);
  }return{width:base.width,height:base.height,data};
}
