import type { MaterialDefinition } from './materials/types';
import {
  DEFAULT_WHEEL_DESIGN, WHEEL_DESIGN_PRESETS, createWheelDesignDefinition, drawWheelDesignPrimitive,
  isValidWheelDesign, normalizeWheelDesign, type WheelDesignPattern, type WheelDesignSettings,
} from './wheelDesign';

export interface WheelDesignElement {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** Emissive intensity for this element; absent keeps older artwork unchanged. */
  emission?: number;
  emissionRole?: 'always' | 'brake';
  design: WheelDesignSettings;
}
export interface WheelDesignComposition { version: 2; elements: WheelDesignElement[] }
export type WheelDesignArtwork = WheelDesignSettings | WheelDesignComposition;
export const MAX_WHEEL_ELEMENTS = 24;
export const MAX_WHEEL_LOGO_CHARACTERS = 800_000;
export const MAX_WHEEL_GLYPHS = 8192;

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const safeName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && Array.from(value).length <= 48 && !Array.from(value).some(character => {
    const code = character.codePointAt(0)!;
    return code < 32 || code >= 127 && code <= 159 || code >= 0x2028 && code <= 0x202e || code >= 0x2066 && code <= 0x2069;
  });
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/** Legacy single motifs remain valid. New artwork contains a strictly bounded local composition. */
export function isValidWheelArtwork(value: unknown): value is WheelDesignArtwork {
  if (isValidWheelDesign(value)) return true;
  if (!plain(value) || !exact(value, ['version', 'elements']) || value.version !== 2
    || !Array.isArray(value.elements) || value.elements.length < 1 || value.elements.length > MAX_WHEEL_ELEMENTS) return false;
  const ids = new Set<string>(); let imageBytes = 0, glyphs = 0;
  return value.elements.every(element => {
    if (!plain(element) || !exact(element, ['id', 'name', 'visible', 'locked', 'opacity', 'emission', 'emissionRole', 'design'])
      || !safeId(element.id) || ids.has(element.id) || !safeName(element.name)
      || typeof element.visible !== 'boolean' || typeof element.locked !== 'boolean'
      || typeof element.opacity !== 'number' || !Number.isFinite(element.opacity) || element.opacity < 0 || element.opacity > 1
      || element.emission !== undefined && (typeof element.emission !== 'number' || !Number.isFinite(element.emission) || element.emission < 0 || element.emission > 1)
      || element.emissionRole !== undefined && element.emissionRole !== 'always' && element.emissionRole !== 'brake'
      || !isValidWheelDesign(element.design)) return false;
    ids.add(element.id); imageBytes += element.design.imageData?.length ?? 0;
    if (element.visible && element.opacity > 0 && element.design.pattern === 'lettering') glyphs += Array.from(element.design.text).length * (element.design.repetitions ?? 1);
    return imageBytes <= MAX_WHEEL_LOGO_CHARACTERS && glyphs <= MAX_WHEEL_GLYPHS;
  });
}

let fallbackId = 0;
/** New elements own their settings and have stable identity independent of order. */
export function createWheelElement(pattern: WheelDesignPattern = 'ring'): WheelDesignElement {
  const preset = WHEEL_DESIGN_PRESETS.find(item => item.id === pattern) ?? WHEEL_DESIGN_PRESETS[0];
  const design = normalizeWheelDesign({ ...DEFAULT_WHEEL_DESIGN, pattern: preset.id,
    width: pattern === 'lettering' ? .10 : pattern === 'checker' || pattern === 'emblem' || pattern === 'image' ? .12 : pattern === 'ring' ? .018 : .055,
    ...(pattern === 'emblem' ? { emblem: 'star', repetitions: 1 } : {}),
    ...(pattern === 'checker' ? { gap: .55 } : {}),
    ...(pattern === 'image' ? { repetitions: 1, rotation: 0 } : {}),
  });
  return { id: globalThis.crypto?.randomUUID?.() ?? `wheel-${Date.now()}-${++fallbackId}`,
    name: preset.label, visible: true, locked: false, opacity: 1, design };
}

/** Draft recovery never mutates a saved material or shares nested element objects. */
export function normalizeWheelComposition(value: unknown): WheelDesignComposition {
  if (isValidWheelDesign(value)) return { version: 2, elements: [{ id: 'element-1', name: WHEEL_DESIGN_PRESETS.find(preset => preset.id === value.pattern)!.label,
    visible: true, locked: false, opacity: 1, design: structuredClone(value) }] };
  if (!plain(value) || value.version !== 2 || !Array.isArray(value.elements)) return normalizeWheelComposition(DEFAULT_WHEEL_DESIGN);
  let imageBytes = 0; const ids = new Set<string>();
  const elements = value.elements.slice(0, MAX_WHEEL_ELEMENTS).filter(plain).map((element, index) => {
    const design = normalizeWheelDesign(element.design);
    imageBytes += design.imageData?.length ?? 0;
    if (imageBytes > MAX_WHEEL_LOGO_CHARACTERS) delete design.imageData;
    let id = safeId(element.id) && !ids.has(element.id) ? element.id : `element-${index + 1}`;
    while (ids.has(id)) id = `${id}-copy`;
    ids.add(id);
    return { id, name: safeName(element.name) ? element.name : WHEEL_DESIGN_PRESETS.find(preset => preset.id === design.pattern)!.label,
      visible: typeof element.visible === 'boolean' ? element.visible : true,
      locked: typeof element.locked === 'boolean' ? element.locked : false,
      opacity: typeof element.opacity === 'number' && Number.isFinite(element.opacity) ? Math.max(0, Math.min(1, element.opacity)) : 1,
      ...(typeof element.emission === 'number' && Number.isFinite(element.emission) ? { emission: Math.max(0, Math.min(1, element.emission)) } : {}),
      ...(element.emissionRole === 'always' || element.emissionRole === 'brake' ? { emissionRole: element.emissionRole as 'always' | 'brake' } : {}),
      design };
  });
  return elements.length ? { version: 2, elements } : normalizeWheelComposition(DEFAULT_WHEEL_DESIGN);
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

/** Decode only bounded PNGs already embedded in the artwork, never remote URLs.
 * An LRU keeps dragging a logo from decoding it on every position update. */
export async function loadWheelCompositionImages(composition: WheelDesignComposition): Promise<Map<string, HTMLImageElement>> {
  if (!isValidWheelArtwork(composition)) throw new Error('La composition du flanc contient des réglages invalides.');
  const result = new Map<string, HTMLImageElement>(), sources = new Map<string, Promise<HTMLImageElement>>();
  await Promise.all(composition.elements.filter(element => element.visible && element.design.pattern === 'image' && element.design.imageData).map(async element => {
    const data = element.design.imageData!;
    let pending = sources.get(data) ?? imageCache.get(data);
    if (!pending) {
      pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = document.createElement('img');
        const timeout = setTimeout(() => { image.onload = image.onerror = null; image.src = ''; reject(new Error('Le logo met trop de temps à être décodé.')); }, 10_000);
        image.onload = () => {
          clearTimeout(timeout); image.onload = image.onerror = null;
          if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 512 || image.naturalHeight > 512) reject(new Error('Le logo dépasse les dimensions autorisées.'));
          else resolve(image);
        };
        image.onerror = () => { clearTimeout(timeout); image.onload = image.onerror = null; reject(new Error('Le logo PNG est illisible. Importez une autre image.')); };
        image.src = data;
      });
      imageCache.set(data, pending);
      pending.catch(() => { if (imageCache.get(data) === pending) imageCache.delete(data); });
    }
    sources.set(data, pending);
    if (imageCache.has(data)) { imageCache.delete(data); imageCache.set(data, pending); }
    while (imageCache.size > MAX_WHEEL_ELEMENTS) imageCache.delete(imageCache.keys().next().value!);
    result.set(element.id, await pending);
  }));
  return result;
}

/** One annular transparent source serves preview, material ownership, Undo and export alike. */
export function drawWheelComposition(ctx: CanvasRenderingContext2D, composition: WheelDesignComposition,
  images: ReadonlyMap<string, CanvasImageSource> = new Map(), channel: 'color' | 'emission' | 'roles' = 'color'): void {
  if (!isValidWheelArtwork(composition)) throw new Error('La composition du flanc contient des réglages invalides.');
  const { width, height } = ctx.canvas;
  if (!width || !height) return;
  if (width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) throw new Error('L’aperçu du flanc est trop volumineux.');
  const scratch = document.createElement('canvas'); scratch.width = width; scratch.height = height;
  const layer = scratch.getContext('2d');
  if (!layer) throw new Error('L’aperçu du flanc est indisponible.');
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    const radius = Math.min(width, height) / 2;
    ctx.beginPath(); ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
    ctx.arc(width / 2, height / 2, radius * .58, 0, Math.PI * 2, true); ctx.clip('evenodd');
    for (const element of composition.elements) {
      if (!element.visible || element.opacity === 0) continue;
      drawWheelDesignPrimitive(layer, element.design, images.get(element.id));
      if (channel === 'emission') {
        // Preserve each shape's alpha and stacking, including non-emissive
        // shapes that cover a luminous element beneath them.
        layer.save();
        layer.globalCompositeOperation = 'source-atop'; layer.globalAlpha = 1 - (element.emission ?? 0);
        layer.fillStyle = '#000000'; layer.fillRect(0, 0, width, height);
        layer.restore();
      }
      if (channel === 'roles') {
        layer.save(); layer.globalCompositeOperation = 'source-atop'; layer.globalAlpha = 1;
        layer.fillStyle = element.emissionRole === 'brake' ? '#030303' : '#ffffff';
        layer.fillRect(0, 0, width, height); layer.restore();
      }
      ctx.globalAlpha = element.opacity; ctx.drawImage(scratch, 0, 0);
    }
  } finally { ctx.restore(); scratch.width = scratch.height = 1; }
}

/** A composition stays one editable material owner; the original PNG and all settings travel together. */
export async function createWheelArtworkDefinition(artwork: WheelDesignArtwork): Promise<MaterialDefinition> {
  if (!isValidWheelArtwork(artwork)) throw new Error('La composition du flanc contient des réglages invalides.');
  const captured = structuredClone(artwork);
  if (!('version' in captured) && captured.pattern !== 'image') return createWheelDesignDefinition(captured);
  const composition = 'version' in captured ? captured : normalizeWheelComposition(captured);
  if (composition.elements.some(element => element.visible && element.design.pattern === 'image' && !element.design.imageData)) throw new Error('Importez un logo pour chaque élément image visible.');
  if (!composition.elements.some(element => element.visible && element.opacity > 0)) throw new Error('Rendez au moins un élément visible avant d’appliquer la composition.');
  const images = await loadWheelCompositionImages(composition);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('La création du flanc est indisponible.');
  try {
    drawWheelComposition(context, composition, images);
    const definition = createWheelDesignDefinition({ ...DEFAULT_WHEEL_DESIGN });
    definition.name = 'Flanc · Composition'; definition.wheelDesign = captured;
    definition.textures.color = { src: canvas.toDataURL('image/png'), name: 'Composition du flanc.png', component: 'luminance', invert: false };
    if (composition.elements.some(element => element.emission !== undefined)) {
      drawWheelComposition(context, composition, images, 'emission');
      definition.textures.emission = { src: canvas.toDataURL('image/png'), name: 'Lumière du flanc.png', component: 'luminance', invert: false };
      drawWheelComposition(context, composition, images, 'roles');
      definition.textures.wheelEmissionRole = { src: canvas.toDataURL('image/png'), name: 'Activation du flanc.png', component: 'r', invert: false };
      definition.emissionColor = '#ffffff'; definition.emissionStrength = 1;
    }
    return definition;
  } finally { canvas.width = canvas.height = 1; }
}

/** Keep existing material settings, replacing emission only when the artwork owns it. */
export function mergeWheelArtworkDefinition(existing: MaterialDefinition, generated: MaterialDefinition): MaterialDefinition {
  if (existing.textures.wheelEmissionRole && !generated.textures.emission) {
    const textures = { ...existing.textures, color: generated.textures.color };
    delete textures.emission; delete textures.wheelEmissionRole;
    return { ...existing, wheelDesign: generated.wheelDesign, emissionStrength: 0, textures };
  }
  return { ...existing, wheelDesign: generated.wheelDesign,
    ...(generated.textures.emission && !existing.textures.wheelEmissionRole ? { emissionColor: generated.emissionColor, emissionStrength: generated.emissionStrength } : {}),
    textures: { ...existing.textures, color: generated.textures.color,
      ...(generated.textures.emission ? { emission: generated.textures.emission, wheelEmissionRole: generated.textures.wheelEmissionRole } : {}) } };
}

const design = (pattern: WheelDesignPattern, settings: Partial<WheelDesignSettings>): WheelDesignSettings => normalizeWheelDesign({ ...DEFAULT_WHEEL_DESIGN, pattern, ...settings });
const style = (id: string, label: string, description: string, entries: [string, WheelDesignSettings][]) => ({ id, label, description,
  composition: { version: 2 as const, elements: entries.map(([name, settings], index) => ({ id: `${id}-${index + 1}`, name,
    visible: true, locked: false, opacity: 1, design: settings })) } });

/** Original, fully editable starting compositions rather than flattened bitmap presets. */
export const WHEEL_COMPOSITION_STYLES = Object.freeze([
  style('endurance', 'Endurance', 'Marquages opposés, liserés fins et repères de course.', [
    ['Filet extérieur', design('ring', { color: '#f2efe6', radius: .955, width: .012 })],
    ['Filet intérieur', design('ring', { color: '#e86b38', radius: .75, width: .014 })],
    ['Signature', design('lettering', { color: '#f2efe6', radius: .83, width: .115, text: 'SKION MOTORSPORT', arc: 135, font: 'condensed', tracking: .06 })],
    ['Série', design('lettering', { color: '#f2efe6', radius: .83, width: .075, text: 'RACING DIVISION · 01', arc: 140, angle: 180, reverse: true, font: 'condensed', tracking: .12 })],
    ['Repères', design('emblem', { color: '#e86b38', radius: .83, width: .08, angle: 90, emblem: 'diamond', repetitions: 2 })],
  ]),
  style('heritage', 'Héritage', 'Flanc blanc fin, lettrage crème et détails de collection.', [
    ['Couronne crème', design('double-ring', { color: '#e9dbb4', radius: .93, width: .055 })],
    ['Inscription', design('lettering', { color: '#e9dbb4', radius: .79, width: .12, text: 'GRAND PRIX', arc: 125, font: 'serif', tracking: .1 })],
    ['Millésime', design('lettering', { color: '#d3975b', radius: .79, width: .075, text: 'EST. 1986', arc: 100, angle: 180, reverse: true, font: 'serif', tracking: .2 })],
    ['Étoiles', design('emblem', { color: '#d3975b', radius: .79, width: .065, angle: 90, emblem: 'star', repetitions: 2 })],
  ]),
  style('technical', 'Télémétrie', 'Graduations, numéro de série et touches de bleu électrique.', [
    ['Graduations', design('segments', { color: '#4ad3ed', radius: .94, width: .032, count: 64, gap: .28 })],
    ['Anneau interne', design('ring', { color: '#a2bcc5', radius: .75, width: .009 })],
    ['Identification', design('lettering', { color: '#e6f4f7', radius: .82, width: .09, text: 'COMPOUND / 07', arc: 125, font: 'mono', tracking: .05 })],
    ['Données', design('lettering', { color: '#4ad3ed', radius: .82, width: .055, text: 'PRESSURE 1.8 · TEMP 92', arc: 135, angle: 180, reverse: true, font: 'mono', tracking: .08 })],
    ['Balises', design('emblem', { color: '#e6f4f7', radius: .82, width: .055, angle: 90, emblem: 'cross', repetitions: 2 })],
  ]),
  style('rally', 'Rallye', 'Énergie orange, grands marquages et chevrons directionnels.', [
    ['Chevrons', design('chevrons', { color: '#f06a32', radius: .94, width: .055, count: 40, gap: .7 })],
    ['Marque', design('lettering', { color: '#f7eee5', radius: .8, width: .14, text: 'DIRT LEGENDS', arc: 145, font: 'condensed', italic: true, tracking: .03 })],
    ['Épreuve', design('lettering', { color: '#f06a32', radius: .8, width: .075, text: 'ALL TERRAIN · STAGE 01', arc: 150, angle: 180, reverse: true, font: 'condensed', tracking: .06 })],
    ['Repères de montage', design('emblem', { color: '#f7eee5', radius: .8, width: .065, angle: 90, emblem: 'bolt', repetitions: 2 })],
  ]),
  style('neon', 'Voltage', 'Signature contrastée, éclairs et rythme graphique.', [
    ['Anneau électrique', design('double-ring', { color: '#a3f46c', radius: .94, width: .035 })],
    ['Cadence', design('dots', { color: '#b49cf8', radius: .75, width: .02, count: 64 })],
    ['Signature', design('lettering', { color: '#a3f46c', radius: .81, width: .12, text: 'AFTER HOURS', arc: 145, font: 'condensed', outline: .006, outlineColor: '#161c24', tracking: .04 })],
    ['Série', design('lettering', { color: '#b49cf8', radius: .81, width: .07, text: 'NIGHT RUN · 2049', arc: 130, angle: 180, reverse: true, font: 'mono', tracking: .06 })],
    ['Éclairs', design('emblem', { color: '#b49cf8', radius: .81, width: .08, angle: 90, emblem: 'bolt', repetitions: 2 })],
  ]),
  style('minimal', 'Signature', 'Trois éléments précis pour une identité sobre et personnelle.', [
    ['Filet', design('ring', { color: '#e6ebe5', radius: .94, width: .009 })],
    ['Signature', design('lettering', { color: '#e6ebe5', radius: .82, width: .075, text: 'YOUR SIGNATURE', arc: 115, font: 'sans', tracking: .14 })],
    ['Repère unique', design('emblem', { color: '#75d7ba', radius: .82, width: .04, angle: 180, emblem: 'diamond' })],
  ]),
]);
