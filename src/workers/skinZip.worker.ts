import { buildSkinZipFromEncodedMaps, encodeSkinMap, type BuildSkinZipOptions, type EncodedSkinMaps } from '../skinZip';
import type { SkinZipRequest } from './skinZipProtocol';

let options: BuildSkinZipOptions | undefined;
let finished = false;
const encoded: EncodedSkinMaps = {};

self.onmessage = async (event: MessageEvent<SkinZipRequest>) => {
  const message = event.data;
  try {
    if (message.command === 'init') {
      if (options) throw new Error('Export déjà initialisé.');
      options = message.options;
    } else {
      if (!options || finished) throw new Error('Export indisponible.');
      if (message.command === 'map') {
        encoded[message.id] = encodeSkinMap(message.id, message.image, {
          ...options, ...(message.roles ? { illumRolesByMap: { [message.id]: message.roles } } : {}),
        });
      } else {
        finished = true;
        const blob = await buildSkinZipFromEncodedMaps(encoded, options);
        self.postMessage({ request: message.request, blob });
        return;
      }
    }
    self.postMessage({ request: message.request });
  } catch (error) {
    self.postMessage({ request: message.request, error: error instanceof Error ? error.message : 'Export impossible.' });
  }
};
