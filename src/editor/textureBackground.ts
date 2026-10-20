import { FabricImage, Group, Rect, type StaticCanvas } from 'fabric';
import { UNDERBODY_PANEL_LAYOUT, PANEL_BOUNDS, PANEL_SCALE, PANEL_SOURCE, panelPoint } from '../underbodyPanel';
import type { DetailsLayout } from '../detailsSides';
import { drawRealAtlas, drawSourceAtlas, realAtlasLayout, validAtlasSource, type AtlasSourceLayout } from '../realUvAtlas';
import { createMaterialDefinition } from '../materials/types';
import { createMaterialProjector } from '../materials/projection';
import type { ProjectionTriangle } from '../three/decalProjection';

export type BackgroundFit = 'cover' | 'contain' | 'stretch';
export interface BackgroundPlacement { scale: number; angle: number; offsetX: number; offsetY: number }
export const DEFAULT_BACKGROUND_PLACEMENT: Readonly<BackgroundPlacement> = { scale: 1, angle: 0, offsetX: 0, offsetY: 0 };
export interface TextureBackgroundSettings {
  projection?: 'surface';
  placement?: BackgroundPlacement;
  uvAtlas?: { family:'skin'|'details'|'wheels'; source:AtlasSourceLayout; reverse?:boolean };
  name: string;
  fit: BackgroundFit;
  colorOpacity: number;
  layout?: DetailsLayout;
}
export interface TextureBackgroundInfo extends TextureBackgroundSettings { src: string }
type BackgroundGroup = Group & { textureBackground: TextureBackgroundSettings };

export function textureBackgroundName(name: string): string {
  return Array.from(name).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').slice(0, 160) || 'Image de fond';
}

export function validTextureBackgroundSettings(value: unknown): value is TextureBackgroundSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const placement = data.placement as Record<string, unknown> | undefined;
  const bounded = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  return typeof data.name === 'string' && data.name.length > 0 && data.name.length <= 160 &&
    data.name === textureBackgroundName(data.name) && ['cover', 'contain', 'stretch'].includes(String(data.fit)) &&
    typeof data.colorOpacity === 'number' && Number.isFinite(data.colorOpacity) && data.colorOpacity >= 0 && data.colorOpacity <= 1 &&
    (data.projection === undefined || data.projection === 'surface' && data.layout === undefined && data.uvAtlas === undefined) &&
    (placement === undefined || data.projection === 'surface' && !!placement && typeof placement === 'object' && !Array.isArray(placement) &&
      Object.keys(placement).every(key => ['scale', 'angle', 'offsetX', 'offsetY'].includes(key)) &&
      bounded(placement.scale, .1, 4) && bounded(placement.angle, -180, 180) && bounded(placement.offsetX, -2048, 2048) && bounded(placement.offsetY, -2048, 2048)) &&
    (data.layout === undefined || data.layout === 'independent-v1' || data.layout === UNDERBODY_PANEL_LAYOUT) &&
    (data.uvAtlas===undefined||!!data.uvAtlas&&typeof data.uvAtlas==='object'&&['skin','details','wheels'].includes((data.uvAtlas as Record<string,unknown>).family as string)&&validAtlasSource((data.uvAtlas as Record<string,unknown>).source)&&((data.uvAtlas as Record<string,unknown>).reverse===undefined||typeof (data.uvAtlas as Record<string,unknown>).reverse==='boolean'));
}

function backgroundGroup(canvas: StaticCanvas): BackgroundGroup | null {
  const group = canvas.backgroundImage as BackgroundGroup | undefined;
  if (!(group instanceof Group) || !validTextureBackgroundSettings(group.textureBackground)) return null;
  const children = group.getObjects();
  return children.length === (group.textureBackground.layout||group.textureBackground.uvAtlas||group.textureBackground.projection ? 3 : 2) && children[0] instanceof FabricImage &&
    (!(group.textureBackground.layout||group.textureBackground.uvAtlas||group.textureBackground.projection) || children[1] instanceof FabricImage) && children.at(-1) instanceof Rect ? group : null;
}

export function readTextureBackground(canvas: StaticCanvas): TextureBackgroundInfo | null {
  const group = backgroundGroup(canvas);
  return group ? { ...group.textureBackground, src: (group.item(group.textureBackground.uvAtlas||group.textureBackground.projection?1:0) as FabricImage).getSrc() } : null;
}

const bodyGeometry = new WeakMap<readonly ProjectionTriangle[], readonly ProjectionTriangle[]>();
function surfaceBackground(image: FabricImage, width: number, height: number, settings: TextureBackgroundSettings, geometry: readonly ProjectionTriangle[]) {
  if (geometry.length > 500000) throw new Error('Modèle trop complexe pour adapter l’image de fond.');
  let body = bodyGeometry.get(geometry);
  if (!body) { body = geometry.filter(triangle => triangle.family === 'skin'); bodyGeometry.set(geometry, body); }
  if (!body.length) throw new Error('Attendez le chargement de la carrosserie 3D pour adapter l’image de fond.');
  const original = image.getOriginalSize();
  const source = document.createElement('canvas'); source.width = original.width; source.height = original.height;
  const target = document.createElement('canvas');
  const size = Math.min(4096, Math.max(width, height, original.width, original.height)); target.width = target.height = size;
  try {
    source.getContext('2d')!.drawImage(image.getElement(), 0, 0);
    const placement = settings.placement ?? DEFAULT_BACKGROUND_PLACEMENT;
    const definition = createMaterialDefinition();
    definition.transform = { ...definition.transform, projection: 'surface', mode: settings.fit, size: 256 * placement.scale, angle: placement.angle, offsetX: placement.offsetX, offsetY: placement.offsetY };
    createMaterialProjector({ definition, family: 'skin', regions: [], exclusions: [] }, body, size, source)!.place(target, source);
    return new FabricImage(target, { left: 0, top: 0, originX: 'left', originY: 'top', scaleX: width / size, scaleY: height / size, strokeWidth: 0, objectCaching: false });
  } finally { source.width = source.height = 0; }
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

/** Preserve the full original source once; the second child is only this panel. */
function panelBackground(image:FabricImage,width:number,height:number,fit:BackgroundFit):FabricImage {
  fitImage(image,width,height,fit);
  const fragment=document.createElement('canvas');fragment.width=Math.max(1,Math.ceil(PANEL_BOUNDS.w*width*PANEL_SCALE));fragment.height=Math.max(1,Math.ceil(PANEL_BOUNDS.h*height*PANEL_SCALE));
  const ctx=fragment.getContext('2d')!;
  ctx.scale(PANEL_SCALE,PANEL_SCALE);ctx.translate(-PANEL_BOUNDS.x*width,-PANEL_BOUNDS.y*height);
  ctx.beginPath();PANEL_SOURCE.forEach((p,i)=>i?ctx.lineTo(p.x*width,p.y*height):ctx.moveTo(p.x*width,p.y*height));ctx.closePath();ctx.clip();
  ctx.drawImage(image.getElement(),image.cropX,image.cropY,image.width,image.height,image.left,image.top,image.width*image.scaleX,image.height*image.scaleY);
  image.set({left:image.left*PANEL_SCALE,top:image.top*PANEL_SCALE,scaleX:image.scaleX*PANEL_SCALE,scaleY:image.scaleY*PANEL_SCALE});
  const point=panelPoint(PANEL_BOUNDS,'right');
  return new FabricImage(fragment,{left:point.x*width,top:point.y*height,originX:'left',originY:'top',strokeWidth:0,selectable:false,evented:false,objectCaching:false});
}

/** Fabric draws its background image above its background color. Keep the image
 * and the translucent color together, below ordinary layers, at atlas precision. */
export function createTextureBackground(image: FabricImage, width: number, height: number, color: string, settings: TextureBackgroundSettings, geometry: readonly ProjectionTriangle[] = []): Group {
  if (settings.projection) {
    const visible = surfaceBackground(image, width, height, settings, geometry);
    const hidden = new FabricImage(image.getElement(), { left: 0, top: 0, originX: 'left', originY: 'top', scaleX: 1 / Math.max(1, image.width), scaleY: 1 / Math.max(1, image.height), visible: false, objectCaching: false });
    const overlay = new Rect({ left: 0, top: 0, originX: 'left', originY: 'top', width, height, strokeWidth: 0, fill: color, opacity: settings.colorOpacity, objectCaching: false });
    const group = new Group([visible, hidden, overlay], { left: 0, top: 0, originX: 'left', originY: 'top', strokeWidth: 0, selectable: false, evented: false, objectCaching: false }) as BackgroundGroup;
    group.textureBackground = { name: settings.name, fit: settings.fit, colorOpacity: settings.colorOpacity, projection: 'surface', ...(settings.placement ? { placement: { ...settings.placement } } : {}) };
    return group;
  }
  if(settings.uvAtlas){
    const {uvAtlas,...nativeSettings}=settings;
    const original=new FabricImage(image.getElement()),native=createTextureBackground(original,width,height,'#000000',{...nativeSettings,colorOpacity:0});
    const source=document.createElement('canvas'),size=image.getOriginalSize(),ratio=Math.max(1,Math.min(4096,Math.max(size.width,size.height))/Math.max(width,height));source.width=Math.round(width*ratio);source.height=Math.round(height*ratio);
    const context=source.getContext('2d')!;context.scale(ratio,ratio);native.render(context);
    const arranged=document.createElement('canvas');arranged.width=source.width;arranged.height=source.height;(uvAtlas.reverse?drawSourceAtlas:drawRealAtlas)(arranged.getContext('2d')!,source,realAtlasLayout(uvAtlas.family,uvAtlas.source));
    const visible=new FabricImage(arranged,{left:0,top:0,scaleX:1/ratio,scaleY:1/ratio,originX:'left',originY:'top',strokeWidth:0,objectCaching:false});
    const hidden=new FabricImage(image.getElement(),{left:0,top:0,originX:'left',originY:'top',scaleX:1/Math.max(1,image.width),scaleY:1/Math.max(1,image.height),visible:false,objectCaching:false});
    const overlay=new Rect({left:0,top:0,originX:'left',originY:'top',width,height,strokeWidth:0,fill:color,opacity:settings.colorOpacity,objectCaching:false});
    const group=new Group([visible,hidden,overlay],{left:0,top:0,originX:'left',originY:'top',strokeWidth:0,selectable:false,evented:false,objectCaching:false}) as BackgroundGroup;
    group.textureBackground={name:settings.name,fit:settings.fit,colorOpacity:settings.colorOpacity,uvAtlas,...(settings.layout?{layout:settings.layout}:{})};source.width=source.height=1;native.removeAll();native.dispose();return group;
  }
  fitImage(image, width, height, settings.fit);
  const images=[image];
  if(settings.layout===UNDERBODY_PANEL_LAYOUT)images.push(panelBackground(image,width,height,settings.fit));
  else if(settings.layout){
    const other=new FabricImage(image.getElement());fitImage(other,width,height,settings.fit);
    for(const [i,part] of [image,other].entries())part.set({left:(part.left??0)*.5+i*width/2,scaleX:part.scaleX*.5});
    images.push(other);
  }
  const overlay = new Rect({
    left: 0, top: 0, originX: 'left', originY: 'top', width, height, strokeWidth: 0,
    fill: color, opacity: settings.colorOpacity, selectable: false, evented: false, objectCaching: false,
  });
  const group = new Group([...images, overlay], {
    left: 0, top: 0, originX: 'left', originY: 'top', strokeWidth: 0,
    selectable: false, evented: false, objectCaching: false,
  }) as BackgroundGroup;
  group.textureBackground = { name: settings.name, fit: settings.fit, colorOpacity: settings.colorOpacity,
    ...(settings.layout ? { layout: settings.layout } : {}) };
  return group;
}

export function updateTextureBackground(canvas: StaticCanvas, changes: Partial<Pick<TextureBackgroundSettings, 'fit' | 'colorOpacity' | 'placement'>> = {}, geometry: readonly ProjectionTriangle[] = []) {
  const group = backgroundGroup(canvas);
  if (!group) return;
  const settings = { ...group.textureBackground, ...changes };
  if (!validTextureBackgroundSettings(settings)) return;
  if (settings.projection && (changes.placement || changes.fit && changes.fit !== group.textureBackground.fit)) {
    const replacement = createTextureBackground(group.item(1) as FabricImage, canvas.width, canvas.height, canvas.backgroundColor as string, settings, geometry);
    canvas.backgroundImage = replacement; group.removeAll(); group.dispose(); syncTextureBackgroundCanvas(canvas); return;
  }
  if (changes.fit && changes.fit !== group.textureBackground.fit) {
    if(settings.uvAtlas){
      const replacement=createTextureBackground(group.item(1) as FabricImage,canvas.width,canvas.height,canvas.backgroundColor as string,settings);
      canvas.backgroundImage=replacement;group.removeAll();group.dispose();return;
    }
    if(settings.layout===UNDERBODY_PANEL_LAYOUT){
      const image=group.item(0) as FabricImage,other=group.item(1) as FabricImage,updated=panelBackground(image,group.width,group.height,changes.fit);
      image.set({left:image.left-group.width/2,top:image.top-group.height/2});
      other.setElement(updated.getElement());other.set({width:updated.width,height:updated.height,left:updated.left-group.width/2,top:updated.top-group.height/2,scaleX:1,scaleY:1});
    }else{
    const count=settings.layout?2:1;
    for(let i=0;i<count;i++){
      const image=group.item(i) as FabricImage;fitImage(image,group.width,group.height,changes.fit,true);
      if(settings.layout)image.set({left:((image.left??0)+group.width/2)*.5-group.width/2+i*group.width/2,scaleX:image.scaleX*.5});
    }
    }
  }
  group.textureBackground = settings;
  group.item(group.getObjects().length-1).set({ fill: canvas.backgroundColor, opacity: settings.colorOpacity });
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
