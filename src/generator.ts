/**
 * Générateur aléatoire de skins : à partir d'un thème (livrée) et de critères
 * (couleur, harmonie, motif, finition…), remplit les textures avec des objets
 * fabric normaux, donc entièrement rééditables après génération.
 *
 * Principe central « matériau stratégique » : le DESSIN (bandes, panneaux,
 * numéro…) est décrit une seule fois sous forme de `DesignShape`, puis rendu
 * simultanément sur :
 *   - Skin_B      → la COULEUR de chaque forme,
 *   - Skin_R      → le MATÉRIAU (R = rugosité, G = métal) de chaque forme,
 *   - Skin_CoatR  → le VERNIS (gris) de chaque forme.
 * Les trois cartes partagent donc exactement la même géométrie : le métal, le
 * brillant et le vernis « suivent » le dessin (bande brillante sur carrosserie
 * satinée, liseré chromé, fond de numéro mat, panneaux carbone…).
 *
 * GÉOMÉTRIE DE L'ATLAS (vérifiée en 3D, voir maps.ts / REGION_ORIENTATION) :
 *   - Sur les îlots `top`, `left`, `right`, `shoulderL/R`, l'axe VERTICAL du
 *     canvas est l'axe LONGITUDINAL de la voiture : haut du canvas = ARRIÈRE,
 *     bas du canvas = AVANT. Une bande « racing » est donc toujours une bande
 *     verticale dans le canvas — y compris sur les flancs, où l'axe horizontal
 *     du canvas correspond à la hauteur du pontet (bord intérieur = haut).
 *   - L'atlas est symétrique gauche/droite autour de x = 0.5 (left ↔ right,
 *     shoulderL ↔ shoulderR, sillL ↔ sillR, archL ↔ archR).
 *   - `front` (nez) est sous le capot : large en haut (y ≈ 0.80), pointu en bas.
 *   - `archL` / `archR` sont les DISQUES DE JANTE (faces des roues).
 */

import {
  Ellipse,
  Gradient,
  IText,
  Path,
  Polygon,
  Rect,
  type FabricObject,
} from 'fabric';
import type { EditorCore } from './editor/EditorCore';
import {
  MAP_BY_ID,
  SKIN_REGIONS,
  getRegionOrientation,
  type IllumRole,
  type UVRegion,
} from './maps';
import { UV_GUIDE_ISLANDS } from './uvGuideData';

export type Harmony = 'auto' | 'mono' | 'complementary' | 'analogous' | 'triadic';
export type Pattern =
  | 'auto'
  | 'stripes'
  | 'chevrons'
  | 'swoosh'
  | 'split'
  | 'hex'
  | 'camo'
  | 'geo'
  | 'splatter'
  | 'gradient'
  | 'solid';
export type Finish = 'auto' | 'matte' | 'gloss' | 'metallic' | 'chrome';
export type Coat = 'auto' | 'none' | 'light' | 'full';
export type WheelStyle = 'auto' | 'dark' | 'accent' | 'base';
export type DetailStyle = 'auto' | 'dark' | 'accent';
/** Auto-illumination des détails (néon / feux) via Details_I. */
export type Neon = 'auto' | 'none' | 'accent' | 'base';

/** Thème / livrée : jeu cohérent de couleurs, motif, finition et stratégie matériau/néon. */
export type Theme =
  | 'random' // 🎲 pioche une livrée soignée au hasard
  | 'racingGT'
  | 'retro'
  | 'arrow'
  | 'wave'
  | 'chrome'
  | 'stealth'
  | 'cyber'
  | 'rally'
  | 'drift'
  | 'esport'
  | 'zevent' // hommage ZEvent 2026 (palette, lettrage, Z, cœurs — pas le logo officiel)
  | 'full'; // aléatoire complet (bruit)

type CuratedTheme = Exclude<Theme, 'random' | 'full'>;

export interface GeneratorOptions {
  theme: Theme;
  baseColor: string;
  randomBaseHue: boolean;
  accentColor: string;
  randomAccent: boolean;
  harmony: Harmony;
  pattern: Pattern;
  complexity: number; // 0..100
  raceNumber: boolean;
  raceNumberValue: string; // vide = aléatoire (2 chiffres)
  finish: Finish;
  coat: Coat;
  dirt: number; // 0..100
  wheels: WheelStyle;
  details: DetailStyle;
  neon: Neon;
  neonRole: IllumRole;
  seed: string; // vide = graine aléatoire
  clearExisting: boolean;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  theme: 'random',
  baseColor: '#2f7df6',
  randomBaseHue: true,
  accentColor: '#ffd21f',
  randomAccent: true,
  harmony: 'auto',
  pattern: 'auto',
  complexity: 55,
  raceNumber: true,
  raceNumberValue: '',
  finish: 'auto',
  coat: 'auto',
  dirt: 10,
  wheels: 'auto',
  details: 'auto',
  neon: 'auto',
  neonRole: 'always',
  seed: '',
  clearExisting: true,
};

export const PATTERN_LABELS: Record<Exclude<Pattern, 'auto'>, string> = {
  stripes: 'Bandes racing',
  chevrons: 'Chevrons',
  swoosh: 'Vagues / swoosh',
  split: 'Bicolore (bas de caisse)',
  hex: 'Nid d’abeille',
  camo: 'Camouflage',
  geo: 'Géométrique',
  splatter: 'Éclaboussures',
  gradient: 'Dégradé',
  solid: 'Uni',
};

export const FINISH_LABELS: Record<Exclude<Finish, 'auto'>, string> = {
  matte: 'Mat',
  gloss: 'Brillant',
  metallic: 'Métallisé',
  chrome: 'Chrome',
};

export const NEON_LABELS: Record<Exclude<Neon, 'auto'>, string> = {
  none: 'Aucun',
  accent: "Couleur d'accent",
  base: 'Couleur de base',
};

export const THEME_LABELS: Record<Theme, string> = {
  random: 'Livrée aléatoire',
  racingGT: 'Racing GT',
  retro: 'Rétro bicolore',
  arrow: 'Chevrons racing',
  wave: 'Vague / swoosh',
  chrome: 'Chrome / Métal',
  stealth: 'Furtif mat',
  cyber: 'Cyber néon',
  rally: 'Rallye / Camo',
  drift: 'Drift show',
  esport: 'Esport digital',
  zevent: 'ZEvent 2026',
  full: 'Aléatoire complet',
};

export const THEME_DESCRIPTIONS: Record<CuratedTheme, string> = {
  racingGT: 'Doubles bandes du nez à l’arrière, numéro sur cocarde capot + flancs, laque brillante.',
  retro: 'Bas de caisse contrasté, large bande centrale, cocarde rétro façon endurance.',
  arrow: 'Chevrons pointés vers l’avant sur capot, flancs et arrière, numéro sur le nez.',
  wave: 'Grandes vagues fluides le long des flancs et du capot, numéros latéraux.',
  chrome: 'Swoosh chromés sur carrosserie métallisée, jantes chrome, sans numéro.',
  stealth: 'Noir mat, chevrons brillants ton sur ton, numéro laqué discret.',
  cyber: 'Carrosserie sombre satinée, nid d’abeille lumineux, néon sur les détails.',
  rally: 'Camouflage mat, tons terreux, plaques de numéro blanches.',
  drift: 'Éclaboussures vives, jantes accent, numéros latéraux XXL.',
  esport: 'Sombre digital, panneaux géométriques vifs et néon sur les détails.',
  zevent:
    'Hommage ZEvent 2026 (T-shirt officiel + merch) : noir, vert sérigraphie, ZEVENT outline, swooshes, 10e / dernière édition, pictos 22 assos. Pas une copie du logo.',
};

// ---------------------------------------------------------------- PRNG seedé

type Rng = () => number;

/** mulberry32 : PRNG déterministe, la même graine reproduit le même skin. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------- couleurs

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.min(100, Math.max(0, s));
  l = Math.min(100, Math.max(0, l));
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const rgb = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Éclaircit / assombrit une couleur hex (delta en points de luminosité HSL). */
function shade(hex: string, dl: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hsl(h, s, l + dl);
}

interface Palette {
  base: string;
  accent1: string;
  accent2: string;
  dark: string;
  light: string;
  tones: string[]; // pour le camouflage
}

interface PaletteSpec {
  harmony: Exclude<Harmony, 'auto'>;
  sat: [number, number];
  light: [number, number];
}

function buildPalette(rng: Rng, opts: GeneratorOptions, spec: PaletteSpec): Palette {
  let [h, s, l] = hexToHsl(opts.baseColor);
  if (opts.randomBaseHue) {
    h = rand(rng, 0, 360);
    s = rand(rng, spec.sat[0], spec.sat[1]);
    l = rand(rng, spec.light[0], spec.light[1]);
  }
  const harmony: Exclude<Harmony, 'auto'> = opts.harmony === 'auto' ? spec.harmony : opts.harmony;
  let h1: number;
  let h2: number;
  switch (harmony) {
    case 'mono':
      h1 = h;
      h2 = h;
      break;
    case 'complementary':
      h1 = h + 180;
      h2 = h + 180;
      break;
    case 'analogous':
      h1 = h + 30;
      h2 = h - 30;
      break;
    case 'triadic':
      h1 = h + 120;
      h2 = h - 120;
      break;
  }
  const sat = Math.max(s, 40);
  const accent1 = opts.randomAccent
    ? hsl(h1, sat, harmony === 'mono' ? Math.min(l + 34, 90) : rand(rng, 48, 64))
    : opts.accentColor;
  return {
    base: hsl(h, s, l),
    accent1,
    accent2: hsl(h2, sat, harmony === 'mono' ? Math.max(l - 26, 10) : rand(rng, 28, 46)),
    dark: hsl(h, Math.min(s, 40), 9),
    light: hsl(h, Math.min(s, 28), 93),
    tones: [
      hsl(h, s * 0.9, l),
      hsl(h + rand(rng, -14, 14), s * 0.8, Math.max(l - 18, 8)),
      hsl(h + rand(rng, -14, 14), s * 0.7, Math.min(l + 16, 90)),
      hsl(h, Math.min(s, 35), 14),
    ],
  };
}

/**
 * Palette hommage merch 2026 : noir coton + vert sérigraphie boutique
 * (`#00BD00` / lime T-shirt ~H118), blanc outline. La graine ne décale
 * la teinte que de quelques degrés ; l'utilisateur peut forcer base / accent.
 */
function zeventPalette(rng: Rng, opts: GeneratorOptions): Palette {
  const j = rand(rng, -5, 5);
  const limeH = 118 + j;
  const baseH = 126 + j * 0.3;
  const base = opts.randomBaseHue ? hsl(baseH, 28, 6) : opts.baseColor;
  const accent1 = opts.randomAccent ? hsl(limeH, 86, 44) : opts.accentColor;
  const accent2 = hsl(limeH - 4, 56, 24);
  return {
    base,
    accent1,
    accent2,
    dark: hsl(baseH, 22, 4),
    light: hsl(limeH, 6, 95),
    tones: [accent1, accent2, base, hsl(limeH, 48, 16)],
  };
}

// ---------------------------------------------------------------- matériaux

/** Familles de matériau, converties en canaux Skin_R (R = rugosité, G = métal). */
export type Material = 'gloss' | 'satin' | 'matte' | 'metallic' | 'chrome' | 'carbon';

const MATERIAL_RG: Record<Material, [number, number]> = {
  gloss: [40, 10], // laque brillante (peu rugueux, non métal)
  satin: [115, 12], // satiné/semi-mat
  matte: [205, 8], // mat
  metallic: [80, 195], // peinture métallisée
  chrome: [18, 250], // chrome miroir
  carbon: [130, 150], // carbone (rugosité moyenne, semi-métal)
};

/** Vernis (Skin_CoatR, gris) associé à chaque matériau : les surfaces brillantes reçoivent un vernis fort. */
const MATERIAL_VARNISH: Record<Material, number> = {
  gloss: 235,
  satin: 120,
  matte: 12,
  metallic: 205,
  chrome: 255,
  carbon: 80,
};

const materialColor = (m: Material): string => {
  const [r, g] = MATERIAL_RG[m];
  return rgb(r, g, 0);
};

const finishToMaterial: Record<Exclude<Finish, 'auto'>, Material> = {
  matte: 'matte',
  gloss: 'gloss',
  metallic: 'metallic',
  chrome: 'chrome',
};

/** Rôle d'une forme du dessin : pilote le matériau (Skin_R) et le vernis (Skin_CoatR). */
type ShapeRole = 'body' | 'stripe' | 'accent' | 'number' | 'panel' | 'trim' | 'deco';

interface MaterialScheme {
  body: Material;
  stripe: Material;
  accent: Material;
  number: Material;
  panel: Material;
  trim: Material;
  deco: Material;
}

// ---------------------------------------------------------------- thèmes

/** Emplacements possibles du numéro de course. */
type NumberPlacement = 'nose' | 'hood' | 'flanks';
/** Couleur des disques de jante (îlots archL / archR de la carrosserie). */
type RimStyle = 'none' | 'dark' | 'accent' | 'light' | 'base';

interface ThemeSpec {
  pattern: Exclude<Pattern, 'auto'>;
  finish: Exclude<Finish, 'auto'>;
  coat: Exclude<Coat, 'auto'>;
  palette: PaletteSpec;
  materials: MaterialScheme;
  details: Exclude<DetailStyle, 'auto'>;
  detailMaterial: Material;
  wheels: Exclude<WheelStyle, 'auto'>;
  wheelMaterial: Material;
  neon: Exclude<Neon, 'auto'>;
  raceNumber: boolean;
  /** Où placer le numéro (si activé). */
  numbers: NumberPlacement[];
  /** Cocarde / plaque derrière le numéro du capot. */
  plate: 'none' | 'roundel' | 'plate';
  rims: RimStyle;
}

const THEMES: Record<CuratedTheme, ThemeSpec> = {
  // Racing GT : doubles bandes, cocarde capot, numéros flancs, laque.
  racingGT: {
    pattern: 'stripes',
    finish: 'gloss',
    coat: 'full',
    palette: { harmony: 'complementary', sat: [55, 90], light: [38, 58] },
    materials: {
      body: 'gloss',
      stripe: 'gloss',
      accent: 'matte',
      number: 'matte',
      panel: 'gloss',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'carbon',
    wheels: 'dark',
    wheelMaterial: 'chrome',
    neon: 'none',
    raceNumber: true,
    numbers: ['nose', 'hood', 'flanks'],
    plate: 'roundel',
    rims: 'dark',
  },
  // Rétro bicolore : bas de caisse sombre, large bande centrale, cocarde.
  retro: {
    pattern: 'split',
    finish: 'gloss',
    coat: 'full',
    palette: { harmony: 'complementary', sat: [45, 80], light: [55, 72] },
    materials: {
      body: 'gloss',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'matte',
      panel: 'satin',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'accent',
    detailMaterial: 'gloss',
    wheels: 'base',
    wheelMaterial: 'metallic',
    neon: 'none',
    raceNumber: true,
    numbers: ['nose', 'hood'],
    plate: 'roundel',
    rims: 'light',
  },
  // Chevrons racing : chevrons vifs vers l'avant, numéro sur le nez.
  arrow: {
    pattern: 'chevrons',
    finish: 'gloss',
    coat: 'full',
    palette: { harmony: 'triadic', sat: [60, 92], light: [36, 56] },
    materials: {
      body: 'gloss',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'matte',
      panel: 'gloss',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'carbon',
    wheels: 'dark',
    wheelMaterial: 'chrome',
    neon: 'none',
    raceNumber: true,
    numbers: ['nose', 'hood'],
    plate: 'roundel',
    rims: 'dark',
  },
  // Vague / swoosh : grandes courbes fluides, numéros latéraux.
  wave: {
    pattern: 'swoosh',
    finish: 'gloss',
    coat: 'full',
    palette: { harmony: 'analogous', sat: [55, 90], light: [40, 62] },
    materials: {
      body: 'gloss',
      stripe: 'gloss',
      accent: 'metallic',
      number: 'matte',
      panel: 'gloss',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'satin',
    wheels: 'base',
    wheelMaterial: 'metallic',
    neon: 'none',
    raceNumber: true,
    numbers: ['flanks', 'nose'],
    plate: 'none',
    rims: 'base',
  },
  // Chrome / Métal : swoosh chromés, tons argentés, jantes chrome.
  chrome: {
    pattern: 'swoosh',
    finish: 'metallic',
    coat: 'full',
    palette: { harmony: 'analogous', sat: [8, 30], light: [55, 78] },
    materials: {
      body: 'metallic',
      stripe: 'chrome',
      accent: 'metallic',
      number: 'matte',
      panel: 'chrome',
      trim: 'chrome',
      deco: 'metallic',
    },
    details: 'accent',
    detailMaterial: 'chrome',
    wheels: 'accent',
    wheelMaterial: 'chrome',
    neon: 'none',
    raceNumber: false,
    numbers: ['flanks'],
    plate: 'none',
    rims: 'accent',
  },
  // Furtif mat : noir mat, chevrons brillants ton sur ton, numéro laqué.
  stealth: {
    pattern: 'chevrons',
    finish: 'matte',
    coat: 'none',
    palette: { harmony: 'mono', sat: [4, 22], light: [6, 16] },
    materials: {
      body: 'matte',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'gloss',
      panel: 'satin',
      trim: 'satin',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'matte',
    wheels: 'dark',
    wheelMaterial: 'satin',
    neon: 'none',
    raceNumber: true,
    numbers: ['nose'],
    plate: 'none',
    rims: 'dark',
  },
  // Cyber néon : carrosserie sombre satinée, nid d'abeille, néon sur les détails.
  cyber: {
    pattern: 'hex',
    finish: 'gloss',
    coat: 'light',
    palette: { harmony: 'triadic', sat: [40, 75], light: [10, 24] },
    materials: {
      body: 'satin',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'satin',
      panel: 'gloss',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'gloss',
    wheels: 'accent',
    wheelMaterial: 'gloss',
    neon: 'accent',
    raceNumber: true,
    numbers: ['flanks'],
    plate: 'none',
    rims: 'accent',
  },
  // Rallye / Camo : camouflage mat, tons terreux, plaques de numéro.
  rally: {
    pattern: 'camo',
    finish: 'matte',
    coat: 'light',
    palette: { harmony: 'analogous', sat: [30, 62], light: [28, 52] },
    materials: {
      body: 'matte',
      stripe: 'satin',
      accent: 'matte',
      number: 'matte',
      panel: 'matte',
      trim: 'satin',
      deco: 'matte',
    },
    details: 'dark',
    detailMaterial: 'matte',
    wheels: 'dark',
    wheelMaterial: 'satin',
    neon: 'none',
    raceNumber: true,
    numbers: ['nose', 'hood', 'flanks'],
    plate: 'plate',
    rims: 'dark',
  },
  // Drift show : éclaboussures, jantes accent, numéros XXL.
  drift: {
    pattern: 'splatter',
    finish: 'gloss',
    coat: 'full',
    palette: { harmony: 'triadic', sat: [70, 95], light: [32, 52] },
    materials: {
      body: 'gloss',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'matte',
      panel: 'gloss',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'accent',
    detailMaterial: 'gloss',
    wheels: 'accent',
    wheelMaterial: 'chrome',
    neon: 'none',
    raceNumber: true,
    numbers: ['flanks', 'hood'],
    plate: 'none',
    rims: 'accent',
  },
  // Esport digital : sombre, géométrie vive, néon sur les détails.
  esport: {
    pattern: 'geo',
    finish: 'gloss',
    coat: 'light',
    palette: { harmony: 'triadic', sat: [55, 85], light: [8, 22] },
    materials: {
      body: 'satin',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'gloss',
      panel: 'gloss',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'gloss',
    wheels: 'accent',
    wheelMaterial: 'gloss',
    neon: 'accent',
    raceNumber: true,
    numbers: ['hood', 'flanks'],
    plate: 'none',
    rims: 'accent',
  },
  // Hommage ZEvent 2026 : coton noir mat, graphismes lime/blanc laqués, néon ciblé.
  zevent: {
    pattern: 'stripes',
    finish: 'gloss',
    coat: 'none',
    palette: { harmony: 'analogous', sat: [50, 80], light: [7, 14] },
    materials: {
      body: 'satin',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'gloss',
      panel: 'satin',
      trim: 'chrome',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'gloss',
    wheels: 'accent',
    wheelMaterial: 'gloss',
    neon: 'accent',
    raceNumber: false,
    numbers: [],
    plate: 'none',
    rims: 'accent',
  },
};

/** Construit un thème complètement aléatoire (ancien comportement « bruit »). */
function randomThemeSpec(rng: Rng): ThemeSpec {
  const mats: Material[] = ['gloss', 'satin', 'matte', 'metallic', 'chrome', 'carbon'];
  const rm = () => pick(rng, mats);
  const placements: NumberPlacement[] = ['nose', 'hood', 'flanks'];
  return {
    pattern: pick(rng, ['stripes', 'chevrons', 'swoosh', 'split', 'hex', 'camo', 'geo', 'splatter', 'gradient'] as const),
    finish: pick(rng, ['matte', 'gloss', 'gloss', 'metallic', 'chrome'] as const),
    coat: pick(rng, ['none', 'light', 'full'] as const),
    palette: {
      harmony: pick(rng, ['mono', 'complementary', 'analogous', 'triadic'] as const),
      sat: [45, 90],
      light: [30, 60],
    },
    materials: {
      body: rm(),
      stripe: rm(),
      accent: rm(),
      number: 'matte',
      panel: rm(),
      trim: pick(rng, ['chrome', 'metallic', 'gloss'] as const),
      deco: rm(),
    },
    details: pick(rng, ['dark', 'accent'] as const),
    detailMaterial: rm(),
    wheels: pick(rng, ['dark', 'dark', 'accent', 'base'] as const),
    wheelMaterial: pick(rng, ['chrome', 'metallic', 'satin'] as const),
    neon: pick(rng, ['none', 'none', 'accent', 'base'] as const),
    raceNumber: true,
    numbers: placements.filter(() => rng() < 0.6),
    plate: pick(rng, ['none', 'roundel', 'plate'] as const),
    rims: pick(rng, ['dark', 'accent', 'light', 'base'] as const),
  };
}

const CURATED_THEMES: CuratedTheme[] = [
  'racingGT',
  'retro',
  'arrow',
  'wave',
  'chrome',
  'stealth',
  'cyber',
  'rally',
  'drift',
  'esport',
  'zevent',
];

function resolveTheme(rng: Rng, theme: Theme): { id: Theme; spec: ThemeSpec } {
  if (theme === 'full') return { id: 'full', spec: randomThemeSpec(rng) };
  if (theme === 'random') {
    const id = pick(rng, CURATED_THEMES);
    return { id, spec: THEMES[id] };
  }
  return { id: theme, spec: THEMES[theme] };
}

// ---------------------------------------------------------------- atlas UV

type UVPoint = { x: number; y: number };
/** Rectangle en fractions UV 0..1 (origine haut-gauche). */
interface UVRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const name = (obj: FabricObject, n: string) => {
  (obj as FabricObject & { name?: string }).name = n;
  return obj;
};

function islandPolys(key: string): UVPoint[][] {
  return UV_GUIDE_ISLANDS.find((i) => i.key === key)?.polygons ?? [];
}

function polyBBox(poly: UVPoint[]): UVRect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const rectsIntersect = (a: UVRect, b: UVRect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Plus grand polygone (contour extérieur) d'un îlot. */
function largestPoly(key: string): UVPoint[] | null {
  const polys = islandPolys(key);
  if (!polys.length) return null;
  return polys.reduce((a, b) => {
    const ba = polyBBox(a);
    const bb = polyBBox(b);
    return bb.w * bb.h > ba.w * ba.h ? b : a;
  });
}

/** Miroir gauche/droite d'un rectangle UV (axe x = 0.5). */
const mirrorRect = (r: UVRect): UVRect => ({ x: 1 - r.x - r.w, y: r.y, w: r.w, h: r.h });
const mirrorPts = (pts: UVPoint[]): UVPoint[] => pts.map((p) => ({ x: 1 - p.x, y: p.y }));

/** Clip fabric (Polygon absolu) à partir d'un polygone UV. Objet frais à chaque appel. */
function clipFromPoly(poly: UVPoint[], S: number): Polygon {
  return new Polygon(
    poly.map((p) => ({ x: p.x * S, y: p.y * S })),
    { absolutePositioned: true, objectCaching: false },
  );
}

/**
 * Forme du dessin : décrit une géométrie réutilisable rendue sur les trois
 * cartes carrosserie. `make(fill, mono)` fabrique un objet fabric FRAIS avec la
 * couleur/valeur voulue (mono = true pour Skin_R et Skin_CoatR, où la forme est
 * peinte d'une seule teinte uniforme).
 */
interface DesignShape {
  role: ShapeRole;
  color: string;
  label: string;
  make: (fill: string, mono: boolean) => FabricObject;
}

type Builder = (fill: string, mono: boolean) => FabricObject;

function shape(role: ShapeRole, color: string, label: string, build: Builder, clip?: UVPoint[], S?: number): DesignShape {
  return {
    role,
    color,
    label,
    make: (fill, mono) => {
      const obj = build(fill, mono);
      if (clip && S !== undefined) obj.clipPath = clipFromPoly(clip, S);
      return name(obj, label);
    },
  };
}

/**
 * Forme rognée sur l'îlot `key` : une copie par polygone de l'îlot dont la
 * bounding-box croise `bounds` (les îlots multi-polygones comme le capot
 * restent ainsi couverts sans XOR entre contours imbriqués).
 */
function onIsland(
  key: string,
  bounds: UVRect,
  role: ShapeRole,
  color: string,
  label: string,
  build: Builder,
  S: number,
): DesignShape[] {
  const out: DesignShape[] = [];
  for (const poly of islandPolys(key)) {
    if (!rectsIntersect(polyBBox(poly), bounds)) continue;
    out.push(shape(role, color, label, build, poly, S));
  }
  return out;
}

/** Rectangle (fractions UV) rogné sur un îlot. */
function rectOn(
  key: string,
  r: UVRect,
  role: ShapeRole,
  color: string,
  label: string,
  S: number,
  extra: Record<string, unknown> = {},
): DesignShape[] {
  return onIsland(
    key,
    r,
    role,
    color,
    label,
    (fill) =>
      new Rect({
        left: r.x * S,
        top: r.y * S,
        width: Math.max(r.w * S, 1),
        height: Math.max(r.h * S, 1),
        fill,
        originX: 'left',
        originY: 'top',
        ...extra,
      }),
    S,
  );
}

/** Polygone (fractions UV) rogné sur un îlot. */
function polyOn(
  key: string,
  pts: UVPoint[],
  role: ShapeRole,
  color: string,
  label: string,
  S: number,
  extra: Record<string, unknown> = {},
): DesignShape[] {
  return onIsland(
    key,
    polyBBox(pts),
    role,
    color,
    label,
    (fill) => new Polygon(pts.map((p) => ({ x: p.x * S, y: p.y * S })), { fill, ...extra }),
    S,
  );
}

/** Chemin SVG (coordonnées fractions → pixels) rogné sur un îlot. */
function pathOn(
  key: string,
  d: (s: number) => string,
  bounds: UVRect,
  role: ShapeRole,
  color: string,
  label: string,
  S: number,
  extra: Record<string, unknown> = {},
): DesignShape[] {
  return onIsland(key, bounds, role, color, label, (fill) => new Path(d(S), { fill, ...extra }), S);
}

/** Remplit intégralement un îlot (tous ses polygones) d'une couleur. */
function fillIsland(key: string, role: ShapeRole, color: string, label: string, S: number): DesignShape[] {
  return islandPolys(key).map((poly) =>
    shape(role, color, label, (fill) =>
      new Polygon(poly.map((p) => ({ x: p.x * S, y: p.y * S })), { fill, objectCaching: false }),
    ),
  );
}

/**
 * Chemin « croissant » (swoosh) entre p0 et p1 : deux quadratiques de
 * contrôle c1 (bord extérieur) et c2 (bord intérieur). Fractions UV.
 */
function crescent(p0: UVPoint, p1: UVPoint, c1: UVPoint, c2: UVPoint): (S: number) => string {
  return (S) =>
    `M ${p0.x * S} ${p0.y * S} Q ${c1.x * S} ${c1.y * S} ${p1.x * S} ${p1.y * S} Q ${c2.x * S} ${c2.y * S} ${p0.x * S} ${p0.y * S} Z`;
}

/**
 * Chevron (V) pointant vers le bas du canvas (= AVANT de la voiture) :
 * ouverture `hw` de chaque côté de `cx`, profondeur `depth`, épaisseur `t`,
 * base (branches) à y = `y0`.
 */
function chevronPts(cx: number, y0: number, hw: number, depth: number, t: number): UVPoint[] {
  return [
    { x: cx - hw, y: y0 },
    { x: cx, y: y0 + depth },
    { x: cx + hw, y: y0 },
    { x: cx + hw, y: y0 + t },
    { x: cx, y: y0 + depth + t },
    { x: cx - hw, y: y0 + t },
  ];
}

// ---------------------------------------------------------------- repères de l'atlas

/**
 * Zones « propres » de l'atlas carrosserie (fractions UV), mesurées sur le
 * guide (UV_GUIDE_ISLANDS) et validées en 3D :
 *  - HOOD : capot devant le pare-brise (îlot `top`, visible de face / dessus) ;
 *  - NOSE : partie large du nez, juste sous le capot ;
 *  - POD_L : pontet gauche (x = hauteur, bord intérieur 0.72 = haut ; y = longueur, bas = avant) ;
 *  - REAR_BUMPER : bouclier arrière (axe propre x ≈ 0.211 ; bas du canvas = haut du bouclier).
 */
const HOOD = { cx: 0.5, cy: 0.70 };
const NOSE = { cx: 0.5, cy: 0.875, maxW: 0.19, maxH: 0.10 };
const POD_L = { x0: 0.7207, x1: 0.8867, yRear: 0.3838, yFront: 0.751, numCx: 0.80, numCy: 0.61 };
const REAR_BUMPER = { cx: 0.211, y0: 0.867, y1: 0.98 };

/** Bornes verticales des îlots `top` (rognage exact par polygone). */
const TOP_Y = { y0: 0.0, y1: 0.8125 };

// ---------------------------------------------------------------- motifs

/**
 * Bandes racing : bandes LONGITUDINALES continues (verticales dans le canvas)
 * du nez à l'arrière sur le capot, prolongées sur le bouclier arrière ; bandes
 * latérales le long des pontets (verticales dans le canvas également, cf.
 * en-tête) ; liserés optionnels.
 */
function makeStripes(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  const style = complexity > 70 ? 'triple' : complexity > 35 ? 'double' : 'single';
  const wide = rand(rng, 0.075, 0.105);

  /** Bande longitudinale centrée en `cx` sur capot + nez + bouclier arrière. */
  const longStripe = (offset: number, w: number, color: string, role: ShapeRole, label: string) => {
    const x = 0.5 + offset - w / 2;
    out.push(...rectOn('top', { x, y: TOP_Y.y0, w, h: TOP_Y.y1 - TOP_Y.y0 }, role, color, label, S));
    out.push(...rectOn('front', { x, y: 0.79, w, h: 0.21 }, role, color, label, S));
    // Bouclier arrière : même décalage autour de son propre axe.
    const xr = REAR_BUMPER.cx + offset - w / 2;
    out.push(
      ...rectOn('rear', { x: xr, y: REAR_BUMPER.y0, w, h: REAR_BUMPER.y1 - REAR_BUMPER.y0 }, role, color, label, S),
    );
  };

  if (style === 'single') {
    longStripe(0, wide, p.accent1, 'stripe', 'Bande centrale');
  } else if (style === 'double') {
    const w = wide * 0.5;
    const gap = w * 0.9;
    longStripe(-(gap / 2 + w / 2), w, p.accent1, 'stripe', 'Bande centrale');
    longStripe(gap / 2 + w / 2, w, p.accent1, 'stripe', 'Bande centrale');
  } else {
    longStripe(0, wide * 0.7, p.accent1, 'stripe', 'Bande centrale');
    const thin = wide * 0.22;
    longStripe(-(wide * 0.7) / 2 - thin * 1.4, thin, p.accent2, 'accent', 'Liseré central');
    longStripe((wide * 0.7) / 2 + thin * 1.4, thin, p.accent2, 'accent', 'Liseré central');
  }

  // Bandes latérales : le long du pontet (verticales dans le canvas), à mi-hauteur.
  const podH = POD_L.x1 - POD_L.x0;
  const sideW = podH * rand(rng, 0.22, 0.3);
  const sideX = POD_L.x0 + podH * 0.42 - sideW / 2;
  const sideRect: UVRect = { x: sideX, y: POD_L.yRear, w: sideW, h: POD_L.yFront - POD_L.yRear };
  out.push(...rectOn('left', sideRect, 'stripe', p.accent1, 'Bande flanc G.', S));
  out.push(...rectOn('right', mirrorRect(sideRect), 'stripe', p.accent1, 'Bande flanc D.', S));
  if (style !== 'single') {
    const thinW = podH * 0.09;
    const thinRect: UVRect = { x: sideX + sideW + podH * 0.08, y: POD_L.yRear, w: thinW, h: POD_L.yFront - POD_L.yRear };
    out.push(...rectOn('left', thinRect, 'accent', p.accent2, 'Liseré flanc G.', S));
    out.push(...rectOn('right', mirrorRect(thinRect), 'accent', p.accent2, 'Liseré flanc D.', S));
  }
  if (style === 'triple') {
    // Liseré sombre sur le bord extérieur des épaules (au-dessus des roues arrière).
    const shoulder: UVRect = { x: 0.83, y: 0.26, w: 0.016, h: 0.19 };
    out.push(...rectOn('shoulderL', shoulder, 'trim', p.dark, 'Liseré épaule G.', S));
    out.push(...rectOn('shoulderR', mirrorRect(shoulder), 'trim', p.dark, 'Liseré épaule D.', S));
    // Bande sur les ailettes arrière.
    const sp: UVRect = { x: 0.62, y: 0.79, w: 0.23, h: 0.045 };
    out.push(...rectOn('spoiler', sp, 'accent', p.accent2, 'Bande aileron', S));
  }
  return out;
}

/** Chevrons pointés vers l'avant : capot moteur, capot avant, pontets, bouclier. */
function makeChevrons(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  const count = 2 + Math.round((complexity / 100) * 3); // 2..5 par zone
  const t = rand(rng, 0.028, 0.04);
  const depth = rand(rng, 0.05, 0.075);
  const step = t + rand(rng, 0.03, 0.05);
  const colors = [p.accent1, p.accent1, p.accent2];

  // Capot avant : chevrons depuis le pare-brise vers le nez (y croissant = avant).
  for (let i = 0; i < count; i++) {
    const y0 = 0.56 + i * step;
    if (y0 + depth + t > 0.83) break;
    out.push(
      ...polyOn('top', chevronPts(0.5, y0, 0.17, depth, t), i % 3 === 2 ? 'accent' : 'stripe', colors[i % 3], 'Chevron capot', S),
    );
  }
  // Capot moteur (arrière) : chevrons plus serrés.
  for (let i = 0; i < Math.min(count, 3); i++) {
    const y0 = 0.03 + i * step * 0.85;
    out.push(
      ...polyOn('top', chevronPts(0.5, y0, 0.13, depth * 0.8, t * 0.8), 'stripe', colors[i % 3], 'Chevron arrière', S),
    );
  }
  // Nez : un chevron large juste sous le capot.
  out.push(...polyOn('front', chevronPts(0.5, 0.80, 0.12, depth * 0.9, t), 'stripe', p.accent1, 'Chevron nez', S));
  // Pontets : chevrons couvrant la hauteur du pontet, vers l'avant, dans la partie libre (devant l'ouïe).
  const podCx = (POD_L.x0 + POD_L.x1) / 2;
  const podHw = (POD_L.x1 - POD_L.x0) / 2;
  for (let i = 0; i < Math.min(count, 3); i++) {
    const y0 = 0.545 + i * step;
    if (y0 + depth + t > POD_L.yFront + 0.02) break;
    const pts = chevronPts(podCx, y0, podHw, depth * 0.7, t);
    out.push(...polyOn('left', pts, 'stripe', colors[i % 3], 'Chevron flanc G.', S));
    out.push(...polyOn('right', mirrorPts(pts), 'stripe', colors[i % 3], 'Chevron flanc D.', S));
  }
  // Bouclier arrière : chevron inversé (pointe vers le haut de la voiture = bas du canvas).
  out.push(
    ...polyOn('rear', chevronPts(REAR_BUMPER.cx, 0.875, 0.14, 0.05, t), 'stripe', p.accent1, 'Chevron bouclier', S),
  );
  return out;
}

/** Vagues / swoosh : grands croissants fluides sur capot et pontets, miroir G/D. */
function makeSwoosh(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  const bulge = rand(rng, 0.05, 0.09);
  const topBounds: UVRect = { x: 0.25, y: 0.15, w: 0.5, h: 0.7 };

  // Capot : croissant de l'arrière-extérieur vers l'avant-centre (côté gauche du canvas), puis miroir.
  const p0 = { x: 0.30, y: 0.24 };
  const p1 = { x: 0.455, y: 0.80 };
  const c1 = { x: 0.27 - bulge * 0.4, y: 0.66 };
  const c2 = { x: 0.40 + bulge * 0.6, y: 0.52 };
  out.push(...pathOn('top', crescent(p0, p1, c1, c2), topBounds, 'stripe', p.accent1, 'Vague capot G.', S));
  out.push(
    ...pathOn(
      'top',
      crescent({ x: 1 - p0.x, y: p0.y }, { x: 1 - p1.x, y: p1.y }, { x: 1 - c1.x, y: c1.y }, { x: 1 - c2.x, y: c2.y }),
      topBounds,
      'stripe',
      p.accent1,
      'Vague capot D.',
      S,
    ),
  );
  if (complexity > 45) {
    // Second croissant plus fin, couleur secondaire, légèrement décalé vers l'intérieur.
    const q0 = { x: 0.36, y: 0.30 };
    const q1 = { x: 0.475, y: 0.78 };
    const d1 = { x: 0.34, y: 0.62 };
    const d2 = { x: 0.43, y: 0.56 };
    out.push(...pathOn('top', crescent(q0, q1, d1, d2), topBounds, 'accent', p.accent2, 'Vague fine G.', S));
    out.push(
      ...pathOn(
        'top',
        crescent({ x: 1 - q0.x, y: q0.y }, { x: 1 - q1.x, y: q1.y }, { x: 1 - d1.x, y: d1.y }, { x: 1 - d2.x, y: d2.y }),
        topBounds,
        'accent',
        p.accent2,
        'Vague fine D.',
        S,
      ),
    );
  }
  // Pontets : croissant du haut-arrière vers le bas-avant.
  const podBounds: UVRect = { x: POD_L.x0, y: POD_L.yRear, w: POD_L.x1 - POD_L.x0, h: POD_L.yFront - POD_L.yRear };
  const s0 = { x: POD_L.x0 + 0.01, y: POD_L.yRear + 0.01 };
  const s1 = { x: POD_L.x1 - 0.01, y: POD_L.yFront - 0.005 };
  const e1 = { x: POD_L.x0 - 0.02, y: 0.64 };
  const e2 = { x: POD_L.x0 + 0.085, y: 0.55 };
  out.push(...pathOn('left', crescent(s0, s1, e1, e2), podBounds, 'stripe', p.accent1, 'Vague flanc G.', S));
  out.push(
    ...pathOn(
      'right',
      crescent({ x: 1 - s0.x, y: s0.y }, { x: 1 - s1.x, y: s1.y }, { x: 1 - e1.x, y: e1.y }, { x: 1 - e2.x, y: e2.y }),
      mirrorRect(podBounds),
      'stripe',
      p.accent1,
      'Vague flanc D.',
      S,
    ),
  );
  if (complexity > 65) {
    // Nez : pointe de vague centrale.
    out.push(
      ...pathOn(
        'front',
        crescent({ x: 0.5, y: 0.79 }, { x: 0.5, y: 0.97 }, { x: 0.40, y: 0.90 }, { x: 0.46, y: 0.88 }),
        { x: 0.38, y: 0.79, w: 0.24, h: 0.21 },
        'accent',
        p.accent2,
        'Vague nez G.',
        S,
      ),
      ...pathOn(
        'front',
        crescent({ x: 0.5, y: 0.79 }, { x: 0.5, y: 0.97 }, { x: 0.60, y: 0.90 }, { x: 0.54, y: 0.88 }),
        { x: 0.38, y: 0.79, w: 0.24, h: 0.21 },
        'accent',
        p.accent2,
        'Vague nez D.',
        S,
      ),
    );
  }
  return out;
}

/**
 * Bicolore : bas de caisse (pontets, seuils, épaules, bouclier, diffuseur) dans
 * la teinte sombre + liseré sur l'arête haute du pontet + large bande centrale.
 */
function makeSplit(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  const low = p.accent2;
  for (const key of ['left', 'right', 'sillL', 'sillR', 'rear', 'rearLow', 'shoulderL', 'shoulderR']) {
    out.push(...fillIsland(key, 'panel', low, 'Bas de caisse', S));
  }
  // Liseré clair sur l'arête supérieure du pontet (bord intérieur de l'îlot).
  const trimW = 0.012;
  const trim: UVRect = { x: POD_L.x0, y: POD_L.yRear, w: trimW, h: POD_L.yFront - POD_L.yRear };
  out.push(...rectOn('left', trim, 'trim', p.light, 'Liseré pontet G.', S));
  out.push(...rectOn('right', mirrorRect(trim), 'trim', p.light, 'Liseré pontet D.', S));
  // Large bande centrale (capot + nez), bordée de deux filets si complexe.
  const w = rand(rng, 0.11, 0.15);
  out.push(...rectOn('top', { x: 0.5 - w / 2, y: TOP_Y.y0, w, h: TOP_Y.y1 }, 'stripe', p.accent1, 'Bande centrale', S));
  out.push(...rectOn('front', { x: 0.5 - w / 2, y: 0.79, w, h: 0.21 }, 'stripe', p.accent1, 'Bande centrale', S));
  if (complexity > 50) {
    const f = 0.014;
    for (const sx of [0.5 - w / 2 - f * 1.6, 0.5 + w / 2 + f * 0.6]) {
      out.push(...rectOn('top', { x: sx, y: TOP_Y.y0, w: f, h: TOP_Y.y1 }, 'accent', low, 'Filet central', S));
      out.push(...rectOn('front', { x: sx, y: 0.79, w: f, h: 0.21 }, 'accent', low, 'Filet central', S));
    }
  }
  return out;
}

/** Nid d'abeille : grille d'hexagones sur capot avant + capot moteur, densité décroissante. */
function makeHex(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  const r = rand(rng, 0.019, 0.024);
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  const keep = 0.45 + (complexity / 100) * 0.4;
  const hexPts = (cx: number, cy: number, rr: number): UVPoint[] =>
    [0, 1, 2, 3, 4, 5].map((k) => {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) };
    });
  const grid = (y0: number, y1: number, halfW: number, fadeFrom: number, label: string) => {
    let row = 0;
    for (let cy = y0; cy <= y1; cy += dy, row++) {
      const off = row % 2 ? dx / 2 : 0;
      for (let cx = 0.5 - halfW + off; cx <= 0.5 + halfW; cx += dx) {
        // Densité décroissante en s'éloignant de `fadeFrom` (l'arête de départ).
        const dist = Math.abs(cy - fadeFrom) / Math.max(y1 - y0, 0.01);
        if (rng() > keep * (1.15 - dist)) continue;
        const col = rng() < 0.8 ? p.accent1 : p.accent2;
        const opacity = rand(rng, 0.55, 1);
        out.push(...polyOn('top', hexPts(cx, cy, r * 0.9), 'accent', col, label, S, { opacity }));
      }
    }
  };
  grid(0.575, 0.80, 0.16, 0.575, 'Hexagone capot');
  grid(0.03, 0.15, 0.12, 0.15, 'Hexagone arrière');
  // Pontets : petite grappe d'hexagones à l'avant du pontet.
  const podCx = (POD_L.x0 + POD_L.x1) / 2;
  for (let row = 0; row < 3; row++) {
    for (let k = -1; k <= 1; k++) {
      if (rng() > keep) continue;
      const cx = podCx + k * dx + (row % 2 ? dx / 2 : 0);
      const cy = 0.57 + row * dy;
      const pts = hexPts(cx, cy, r * 0.9);
      const opacity = rand(rng, 0.6, 1);
      out.push(...polyOn('left', pts, 'accent', p.accent1, 'Hexagone flanc G.', S, { opacity }));
      out.push(...polyOn('right', mirrorPts(pts), 'accent', p.accent1, 'Hexagone flanc D.', S, { opacity }));
    }
  }
  return out;
}

type KeyedRegion = { key: string; r: UVRegion };

/** Îlots réellement peints par les motifs aléatoires (hors jantes et petits fragments). */
function paintRegions(): KeyedRegion[] {
  const R = SKIN_REGIONS;
  return (['top', 'front', 'rear', 'left', 'right', 'spoiler', 'sillL', 'sillR', 'shoulderL', 'shoulderR', 'rearLow'] as const).map(
    (key) => ({ key, r: R[key] }),
  );
}

/** Choisit un îlot au hasard, pondéré par sa surface (les grands panneaux reçoivent plus de motifs). */
function pickRegionByArea(rng: Rng, regions: KeyedRegion[]): KeyedRegion {
  const areas = regions.map(({ r }) => r.w * r.h);
  const total = areas.reduce((a, b) => a + b, 0);
  let t = rng() * total;
  for (let i = 0; i < regions.length; i++) {
    t -= areas[i];
    if (t <= 0) return regions[i];
  }
  return regions[regions.length - 1];
}

/**
 * Position d'un centre garantissant qu'une forme de demi-tailles (hw, hh) reste
 * dans la boîte. Réserve la demi-diagonale si la forme tourne.
 */
function containCentered(
  rng: Rng,
  box: UVRect,
  hw: number,
  hh: number,
  angled: boolean,
): { cx: number; cy: number; hw: number; hh: number } {
  if (angled) {
    const maxHalf = Math.min(box.w, box.h) / 2;
    const diag = Math.hypot(hw, hh);
    if (diag > maxHalf && diag > 0) {
      const s = maxHalf / diag;
      hw *= s;
      hh *= s;
    }
    const eff = Math.hypot(hw, hh);
    const cx = box.w > 2 * eff ? rand(rng, box.x + eff, box.x + box.w - eff) : box.x + box.w / 2;
    const cy = box.h > 2 * eff ? rand(rng, box.y + eff, box.y + box.h - eff) : box.y + box.h / 2;
    return { cx, cy, hw, hh };
  }
  hw = Math.min(hw, box.w / 2);
  hh = Math.min(hh, box.h / 2);
  const cx = box.w > 2 * hw ? rand(rng, box.x + hw, box.x + box.w - hw) : box.x + box.w / 2;
  const cy = box.h > 2 * hh ? rand(rng, box.y + hh, box.y + box.h - hh) : box.y + box.h / 2;
  return { cx, cy, hw, hh };
}

/** Forme aléatoire rognée sur le contour principal de son îlot. */
function randomShape(key: string, role: ShapeRole, color: string, label: string, build: Builder, S: number): DesignShape {
  const clip = largestPoly(key) ?? undefined;
  return shape(role, color, label, build, clip, S);
}

function makeCamo(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const n = Math.round(14 + (complexity / 100) * 40);
  const out: DesignShape[] = [];
  const regions = paintRegions();
  for (let i = 0; i < n; i++) {
    const { key, r } = pickRegionByArea(rng, regions);
    const { cx, cy, hw, hh } = containCentered(rng, r, rand(rng, 0.14, 0.34) * r.w, rand(rng, 0.12, 0.3) * r.h, true);
    const angle = rand(rng, 0, 180);
    const col = pick(rng, p.tones);
    out.push(
      randomShape(
        key,
        'deco',
        col,
        'Tache camo',
        (fill) =>
          new Ellipse({
            left: cx * S,
            top: cy * S,
            originX: 'center',
            originY: 'center',
            rx: hw * S,
            ry: hh * S,
            angle,
            fill,
          }),
        S,
      ),
    );
  }
  return out;
}

function makeGeo(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const n = Math.round(6 + (complexity / 100) * 22);
  const out: DesignShape[] = [];
  const colors = [p.accent1, p.accent2, p.dark, p.light];
  const regions = paintRegions();
  for (let i = 0; i < n; i++) {
    const { key, r } = pickRegionByArea(rng, regions);
    const col = pick(rng, colors);
    if (rng() < 0.5) {
      const wRaw = rand(rng, 0.2, 0.6) * r.w;
      const hRaw = wRaw * rand(rng, 0.2, 1);
      const { cx, cy, hw, hh } = containCentered(rng, r, wRaw / 2, hRaw / 2, true);
      const angle = pick(rng, [0, 15, 30, 45, -15, -30, -45]);
      const opacity = rand(rng, 0.78, 1);
      out.push(
        randomShape(
          key,
          'panel',
          col,
          'Forme géométrique',
          (fill) =>
            new Rect({
              left: cx * S,
              top: cy * S,
              originX: 'center',
              originY: 'center',
              width: hw * 2 * S,
              height: hh * 2 * S,
              angle,
              fill,
              opacity,
            }),
          S,
        ),
      );
    } else {
      const rRaw = rand(rng, 0.14, 0.4) * Math.min(r.w, r.h);
      const { cx, cy, hw } = containCentered(rng, r, rRaw, rRaw, true);
      const a0 = rand(rng, 0, Math.PI * 2);
      const points = [0, 1, 2].map((k) => ({
        x: (cx + hw * Math.cos(a0 + (k * 2 * Math.PI) / 3)) * S,
        y: (cy + hw * Math.sin(a0 + (k * 2 * Math.PI) / 3)) * S,
      }));
      const opacity = rand(rng, 0.78, 1);
      out.push(randomShape(key, 'panel', col, 'Triangle', (fill) => new Polygon(points, { fill, opacity }), S));
    }
  }
  return out;
}

function makeSplatter(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const n = Math.round(20 + (complexity / 100) * 60);
  const out: DesignShape[] = [];
  const colors = [p.accent1, p.accent2, p.light, p.dark];
  const regions = paintRegions();
  for (let i = 0; i < n; i++) {
    const { key, r } = pickRegionByArea(rng, regions);
    const rRaw = rand(rng, 0.01, 0.08) * Math.min(r.w, r.h);
    const { cx, cy, hw } = containCentered(rng, r, rRaw, rRaw, false);
    const col = pick(rng, colors);
    const opacity = rand(rng, 0.7, 1);
    out.push(
      randomShape(
        key,
        'deco',
        col,
        'Éclaboussure',
        (fill) =>
          new Ellipse({ left: cx * S, top: cy * S, originX: 'center', originY: 'center', rx: hw * S, ry: hw * S, fill, opacity }),
        S,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------- numéros & jantes

interface TextSpec {
  /** Centre (fractions UV). */
  cx: number;
  cy: number;
  /** Boîte disponible dans le canvas (fractions UV), rotation comprise. */
  maxW: number;
  maxH: number;
  /** Orientation « voiture » (voir REGION_ORIENTATION). */
  angle: number;
  flipX: boolean;
  /** Facteur de taille supplémentaire. */
  scale?: number;
  /** Épaisseur du contour relative à la taille (défaut 0.035). */
  strokeScale?: number;
}

/**
 * Texte ajusté dans une boîte du canvas en tenant compte de sa rotation :
 * on mesure le glyphe à 100 px puis on met à l'échelle pour que la boîte
 * englobante tournée tienne dans maxW × maxH.
 */
function fittedText(text: string, spec: TextSpec, fill: string, stroke: string | undefined, S: number): IText {
  const t = new IText(text, {
    originX: 'center',
    originY: 'center',
    fontFamily: 'Arial Black, sans-serif',
    fontWeight: 900,
    fontSize: 100,
    fill,
  });
  const rad = (spec.angle * Math.PI) / 180;
  const ca = Math.abs(Math.cos(rad));
  const sa = Math.abs(Math.sin(rad));
  const bw = t.width * ca + t.height * sa;
  const bh = t.width * sa + t.height * ca;
  const factor = Math.min((spec.maxW * S) / bw, (spec.maxH * S) / bh) * (spec.scale ?? 1);
  const fontSize = Number.isFinite(factor) && factor > 0 ? 100 * factor : 100;
  t.set({
    fontSize,
    stroke,
    strokeWidth: stroke ? Math.max(2, Math.round(fontSize * (spec.strokeScale ?? 0.035))) : 0,
    angle: spec.angle,
    flipX: spec.flipX,
    left: spec.cx * S,
    top: spec.cy * S,
  });
  t.setCoords();
  return t;
}

function labelOn(
  key: string,
  spec: TextSpec,
  role: ShapeRole,
  color: string,
  label: string,
  text: string,
  S: number,
  stroke?: string,
): DesignShape[] {
  return onIsland(
    key,
    { x: spec.cx - spec.maxW / 2, y: spec.cy - spec.maxH / 2, w: spec.maxW, h: spec.maxH },
    role,
    color,
    label,
    (fill, mono) => fittedText(text, spec, fill, mono ? undefined : stroke, S),
    S,
  );
}

/** Cœur vectoriel (pas le pictogramme officiel) : pointe vers +y canvas. */
function heartD(cx: number, cy: number, s: number): (S: number) => string {
  return (S) => {
    const x = cx * S;
    const y = cy * S;
    const k = s * S;
    return (
      `M ${x} ${y + k * 0.42}` +
      `C ${x - k * 0.55} ${y + k * 0.04} ${x - k * 0.5} ${y - k * 0.4} ${x} ${y - k * 0.16}` +
      `C ${x + k * 0.5} ${y - k * 0.4} ${x + k * 0.55} ${y + k * 0.04} ${x} ${y + k * 0.42} Z`
    );
  };
}

function heartOn(
  key: string,
  cx: number,
  cy: number,
  s: number,
  role: ShapeRole,
  color: string,
  label: string,
  S: number,
): DesignShape[] {
  const bounds: UVRect = { x: cx - s * 0.62, y: cy - s * 0.48, w: s * 1.24, h: s * 1.02 };
  return pathOn(key, heartD(cx, cy, s), bounds, role, color, label, S);
}

function ellipseOn(
  key: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  role: ShapeRole,
  color: string,
  label: string,
  S: number,
): DesignShape[] {
  return onIsland(
    key,
    { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 },
    role,
    color,
    label,
    (fill) =>
      new Ellipse({
        left: cx * S,
        top: cy * S,
        originX: 'center',
        originY: 'center',
        rx: Math.max(rx * S, 1),
        ry: Math.max(ry * S, 1),
        fill,
      }),
    S,
  );
}

function plusOn(
  key: string,
  cx: number,
  cy: number,
  s: number,
  role: ShapeRole,
  color: string,
  label: string,
  S: number,
): DesignShape[] {
  const t = s * 0.3;
  return [
    ...rectOn(key, { x: cx - t / 2, y: cy - s / 2, w: t, h: s }, role, color, label, S),
    ...rectOn(key, { x: cx - s / 2, y: cy - t / 2, w: s, h: t }, role, color, label, S),
  ];
}

/** Mégaphone bâton (hommage merch 2026, pas le pictogramme officiel). */
function megaphoneOn(
  key: string,
  cx: number,
  cy: number,
  s: number,
  role: ShapeRole,
  color: string,
  label: string,
  S: number,
): DesignShape[] {
  const w = s * 1.2;
  const h = s * 0.72;
  const pts: UVPoint[] = [
    { x: cx - w * 0.5, y: cy - h * 0.2 },
    { x: cx + w * 0.08, y: cy - h * 0.36 },
    { x: cx + w * 0.5, y: cy - h * 0.5 },
    { x: cx + w * 0.5, y: cy + h * 0.5 },
    { x: cx + w * 0.08, y: cy + h * 0.36 },
    { x: cx - w * 0.5, y: cy + h * 0.2 },
  ];
  return polyOn(key, pts, role, color, label, S);
}

type ZeventPicto = 'heart' | 'plus' | 'mega' | 'globe';

function zeventPicto(
  kind: ZeventPicto,
  key: string,
  cx: number,
  cy: number,
  s: number,
  role: ShapeRole,
  color: string,
  S: number,
): DesignShape[] {
  if (kind === 'heart') return heartOn(key, cx, cy, s, role, color, 'Picto cœur', S);
  if (kind === 'plus') return plusOn(key, cx, cy, s, role, color, 'Picto +', S);
  if (kind === 'mega') return megaphoneOn(key, cx, cy, s, role, color, 'Picto mégaphone', S);
  return ellipseOn(key, cx, cy, s * 0.48, s * 0.48, role, color, 'Picto globe', S);
}

/** Z racing en barres (lettre bâton, distincte du logo ZEvent). */
function blockZPts(cx: number, cy: number, w: number, h: number, t: number): UVPoint[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const bar = Math.min(t, h * 0.3, w * 0.24);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y0 + bar },
    { x: x0 + bar * 1.35, y: y1 - bar },
    { x: x1, y: y1 - bar },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y1 - bar },
    { x: x1 - bar * 1.35, y: y0 + bar },
    { x: x0, y: y0 + bar },
  ];
}

/**
 * Livrée de fond ZEvent 2026 : bas de caisse vert forêt, swooshes lime façon
 * T-shirt, filets blancs façon casquette, pas de grandes plages vides.
 */
function makeZeventBody(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  for (const key of ['sillL', 'sillR', 'rearLow', 'rearSideL']) {
    out.push(...fillIsland(key, 'panel', p.accent2, 'Bas ZEvent', S));
  }
  out.push(...fillIsland('rear', 'panel', p.dark, 'Bouclier sombre', S));
  out.push(...fillIsland('shoulderL', 'panel', p.dark, 'Épaule sombre G.', S));
  out.push(...fillIsland('shoulderR', 'panel', p.dark, 'Épaule sombre D.', S));

  const stripeW = rand(rng, 0.015, 0.02);
  const gap = 0.11 + (complexity > 60 ? 0.012 : 0);
  // Bandes fines (énergie T-shirt) sur capot / toit avant : le capot moteur
  // reste sombre pour le 10 / Z.
  const hoodStripe = (offset: number, w: number, color: string, role: ShapeRole, label: string) => {
    const x = 0.5 + offset - w / 2;
    out.push(...rectOn('top', { x, y: 0.22, w, h: 0.59 }, role, color, label, S));
    out.push(...rectOn('front', { x, y: 0.79, w, h: 0.21 }, role, color, label, S));
  };
  hoodStripe(-(gap / 2 + stripeW / 2), stripeW, p.accent1, 'stripe', 'Bande ZEvent');
  hoodStripe(gap / 2 + stripeW / 2, stripeW, p.accent1, 'stripe', 'Bande ZEvent');
  const hair = 0.0055;
  hoodStripe(-(gap / 2 + stripeW + hair * 1.8), hair, p.light, 'trim', 'Filet blanc');
  hoodStripe(gap / 2 + stripeW + hair * 0.7, hair, p.light, 'trim', 'Filet blanc');

  // Swooshes lime (pinceau du T-shirt officiel) autour du capot.
  const bulge = rand(rng, 0.04, 0.07);
  const topBounds: UVRect = { x: 0.27, y: 0.18, w: 0.46, h: 0.62 };
  const sp0 = { x: 0.31, y: 0.26 };
  const sp1 = { x: 0.445, y: 0.78 };
  const sc1 = { x: 0.29 - bulge * 0.2, y: 0.58 };
  const sc2 = { x: 0.36 + bulge * 0.25, y: 0.5 };
  out.push(...pathOn('top', crescent(sp0, sp1, sc1, sc2), topBounds, 'stripe', p.accent1, 'Swoosh capot G.', S));
  out.push(
    ...pathOn(
      'top',
      crescent(
        { x: 1 - sp0.x, y: sp0.y },
        { x: 1 - sp1.x, y: sp1.y },
        { x: 1 - sc1.x, y: sc1.y },
        { x: 1 - sc2.x, y: sc2.y },
      ),
      topBounds,
      'stripe',
      p.accent1,
      'Swoosh capot D.',
      S,
    ),
  );
  const podH = POD_L.x1 - POD_L.x0;
  const sideRect: UVRect = {
    x: POD_L.x0 + podH * 0.5,
    y: POD_L.yRear,
    w: podH * 0.34,
    h: POD_L.yFront - POD_L.yRear,
  };
  out.push(...rectOn('left', sideRect, 'stripe', p.accent1, 'Bande flanc G.', S));
  out.push(...rectOn('right', mirrorRect(sideRect), 'stripe', p.accent1, 'Bande flanc D.', S));
  const pipeW = podH * 0.055;
  const pipeRect: UVRect = {
    x: sideRect.x - pipeW * 1.35,
    y: POD_L.yRear,
    w: pipeW,
    h: POD_L.yFront - POD_L.yRear,
  };
  out.push(...rectOn('left', pipeRect, 'trim', p.light, 'Filet flanc G.', S));
  out.push(...rectOn('right', mirrorRect(pipeRect), 'trim', p.light, 'Filet flanc D.', S));

  out.push(...rectOn('spoiler', { x: 0.635, y: 0.775, w: 0.2, h: 0.04 }, 'accent', p.accent1, 'Bande aileron', S));
  out.push(...rectOn('spoiler', { x: 0.635, y: 0.762, w: 0.2, h: 0.008 }, 'trim', p.light, 'Filet aileron', S));
  const shoulder: UVRect = { x: 0.705, y: 0.3, w: 0.11, h: 0.055 };
  out.push(...rectOn('shoulderL', shoulder, 'accent', p.accent1, 'Épaulette G.', S));
  out.push(...rectOn('shoulderR', mirrorRect(shoulder), 'accent', p.accent1, 'Épaulette D.', S));
  out.push(...rectOn('shoulderL', { x: 0.705, y: 0.292, w: 0.11, h: 0.007 }, 'trim', p.light, 'Filet épaule G.', S));
  out.push(
    ...rectOn('shoulderR', { x: 1 - 0.705 - 0.11, y: 0.292, w: 0.11, h: 0.007 }, 'trim', p.light, 'Filet épaule D.', S),
  );

  out.push(
    ...pathOn(
      'front',
      crescent({ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.97 }, { x: 0.39, y: 0.9 }, { x: 0.46, y: 0.88 }),
      { x: 0.38, y: 0.79, w: 0.24, h: 0.21 },
      'stripe',
      p.accent1,
      'Swoosh nez G.',
      S,
    ),
    ...pathOn(
      'front',
      crescent({ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.97 }, { x: 0.61, y: 0.9 }, { x: 0.54, y: 0.88 }),
      { x: 0.38, y: 0.79, w: 0.24, h: 0.21 },
      'stripe',
      p.accent1,
      'Swoosh nez D.',
      S,
    ),
  );
  out.push(...rectOn('rear', { x: 0.07, y: 0.875, w: 0.28, h: 0.01 }, 'trim', p.light, 'Filet bouclier', S));
  return out;
}

/**
 * Marques fixes de l'hommage merch 2026 : ZEVENT outline, 10e, dates, pictos,
 * barre de dons. Textes figés ; la graine ne jitter que les pictos / le compteur.
 */
function makeZeventMarks(rng: Rng, S: number, p: Palette): DesignShape[] {
  const out: DesignShape[] = [];
  const ink = p.light;
  const stroke = p.dark;
  const lime = p.accent1;
  const jitter = () => rand(rng, -0.004, 0.004);
  const hs = 0.034 + rand(rng, -0.004, 0.004);
  const kinds: ZeventPicto[] = ['heart', 'plus', 'mega', 'globe'];

  const outline = (key: string, spec: TextSpec, label: string, text: string) =>
    labelOn(key, { ...spec, strokeScale: 0.1 }, 'number', p.dark, label, text, S, ink);
  const limeWord = (key: string, spec: TextSpec, label: string, text: string) =>
    labelOn(key, spec, 'number', lime, label, text, S, stroke);
  const whiteWord = (key: string, spec: TextSpec, label: string, text: string) =>
    labelOn(key, spec, 'number', ink, label, text, S, stroke);

  // Capot moteur : 10 ghost + Z racing (lisible de dessus / 3/4 arrière).
  out.push(
    ...rectOn('top', { x: 0.378, y: 0.012, w: 0.244, h: 0.148 }, 'panel', p.dark, 'Fond 10 arrière', S, {
      rx: 0.012 * S,
      ry: 0.012 * S,
    }),
  );
  out.push(
    ...outline('top', { cx: 0.5, cy: 0.086, maxW: 0.2, maxH: 0.12, angle: 0, flipX: false, scale: 0.92 }, '10e toit', '10'),
  );
  out.push(...polyOn('top', blockZPts(0.5, 0.086, 0.118, 0.068, 0.02), 'accent', lime, 'Z racing arrière', S));

  out.push(
    ...whiteWord(
      'top',
      { cx: 0.5, cy: 0.2, maxW: 0.26, maxH: 0.032, angle: 0, flipX: false },
      'Dernière édition toit',
      'DERNIÈRE ÉDITION',
    ),
  );
  out.push(
    ...limeWord(
      'top',
      { cx: 0.5, cy: 0.232, maxW: 0.2, maxH: 0.022, angle: 0, flipX: false },
      'From 2016 toit',
      '2016  →  2026',
    ),
  );

  // Plaque titre capot : lockup T-shirt (ZEVENT outline, 2016 | 2026).
  out.push(
    ...rectOn('top', { x: 0.372, y: 0.638, w: 0.256, h: 0.148 }, 'panel', p.dark, 'Plaque titre capot', S, {
      rx: 0.01 * S,
      ry: 0.01 * S,
    }),
  );
  out.push(...rectOn('top', { x: 0.372, y: 0.638, w: 0.256, h: 0.006 }, 'trim', ink, 'Filet plaque capot', S));
  out.push(
    ...outline(
      'top',
      { cx: HOOD.cx, cy: 0.675, maxW: 0.22, maxH: 0.042, angle: 0, flipX: false },
      'ZEVENT capot',
      'ZEVENT',
    ),
  );
  out.push(
    ...whiteWord('top', { cx: 0.43, cy: 0.712, maxW: 0.055, maxH: 0.02, angle: 0, flipX: false }, '2016 capot', '2016'),
  );
  out.push(
    ...limeWord('top', { cx: 0.5, cy: 0.712, maxW: 0.04, maxH: 0.022, angle: 0, flipX: false }, '26 capot', '26'),
  );
  out.push(
    ...whiteWord('top', { cx: 0.57, cy: 0.712, maxW: 0.055, maxH: 0.02, angle: 0, flipX: false }, '2026 capot', '2026'),
  );

  const bar: UVRect = { x: 0.392, y: 0.73, w: 0.216, h: 0.024 };
  out.push(...rectOn('top', bar, 'panel', '#050805', 'Barre dons fond', S, { rx: 0.005 * S, ry: 0.005 * S }));
  const fillRatio = rand(rng, 0.9, 0.97);
  const pad = 0.0035;
  out.push(
    ...rectOn(
      'top',
      { x: bar.x + pad, y: bar.y + pad, w: (bar.w - pad * 2) * fillRatio, h: bar.h - pad * 2 },
      'accent',
      lime,
      'Barre dons fill',
      S,
      { rx: 0.003 * S, ry: 0.003 * S },
    ),
  );
  out.push(
    ...whiteWord(
      'top',
      { cx: HOOD.cx, cy: 0.742, maxW: 0.15, maxH: 0.016, angle: 0, flipX: false, scale: 0.95 },
      'Record dons',
      '32,9 M€',
    ),
  );
  out.push(
    ...limeWord(
      'top',
      { cx: HOOD.cx, cy: 0.766, maxW: 0.18, maxH: 0.016, angle: 0, flipX: false },
      'Dates capot',
      '3-6 SEPT',
    ),
  );

  const oFront = getRegionOrientation('front');
  out.push(
    ...limeWord(
      'front',
      { cx: NOSE.cx, cy: NOSE.cy + 0.008, maxW: 0.1, maxH: 0.038, angle: oFront.angle, flipX: oFront.flipX },
      '26 nez',
      '26',
    ),
  );
  out.push(...heartOn('front', 0.5, 0.948, 0.05, 'accent', lime, 'Cœur nez', S));

  const oRear = getRegionOrientation('rear');
  out.push(
    ...whiteWord(
      'rear',
      { cx: REAR_BUMPER.cx, cy: 0.905, maxW: 0.22, maxH: 0.045, angle: oRear.angle, flipX: oRear.flipX },
      'MERCI arrière',
      'MERCI',
    ),
  );
  out.push(
    ...limeWord(
      'rear',
      { cx: REAR_BUMPER.cx, cy: 0.948, maxW: 0.2, maxH: 0.032, angle: oRear.angle, flipX: oRear.flipX },
      '10e arrière',
      '10e ÉDITION',
    ),
  );

  const oL = getRegionOrientation('left');
  const oR = getRegionOrientation('right');
  const plateW = 0.1;
  const plateH = 0.2;
  const plateL: UVRect = { x: POD_L.numCx - plateW / 2, y: POD_L.numCy - plateH / 2, w: plateW, h: plateH };
  out.push(...rectOn('left', plateL, 'panel', p.dark, 'Plaque #ZEVENT G.', S, { rx: 0.01 * S, ry: 0.01 * S }));
  out.push(...rectOn('right', mirrorRect(plateL), 'panel', p.dark, 'Plaque #ZEVENT D.', S, { rx: 0.01 * S, ry: 0.01 * S }));
  const hashSpecL: TextSpec = {
    cx: POD_L.numCx,
    cy: POD_L.numCy - 0.01,
    maxW: 0.085,
    maxH: 0.17,
    angle: oL.angle,
    flipX: oL.flipX,
  };
  const hashSpecR: TextSpec = { ...hashSpecL, cx: 1 - POD_L.numCx, angle: oR.angle, flipX: oR.flipX };
  out.push(...limeWord('left', hashSpecL, '#ZEVENT flanc G.', '#ZEVENT'));
  out.push(...limeWord('right', hashSpecR, '#ZEVENT flanc D.', '#ZEVENT'));

  const assoL: TextSpec = {
    cx: POD_L.numCx,
    cy: 0.445,
    maxW: 0.075,
    maxH: 0.1,
    angle: oL.angle,
    flipX: oL.flipX,
  };
  const assoR: TextSpec = { ...assoL, cx: 1 - POD_L.numCx, angle: oR.angle, flipX: oR.flipX };
  out.push(...whiteWord('left', assoL, '22 ASSOS G.', '22 ASSOS'));
  out.push(...whiteWord('right', assoR, '22 ASSOS D.', '22 ASSOS'));
  out.push(
    ...limeWord(
      'left',
      { cx: POD_L.numCx, cy: 0.72, maxW: 0.07, maxH: 0.09, angle: oL.angle, flipX: oL.flipX },
      '10e flanc G.',
      '10e',
    ),
  );
  out.push(
    ...limeWord(
      'right',
      { cx: 1 - POD_L.numCx, cy: 0.72, maxW: 0.07, maxH: 0.09, angle: oR.angle, flipX: oR.flipX },
      '10e flanc D.',
      '10e',
    ),
  );

  const oSillL = getRegionOrientation('sillL');
  const oSillR = getRegionOrientation('sillR');
  out.push(
    ...whiteWord(
      'sillL',
      { cx: 0.942, cy: 0.26, maxW: 0.05, maxH: 0.24, angle: oSillL.angle, flipX: oSillL.flipX },
      'ZERATOR seuil',
      'ZERATOR',
    ),
  );
  out.push(
    ...limeWord(
      'sillL',
      { cx: 0.968, cy: 0.5, maxW: 0.03, maxH: 0.2, angle: oSillL.angle, flipX: oSillL.flipX },
      'Dates seuil G.',
      '3-6 SEPT',
    ),
  );
  out.push(
    ...whiteWord(
      'sillR',
      { cx: 0.058, cy: 0.26, maxW: 0.05, maxH: 0.2, angle: oSillR.angle, flipX: oSillR.flipX },
      'DACH seuil',
      'DACH',
    ),
  );
  out.push(
    ...limeWord(
      'sillR',
      { cx: 0.032, cy: 0.5, maxW: 0.03, maxH: 0.16, angle: oSillR.angle, flipX: oSillR.flipX },
      'Hashtag seuil D.',
      '#ZEVENT',
    ),
  );

  out.push(
    ...limeWord('shoulderL', { cx: 0.76, cy: 0.328, maxW: 0.09, maxH: 0.042, angle: 0, flipX: false }, '26 épaule G.', '26'),
  );
  out.push(
    ...limeWord('shoulderR', { cx: 0.24, cy: 0.328, maxW: 0.09, maxH: 0.042, angle: 0, flipX: false }, '26 épaule D.', '26'),
  );

  const oSp = getRegionOrientation('spoiler');
  out.push(
    ...whiteWord(
      'spoiler',
      { cx: 0.73, cy: 0.81, maxW: 0.12, maxH: 0.04, angle: oSp.angle, flipX: oSp.flipX },
      'ZEVENT aileron',
      'ZEVENT',
    ),
  );

  const oLow = getRegionOrientation('rearLow');
  out.push(
    ...whiteWord(
      'rearLow',
      { cx: 0.211, cy: 0.81, maxW: 0.2, maxH: 0.04, angle: oLow.angle, flipX: oLow.flipX },
      '32,9 M€ diffuseur',
      '32,9 M€',
    ),
  );

  const pictoSites: { key: string; cx: number; cy: number; s: number }[] = [
    { key: 'top', cx: 0.34 + jitter(), cy: 0.69, s: hs * 0.9 },
    { key: 'top', cx: 0.66 + jitter(), cy: 0.69, s: hs * 0.9 },
    { key: 'top', cx: 0.36 + jitter(), cy: 0.52, s: hs * 0.7 },
    { key: 'top', cx: 0.64 + jitter(), cy: 0.52, s: hs * 0.7 },
    { key: 'left', cx: 0.848 + jitter(), cy: 0.52, s: hs * 1.15 },
    { key: 'left', cx: 0.848 + jitter(), cy: 0.78, s: hs },
    { key: 'right', cx: 0.152 + jitter(), cy: 0.52, s: hs * 1.15 },
    { key: 'right', cx: 0.152 + jitter(), cy: 0.78, s: hs },
    { key: 'spoiler', cx: 0.7, cy: 0.86, s: hs * 0.9 },
    { key: 'spoiler', cx: 0.78, cy: 0.86, s: hs * 0.75 },
    { key: 'rear', cx: REAR_BUMPER.cx - 0.12, cy: 0.925, s: hs * 0.8 },
    { key: 'rear', cx: REAR_BUMPER.cx + 0.12, cy: 0.925, s: hs * 0.8 },
    { key: 'sillL', cx: 0.94 + jitter(), cy: 0.68, s: hs * 0.7 },
    { key: 'sillR', cx: 0.06 + jitter(), cy: 0.68, s: hs * 0.7 },
    { key: 'shoulderL', cx: 0.82, cy: 0.36, s: hs * 0.7 },
    { key: 'shoulderR', cx: 0.18, cy: 0.36, s: hs * 0.7 },
    { key: 'rearSideL', cx: 0.93, cy: 0.86, s: hs * 0.65 },
    { key: 'rearSideL', cx: 0.96, cy: 0.9, s: hs * 0.55 },
    { key: 'front', cx: 0.43, cy: 0.86, s: hs * 0.7 },
    { key: 'front', cx: 0.57, cy: 0.86, s: hs * 0.7 },
  ];
  pictoSites.forEach((site, i) => {
    const color = i % 3 === 1 ? ink : lime;
    out.push(...zeventPicto(kinds[i % kinds.length], site.key, site.cx, site.cy, site.s, 'deco', color, S));
  });

  out.push(...heartOn('archL', 0.181, 0.123, 0.05, 'deco', p.dark, 'Cœur jante av.', S));
  out.push(...plusOn('archL', 0.181, 0.123, 0.028, 'accent', lime, '+ jante av.', S));
  out.push(...heartOn('archR', 0.814, 0.13, 0.055, 'deco', p.dark, 'Cœur jante ar.', S));
  const oArchR = getRegionOrientation('archR');
  out.push(
    ...limeWord(
      'archR',
      { cx: 0.814, cy: 0.13, maxW: 0.07, maxH: 0.045, angle: oArchR.angle, flipX: oArchR.flipX, scale: 0.9 },
      '26 jante ar.',
      '26',
    ),
  );
  return out;
}

/** Néon lime (Details_I) : filets fins + pastilles — souligne, ne recouvre pas. */
function makeZeventNeon(S: number, glow: string): FabricObject[] {
  const fill = glow;
  const out: FabricObject[] = [];
  const bars = [
    { y: 0.18, h: 0.018, w: 0.62 },
    { y: 0.5, h: 0.016, w: 0.48 },
    { y: 0.82, h: 0.018, w: 0.7 },
  ];
  for (const b of bars) {
    const w = b.w * S;
    const h = b.h * S;
    out.push(
      name(
        new Rect({
          left: (S - w) / 2,
          top: b.y * S - h / 2,
          width: w,
          height: h,
          fill,
          originX: 'left',
          originY: 'top',
        }),
        'Néon ZEvent',
      ),
    );
  }
  for (const [cx, cy, r] of [
    [0.28, 0.22, 0.035],
    [0.72, 0.5, 0.03],
    [0.32, 0.78, 0.032],
    [0.68, 0.84, 0.028],
  ] as const) {
    out.push(
      name(
        new Ellipse({
          left: cx * S,
          top: cy * S,
          originX: 'center',
          originY: 'center',
          rx: r * S,
          ry: r * S,
          fill,
        }),
        'Halo ZEvent',
      ),
    );
  }
  return out;
}

/**
 * Numéros de course, orientés « voiture » :
 *  - nose   : sur la partie large du nez, lisible de face ;
 *  - hood   : sur le capot devant le pare-brise (cocarde / plaque optionnelle), lisible de face ;
 *  - flanks : sur l'avant des pontets, lisible de profil (rotation ±90°).
 * `mono` (Skin_R / Skin_CoatR) supprime le contour coloré (matériau uniforme).
 */
function makeRaceNumbers(
  rng: Rng,
  S: number,
  p: Palette,
  value: string,
  placements: NumberPlacement[],
  plate: ThemeSpec['plate'],
  flankBg?: string,
  /** Couleur imposée du glyphe (ex. ton sur ton pour le thème furtif). */
  numberColor?: string,
): DesignShape[] {
  const num = value.trim() || String(Math.floor(rand(rng, 10, 100)));
  const [, , baseL] = hexToHsl(p.base);
  const onBase = numberColor ?? (baseL > 55 ? p.dark : p.light);
  const out: DesignShape[] = [];
  const nameNum = `Numéro ${num}`;

  const text = (
    spec: TextSpec,
    color: string,
    clipKey: string,
    label: string,
  ): DesignShape[] =>
    onIsland(
      clipKey,
      { x: spec.cx - spec.maxW / 2, y: spec.cy - spec.maxH / 2, w: spec.maxW, h: spec.maxH },
      'number',
      color,
      label,
      (fill, mono) => fittedText(num, spec, fill, mono ? undefined : p.accent1, S),
      S,
    );

  if (placements.includes('nose')) {
    const o = getRegionOrientation('front');
    out.push(...text({ cx: NOSE.cx, cy: NOSE.cy, maxW: NOSE.maxW, maxH: NOSE.maxH, angle: o.angle, flipX: o.flipX }, onBase, 'front', `${nameNum} · nez`));
  }

  if (placements.includes('hood')) {
    // Lisible DE FACE : haut du glyphe vers l'arrière = angle 0 dans le canvas
    // (REGION_ORIENTATION.top = 180° correspond à l'orientation « vue du pilote »).
    const r = 0.095;
    let color = onBase;
    if (plate === 'roundel') {
      out.push(
        ...onIsland(
          'top',
          { x: HOOD.cx - r, y: HOOD.cy - r, w: 2 * r, h: 2 * r },
          'accent',
          p.light,
          'Cocarde capot',
          (fill) =>
            new Ellipse({ left: HOOD.cx * S, top: HOOD.cy * S, originX: 'center', originY: 'center', rx: r * S, ry: r * S, fill }),
          S,
        ),
      );
      color = p.dark;
    } else if (plate === 'plate') {
      const pw = 0.21;
      const ph = 0.13;
      out.push(
        ...rectOn('top', { x: HOOD.cx - pw / 2, y: HOOD.cy - ph / 2, w: pw, h: ph }, 'accent', p.light, 'Plaque capot', S, {
          rx: 0.012 * S,
          ry: 0.012 * S,
        }),
      );
      color = p.dark;
    }
    const maxW = plate === 'roundel' ? r * 1.4 : 0.24;
    const maxH = plate === 'roundel' ? r * 1.15 : plate === 'plate' ? 0.105 : 0.13;
    out.push(...text({ cx: HOOD.cx, cy: HOOD.cy, maxW, maxH, angle: 0, flipX: false }, color, 'top', `${nameNum} · capot`));
  }

  if (placements.includes('flanks')) {
    const bg = flankBg ?? p.base;
    const [, , bgL] = hexToHsl(bg);
    let color = numberColor ?? (bgL > 55 ? p.dark : p.light);
    const specL: TextSpec = {
      cx: POD_L.numCx,
      cy: POD_L.numCy,
      maxW: 0.10,
      maxH: 0.155,
      angle: getRegionOrientation('left').angle,
      flipX: getRegionOrientation('left').flipX,
    };
    const specR: TextSpec = {
      ...specL,
      cx: 1 - POD_L.numCx,
      angle: getRegionOrientation('right').angle,
      flipX: getRegionOrientation('right').flipX,
    };
    if (plate === 'plate') {
      // Plaque rectangulaire (rotation ±90° : largeur = hauteur du pontet).
      const pw = 0.115;
      const ph = 0.17;
      const plateL: UVRect = { x: specL.cx - pw / 2, y: specL.cy - ph / 2, w: pw, h: ph };
      out.push(...rectOn('left', plateL, 'accent', p.light, 'Plaque flanc G.', S, { rx: 0.01 * S, ry: 0.01 * S }));
      out.push(...rectOn('right', mirrorRect(plateL), 'accent', p.light, 'Plaque flanc D.', S, { rx: 0.01 * S, ry: 0.01 * S }));
      color = p.dark;
    }
    out.push(...text(specL, color, 'left', `${nameNum} · flanc G.`));
    out.push(...text(specR, color, 'right', `${nameNum} · flanc D.`));
  }
  return out;
}

/** Disques de jante (îlots archL / archR) : disque + anneau central. */
function makeRims(S: number, p: Palette, style: RimStyle, ring: string): DesignShape[] {
  if (style === 'none') return [];
  const [bh, bs] = hexToHsl(p.base);
  const disc =
    style === 'dark' ? '#1c1e22' : style === 'accent' ? p.accent1 : style === 'light' ? p.light : hsl(bh, bs, 30);
  const out: DesignShape[] = [];
  for (const key of ['archL', 'archR']) {
    const polys = islandPolys(key);
    if (!polys.length) continue;
    const [outer, inner] = polys;
    out.push(shape('panel', disc, 'Jante · disque', (fill) => new Polygon(outer.map((q) => ({ x: q.x * S, y: q.y * S })), { fill, objectCaching: false })));
    if (inner) {
      out.push(shape('trim', ring, 'Jante · anneau', (fill) => new Polygon(inner.map((q) => ({ x: q.x * S, y: q.y * S })), { fill, objectCaching: false })));
    }
  }
  return out;
}

/** Néon des détails : quelques fines bandes lumineuses (calques éditables), jamais un aplat plein. */
function makeNeonStrips(rng: Rng, S: number, glow: string): FabricObject[] {
  const fill = glow;
  const out: FabricObject[] = [];
  // Bandes horizontales fines, largeur ~60-92 %, réparties verticalement.
  const bars = 2 + Math.floor(rng() * 2); // 2 ou 3
  const ys = [0.12, 0.5, 0.86];
  for (let i = 0; i < bars; i++) {
    const cy = ys[i] ?? rand(rng, 0.2, 0.8);
    const h = rand(rng, 0.02, 0.035) * S;
    const wf = rand(rng, 0.6, 0.92);
    const w = wf * S;
    const left = (S - w) / 2 + rand(rng, -0.04, 0.04) * S;
    out.push(
      name(
        new Rect({
          left: clamp(left, 0, S - w),
          top: clamp(cy * S - h / 2, 0, S - h),
          width: w,
          height: h,
          fill,
          originX: 'left',
          originY: 'top',
        }),
        'Néon détails',
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------- génération

export interface GenerationSummary {
  theme: Theme;
  pattern: Exclude<Pattern, 'auto'>;
  finish: Exclude<Finish, 'auto'>;
  palette: Palette;
  seed: number;
}

const coatGray = (coat: Exclude<Coat, 'auto'>): number =>
  ({ none: 8, light: 120, full: 235 })[coat];

export function generateSkin(editor: EditorCore, opts: GeneratorOptions): GenerationSummary {
  const S = MAP_BY_ID.Skin_B.workRes;
  const parsedSeed = Number(opts.seed.trim());
  const seed =
    opts.seed.trim() && Number.isFinite(parsedSeed)
      ? Math.abs(Math.floor(parsedSeed))
      : Math.floor(Math.random() * 1_000_000_000);
  const rng = mulberry32(seed);

  const { id: themeId, spec } = resolveTheme(rng, opts.theme);
  const palette = themeId === 'zevent' ? zeventPalette(rng, opts) : buildPalette(rng, opts, spec.palette);

  // Résolution des choix : l'utilisateur (valeur ≠ « auto ») prime sur le thème.
  const pattern: Exclude<Pattern, 'auto'> = opts.pattern === 'auto' ? spec.pattern : opts.pattern;
  const finish: Exclude<Finish, 'auto'> = opts.finish === 'auto' ? spec.finish : opts.finish;
  const coat: Exclude<Coat, 'auto'> = opts.coat === 'auto' ? spec.coat : opts.coat;
  const wheels: Exclude<WheelStyle, 'auto'> = opts.wheels === 'auto' ? spec.wheels : opts.wheels;
  const details: Exclude<DetailStyle, 'auto'> = opts.details === 'auto' ? spec.details : opts.details;
  const neonSrc: Exclude<Neon, 'auto'> = opts.neon === 'auto' ? spec.neon : opts.neon;

  // La finition explicite pilote le matériau de la carrosserie ; les rôles de
  // dessin gardent le schéma matériau du thème.
  const bodyMaterial: Material =
    opts.finish === 'auto' ? spec.materials.body : finishToMaterial[opts.finish];
  const scheme: MaterialScheme = { ...spec.materials, body: bodyMaterial };
  const materialForRole = (role: ShapeRole): Material => scheme[role];

  // Furtif : motif ton sur ton (à peine plus clair que la base) ; le relief
  // vient du matériau (brillant sur mat), pas de la couleur.
  const drawPalette: Palette =
    themeId === 'stealth'
      ? { ...palette, accent1: shade(palette.base, 7), accent2: shade(palette.base, 12) }
      : palette;

  // ---- Construction du DESSIN (partagé Skin_B / Skin_R / Skin_CoatR) -------
  let design: DesignShape[] = [];
  let gradientOverlay = false;
  const zeventLocked = themeId === 'zevent' && opts.pattern === 'auto';
  if (zeventLocked) {
    design = makeZeventBody(rng, S, drawPalette, opts.complexity);
  } else {
    switch (pattern) {
      case 'stripes':
        design = makeStripes(rng, S, drawPalette, opts.complexity);
        break;
      case 'chevrons':
        design = makeChevrons(rng, S, drawPalette, opts.complexity);
        break;
      case 'swoosh':
        design = makeSwoosh(rng, S, drawPalette, opts.complexity);
        break;
      case 'split':
        design = makeSplit(rng, S, drawPalette, opts.complexity);
        break;
      case 'hex':
        design = makeHex(rng, S, drawPalette, opts.complexity);
        break;
      case 'camo':
        design = makeCamo(rng, S, drawPalette, opts.complexity);
        break;
      case 'geo':
        design = makeGeo(rng, S, drawPalette, opts.complexity);
        break;
      case 'splatter':
        design = makeSplatter(rng, S, drawPalette, opts.complexity);
        break;
      case 'gradient':
        gradientOverlay = true;
        break;
      case 'solid':
        break;
    }
  }
  // Jantes (disques archL/archR) : sous les numéros, au-dessus du motif.
  design = design.concat(makeRims(S, palette, spec.rims, spec.rims === 'accent' ? palette.dark : palette.accent1));
  if (themeId === 'zevent') {
    design = design.concat(makeZeventMarks(rng, S, drawPalette));
  }
  if (opts.raceNumber && themeId !== 'zevent') {
    const placements = spec.numbers.length ? spec.numbers : (['nose'] as NumberPlacement[]);
    // En bicolore, les flancs sont peints dans la teinte sombre : contraste adapté.
    const flankBg = pattern === 'split' ? palette.accent2 : undefined;
    // Furtif : numéro ton sur ton (le matériau laqué le révèle).
    const numberColor = themeId === 'stealth' ? shade(palette.base, 10) : undefined;
    design = design.concat(
      makeRaceNumbers(rng, S, palette, opts.raceNumberValue, placements, spec.plate, flankBg, numberColor),
    );
  }

  // ---- Skin_B : couleur -----------------------------------------------------
  editor.batch('Skin_B', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = palette.base;
    if (gradientOverlay) {
      const diag = rng() < 0.5;
      const grad = new Gradient({
        type: 'linear',
        coords: diag ? { x1: 0, y1: 0, x2: S, y2: S } : { x1: 0, y1: 0, x2: 0, y2: S },
        colorStops: [
          { offset: 0, color: palette.accent1 },
          { offset: 0.5, color: palette.base },
          { offset: 1, color: palette.accent2 },
        ],
      });
      c.add(
        name(new Rect({ left: 0, top: 0, width: S, height: S, fill: grad, originX: 'left', originY: 'top' }), 'Dégradé de fond'),
      );
    }
    design.forEach((d) => c.add(d.make(d.color, false)));
  });

  // ---- Skin_R : matériau (R = rugosité, G = métal), MÊME géométrie ----------
  editor.batch('Skin_R', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = materialColor(bodyMaterial);
    design.forEach((d) => {
      const mat = materialForRole(d.role);
      c.add(name(d.make(materialColor(mat), true), `${d.label} · matériau`));
    });
  });

  // ---- Skin_CoatR : vernis (gris), MÊME géométrie : la laque suit le dessin -
  editor.batch('Skin_CoatR', { clear: opts.clearExisting }, (c) => {
    const bodyV = coatGray(coat);
    c.backgroundColor = rgb(bodyV, bodyV, bodyV);
    design.forEach((d) => {
      const v = MATERIAL_VARNISH[materialForRole(d.role)];
      c.add(name(d.make(rgb(v, v, v), true), `${d.label} · vernis`));
    });
  });

  // ---- Saleté ---------------------------------------------------------------
  const dirtV = Math.round((opts.dirt / 100) * 255);
  editor.batch('Skin_DirtMask', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = rgb(dirtV, dirtV, dirtV);
  });

  // ---- Roues ----------------------------------------------------------------
  const [bh, bs] = hexToHsl(palette.base);
  const [a1h, a1s] = hexToHsl(palette.accent1);
  const SW = MAP_BY_ID.Wheels_B.workRes;
  editor.batch('Wheels_B', { clear: opts.clearExisting }, (c) => {
    // Le pneu reste toujours sombre (une gomme colorée rend mal en 3D) ; le
    // style ne joue que sur une légère teinte et sur le liseré du flanc.
    c.backgroundColor = {
      dark: '#212328',
      accent: hsl(a1h, Math.min(a1s, 40), 13),
      base: hsl(bh, Math.min(bs, 40), 13),
    }[wheels];
    c.add(
      name(
        new Rect({
          left: 0,
          top: 0.46 * SW,
          width: SW,
          height: 0.08 * SW,
          fill: wheels === 'base' ? palette.base : palette.accent1,
          originX: 'left',
          originY: 'top',
        }),
        'Liseré pneus',
      ),
    );
  });
  editor.batch('Wheels_R', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = materialColor(spec.wheelMaterial);
  });

  // ---- Détails --------------------------------------------------------------
  const [a2h, a2s] = hexToHsl(palette.accent2);
  editor.batch('Details_B', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = themeId === 'zevent' ? '#0d1a10' : details === 'dark' ? '#3a3d42' : hsl(a2h, a2s, 36);
    if (themeId === 'zevent') {
      c.add(
        name(
          new Rect({
            left: 0,
            top: 0.46 * S,
            width: S,
            height: 0.045 * S,
            fill: palette.accent1,
            originX: 'left',
            originY: 'top',
          }),
          'Liseré lime détails',
        ),
      );
      c.add(
        name(
          new Rect({
            left: 0.12 * S,
            top: 0.18 * S,
            width: 0.76 * S,
            height: 0.018 * S,
            fill: palette.accent1,
            originX: 'left',
            originY: 'top',
          }),
          'Filet détails haut',
        ),
      );
      c.add(
        name(
          new Rect({
            left: 0.08 * S,
            top: 0.8 * S,
            width: 0.84 * S,
            height: 0.018 * S,
            fill: palette.light,
            originX: 'left',
            originY: 'top',
          }),
          'Filet détails bas',
        ),
      );
      for (const [cx, cy] of [
        [0.22, 0.3],
        [0.5, 0.3],
        [0.78, 0.3],
        [0.22, 0.68],
        [0.78, 0.68],
      ] as const) {
        c.add(
          name(
            new Ellipse({
              left: cx * S,
              top: cy * S,
              originX: 'center',
              originY: 'center',
              rx: 0.028 * S,
              ry: 0.028 * S,
              fill: palette.accent1,
            }),
            'Pastille détails',
          ),
        );
      }
    }
  });
  editor.batch('Details_R', { clear: opts.clearExisting }, (c) => {
    // Matériau des détails (aileron, châssis…) + liseré métallique/chromé.
    c.backgroundColor = materialColor(spec.detailMaterial);
    const trimMat = materialColor(scheme.trim);
    c.add(
      name(
        new Rect({
          left: 0,
          top: 0.46 * S,
          width: S,
          height: 0.06 * S,
          fill: trimMat,
          originX: 'left',
          originY: 'top',
        }),
        'Liseré métal détails',
      ),
    );
  });

  // ---- Néon des détails (Details_I) : couleur peinte = zone qui brille -------
  editor.batch('Details_I', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = '#000000';
    if (neonSrc !== 'none') {
      const glow = neonSrc === 'accent' ? palette.accent1 : palette.base;
      const strips = themeId === 'zevent' ? makeZeventNeon(S, glow) : makeNeonStrips(rng, S, glow);
      strips.forEach((o) => {
        (o as FabricObject & { illumRole?: IllumRole }).illumRole = opts.neonRole;
        c.add(o);
      });
    }
  });

  editor.flushTexture();
  return { theme: themeId, pattern, finish, palette, seed };
}
