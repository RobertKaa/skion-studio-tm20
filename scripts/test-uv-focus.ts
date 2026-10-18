import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEnv } from 'fabric/node';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CarPreview, type UvPreviewFocus } from '../src/three/CarPreview';
import { planUvFocus, uvFocusTriangles } from '../src/three/uvFocus';
import type { ProjectionTriangle, Vec3 } from '../src/three/decalProjection';
import type { UvGuideIsland } from '../src/uvGuideData';
import { paintIslandsForModel } from '../src/blenderParts';
import { organizedUvParts } from '../src/uvParts';
const region:UvGuideIsland={key:'test',family:'skin',label:'Pièce test',polygons:[[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]]};
const view={position:[3,2,4] as Vec3,target:[0,0,0] as Vec3};
const panel=(x=0,z=0):ProjectionTriangle[]=>[
  {family:'skin',points:[[x-.3,-.2,z],[x+.3,-.2,z],[x+.3,.2,z]],uv:[[0,0],[1,0],[1,1]],normals:[[0,0,1],[0,0,1],[0,0,1]]},
  {family:'skin',points:[[x-.3,-.2,z],[x+.3,.2,z],[x-.3,.2,z]],uv:[[0,0],[1,1],[0,1]],normals:[[0,0,1],[0,0,1],[0,0,1]]},
];
function triangles(geometry:THREE.BufferGeometry,family:ProjectionTriangle['family'],matrix=new THREE.Matrix4()):ProjectionTriangle[]{
  const position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv'),normal=geometry.getAttribute('normal'),index=geometry.index;
  return Array.from({length:(index?.count??position.count)/3},(_,i)=>{const ids=[0,1,2].map(j=>index?index.getX(i*3+j):i*3+j);return {family,
    points:ids.map(j=>new THREE.Vector3().fromBufferAttribute(position,j).applyMatrix4(matrix).toArray()) as ProjectionTriangle['points'],
    uv:ids.map(j=>[uv?.getX(j)??0,uv?.getY(j)??0]) as ProjectionTriangle['uv'],
    normals:ids.map(j=>new THREE.Vector3().fromBufferAttribute(normal,j).toArray()) as ProjectionTriangle['normals']};});
}
const front=planUvFocus(panel(),region,view,45,1)!;assert(front&&front.visible===1);assert(front.position[2]>0,'Camera chooses the actual front side');
const shared=[...panel(-1),...panel(1)],before=JSON.stringify(shared);
const sharedPlan=planUvFocus(shared,region,{position:[3,0,4],target:[0,0,0]},45,1)!;
assert.equal(sharedPlan.occurrences,2);assert(sharedPlan.target[0]>.5,'Repeated UV chooses the physical occurrence nearest the current view');
const next=planUvFocus(shared,region,view,45,1,1-sharedPlan.occurrence)!;assert(next.target[0]<-.5);assert.equal(JSON.stringify(shared),before);
const shell=triangles(new THREE.BoxGeometry(2,2,2),'details');
const hidden=planUvFocus([...panel(),...shell],region,view,45,1)!;assert.equal(hidden.visible,0,'A fully enclosed part is detected from outside, even if a close camera could fit inside the shell');
const roof=triangles(new THREE.PlaneGeometry(3,3),'details',new THREE.Matrix4().makeTranslation(0,0,.4));
const side=planUvFocus([...panel(),...roof],region,view,45,1)!;assert(side.visible>.5,'A partly covered part searches for a clear angle');
assert.equal(planUvFocus(panel(),{...region,family:'wheels'},view,45,1),null);
assert.equal(planUvFocus(panel(),{...region,polygons:[[{x:NaN,y:0}]]},view,45,1),null);
assert.equal(planUvFocus(panel(),region,view,NaN,1),null);
const hole={...region,fillRule:'evenodd' as const,polygons:[region.polygons[0],[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]]};
assert.equal(uvFocusTriangles(panel(),hole).length,0,'A hole is not a selectable surface');
for(const aspect of [.7,1,2.1]){const plan=planUvFocus(panel(),region,view,45,aspect)!,camera=new THREE.PerspectiveCamera(45,aspect,.001,100);camera.position.fromArray(plan.position);camera.lookAt(new THREE.Vector3(...plan.target));camera.updateMatrixWorld();for(const t of plan.triangles)for(const p of t.points){const q=new THREE.Vector3(...p).project(camera);assert(Math.abs(q.x)<.82&&Math.abs(q.y)<.82,'The actual 3D part fits a narrow or wide desktop preview');}}
console.log('✓ UV focus: origin/holes, nearest repeated occurrence, alternate angles, enclosed-part detection and perspective framing');

Object.assign(globalThis,{document:getEnv().document,window:getEnv().window});
const stage=document.createElement('canvas');stage.width=stage.height=640;
const camera=new THREE.PerspectiveCamera(45,1,.02,200);camera.position.set(5,3,6);
const controls=new OrbitControls(camera,stage);controls.maxPolarAngle=Math.PI-.005;controls.enableDamping=true;
const carRoot=new THREE.Group(),scene=new THREE.Scene(),studioRoot=new THREE.Group();scene.add(carRoot);
const raw=readFileSync('public/models/car/StadiumCAR2020_OffsetFix.fbx');
const preview=Object.create(CarPreview.prototype) as CarPreview;let status:UvPreviewFocus|null=null;let snapshotMode=false;
Object.assign(preview,{disposed:false,loadGeneration:0,officialModelBuffer:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),carRoot,scene,studioRoot,modelRoot:null,vehicleRig:null,importedMaterials:[],camera,controls,pendingView:null,previewEnvironment:{venue:'studio',mood:'day'},
  skinMat:new THREE.MeshPhysicalMaterial(),detailsMat:new THREE.MeshStandardMaterial(),wheelsMat:new THREE.MeshStandardMaterial(),glassMat:new THREE.MeshPhysicalMaterial(),surfaceTextures:{setSkinNormalEnabled:()=>{},setOfficialModel:()=>{},setAtlasSource:()=>{}},ambientOcclusion:{setOfficialModel:()=>{},setAtlasSource:()=>{}},illumination:new Map(),coatIntensity:1,
  onUvFocusChange:(value:UvPreviewFocus|null)=>status=value,hideLoadingOverlay:()=>{},showLoadingError:(error:string)=>{throw new Error(error);},
  renderer:{domElement:stage,capabilities:{getMaxAnisotropy:()=>1},render:()=>{if(snapshotMode){const state=preview as unknown as {uvFocus:{root:THREE.Group};modelRoot:THREE.Object3D};assert(!state.uvFocus.root.visible);assert(state.modelRoot.visible);}}},raycaster:new THREE.Raycaster(),pointerNdc:new THREE.Vector2()});
const internals=preview as unknown as {uvFocus:{plan:ReturnType<typeof planUvFocus>;root:THREE.Group};modelRoot:THREE.Object3D;projectionTriangles:readonly ProjectionTriangle[];pickAt(event:PointerEvent):unknown};
try{
  await preview.loadOfficialModel();const original=preview.getViewState(),native=preview.getProjectionTriangles();const modelJson=JSON.stringify(carRoot.toJSON());
  const part=organizedUvParts(paintIslandsForModel(undefined,'skin')).toSorted((a,b)=>b.area-a.area)[0];
  const started=performance.now();assert(preview.focusUvRegion(part.region));assert(status);assert.notDeepEqual(preview.getViewState(),original);assert(internals.uvFocus.plan!.triangles.length>0);
  assert.equal(preview.getProjectionTriangles(),native,'Focus geometry never enters projection/export geometry');
  preview.setUvFocusIsolated(true);assert.equal(status!.isolated,true);assert.equal(internals.modelRoot.visible,false);assert(internals.uvFocus.root.children[0].visible);
  assert.equal(JSON.stringify(carRoot.toJSON()).replace('"visible":false,',''),modelJson.replace('"visible":true,',''),'Only preview visibility changes, never source vertices/materials');
  snapshotMode=true;preview.snapshot(64);snapshotMode=false;assert.equal(internals.modelRoot.visible,false,'Snapshot restores isolation afterwards');
  preview.clearUvFocus();assert.equal(status,null);assert(internals.modelRoot.visible);assert(new THREE.Vector3(...preview.getViewState().position).distanceTo(new THREE.Vector3(...original.position))<1e-10,'Tout revoir restores the previous camera');assert.deepEqual(preview.getViewState().target,original.target);
  assert(!scene.getObjectByName('uv-focus-preview'));assert.equal(camera.near,.02);
  const tread=paintIslandsForModel(undefined,'wheels')[0];assert(preview.focusUvRegion(tread));assert.equal(status!.occurrences,4,'Real FBX tyre UV has four spatially independent occurrences');const first=status!.occurrence;preview.nextUvFocusOccurrence();assert.equal(status!.occurrence,(first+1)%4);
  preview.resetCamera();assert.equal(status,null);assert(internals.modelRoot.visible);
  console.log(`✓ Actual Stadium FBX: mapped piece focus, four tyre occurrences, live isolation, clean snapshot, geometry intact and camera restore (${Math.round(performance.now()-started)} ms)`);
}finally{preview.clearUvFocus(false);controls.dispose();(preview as unknown as {vehicleRig?:{dispose():void};playerDisplay?:{dispose():void}}).vehicleRig?.dispose();(preview as unknown as {playerDisplay?:{dispose():void}}).playerDisplay?.dispose();carRoot.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});}
