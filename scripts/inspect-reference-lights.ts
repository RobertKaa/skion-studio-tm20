import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { decodeDDS } from '../src/dds';
const archive = process.argv[2];
if (!archive) throw new Error('Usage : tsx scripts/inspect-reference-lights.ts chemin-du-skin.zip [--raw]');
const zip = await JSZip.loadAsync(fs.readFileSync(archive));
const entries = Object.values(zip.files).filter(e => !e.dir).map(e => e.name);
const report: unknown[] = [];
for (const name of ['Skin_I.dds', 'Wheels_I.dds', 'Details_I.dds', 'Glass_I.dds']) {
  const bytes = await zip.file(name)!.async('uint8array');
  const image = decodeDDS(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (!image) throw new Error(`DDS invalide : ${name}`);
  const alpha: Record<string, number> = {}; let lit = 0;
  for(let i = 0; i < image.data.length; i += 4) if(Math.max(...image.data.subarray(i, i + 3)) > 20) { lit++; alpha[image.data[i + 3]] = (alpha[image.data[i + 3]] ?? 0) + 1; }
  report.push({ name, width: image.width, height: image.height, lit, alpha });
  if (process.argv.includes('--raw')) fs.writeFileSync(`audit-evidence/${name}.rgba`, image.data);
}
const result = { archive: path.basename(archive), entries, modelFiles: entries.filter(n => /\.(gbx|glb|fbx)$/i.test(n)), maps: report };
fs.writeFileSync('audit-evidence/kr2021-illumination-analysis.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
