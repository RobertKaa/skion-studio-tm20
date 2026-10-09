export type LightingMood = 'sunrise' | 'day' | 'sunset' | 'night';
export interface PreviewEnvironment { venue: 'studio' | 'stadium'; mood: LightingMood }
/** Stable workshop lighting, independent of the last selected simulation mood. */
export const STUDIO_LIGHTING = {
  sunColor: 0xffffff, sunPosition: [4, 7, 3] as const, sunIntensity: 2.2,
  sky: 0x8899bb, ground: 0x334422, ambientIntensity: .5,
  environmentIntensity: .9, exposure: 1, headlights: false, background: 0x15181d,
} as const;
export interface LightingPreset {
  id: LightingMood; label: string; shortLabel: string; description: string;
  sky: number; horizon: number; sunColor: number; sunPosition: readonly [number, number, number];
  sunIntensity: number; ambientIntensity: number; environmentIntensity: number; exposure: number;
  floodlights: boolean; headlights: boolean;
}

/** Artistic approximations, not values extracted from Trackmania's renderer. */
export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  { id: 'sunrise', label: 'Lever du soleil', shortLabel: 'Lever', description: 'Lumière rasante, ciel frais et reflets dorés.',
    sky: 0x789bbb, horizon: 0xffc69a, sunColor: 0xffd5a5, sunPosition: [-24, 9, -18],
    sunIntensity: 2.4, ambientIntensity: .55, environmentIntensity: .85, exposure: 1, floodlights: false, headlights: false },
  { id: 'day', label: 'Jour', shortLabel: 'Jour', description: 'Lumière franche pour lire les couleurs et les matières.',
    sky: 0x508cce, horizon: 0xc7e4f5, sunColor: 0xfff5e6, sunPosition: [15, 32, 18],
    sunIntensity: 3.2, ambientIntensity: .85, environmentIntensity: 1, exposure: 1, floodlights: false, headlights: false },
  { id: 'sunset', label: 'Coucher du soleil', shortLabel: 'Coucher', description: 'Soleil bas, reflets cuivrés et ombres longues.',
    sky: 0x606eaa, horizon: 0xff9968, sunColor: 0xffb06b, sunPosition: [28, 6, -16],
    sunIntensity: 2.2, ambientIntensity: .35, environmentIntensity: .6, exposure: 1, floodlights: false, headlights: false },
  { id: 'night', label: 'Nuit', shortLabel: 'Nuit', description: 'Projecteurs du stade et phares actifs pour tester les néons.',
    sky: 0x050b20, horizon: 0x182742, sunColor: 0x8eaee8, sunPosition: [-16, 26, 12],
    sunIntensity: .15, ambientIntensity: .16, environmentIntensity: .4, exposure: 1, floodlights: true, headlights: true },
];

export function isPreviewEnvironment(value: unknown): value is PreviewEnvironment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (v.venue === 'studio' || v.venue === 'stadium') && LIGHTING_PRESETS.some((preset) => preset.id === v.mood);
}

/** Old projects keep their studio and day/night state. Never trust imported arbitrary keys. */
export function resolvePreviewEnvironment(value: unknown, legacyNight = false): PreviewEnvironment {
  return isPreviewEnvironment(value) ? { venue: value.venue, mood: value.mood } : { venue: 'studio', mood: legacyNight ? 'night' : 'day' };
}

export function lightingPreset(mood: LightingMood): LightingPreset {
  return LIGHTING_PRESETS.find((preset) => preset.id === mood) ?? LIGHTING_PRESETS[1];
}

export function previewLighting(value: PreviewEnvironment) {
  return value.venue === 'studio' ? STUDIO_LIGHTING : lightingPreset(value.mood);
}
