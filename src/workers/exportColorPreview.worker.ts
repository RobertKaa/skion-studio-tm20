import { compressExportMaterial, type ExportMaterialMapId } from '../exportColorPreview';
import type { RGBAImage } from '../dds';

self.onmessage = (event: MessageEvent<{ images: { id: ExportMaterialMapId; image: RGBAImage }[] }>) => {
  try {
    const images = event.data.images.map(({ id, image }, index) => {
      self.postMessage({ progress: index, id });
      return compressExportMaterial(id, image);
    });
    self.postMessage({ images }, { transfer: images.flatMap((image) => image.levels.map((level) => level.data.buffer as ArrayBuffer)) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Compression indisponible.' });
  }
};
