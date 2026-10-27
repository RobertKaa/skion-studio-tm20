import assert from 'node:assert/strict';
import { getEnv } from 'fabric/node';
import { inspectMaterialImage } from '../src/materials/import';
import { importWheelLogo, WHEEL_LOGO_LIMITS } from '../src/wheelDesignLogo';

const desktop = getEnv();
Object.assign(globalThis, { document: desktop.document, window: desktop.window });
const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 80;
const context = canvas.getContext('2d')!;
context.fillStyle = '#f97316'; context.fillRect(12, 18, 100, 40);
context.globalAlpha = .5; context.fillStyle = '#7be8c6'; context.fillRect(100, 50, 45, 20);
const original = canvas.toDataURL('image/png');
const bytes = (source: string) => new Uint8Array(Buffer.from(source.slice(source.indexOf(',') + 1), 'base64'));
const png = (source: string, name = 'Mon logo.png') => new File([bytes(source)], name, { type: 'image/png' });
assert.equal(await importWheelLogo(png(original)), original, 'A bounded transparent PNG retains its exact source bytes, pigments and alpha');
assert.equal(canvas.toDataURL(), original, 'Import never writes into the source artwork');

canvas.width = 1600; canvas.height = 400;
context.globalAlpha = 1; context.fillStyle = '#e85a28'; context.fillRect(0, 0, 1600, 400);
const large = canvas.toDataURL('image/png');
const resized = await importWheelLogo(png(large));
assert(resized.length <= WHEEL_LOGO_LIMITS.dataCharacters);
assert.deepEqual(inspectMaterialImage(bytes(resized)), { width: 512, height: 128, pixels: 512 * 128, mime: 'image/png' }, 'Large artwork keeps its aspect ratio and a bounded decode size');

const jpeg = canvas.toDataURL('image/jpeg');
const converted = await importWheelLogo(new File([bytes(jpeg)], 'Sponsor.jpg', { type: 'image/jpeg' }));
assert(converted.startsWith('data:image/png;base64,'), 'JPEG logos are stored as portable raster PNGs');
assert.equal(inspectMaterialImage(bytes(converted)).width, 512);
assert.equal(inspectMaterialImage(bytes(converted)).height, 128);

await assert.rejects(importWheelLogo(new File(['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/logo.png"/></svg>'], 'spoof.png', { type: 'image/png' })), /PNG, JPEG ou WebP/);
await assert.rejects(importWheelLogo(new File([], 'vide.png')), /8 Mo/);
await assert.rejects(importWheelLogo(new File([new Uint8Array(WHEEL_LOGO_LIMITS.fileBytes + 1)], 'big.png')), /8 Mo/);
const bomb = bytes(original); new DataView(bomb.buffer).setUint32(16, 20_000);
await assert.rejects(importWheelLogo(new File([bomb], 'huge.png')), /image trop grande/);
const raw = bytes(original), animated = new Uint8Array(raw.length + 20), chunk = new DataView(animated.buffer);
animated.set(raw.subarray(0, 33)); chunk.setUint32(33, 8); animated.set([97, 99, 84, 76], 37);
chunk.setUint32(41, 2); animated.set(raw.subarray(33), 53);
await assert.rejects(importWheelLogo(new File([animated], 'animated.png')), /logo fixe/);
canvas.width = canvas.height = 0;
console.log('✓ Logos de flanc : PNG exact, ratio et pixels bornés, JPEG portable, fichiers vides/volumineux/truqués/animés refusés');
