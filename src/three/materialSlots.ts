export type PreviewMaterialSlot = 'skin' | 'details' | 'wheels' | 'glass' | 'other';

/** A custom car names its shader and texture atlas separately. */
export function previewMaterialSlot(name: string): PreviewMaterialSlot {
  const family = /(?:SkinDmg|DetailsDmgNormal|GlassDmgCrack|GlassDmgDecal|DetailsDmgDecal|SkinDmgDecal)_([a-z]+)(?:_lod\d+)?$/i.exec(name)?.[1].toLowerCase();
  if (family === 'skin' || family === 'details' || family === 'wheels' || family === 'glass') return family;
  const value = name.toLowerCase();
  if (value.includes('wheel')) return 'wheels';
  if (value.includes('detail')) return 'details';
  if (value.includes('glass')) return 'glass';
  if (value.includes('skin')) return 'skin';
  return 'other';
}

export function hasExperimentalSkinNormalShader(name: string): boolean {
  return /(?:^|_)DetailsDmgNormal_Skin(?:_lod\d+)?$/i.test(name);
}
