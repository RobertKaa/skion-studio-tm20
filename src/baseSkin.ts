import { MAPS } from './maps';
import type { ProjectBundle, ProjectMaps } from './projectFile';
import type { PreviewViewState } from './three/CarPreview';
import { DEFAULT_WHEEL_SURFACE } from './wheelSurface';

/** A fresh skin has no imported assets, linked layers or custom vehicle files. */
export function createBaseSkinProject(camera: PreviewViewState): ProjectBundle {
  const maps = Object.fromEntries<Record<string, unknown>>(MAPS.map((def) => [def.id, {
    objects: [], background: def.defaultFill, workRes: def.workRes,
    ...(def.kind === 'illum' ? { illumRole: 'always' } : {}),
  }])) as ProjectMaps;
  return {
    document: {
      format: 'tm-skin-studio', version: 2, name: 'MonSkin',
      editor: { maps, speedColor: '#ffffff', illumRole: 'always' },
      workspace: {
        activeMap: 'Skin_B', view: '3d', camera: structuredClone(camera),
        coatIntensity: 1, neonIntensity: 1.4, night: false, braking: false,
        dirtEnabled: true, dirtPreview: 0, environment: { venue: 'studio', mood: 'day' },
        wheelSurface: { ...DEFAULT_WHEEL_SURFACE },
      },
      model: null,
    },
    assets: new Map(),
  };
}
