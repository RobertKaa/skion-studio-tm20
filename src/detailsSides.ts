import type { MaterialLayer, MaterialRegion } from './materials/types';
import type { UvGuideIsland } from './uvGuideData';
import type { RGBAImage } from './dds';
import { UNDERBODY_PANEL_LAYOUT } from './underbodyPanel';

export const INDEPENDENT_DETAILS = 'independent-v1' as const;
export type DetailsLayout = typeof INDEPENDENT_DETAILS | typeof UNDERBODY_PANEL_LAYOUT;
export type DetailsSide = 'left' | 'right';
export const DETAILS_SIDES: readonly DetailsSide[] = ['left', 'right'];
export const detailsSideLabel = (side: DetailsSide) => side === 'left' ? 'gauche' : 'droit';
export const detailsSideOffset = (side: DetailsSide) => side === 'left' ? .5 : 0;
export const detailsSideKey = (key: string, side: DetailsSide) => {
  const element = key.indexOf(':element:');
  return element < 0 ? `${key}:side:${side}` : `${key.slice(0, element)}:side:${side}${key.slice(element)}`;
};

/** The new game atlas has two disjoint halves, not mirrored/linked artwork. */
export function detailsRegionOnSide<T extends MaterialRegion>(region: T, side: DetailsSide): T {
  const offset = detailsSideOffset(side);
  const label = region.key === 'd_side_r' ? 'FLANC' : region.label;
  return { ...region, key: detailsSideKey(region.key, side), label: `${label} · ${detailsSideLabel(side)}`,
    polygons: region.polygons.map(polygon => polygon.map(p => ({ x: offset+p.x*.5, y: p.y }))) };
}

export function detailsWholeSide(side: DetailsSide): MaterialRegion {
  const x = detailsSideOffset(side);
  return { key: detailsSideKey('details', side), label: `Détails · ${detailsSideLabel(side)}`,
    polygons: [[{x,y:0},{x:x+.5,y:0},{x:x+.5,y:1},{x,y:1}]] };
}

export function independentDetailsGuides(legacy: readonly UvGuideIsland[]): UvGuideIsland[] {
  return legacy.flatMap(island => {
    const sides = DETAILS_SIDES.map(side => detailsRegionOnSide(island, side));
    return island.key === 'd_floor'
      ? sides.map((part, i) => ({ ...part, label: `DESSOUS ${i === 0 ? 'GAUCHE' : 'DROIT'}` }))
      : [{ ...island, label: island.key === 'd_side_r' ? 'FLANCS' : island.label, polygons: sides.flatMap(part => part.polygons) }];
  });
}

export function materialOnDetailsSide(layer: MaterialLayer, side: DetailsSide): MaterialLayer {
  return { ...structuredClone(layer), atlasSide: side,
    regions: layer.regions.length ? layer.regions.map(region => detailsRegionOnSide(region, side)) : [detailsWholeSide(side)],
    exclusions: layer.exclusions.map(region => detailsRegionOnSide(region, side)) };
}

export function materialDetailsSide(layer: MaterialLayer): DetailsSide | undefined {
  if (layer.family !== 'details') return undefined;
  if (layer.atlasSide) return layer.atlasSide;
  if(layer.atlasFrame?.placement==='right')return 'right';
  return DETAILS_SIDES.find(side => layer.regions.length > 0 && layer.regions.every(region => region.key.includes(`:side:${side}`)||region.key===`d_floor:panel:${side}`));
}

/** Recover the legacy frame for UV materials migrated without baking sources. */
export function canonicalDetailsMaterial(layer: MaterialLayer): MaterialLayer {
  const offset = detailsSideOffset(layer.atlasSide!);
  const restore = (region: MaterialRegion): MaterialRegion => ({ ...region,
    polygons: region.polygons.map(polygon => polygon.map(p => ({x: (p.x-offset)*2, y:p.y}))) });
  const { atlasSide: _side, ...original } = layer;
  return { ...original, regions: layer.regions.map(restore), exclusions: layer.exclusions.map(restore) };
}

/** Resample numeric surface maps in their linear channels. Normal vectors are
 * normalized after downsampling, without applying colour-space conversions. */
export function splitDetailsPixels(source: RGBAImage, normal = false): RGBAImage {
  const {width,height}=source;
  if (!Number.isInteger(width)||width<2||width>4096||width%2||!Number.isInteger(height)||height<1||height>4096||source.data.length!==width*height*4) throw new Error('Texture Détails incompatible avec la séparation des côtés.');
  const data=new Uint8ClampedArray(source.data.length),half=width/2;
  for(let y=0;y<height;y++)for(let x=0;x<half;x++){
    const from=(y*width+2*x)*4,to=(y*width+x)*4;
    for(let c=0;c<4;c++)data[to+c]=(source.data[from+c]+source.data[from+4+c])/2;
    if(normal){
      const v=[0,1,2].map(c=>data[to+c]/127.5-1),length=Math.hypot(...v)||1;
      for(let c=0;c<3;c++)data[to+c]=(v[c]/length*.5+.5)*255;
    }
    data.copyWithin(to+half*4,to,to+4);
  }
  return {width,height,data};
}
