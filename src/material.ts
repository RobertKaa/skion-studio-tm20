/** Material data in Trackmania's *_R maps: red = roughness, green = metal. */
export interface SurfaceMaterial {
  roughness: number;
  metalness: number;
}

const byte = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 0;

export function encodeSurfaceMaterial({ roughness, metalness }: SurfaceMaterial): string {
  return `#${byte(roughness).toString(16).padStart(2, '0')}${byte(metalness)
    .toString(16)
    .padStart(2, '0')}00`;
}

export function decodeSurfaceMaterial(value: string): SurfaceMaterial {
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)$/i.exec(value.trim());
  if (rgba) return { roughness: byte(Number(rgba[1])), metalness: byte(Number(rgba[2])) };
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return { roughness: 0, metalness: 0 };
  const packed = Number.parseInt(match[1], 16);
  return { roughness: (packed >> 16) & 255, metalness: (packed >> 8) & 255 };
}

export function encodeScalarMap(value: number): string {
  const channel = byte(value).toString(16).padStart(2, '0');
  return `#${channel}${channel}${channel}`;
}

export const SURFACE_PRESETS: { label: string; value: SurfaceMaterial }[] = [
  { label: 'Peinture', value: { roughness: 110, metalness: 0 } },
  { label: 'Mat', value: { roughness: 235, metalness: 0 } },
  { label: 'Métallisé', value: { roughness: 72, metalness: 150 } },
  { label: 'Chrome', value: { roughness: 8, metalness: 255 } },
];
