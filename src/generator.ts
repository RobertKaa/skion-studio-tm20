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
  type MapId,
} from './maps';
import { UV_GUIDE_ISLANDS } from './uvGuideData';
import { WHEEL_UV_GUIDE } from './wheelUvGuide';
import { LIVERY_COMPOSITIONS, LIVERY_PALETTES } from './liveryDirections';
import { projectSurfacePolygons } from './generatorSurface';
import { tribalMotif, flameMotif, tornMotif, transformMotif, ribbon, type MotifPolygon } from './generatorMotifs';

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
export type Finish = 'auto' | 'matte' | 'satin' | 'gloss' | 'metallic' | 'chrome';
export type Coat = 'auto' | 'none' | 'light' | 'full';
export type WheelStyle = 'auto' | 'dark' | 'accent' | 'base';
export type DetailStyle = 'auto' | 'dark' | 'accent';
/** Auto-illumination des détails (néon / feux) via Details_I. */
export type Neon = 'auto' | 'none' | 'accent' | 'base';

/** Thème / livrée : jeu cohérent de couleurs, motif, finition et stratégie matériau/néon. */
export type Theme = 'random' | 'endurance' | 'heritage' | 'touring' | 'rallyRaid' | 'trackday' | 'streetArt' | 'drift' | 'nightRun' | 'fantasy';
export type Tire = 'auto' | 'slick' | 'semiSlick' | 'wet' | 'rally';
export type Lights = 'auto' | 'brake' | 'endurance' | 'street' | 'none';

type CuratedTheme = Exclude<Theme, 'random'>;

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
  tire: Tire;
  wear: number;
  lights: Lights;
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
  dirt: 25,
  wheels: 'auto',
  details: 'auto',
  neon: 'auto',
  neonRole: 'brake',
  seed: '',
  clearExisting: true,
  tire: 'auto',
  wear: 8,
  lights: 'auto',
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
  satin: 'Satiné',
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
  random: 'Surprenez-moi',
  endurance: 'Endurance Prototype',
  heritage: 'Rallye 90',
  touring: 'Grand Prix',
  rallyRaid: 'Rallye Works',
  trackday: 'Stock Car',
  streetArt: 'Tuning Tribal',
  drift: 'Tuning Showcar',
  nightRun: 'Tuning Performance',
  fantasy: 'Prisme vivant',
};

export const THEME_DESCRIPTIONS: Record<CuratedTheme, string> = {
  endurance: 'Bandes des prototypes des 24 heures, palettes Gulf ou tricolores, repères de classe et carbone.',
  heritage: 'Comètes bleu et or, rubans vert et rouge ou blocs Groupe B : les codes des rallyes des années 90.',
  touring: 'Papaye et carbone, rouge course ou argent et turquoise : des panneaux dessinés pour une monoplace.',
  rallyRaid: 'Découpes de carrosserie, plaques de spéciale, partenaires et protections : une équipe de rallye usine.',
  trackday: 'Capot publicitaire, grands aplats, numéros détourés et flammes : les codes du stock-car américain.',
  streetArt: 'Tuning années 2000 : grands tribaux, dragon mécanique, peinture candy et capot carbone.',
  drift: 'Déchirures chromées, flammes et vagues bicolores, jantes brillantes et néons : l’esprit des showcars.',
  nightRun: 'Bandes agressives, griffures, sponsors de préparateur et carbone : une préparation japonaise de rue.',
  fantasy: 'Cristaux, nébuleuses et circuits arcanes. Matières minérales, veines lumineuses et réactions au freinage.',
};

export const THEME_CATALOG = (['endurance', 'heritage', 'touring', 'rallyRaid', 'trackday', 'streetArt', 'drift', 'nightRun', 'fantasy'] as const).map((id, index) => ({
  id, label: THEME_LABELS[id], description: THEME_DESCRIPTIONS[id], category: index < 5 ? 'competition' as const : id==='fantasy' ? 'fantasy' as const : 'street' as const,
  colors: [
    ['#71bed7', '#f87518', '#f6f0db'], ['#123c94', '#edc847', '#f4f1e4'],
    ['#f47a18', '#192128', '#e8edf0'], ['#f1f1e9', '#d92430', '#182025'],
    ['#133a82', '#ffcc20', '#f7f0db'], ['#8bdb13', '#433a97', '#e4e8ec'],
    ['#c31930', '#ccd7de', '#262232'], ['#b7c2ce', '#d62631', '#19232b'],
    ['#302453', '#2cebdd', '#de7fe8'],
  ][index],
  tags: [
    ['24 heures', 'Carbone', 'Slicks'], ['Années 90', 'Or', 'Gravier'], ['F1', 'Papaye', 'Carbone'],
    ['Rallye usine', 'Plaques', 'Gravier'], ['NASCAR', 'Sponsors', 'Slicks'], ['Tribal', 'Candy', 'Carbone'],
    ['Flammes', 'Chrome', 'Néons'], ['JDM', 'Vinyles', 'Carbone'],
    ['Minéral', 'Lumière', 'Fantaisie'],
  ][index],
}));

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

// ---------------------------------------------------------------- matériaux

/** Familles de matériau, converties en canaux Skin_R (R = rugosité, G = métal). */
export type Material = 'gloss' | 'satin' | 'matte' | 'metallic' | 'chrome' | 'carbon' | 'vinyl';

const MATERIAL_RG: Record<Material, [number, number]> = {
  gloss: [40, 10], // laque brillante (peu rugueux, non métal)
  satin: [115, 12], // satiné/semi-mat
  matte: [205, 8], // mat
  metallic: [80, 195], // peinture métallisée
  chrome: [18, 250], // chrome miroir
  carbon: [130, 8], // carbone (rugosité moyenne, semi-métal)
  vinyl: [180, 0], // adhésif mat : diélectrique, indépendant de la peinture
};

/** Vernis (Skin_CoatR, gris) associé à chaque matériau : les surfaces brillantes reçoivent un vernis fort. */
const MATERIAL_VARNISH: Record<Material, number> = {
  gloss: 235,
  satin: 120,
  matte: 12,
  metallic: 205,
  chrome: 255,
  carbon: 80,
  vinyl: 0,
};

const materialColor = (m: Material): string => {
  const [r, g] = MATERIAL_RG[m];
  return rgb(r, g, 0);
};

const finishToMaterial: Record<Exclude<Finish, 'auto'>, Material> = {
  matte: 'matte',
  satin: 'satin',
  gloss: 'gloss',
  metallic: 'metallic',
  chrome: 'chrome',
};

/** Rôle d'une forme du dessin : pilote le matériau (Skin_R) et le vernis (Skin_CoatR). */
type ShapeRole = 'body' | 'stripe' | 'accent' | 'number' | 'panel' | 'trim' | 'deco' | 'decal';

interface MaterialScheme {
  body: Material;
  stripe: Material;
  accent: Material;
  number: Material;
  panel: Material;
  trim: Material;
  deco: Material;
  decal: Material;
}

// ---------------------------------------------------------------- thèmes

/** Emplacements possibles du numéro de course. */
type NumberPlacement = 'nose' | 'hood' | 'roof' | 'flanks';
/** Couleur des disques de jante (îlots archL / archR de la carrosserie). */
type RimStyle = 'none' | 'dark' | 'accent' | 'light' | 'base' | 'bronze' | 'chrome';

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

const competitionMaterials: MaterialScheme = { body: 'gloss', stripe: 'vinyl', accent: 'vinyl', number: 'vinyl', panel: 'carbon', trim: 'metallic', deco: 'satin', decal: 'vinyl' };
const streetMaterials: MaterialScheme = { ...competitionMaterials, body: 'metallic', stripe: 'vinyl', accent: 'vinyl' };
function themeSpec(pattern: ThemeSpec['pattern'], overrides: Partial<ThemeSpec> = {}): ThemeSpec {
  return { pattern, finish: 'gloss', coat: 'full', palette: { harmony: 'complementary', sat: [50, 80], light: [30, 55] },
    materials: competitionMaterials, details: 'dark', detailMaterial: 'carbon', wheels: 'dark', wheelMaterial: 'matte',
    neon: 'accent', raceNumber: true, numbers: ['nose', 'flanks'], plate: 'plate', rims: 'dark', ...overrides };
}
const THEMES: Record<CuratedTheme, ThemeSpec> = {
  endurance: themeSpec('stripes'),
  heritage: themeSpec('swoosh', { rims: 'accent', detailMaterial: 'satin' }),
  touring: themeSpec('geo', { rims: 'dark', plate: 'none' }),
  rallyRaid: themeSpec('geo', { rims: 'light' }),
  trackday: themeSpec('split', { rims: 'dark', plate: 'none', numbers: ['roof', 'flanks'] }),
  streetArt: themeSpec('swoosh', { materials: streetMaterials, finish: 'metallic', numbers: [], rims: 'chrome' }),
  drift: themeSpec('swoosh', { materials: streetMaterials, finish: 'metallic', numbers: [], rims: 'chrome' }),
  nightRun: themeSpec('split', { materials: streetMaterials, finish: 'metallic', numbers: [], rims: 'bronze' }),
  fantasy: themeSpec('geo', { materials: streetMaterials, finish: 'metallic', numbers: [], rims: 'chrome' }),
};
const CURATED_THEMES = THEME_CATALOG.map((entry) => entry.id);
function resolveTheme(rng: Rng, theme: Theme): { id: CuratedTheme; spec: ThemeSpec } {
  const id = theme === 'random' ? pick(rng, CURATED_THEMES) : theme;
  if (!Object.hasOwn(THEMES, id)) throw new Error('Choisissez une livrée du catalogue.');
  return { id, spec: THEMES[id] };
}
function themePalette(rng: Rng, opts: GeneratorOptions, id: CuratedTheme, spec: ThemeSpec, paletteIndex: number): Palette {
  const colors = LIVERY_PALETTES[id][paletteIndex].colors;
  if (opts.harmony !== 'auto') return buildPalette(rng, opts, spec.palette);
  const base = opts.randomBaseHue ? colors[0] : opts.baseColor;
  const accent1 = opts.randomAccent ? colors[1] : opts.accentColor;
  return { base, accent1, accent2: colors[2], dark: '#151a20', light: '#f5f2e9', tones: [base, accent1, colors[2], '#151a20'] };
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

/** Rear-facing outer lip, measured on the FBX and visible from either rear quarter.
 * The guide's d_tail octagon maps to inner side walls, not a rear lamp.
 * These two separate UV windows avoid the speed display and all wheel surfaces.
 */
export const BRAKE_LIGHT_ZONES: readonly UVRect[] = [
  { x: .360, y: .666, w: .012, h: .036 },
  { x: .360, y: .788, w: .012, h: .036 },
];


const name = (obj: FabricObject, n: string) => {
  (obj as FabricObject & { name?: string }).name = n;
  return obj;
};

function islandPolys(key: string): UVPoint[][] {
  return (key === 'tyres' ? WHEEL_UV_GUIDE : UV_GUIDE_ISLANDS).find((i) => i.key === key)?.polygons ?? [];
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
  material?: Material;
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
 * One editable motif, clipped to the union of all intersecting UV contours.
 * Repeating the entire artwork for every tiny contour bloats projects and
 * paints overlapping transparent motifs several times. Stock outlines have
 * consistent winding, so a nonzero compound clip retains every surface.
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
  const polygons = islandPolys(key).filter((poly) => rectsIntersect(polyBBox(poly), bounds));
  if (!polygons.length) return [];
  if (polygons.length === 1) return [shape(role, color, label, build, polygons[0], S)];
  const path = uvPath(polygons, S);
  return [shape(role, color, label, (fill, mono) => {
    const object = build(fill, mono);
    object.clipPath = new Path(path, { absolutePositioned: true, objectCaching: false, fillRule: 'nonzero' });
    return object;
  })];
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
  fontFamily?: string;
  fontStyle?: 'normal' | 'italic';
  fontWeight?: number;
  charSpacing?: number;
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
    fontFamily: spec.fontFamily ?? 'Arial Black, sans-serif',
    fontWeight: spec.fontWeight ?? 900,
    fontStyle: spec.fontStyle ?? 'normal',
    charSpacing: spec.charSpacing ?? 0,
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
    (fill, mono) => fittedText(text, spec, fill, mono && stroke ? fill : stroke, S),
    S,
  );
}

/** Cœur vectoriel (pas le pictogramme officiel) : pointe vers +y canvas. */
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
  numberOutline?: string,
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
      (fill, mono) => fittedText(num, spec, fill, mono ? fill : numberOutline ?? (color === p.dark ? p.light : p.dark), S),
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

  if (placements.includes('roof')) {
    out.push(...text({ cx: .5, cy: .183, maxW: .168, maxH: .090, angle: 180, flipX: false, fontStyle: 'italic', strokeScale: .05 }, p.light, 'top', `${nameNum} · capot moteur`));
  }

  if (placements.includes('flanks')) {
    const bg = flankBg ?? p.base;
    const [, , bgL] = hexToHsl(bg);
    let color = numberColor ?? (bgL > 55 ? p.dark : p.light);
    const specL: TextSpec = {
      cx: .7715,
      cy: .333,
      maxW: .031,
      maxH: .061,
      angle: getRegionOrientation('left').angle,
      flipX: getRegionOrientation('left').flipX,
    };
    const specR: TextSpec = {
      ...specL,
      cx: 1 - specL.cx,
      angle: getRegionOrientation('right').angle,
      flipX: getRegionOrientation('right').flipX,
    };
    if (plate === 'plate') {
      // Plaque rectangulaire (rotation ±90° : largeur = hauteur du pontet).
      const pw = .037;
      const ph = .076;
      const plateL: UVRect = { x: specL.cx - pw / 2, y: specL.cy - ph / 2, w: pw, h: ph };
      out.push(...rectOn('shoulderL', plateL, 'decal', p.light, 'Plaque flanc G.', S, { rx: .002 * S, ry: .002 * S }));
      out.push(...rectOn('shoulderR', mirrorRect(plateL), 'decal', p.light, 'Plaque flanc D.', S, { rx: .002 * S, ry: .002 * S }));
      color = p.dark;
    }
    out.push(...text(specL, color, 'shoulderL', `${nameNum} · flanc G.`));
    out.push(...text(specR, color, 'shoulderR', `${nameNum} · flanc D.`));
  }
  return out;
}

/** Disques de jante (îlots archL / archR) : disque + anneau central. */
function makeRims(S: number, p: Palette, style: RimStyle, ring: string): DesignShape[] {
  if (style === 'none') return [];
  const [bh, bs] = hexToHsl(p.base);
  const disc =
    style === 'dark' ? '#1c1e22' : style === 'chrome' ? '#c7d1d8' : style === 'bronze' ? '#a88b52' : style === 'accent' ? p.accent1 : style === 'light' ? p.light : hsl(bh, bs, 30);
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
  return out.map((part) => ({ ...part, material: style === 'chrome' ? 'chrome' : part.role === 'trim' || style === 'bronze' || style === 'accent' ? 'metallic' : style === 'dark' ? 'satin' : 'gloss' }));
}

/** A compound UV shape keeps each named detail editable without hundreds of tiny layers. */
function uvPath(polys: UVPoint[][], S: number) {
  return polys.filter((poly) => poly.length >= 3).map((poly) => `M ${poly.map((p) => `${p.x * S} ${p.y * S}`).join(' L ')} Z`).join(' ');
}
function regionDesign(key: string, role: ShapeRole, color: string, label: string, S: number): DesignShape[] {
  const path = uvPath(islandPolys(key), S);
  return path ? [shape(role, color, label, (fill) => new Path(path, { fill, objectCaching: false }))] : [];
}
/** Actual competition typography: a lead partner, equipment suppliers and small service labels. */
const IDENTITIES: Record<CuratedTheme, { title: string; line: string; suppliers: string[] }> = {
  endurance: { title: 'AURUM', line: 'ENDURANCE / 24', suppliers: ['HELIX', 'FERRO', 'RACE SYSTEMS'] },
  heritage: { title: 'SUMMIT', line: 'WORLD RALLY TEAM', suppliers: ['TERRA', 'FORGE', 'RALLY SPORT'] },
  touring: { title: 'VECTOR', line: 'GRAND PRIX ENGINEERING', suppliers: ['NEXUS', 'ION', 'APEX FUELS'] },
  rallyRaid: { title: 'NORTHLINE', line: 'FACTORY RALLY TEAM', suppliers: ['TORQ', 'GRIP', 'RALLY SYSTEMS'] },
  trackday: { title: 'OCTANE', line: 'PERFORMANCE FUELS', suppliers: ['VOLT', 'RACE OIL', 'PRO BRAKE'] },
  streetArt: { title: 'KAZE', line: 'CUSTOM CULTURE / 2002', suppliers: ['BOOST', 'FORGED', 'RACE OIL'] },
  drift: { title: 'VOLT', line: 'AFTER HOURS / CUSTOM', suppliers: ['BOOST LAB', 'FORGED', 'GRIP UNION'] },
  nightRun: { title: 'SHUTO', line: 'TURBO ENGINEERING', suppliers: ['TURBO', 'FORGED', 'SPORT'] },
  fantasy: { title: '', line: '', suppliers: [] },
};

/** A restrained twill on exposed composite; one editable vector layer per panel. */
function carbonPanel(key: string, r: UVRect, label: string, S: number): DesignShape[] {
  const out = rectOn(key, r, 'panel', '#1c2228', label, S);
  const segments: string[] = [];
  const step = .006;
  for (let y = r.y; y < r.y + r.h - step; y += step) {
    for (let x = r.x; x < r.x + r.w - step; x += step * 2) {
      const shift = Math.round(y / step) % 2 ? step : 0;
      if (x + shift + step > r.x + r.w) continue;
      segments.push(`M ${(x+shift)*S} ${y*S} l ${step*.65*S} 0 l ${step*.3*S} ${step*.65*S} l ${-step*.65*S} 0 Z`);
    }
  }
  out.push(...onIsland(key, r, 'panel', '#323a42', `${label} · tissage`, (fill, mono) => mono
    ? new Rect({left:r.x*S,top:r.y*S,width:r.w*S,height:r.h*S,originX:'left',originY:'top',fill})
    : new Path(segments.join(' '), { fill, opacity: .52, objectCaching: false }), S));
  return out;
}

function identity(S: number, p: Palette, id: CuratedTheme, complexity: number): DesignShape[] {
  const out: DesignShape[] = [];
  if(id==='fantasy') return out;
  const identity = IDENTITIES[id];
  const contrast = (color: string) => {
    const [r,g,b]=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
    return .2126*r+.7152*g+.0722*b>.56?p.dark:p.light;
  };
  if (['streetArt','drift','nightRun'].includes(id)) {
    // Small period-style equipment decals let the large illustrated vinyl
    // remain the main subject. No racing plate over a dragon or a flame.
    out.push(...rectOn('top',{x:.451,y:.655,w:.098,h:.064},'decal',p.dark,'Cartouche préparateur tuning',S));
    out.push(...labelOn('top',{cx:.5,cy:.681,maxW:.087,maxH:.029,angle:0,flipX:false,fontStyle:'italic'},'decal',p.light,'Sponsor principal · capot',identity.title,S));
    out.push(...labelOn('top',{cx:.5,cy:.707,maxW:.086,maxH:.009,angle:0,flipX:false,fontWeight:700},'decal',p.light,'Signature préparateur · capot',identity.line,S));
    for(const left of [true,false]) for(let i=0;i<Math.min(3,1+Math.floor(complexity/25));i++) {
      const cx=left?.602+i*.014:.398-i*.014;
      const angle=left?275:85;
      out.push(...labelOn('top',{cx,cy:.373,maxW:.011,maxH:.072,angle,flipX:false,fontStyle:i%2?'normal':'italic',fontWeight:900},'decal',p.light,'Équipementier tuning '+i+' · '+(left?'gauche':'droite'),identity.suppliers[i],S,p.dark));
    }
    if(complexity>=45) out.push(...labelOn('top',{cx:.5,cy:.118,maxW:.13,maxH:.025,angle:180,flipX:false,fontStyle:'italic'},'decal',p.light,'Préparation routière · emblème',identity.title,S,p.dark));
    if(complexity>=70) for(let i=0;i<2;i++) {
      const y=.033+i*.031;
      out.push(...rectOn('top',{x:.451,y,w:.098,h:.023},'decal',p.dark,'Cartouche équipementier tuning',S));
      out.push(...labelOn('top',{cx:.5,cy:y+.0115,maxW:.088,maxH:.017,angle:180,flipX:false,fontStyle:'italic'},'decal',p.light,'Partenaire tuning · série',identity.suppliers[i],S));
    }
    return out;
  }
  const street = id === 'nightRun';
  const topColor = id === 'endurance' ? p.dark : contrast(id==='trackday'?p.accent1:p.base);
  const topY = street ? .723 : .688;
  // The Stadium nose rolls down sharply outside u=.445..555. Keeping the
  // complete wordmark on that crown makes it readable from either 3/4 view.
  const titleSpec = { cx: .5, cy: topY, maxW: .105, maxH: street ? .032 : .044,
    angle: 0, flipX: false, fontStyle: 'italic' as const, charSpacing: id === 'endurance' ? 70 : -25 };
  if (id === 'trackday') {
    out.push(...onIsland('top', { x: .434, y: .647, w: .132, h: .086 }, 'decal', p.light, 'Emblème sponsor · fond',
      (fill) => new Ellipse({ left: .5*S, top: .69*S, originX: 'center', originY: 'center', rx: .064*S, ry: .041*S, fill }), S));
    out.push(...onIsland('top', { x: .439, y: .653, w: .122, h: .074 }, 'decal', p.accent1, 'Emblème sponsor · centre',
      (fill) => new Ellipse({ left: .5*S, top: .69*S, originX: 'center', originY: 'center', rx: .059*S, ry: .035*S, fill }), S));
  }
  out.push(...labelOn('top', titleSpec, 'decal', topColor, 'Sponsor principal · capot', identity.title, S));
  out.push(...labelOn('top', { cx: .5, cy: topY + .027, maxW: .10, maxH: .011, angle: 0, flipX: false, charSpacing: 90, fontWeight: 700 }, 'decal', topColor, 'Signature préparateur · capot', identity.line, S));

  // Long upper sidepod faces: measured local frames, visible from both quarters.
  for (const left of [true, false]) {
    const color = p.light;
    const angle = left ? 275 : 85;
    const cx=left?.611:.389;
    // The backing follows the same local frame as the sponsor, retaining
    // contrast when a random bright stripe passes underneath it.
    out.push(...onIsland('top',{x:cx-.022,y:.292,w:.044,h:.151},'decal',p.dark,'Cartouche sponsor ponton',
      fill=>new Rect({left:cx*S,top:.3675*S,width:.036*S,height:.139*S,angle:left?5:-5,originX:'center',originY:'center',rx:.003*S,ry:.003*S,fill}),S));
    out.push(...labelOn('top', { cx: left ? .611 : .389, cy: .3675, maxW: street ? .018 : .029, maxH: street ? .09 : .122, angle, flipX: false, fontStyle: 'italic', charSpacing: -25 }, 'decal', color, 'Sponsor ponton supérieur · ' + (left ? 'gauche' : 'droite'), identity.title, S,p.dark));
    if (!street) out.push(...labelOn('top', { cx: left ? .634 : .366, cy: .3675, maxW: .008, maxH: .106, angle, flipX: false, fontWeight: 700, charSpacing: 80 }, 'decal', color, 'Préparateur ponton supérieur', identity.line, S,p.dark));
  }

  // The outer sidepod surface is shoulderL/R. Its vertical window uses a
  // quarter-turn; the general shoulder orientation averages horizontal faces.
  for (const key of street ? ['shoulderL', 'shoulderR'] : []) {
    const left = key === 'shoulderL';
    const cx = left ? .7715 : .2285;
    const angle = left ? 271 : 89;
    const color = id === 'heritage' ? p.accent1 : id === 'nightRun' ? p.accent2 : p.light;
    if (!street) out.push(...rectOn(key, { x: cx-.0195, y: .293, w: .039, h: .080 }, 'decal', p.dark, 'Cartouche flanc extérieur', S));
    out.push(...labelOn(key, { cx, cy: .333, maxW: .033, maxH: .072, angle, flipX: false, fontStyle: 'italic', charSpacing: -20 }, 'decal', color, 'Signature équipe · ' + (left ? 'gauche' : 'droite'), street ? identity.title : identity.suppliers[1], S));
  }
  // Secondary sponsor on the lower/rear body panel, away from the side number.
  for (const key of ['left', 'right']) {
    const left = key === 'left'; const cx = left ? .8 : .2;
    const orientation = getRegionOrientation(key);
    if (!street) {
      out.push(...rectOn(key, { x: cx - .026, y: .406, w: .052, h: .105 }, 'decal', p.dark, 'Bandeau équipementier', S));
      out.push(...labelOn(key, { cx, cy: .459, maxW: .032, maxH: .091, ...orientation, fontStyle: 'italic' }, 'decal', p.light, 'Équipementier · ' + key, identity.suppliers[0], S));
    }
    if (complexity >= 30) out.push(...labelOn(key, { cx: left ? .862 : .138, cy: .715, maxW: .013, maxH: .044, ...orientation, fontWeight: 700 }, 'decal', street ? p.accent2 : p.light, 'Marquage atelier', street ? '2.0 TURBO' : 'RACE USE', S));
  }
  if (!street && complexity >= 20) {
    // The engine-cover strip is reserved for smaller equipment decals.
    const count = Math.min(3, 1 + Math.floor(complexity / 34));
    for (let i = 0; i < count; i++) {
      const y = .04 + i*.031;
      out.push(...rectOn('top', { x: .451, y, w: .098, h: .023 }, 'decal', p.light, 'Cartouche partenaire', S));
      out.push(...labelOn('top', { cx: .5, cy: y+.0115, maxW: .088, maxH: .017, angle: 180, flipX: false, fontStyle: i % 2 ? 'normal' : 'italic' }, 'decal', p.dark, 'Partenaire technique', identity.suppliers[i], S));
    }
    if (complexity >= 45) {
      // Small safety and scrutineering decals: limited to the rear cowling.
      for (const x of [.405, .584]) {
        out.push(...rectOn('top', { x, y: .096, w: .014, h: .030 }, 'decal', '#e13932', 'Coupe-circuit · adhésif', S));
        out.push(...labelOn('top', { cx: x+.007, cy: .111, maxW: .010, maxH: .021, angle: 180, flipX: false }, 'decal', '#ffffff', 'Coupe-circuit · E', 'E', S));
      }
    }
    if (complexity >= 70) {
      out.push(...labelOn('top', { cx: .5, cy: .584, maxW: .17, maxH: .017, angle: 0, flipX: false, fontWeight: 700, charSpacing: 120 }, 'decal', topColor, 'Homologation · série', id === 'streetArt' ? 'UNLIMITED / JAPAN' : 'FACTORY COMPETITION', S));
    }
  }
  if (street && complexity >= 65) {
    out.push(...labelOn('top', { cx: .5, cy: .104, maxW: .11, maxH: .022, angle: 180, flipX: false, fontStyle: 'italic', charSpacing: 110 }, 'decal', p.accent1, 'Préparation routière · emblème', 'SHUTO', S));
    out.push(...labelOn('top', { cx: .5, cy: .075, maxW: .085, maxH: .014, angle: 180, flipX: false, fontWeight: 700 }, 'decal', p.accent1, 'Préparation routière · spécification', 'TWIN CAM 16V', S));
  }
  return out;
}

function surfaceDesign(polys: MotifPolygon[], plane: 'side'|'top', color: string, label: string, S: number): DesignShape[] {
  const uv=projectSurfacePolygons(polys,{plane,side:'both'});
  return uv.length ? [shape('trim',color,label,fill=>new Path(uvPath(uv,S),{fill,strokeWidth:0,objectCaching:false}))] : [];
}

function fantasyVeins(S: number,p: Palette,variant: number): DesignShape[] {
  const top: MotifPolygon[]=[];
  for(let i=0;i<3;i++) {
    const t=.24+i*.24;
    if(variant===1) {
      const curve=Array.from({length:25},(_,j)=>({x:-.85+j*.071,y:t+Math.sin(j/24*Math.PI*2)*.055}));
      top.push(ribbon(curve,.009));
    } else top.push(ribbon([{x:-.9,y:t},{x:-.4,y:t+.055},{x:0,y:t-.03},{x:.38,y:t+.045},{x:.9,y:t-.02}],variant===2?.014:.007));
  }
  const side=ribbon([{x:.23,y:.34},{x:.44,y:.47},{x:.55,y:.36},{x:.72,y:.69},{x:.92,y:.58}],.018);
  return [...surfaceDesign(top,'top',p.accent1,'Veines de lumière · couronne',S),...surfaceDesign([side],'side',p.accent1,'Veines de lumière · flancs',S)];
}

function decorativeLights(S:number,p:Palette,id:CuratedTheme,variant:number, colorOverride?:string): {shapes:DesignShape[];role:IllumRole}[] {
  const tuning=['streetArt','drift','nightRun'].includes(id);
  if(!tuning && id!=='fantasy') return [];
  const [h]=hexToHsl(tuning?p.base:p.accent1);
  const neon=colorOverride??hsl(h,95,65);
  const nightStrip=ribbon([{x:.31,y:.20},{x:.48,y:.24},{x:.74,y:.24},{x:.94,y:.32}],.022);
  const marker=ribbon([{x:.64,y:.27},{x:.81,y:.27},{x:.9,y:.32}],.009);
  const brakes:MotifPolygon[]=[];
  for(const sign of [-1,1]) for(let i=0;i<3;i++) {
    const x=sign*(.38+i*.12);
    brakes.push([{x:x-.025,y:.87},{x:x+.025,y:.87},{x:x+.025,y:.925},{x:x-.025,y:.925}]);
  }
  return [
    {shapes:id==='fantasy'?fantasyVeins(S,colorOverride?{...p,accent1:colorOverride}:p,variant):surfaceDesign([marker],'side',neon,'Veilleuse décorative tuning',S),role:'always'},
    {shapes:surfaceDesign([nightStrip],'side',neon,id==='fantasy'?'Halo nocturne minéral':'Néon de bas de caisse',S),role:'head'},
    {shapes:surfaceDesign(brakes,'top','#ff3856',id==='fantasy'?'Cristaux réactifs au freinage':'Signature arrière au freinage',S),role:'brake'},
  ];
}

function curatedBody(_rng: Rng, S: number, p: Palette, id: CuratedTheme, complexity: number, variant: number): DesignShape[] {
  const out: DesignShape[] = [];
  const tuning = ['streetArt', 'drift', 'nightRun'].includes(id);
  // All large artwork is drawn ON THE CAR, then unwrapped through the real
  // FBX triangles. A motif crossing a UV seam keeps its physical position.
  const project = (polys: MotifPolygon[], plane: 'top' | 'side', color: string, label: string, role: ShapeRole = 'stripe', material?: Material) => {
    const uv = projectSurfacePolygons(polys, { plane, side: 'both' });
    if (!uv.length) return;
    const d = shape(role, color, label, (fill) => new Path(uvPath(uv, S), { fill, strokeWidth: 0, objectCaching: false }));
    if (material) d.material = material;
    out.push(d);
  };
  const rect = (x: number, y: number, w: number, h: number): MotifPolygon => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  const top = (polys: MotifPolygon[], color: string, label: string, role: ShapeRole = 'stripe', material?: Material) => project(polys,'top',color,label,role,material);
  const side = (polys: MotifPolygon[], color: string, label: string, role: ShapeRole = 'stripe', material?: Material) => project(polys,'side',color,label,role,material);
  const line = (ys: number[], width: number) => ribbon(ys.map((y,i)=>({x:.12+i*.80/(ys.length-1),y})), width);
  const keylined = (polys: MotifPolygon[], color: string, label: string, chrome = false) => {
    // Parallel artwork in the same world frame; no independent UV offsets.
    side(transformMotif(polys, q=>({x:q.x,y:q.y-.018})), p.dark, label+' · ombre');
    side(transformMotif(polys, q=>({x:q.x,y:q.y+.009})), p.light, label+' · filet');
    side(polys,color,label,'stripe',chrome?'chrome':undefined);
  };
  for (const key of ['sillL','sillR','rearLow']) out.push(...regionDesign(key,'panel','#20252a','Protection carbone',S));

  if (id === 'endurance') {
    const center = variant === 2 ? -.24 : 0;
    const bands = variant === 1 ? [rect(-.25,0,.17,1),rect(.08,0,.17,1)] : [rect(center-.15,0,.30,1)];
    const borders = variant === 1 ? [rect(-.28,0,.025,1),rect(.255,0,.025,1)] : [rect(center-.19,0,.025,1),rect(center+.165,0,.025,1)];
    top(borders,p.accent2,'Filets endurance · raccord 3D');
    top(bands,p.accent1,'Bandes endurance · raccord 3D');
    side([line(variant===2?[.24,.28,.47,.47]:[.24,.30,.34,.34],.115)],p.accent1,'Ceinture de prototype');
    side([line(variant===2?[.33,.37,.56,.56]:[.33,.39,.43,.43],.018)],p.accent2,'Filet de classe');
    out.push(...rectOn('top',{x:.446,y:.650,w:.108,h:.079},'decal',p.light,'Cartouche endurance',S));
    out.push(...rectOn('top',{x:.460,y:.152,w:.080,h:.034},'decal',p.light,'Classe endurance · fond',S));
    out.push(...labelOn('top',{cx:.5,cy:.169,maxW:.065,maxH:.021,angle:180,flipX:false},'decal',p.dark,'Classe endurance','HYPER',S));
  } else if (id === 'heritage') {
    if (variant === 2) {
      for (let i=0;i<3;i++) {
        side([[{x:.38+i*.12,y:.12},{x:.46+i*.12,y:.12},{x:.68+i*.10,y:.94},{x:.59+i*.10,y:.94}]],i===1?p.accent2:p.accent1,'Bloc Groupe B '+i);
        top([rect(-1,.60+i*.095,2,.065)],i===1?p.accent2:p.accent1,'Bande transversale Groupe B '+i);
      }
    } else {
      for(let i=0;i<3;i++) {
        const ys = variant===0 ? [.30+i*.10,.40+i*.10,.65+i*.06,.75+i*.04] : [.69-i*.10,.59-i*.10,.31+i*.04,.44+i*.10];
        side([line(ys,.042)],i===1&&variant===1?p.accent2:p.accent1,'Ruban rallye '+i);
      }
      top([rect(-.61,.18,.075,.66),rect(.535,.18,.075,.66)],p.accent1,'Filets rallye continus');
    }
  } else if (id === 'touring') {
    side([rect(.20,.0,.80,.68)],'#1b2229','Flancs de monoplace carbone','panel');
    const ys = variant===0 ? [.30,.42,.66,.73] : variant===1 ? [.53,.53,.62,.62] : [.25,.37,.78,.58];
    side([line(ys,.15)],p.base,'Panneau de monoplace','body');
    side([line(ys.map(y=>y+.105),.027)],p.accent1,'Filet Grand Prix');
    const edge = variant===1 ? .50 : .63;
    top([rect(-1,0,1-edge,1),rect(edge,0,1-edge,1)],'#20272d','Bords de coque carbone','panel');
    if(variant===2) top([[{x:0,y:.10},{x:-.22,y:.44},{x:0,y:.30},{x:.22,y:.44}]],p.accent1,'Flèche Grand Prix');
    else top([rect(-.045,0,.09,1)],p.accent1,'Filet axial Grand Prix');
    out.push(...regionDesign('spoiler','panel','#20262c','Aileron carbone',S));
  } else if (id === 'rallyRaid') {
    if(variant===0) {
      side([[{x:.28,y:0},{x:.47,y:0},{x:.83,y:1},{x:.66,y:1}]],p.accent1,'Diagonale usine continue');
      side([[{x:.50,y:0},{x:.55,y:0},{x:.92,y:1},{x:.87,y:1}]],p.accent2,'Filet usine continu');
      top([[{x:-1,y:.55},{x:-.28,y:.80},{x:.28,y:.80},{x:1,y:.55},{x:1,y:.70},{x:.28,y:.91},{x:-.28,y:.91},{x:-1,y:.70}]],p.accent1,'Chevron arrière usine');
    } else if(variant===1) {
      for(let i=0;i<3;i++) side([line([.20+i*.12,.26+i*.12,.71+i*.06,.60+i*.08],.065)],i===1?p.accent2:p.accent1,'Ruban de spéciale '+i);
      top([rect(-.34,.02,.12,.38),rect(.22,.02,.12,.38)],p.accent1,'Bandes rallye avant');
    } else {
      side([rect(.25,.14,.75,.31)],p.accent2,'Protection équipe usine','body');
      side([[{x:.37,y:.45},{x:.57,y:.45},{x:.85,y:.91},{x:.64,y:.91}]],p.accent1,'Panneau rallye');
      top([rect(-1,.58,2,.19)],p.accent1,'Bande arrière équipe usine');
    }
  } else if (id === 'trackday') {
    top([rect(-1,0,2,.40)],p.accent1,'Capot publicitaire stock-car','body');
    if(variant===1) keylined(flameMotif(0),p.accent1,'Flammes de speedway');
    else if(variant===0) keylined([[{x:.19,y:.32},{x:.48,y:.61},{x:.59,y:.49},{x:.91,y:.86},{x:.67,y:.48},{x:.57,y:.33},{x:.43,y:.46}]],p.accent1,'Éclair stock-car');
    else side([rect(.30,.20,.68,.47)],p.accent1,'Panneau sponsor latéral','body');
    top([rect(-.59,.40,.04,.60),rect(.55,.40,.04,.60)],p.accent1,'Filets stock-car');
  } else if (id==='fantasy') {
    if(variant===0) {
      const facets: MotifPolygon[][] = [[],[],[],[]];
      for(let row=0;row<6;row++) for(let col=0;col<6;col++) {
        const x=-1+col/3, y=row/6, dx=1/3, dy=1/6;
        facets[(row+col)%4].push([{x,y},{x:x+dx,y},{x:x+dx,y:y+dy}]);
        facets[(row+col+2)%4].push([{x,y},{x:x+dx,y:y+dy},{x,y:y+dy}]);
      }
      const colors=[p.base,shade(p.base,12),shade(p.accent2,-18),shade(p.base,-8)];
      facets.forEach((polys,i)=>top(polys,colors[i],'Facettes astrales '+i,'body',i%2?'metallic':'satin'));
      for(let i=0;i<5;i++) side([[{x:.26+i*.13,y:.16},{x:.44+i*.10,y:.50},{x:.30+i*.12,y:.86}]],colors[i%4],'Cristal latéral '+i,'body','metallic');
    } else if(variant===1) {
      for(let band=0;band<4;band++) {
        const pts: MotifPolygon=[];
        for(let i=0;i<=40;i++){const a=i/40*Math.PI*2;pts.push({x:Math.cos(a)*(.26+band*.13),y:.55+Math.sin(a)*(.12+band*.045)});}
        const inner=pts.map(q=>({x:q.x*.92,y:.55+(q.y-.55)*.92})).reverse();
        top([[...pts,...inner]],band%2?p.accent2:p.accent1,'Orbite de nébuleuse '+band,'body',band%2?'metallic':'satin');
      }
      side([line([.26,.43,.72,.53],.22)],p.accent2,'Nébuleuse latérale','body','metallic');
    } else {
      top([rect(-.62,.08,.20,.80),rect(.42,.08,.20,.80)],shade(p.base,10),'Plaques arcanes','body','metallic');
      for(let row=0;row<4;row++) for(const sign of [-1,1]) {
        const t=.16+row*.19;
        top([[{x:.10*sign,y:t},{x:.25*sign,y:t+.06},{x:.40*sign,y:t+.06},{x:.53*sign,y:t+.14},{x:.49*sign,y:t+.14},{x:.37*sign,y:t+.075},{x:.23*sign,y:t+.075}]],p.accent2,'Circuit arcanique '+row+' '+sign,'trim','metallic');
      }
      side([line([.28,.28,.64,.64],.16)],shade(p.base,18),'Circuit latéral · plaque','body','metallic');
    }
    out.push(...fantasyVeins(S,p,variant));
    const stars=3+Math.floor(complexity/12);
    for(let i=0;i<stars;i++) {
      const x=Math.sin(i*2.7)*.52,y=.12+(i%7)*.115,r=.018+(i%3)*.006;
      top([[{x,y:y-r},{x:x+r,y},{x,y:y+r},{x:x-r,y}]],i%2?p.accent2:p.light,'Éclat astral '+i,'trim','chrome');
    }
  } else if (tuning) {
    const carbonHood = id!=='drift' || variant===1;
    if(carbonHood) out.push(...carbonPanel('top',{x:.365,y:.548,w:.27,h:.265},'Capot carbone tuning',S));
    out.push(...regionDesign('spoiler','panel','#1b2228','Aileron composite tuning',S));
    if(id==='streetArt') {
      const motifs=tribalMotif(variant);
      keylined(motifs,p.accent1,LIVERY_COMPOSITIONS[id][variant]);
      if(variant===1) {
        side([[{x:.242,y:.65},{x:.274,y:.663},{x:.260,y:.628}]],p.accent2,'Œil du dragon');
        side([[{x:.146,y:.526},{x:.195,y:.57},{x:.185,y:.534}]],p.light,'Croc du dragon');
      }
      // Smaller related blades on the crown; flanks carry the hero artwork.
      for(const sign of [-1,1]) top([[{x:.08*sign,y:.13},{x:.27*sign,y:.23},{x:.17*sign,y:.39},{x:.39*sign,y:.54},{x:.30*sign,y:.30},{x:.43*sign,y:.16},{x:.21*sign,y:.21}]],p.accent1,'Tribal capot '+sign);
    } else if(id==='drift') {
      const motifs=variant===0?tornMotif(0):variant===1?flameMotif(2):tribalMotif(2);
      // Chrome wraps deliberately differ from the matte sponsor stickers.
      keylined(motifs,p.accent1,LIVERY_COMPOSITIONS[id][variant],variant!==1);
      if(variant===2) top([rect(-1,.62,2,.38)],p.accent1,'Bicolore showcar','body','metallic');
      const crown = transformMotif(variant===0?tornMotif(2):flameMotif(1),q=>({x:(q.y-.53)*1.45,y:.02+q.x*.45}));
      top(crown,p.accent1,'Vinyle capot showcar','stripe',variant===0?'chrome':undefined);
    } else {
      if(variant===0) {
        top([rect(-.41,0,.22,1),rect(-.14,0,.055,1)],p.accent1,'Double bande de préparateur');
        side([line([.30,.39,.48,.50],.18)],p.accent2,'Bande basse street');
        side([line([.39,.48,.57,.59],.025)],p.accent1,'Filet street');
      } else if(variant===1) {
        keylined(tornMotif(1),p.accent1,'Griffures préparateur');
        top([rect(-.50,0,.09,1),rect(.41,0,.09,1)],p.accent1,'Bandes de capot');
      } else {
        keylined(tribalMotif(2),p.accent1,'Éclairs street');
        top([[{x:-.68,y:.11},{x:-.29,y:.26},{x:.07,y:.18},{x:.34,y:.47},{x:.14,y:.12},{x:-.25,y:.19}]],p.accent1,'Éclair de capot');
      }
    }
  }
  return out.concat(identity(S,p,id,complexity));
}

function bodyWear(rng: Rng, S: number, amount: number): DesignShape[] {
  if (!amount) return [];
  const out: DesignShape[] = [];
  for (const key of ['sillL', 'sillR', 'rearLow', 'front']) {
    const poly = largestPoly(key); if (!poly) continue;
    const bounds = polyBBox(poly); const segments: string[] = [];
    for (let i = 0; i < 3 + Math.round(amount / 8); i++) {
      const x = rand(rng, bounds.x, bounds.x + bounds.w); const y = rand(rng, bounds.y, bounds.y + bounds.h);
      segments.push(`M ${x*S} ${y*S} l ${rand(rng,.001,.004)*S} ${rand(rng,.002,.008)*S}`);
    }
    out.push(...onIsland(key, bounds, 'deco', '#878e8c', 'Patine · impacts', (fill) => new Path(segments.join(' '), { fill: '', stroke: fill, strokeWidth: 1.1, opacity: Math.min(.65, .12 + amount / 170), objectCaching: false }), S));
  }
  return out;
}
function makeDetails(S: number, p: Palette, accent: boolean): DesignShape[] {
  const out: DesignShape[] = [];
  for (const key of ['d_wing', 'd_floor', 'd_cockpit']) out.push(...regionDesign(key, 'panel', '#24292d', 'Composite · ' + key, S));
  // Weave is one vector layer per component; every tooth is bounded to its UV contour.
  const weave: string[] = [];
  for (let y = 0; y < S; y += 24) for (let x = 0; x < S; x += 48) {
    const shift = Math.round(y / 24) % 2 ? 24 : 0;
    weave.push(`M ${x+shift} ${y} l 18 0 l 6 10 l -18 0 Z`);
  }
  for (const key of ['d_wing', 'd_floor']) {
    const path = uvPath(islandPolys(key), S);
    out.push(shape('panel', '#343b40', 'Tissage carbone · ' + key, (fill, mono) => {
      // The weave changes the albedo, not the material value: storing all its
      // teeth again in R only bloats editable projects with identical pixels.
      if(mono) return new Path(path,{fill,objectCaching:false});
      const obj = new Path(weave.join(' '), { fill, opacity: .42, objectCaching: false });
      obj.clipPath = new Path(path, { absolutePositioned: true, objectCaching: false }); return obj;
    }));
  }
  for (const key of ['d_front', 'd_rear']) out.push(...regionDesign(key, 'trim', '#6c7275', 'Mécanique · ' + key, S));
  if (accent) out.push(...regionDesign('d_side_r', 'accent', shade(p.accent1, -12), 'Cache latéral contrasté', S));
  return out;
}
function makeTyres(rng: Rng, S: number, tire: Exclude<Tire, 'auto'>, wear: number, accent: string): DesignShape[] {
  const out: DesignShape[] = [];
  for (const x of [.102, .893]) out.push(...rectOn('tyres', { x, y: 0, w: .014, h: 1 }, 'accent', accent, 'Anneau de flanc', S));
  out.push(...rectOn('tyres', { x: .201, y: 0, w: .611, h: 1 }, 'body', '#2c3032', 'Gomme · bande de roulement', S));
  const groove: string[] = [];
  if (tire !== 'slick') {
    for (const x of tire === 'rally' ? [.40,.61] : tire === 'wet' ? [.28,.41,.60,.73] : [.29,.48,.68]) groove.push(`M ${x*S} 0 V ${S}`);
    const step = tire === 'rally' ? .040 : tire === 'wet' ? .024 : .055;
    for (let y = 0; y < 1; y += step) {
      if (tire === 'rally') { groove.push(`M ${.214*S} ${y*S} L ${.40*S} ${(y+.013)*S} L ${.51*S} ${(y+.013)*S} M ${.51*S} ${(y+.033)*S} L ${.61*S} ${(y+.033)*S} L ${.795*S} ${(y+.020)*S}`); }
      else groove.push(`M ${.214*S} ${y*S} l ${.11*S} ${.016*S} M ${.795*S} ${y*S} l ${-.12*S} ${.016*S}`);
    }
    out.push(...onIsland('tyres', { x: .201, y: 0, w: .611, h: 1 }, 'panel', '#121619', 'Sculpture · ' + tire, (fill) => new Path(groove.join(' '), { fill: '', stroke: fill, strokeWidth: tire === 'rally' ? 5 : 2.8, objectCaching: false }), S));
  }
  const grain: string[] = [];
  for (let i = 0; i < 150; i++) { const x = rand(rng,.205,.807)*S; const y = rand(rng,0,1)*S; grain.push(`M ${x} ${y} l ${rand(rng,1,2.5)} ${rand(rng,1,3.5)}`); }
  out.push(...onIsland('tyres', { x: .201, y: 0, w: .611, h: 1 }, 'deco', '#434746', 'Grain de gomme', (fill) => new Path(grain.join(' '), { fill: '', stroke: fill, strokeWidth: 1, opacity: .22 + wear/230, objectCaching: false }), S));
  for (let turn = 0; turn < 2; turn++) {
    out.push(...labelOn('tyres', { cx: .948, cy: (turn + .5)/2, maxW: .05, maxH: .20, angle: 90, flipX: false, fontStyle: 'italic' }, 'number', '#d3d1c7', 'Marquage pneu', 'APEX', S));
    out.push(...labelOn('tyres', { cx: .983, cy: (turn + .5)/2, maxW: .016, maxH: .18, angle: 90, flipX: false, fontWeight: 700 }, 'number', '#8b9291', 'Spécification pneu', { slick: 'SLICK / SOFT', semiSlick: 'SPORT / 200', wet: 'RAIN / W01', rally: 'GRAVEL / G04' }[tire], S));
  }
  if (wear > 0) {
    out.push(...rectOn('tyres', { x: .28, y: 0, w: .45, h: 1 }, 'deco', '#747470', 'Usure · gomme polie', S, { opacity: wear/500 }));
  }
  return out;
}
function mapLights(editor: EditorCore, id: MapId, opts: GeneratorOptions, designs: { shapes: DesignShape[]; role: IllumRole }[]) {
  editor.batch(id, { clear: opts.clearExisting }, (canvas) => {
    canvas.backgroundColor = '#000000';
    for (const { shapes, role } of designs) for (const design of shapes) {
      const obj = design.make(design.color, false) as FabricObject & { illumRole?: IllumRole }; obj.illumRole = role; canvas.add(obj);
    }
  });
}
export interface GenerationSummary {
  theme: Theme;
  pattern: Exclude<Pattern, 'auto'>;
  finish: Exclude<Finish, 'auto'>;
  palette: Palette;
  seed: number;
  tire: Exclude<Tire, 'auto'>;
  lights: Exclude<Lights, 'auto'>;
  layers: number;
  stockTyres: boolean;
  composition: string;
  paletteName: string;
  inspiration: string;
}
const coatGray = (coat: Exclude<Coat, 'auto'>): number => ({ none: 0, light: 120, full: 235 })[coat];

export function generateSkin(editor: EditorCore, opts: GeneratorOptions): GenerationSummary {
  const enums: [unknown, readonly string[]][] = [
    [opts.theme, ['random', ...CURATED_THEMES]], [opts.pattern, ['auto', ...Object.keys(PATTERN_LABELS)]],
    [opts.finish, ['auto', ...Object.keys(FINISH_LABELS)]], [opts.coat, ['auto','none','light','full']],
    [opts.harmony, ['auto','mono','complementary','analogous','triadic']],
    [opts.wheels, ['auto','dark','accent','base']], [opts.details, ['auto','dark','accent']],
    [opts.neon, ['auto','none','accent','base']], [opts.neonRole, ['always','head','brake']],
    [opts.tire, ['auto','slick','semiSlick','wet','rally']], [opts.lights, ['auto','brake','endurance','street','none']],
  ];
  if (enums.some(([value, allowed]) => typeof value !== 'string' || !allowed.includes(value)) ||
      [opts.raceNumber, opts.randomBaseHue, opts.randomAccent, opts.clearExisting].some((value) => typeof value !== 'boolean') ||
      typeof opts.seed !== 'string' || !/^\d{0,12}$/.test(opts.seed)) throw new Error('Réglages de génération invalides.');
  if (![opts.complexity, opts.dirt, opts.wear].every((value) => Number.isFinite(value) && value >= 0 && value <= 100) ||
      !/^#[0-9a-f]{6}$/i.test(opts.baseColor) || !/^#[0-9a-f]{6}$/i.test(opts.accentColor) || !/^\d{0,3}$/.test(opts.raceNumberValue)) throw new Error('Réglages de génération invalides.');
  const S = MAP_BY_ID.Skin_B.workRes;
  const parsedSeed = Number(opts.seed.trim());
  const seed = opts.seed.trim() && Number.isFinite(parsedSeed) ? Math.abs(Math.floor(parsedSeed)) >>> 0 : Math.floor(Math.random() * 1_000_000_000);
  const rng = mulberry32(seed);
  const { id, spec } = resolveTheme(rng, opts.theme);
  // Independent streams: editing a material, number or dirt amount must not
  // silently move the design. The seed describes the whole art direction.
  const directionRng = mulberry32(seed ^ 0x6a09e667);
  const variant = Math.floor(directionRng() * 3);
  const paletteIndex = Math.floor(directionRng() * LIVERY_PALETTES[id].length);
  const palette = themePalette(mulberry32(seed ^ 0xbb67ae85), opts, id, spec, paletteIndex);
  const tuning = ['streetArt', 'drift', 'nightRun'].includes(id);
  const pattern = opts.pattern === 'auto' ? spec.pattern : opts.pattern;
  const finish = opts.finish === 'auto' ? pick(directionRng, tuning || id==='fantasy' ? ['metallic', 'gloss'] as const : ['gloss', 'gloss', 'satin'] as const) : opts.finish;
  const coat = opts.coat === 'auto' ? spec.coat : opts.coat;
  const coatScale = coatGray(coat) / 235;
  const tire = opts.tire === 'auto' ? ['heritage','rallyRaid'].includes(id) ? 'rally' : tuning ? 'semiSlick' : 'slick' : opts.tire;
  const lights = opts.neon === 'none' ? 'none' : opts.lights === 'auto' ? tuning || id==='fantasy' ? 'street' : ['endurance','rallyRaid'].includes(id) ? 'endurance' : 'brake' : opts.lights;
  const scheme = { ...spec.materials, body: finishToMaterial[finish] };
  let design: DesignShape[];
  if (opts.pattern === 'auto') design = curatedBody(rng, S, palette, id, opts.complexity, variant);
  else {
    const builders = { stripes: makeStripes, chevrons: makeChevrons, swoosh: makeSwoosh, split: makeSplit, hex: makeHex, camo: makeCamo, geo: makeGeo, splatter: makeSplatter };
    design = pattern in builders ? builders[pattern as keyof typeof builders](rng, S, palette, opts.complexity) : [];
    design.push(...identity(S, palette, id, opts.complexity));
  }
  const rimStyle = opts.wheels === 'auto' ? pick(directionRng, tuning ? ['chrome','bronze','dark'] as const : id==='fantasy'?['chrome','accent','chrome'] as const : id === 'heritage' ? ['accent','light','bronze'] as const : [spec.rims,'dark','light'] as const) : opts.wheels;
  design.push(...makeRims(S, palette, rimStyle, palette.accent1));
  if (opts.raceNumber) design.push(...makeRaceNumbers(rng, S, palette, opts.raceNumberValue, spec.numbers, spec.plate, undefined, id === 'endurance' ? palette.dark : undefined, id === 'trackday' ? palette.dark : undefined));
  const wear = bodyWear(rng, S, opts.wear);
  const detailDesign = makeDetails(S, palette, (opts.details === 'auto' ? spec.details : opts.details) === 'accent');
  const tyreAccent = opts.wheels === 'base' ? palette.base : opts.wheels === 'dark' ? '#626768' : palette.accent1;
  const stockTyres = editor.getGuideIslands('wheels').some((island) => island.key === 'tyres');
  const tyreDesign = stockTyres ? makeTyres(rng, S, tire, opts.wear, tyreAccent) : [];
  let layers = 0;
  function draw(id: MapId, background: string, shapes: DesignShape[], channel: 'color' | 'material' | 'coat' = 'color') {
    editor.batch(id, { clear: opts.clearExisting }, (canvas) => {
      canvas.backgroundColor = background;
      if (id === 'Skin_B' && pattern === 'gradient' && opts.pattern !== 'auto') canvas.add(name(new Rect({ left: 0, top: 0, originX: 'left', originY: 'top', width: S, height: S, fill: new Gradient({ type: 'linear', coords: { x1: 0, y1: 0, x2: S, y2: S }, colorStops: [{ offset: 0, color: palette.base }, { offset: 1, color: palette.accent1 }] }) }), 'Laque dégradée'));
      for (const d of shapes) {
        const mat = id === 'Wheels_R' ? 'matte' : d.material ?? scheme[d.role];
        const varnish = Math.round(MATERIAL_VARNISH[mat] * coatScale);
        const value = channel === 'color' ? d.color : channel === 'material' ? id === 'Wheels_R' ? rgb(d.role === 'panel' ? 235 : d.role === 'number' ? 185 : 220, 0, 0) : materialColor(mat) : rgb(varnish, varnish, varnish);
        canvas.add(name(d.make(value, channel !== 'color'), d.label + (channel === 'material' ? ' · matière' : channel === 'coat' ? ' · vernis' : ''))); layers++;
      }
    });
  }
  draw('Skin_B', palette.base, [...design, ...wear]);
  draw('Skin_R', materialColor(scheme.body), [...design, ...wear], 'material');
  const v = coatGray(coat); draw('Skin_CoatR', rgb(v,v,v), [...design, ...wear], 'coat');
  draw('Details_B', '#343a40', detailDesign);
  draw('Details_R', materialColor(spec.detailMaterial), detailDesign, 'material');
  if (stockTyres) draw('Wheels_B', '#222629', tyreDesign);
  // Tyres are dielectric rubber; a colored marking does not turn them into metal.
  if (stockTyres) draw('Wheels_R', rgb(Math.round(225 - opts.wear*.45),0,0), tyreDesign, 'material');
  const dirt = opts.dirt/100;
  for (const map of ['Skin_DirtMask','Details_DirtMask','Wheels_DirtMask'] as const) {
    if (map === 'Wheels_DirtMask' && !stockTyres) continue;
    const base = Math.round(dirt * (map === 'Wheels_DirtMask' ? 255 : 120));
    const keys = map === 'Skin_DirtMask' ? ['sillL','sillR','rearLow','front'] : map === 'Details_DirtMask' ? ['d_floor','d_front'] : ['tyres'];
    const shapes = keys.flatMap((key) => regionDesign(key, 'deco', rgb(Math.round(dirt*255),Math.round(dirt*255),Math.round(dirt*255)), 'Saleté · zone exposée', S));
    draw(map, rgb(base,base,base), shapes);
  }
  const red = '#ff352c';
  const brake = lights === 'none' ? [] : BRAKE_LIGHT_ZONES.map((bounds, index) => shape(
    'accent', red, `Feu stop ${index === 0 ? 'gauche' : 'droit'}`,
    (fill) => new Rect({ left: bounds.x*S, top: bounds.y*S, originX: 'left', originY: 'top',
      width: bounds.w*S, height: bounds.h*S, rx: .002*S, ry: .004*S, strokeWidth: 0, fill }),
    [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y + bounds.h }, { x: bounds.x, y: bounds.y + bounds.h }], S,
  ));
  const head = lights === 'endurance' || lights === 'street' ? onIsland('d_head', { x: .957, y: .605, w: .022, h: .112 }, 'accent', '#dcebe9', 'Phare de nuit', (fill) => new Rect({ left: .957*S, top: .605*S, originX: 'left', originY: 'top', width: .022*S, height: .112*S, fill }), S) : [];
  mapLights(editor, 'Details_I', opts, [{ shapes: brake, role: 'brake' }, { shapes: head, role: 'head' }]);
  const decorative = lights==='street'?decorativeLights(S,palette,id,variant,opts.neon==='base'?palette.base:opts.neon==='accent'?palette.accent1:undefined):[];
  const luminous = lights === 'street' && !decorative.length ? ['sillL','sillR'].flatMap((key) => {
    const poly = largestPoly(key); if (!poly) return []; const b = polyBBox(poly);
    return rectOn(key, { x: b.x + b.w*.46, y: b.y + b.h*.08, w: Math.max(.002,b.w*.06), h: b.h*.82 }, 'trim', opts.neon === 'base' ? palette.base : palette.accent1, 'Signature de nuit', S);
  }) : [];
  mapLights(editor, 'Skin_I', opts, [{ shapes: luminous, role: 'head' },...decorative]);
  if (stockTyres) mapLights(editor, 'Wheels_I', opts, []);
  editor.setSpeedLightColor('#ffffff');
  editor.flushTexture(true);
  const selectedPalette = LIVERY_PALETTES[id][paletteIndex];
  return { theme: id, pattern, finish, palette, seed, tire, lights, layers: layers + brake.length + head.length + luminous.length+decorative.reduce((n,d)=>n+d.shapes.length,0), stockTyres,
    composition: opts.pattern === 'auto' ? LIVERY_COMPOSITIONS[id][variant] : PATTERN_LABELS[pattern],
    paletteName: opts.randomBaseHue && opts.randomAccent && opts.harmony === 'auto' ? selectedPalette.name : 'Palette personnalisée',
    inspiration: selectedPalette.inspiration };
}
