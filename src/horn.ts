/** A skin carries one short, uncompressed mono WAV at the root of its game ZIP. */
export const HORN_FILE_NAME = 'Horn.wav';
export const HORN_ASSET_PATH = 'assets/horn.wav';
export const HORN_SAMPLE_RATE = 44_100;
export const MAX_HORN_SECONDS = 10;
export const MAX_HORN_BYTES = 44 + HORN_SAMPLE_RATE * MAX_HORN_SECONDS * 2;
export const MAX_HORN_SOURCE_BYTES = 10 * 1024 * 1024;

export interface SkinHorn { name: string; data: Uint8Array }

export function hornSourceName(name: string) {
  const leaf = name.split(/[/\\]/).at(-1) ?? '';
  return Array.from(leaf).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').trim().slice(0, 160) || HORN_FILE_NAME;
}

/** Validate the actual payload, including RIFF boundaries, before saving or exporting. */
export function hornDuration(data: Uint8Array): number {
  const invalid = () => { throw new Error('Klaxon invalide : WAV mono PCM 16 bits, 44,1 kHz et 10 secondes maximum attendu.'); };
  if (data.length < 46 || data.length > MAX_HORN_BYTES) return invalid();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (offset: number) => String.fromCharCode(...data.subarray(offset, offset + 4));
  // Our projects store the canonical WAV emitted below; no external URLs or metadata chunks.
  if (tag(0) !== 'RIFF' || view.getUint32(4, true) !== data.length - 8 || tag(8) !== 'WAVE' ||
    tag(12) !== 'fmt ' || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== HORN_SAMPLE_RATE ||
    view.getUint32(28, true) !== HORN_SAMPLE_RATE * 2 || view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 || tag(36) !== 'data' ||
    view.getUint32(40, true) !== data.length - 44 || (data.length - 44) % 2) return invalid();
  return (data.length - 44) / (HORN_SAMPLE_RATE * 2);
}

/** Downmix without clipping decoder overshoots; the browser resamples to 44.1 kHz. */
export function encodeHorn(channels: readonly Float32Array[], sampleRate: number, name: string): SkinHorn {
  const frames = channels[0]?.length ?? 0;
  if (sampleRate !== HORN_SAMPLE_RATE || !frames || channels.length > 8 || channels.some((channel) => channel.length !== frames)) {
    throw new Error('Ce fichier audio ne peut pas être converti en klaxon.');
  }
  if (frames > HORN_SAMPLE_RATE * MAX_HORN_SECONDS) throw new Error('Le klaxon doit durer 10 secondes maximum. Choisissez un extrait plus court.');
  const data = new Uint8Array(44 + frames * 2);
  const view = new DataView(data.buffer);
  const tag = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) data[offset + i] = text.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, data.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, HORN_SAMPLE_RATE, true); view.setUint32(28, HORN_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, frames * 2, true);
  const mono = new Float32Array(frames);
  let sourcePeak = 1;
  for (let i = 0; i < frames; i++) {
    let sample = 0;
    for (const channel of channels) {
      if (!Number.isFinite(channel[i])) throw new Error('Le fichier audio contient des échantillons invalides.');
      sample += channel[i] / channels.length;
    }
    mono[i] = sample;
    sourcePeak = Math.max(sourcePeak, Math.abs(mono[i]));
  }
  // Decoding compressed audio can produce values above full scale. Reduce the
  // whole source before PCM quantisation rather than chopping off those peaks.
  for (let i = 0; i < frames; i++) {
    const sample = mono[i] / sourcePeak;
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return { name: hornSourceName(name), data };
}

// A sustained, audible horn level, with separate peak headroom for its transients.
// Raise the sustained level by 6 dB over the previous -12 dBFS target.
// The existing limiter still reserves 1 dB of peak headroom.
const HORN_TARGET_RMS = 10 ** (-6 / 20);
const HORN_PEAK_LIMIT = 10 ** (-1 / 20);
const HORN_MAX_GAIN = 100;

/** Ignore silent gaps and quiet tails when measuring the audible part of a short horn. */
function audibleRms(samples: Float32Array): number {
  const blockSize = Math.round(HORN_SAMPLE_RATE * .05);
  const energies: { energy: number; frames: number }[] = [];
  let loudest = 0;
  for (let start = 0; start < samples.length; start += blockSize) {
    const end = Math.min(start + blockSize, samples.length);
    let energy = 0;
    for (let i = start; i < end; i++) energy += samples[i] ** 2;
    energies.push({ energy, frames: end - start });
    loudest = Math.max(loudest, energy / (end - start));
  }
  let energy = 0; let frames = 0;
  for (const block of energies) {
    if (block.energy / block.frames < loudest * .01) continue;
    energy += block.energy; frames += block.frames;
  }
  return frames ? Math.sqrt(energy / frames) : 0;
}

/**
 * Prepare the exact WAV heard in the preview and written to the game ZIP.
 * Keep the project source untouched, so repeated exports never accumulate processing.
 * RMS balancing is intended for short horns, not a claim of broadcast LUFS metering.
 */
export function normalizeHornAudio(data: Uint8Array): Uint8Array {
  hornDuration(data);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples = new Float32Array((data.length - 44) / 2);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const pcm = view.getInt16(44 + i * 2, true);
    samples[i] = pcm / (pcm < 0 ? 32768 : 32767);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  // Do not turn silence or a couple of quantisation steps into an audible hiss.
  if (peak <= 2 / 32767) return data;
  const rms = audibleRms(samples);
  // Quantisation tolerance also makes re-importing an already balanced game horn stable.
  if (peak <= HORN_PEAK_LIMIT + 1 / 32767 && Math.abs(20 * Math.log10(rms / HORN_TARGET_RMS)) < .1) return data;
  let gain = Math.min(HORN_MAX_GAIN, HORN_TARGET_RMS / rms);
  const result = new Float32Array(samples.length);
  const envelope = new Float32Array(samples.length);
  const attack = Math.exp(-1 / (HORN_SAMPLE_RATE * .002));
  const release = Math.exp(-1 / (HORN_SAMPLE_RATE * .08));
  for (let pass = 0; pass < 6; pass++) {
    // Look ahead by walking backwards: gain falls smoothly before a transient,
    // without delaying the sound, hard-clipping its waveform or adding any samples.
    let anticipated = 1;
    for (let i = samples.length - 1; i >= 0; i--) {
      const magnitude = Math.abs(samples[i]) * gain;
      const required = magnitude > HORN_PEAK_LIMIT ? HORN_PEAK_LIMIT / magnitude : 1;
      anticipated = Math.min(required, 1 - (1 - anticipated) * attack);
      envelope[i] = anticipated;
    }
    let level = 1;
    for (let i = 0; i < samples.length; i++) {
      level = Math.min(envelope[i], 1 - (1 - level) * release);
      result[i] = Math.max(-HORN_PEAK_LIMIT, Math.min(HORN_PEAK_LIMIT, samples[i] * gain * level));
    }
    const balancedRms = audibleRms(result);
    const correction = HORN_TARGET_RMS / balancedRms;
    const nextGain = Math.min(HORN_MAX_GAIN, gain * correction);
    if (Math.abs(20 * Math.log10(correction)) < .05 || Math.abs(nextGain - gain) < gain * .001) break;
    gain = nextGain;
  }
  return encodeHorn([result], HORN_SAMPLE_RATE, HORN_FILE_NAME).data;
}

/** Probe before decoding to avoid allocating PCM for an unexpectedly long compressed file. */
async function checkSourceDuration(file: Blob): Promise<void> {
  const url = URL.createObjectURL(file);
  const audio = document.createElement('audio');
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Lecture du son trop longue. Essayez un autre fichier.')), 15_000);
      const finish = (error?: Error) => { clearTimeout(timer); if (error) reject(error); else resolve(); };
      audio.onloadedmetadata = () => {
        // MP3 metadata may include encoder padding; decoded samples get the exact check below.
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) finish(new Error('Durée du son illisible.'));
        else if (audio.duration > MAX_HORN_SECONDS + 1) finish(new Error('Le klaxon doit durer 10 secondes maximum. Choisissez un extrait plus court.'));
        else finish();
      };
      audio.onerror = () => finish(new Error('Son illisible. Choisissez un fichier MP3, WAV ou OGG valide.'));
      audio.preload = 'metadata'; audio.src = url;
    });
  } finally {
    audio.onloadedmetadata = null; audio.onerror = null;
    audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
  }
}

/** Convert locally and retain the mono source; preview/export balance its level automatically. */
export async function prepareHorn(file: Blob, name: string): Promise<SkinHorn> {
  if (!/\.(mp3|wav|ogg)$/i.test(name)) throw new Error('Choisissez un son MP3, WAV ou OGG.');
  if (!file.size || file.size > MAX_HORN_SOURCE_BYTES) throw new Error('Le fichier audio doit peser entre 1 octet et 10 Mo.');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Keep canonical WAV sources intact; normalization never overwrites the project source.
  try { hornDuration(bytes); return { name: hornSourceName(name), data: bytes }; } catch { /* Decode other WAV layouts and compressed sources. */ }
  await checkSourceDuration(file);
  let decoded: AudioBuffer;
  try { decoded = await new OfflineAudioContext(1, 1, HORN_SAMPLE_RATE).decodeAudioData(buffer); }
  catch { throw new Error('Son illisible. Choisissez un fichier MP3, WAV ou OGG valide.'); }
  return encodeHorn(Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index)), decoded.sampleRate, name);
}

/** Stable across reloads; changing the audio marks the project as modified. */
export function hornFingerprint(horn: SkinHorn | null): string | null {
  if (!horn) return null;
  let hash = 2166136261;
  for (const byte of horn.data) hash = Math.imul(hash ^ byte, 16777619);
  return `${horn.name}:${horn.data.length}:${hash >>> 0}`;
}
