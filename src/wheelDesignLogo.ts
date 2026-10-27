import { getEnv } from 'fabric';
import { inspectMaterialImage } from './materials/import';

export const WHEEL_LOGO_LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, dimension: 512, dataCharacters: 400_000 });

function dataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Decode local raster files only, after inspecting their dimensions and byte budget. */
export async function importWheelLogo(file: File): Promise<string> {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > WHEEL_LOGO_LIMITS.fileBytes) {
    throw new Error('Choisissez un logo PNG, JPEG ou WebP de 8 Mo maximum.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > WHEEL_LOGO_LIMITS.fileBytes) throw new Error('Le fichier du logo est trop volumineux.');
  const metadata = inspectMaterialImage(bytes);
  if (metadata.mime === 'image/png') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset);
      if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'acTL') throw new Error('Choisissez un logo fixe : les PNG animés ne sont pas pris en charge.');
      offset += size + 12;
    }
  }
  let image: ImageBitmap | HTMLImageElement | undefined;
  const document = getEnv().document;
  const canvas = document.createElement('canvas');
  try {
    if (typeof createImageBitmap === 'function') {
      image = await createImageBitmap(new Blob([bytes.slice().buffer], { type: metadata.mime }), { colorSpaceConversion: 'none' });
    } else {
      const element = document.createElement('img');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { element.onload = element.onerror = null; element.src = ''; reject(new Error('Le logo n’a pas pu être décodé.')); }, 15_000);
        element.onload = () => { clearTimeout(timer); element.onload = element.onerror = null; resolve(); };
        element.onerror = () => { clearTimeout(timer); element.onload = element.onerror = null; reject(new Error('Le logo est illisible ou endommagé.')); };
        element.src = dataUrl(bytes, metadata.mime);
      });
      image = element;
    }
    const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
    const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
    if (!((width === metadata.width && height === metadata.height) || (width === metadata.height && height === metadata.width))) {
      throw new Error('Les dimensions du logo sont incohérentes.');
    }
    const original = metadata.mime === 'image/png' ? dataUrl(bytes, metadata.mime) : null;
    if (original && Math.max(width, height) <= WHEEL_LOGO_LIMITS.dimension && original.length <= WHEEL_LOGO_LIMITS.dataCharacters) return original;
    let scale = Math.min(1, WHEEL_LOGO_LIMITS.dimension / Math.max(width, height));
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('La conversion du logo est indisponible.');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png');
      if (png.startsWith('data:image/png;base64,') && png.length <= WHEEL_LOGO_LIMITS.dataCharacters) return png;
      scale *= .75;
    }
    throw new Error('Le logo contient trop de détails. Essayez une image plus simple.');
  } finally {
    canvas.width = canvas.height = 0;
    if (image && 'close' in image) image.close();
  }
}
