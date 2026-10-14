import type { RGBAImage } from '../dds';
import type { Skin3DProject } from '../skin3d';

export type ReliefMode = 'normal' | 'geometry' | 'combined';
export type ReliefVariant = 'standard' | 'normal';
export type ReliefScope = 'hood' | 'vehicle';
export type ReliefTextureResolution = 1024 | 2048 | 4096;

export interface ReliefTemplateAsset {
  url: string;
  sha256: string;
  byteLength: number;
}

export interface ReliefGeometry {
  visualIndex: number;
  /** Native coordinates are metres, in exactly the same frame as preview.glb. */
  positions: number[];
  normals: number[];
  tangents?: number[];
  uv: number[];
  indices: number[];
  /** Feathered physical hood selection; zero outside the prototype area. */
  hoodWeights: number[];
  /** Equal-position seams may only weld within the fixed Body binding. */
  bodyVertices: boolean[];
  /** Fixed native interfaces with animated parts, details, glass and decals. */
  boundaryPoints?: number[];
  offsets: Record<ReliefVariant, { positionOffset: number; normalOffset: number; tangentOffset?: number }>;
  normalEncoding: 'dec3n' | 'float32';
  positionAccessor?: number;
  normalAccessor?: number;
}

export interface ReliefTemplateManifest {
  schemaVersion: 1;
  surfaceMethod?: 'dense-heightfield-v1';
  preview: ReliefTemplateAsset;
  variants: Record<ReliefVariant, ReliefTemplateAsset>;
  geometries: ReliefGeometry[];
  dependencies: (ReliefTemplateAsset & { name: string })[];
  interfaceProtectionVersion?: 1;
  hood?: unknown;
  provenance?: unknown;
}

/** Only the fixed bundled template is patched, never an arbitrary uploaded GBX. */
export interface PreparedReliefTemplate {
  manifest: ReliefTemplateManifest;
  preview: Uint8Array;
  variants: Record<ReliefVariant, Uint8Array>;
  dependencies: { name: string; data: Uint8Array }[];
}

export interface BuildReliefOptions {
  heightAtlas?: RGBAImage;
  /** Trusted local numeric source; never serialized as executable code. */
  heightSample?: (u: number, v: number) => number;
  heightSourceBits?: 8 | 16;
  normalAtlas?: RGBAImage;
  strengthMm: number;
  normalStrength?: number;
  mode: ReliefMode;
  /** Surface textures cover every atlas; volume still targets fixed Body vertices. */
  scope?: ReliefScope;
  textureResolution?: ReliefTextureResolution;
  /** Opt-in game diagnostic: raises the amplitude ceiling from 8 to 80 mm. */
  diagnostic?: boolean;
  template?: PreparedReliefTemplate;
}

export interface ReliefPrototypeResult {
  options: { mode: ReliefMode; strengthMm: number; normalStrength: number; scope: ReliefScope; textureResolution: ReliefTextureResolution; diagnostic: boolean; surfaceMethod?: 'dense-heightfield-v1'; heightSourceBits?: 8 | 16 };
  project: Skin3DProject;
  /** Neutral outside the selected source mask; logical R/G are tangent X/Y for BC5. */
  normalAtlas: RGBAImage | null;
  stats: {
    affectedVertices: number;
    maxDisplacementMm: number;
    hoodVertices: number;
    /** Native fixed Body vertices eligible for the selected volume scope. */
    eligibleVertices: number;
    triangleCount: number;
    templateVariant: ReliefVariant;
  };
}
