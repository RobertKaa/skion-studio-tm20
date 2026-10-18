import type { IllumRole } from './maps';

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

export type CuratedTheme = Exclude<Theme, 'random'>;

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

