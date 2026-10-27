import type { MaterialDefinition } from './materials/types';

export type WheelDesignPattern = 'ring' | 'double-ring' | 'segments' | 'checker' | 'lettering' | 'chevrons' | 'dots' | 'emblem' | 'image';
export type WheelDesignFont = 'sans' | 'condensed' | 'serif' | 'mono';
export type WheelDesignEmblem = 'star' | 'bolt' | 'diamond' | 'cross';

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
  font?: WheelDesignFont;
  italic?: boolean;
  outlineColor?: string;
  outline?: number;
  tracking?: number;
  reverse?: boolean;
  sweep?: number;
  gap?: number;
  rows?: number;
  emblem?: WheelDesignEmblem;
  repetitions?: number;
  rotation?: number;
  /** Sanitized, embedded PNG only; never a URL or serialized executable vector. */
  imageData?: string;
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
  { id: 'chevrons', label: 'Chevrons', description: 'Une couronne de chevrons directionnels, au pas et à l’ouverture réglables.' },
  { id: 'dots', label: 'Points de repère', description: 'Des points réguliers, du repère discret à la signature graphique.' },
  { id: 'emblem', label: 'Emblèmes', description: 'Étoile, éclair, losange ou croix, seuls ou répétés autour du flanc.' },
  { id: 'image', label: 'Logo personnel', description: 'Votre image locale, avec son pigment, ses proportions et sa transparence.' },
]);

const KEYS = ['pattern', 'color', 'radius', 'width', 'count', 'angle', 'text', 'arc', 'font', 'italic', 'outlineColor', 'outline', 'tracking', 'reverse', 'sweep', 'gap', 'rows', 'emblem', 'repetitions', 'rotation', 'imageData'] as const;
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasControl = (value: string): boolean => Array.from(value).some(character => {
  const code = character.codePointAt(0)!;
  return code < 32 || code >= 127 && code <= 159 || code >= 0x2028 && code <= 0x202e || code >= 0x2066 && code <= 0x2069;
});
const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && Array.from(value).length <= 64 && !hasControl(value);
const validPattern = (value: unknown): value is WheelDesignPattern => WHEEL_DESIGN_PRESETS.some(preset => preset.id === value);
const color = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

const safeLogoCache = new Set<string>();

/** Inspect dimensions and static PNG chunks before a browser decoder allocates pixels. */
export function isSafeWheelLogo(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 400_000) return false;
  if (safeLogoCache.has(value)) return true;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const encoded = value.slice(22);
  if (encoded.length % 4 || encoded.length < 44) return false;
  try {
    const decoded = atob(encoded);
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
      || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false;
    const view = new DataView(bytes.buffer);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (view.getUint32(8) !== 13 || width < 1 || width > 512 || height < 1 || height > 512) return false;
    let offset = 8, imageData = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), end = offset + length + 12;
      if (end > bytes.length) return false;
      const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (['acTL', 'fcTL', 'fdAT'].includes(kind) || kind === 'IHDR' && offset !== 8) return false;
      if (kind === 'IDAT') imageData = true;
      if (kind === 'IEND') {
        if (!imageData || length !== 0 || end !== bytes.length) return false;
        safeLogoCache.add(value);
        while (safeLogoCache.size > 24) safeLogoCache.delete(safeLogoCache.values().next().value!);
        return true;
      }
      offset = end;
    }
    return false;
  } catch { return false; }
}

/** Project metadata cannot introduce a source URL, executable markup, or unbounded rendering work. */
export function isValidWheelDesign(value: unknown): value is WheelDesignSettings {
  return plain(value) && Object.keys(value).every(key => (KEYS as readonly string[]).includes(key))
    && validPattern(value.pattern) && color(value.color)
    && bounded(value.radius, .6, .98) && bounded(value.width, .005, .16)
    && value.radius + value.width / 2 <= 1 + 1e-12
    && bounded(value.count, 8, 96) && Number.isInteger(value.count)
    && bounded(value.angle, -180, 180) && validText(value.text) && bounded(value.arc, 60, 300)
    && (value.font === undefined || typeof value.font === 'string' && ['sans', 'condensed', 'serif', 'mono'].includes(value.font))
    && (value.italic === undefined || typeof value.italic === 'boolean')
    && (value.outlineColor === undefined || color(value.outlineColor))
    && (value.outline === undefined || bounded(value.outline, 0, .025))
    && (value.tracking === undefined || bounded(value.tracking, 0, 2))
    && (value.reverse === undefined || typeof value.reverse === 'boolean')
    && (value.sweep === undefined || bounded(value.sweep, 5, 360))
    && (value.gap === undefined || bounded(value.gap, .05, 1))
    && (value.rows === undefined || bounded(value.rows, 1, 5) && Number.isInteger(value.rows))
    && (value.emblem === undefined || typeof value.emblem === 'string' && ['star', 'bolt', 'diamond', 'cross'].includes(value.emblem))
    && (value.repetitions === undefined || bounded(value.repetitions, 1, 24) && Number.isInteger(value.repetitions))
    && (value.rotation === undefined || bounded(value.rotation, -180, 180))
    && (value.imageData === undefined || isSafeWheelLogo(value.imageData));
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
  const result: WheelDesignSettings = {
    pattern: validPattern(value.pattern) ? value.pattern : DEFAULT_WHEEL_DESIGN.pattern,
    color: typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : DEFAULT_WHEEL_DESIGN.color,
    radius: Math.min(clamp('radius', .6, .98), 1 - width / 2), width,
    count: Math.round(clamp('count', 8, 96)), angle: clamp('angle', -180, 180),
    text: validText(value.text) ? value.text : DEFAULT_WHEEL_DESIGN.text,
    arc: clamp('arc', 60, 300),
  };
  const optionalNumber = (key: 'outline' | 'tracking' | 'sweep' | 'gap' | 'rows' | 'repetitions' | 'rotation', min: number, max: number, integer = false) => {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return;
    const bounded = Math.max(min, Math.min(max, value[key]));
    result[key] = integer ? Math.round(bounded) : bounded;
  };
  optionalNumber('outline', 0, .025); optionalNumber('tracking', 0, 2); optionalNumber('sweep', 5, 360);
  optionalNumber('gap', .05, 1); optionalNumber('rows', 1, 5, true); optionalNumber('repetitions', 1, 24, true); optionalNumber('rotation', -180, 180);
  if (typeof value.font === 'string' && ['sans', 'condensed', 'serif', 'mono'].includes(value.font)) result.font = value.font as WheelDesignFont;
  if (typeof value.emblem === 'string' && ['star', 'bolt', 'diamond', 'cross'].includes(value.emblem)) result.emblem = value.emblem as WheelDesignEmblem;
  if (typeof value.italic === 'boolean') result.italic = value.italic;
  if (typeof value.reverse === 'boolean') result.reverse = value.reverse;
  if (color(value.outlineColor)) result.outlineColor = value.outlineColor;
  if (isSafeWheelLogo(value.imageData)) result.imageData = value.imageData;
  return result;
}

/** Transparent source shared by the workshop preview, editable layer, and export. */
export function drawWheelDesign(ctx: CanvasRenderingContext2D, value: WheelDesignSettings): void {
  drawWheelDesignPrimitive(ctx, value);
}

/** Shared synchronous primitive. Composition callers supply their already decoded logo. */
export function drawWheelDesignPrimitive(ctx: CanvasRenderingContext2D, value: WheelDesignSettings, image?: CanvasImageSource): void {
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
    const sweep = (value.sweep ?? 360) * Math.PI / 180;
    const start = value.sweep === undefined || value.sweep === 360 ? 0 : -Math.PI / 2 - sweep / 2;
    const phase = value.sweep === undefined || value.sweep === 360 ? -Math.PI / 2 : -Math.PI / 2 - sweep / 2;
    const circle = (r: number, lineWidth: number) => {
      ctx.lineWidth = lineWidth; ctx.beginPath(); ctx.arc(0, 0, r, start, start + sweep); ctx.stroke();
    };
    if (value.pattern === 'ring') circle(radius, thickness);
    else if (value.pattern === 'double-ring') {
      circle(radius - thickness * .32, thickness * .24);
      circle(radius + thickness * .32, thickness * .24);
    } else if (value.pattern === 'segments') {
      const pitch = sweep / value.count;
      for (let i = 0; i < value.count; i++) {
        ctx.lineWidth = i % 4 === 0 ? thickness : thickness * .6;
        ctx.beginPath(); ctx.arc(0, 0, radius, i * pitch + phase, i * pitch + pitch * (value.gap ?? .55) + phase); ctx.stroke();
      }
    } else if (value.pattern === 'checker') {
      // One repetition is a pair of alternating cells. Honour every integer count exactly,
      // while both rows close without two identical neighbours at the revolution seam.
      const count = value.count * 2, pitch = sweep / count;
      const cell = (inner: number, outer: number, start: number, end: number) => {
        ctx.beginPath(); ctx.arc(0, 0, outer, start, end); ctx.arc(0, 0, inner, end, start, true); ctx.closePath(); ctx.fill();
      };
      const rows = value.rows ?? 2;
      for (let i = 0; i < count; i++) {
        const fill = value.gap ?? 1;
        const start = i * pitch + phase + pitch * (1 - fill) / 2, end = start + pitch * fill;
        for (let row = 0; row < rows; row++) if ((i + row) % 2 === 0) {
          const inner = radius + thickness / 2 - (row + 1) * thickness / rows;
          cell(inner, inner + thickness / rows, start, end);
        }
      }
    } else if (value.pattern === 'chevrons' || value.pattern === 'dots') {
      const pitch = sweep / value.count;
      for (let i = 0; i < value.count; i++) {
        ctx.save(); ctx.rotate(i * pitch + phase + Math.PI / 2); ctx.translate(0, -radius);
        if (value.pattern === 'dots') { ctx.beginPath(); ctx.arc(0, 0, thickness * .28, 0, Math.PI * 2); ctx.fill(); }
        else {
          const half = Math.min(radius * pitch * (value.gap ?? .55) * .45, thickness * .65);
          ctx.lineWidth = thickness * .2; ctx.lineJoin = 'miter'; ctx.beginPath();
          ctx.moveTo(-half, -thickness * .4); ctx.lineTo(half, 0); ctx.lineTo(-half, thickness * .4); ctx.stroke();
        }
        ctx.restore();
      }
    } else if (value.pattern === 'emblem' || value.pattern === 'image') {
      const repeats = value.repetitions ?? 1;
      for (let repeat = 0; repeat < repeats; repeat++) {
        ctx.save(); ctx.rotate(repeat * Math.PI * 2 / repeats); ctx.translate(0, -radius); ctx.rotate((value.rotation ?? 0) * Math.PI / 180);
        if (value.pattern === 'image' && image) {
          const source = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
          const ratio = (source.naturalWidth || source.width || 1) / (source.naturalHeight || source.height || 1);
          const w = Math.min(thickness * ratio, unit * .9), h = w / ratio;
          ctx.drawImage(image, -w / 2, -h / 2, w, h);
        } else {
          const half = thickness / 2;
          ctx.beginPath();
          if (value.pattern === 'image') {
            ctx.rect(-half, -half * .65, thickness, thickness * .65); ctx.moveTo(-half, half * .65); ctx.lineTo(0, -half * .3); ctx.lineTo(half, half * .65); ctx.closePath();
          } else if ((value.emblem ?? 'star') === 'star') {
            for (let point = 0; point < 10; point++) {
              const a = point * Math.PI / 5 - Math.PI / 2, r = point % 2 ? half * .43 : half;
              if (!point) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            } ctx.closePath();
          } else if (value.emblem === 'diamond') { ctx.moveTo(0, -half); ctx.lineTo(half * .7, 0); ctx.lineTo(0, half); ctx.lineTo(-half * .7, 0); ctx.closePath(); }
          else if (value.emblem === 'bolt') { ctx.moveTo(half * .15, -half); ctx.lineTo(-half * .65, half * .1); ctx.lineTo(-half * .05, half * .1); ctx.lineTo(-half * .2, half); ctx.lineTo(half * .65, -half * .25); ctx.lineTo(0, -half * .25); ctx.closePath(); }
          else { ctx.rect(-half * .2, -half, half * .4, thickness); ctx.rect(-half, -half * .2, thickness, half * .4); }
          if (value.outline) { ctx.strokeStyle = value.outlineColor ?? '#101820'; ctx.lineWidth = value.outline * unit; ctx.lineJoin = 'round'; ctx.stroke(); }
          ctx.fill();
        }
        ctx.restore();
      }
    } else if (value.pattern === 'lettering') {
      const characters = Array.from(value.text);
      const arc = value.arc * Math.PI / 180;
      let fontSize = thickness;
      const family = value.font === 'serif' ? 'Georgia, serif' : value.font === 'mono' ? '"Courier New", monospace' : 'Arial, sans-serif';
      const font = () => `${value.italic ? 'italic ' : ''}900 ${fontSize}px ${family}`;
      const squeeze = value.font === 'condensed' ? .73 : 1;
      ctx.font = font();
      const widths = characters.map(character => Math.max(fontSize * .18, ctx.measureText(character).width));
      const contentWidth = widths.reduce((sum, measured) => sum + measured * squeeze, 0);
      // Restrict the font before distributing letters so the narrowest arc never overlaps glyphs.
      const tracking = value.tracking === undefined ? 0 : value.tracking * fontSize * Math.max(0, characters.length - 1);
      const shrink = Math.min(1, radius * arc / Math.max(1, (contentWidth + tracking) * 1.15));
      fontSize *= shrink; ctx.font = font();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const gap = characters.length > 1 ? value.tracking === undefined ? (arc - contentWidth * shrink / radius) / (characters.length - 1) : value.tracking * fontSize / radius : 0;
      const used = contentWidth * shrink / radius + Math.max(0, characters.length - 1) * gap;
      const direction = value.reverse ? -1 : 1, repeats = value.repetitions ?? 1;
      for (let repeat = 0; repeat < repeats; repeat++) {
        let position = -used / 2;
        for (let i = 0; i < characters.length; i++) {
          const span = widths[i] * squeeze * shrink / radius;
          const angle = direction * (position + span / 2) - Math.PI / 2 + repeat * Math.PI * 2 / repeats;
          ctx.save(); ctx.rotate(angle); ctx.translate(radius, 0); ctx.rotate(direction * Math.PI / 2); ctx.scale(squeeze, 1);
          if (value.outline) { ctx.strokeStyle = value.outlineColor ?? '#101820'; ctx.lineWidth = value.outline * unit; ctx.lineJoin = 'round'; ctx.strokeText(characters[i], 0, 0); }
          ctx.fillText(characters[i], 0, 0); ctx.restore(); position += span + gap;
        }
      }
    }
  } finally { ctx.restore(); }
}

/** A regular material owner keeps masking, PBR maps, project round trips, and Undo consistent. */
export function createWheelDesignDefinition(value: WheelDesignSettings): MaterialDefinition {
  if (!isValidWheelDesign(value)) throw new Error('Le motif de flanc contient des réglages invalides.');
  if (value.pattern === 'image' && value.imageData) throw new Error('Le logo doit être chargé dans une composition avant son application.');
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
