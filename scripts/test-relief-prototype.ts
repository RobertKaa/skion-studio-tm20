import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildReliefPrototype, createDiagnosticReliefAtlas, createVolumeDiagnosticAtlas, createHoodMask, createReliefMask, deriveReliefNormals, maskReliefAtlas, packReliefNormal, unpackReliefNormal } from '../src/relief/engine';
import { validateReliefManifest, verifyPreparedReliefTemplate } from '../src/relief/template';
import { sampleReliefHeight, validateReliefAtlas } from '../src/relief/height';
import { decodeDDS, type RGBAImage } from '../src/dds';
import type { PreparedReliefTemplate, ReliefTemplateManifest } from '../src/relief/types';

function solid(value: number, alpha = 255, size = 8): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([value, value, value, alpha], offset);
  return { width: size, height: size, data };
}
function glbJson(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
}
function glbBinary(buffer: ArrayBuffer) {
  const view = new DataView(buffer), binHeader = 20 + view.getUint32(12, true);
  return new Uint8Array(buffer, binHeader + 8, view.getUint32(binHeader, true));
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const near = (a: number, b: number, tolerance = .0001) => assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const directory = new URL('../public/models/relief/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')) as ReliefTemplateManifest;
const read = async (path: string) => new Uint8Array(await readFile(new URL(path.split('/').at(-1)!, directory)));
const template: PreparedReliefTemplate = {
  manifest, preview: await read(manifest.preview.url),
  variants: { standard: await read(manifest.variants.standard.url), normal: await read(manifest.variants.normal.url) },
  dependencies: await Promise.all(manifest.dependencies.map(async entry => ({ name: entry.name, data: await read(entry.url) }))),
};
await verifyPreparedReliefTemplate(template);
const sourceHashes = { preview: hash(template.preview), standard: hash(template.variants.standard), normal: hash(template.variants.normal), dependencies: template.dependencies.map(entry => hash(entry.data)) };

for (const image of [{ ...solid(128), width: 1.5 }, { ...solid(128), width: 4097 }, { ...solid(128), data: new Uint8ClampedArray(3) }]) assert.throws(() => validateReliefAtlas(image), /invalide/);
near(sampleReliefHeight(solid(128), .3, .7), 0);
near(sampleReliefHeight(solid(255), .3, .7), 1);
near(sampleReliefHeight(solid(0), .3, .7), -1);
near(sampleReliefHeight(solid(255, 0), .3, .7), 0);
const orient = solid(128, 255, 2); orient.data.set([255, 255, 255, 255], 0);
near(sampleReliefHeight(orient, 0, 1), 1, .01);
near(sampleReliefHeight(orient, 0, 0), 0, .01);
const flatNormal = deriveReliefNormals(solid(128));
assert.deepEqual([...flatNormal.data.subarray(0, 4)], [128, 128, 255, 255]);
const slope = solid(128, 255, 8);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) slope.data[(y * 8 + x) * 4] = 32 + x * 27;
const slopeNormal = deriveReliefNormals(slope, 8, .02);
assert(slopeNormal.data[(3 * 8 + 3) * 4] < 100, 'Height increasing in U has a negative tangent X normal');
for (const value of [-1, 9, NaN, Infinity]) assert.throws(() => deriveReliefNormals(slope, value), /Amplitude/);
assert(deriveReliefNormals(slope, 80, .02, true).data[(3 * 8 + 3) * 4] < 5, 'Diagnostic normals accept the deliberate 80 mm amplitude');
for (const value of [-1, 80.01, NaN, Infinity]) assert.throws(() => deriveReliefNormals(slope, value, .02, true), /Amplitude/);
assert.throws(() => deriveReliefNormals(slope, 80, .02, 1 as never), /Amplitude/, 'Truthy non-boolean flags cannot enable diagnostic amplitude');
for (const normal of [[0, 1, 0], [-.7, .2, -.6], [1, -1, 0]]) {
  const packed = packReliefNormal(normal, 0xc0000000), decoded = unpackReliefNormal(packed);
  assert.equal(packed >>> 30, 3, 'DEC3N reserved high bits survive');
  normal.forEach((axis, i) => near(axis, decoded[i], 1 / 511 + .00001));
}

const mask = createHoodMask(template, 128);
assert(mask.data.some((value, index) => index % 4 === 3 && value > 128), 'Hood mask covers the capot');
assert(mask.data.some((value, index) => index % 4 === 3 && value === 0), 'Hood mask excludes other body UVs');
const masked = maskReliefAtlas(template, solid(255, 128, 128));
assert(masked.data.every((value, i) => i % 4 !== 3 || value <= 128));
assert.equal(masked.data[0], 255, 'Mask keeps height values linear and unchanged');
assert.equal(createHoodMask(template, 128), mask, 'Masks reuse a bounded template cache');
const vehicleMask = createReliefMask(template, 16, 8, 'vehicle');
assert(vehicleMask.data.every(value => value === 255), 'Vehicle mask covers every atlas, including details/wheels');
const vehicleSource = solid(255, 128);
assert.deepEqual(maskReliefAtlas(template, vehicleSource, 'vehicle'), vehicleSource, 'Whole vehicle keeps original linear RGB/alpha without a hood crop');
assert.notEqual(maskReliefAtlas(template, vehicleSource, 'vehicle').data, vehicleSource.data, 'Whole vehicle masking preserves source immutability');

const original = await buildReliefPrototype({ template, mode: 'geometry', strengthMm: 0, heightAtlas: createDiagnosticReliefAtlas(128) });
assert.deepEqual(original.project.mesh, template.variants.standard, 'Zero displacement preserves the complete native mesh byte for byte');
assert.equal(original.stats.affectedVertices, 0);
assert.equal(original.options.scope, 'hood', 'Legacy callers remain restricted to the hood');
assert.equal(original.options.textureResolution, 1024, 'Legacy export quality remains 1K unless chosen');
assert.equal(original.options.diagnostic, false, 'Legacy builds retain the normal 8 mm amplitude limit');
assert.equal(original.normalAtlas, null);
assert.equal(original.project.passthrough.length, template.dependencies.length);
assert(glbJson(original.project.preview!).materials.some((material: { name: string }) => material.name === '_SkinDmg_Skin'));
assert.equal((await buildReliefPrototype({ template, mode: 'geometry', strengthMm: 8, heightAtlas: solid(128) })).stats.affectedVertices, 0, 'Mid grey is neutral');
assert.equal((await buildReliefPrototype({ template, mode: 'geometry', strengthMm: 8, heightAtlas: solid(255, 0) })).stats.affectedVertices, 0, 'Transparent region masks do not move geometry');

const height = createDiagnosticReliefAtlas(128), heightBefore = height.data.slice();
const volume = await buildReliefPrototype({ template, mode: 'geometry', strengthMm: 8, heightAtlas: height });
assert(volume.stats.affectedVertices > 500, 'Every native LOD receives geometry relief');
assert(volume.stats.maxDisplacementMm > 1 && volume.stats.maxDisplacementMm <= 8.001);
assert.deepEqual(height.data, heightBefore, 'Original imported height data is never mutated');
const allowedBytes = new Uint8Array(volume.project.mesh.length);
const source = new DataView(template.variants.standard.buffer), changed = new DataView(volume.project.mesh.buffer);
for (const geometry of manifest.geometries) {
  const offsets = geometry.offsets.standard, count = geometry.positions.length / 3;
  allowedBytes.fill(1, offsets.positionOffset, offsets.positionOffset + count * 12);
  allowedBytes.fill(1, offsets.normalOffset, offsets.normalOffset + count * 4);
  if (offsets.tangentOffset !== undefined) allowedBytes.fill(1, offsets.tangentOffset, offsets.tangentOffset + count * 4);
  let affected = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    const offset = offsets.positionOffset + vertex * 12;
    const distance = Math.hypot(...[0, 1, 2].map(axis => changed.getFloat32(offset + axis * 4, true) - source.getFloat32(offset + axis * 4, true))) * 1000;
    if (distance > .00001) affected++;
    assert(distance <= 8.001, 'Native vertex displacement stays within the advertised limit');
    if (!geometry.bodyVertices[vertex]) {
      assert.equal(distance, 0, 'Articulated, non-Body parts never receive seam displacement');
      assert.equal(changed.getUint32(offsets.normalOffset + vertex * 4, true), source.getUint32(offsets.normalOffset + vertex * 4, true), 'Animated-part normals stay byte-identical');
      if (offsets.tangentOffset !== undefined) assert.equal(changed.getUint32(offsets.tangentOffset + vertex * 4, true), source.getUint32(offsets.tangentOffset + vertex * 4, true), 'Animated-part tangents stay byte-identical');
    }
    const normal = unpackReliefNormal(changed.getUint32(offsets.normalOffset + vertex * 4, true));
    near(Math.hypot(...normal), 1, .008);
    if (offsets.tangentOffset !== undefined && changed.getUint32(offsets.normalOffset + vertex * 4, true) !== source.getUint32(offsets.normalOffset + vertex * 4, true)) {
      const tangent = unpackReliefNormal(changed.getUint32(offsets.tangentOffset + vertex * 4, true));
      near(Math.hypot(...tangent), 1, .008);
      near(tangent.reduce((sum, axis, i) => sum + axis * normal[i], 0), 0, .008);
    }
  }
  assert(affected > 0, `LOD ${geometry.visualIndex} is modified`);
}
for (let byte = 0; byte < volume.project.mesh.length; byte++) if (!allowedBytes[byte]) assert.equal(volume.project.mesh[byte], template.variants.standard[byte], `Byte ${byte} outside positions/normals must not change (UV, bones, animations, materials, indices)`);

const volumeJson = glbJson(volume.project.preview!), sourceJson = glbJson(original.project.preview!);
assert.deepEqual(volumeJson.nodes, sourceJson.nodes, 'Preview hierarchy and rig are preserved');
assert.deepEqual(volumeJson.meshes, sourceJson.meshes, 'Preview UV/index/accessor references stay unchanged');
const beforeBinary = glbBinary(original.project.preview!), afterBinary = glbBinary(volume.project.preview!);
const allowedPreviewBytes = new Uint8Array(beforeBinary.byteLength);
for (const geometry of manifest.geometries) for (const index of [geometry.positionAccessor, geometry.normalAccessor]) {
  if (index === undefined) continue;
  const accessor = sourceJson.accessors[index], bufferView = sourceJson.bufferViews[accessor.bufferView];
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  allowedPreviewBytes.fill(1, start, start + accessor.count * 12);
}
assert.equal(afterBinary.length, beforeBinary.length);
for (let byte = 0; byte < beforeBinary.length; byte++) if (!allowedPreviewBytes[byte]) assert.equal(afterBinary[byte], beforeBinary[byte], 'Preview binary UVs, index buffers and other parts stay intact');
const combined = await buildReliefPrototype({ template, mode: 'combined', strengthMm: 3, heightAtlas: height });
assert.equal(combined.options.mode, 'combined');
assert.equal(combined.stats.templateVariant, 'normal');
assert(combined.project.passthrough.some(entry => entry.name === 'Skin_N.dds'));
assert(glbJson(combined.project.preview!).materials.some((material: { name: string }) => material.name === '_DetailsDmgNormal_Skin'), 'Preview chooses the same experimental body shader family as the GBX');
const normalsOnly = await buildReliefPrototype({ template, mode: 'normal', strengthMm: 8, normalAtlas: slopeNormal, normalStrength: 1 });
assert.equal(normalsOnly.stats.affectedVertices, 0);
assert.deepEqual(normalsOnly.project.mesh, template.variants.normal, 'Normals mode does not modify native geometry');
assert(normalsOnly.normalAtlas!.data.some((value, offset) => offset % 4 === 0 && value < 128), 'Normal input remains visible within the hood');
for (let offset = 0; offset < normalsOnly.normalAtlas!.data.length; offset += 4) if (createHoodMask(template, 8).data[offset + 3] === 0) assert.deepEqual([...normalsOnly.normalAtlas!.data.subarray(offset, offset + 4)], [128, 128, 255, 255], 'Outside the capot, shader normals are neutral');
const normalFile = combined.project.passthrough.find(entry => entry.name === 'Skin_N.dds')!;
assert.equal(decodeDDS(normalFile.data.slice().buffer).width, height.width);
const zeroNormals = await buildReliefPrototype({ template, mode: 'normal', strengthMm: 3, normalAtlas: slopeNormal, normalStrength: 0 });
for (let offset = 0; offset < zeroNormals.normalAtlas!.data.length; offset += 4) assert.deepEqual([...zeroNormals.normalAtlas!.data.subarray(offset, offset + 4)], [128, 128, 255, 255]);

const wholeVehicle = await buildReliefPrototype({ template, mode: 'combined', scope: 'vehicle', textureResolution: 2048, strengthMm: 3, heightAtlas: height });
assert.equal(wholeVehicle.options.scope, 'vehicle');
assert.equal(wholeVehicle.options.textureResolution, 2048);
assert(wholeVehicle.stats.eligibleVertices > wholeVehicle.stats.hoodVertices * 4, 'Full volume scope covers the fixed body beyond the capot');
assert(wholeVehicle.stats.affectedVertices > volume.stats.affectedVertices * 3, 'Whole-car volume moves many more native Body vertices');
assert(wholeVehicle.stats.maxDisplacementMm <= 3.001);
const wholeSource = new DataView(template.variants.normal.buffer), wholeChanged = new DataView(wholeVehicle.project.mesh.buffer);
const fixedPositions = new Set<string>(), positionKey = (position: readonly number[]) => position.map(value => Math.round(value * 1e6)).join(',');
for (const geometry of manifest.geometries) for (let vertex = 0; vertex < geometry.bodyVertices.length; vertex++) if (!geometry.bodyVertices[vertex]) fixedPositions.add(positionKey(geometry.positions.slice(vertex * 3, vertex * 3 + 3)));
for (const geometry of manifest.geometries) for (let point = 0; point < (geometry.boundaryPoints?.length ?? 0); point += 3) fixedPositions.add(positionKey(geometry.boundaryPoints!.slice(point, point + 3)));
const allowedWholeBytes = new Uint8Array(wholeVehicle.project.mesh.length);
let distantVertices = 0, pinnedVertices = 0;
for (const geometry of manifest.geometries) {
  const { positionOffset, normalOffset, tangentOffset } = geometry.offsets.normal, count = geometry.bodyVertices.length;
  allowedWholeBytes.fill(1, positionOffset, positionOffset + count * 12);
  allowedWholeBytes.fill(1, normalOffset, normalOffset + count * 4);
  if (tangentOffset !== undefined) allowedWholeBytes.fill(1, tangentOffset, tangentOffset + count * 4);
  let distantInLod = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    const p = positionOffset + vertex * 12;
    const distance = Math.hypot(...[0, 1, 2].map(axis => wholeChanged.getFloat32(p + axis * 4, true) - wholeSource.getFloat32(p + axis * 4, true))) * 1000;
    assert(distance <= 3.001, 'Whole Body displacement keeps the chosen millimetre limit');
    if (!geometry.bodyVertices[vertex]) {
      assert.equal(distance, 0, 'Vehicle scope never deforms articulated Skin or wheel geometry');
      assert.equal(wholeChanged.getUint32(normalOffset + vertex * 4, true), wholeSource.getUint32(normalOffset + vertex * 4, true));
      if (tangentOffset !== undefined) assert.equal(wholeChanged.getUint32(tangentOffset + vertex * 4, true), wholeSource.getUint32(tangentOffset + vertex * 4, true));
    } else if (fixedPositions.has(positionKey(geometry.positions.slice(vertex * 3, vertex * 3 + 3)))) {
      pinnedVertices++;
      assert.equal(distance, 0, 'Body connections to undeformed animations/details/glass/decals remain pinned');
    }
    if (distance > .00001 && geometry.hoodWeights[vertex] === 0) { distantVertices++; distantInLod++; }
    if (tangentOffset !== undefined && wholeChanged.getUint32(normalOffset + vertex * 4, true) !== wholeSource.getUint32(normalOffset + vertex * 4, true)) {
      const normal = unpackReliefNormal(wholeChanged.getUint32(normalOffset + vertex * 4, true)), tangent = unpackReliefNormal(wholeChanged.getUint32(tangentOffset + vertex * 4, true));
      near(Math.hypot(...normal), 1, .008); near(Math.hypot(...tangent), 1, .008);
      near(normal.reduce((sum, value, i) => sum + value * tangent[i], 0), 0, .008);
    }
  }
  assert(distantInLod > 0, `Whole car reaches surfaces outside the hood in LOD ${geometry.visualIndex}`);
}
assert(distantVertices > 4000, 'Side/rear fixed-body surfaces receive real geometry relief');
assert(pinnedVertices > 100, 'Whole Body scope preserves many real animated interfaces');
for (let byte = 0; byte < wholeVehicle.project.mesh.length; byte++) if (!allowedWholeBytes[byte]) assert.equal(wholeVehicle.project.mesh[byte], template.variants.normal[byte], 'Whole vehicle keeps all UVs, blend weights, joints and undeformed model parts');
const wholeNormalFiles = wholeVehicle.project.passthrough.filter(entry => /^(?:Skin|Details|Wheels)_N\.dds$/i.test(entry.name));
assert.equal(wholeNormalFiles.length, 3, 'Full vehicle binds the normal texture to body, details and wheels');
assert.deepEqual(wholeNormalFiles[0].data, wholeNormalFiles[1].data);
assert.deepEqual(wholeNormalFiles[0].data, wholeNormalFiles[2].data);
assert.notEqual(wholeNormalFiles[0].data, wholeNormalFiles[1].data, 'Normal file arrays are independent and editable');
const fullNormalOnly = await buildReliefPrototype({ template, mode: 'normal', scope: 'vehicle', textureResolution: 4096, strengthMm: 8, normalAtlas: slopeNormal });
assert.deepEqual(fullNormalOnly.project.mesh, template.variants.normal, 'Whole-vehicle normals leave all mesh positions intact');
assert(fullNormalOnly.normalAtlas!.data.some((value, index) => index % 4 === 0 && createHoodMask(template, 8).data[index + 3] === 0 && value < 128), 'Whole vehicle normals remain visible outside former capot mask');
assert.equal(fullNormalOnly.options.textureResolution, 4096);
const quality2K = await buildReliefPrototype({ template, mode: 'normal', scope: 'vehicle', textureResolution: 2048, strengthMm: 0, normalAtlas: solid(128, 255, 2048) });
for (const file of quality2K.project.passthrough.filter(entry => /_N\.dds$/i.test(entry.name))) {
  const header = new DataView(file.data.buffer, file.data.byteOffset, file.data.byteLength);
  assert.equal(header.getUint32(16, true), 2048, '2K normal exports retain actual source resolution');
  assert.equal(header.getUint32(12, true), 2048);
}
const demo4K = createDiagnosticReliefAtlas(4096);
assert.equal(demo4K.width, 4096); assert.equal(demo4K.height, 4096); assert.equal(demo4K.data.length, 4096 * 4096 * 4);
assert.throws(() => createDiagnosticReliefAtlas(4097), /Résolution/);

const broadHeight = createVolumeDiagnosticAtlas(128), broadBefore = broadHeight.data.slice();
assert.throws(() => createVolumeDiagnosticAtlas(4097), /Résolution/);
assert.throws(() => createVolumeDiagnosticAtlas(3), /Résolution/);
for (const diagnosticScope of ['hood', 'vehicle'] as const) {
  const diagnosticVolume = await buildReliefPrototype({ template, mode: 'geometry', scope: diagnosticScope, strengthMm: 80, diagnostic: true, heightAtlas: broadHeight });
  assert.equal(diagnosticVolume.options.diagnostic, true);
  assert(diagnosticVolume.stats.maxDisplacementMm > 40 && diagnosticVolume.stats.maxDisplacementMm <= 80.001, 'Broad diagnostic produces an unmistakable geometry change beyond 40 mm');
  assert.equal(diagnosticVolume.normalAtlas, null, 'Geometry diagnostic cannot disguise volume with a tangent-normal texture');
  const diagnosticView = new DataView(diagnosticVolume.project.mesh.buffer), previewJson = glbJson(diagnosticVolume.project.preview!);
  const previewBinary = glbBinary(diagnosticVolume.project.preview!), previewView = new DataView(previewBinary.buffer, previewBinary.byteOffset, previewBinary.byteLength);
  for (const geometry of manifest.geometries) {
    const { positionOffset, normalOffset, tangentOffset } = geometry.offsets.standard;
    let movedInLod = 0;
    for (let vertex = 0; vertex < geometry.bodyVertices.length; vertex++) {
      const offset = positionOffset + vertex * 12;
      const written = [0, 1, 2].map(axis => diagnosticView.getFloat32(offset + axis * 4, true));
      const distance = Math.hypot(...written.map((value, axis) => value - geometry.positions[vertex * 3 + axis])) * 1000;
      assert(distance <= 80.001, 'Exaggerated native geometry stays within the hard diagnostic limit');
      if (distance > .00001) movedInLod++;
      if (!geometry.bodyVertices[vertex] || fixedPositions.has(positionKey(geometry.positions.slice(vertex * 3, vertex * 3 + 3)))) {
        assert.equal(distance, 0, 'Diagnostic amplitude preserves fixed interfaces and all articulated parts');
        if (!geometry.bodyVertices[vertex]) {
          assert.equal(diagnosticView.getUint32(normalOffset + vertex * 4, true), source.getUint32(normalOffset + vertex * 4, true));
          if (tangentOffset !== undefined) assert.equal(diagnosticView.getUint32(tangentOffset + vertex * 4, true), source.getUint32(tangentOffset + vertex * 4, true));
        }
      }
      if (geometry.positionAccessor !== undefined) {
        const accessor = previewJson.accessors[geometry.positionAccessor], bufferView = previewJson.bufferViews[accessor.bufferView];
        const previewOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + vertex * 12;
        written.forEach((value, axis) => assert.equal(previewView.getFloat32(previewOffset + axis * 4, true), value, 'Diagnostic preview displays the exact geometry exported for the game'));
      }
    }
    assert(movedInLod > 0, `The broad diagnostic deforms native LOD ${geometry.visualIndex}`);
  }
  for (let byte = 0; byte < diagnosticVolume.project.mesh.length; byte++) if (!allowedBytes[byte]) assert.equal(diagnosticVolume.project.mesh[byte], template.variants.standard[byte], 'Diagnostic volume keeps all UVs, rig, index buffers, shaders and dependencies intact');
  assert.deepEqual(previewJson.nodes, sourceJson.nodes, 'Diagnostic preview retains the complete rig/hierarchy');
  assert.deepEqual(previewJson.meshes, sourceJson.meshes, 'Diagnostic preview preserves mesh topology and UV accessor bindings');
}
assert.deepEqual(broadHeight.data, broadBefore, 'Broad source remains immutable after both diagnostic scopes');
const diagnosticCombined = await buildReliefPrototype({ template, mode: 'combined', scope: 'hood', strengthMm: 80, diagnostic: true, heightAtlas: broadHeight });
assert(diagnosticCombined.normalAtlas, 'Combined diagnostic derives matching high-amplitude normals without a separate 8 mm cap');
assert(diagnosticCombined.stats.maxDisplacementMm > 40);

for (const strengthMm of [-1, 9, NaN, Infinity]) await assert.rejects(buildReliefPrototype({ template, mode: 'geometry', strengthMm }), /invalides/);
for (const strengthMm of [-1, 80.01, NaN, Infinity]) await assert.rejects(buildReliefPrototype({ template, mode: 'geometry', strengthMm, diagnostic: true }), /invalides/);
for (const diagnostic of [1, 'true', {}, []]) await assert.rejects(buildReliefPrototype({ template, mode: 'geometry', strengthMm: 80, diagnostic: diagnostic as never }), /invalides/);
for (const scope of ['everything', '', NaN, 1] as const) await assert.rejects(buildReliefPrototype({ template, mode: 'normal', strengthMm: 3, scope: scope as never }), /Zone/);
for (const textureResolution of [0, 512, 1024.5, 8192, NaN, Infinity, '2048']) await assert.rejects(buildReliefPrototype({ template, mode: 'normal', strengthMm: 3, textureResolution: textureResolution as never }), /Résolution/);
assert.throws(() => createReliefMask(template, 8, 8, NaN as never), /Zone/);
assert.throws(() => maskReliefAtlas(template, solid(128), 'all' as never), /Zone/);
const corrupted = { ...template, variants: { ...template.variants, standard: template.variants.standard.slice() } }; corrupted.variants.standard[20] ^= 1;
await assert.rejects(buildReliefPrototype({ template: corrupted, mode: 'geometry', strengthMm: 2 }), /modifié/);
const unsafe = structuredClone(manifest); unsafe.geometries[0].offsets.standard.positionOffset = -1;
assert.throws(() => validateReliefManifest(unsafe), /Offsets/);
const brokenInterface = structuredClone(manifest); brokenInterface.geometries[0].boundaryPoints![0] = NaN;
assert.throws(() => validateReliefManifest(brokenInterface), /Interfaces/);
const missingInterface = structuredClone(manifest); missingInterface.geometries[0].boundaryPoints = undefined;
assert.throws(() => validateReliefManifest(missingInterface), /Interfaces/);
const legacyTemplate = { ...template, manifest: { ...manifest, interfaceProtectionVersion: undefined } };
await assert.rejects(buildReliefPrototype({ template: legacyTemplate, mode: 'geometry', scope: 'vehicle', strengthMm: 3 }), /rechargé/, 'Unsafe old templates cannot silently produce whole-body exports');
await assert.rejects(buildReliefPrototype({ template: legacyTemplate, mode: 'geometry', scope: 'hood', strengthMm: 80, diagnostic: true }), /rechargé/, 'An exaggerated hood diagnostic requires the same protected native interfaces');
const overlap = structuredClone(manifest); overlap.geometries[0].offsets.standard.normalOffset = overlap.geometries[0].offsets.standard.positionOffset;
assert.throws(() => validateReliefManifest(overlap), /superposées/);
const pathTraversal = structuredClone(manifest); pathTraversal.preview.url = '../outside.glb';
assert.throws(() => validateReliefManifest(pathTraversal), /Version/);
assert.equal(hash(template.preview), sourceHashes.preview);
assert.equal(hash(template.variants.standard), sourceHashes.standard);
assert.equal(hash(template.variants.normal), sourceHashes.normal);
assert.deepEqual(template.dependencies.map(entry => hash(entry.data)), sourceHashes.dependencies);
console.log('Relief prototype: native GBX/GLB, hood/vehicle scope, five LODs, animated interfaces, normals, 1K/2K/4K options and immutable rig/assets passed.');
