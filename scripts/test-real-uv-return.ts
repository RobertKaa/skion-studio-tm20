import assert from 'node:assert/strict';
import { FabricImage, StaticCanvas, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { atlasCoordinateMap, drawSourceAtlas, realAtlasLayout } from '../src/realUvAtlas';
import { atlasPoint } from '../src/uvAtlasLayout';
import { createMaterialDefinition, isValidMaterialLayer, type MaterialLayer } from '../src/materials/types';
import { renderMaterialLayer } from '../src/materials/render';
import { createTextureBackground, readTextureBackground, updateTextureBackground, validTextureBackgroundSettings } from '../src/editor/textureBackground';
import { createHeightSampler } from '../src/relief/heightSource';
setEnv(getEnv());const env=getEnv();Object.assign(globalThis,{document:env.document,window:env.window,HTMLImageElement:env.window.HTMLImageElement,HTMLCanvasElement:env.window.HTMLCanvasElement});
const pixel=(canvas:HTMLCanvasElement,p:{x:number;y:number})=>[...canvas.getContext('2d')!.getImageData(Math.floor(p.x*canvas.width),Math.floor(p.y*canvas.height),1,1).data];
const release=(maps:ReturnType<typeof renderMaterialLayer>)=>{for(const canvas of maps.values())canvas.width=canvas.height=1;};
const source=document.createElement('canvas');source.width=source.height=64;const ctx=source.getContext('2d')!;
ctx.fillStyle='#ff2494';ctx.fillRect(0,0,32,64);ctx.fillStyle='#2ac2b3';ctx.fillRect(32,0,32,64);
const png=source.toDataURL();
// Crop optimization must retain the former full-image inverse, including the
// bilinear footprint beyond each fractional chart boundary.
const reference=document.createElement('canvas'),cropped=document.createElement('canvas');reference.width=reference.height=cropped.width=cropped.height=128;
const ref=reference.getContext('2d')!,layout=realAtlasLayout('skin');
for(const p of layout.placements){const b=p.bounds,[a,bb,c,d,e,f]=p.matrix,det=a*d-bb*c;ref.save();ref.scale(128,128);ref.transform(d/det,-bb/det,-c/det,a/det,(c*f-d*e)/det,(bb*e-a*f)/det);ref.beginPath();ref.rect(b.x,b.y,b.w,b.h);ref.clip();ref.drawImage(source,0,0,1,1);ref.restore();}
drawSourceAtlas(cropped.getContext('2d')!,source,layout);const expected=ref.getImageData(0,0,128,128).data,actual=cropped.getContext('2d')!.getImageData(0,0,128,128).data;
assert(actual.every((value,i)=>Math.abs(value-expected[i])<=6)&&actual.reduce((n,value,i)=>n+Number(Math.abs(value-expected[i])>1),0)<actual.length*.002,'Cropped inverse preserves full-image sampling within subpixel raster rounding');
for(const layout of ['stock','underbody-panel-v1','independent-v1'] as const)for(const family of ['skin','details','wheels'] as const){
 console.log(`Checking return ${layout}/${family}`);
 const coordinate=atlasCoordinateMap(family,layout),placements=realAtlasLayout(family,layout).placements;
 const def=createMaterialDefinition('solid');def.color='#ce2488';def.normalStrength=1;
 const layer:MaterialLayer={definition:def,family,regions:[],exclusions:[]};
 const authored=renderMaterialLayer(layer,256),restored=renderMaterialLayer({...layer,organizedAtlas:layout},256,[]);
 let checked=0;
 for(const p of placements){const q={x:p.part.bounds.x+p.part.bounds.w*.43,y:p.part.bounds.y+p.part.bounds.h*.43},target=atlasPoint(p,q),[u,v]=coordinate(q.x,1-q.y);
  if(Math.hypot(u-target.x,1-v-target.y)>1e-7||q.x<0||q.y<0||q.x>=1||q.y>=1)continue;
  for(const [channel,image] of authored){const a=pixel(image,target),b=pixel(restored.get(channel)!,q);assert(a.every((value,i)=>Math.abs(value-b[i])<4),`${layout}/${family}/${channel} keeps its value on the car`);}
  if(++checked===3)break;
 }
 assert(checked>0);release(authored);release(restored);
 const canvas=new StaticCanvas(undefined,{width:512,height:512,enableRetinaScaling:false,renderOnAddRemove:false});
 try{canvas.backgroundImage=createTextureBackground(await FabricImage.fromURL(png),512,512,'#000000',{name:'Ajout après réorganisation.png',fit:'contain',colorOpacity:0,uvAtlas:{family,source:layout,reverse:true}});
  canvas.renderAll();const saved=readTextureBackground(canvas)!;assert.equal(saved.src,png);assert.equal(saved.uvAtlas!.reverse,true);
  await canvas.loadFromJSON(canvas.toObject(['textureBackground']));
  assert.equal(readTextureBackground(canvas)!.uvAtlas!.reverse,true,'Inverse background frame survives project serialization');
  updateTextureBackground(canvas,{fit:'stretch',colorOpacity:.2});assert.equal(readTextureBackground(canvas)!.src,png,'New background source remains recadrable after return');
 }finally{await canvas.dispose();}
}
const def=createMaterialDefinition();def.textures.height={src:png,name:'Hauteur.png',component:'r',invert:false};def.transform.size=1200;
const layer:MaterialLayer={definition:def,family:'skin',regions:[],exclusions:[]};
const mask={width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])},field={width:2,height:2,bits:16 as const,values:new Float32Array([.125,.125+1/65535,.75,.875])};
const authored=createHeightSampler(field,layer,mask),returned=createHeightSampler(field,{...layer,organizedAtlas:'stock'},mask),map=atlasCoordinateMap('skin','stock');
for(const [u,v] of [[.3,.25],[.4,.4],[.6,.7]])assert.equal(returned(u,v),authored(...map(u,v)),'Numeric height retains its original 16-bit samples and placement after returning');
assert(!isValidMaterialLayer({...layer,nativeAtlas:'stock',organizedAtlas:'stock'}),'Conflicting coordinate frames rejected');
assert(!isValidMaterialLayer({...layer,organizedAtlas:'unknown'}));
assert(!validTextureBackgroundSettings({name:'unsafe',fit:'cover',colorOpacity:0,uvAtlas:{family:'skin',source:'stock',reverse:'yes'}}));
console.log('✓ UV return: all three layouts/families, material channels, new background/serialization/framing, numeric heights and strict metadata validation');
