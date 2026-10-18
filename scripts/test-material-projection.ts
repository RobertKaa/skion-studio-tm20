import assert from 'node:assert/strict';
import { getEnv as browserEnv, setEnv } from 'fabric';
import { getEnv } from 'fabric/node';
import { createMaterialDefinition, isValidMaterialDefinition, type MaterialLayer } from '../src/materials/types';
import { loadMaterialSources, renderMaterialLayer } from '../src/materials/render';
import type { ProjectionTriangle, Vec3 } from '../src/three/decalProjection';
import { exportMaterialPack, importMaterialFilesDetailed } from '../src/materials/import';
import { createProjectedHeightSampler } from '../src/relief/heightSource';
import { getSurfaceCoordinates } from '../src/materials/surfaceCoordinates';
import { materialDragFrame } from '../src/materials/projection';
setEnv(getEnv());
const document=browserEnv().document;
const texture=(src:string)=>({src,name:'pattern.png',component:'r' as const,invert:false});
const image=(width:number,height:number, sample:(x:number,y:number)=>number[])=> {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d')!, pixels=ctx.createImageData(width,height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.data.set(sample(x,y),(y*width+x)*4);
  ctx.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
};
const quad=(points:Vec3[],uv:number[][],family:ProjectionTriangle['family']='skin',normal:Vec3=[0,1,0]):ProjectionTriangle[]=>[ [0,1,2],[0,2,3] ].map(ids=>({family,
  points:ids.map(i=>points[i]) as ProjectionTriangle['points'],uv:ids.map(i=>uv[i]) as ProjectionTriangle['uv'],normals:[normal,normal,normal]}));
const geometry=[
  ...quad([[-1,0,-1],[0,0,-1],[0,0,1],[-1,0,1]],[[.05,.9],[.4,.9],[.4,.1],[.05,.1]]),
  // Its physically adjacent panel has a rotated, mirrored, disconnected UV island.
  ...quad([[0,0,-1],[1,0,-1],[1,0,1],[0,0,1]],[[.55,.1],[.55,.9],[.95,.9],[.95,.1]]),
  ...quad([[-1,0,-1],[0,0,-1],[0,0,1],[-1,0,1]],[[.05,.9],[.4,.9],[.4,.1],[.05,.1]],'details'),
];
const definition=createMaterialDefinition();definition.color='#ffffff';definition.roughness=255;definition.metalness=0;
definition.transform={...definition.transform,projection:'top',mode:'stretch',size:256};
definition.textures.color=texture(image(64,64,(x,y)=>[x*4,y*4,60,255]));
definition.textures.roughness=texture(image(32,32,(x)=>[x*8,0,0,255]));
definition.textures.height=texture(image(128,128,(x)=>[x*2,x*2,x*2,255]));
await loadMaterialSources(definition);
const layer:MaterialLayer={definition,family:'skin',regions:[],exclusions:[]};
const pixel=(canvas:HTMLCanvasElement,x:number,y:number)=>[...canvas.getContext('2d')!.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data];
const release=(maps:Map<string,HTMLCanvasElement>)=>{for(const canvas of maps.values())canvas.width=canvas.height=0;};
let maps=renderMaterialLayer(layer,256,geometry);
const left=pixel(maps.get('color')!,.399,.5), right=pixel(maps.get('color')!,.75,.899);
assert(Math.abs(left[0]-right[0])<3 && Math.abs(left[1]-right[1])<3,`${left} / ${right}: adjacent panels must join in physical space`);
assert(pixel(maps.get('color')!,.2,.5)[0]<pixel(maps.get('color')!,.75,.5)[0], 'Rotated UVs do not turn the illustration');
for(const [x,y] of [[.2,.5],[.75,.5]]) {
  const color=pixel(maps.get('color')!,x,y)[0];
  assert(Math.abs(color-pixel(maps.get('roughmetal')!,x,y)[0])<5);
  assert(Math.abs(color-pixel(maps.get('height')!,x,y)[0])<3);
}
const details=renderMaterialLayer({...layer,family:'details'},256,geometry);
assert.deepEqual(pixel(details.get('color')!,.2,.5),pixel(maps.get('color')!,.2,.5), 'All families use the complete car frame');release(details);
const region={key:'piece',label:'Piece',polygons:[[{x:.05,y:.1},{x:.4,y:.1},{x:.4,y:.9},{x:.05,y:.9}]]};
const masked=renderMaterialLayer({...layer,regions:[region]},256,geometry);
assert.deepEqual(pixel(masked.get('color')!,.2,.5),pixel(maps.get('color')!,.2,.5),'Changing selected pieces never recenters the texture');
assert.equal(pixel(masked.get('color')!,.75,.5)[3],0); release(masked);release(maps);
console.log('ok physical seams, rotated/mirrored islands, shared scale across families, height/PBR alignment and stable masks');

definition.transform.mode='repeat';definition.transform.size=512;
for(const projection of ['top','side','front','triplanar','surface'] as const) {
  definition.transform.projection=projection;
  maps=renderMaterialLayer(layer,128,geometry);
  assert.equal(pixel(maps.get('color')!,.2,.5)[3],255);
  release(maps);
}
definition.transform.projection='triplanar';definition.opacity=.5;
definition.textures.color=texture(image(8,8,()=>[200,100,50,128]));
definition.textures.normal=texture(image(8,8,()=>[200,128,240,255]));
await loadMaterialSources(definition);
maps=renderMaterialLayer(layer,128,geometry);
assert(Math.abs(pixel(maps.get('color')!,.2,.5)[3]-64)<=1,'Color transparency and material opacity apply once');
assert(Math.abs(pixel(maps.get('roughmetal')!,.2,.5)[3]-64)<=1,'Every PBR map shares the same coverage');
const normalLeft=pixel(maps.get('normal')!,.2,.5),normalRight=pixel(maps.get('normal')!,.75,.5);
assert(normalLeft[0]>150 && normalRight[1]>150,'Projected normals follow each island tangent basis instead of the source UV direction');
release(maps);
// Smooth triplanar weighting must have the same value on duplicated seam vertices.
const curved=geometry.map(t=>({...t,normals:t.points.map(p=>{const x=p[0]/2;return [x,Math.sqrt(1-x*x),0] as Vec3;}) as [Vec3,Vec3,Vec3]}));
maps=renderMaterialLayer(layer,256,curved);
assert(Math.abs(pixel(maps.get('color')!,.399,.5)[0]-pixel(maps.get('color')!,.75,.899)[0])<4);release(maps);
console.log('ok repeat/plane modes, smooth triplanar seams, alpha and per-island tangent-space normals');

assert(isValidMaterialDefinition(definition));
for(const projection of ['__proto__',{},NaN]) assert(!isValidMaterialDefinition({...definition,transform:{...definition.transform,projection}}));
assert.throws(()=>renderMaterialLayer(layer,128),/modèle 3D/);
assert.throws(()=>renderMaterialLayer(layer,128,[{...geometry[0],points:[[NaN,0,0],...geometry[0].points.slice(1)] as ProjectionTriangle['points']}]),/Coordonnées/);
const blob=await exportMaterialPack(definition);
const bytes=typeof blob.arrayBuffer==='function' ? await blob.arrayBuffer() : await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new (getEnv().window.FileReader)();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
const imported=await importMaterialFilesDetailed([new File([bytes],'aligned.material.zip',{type:'application/zip'})]);
assert.equal(imported.preservedPlacement,true,'Importing a saved pack never silently chooses a new mapping');
assert.deepEqual(imported.definition.transform,definition.transform,'Material pack roundtrip preserves the 3D placement');
assert.deepEqual(imported.definition.textures.color,definition.textures.color,'The original source image stays intact');
console.log('ok legacy schema compatibility, strict projection validation and editable pack roundtrip');
const numeric=createMaterialDefinition();numeric.transform={...numeric.transform,projection:'top',mode:'stretch',size:256};
numeric.textures.height=texture(definition.textures.height!.src);
const numericLayer={...layer,definition:numeric};
const field={width:2,height:2,bits:16 as const,values:Float32Array.from([.5,.5+1/65535,.5,.5+1/65535])};
const mask=(size:number)=>({width:size,height:size,data:new Uint8ClampedArray(size*size*4).fill(255)});
const sample16=createProjectedHeightSampler(field,numericLayer,mask(16),geometry,1);
assert(Math.abs(sample16(.225,.5))<1e-6);
assert(sample16(.75,.5)>0 && sample16(.75,.5)<1/255,'A sub-byte height step survives 3D placement');
assert(Math.abs(sample16(.4,.5)-sample16(.75,.1))<1e-6,'Duplicated UV seam vertices retain the same numeric height');
const otherQuality=createProjectedHeightSampler(field,numericLayer,mask(32),geometry,1);
assert.equal(otherQuality(.75,.5),sample16(.75,.5),'Changing export quality does not move or quantize projected height');
console.log('ok direct projected PNG16 height, exact numeric seams and independent export resolution');

// A curved body split across disconnected UV islands. Equal steps of angle
// have equal surface distance, even near a vertical side where top projection
// compresses the motif. Duplicated 3D seam points must share their phase.
const curvedBody: ProjectionTriangle[]=[];
for(let segment=0;segment<32;segment++) {
  const t0=-Math.PI/2+segment*Math.PI/32,t1=t0+Math.PI/32;
  const points:Vec3[]=[[Math.sin(t0),Math.cos(t0),-1],[Math.sin(t1),Math.cos(t1),-1],[Math.sin(t1),Math.cos(t1),1],[Math.sin(t0),Math.cos(t0),1]];
  const uvLeft=segment<16 ? .05+segment*.025 : .55+(segment-16)*.025;
  const triangles=quad(points,[[uvLeft,.9],[uvLeft+.025,.9],[uvLeft+.025,.1],[uvLeft,.1]]);
  for(const triangle of triangles)triangle.normals=triangle.points.map(point=>[point[0],point[1],0]) as [Vec3,Vec3,Vec3];
  curvedBody.push(...triangles);
}
const layout=getSurfaceCoordinates(curvedBody);
assert.equal(getSurfaceCoordinates(curvedBody),layout,'Surface coordinates are cached independently of channel, quality and masks');
const first=layout.triangleNodes[0],last=layout.triangleNodes[(curvedBody.length-1)*3+1];
assert(Math.abs(layout.transverse[last]-layout.transverse[first]-Math.PI)<.005,'The wrap follows the half-cylinder arc instead of its projected width');
const intervals:number[]=[];
for(let segment=0;segment<32;segment++) {
  const a=layout.triangleNodes[segment*6],b=layout.triangleNodes[segment*6+1];intervals.push(layout.transverse[b]-layout.transverse[a]);
}
assert(Math.max(...intervals)-Math.min(...intervals)<1e-4,`The bounded surface solve keeps its transverse density: ${Math.min(...intervals)} to ${Math.max(...intervals)}`);
const seamLeft=layout.triangleNodes[15*6+1],seamRight=layout.triangleNodes[16*6];
assert(Math.abs(layout.transverse[seamLeft]-layout.transverse[seamRight])<1e-4 && Math.abs(layout.longitudinal[seamLeft]-layout.longitudinal[seamRight])<1e-4,'Developable UV charts align in physical space without stretching their motifs');
numeric.transform.projection='surface';
const surfaceSamples=createProjectedHeightSampler(field,numericLayer,mask(32),curvedBody,1);
assert(Math.abs(surfaceSamples(.45,.5)-surfaceSamples(.55,.5))<1e-6,'Surface-following height has the same phase on both UV charts');
const normalDefinition=createMaterialDefinition();normalDefinition.color='#ffffff';normalDefinition.transform={...normalDefinition.transform,projection:'surface',mode:'repeat',size:512};
normalDefinition.textures.normal=texture(image(4,4,()=>[200,128,240,255]));
normalDefinition.textures.color=texture(image(4,4,()=>[200,80,30,255]));
await loadMaterialSources(normalDefinition);
maps=renderMaterialLayer({...layer,definition:normalDefinition},256,curvedBody);
const onRoof=pixel(maps.get('normal')!,.44,.5),onSide=pixel(maps.get('normal')!,.93,.5);
assert(onRoof[0]>180 && onSide[0]>180,'A surface normal keeps its intensity on roof and side instead of fading between projections');
assert.deepEqual(pixel(maps.get('color')!,.44,.5),pixel(maps.get('color')!,.93,.5));release(maps);
const originalGeometry=JSON.stringify(curvedBody);getSurfaceCoordinates(curvedBody);assert.equal(JSON.stringify(curvedBody),originalGeometry);
const sideDrag=materialDragFrame('surface',curvedBody,{point:[1,0,0],normal:[1,0,0],tangent:[0,0,1]});
assert(sideDrag.right[1]<-.99 && Math.abs(sideDrag.right[0])<.06,'Dragging follows the actual last surface facet instead of the horizontal projection plane');
const surfacePack=await exportMaterialPack(normalDefinition);
const surfaceBytes=await surfacePack.arrayBuffer();
const surfaceImport=await importMaterialFilesDetailed([new File([surfaceBytes],'surface.skion-material.zip',{type:'application/zip'})]);
assert.equal(surfaceImport.definition.transform.projection,'surface','Surface following survives a portable material pack');
const separatedPanel=curvedBody.map((triangle,index)=>index<48 ? triangle : ({...triangle,points:triangle.points.map(p=>[p[0],p[1]+.003,p[2]]) as ProjectionTriangle['points']}));
const connectedLayout=getSurfaceCoordinates(separatedPanel);
const panelEdge=connectedLayout.triangleNodes[48*3],bodyEdge=connectedLayout.triangleNodes[46*3+1];
assert(Math.abs(connectedLayout.transverse[panelEdge]-connectedLayout.transverse[bodyEdge])<.008,'A trim panel separated by 3mm keeps the neighboring body texture phase');
assert.throws(()=>getSurfaceCoordinates([]),/modèle est trop complexe/);
assert.throws(()=>getSurfaceCoordinates(Array(500001).fill(curvedBody[0])),/modèle est trop complexe/,'Geometry complexity is checked before traversing untrusted models');
console.log('ok curved surface arc length/density, aligned UV seams, single-source color and unfaded roof/side normals');
// A rectangular source must keep its 2:1 format in all surface fits. The
// compatibility path for an old Stretch placement behaves like Cover.
const formatDefinition=createMaterialDefinition();formatDefinition.transform={...formatDefinition.transform,projection:'surface',mode:'stretch',size:256};
const formatLayer={...layer,definition:formatDefinition};
const formatValues=Float32Array.from([0,1,0,1]);
const { createMaterialProjector }=await import('../src/materials/projection');
const formatSampler=createMaterialProjector(formatLayer,geometry,256,{width:200,height:100})!.scalarSampler({width:2,height:2,values:formatValues});
formatDefinition.transform.mode='cover';
const coverSampler=createMaterialProjector(formatLayer,geometry,128,{width:200,height:100})!.scalarSampler({width:2,height:2,values:formatValues});
for(const point of [[.2,.5],[.75,.5],[.399,.5]] as const)assert.equal(formatSampler(...point),coverSampler(...point),'Saved Surface + Stretch respects source aspect at any export resolution');
const verticalSampler=createMaterialProjector(formatLayer,geometry,128,{width:200,height:100})!.scalarSampler({width:2,height:2,values:Float32Array.from([0,0,1,1])});
const du=coverSampler(.3125,.5)-coverSampler(.225,.5),dv=verticalSampler(.225,.4)-verticalSampler(.225,.5);
assert(Math.abs(du/dv-.5)<1e-3,`Equal physical steps preserve the original rectangular image ratio of 2:1 within the numerical solve tolerance (${du/dv})`);
console.log('ok rectangular source aspect and saved Stretch compatibility');

// The surface mapping is independent of the atlas family and stays aligned
// across color/data maps on the roof, slopes and near-vertical walls.
const surfaceDefinition=createMaterialDefinition();surfaceDefinition.color='#ffffff';surfaceDefinition.roughness=255;
surfaceDefinition.transform={...surfaceDefinition.transform,projection:'surface',size:700};
const gradientSource=texture(image(64,64,(x,y)=>[x*4,y*4,30,255]));
surfaceDefinition.textures.color=gradientSource;surfaceDefinition.textures.roughness=gradientSource;
await loadMaterialSources(surfaceDefinition);
let referencePixels:number[][]|undefined;
for(const family of ['skin','details','wheels'] as const){
  const body=curvedBody.map(triangle=>({...triangle,family}));
  const material={...layer,family,definition:surfaceDefinition};
  const rendered=renderMaterialLayer(material,256,body),points=[[.12,.4],[.42,.6],[.72,.4],[.92,.6]];
  const values=points.map(([u,v])=>pixel(rendered.get('color')!,u,v));
  if(referencePixels)assert.deepEqual(values,referencePixels,`${family} uses the same physical texture scale and orientation`);else referencePixels=values;
  for(const [u,v] of points)assert(Math.abs(pixel(rendered.get('color')!,u,v)[0]-pixel(rendered.get('roughmetal')!,u,v)[0])<2,`${family}: roughness follows color on curved surfaces`);
  const flat=renderMaterialLayer({...material,definition:{...surfaceDefinition,transform:{...surfaceDefinition.transform,projection:'uv'}}},256,body);
  assert(points.some(([u,v])=>Math.abs(pixel(flat.get('color')!,u,v)[0]-pixel(rendered.get('color')!,u,v)[0])>15),`${family}: placement must use physical surface coordinates rather than applying a flat image to the atlas`);
  release(rendered);release(flat);
}
console.log('ok geometry-following material and data maps on all three paint families');

// Wheel rims and trim often reuse exactly the same texels on distant or
// rotated faces. They must share a chart coordinate, rather than rasterizing
// conflicting world-space phases into little fragments of the same atlas.
const sharedUv=[[.1,.1],[.9,.1],[.9,.9],[.1,.9]];
const repeatedParts=[
  ...quad([[-2,0,-1],[-1,0,-1],[-1,0,1],[-2,0,1]],sharedUv),
  ...quad([[1,0,-1],[1,1,-1],[1,1,1],[1,0,1]],sharedUv,'skin',[1,0,0]),
  ...quad([[-2,0,-1],[-1,0,-1],[-1,0,1],[-2,0,1]],sharedUv,'details'),
];
const reusedLayout=getSurfaceCoordinates(repeatedParts);
for(let corner=0;corner<3;corner++){
  assert.equal(reusedLayout.triangleNodes[corner],reusedLayout.triangleNodes[6+corner],'Reused skin texels have one mapping even when the physical faces differ');
  assert.notEqual(reusedLayout.triangleNodes[corner],reusedLayout.triangleNodes[12+corner],'Different texture atlases keep independent mappings');
}
console.log('ok coherent reused UVs on distant/rotated parts, without coupling different atlas families');
