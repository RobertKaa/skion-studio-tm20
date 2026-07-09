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
 */

import { Ellipse, Gradient, IText, Polygon, Rect, type FabricObject } from 'fabric';
import type { EditorCore } from './editor/EditorCore';
import {
  ILLUM_ROLES,
  MAP_BY_ID,
  SKIN_REGIONS,
  getRegionOrientation,
  type IllumRole,
  type UVRegion,
} from './maps';
import { UV_GUIDE_ISLANDS } from './uvGuideData';

export type Harmony = 'auto' | 'mono' | 'complementary' | 'analogous' | 'triadic';
export type Pattern = 'auto' | 'stripes' | 'camo' | 'geo' | 'splatter' | 'gradient' | 'solid';
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
  | 'chrome'
  | 'stealth'
  | 'cyber'
  | 'rally'
  | 'retro'
  | 'sponsor'
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
  random: '🎲 Livrée aléatoire',
  racingGT: 'Racing GT',
  chrome: 'Chrome / Métal',
  stealth: 'Furtif mat',
  cyber: 'Cyber néon',
  rally: 'Rallye / Camo',
  retro: 'Rétro bicolore',
  sponsor: 'Sponsor / flat',
  full: 'Aléatoire complet',
};

export const THEME_DESCRIPTIONS: Record<CuratedTheme, string> = {
  racingGT: 'Bandes racing brillantes, numéro mat, carrosserie laquée.',
  chrome: 'Panneaux métallisés et liserés chromés, tons argent.',
  stealth: 'Noir mat + logo/numéro brillant subtil ton sur ton.',
  cyber: 'Carrosserie sombre satinée + accents néon sur les détails.',
  rally: 'Camouflage mat, tons terreux, numéro de rallye.',
  retro: 'Deux tons contrastés, bandes larges, laque brillante.',
  sponsor: 'Aplat sobre satiné avec grand numéro, style usine.',
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

function hexToRgba(hex: string, alpha255: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${(Math.max(0, Math.min(255, alpha255)) / 255).toFixed(3)})`;
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
}

const THEMES: Record<CuratedTheme, ThemeSpec> = {
  // Racing GT : bandes brillantes, numéro mat, carrosserie laquée, accents mats.
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
  },
  // Chrome / Métal : panneaux métallisés, liserés chromés, tons argentés.
  chrome: {
    pattern: 'geo',
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
  },
  // Furtif mat : noir mat, logo/numéro brillant subtil ton sur ton.
  stealth: {
    pattern: 'solid',
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
      deco: 'satin',
    },
    details: 'dark',
    detailMaterial: 'matte',
    wheels: 'dark',
    wheelMaterial: 'satin',
    neon: 'none',
    raceNumber: true,
  },
  // Cyber néon : carrosserie sombre satinée, accents néon sur les détails.
  cyber: {
    pattern: 'stripes',
    finish: 'gloss',
    coat: 'light',
    palette: { harmony: 'triadic', sat: [40, 75], light: [10, 24] },
    materials: {
      body: 'satin',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'satin',
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
  },
  // Rallye / Camo : camouflage mat, tons terreux, numéro de rallye.
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
  },
  // Rétro bicolore : deux tons contrastés, bandes larges, laque.
  retro: {
    pattern: 'stripes',
    finish: 'gloss',
    coat: 'full',
    palette: { harmony: 'complementary', sat: [50, 82], light: [40, 60] },
    materials: {
      body: 'gloss',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'matte',
      panel: 'gloss',
      trim: 'gloss',
      deco: 'gloss',
    },
    details: 'accent',
    detailMaterial: 'gloss',
    wheels: 'base',
    wheelMaterial: 'metallic',
    neon: 'none',
    raceNumber: true,
  },
  // Sponsor / flat : aplat sobre satiné, grand numéro, style usine.
  sponsor: {
    pattern: 'solid',
    finish: 'matte',
    coat: 'light',
    palette: { harmony: 'complementary', sat: [45, 80], light: [42, 62] },
    materials: {
      body: 'satin',
      stripe: 'gloss',
      accent: 'gloss',
      number: 'matte',
      panel: 'satin',
      trim: 'gloss',
      deco: 'gloss',
    },
    details: 'dark',
    detailMaterial: 'satin',
    wheels: 'dark',
    wheelMaterial: 'satin',
    neon: 'none',
    raceNumber: true,
  },
};

/** Construit un thème complètement aléatoire (ancien comportement « bruit »). */
function randomThemeSpec(rng: Rng): ThemeSpec {
  const mats: Material[] = ['gloss', 'satin', 'matte', 'metallic', 'chrome', 'carbon'];
  const rm = () => pick(rng, mats);
  return {
    pattern: pick(rng, ['stripes', 'camo', 'geo', 'splatter', 'gradient'] as const),
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
  };
}

const CURATED_THEMES: CuratedTheme[] = [
  'racingGT',
  'chrome',
  'stealth',
  'cyber',
  'rally',
  'retro',
  'sponsor',
];

function resolveTheme(rng: Rng, theme: Theme): { id: Theme; spec: ThemeSpec } {
  if (theme === 'full') return { id: 'full', spec: randomThemeSpec(rng) };
  if (theme === 'random') {
    const id = pick(rng, CURATED_THEMES);
    return { id, spec: THEMES[id] };
  }
  return { id: theme, spec: THEMES[theme] };
}

// ---------------------------------------------------------------- dessin

const name = (obj: FabricObject, n: string) => {
  (obj as FabricObject & { name?: string }).name = n;
  return obj;
};

/** Rectangle en pixels canvas (issu d'un îlot UV). */
interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Convertit un îlot UV (fractions 0..1, origine haut-gauche) en pixels canvas. */
function regionPx(r: UVRegion, S: number): PxRect {
  return { x: r.x * S, y: r.y * S, w: r.w * S, h: r.h * S };
}

type KeyedRegion = { key: string; r: UVRegion };

/** Îlots réellement peints de la carrosserie, avec leur clé (pour le clipping polygonal). */
function paintRegions(): KeyedRegion[] {
  const R = SKIN_REGIONS;
  return (['top', 'front', 'rear', 'left', 'right', 'archL', 'archR', 'spoiler', 'sillL', 'sillR', 'shoulderL', 'shoulderR', 'rearLow', 'rearSideL'] as const).map(
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

/** Aire (bbox) d'un polygone UV, pour choisir le contour principal d'un îlot. */
function polyBBoxArea(poly: { x: number; y: number }[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return (maxX - minX) * (maxY - minY);
}

/**
 * Contour de clipping (Polygon absolu) pour l'îlot `key` : évite qu'une forme
 * ne bave sur les coutures UV voisines. On retient le plus grand polygone de
 * l'îlot (contour extérieur). Renvoie un objet frais à chaque appel.
 */
function makeClipPath(key: string, S: number): Polygon | null {
  const island = UV_GUIDE_ISLANDS.find((i) => i.key === key);
  if (!island || island.polygons.length === 0) return null;
  const poly = island.polygons.reduce((a, b) => (polyBBoxArea(b) > polyBBoxArea(a) ? b : a));
  const pts = poly.map((p) => ({ x: p.x * S, y: p.y * S }));
  return new Polygon(pts, { absolutePositioned: true, objectCaching: false });
}

/**
 * Position d'un centre garantissant qu'une forme de demi-tailles (hw, hh) reste
 * dans l'îlot. Voir doc historique : réserve la demi-diagonale si la forme tourne.
 */
function containCentered(
  rng: Rng,
  box: PxRect,
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

function shape(
  role: ShapeRole,
  color: string,
  label: string,
  build: (fill: string, mono: boolean) => FabricObject,
  clipKey?: string,
  S?: number,
): DesignShape {
  return {
    role,
    color,
    label,
    make: (fill, mono) => {
      const obj = build(fill, mono);
      if (clipKey && S !== undefined) {
        const cp = makeClipPath(clipKey, S);
        if (cp) obj.clipPath = cp;
      }
      return name(obj, label);
    },
  };
}

// ---------------------------------------------------------------- motifs

/** Bandes racing symétriques, le long du capot/toit, du nez, de l'arrière et des flancs. */
function makeStripes(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  const R = SKIN_REGIONS;
  const double = complexity > 40;
  const withEdges = complexity > 65;
  const wFrac = rand(rng, 0.16, 0.26);
  const gapFrac = wFrac * 1.5;

  const vStripe = (
    key: string,
    region: UVRegion,
    cxFrac: number,
    wf: number,
    color: string,
    role: ShapeRole,
    label = 'Bande',
  ) => {
    const box = regionPx(region, S);
    const w = wf * box.w;
    const left = clamp(box.x + cxFrac * box.w - w / 2, box.x, box.x + box.w - w);
    out.push(
      shape(
        role,
        color,
        label,
        (fill) => new Rect({ left, top: box.y, width: w, height: box.h, fill, originX: 'left', originY: 'top' }),
        key,
        S,
      ),
    );
  };
  const hStripe = (
    key: string,
    region: UVRegion,
    cyFrac: number,
    hf: number,
    color: string,
    role: ShapeRole,
    label = 'Bande latérale',
  ) => {
    const box = regionPx(region, S);
    const h = hf * box.h;
    const top = clamp(box.y + cyFrac * box.h - h / 2, box.y, box.y + box.h - h);
    out.push(
      shape(
        role,
        color,
        label,
        (fill) => new Rect({ left: box.x, top, width: box.w, height: h, fill, originX: 'left', originY: 'top' }),
        key,
        S,
      ),
    );
  };

  // Bandes longitudinales centrées (capot/toit, nez, arrière).
  for (const [key, region] of [
    ['top', R.top],
    ['front', R.front],
    ['rear', R.rear],
  ] as const) {
    if (double) {
      vStripe(key, region, 0.5 - gapFrac / 2, wFrac * 0.55, p.accent1, 'stripe');
      vStripe(key, region, 0.5 + gapFrac / 2, wFrac * 0.55, p.accent1, 'stripe');
    } else {
      vStripe(key, region, 0.5, wFrac, p.accent1, 'stripe');
    }
  }
  // Flancs gauche/droit : mêmes fractions → symétrie garantie.
  for (const [key, region] of [
    ['left', R.left],
    ['right', R.right],
  ] as const) {
    hStripe(key, region, 0.42, 0.26, p.accent1, 'stripe', 'Bande flanc');
    if (double) hStripe(key, region, 0.68, 0.12, p.accent2, 'accent', 'Bande flanc');
    if (withEdges) hStripe(key, region, 0.92, 0.1, p.dark, 'trim', 'Liseré flanc');
  }
  if (withEdges) {
    hStripe('spoiler', R.spoiler, 0.5, 0.5, p.accent2, 'accent', 'Bande aileron');
  }
  return out;
}

function makeCamo(rng: Rng, S: number, p: Palette, complexity: number): DesignShape[] {
  const n = Math.round(14 + (complexity / 100) * 40);
  const out: DesignShape[] = [];
  const regions = paintRegions();
  for (let i = 0; i < n; i++) {
    const { key, r } = pickRegionByArea(rng, regions);
    const box = regionPx(r, S);
    const { cx, cy, hw, hh } = containCentered(
      rng,
      box,
      rand(rng, 0.14, 0.34) * box.w,
      rand(rng, 0.12, 0.3) * box.h,
      true,
    );
    const angle = rand(rng, 0, 180);
    const col = pick(rng, p.tones);
    out.push(
      shape(
        'deco',
        col,
        'Tache camo',
        (fill) =>
          new Ellipse({ left: cx, top: cy, originX: 'center', originY: 'center', rx: hw, ry: hh, angle, fill }),
        key,
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
    const box = regionPx(r, S);
    const col = pick(rng, colors);
    if (rng() < 0.5) {
      const wRaw = rand(rng, 0.2, 0.6) * box.w;
      const hRaw = wRaw * rand(rng, 0.2, 1);
      const { cx, cy, hw, hh } = containCentered(rng, box, wRaw / 2, hRaw / 2, true);
      const angle = pick(rng, [0, 15, 30, 45, -15, -30, -45]);
      const opacity = rand(rng, 0.78, 1);
      out.push(
        shape(
          'panel',
          col,
          'Forme géométrique',
          (fill) =>
            new Rect({
              left: cx,
              top: cy,
              originX: 'center',
              originY: 'center',
              width: hw * 2,
              height: hh * 2,
              angle,
              fill,
              opacity,
            }),
          key,
          S,
        ),
      );
    } else {
      const rRaw = rand(rng, 0.14, 0.4) * Math.min(box.w, box.h);
      const { cx, cy, hw } = containCentered(rng, box, rRaw, rRaw, true);
      const rr = hw;
      const a0 = rand(rng, 0, Math.PI * 2);
      const points = [0, 1, 2].map((k) => ({
        x: cx + rr * Math.cos(a0 + (k * 2 * Math.PI) / 3),
        y: cy + rr * Math.sin(a0 + (k * 2 * Math.PI) / 3),
      }));
      const opacity = rand(rng, 0.78, 1);
      out.push(
        shape('panel', col, 'Triangle', (fill) => new Polygon(points, { fill, opacity }), key, S),
      );
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
    const box = regionPx(r, S);
    const rRaw = rand(rng, 0.01, 0.08) * Math.min(box.w, box.h);
    const { cx, cy, hw } = containCentered(rng, box, rRaw, rRaw, false);
    const col = pick(rng, colors);
    const opacity = rand(rng, 0.7, 1);
    out.push(
      shape(
        'deco',
        col,
        'Éclaboussure',
        (fill) =>
          new Ellipse({ left: cx, top: cy, originX: 'center', originY: 'center', rx: hw, ry: hw, fill, opacity }),
        key,
        S,
      ),
    );
  }
  return out;
}

/**
 * Numéro de course : gros texte centré (capot/toit + deux flancs), redimensionné
 * pour tenir DANS l'îlot. `mono` (Skin_R / Skin_CoatR) supprime le contour coloré
 * pour peindre le glyphe d'une seule valeur (matériau / vernis uniforme).
 *
 * Chaque numéro est ORIENTÉ selon la pièce (REGION_ORIENTATION) pour se lire droit
 * / vers l'avant SUR LA VOITURE, même si l'îlot UV est tourné ou en miroir. Le
 * redimensionnement tient compte de la rotation (bbox tournée) et reste éditable.
 */
function makeRaceNumbers(rng: Rng, S: number, p: Palette, value: string): DesignShape[] {
  const num = value.trim() || String(Math.floor(rand(rng, 10, 100)));
  const [, , baseL] = hexToHsl(p.base);
  const textColor = baseL > 55 ? p.dark : p.light;
  const R = SKIN_REGIONS;
  const margin = 0.82;
  const mk = (key: string, region: UVRegion): DesignShape =>
    shape('number', textColor, `Numéro ${num}`, (fill, mono) => {
      const box = regionPx(region, S);
      const { angle, flipX } = getRegionOrientation(key);
      const t = new IText(num, {
        originX: 'center',
        originY: 'center',
        fontFamily: 'Arial Black, sans-serif',
        fontWeight: 900,
        fontSize: 100,
        fill,
        stroke: mono ? fill : p.accent1,
        strokeWidth: 0,
      });
      // bbox tournée : le numéro doit tenir dans l'îlot une fois orienté voiture.
      const rad = (angle * Math.PI) / 180;
      const ca = Math.abs(Math.cos(rad));
      const sa = Math.abs(Math.sin(rad));
      const bw = t.width * ca + t.height * sa;
      const bh = t.width * sa + t.height * ca;
      const factor = Math.min((box.w * margin) / bw, (box.h * margin) / bh);
      const fontSize = Number.isFinite(factor) && factor > 0 ? 100 * factor : 100;
      t.set({
        fontSize,
        strokeWidth: mono ? 0 : Math.max(2, Math.round(fontSize * 0.035)),
        angle,
        flipX,
        left: box.x + box.w / 2,
        top: box.y + box.h / 2,
      });
      t.setCoords();
      return t;
    });
  return [mk('top', R.top), mk('left', R.left), mk('right', R.right)];
}

/** Néon des détails : quelques fines bandes lumineuses (calques éditables), jamais un aplat plein. */
function makeNeonStrips(rng: Rng, S: number, glow: string, alpha255: number): FabricObject[] {
  const fill = alpha255 >= 255 ? glow : hexToRgba(glow, alpha255);
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
  const palette = buildPalette(rng, opts, spec.palette);

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

  // ---- Construction du DESSIN (partagé Skin_B / Skin_R / Skin_CoatR) -------
  let design: DesignShape[] = [];
  let gradientOverlay = false;
  switch (pattern) {
    case 'stripes':
      design = makeStripes(rng, S, palette, opts.complexity);
      break;
    case 'camo':
      design = makeCamo(rng, S, palette, opts.complexity);
      break;
    case 'geo':
      design = makeGeo(rng, S, palette, opts.complexity);
      break;
    case 'splatter':
      design = makeSplatter(rng, S, palette, opts.complexity);
      break;
    case 'gradient':
      gradientOverlay = true;
      break;
    case 'solid':
      break;
  }
  if (opts.raceNumber) {
    design = design.concat(makeRaceNumbers(rng, S, palette, opts.raceNumberValue));
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
    c.backgroundColor = {
      dark: '#212328',
      accent: hsl(a1h, a1s, 32),
      base: hsl(bh, bs, 28),
    }[wheels];
    c.add(
      name(
        new Rect({
          left: 0,
          top: 0.46 * SW,
          width: SW,
          height: 0.08 * SW,
          fill: palette.accent1,
          originX: 'left',
          originY: 'top',
        }),
        'Liseré jantes',
      ),
    );
  });
  editor.batch('Wheels_R', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = materialColor(spec.wheelMaterial);
  });

  // ---- Détails --------------------------------------------------------------
  const [a2h, a2s] = hexToHsl(palette.accent2);
  editor.batch('Details_B', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = details === 'dark' ? '#3a3d42' : hsl(a2h, a2s, 36);
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
  const roleAlpha = ILLUM_ROLES.find((r) => r.id === opts.neonRole)?.alpha ?? 255;
  editor.batch('Details_I', { clear: opts.clearExisting }, (c) => {
    c.backgroundColor = '#000000';
    if (neonSrc !== 'none') {
      const glow = neonSrc === 'accent' ? palette.accent1 : palette.base;
      makeNeonStrips(rng, S, glow, roleAlpha).forEach((o) => c.add(o));
    }
  });

  editor.flushTexture();
  return { theme: themeId, pattern, finish, palette, seed };
}
