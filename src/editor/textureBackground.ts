import { FabricImage, Group, Rect, type StaticCanvas } from 'fabric';

export type BackgroundFit = 'cover' | 'contain' | 'stretch';
export interface TextureBackgroundSettings {
  name: string;
  fit: BackgroundFit;
  colorOpacity: number;
}
export interface TextureBackgroundInfo extends TextureBackgroundSettings { src: string }
type BackgroundGroup = Group & { textureBackground: TextureBackgroundSettings };

export function textureBackgroundName(name: string): string {
  return Array.from(name).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').slice(0, 160) || 'Image de fond';
}

export function validTextureBackgroundSettings(value: unknown): value is TextureBackgroundSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return typeof data.name === 'string' && data.name.length > 0 && data.name.length <= 160 &&
    data.name === textureBackgroundName(data.name) && ['cover', 'contain', 'stretch'].includes(String(data.fit)) &&
    typeof data.colorOpacity === 'number' && Number.isFinite(data.colorOpacity) && data.colorOpacity >= 0 && data.colorOpacity <= 1;
}

function backgroundGroup(canvas: StaticCanvas): BackgroundGroup | null {
  const group = canvas.backgroundImage as BackgroundGroup | undefined;
  if (!(group instanceof Group) || !validTextureBackgroundSettings(group.textureBackground)) return null;
  const children = group.getObjects();
  return children.length === 2 && children[0] instanceof FabricImage && children[1] instanceof Rect ? group : null;
}

export function readTextureBackground(canvas: StaticCanvas): TextureBackgroundInfo | null {
  const group = backgroundGroup(canvas);
  return group ? { ...group.textureBackground, src: (group.item(0) as FabricImage).getSrc() } : null;
}

function fitImage(image: FabricImage, width: number, height: number, fit: BackgroundFit, grouped = false) {
  const original = image.getOriginalSize();
  const sx = width / original.width, sy = height / original.height;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const cropWidth = fit === 'cover' ? width / scale : original.width;
  const cropHeight = fit === 'cover' ? height / scale : original.height;
  const scaleX = fit === 'stretch' ? sx : scale;
  const scaleY = fit === 'stretch' ? sy : scale;
  image.set({
    originX: 'left', originY: 'top', strokeWidth: 0,
    width: cropWidth, height: cropHeight,
    cropX: (original.width - cropWidth) / 2, cropY: (original.height - cropHeight) / 2,
    scaleX, scaleY,
    left: (width - cropWidth * scaleX) / 2 - (grouped ? width / 2 : 0),
    top: (height - cropHeight * scaleY) / 2 - (grouped ? height / 2 : 0),
    selectable: false, evented: false, objectCaching: false,
  });
  image.setCoords();
}

/** Fabric draws its background image above its background color. Keep the image
 * and the translucent color together, below ordinary layers, at atlas precision. */
export function createTextureBackground(image: FabricImage, width: number, height: number, color: string, settings: TextureBackgroundSettings): Group {
  fitImage(image, width, height, settings.fit);
  const overlay = new Rect({
    left: 0, top: 0, originX: 'left', originY: 'top', width, height, strokeWidth: 0,
    fill: color, opacity: settings.colorOpacity, selectable: false, evented: false, objectCaching: false,
  });
  const group = new Group([image, overlay], {
    left: 0, top: 0, originX: 'left', originY: 'top', strokeWidth: 0,
    selectable: false, evented: false, objectCaching: false,
  }) as BackgroundGroup;
  group.textureBackground = { ...settings };
  return group;
}

export function updateTextureBackground(canvas: StaticCanvas, changes: Partial<Pick<TextureBackgroundSettings, 'fit' | 'colorOpacity'>> = {}) {
  const group = backgroundGroup(canvas);
  if (!group) return;
  const settings = { ...group.textureBackground, ...changes };
  if (!validTextureBackgroundSettings(settings)) return;
  if (changes.fit && changes.fit !== group.textureBackground.fit) fitImage(group.item(0) as FabricImage, group.width, group.height, changes.fit, true);
  group.textureBackground = settings;
  group.item(1).set({ fill: canvas.backgroundColor, opacity: settings.colorOpacity });
  group.set('dirty', true);
}

/** backgroundVpt is not serialized by Fabric. Derive it after every restoration
 * so the background follows the same zoom and pan as the editable layers. */
export function syncTextureBackgroundCanvas(canvas: StaticCanvas) {
  const group = backgroundGroup(canvas);
  canvas.backgroundVpt = !!group;
  if (canvas.backgroundImage) canvas.backgroundImage.set('canvas', canvas);
  // These runtime flags are not part of Fabric's default serialization.
  if (group) for (const object of [group, ...group.getObjects()]) object.set({ objectCaching: false, selectable: false, evented: false });
  updateTextureBackground(canvas);
}
