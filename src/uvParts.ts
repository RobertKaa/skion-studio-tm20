import type { UvGuideIsland } from './uvGuideData';
import { uvRegionBounds } from './blenderParts';

export interface UvPartEntry {
  id: string;
  parent: UvGuideIsland;
  element: number;
  region: UvGuideIsland;
  bounds: ReturnType<typeof uvRegionBounds>;
  area: number;
}
const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((sum, a, i) => {
  const b = p[(i + 1) % p.length]; return sum + a.x * b.y - b.x * a.y;
}, 0)) / 2;
const contains = (poly: { x: number; y: number }[], point: { x: number; y: number }) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};
export const uvSearchText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

/** Display-only organization: IDs keep the original polygon indices, including
 * after sorting/filtering. A hole belongs to its outer contour, never a tile. */
export function organizedUvParts(islands: readonly UvGuideIsland[]): UvPartEntry[] {
  const result: UvPartEntry[] = [];
  let work = 0;
  for (const parent of islands) {
    const sizes = parent.polygons.map(area);
    const boxes = parent.polygons.map(poly => uvRegionBounds({ ...parent, polygons: [poly] }));
    const inside = (inner: number, outer: number) => {
      if (++work > 2_000_000) throw new Error('Ces contours sont trop complexes pour la vue rangée. Utilisez la vue Atlas.');
      const a=boxes[inner],b=boxes[outer];
      if(sizes[inner]>=sizes[outer]||a.x<b.x||a.y<b.y||a.x+a.w>b.x+b.w||a.y+a.h>b.y+b.h)return false;
      return parent.polygons[inner].every(point=>{
        work+=parent.polygons[outer].length;
        if(work>2_000_000)throw new Error('Ces contours sont trop complexes pour la vue rangée. Utilisez la vue Atlas.');
        return contains(parent.polygons[outer],point);
      });
    };
    parent.polygons.forEach((polygon, element) => {
      if (polygon.length < 3 || sizes[element] < 1e-12) return;
      if (parent.fillRule === 'evenodd') {
        const depth = parent.polygons.filter((_,i) => inside(element,i)).length;
        if (depth % 2) return;
      }
      const region:UvGuideIsland={...parent,key:`${parent.key}:element:${element}`,label:`${parent.label} · élément ${element+1}`,
        polygons:parent.fillRule==='evenodd'?[polygon,...parent.polygons.filter((_,i)=>inside(i,element))]:[polygon]};
      const bounds = uvRegionBounds(region); if (!(bounds.w > 0 && bounds.h > 0)) return;
      if(result.length>=5000)throw new Error('Ce modèle comporte trop de formes pour la vue rangée. Utilisez la vue Atlas.');
      result.push({ id: region.key, parent, element, region, bounds, area: sizes[element] });
    });
  }
  return result;
}

/** Fit with one scale, including very long thin pieces. No image stretching. */
export function uvPartFrame(bounds: UvPartEntry['bounds'], width: number, height: number, padding = 12) {
  const scale = Math.max(1e-6, Math.min((width - padding * 2) / bounds.w, (height - padding * 2) / bounds.h));
  return { scale, x: (width - bounds.w * scale) / 2 - bounds.x * scale, y: (height - bounds.h * scale) / 2 - bounds.y * scale };
}

export function drawUvPart(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement, part: UvPartEntry) {
  const { width, height } = ctx.canvas, frame = uvPartFrame(part.bounds, width, height);
  ctx.clearRect(0, 0, width, height); ctx.save();
  ctx.translate(frame.x, frame.y); ctx.scale(frame.scale, frame.scale);
  ctx.beginPath();
  for (const polygon of part.region.polygons) {
    ctx.moveTo(polygon[0].x, polygon[0].y); for (const p of polygon.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath();
  }
  ctx.clip(part.region.fillRule ?? 'nonzero');
  ctx.drawImage(texture, 0, 0, 1, 1); ctx.restore();
  ctx.save(); ctx.translate(frame.x, frame.y); ctx.scale(frame.scale, frame.scale); ctx.beginPath();
  for (const polygon of part.region.polygons) {
    ctx.moveTo(polygon[0].x, polygon[0].y); for (const p of polygon.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath();
  }
  ctx.lineWidth = 1 / frame.scale; ctx.strokeStyle = 'rgba(171,215,209,.75)'; ctx.stroke(); ctx.restore();
}
