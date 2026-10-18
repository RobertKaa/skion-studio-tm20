import type { RGBAImage } from '../dds';
import type { MapId } from '../maps';
import type { BuildSkinZipOptions } from '../skinZip';

export type SkinZipRequest = { request: number } & (
  | { command: 'init'; options: BuildSkinZipOptions }
  | { command: 'map'; id: MapId; image: RGBAImage; roles?: RGBAImage }
  | { command: 'finish' }
);
export interface SkinZipReply { request: number; blob?: Blob; error?: string }
