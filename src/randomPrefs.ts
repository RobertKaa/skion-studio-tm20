/**
 * Persistance de la dernière configuration du générateur de livrées
 * (localStorage, clé versionnée). Le parsing est défensif : toute valeur
 * absente ou invalide retombe sur la valeur par défaut, champ par champ.
 */
import { DEFAULT_OPTIONS, type GeneratorOptions } from './generator';
import { ILLUM_ROLES } from './maps';

const STORAGE_KEY = 'tmskin.randomPrefs.v1';

const THEMES = new Set<string>([
  'random',
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
  'full',
]);
const HARMONIES = new Set<string>(['auto', 'mono', 'complementary', 'analogous', 'triadic']);
const PATTERNS = new Set<string>([
  'auto',
  'stripes',
  'chevrons',
  'swoosh',
  'split',
  'hex',
  'camo',
  'geo',
  'splatter',
  'gradient',
  'solid',
]);
const FINISHES = new Set<string>(['auto', 'matte', 'gloss', 'metallic', 'chrome']);
const COATS = new Set<string>(['auto', 'none', 'light', 'full']);
const WHEELS = new Set<string>(['auto', 'dark', 'accent', 'base']);
const DETAILS = new Set<string>(['auto', 'dark', 'accent']);
const NEONS = new Set<string>(['auto', 'none', 'accent', 'base']);
const NEON_ROLES = new Set<string>(ILLUM_ROLES.map((r) => r.id));

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isDigits = (v: unknown): v is string => typeof v === 'string' && /^\d*$/.test(v);

function pickEnum<T extends string>(v: unknown, allowed: Set<string>, fallback: T): T {
  return typeof v === 'string' && allowed.has(v) ? (v as T) : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickPercent(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : fallback;
}

/** Normalise un objet quelconque en options valides (champ par champ). */
export function sanitizeRandomOptions(raw: unknown): GeneratorOptions {
  const d = DEFAULT_OPTIONS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    theme: pickEnum(r.theme, THEMES, d.theme),
    baseColor: isHex(r.baseColor) ? r.baseColor : d.baseColor,
    randomBaseHue: pickBool(r.randomBaseHue, d.randomBaseHue),
    accentColor: isHex(r.accentColor) ? r.accentColor : d.accentColor,
    randomAccent: pickBool(r.randomAccent, d.randomAccent),
    harmony: pickEnum(r.harmony, HARMONIES, d.harmony),
    pattern: pickEnum(r.pattern, PATTERNS, d.pattern),
    complexity: pickPercent(r.complexity, d.complexity),
    raceNumber: pickBool(r.raceNumber, d.raceNumber),
    raceNumberValue: isDigits(r.raceNumberValue) ? r.raceNumberValue.slice(0, 3) : d.raceNumberValue,
    finish: pickEnum(r.finish, FINISHES, d.finish),
    coat: pickEnum(r.coat, COATS, d.coat),
    dirt: pickPercent(r.dirt, d.dirt),
    wheels: pickEnum(r.wheels, WHEELS, d.wheels),
    details: pickEnum(r.details, DETAILS, d.details),
    neon: pickEnum(r.neon, NEONS, d.neon),
    neonRole: pickEnum(r.neonRole, NEON_ROLES, d.neonRole),
    seed: isDigits(r.seed) ? r.seed.slice(0, 12) : d.seed,
    clearExisting: pickBool(r.clearExisting, d.clearExisting),
  };
}

/** Dernière configuration enregistrée, ou les valeurs par défaut. */
export function loadRandomPrefs(): GeneratorOptions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    return sanitizeRandomOptions(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveRandomPrefs(opts: GeneratorOptions) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // Stockage indisponible (mode privé, quota) : la config vit le temps de la session.
  }
}
