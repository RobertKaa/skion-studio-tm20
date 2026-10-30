import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { encodeHorn, hornDuration, hornFingerprint, normalizeHornAudio, prepareHorn, HORN_ASSET_PATH, HORN_FILE_NAME, HORN_SAMPLE_RATE, MAX_HORN_BYTES } from '../src/horn';
import { buildSkinZipFromImages, importSkinZipFromBuffer } from '../src/skinZip';
import { createBaseSkinProject } from '../src/baseSkin';
import { hydrateProject, readProjectFile, validateProjectDocument, writeProjectFile } from '../src/projectFile';
import { MAPS, type MapId } from '../src/maps';
import type { RGBAImage } from '../src/dds';

const mono = new Float32Array([0, .5, -.5, 1, -1]);
const horn = encodeHorn([mono], HORN_SAMPLE_RATE, 'C:\\sounds\\Mon klaxon.mp3');
assert.equal(horn.name, 'Mon klaxon.mp3');
const view = new DataView(horn.data.buffer);
assert.equal(view.getUint16(22, true), 1);
assert.equal(view.getUint16(34, true), 16);
assert.equal(view.getUint32(24, true), 44100);
assert.deepEqual(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true)), [0, 16384, -16384, 32767, -32768]);
assert.equal(hornDuration(horn.data), 5 / 44100);
const stereo = encodeHorn([new Float32Array([.8, -.6, .5]), new Float32Array([.2, .2, -.5])], 44100, 'Stereo.wav');
const stereoView = new DataView(stereo.data.buffer);
assert(Math.abs(stereoView.getInt16(44, true) - 16384) <= 1);
assert(Math.abs(stereoView.getInt16(46, true) + 6554) <= 1);
assert.equal(stereoView.getInt16(48, true), 0, 'Opposite phases cancel, with no artificial gain');
const overshoot = pcmSamplesFromHorn(encodeHorn([new Float32Array([1.2, .6, -1.2])], 44100, 'Decoder.mp3'));
assert(Math.abs(overshoot[1] / overshoot[0] - .5) < .0001, 'Decoder overshoots keep their waveform instead of clipping before normalization');
function pcmSamplesFromHorn(horn: { data: Uint8Array }) {
  const view = new DataView(horn.data.buffer, horn.data.byteOffset, horn.data.byteLength);
  return Array.from({ length: (horn.data.length - 44) / 2 }, (_, i) => view.getInt16(44 + i * 2, true));
}
assert.notEqual(hornFingerprint(horn), hornFingerprint(stereo));
assert.equal(hornFingerprint(horn), hornFingerprint({ ...horn, data: new Uint8Array(horn.data) }));
assert.equal(hornFingerprint(null), null);
assert.throws(() => encodeHorn([], 44100, 'Empty.mp3'), /converti/);
assert.throws(() => encodeHorn([new Float32Array([NaN])], 44100, 'Bad.mp3'), /échantillons/);
assert.throws(() => encodeHorn([new Float32Array(2), new Float32Array(1)], 44100, 'Bad.mp3'), /converti/);
assert.throws(() => encodeHorn([new Float32Array(441001)], 44100, 'Long.mp3'), /10 secondes/);
assert.equal(encodeHorn([new Float32Array(441000)], 44100, 'Ten.wav').data.length, MAX_HORN_BYTES);
for (const [offset, value] of [[4, 0], [22, 2], [24, 48000], [34, 24], [40, 9999]]) {
  const bad = new Uint8Array(horn.data); new DataView(bad.buffer).setUint32(offset, value, true);
  assert.throws(() => hornDuration(bad), /Klaxon invalide/);
}
assert.throws(() => hornDuration(horn.data.subarray(0, 45)), /Klaxon invalide/);
assert.deepEqual(await prepareHorn(new Blob([horn.data]), 'Reimport.wav'), { name: 'Reimport.wav', data: horn.data });
await assert.rejects(prepareHorn(new Blob(['fake']), 'file.exe'), /MP3, WAV ou OGG/);
await assert.rejects(prepareHorn(new Blob([]), 'Empty.mp3'), /10 Mo/);
await assert.rejects(prepareHorn(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'Large.mp3'), /10 Mo/);

const pcmSamples = (data: Uint8Array) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Float32Array.from({ length: (data.length - 44) / 2 }, (_, i) => {
    const sample = view.getInt16(44 + i * 2, true);
    return sample / (sample < 0 ? 32768 : 32767);
  });
};
const rmsOf = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, sample) => sum + sample ** 2, 0) / samples.length);
const peakOf = (samples: Float32Array) => samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
const quietTone = Float32Array.from({ length: HORN_SAMPLE_RATE }, (_, i) => .015 * Math.sin(2 * Math.PI * 440 * i / HORN_SAMPLE_RATE));
const quietHorn = encodeHorn([quietTone], HORN_SAMPLE_RATE, 'Quiet.wav');
const originalBytes = quietHorn.data.slice();
const balanced = normalizeHornAudio(quietHorn.data);
const balancedTone = pcmSamples(balanced);
assert(Math.abs(20 * Math.log10(rmsOf(balancedTone)) + 6) < .1, 'A quiet horn reaches the stronger -6 dBFS audible RMS target');
assert(rmsOf(balancedTone) > rmsOf(pcmSamples(quietHorn.data)) * 40, 'Low-volume sources become clearly audible');
assert(peakOf(balancedTone) <= 10 ** (-1 / 20) + 1 / 32767);
assert.equal(hornDuration(balanced), hornDuration(quietHorn.data));
assert.deepEqual(quietHorn.data, originalBytes, 'Balancing never mutates the editable source');
assert.deepEqual(normalizeHornAudio(quietHorn.data), balanced, 'Repeated exports start from the same original');
assert.deepEqual(normalizeHornAudio(balanced), balanced, 'A balanced horn is not amplified again after game ZIP re-import');
const loudTone = encodeHorn([Float32Array.from(quietTone, (sample) => sample / .015)], HORN_SAMPLE_RATE, 'Loud.wav');
const balancedLoud = pcmSamples(normalizeHornAudio(loudTone.data));
assert(Math.abs(20 * Math.log10(rmsOf(balancedLoud)) + 6) < .1, 'Already loud sources are balanced to the same level');
assert(Math.abs(rmsOf(balancedLoud) - rmsOf(balancedTone)) < .0001);
const previousExport = encodeHorn([Float32Array.from(quietTone, (sample) => sample / .015 * Math.SQRT2 * 10 ** (-12 / 20))], HORN_SAMPLE_RATE, 'Previous.wav');
const upgradedExport = normalizeHornAudio(previousExport.data);
assert(Math.abs(20 * Math.log10(rmsOf(pcmSamples(upgradedExport)) / rmsOf(pcmSamples(previousExport.data))) - 6) < .1, 'An imported horn from the previous -12 dBFS target gains 6 dB');
assert.deepEqual(normalizeHornAudio(upgradedExport), upgradedExport, 'Re-exporting an upgraded horn does not accumulate gain');
const padded = new Float32Array(quietTone.length * 3); padded.set(quietTone, quietTone.length);
const balancedPadded = pcmSamples(normalizeHornAudio(encodeHorn([padded], HORN_SAMPLE_RATE, 'Pauses.wav').data));
assert(Math.abs(rmsOf(balancedPadded.subarray(quietTone.length, quietTone.length * 2)) - rmsOf(balancedTone)) < .0001, 'Silent gaps do not increase the normalization gain');
assert(balancedPadded.subarray(0, quietTone.length).every((sample) => sample === 0));
const withTransient = quietTone.slice(); withTransient[22050] = 1; withTransient[22051] = -1;
const limited = pcmSamples(normalizeHornAudio(encodeHorn([withTransient], HORN_SAMPLE_RATE, 'Transient.wav').data));
assert(peakOf(limited) <= 10 ** (-1 / 20) + 1 / 32767, 'Even full-scale transient peaks leave headroom');
assert(rmsOf(limited) > rmsOf(quietTone) * 12, 'A brief loud peak does not prevent boosting the rest of the horn');
assert(Math.abs(20 * Math.log10(rmsOf(limited)) + 6) < .1, 'Transient protection retains the stronger sustained volume');
assert(Math.abs(limited[22049]) < Math.abs(balancedTone[22049]), 'The limiter anticipates a transient instead of hard clipping it');
assert(limited.every(Number.isFinite));
for (const amplitude of [0, 1 / 32767]) {
  const silent = encodeHorn([new Float32Array(441000).fill(amplitude)], HORN_SAMPLE_RATE, 'Silence.wav');
  assert.deepEqual(normalizeHornAudio(silent.data), silent.data, 'Silence and quantization noise are never boosted');
}
const offsetSource = new Uint8Array(balanced.length + 7); offsetSource.set(balanced, 7);
assert.deepEqual(normalizeHornAudio(offsetSource.subarray(7)), balanced, 'Audio views may have a non-zero byte offset');

const camera = { position: [3, 2, 4] as [number, number, number], target: [0, .5, 0] as [number, number, number] };
const bundle = createBaseSkinProject(camera);
bundle.document.horn = { name: horn.name, asset: HORN_ASSET_PATH }; bundle.assets.set(HORN_ASSET_PATH, horn.data);
const restored = await readProjectFile(await writeProjectFile(bundle));
assert.deepEqual(restored.document.horn, bundle.document.horn);
assert.deepEqual(hydrateProject(restored).horn, horn, 'Editable projects retain exactly the same audio bytes');
assert.equal(hydrateProject(createBaseSkinProject(camera)).horn, null, 'Reset and old projects have no custom horn');
const missing = structuredClone(bundle.document);
assert.throws(() => validateProjectDocument(missing, new Set()), /absent/);
for (const asset of ['https://example.com/audio.wav', 'assets/../horn.wav', 'assets/extra-0.bin']) {
  const bad = structuredClone(bundle.document); bad.horn!.asset = asset;
  assert.throws(() => validateProjectDocument(bad, new Set([asset])), /klaxon invalide/);
}
const invalid = new Uint8Array(horn.data); invalid[0] = 0;
await assert.rejects(writeProjectFile({ document: bundle.document, assets: new Map([[HORN_ASSET_PATH, invalid]]) }), /klaxon invalide/);
const badZip = new JSZip(); badZip.file('project.json', JSON.stringify(bundle.document)); badZip.file(HORN_ASSET_PATH, invalid);
await assert.rejects(readProjectFile(new Blob([await badZip.generateAsync({ type: 'arraybuffer' })])), /klaxon invalide/);
const oversized = new JSZip(); oversized.file('project.json', JSON.stringify(bundle.document)); oversized.file(HORN_ASSET_PATH, new Uint8Array(MAX_HORN_BYTES + 1));
await assert.rejects(readProjectFile(new Blob([await oversized.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })])), /volumineuse/);

const images = Object.fromEntries(MAPS.map((map) => [map.id, { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) }])) as Record<MapId, RGBAImage>;
const game = await buildSkinZipFromImages(images, { skinName: 'Avec klaxon', horn: quietHorn, passthrough: [{ name: 'Horn.mp3', data: new Uint8Array([9]) }] });
const zip = await JSZip.loadAsync(await game.arrayBuffer());
const exportedAudio = normalizeHornAudio(quietHorn.data);
assert.deepEqual(await zip.file(HORN_FILE_NAME)!.async('uint8array'), exportedAudio, 'Export automatically balances legacy project horns too');
assert(Math.abs(20 * Math.log10(rmsOf(pcmSamples(await zip.file(HORN_FILE_NAME)!.async('uint8array')))) + 6) < .1, 'The game ZIP contains the stronger audio, not only the preview');
assert.equal(Object.keys(zip.files).filter((path) => /^horn\./i.test(path)).length, 1, 'Only one root-level game-compatible horn is exported');
const imported = await importSkinZipFromBuffer(await game.arrayBuffer());
assert.deepEqual(imported.horn?.data, exportedAudio);
assert.equal(imported.failures.length, 0);
const duplicates = new JSZip(); duplicates.file('backup/Horn.wav', stereo.data); duplicates.file('Horn.mp3', 'invalid backup'); duplicates.file('hOrN.WaV', horn.data);
const preferred = await importSkinZipFromBuffer(await duplicates.generateAsync({ type: 'arraybuffer' }));
assert.deepEqual(preferred.horn?.data, horn.data, 'Root WAV wins over alternate formats and backup folders');
assert.equal(preferred.failures.length, 0, 'Unused alternatives are never decoded');
assert.equal(preferred.skipped.length, 2);
const without = await JSZip.loadAsync(await (await buildSkinZipFromImages(images, { skinName: 'Sans klaxon' })).arrayBuffer());
assert.equal(without.file(HORN_FILE_NAME), null);
await assert.rejects(buildSkinZipFromImages(images, { skinName: 'Bad', horn: { name: 'bad.wav', data: invalid } }), /Klaxon invalide/);
console.log('✓ Klaxon : équilibrage automatique des sons faibles/forts, limiteur de pics, silences préservés, source intacte, stabilité des exports, WAV mono, projets/ZIP et sécurité');
