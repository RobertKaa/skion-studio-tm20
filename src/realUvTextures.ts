import type { RGBAImage } from './dds';
import { encodeDDS } from './dds';
import { drawRealAtlas, drawSourceAtlas, realAtlasLayout, type AtlasSourceLayout } from './realUvAtlas';
import { decodeNormalVectors, buildWheelNormalFile, buildWheelOcclusionFile, isWheelTreadPreset, type WheelSurfaceSettings } from './wheelSurface';
import { decodeAmbientOcclusion } from './three/previewAmbientOcclusion';
import type { Skin3DFile } from './skin3d';
import { splitDetailsSurfaceFiles } from './detailsSidesModel';
const nativeFiles={
 'Details_N.dds':new URL('./assets/model/car/Details_N.dds',import.meta.url),
 'Wheels_N.dds':new URL('./assets/model/car/Wheels_N.dds',import.meta.url),
 'Skin_AO.dds':new URL('./assets/model/car/Skin_AO.dds',import.meta.url),
 'Details_AO.dds':new URL('./assets/model/car/Details_AO.dds',import.meta.url),
 'Wheels_AO.dds':new URL('./assets/model/car/Wheels_AO.dds',import.meta.url),
};
export function reorganizedPixels(image:RGBAImage,family:'skin'|'details'|'wheels',source:AtlasSourceLayout,reverse=false):RGBAImage {
 if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>4096||image.height>4096||image.data.length!==image.width*image.height*4)throw new Error('Texture UV invalide.');
 if(image.data.every((v,i)=>v===image.data[i%4]))return image;
 const original=document.createElement('canvas'),target=document.createElement('canvas');original.width=target.width=image.width;original.height=target.height=image.height;
 const pixels=original.getContext('2d')!.createImageData(image.width,image.height);pixels.data.set(image.data);original.getContext('2d')!.putImageData(pixels,0,0);(reverse?drawSourceAtlas:drawRealAtlas)(target.getContext('2d')!,original,realAtlasLayout(family,source));
 const result=target.getContext('2d')!.getImageData(0,0,image.width,image.height);original.width=original.height=target.width=target.height=1;return{width:image.width,height:image.height,data:result.data};
}
export async function reorganizeSurfaceFiles(files:readonly Skin3DFile[],source:AtlasSourceLayout,native=false,reverse=false):Promise<Skin3DFile[]> {
 const result=new Map(files.map(f=>[f.name.toLowerCase(),f]));
 if(native)for(const [name,url]of Object.entries(nativeFiles))if(!result.has(name.toLowerCase())){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Texture de surface native indisponible.');let file:Skin3DFile={name,data:new Uint8Array(await r.arrayBuffer())};if(source!=='stock'&&/^Details_/i.test(name))file=(await splitDetailsSurfaceFiles([file],false,source))[0];result.set(name.toLowerCase(),file);}
 const output:Skin3DFile[]=[];
 for(const file of result.values()){
  const match=/^(Skin|Details|Wheels)_(N|AO)\.dds$/i.exec(file.name);if(!match){output.push(file);continue;}
  const normal=match[2].toUpperCase()==='N',decoded=normal?decodeNormalVectors(file.data.slice().buffer):decodeAmbientOcclusion(file.data.slice().buffer);if(!decoded)throw new Error(`Texture de surface illisible : ${file.name}`);
  const family=match[1].toLowerCase()==='skin'?'skin':match[1].toLowerCase()==='details'?'details':'wheels';
  const pixels=reorganizedPixels(decoded,family,source,reverse);
  // Unused atlas space must be neutral for bilinear/mip sampling.
  for(let i=0;i<pixels.data.length;i+=4)if(!pixels.data[i+3]){pixels.data[i]=pixels.data[i+1]=normal?128:255;pixels.data[i+2]=255;pixels.data[i+3]=255;}
  output.push({name:file.name,data:new Uint8Array(encodeDDS(pixels,normal?'BC5':'BC4',{colorSpace:'linear'}))});
 }
 return output;
}
const cached=new WeakMap<RGBAImage,Map<string,RGBAImage>>();
export function cachedAtlasPixels(image:RGBAImage,family:'skin'|'details'|'wheels',source:AtlasSourceLayout,normal=true):RGBAImage {
 let values=cached.get(image);if(!values){values=new Map();cached.set(image,values);}const key=`${family}:${source}:${normal}`;let result=values.get(key);if(!result){result=reorganizedPixels(image,family,source);for(let i=0;i<result.data.length;i+=4)if(!result.data[i+3]){result.data[i]=result.data[i+1]=normal?128:255;result.data[i+2]=result.data[i+3]=255;}values.set(key,result);}return result;
}
/** Generated tyre presets use the native chart; imported overrides already use
 * the current model's chart and must never be transformed a second time. */
export async function buildAtlasWheelNormalFile(value:WheelSurfaceSettings,files:readonly Skin3DFile[],official:boolean,source?:AtlasSourceLayout):Promise<Skin3DFile|null>{
 const file=await buildWheelNormalFile(value,files,official||!!source);if(!file||!source||!isWheelTreadPreset(value.mode))return file;
 return(await reorganizeSurfaceFiles([file],source))[0];
}
export async function buildAtlasWheelOcclusionFile(value:WheelSurfaceSettings,official:boolean,source?:AtlasSourceLayout):Promise<Skin3DFile|null>{
 const file=buildWheelOcclusionFile(value,official||!!source);if(!file||!source||!isWheelTreadPreset(value.mode))return file;
 return(await reorganizeSurfaceFiles([file],source))[0];
}
