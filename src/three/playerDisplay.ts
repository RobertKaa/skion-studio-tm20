import * as THREE from 'three';

/**
 * Rear gameplay display from the official Stadium mesh's _SkinDmgDecal_Skin.
 * Positions are in the same centimetres as StadiumCAR2020_OffsetFix.fbx.
 * TexCoord1 is the game's five-slot display atlas: two digits, then three letters.
 * Source SHA-256: fd38647ecd4eec16dd425a862a54902b1be5b2d11a7ddbbec86ff2fc5495b020.
 * Each row: position XYZ, normal XYZ, skin UV, gameplay UV. Keeping the original
 * curved mesh and UVs avoids an approximate floating plane over the rear deck.
 */
const NATIVE_VERTICES = [
  [-12.130488,83.511198,-62.177444,-0.0469667,0.9784736,-0.1937378,0.4657426,0.788357,4.4056225,0.9967958],
  [-6.70041,83.670354,-62.229156,-0.0215264,0.9804305,-0.1937378,0.4811052,0.7882473,4.0006094,0.9967958],
  [-6.70041,82.395113,-68.446499,-0.0215264,0.9765166,-0.2074364,0.4812233,0.8060295,4.0006094,0.6067426],
  [-12.828982,82.207352,-68.378156,-0.0469667,0.9765166,-0.2054795,0.4640079,0.8062834,4.4577031,0.6084405],
  [-6.693021,81.330156,-73.339355,-0.0215264,0.9745597,-0.2172211,0.4813762,0.8200055,4.0006094,0.3010078],
  [-17.955793,83.159894,-62.063307,-0.1037182,0.9765166,-0.18591,0.4491281,0.7885035,4.8399658,0.9967958],
  [-13.37837,81.11518,-73.267424,-0.0489237,0.9745597,-0.2152642,0.4627452,0.8203835,4.4986658,0.3025749],
  [-6.700408,80.218166,-78.129411,-0.0215264,0.9726027,-0.2270059,0.4814982,0.8336741,4.0006094,0.0028439],
  [-13.915379,79.986238,-78.052509,-0.0508806,0.9726027,-0.2250489,0.4615852,0.8341093,4.5387068,0.0028439],
  [-18.890333,81.839228,-68.244171,-0.1056751,0.9726027,-0.1976517,0.4468387,0.8065767,4.9096465,0.6117697],
  [-20.101233,81.669211,-68.182296,-0.148728,0.9686888,-0.1898239,0.4433424,0.8066124,4.9999332,0.6133066],
  [-20.101234,82.855231,-61.964315,-0.183953,0.9667319,-0.1702544,0.4429085,0.7885114,4.9999332,0.9967958],
  [-20.101233,80.657816,-73.114389,-0.1232877,0.9686888,-0.2054795,0.4438608,0.8208801,4.9999332,0.3059084],
  [-20.101233,79.582167,-77.917898,-0.1056751,0.9686888,-0.2191781,0.4444506,0.8346406,4.9999332,0.0028439],
  [-8.842687,70.911276,-112.261558,-0.0273973,0.9530333,-0.295499,0.4758447,0.9313433,1.4399021,0.2091023],
  [1e-06,71.033061,-112.302315,0.0,0.9530333,-0.295499,0.5000005,0.9315711,1.0001106,0.2089631],
  [1e-06,68.440217,-120.323288,0.0,0.9530333,-0.297456,0.5000005,0.954969,1.0001106,0.0028439],
  [-9.281459,68.310672,-120.278919,-0.0273973,0.9530333,-0.295499,0.4744059,0.9547021,1.4617238,0.0028439],
  [1e-06,74.325049,-101.273537,0.0,0.9608611,-0.2739726,0.5000005,0.8996298,1.0001106,0.4942958],
  [-17.716923,70.536625,-112.136197,-0.0606654,0.9530333,-0.2915851,0.4516404,0.9310092,1.8812622,0.2095295],
  [-18.600442,67.920077,-120.147169,-0.0606654,0.9530333,-0.295499,0.4487346,0.9543156,1.9252033,0.0028439],
  [-20.101237,67.80014,-120.120955,-0.074364,0.9510763,-0.2935421,0.4446012,0.9542534,1.9998451,0.0028439],
  [-20.101233,70.35147,-112.074256,-0.0802348,0.9530333,-0.2896282,0.4451563,0.9308599,1.9998453,0.2097404],
  [-16.391979,74.17348,-100.185513,-0.0567515,0.9608611,-0.2700587,0.4557133,0.8968445,1.8153658,0.5191898],
  [-20.101233,74.101424,-99.413562,-0.0880626,0.9589041,-0.2641879,0.4458327,0.8948304,1.9998453,0.5370945],
  [-8.229869,74.263233,-101.07832,-0.0254403,0.9608611,-0.2720157,0.4777029,0.8991643,1.4094238,0.4985258],
  [1e-06,77.741569,-88.674438,0.0,0.9667319,-0.2504892,0.5000005,0.863392,1.0001106,0.8179031],
  [-15.009798,77.571881,-87.82267,-0.0528376,0.9667319,-0.2485323,0.4592285,0.8619394,1.7466221,0.8370427],
  [-20.101233,77.428615,-86.931825,-0.0978474,0.964775,-0.2407045,0.4455094,0.8600864,1.9998451,0.8572943],
  [-20.101233,78.801316,-81.342798,-0.1037182,0.9667319,-0.2270059,0.4448661,0.8444132,1.9998451,0.9967958],
  [-14.299451,79.178834,-81.474799,-0.0508806,0.9706458,-0.2328767,0.4607556,0.843926,1.7112947,0.9967958],
  [-7.151469,79.416144,-81.561208,-0.0234834,0.9706458,-0.2328767,0.4803546,0.8434945,1.3557892,0.9967958],
  [1e-06,79.49605,-81.594944,0.0,0.9706458,-0.2328767,0.5000005,0.8431375,1.0001106,0.9967958],
  [-7.53812,77.682173,-88.51766,-0.0234834,0.9667319,-0.2504892,0.4794893,0.863324,1.37502,0.8212336],
  [-6.70041,83.670354,-62.229156,-0.0215264,0.9804305,-0.1937378,0.4811052,0.7882473,3.9998748,0.9967958],
  [1e-06,83.749235,-62.254792,0.0,0.9804305,-0.1937378,0.5000005,0.7881451,3.5000768,0.9967958],
  [1e-06,82.4696,-68.473607,0.0,0.9765166,-0.2074364,0.5000005,0.8057743,3.5000768,0.6060691],
  [6.700413,83.670354,-62.229156,0.0215264,0.9804305,-0.1937378,0.5188957,0.7882473,3.000277,0.9967958],
  [-6.70041,82.395113,-68.446499,-0.0215264,0.9765166,-0.2074364,0.4812233,0.8060295,3.9998748,0.6067426],
  [6.700413,82.395113,-68.446499,0.0215264,0.9765166,-0.2074364,0.5187774,0.8060297,3.0002773,0.6067427],
  [1e-06,81.401849,-73.36334,0.0,0.9745597,-0.2172211,0.5000005,0.8196728,3.5000768,0.3004855],
  [-6.693021,81.330156,-73.339355,-0.0215264,0.9745597,-0.2172211,0.4813762,0.8200055,3.9998748,0.3010078],
  [6.693024,81.330156,-73.339355,0.0215264,0.9745597,-0.2172211,0.5186243,0.8200055,3.0002773,0.3010078],
  [1e-06,80.292767,-78.153741,0.0,0.9726027,-0.2270059,0.5000005,0.8333282,3.5000768,0.0028439],
  [-6.700408,80.218166,-78.129411,-0.0215264,0.9726027,-0.2270059,0.4814982,0.8336741,3.9998748,0.0028439],
  [6.700414,80.218434,-78.128231,0.0215264,0.9726027,-0.2270059,0.5185027,0.8336708,3.000277,0.0028439],
  [1e-06,68.440217,-120.323288,0.0,0.9530333,-0.297456,0.5000005,0.954969,0.9994526,0.0028439],
  [1e-06,71.033061,-112.302315,0.0,0.9530333,-0.295499,0.5000005,0.9315711,0.9994526,0.2089631],
  [8.84269,70.911276,-112.261558,0.0273973,0.9530333,-0.295499,0.5241561,0.9313433,0.5599513,0.2091024],
  [9.281565,68.310064,-120.28079,0.0273973,0.9530333,-0.295499,0.5255951,0.9547075,0.5381384,0.0028439],
  [1e-06,74.325049,-101.273537,0.0,0.9608611,-0.2739726,0.5000005,0.8996298,0.9994526,0.4942958],
  [17.716926,70.536625,-112.136197,0.0606654,0.9530333,-0.2915851,0.5483603,0.9310091,0.1188822,0.2095297],
  [18.600862,67.918849,-120.150936,0.0606654,0.9530333,-0.295499,0.5512673,0.9543266,0.0749483,0.0028439],
  [8.229872,74.263233,-101.07832,0.0254403,0.9608611,-0.2720157,0.5222979,0.8991643,0.5904098,0.4985259],
  [1e-06,77.741569,-88.674438,0.0,0.9667319,-0.2504892,0.5000005,0.863392,0.9994526,0.8179032],
  [20.101236,70.35147,-112.074256,0.0802348,0.9530333,-0.2896282,0.5548444,0.9308599,0.0003765,0.2097405],
  [20.101236,67.803019,-120.112348,0.074364,0.9510763,-0.2935421,0.5553988,0.9542282,0.0003765,0.0028439],
  [16.391982,74.17348,-100.185513,0.0567515,0.9608611,-0.2700587,0.5442877,0.8968445,0.1847348,0.5191899],
  [20.101236,74.101424,-99.413562,0.0880626,0.9589041,-0.2641879,0.5541677,0.8948304,0.0003765,0.5370946],
  [15.009801,77.571881,-87.822664,0.0528376,0.9667319,-0.2485323,0.5407724,0.8619394,0.2534323,0.837043],
  [20.101236,77.428615,-86.931825,0.0978474,0.964775,-0.2407045,0.554491,0.8600864,0.0003765,0.8572944],
  [7.538123,77.682173,-88.517654,0.0234834,0.9667319,-0.2504892,0.5205112,0.8633241,0.6247916,0.8212339],
  [1e-06,79.49605,-81.594944,0.0,0.9706458,-0.2328767,0.5000005,0.8431375,0.9994526,0.9967958],
  [7.152197,79.413122,-81.574208,0.0234834,0.9706458,-0.2328767,0.519648,0.8435316,0.6439729,0.9967958],
  [14.302367,79.172701,-81.500769,0.0508806,0.9706458,-0.2328767,0.5392514,0.8440005,0.2885933,0.9967958],
  [20.101236,78.792375,-81.379193,0.1037182,0.9667319,-0.2270059,0.5551301,0.8445153,0.0003765,0.9967958],
  [12.828985,82.207346,-68.378156,0.0469667,0.9765166,-0.2054795,0.5359927,0.8062834,2.5424147,0.6084405],
  [12.130491,83.511192,-62.177444,0.0469667,0.9784736,-0.1937378,0.5342581,0.7883569,2.5944967,0.9967958],
  [17.955798,83.159894,-62.063301,0.1037182,0.9765166,-0.18591,0.5508727,0.7885035,2.1601424,0.9967958],
  [6.700413,83.670354,-62.229156,0.0215264,0.9804305,-0.1937378,0.5188957,0.7882473,2.9995184,0.9967958],
  [6.700413,82.395113,-68.446499,0.0215264,0.9765166,-0.2074364,0.5187774,0.8060297,2.9995184,0.6067427],
  [18.890336,81.839222,-68.244165,0.1056751,0.9726027,-0.1976517,0.5531621,0.8065767,2.0904603,0.6117697],
  [20.101237,82.855231,-61.964309,0.183953,0.9667319,-0.1702544,0.5570922,0.7885114,2.0001721,0.9967958],
  [20.101236,81.669211,-68.18229,0.148728,0.9686888,-0.1898239,0.5566583,0.8066124,2.0001721,0.6133071],
  [20.101236,80.657816,-73.114383,0.1232877,0.9686888,-0.2054795,0.5561399,0.8208801,2.0001721,0.3059089],
  [13.378373,81.11518,-73.267424,0.0489237,0.9745597,-0.2152642,0.5372553,0.8203835,2.5014505,0.3025749],
  [6.693024,81.330156,-73.339355,0.0215264,0.9745597,-0.2172211,0.5186243,0.8200055,2.9995184,0.3010078],
  [20.101236,79.582965,-77.914321,0.1056751,0.9686888,-0.2191781,0.5555505,0.8346304,2.0001721,0.0028439],
  [6.700414,80.218434,-78.128231,0.0215264,0.9726027,-0.2270059,0.5185027,0.8336708,2.9995184,0.0028439],
  [13.915108,79.986823,-78.050047,0.0508806,0.9726027,-0.2250489,0.5384148,0.8341023,2.4614291,0.0028439],
];
const NATIVE_INDICES = [0,1,2,2,3,0,3,2,4,5,0,3,4,6,3,6,4,7,7,8,6,3,9,5,9,3,6,10,11,5,5,9,10,12,10,9,6,12,9,12,6,8,8,13,12,14,15,16,16,17,14,18,15,14,19,14,17,17,20,19,19,20,21,21,22,19,23,19,22,14,19,23,22,24,23,14,25,18,23,25,14,26,18,25,27,23,24,25,23,27,24,28,27,27,28,29,29,30,27,27,30,31,31,32,26,27,33,25,31,33,27,25,33,26,26,33,31,34,35,36,36,35,37,36,38,34,37,39,36,38,36,40,40,36,39,40,41,38,39,42,40,41,40,43,43,40,42,43,44,41,42,45,43,46,47,48,48,49,46,48,47,50,49,48,51,51,52,49,50,53,48,53,50,54,52,51,55,55,56,52,57,51,48,55,51,57,48,53,57,57,58,55,58,57,59,59,57,53,59,60,58,54,61,53,53,61,59,61,54,62,62,63,61,61,63,64,64,59,61,60,59,64,64,65,60,66,67,68,69,67,66,66,70,69,68,71,66,71,68,72,72,73,71,73,74,71,70,66,75,75,66,71,71,74,75,75,76,70,75,74,77,78,76,75,77,79,75,75,79,78];

/** Fixed preview placeholders. The game supplies its live player ID and rank. */
export const PLAYER_DISPLAY_LABEL = 'SKN';
export const PLAYER_DISPLAY_NUMBER = '00';
const GLYPHS = [...PLAYER_DISPLAY_NUMBER, ...PLAYER_DISPLAY_LABEL];

/**
 * Custom Stadium derivatives can keep the same gameplay location even if their
 * units differ. Require every native anchor and the same shape; otherwise omit
 * the display instead of projecting it onto an unrelated custom vehicle.
 */
function customSurface(model: THREE.Object3D): { positions: number[]; normals: number[] } | null {
  model.updateWorldMatrix(true, true);
  const inverse = model.matrixWorld.clone().invert();
  const points: { position: THREE.Vector3; normal: THREE.Vector3; uv: THREE.Vector2 }[] = [];
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.previewOnly) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (object.userData.paintSlot !== 'skin' && !/skin/i.test(object.name + ' ' + materials.map((m) => m.name).join(' '))) return;
    const geometry = object.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
    if (!position || !normal || !uv) return;
    const transform = inverse.clone().multiply(object.matrixWorld);
    const normalTransform = new THREE.Matrix3().getNormalMatrix(transform);
    for (let i = 0; i < position.count; i++) {
      // Only the rear display's UV rectangle is relevant.
      if (uv.getX(i) < .442 || uv.getX(i) > .558 || uv.getY(i) < .787 || uv.getY(i) > .956) continue;
      points.push({
        position: new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform),
        normal: new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalTransform).normalize(),
        uv: new THREE.Vector2().fromBufferAttribute(uv, i),
      });
    }
  });
  if (!points.length) return null;
  const matched: typeof points = [];
  for (const row of NATIVE_VERTICES) {
    let closest: typeof points[number] | undefined, distance = .0002 ** 2;
    for (const point of points) {
      const d = (point.uv.x - row[6]) ** 2 + (point.uv.y - row[7]) ** 2;
      if (d < distance) { distance = d; closest = point; }
    }
    if (!closest) return null;
    matched.push(closest);
  }
  // Exact UVs alone do not establish compatibility: test the native curvature
  // and dimensions up to uniform model scale, including non-adjacent anchors.
  const native = (index: number) => new THREE.Vector3(...NATIVE_VERTICES[index].slice(0, 3) as [number, number, number]);
  const scale = matched[11].position.distanceTo(matched[72].position) / native(11).distanceTo(native(72));
  if (!Number.isFinite(scale) || scale <= 0) return null;
  for (let i = 0; i < matched.length; i++) for (const anchor of [11, 16, 35, 46, 72]) {
    const expected = native(i).distanceTo(native(anchor)) * scale;
    if (Math.abs(matched[i].position.distanceTo(matched[anchor].position) - expected) > scale * .025) return null;
  }
  return {
    positions: matched.flatMap((point) => point.position.toArray()),
    normals: matched.flatMap((point) => point.normal.toArray()),
  };
}

/** Testable geometry builder. No editor, texture or export state is modified. */
export function playerDisplayGeometry(model: THREE.Object3D, official: boolean): THREE.BufferGeometry | null {
  const surface = official
    ? { positions: NATIVE_VERTICES.flatMap((row) => row.slice(0, 3)), normals: NATIVE_VERTICES.flatMap((row) => row.slice(3, 6)) }
    : customSurface(model);
  if (!surface) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(surface.normals, 3));
  // CanvasTexture's flipY means the native V=1 is the top of each glyph.
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(NATIVE_VERTICES.flatMap((row) => [row[8] / GLYPHS.length, row[9]]), 2));
  geometry.setIndex(NATIVE_INDICES);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

function displayTexture(anisotropy: number): THREE.CanvasTexture {
  const tile = 256, canvas = document.createElement('canvas');
  canvas.width = tile * GLYPHS.length; canvas.height = tile;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Affichage joueur : canvas 2D indisponible.');
  context.fillStyle = '#eff2f4';
  context.font = '900 240px Arial, sans-serif';
  context.textBaseline = 'alphabetic';
  GLYPHS.forEach((glyph, index) => {
    const metrics = context.measureText(glyph);
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    // A small transparent margin prevents neighbouring slots entering mipmaps.
    const scaleX = (tile - 24) / Math.max(1, width), scaleY = (tile - 24) / Math.max(1, height);
    context.save();
    context.translate(index * tile + 12, 12);
    context.scale(scaleX, scaleY);
    context.fillText(glyph, metrics.actualBoundingBoxLeft, metrics.actualBoundingBoxAscent);
    context.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.name = 'Gameplay display preview (never exported)';
  return texture;
}

/** A non-paintable, depth-tested decal, rather than a screen-space overlay. */
export class PlayerDisplay {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private disposed = false;
  private constructor(model: THREE.Object3D, geometry: THREE.BufferGeometry, anisotropy: number) {
    const material = new THREE.MeshBasicMaterial({
      map: displayTexture(anisotropy), transparent: true, alphaTest: .02,
      depthTest: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Player display — preview only';
    this.mesh.userData.previewOnly = true;
    this.mesh.renderOrder = 20;
    this.mesh.raycast = () => { /* Editing still hits the underlying body. */ };
    model.add(this.mesh);
  }
  static attach(model: THREE.Object3D, official: boolean, anisotropy: number): PlayerDisplay | null {
    const geometry = playerDisplayGeometry(model, official);
    return geometry ? new PlayerDisplay(model, geometry, anisotropy) : null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.dispose();
  }
}
