import type { UvGuideIsland } from './uvGuideData';
import { organizedUvParts, type UvPartEntry } from './uvParts';

type Point = { x: number; y: number };
type Box = Point & { w: number; h: number };
export interface UvAtlasPlacement {
  part: UvPartEntry;
  /** Original UV → organized sheet. A similarity: no stretching. */
  matrix: [number, number, number, number, number, number];
  bounds: Box;
}
export interface UvAtlasGroup extends Box { key: string; label: string; header: number }
export interface UvAtlasLayout { placements: UvAtlasPlacement[]; groups: UvAtlasGroup[] }
type Item = { w: number; h: number };
const GAP = .008, INSET = .014, HEADER = .034;

/** First-fit shelves have bounded quadratic work, including imported models. */
function shelves<T extends Item>(items: T[], width: number, gap: number) {
  const rows: { x: number; y: number; h: number }[] = [];
  let height = 0, usedWidth = 0;
  const packed = items.toSorted((a, b) => b.h - a.h || b.w - a.w).map(item => {
    let row = rows.find(r => item.h <= r.h + 1e-10 && r.x + item.w <= width + 1e-10);
    if (!row) { row = { x: 0, y: height, h: item.h }; rows.push(row); height += item.h + gap; }
    const position = { item, x: row.x, y: row.y };
    usedWidth = Math.max(usedWidth, row.x + item.w); row.x += item.w + gap;
    return position;
  });
  return { packed, w: usedWidth, h: Math.max(0, height - gap) };
}

/** Deterministic atlas plan. Callers choose a display-only arrangement or use
 * this plan to migrate editable layers and the model's actual UV coordinates. */
export function buildUvAtlasLayout(islands: readonly UvGuideIsland[], options: { rotate?: boolean; bounds?: Record<string, Box> } = {}): UvAtlasLayout {
  let vertices = 0;
  for (const island of islands) for (const polygon of island.polygons) for (const p of polygon) {
    if (++vertices > 250_000 || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 16 || Math.abs(p.y) > 16)
      throw new Error('Ces UV sont trop complexes pour la planche organisée. Utilisez les UV d’origine.');
  }
  const parts = organizedUvParts(islands).map(part => options.bounds?.[part.id] ? {...part,bounds:{...part.bounds,...options.bounds[part.id]}} : part);
  const groups = islands.map(island => {
    const items = parts.filter(p => p.parent === island).map(part => {
      const rotate = options.rotate !== false && part.bounds.h > part.bounds.w * 1.35;
      return { part, rotate, w: rotate ? part.bounds.h : part.bounds.w, h: rotate ? part.bounds.w : part.bounds.h };
    });
    if (!items.length) return null;
    const area = items.reduce((a, p) => a + (p.w + GAP) * (p.h + GAP), 0);
    const width = Math.max(...items.map(p => p.w), Math.sqrt(area) * 1.25);
    const content = shelves(items, width, GAP);
    return { island, content, w: content.w + INSET * 2, h: content.h + INSET * 2 + HEADER };
  }).filter(g => g !== null);
  if (!groups.length) return { groups: [], placements: [] };
  const area = groups.reduce((sum, g) => sum + (g.w + INSET) * (g.h + INSET), 0);
  const longest = Math.max(...groups.map(g => g.w));
  const candidates = [.8, 1, 1.2, 1.45, 1.8].map(factor => shelves(groups, Math.max(longest, Math.sqrt(area) * factor), INSET));
  const packed = candidates.toSorted((a, b) => Math.max(a.w, a.h) - Math.max(b.w, b.h))[0];
  const extent = Math.max(packed.w, packed.h) + INSET * 2, scale = 1 / extent;
  const left = (extent - packed.w) / 2, top = (extent - packed.h) / 2;
  const result: UvAtlasLayout = { groups: [], placements: [] };
  for (const g of packed.packed) {
    const x = g.x + left, y = g.y + top;
    result.groups.push({ key: g.item.island.key, label: g.item.island.label, x: x * scale, y: y * scale, w: g.item.w * scale, h: g.item.h * scale, header: HEADER * scale });
    for (const entry of g.item.content.packed) {
      const { part, rotate, w, h } = entry.item, bounds = part.bounds;
      const px = x + INSET + entry.x, py = y + HEADER + INSET + entry.y;
      const matrix: UvAtlasPlacement['matrix'] = rotate
        ? [0, scale, -scale, 0, (px + bounds.y + bounds.h) * scale, (py - bounds.x) * scale]
        : [scale, 0, 0, scale, (px - bounds.x) * scale, (py - bounds.y) * scale];
      result.placements.push({ part, matrix, bounds: { x: px * scale, y: py * scale, w: w * scale, h: h * scale } });
    }
  }
  return result;
}

export function atlasPoint(placement: UvAtlasPlacement, source: Point): Point {
  const [a,b,c,d,e,f] = placement.matrix;
  return { x: a * source.x + c * source.y + e, y: b * source.x + d * source.y + f };
}
export function sourceUvPoint(placement: UvAtlasPlacement, point: Point): Point {
  const [a,b,c,d,e,f] = placement.matrix, det = a * d - b * c;
  return { x: (d * (point.x - e) - c * (point.y - f)) / det, y: (-b * (point.x - e) + a * (point.y - f)) / det };
}
export function uvAtlasPath(part: UvPartEntry): string {
  return part.region.polygons.map(poly => `M ${poly.map(p => `${p.x} ${p.y}`).join(' L ')} Z`).join(' ');
}

/** Only texture pixels: guides/labels never enter a layer or exported texture. */
export function drawUvAtlas(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement, layout: UvAtlasLayout) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const placement of layout.placements) {
    ctx.save(); ctx.scale(ctx.canvas.width, ctx.canvas.height); ctx.transform(...placement.matrix);
    ctx.beginPath();
    for (const polygon of placement.part.region.polygons) {
      ctx.moveTo(polygon[0].x, polygon[0].y);
      for (const point of polygon.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
    }
    ctx.clip(placement.part.region.fillRule ?? 'nonzero'); ctx.drawImage(texture, 0, 0, 1, 1); ctx.restore();
  }
}
