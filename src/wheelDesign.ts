import type { MaterialDefinition } from './materials/types';

export type WheelDesignPattern = 'ring' | 'double-ring' | 'segments' | 'checker' | 'lettering';

/** All lengths are relative to the complete wheel radius, independent of atlas resolution. */
export interface WheelDesignSettings {
  pattern: WheelDesignPattern;
  color: string;
  radius: number;
  width: number;
  count: number;
  angle: number;
  text: string;
  arc: number;
}

export const DEFAULT_WHEEL_DESIGN: Readonly<WheelDesignSettings> = Object.freeze({
  pattern: 'ring', color: '#f2efe6', radius: .86, width: .065,
  count: 36, angle: 0, text: 'SKION MOTORSPORT', arc: 140,
});

export const WHEEL_DESIGN_PRESETS: readonly Readonly<{ id: WheelDesignPattern; label: string; description: string }>[] = Object.freeze([
  { id: 'ring', label: 'Anneau continu', description: 'Un filet circulaire précis, du liseré discret au flanc blanc.' },
  { id: 'double-ring', label: 'Double filet', description: 'Deux anneaux concentriques pour une finition racing.' },
  { id: 'segments', label: 'Repères techniques', description: 'Des graduations régulières, avec un repère plus long tous les quatre traits.' },
  { id: 'checker', label: 'Damier circulaire', description: 'Deux rangées alternées, raccordées après un tour complet.' },
  { id: 'lettering', label: 'Marquage courbe', description: 'Une inscription personnalisée qui suit le flanc, caractère par caractère.' },
]);

const KEYS = ['pattern', 'color', 'radius', 'width', 'count', 'angle', 'text', 'arc'] as const;
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasControl = (value: string): boolean => Array.from(value).some(character => {
  const code = character.codePointAt(0)!;
  return code < 32 || code >= 127 && code <= 159 || code >= 0x2028 && code <= 0x202e || code >= 0x2066 && code <= 0x2069;
});
const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && Array.from(value).length <= 28 && !hasControl(value);
const validPattern = (value: unknown): value is WheelDesignPattern => WHEEL_DESIGN_PRESETS.some(preset => preset.id === value);

/** Project metadata cannot introduce a source URL, executable markup, or unbounded rendering work. */
export function isValidWheelDesign(value: unknown): value is WheelDesignSettings {
  return plain(value) && Object.keys(value).every(key => (KEYS as readonly string[]).includes(key))
    && validPattern(value.pattern) && typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
    && bounded(value.radius, .6, .98) && bounded(value.width, .005, .16)
    && value.radius + value.width / 2 <= 1 + 1e-12
    && bounded(value.count, 8, 96) && Number.isInteger(value.count)
    && bounded(value.angle, -180, 180) && validText(value.text) && bounded(value.arc, 60, 300);
}

/** UI drafts recover field by field; persisted projects use strict validation instead. */
export function normalizeWheelDesign(value: unknown): WheelDesignSettings {
  if (!plain(value)) return { ...DEFAULT_WHEEL_DESIGN };
  const clamp = (key: keyof WheelDesignSettings, min: number, max: number): number => {
    const number = value[key];
    return typeof number === 'number' && Number.isFinite(number)
      ? Math.max(min, Math.min(max, number)) : DEFAULT_WHEEL_DESIGN[key] as number;
  };
  const width = clamp('width', .005, .16);
  return {
    pattern: validPattern(value.pattern) ? value.pattern : DEFAULT_WHEEL_DESIGN.pattern,
    color: typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : DEFAULT_WHEEL_DESIGN.color,
    radius: Math.min(clamp('radius', .6, .98), 1 - width / 2), width,
    count: Math.round(clamp('count', 8, 96)), angle: clamp('angle', -180, 180),
    text: validText(value.text) ? value.text : DEFAULT_WHEEL_DESIGN.text,
    arc: clamp('arc', 60, 300),
  };
}

/** Transparent source shared by the workshop preview, editable layer, and export. */
export function drawWheelDesign(ctx: CanvasRenderingContext2D, value: WheelDesignSettings): void {
  if (!isValidWheelDesign(value)) throw new Error('Le motif de flanc contient des réglages invalides.');
  const { width, height } = ctx.canvas;
  if (!width || !height) return;
  if (width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) throw new Error('L’aperçu du flanc est trop volumineux.');
  const unit = Math.min(width, height) / 2, thickness = value.width * unit;
  const radius = value.radius * unit;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.translate(width / 2, height / 2); ctx.rotate(value.angle * Math.PI / 180);
    ctx.fillStyle = ctx.strokeStyle = value.color; ctx.lineCap = 'butt';
    const circle = (r: number, lineWidth: number) => {
      ctx.lineWidth = lineWidth; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    };
    if (value.pattern === 'ring') circle(radius, thickness);
    else if (value.pattern === 'double-ring') {
      circle(radius - thickness * .32, thickness * .24);
      circle(radius + thickness * .32, thickness * .24);
    } else if (value.pattern === 'segments') {
      const pitch = Math.PI * 2 / value.count;
      for (let i = 0; i < value.count; i++) {
        ctx.lineWidth = i % 4 === 0 ? thickness : thickness * .6;
        ctx.beginPath(); ctx.arc(0, 0, radius, i * pitch - Math.PI / 2, i * pitch + pitch * .55 - Math.PI / 2); ctx.stroke();
      }
    } else if (value.pattern === 'checker') {
      // One repetition is a pair of alternating cells. Honour every integer count exactly,
      // while both rows close without two identical neighbours at the revolution seam.
      const count = value.count * 2, pitch = Math.PI * 2 / count;
      const cell = (inner: number, outer: number, start: number, end: number) => {
        ctx.beginPath(); ctx.arc(0, 0, outer, start, end); ctx.arc(0, 0, inner, end, start, true); ctx.closePath(); ctx.fill();
      };
      for (let i = 0; i < count; i++) {
        const start = i * pitch - Math.PI / 2, end = start + pitch;
        if (i % 2 === 0) cell(radius, radius + thickness / 2, start, end);
        else cell(radius - thickness / 2, radius, start, end);
      }
    } else {
      const characters = Array.from(value.text);
      const arc = value.arc * Math.PI / 180;
      let fontSize = thickness;
      ctx.font = `900 ${fontSize}px Arial, sans-serif`;
      const widths = characters.map(character => Math.max(fontSize * .18, ctx.measureText(character).width));
      const contentWidth = widths.reduce((sum, measured) => sum + measured, 0);
      // Restrict the font before distributing letters so the narrowest arc never overlaps glyphs.
      const shrink = Math.min(1, radius * arc / Math.max(1, contentWidth * 1.15));
      fontSize *= shrink; ctx.font = `900 ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const gap = characters.length > 1 ? (arc - contentWidth * shrink / radius) / (characters.length - 1) : 0;
      let position = characters.length === 1 ? -widths[0] * shrink / radius / 2 : -arc / 2;
      for (let i = 0; i < characters.length; i++) {
        const span = widths[i] * shrink / radius;
        const angle = position + span / 2 - Math.PI / 2;
        ctx.save(); ctx.rotate(angle); ctx.translate(radius, 0); ctx.rotate(Math.PI / 2);
        ctx.fillText(characters[i], 0, 0); ctx.restore(); position += span + gap;
      }
    }
  } finally { ctx.restore(); }
}

/** A regular material owner keeps masking, PBR maps, project round trips, and Undo consistent. */
export function createWheelDesignDefinition(value: WheelDesignSettings): MaterialDefinition {
  if (!isValidWheelDesign(value)) throw new Error('Le motif de flanc contient des réglages invalides.');
  const settings = { ...value }, canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('La création du motif de flanc est indisponible.');
  drawWheelDesign(ctx, settings);
  const source = canvas.toDataURL('image/png'); canvas.width = canvas.height = 1;
  const preset = WHEEL_DESIGN_PRESETS.find(item => item.id === settings.pattern)!;
  return {
    version: 1, preset: 'solid', name: `Flanc · ${preset.label}`, wheelDesign: settings,
    color: '#ffffff', roughness: 180, metalness: 0, coat: 0, dirt: 0,
    emissionColor: '#ffffff', emissionStrength: 0, emissionRole: 'always',
    normalStrength: 1, aoStrength: 1, opacity: 1,
    transform: { mode: 'contain', projection: 'wheel-face', size: 256, angle: 0, offsetX: 0, offsetY: 0, flipX: false, flipY: false },
    textures: { color: { src: source, name: 'Motif de flanc.png', component: 'luminance', invert: false } },
  };
}
