import { FloatType } from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { decodeMaterialExrWithParser, type MaterialExrMode, type MaterialExrPixels } from './exr';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ bytes: Uint8Array; mode: MaterialExrMode }>) => void;
  postMessage: (message: { result?: MaterialExrPixels; error?: string }, transfer?: Transferable[]) => void;
};
scope.onmessage = async (event) => {
  try {
    const loader = new EXRLoader().setDataType(FloatType);
    const result = await decodeMaterialExrWithParser(event.data.bytes, event.data.mode, (buffer) => loader.parse(buffer));
    scope.postMessage({ result }, [result.data.buffer,...(result.heightValues?[result.heightValues.buffer]:[])]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'Matériau non importé : EXR illisible.' });
  }
};
