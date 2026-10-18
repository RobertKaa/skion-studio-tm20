/**
 * Overlay SVG affichant les SILHOUETTES UV PRÉCISES des îlots du mesh Skin
 * (contours réels extraits du FBX, cf. src/uvGuideData.ts) au lieu des simples
 * rectangles de SKIN_REGIONS. Se positionne en absolu sur le cadre du canvas
 * (`.canvas-frame`) et ne capte aucun événement souris (`pointer-events:none`).
 *
 * Drop-in : `<UvGuideOverlay activeMap={activeMap} visible={showGuide} />`
 * à placer à l'intérieur de `.canvas-frame`, après `.canvas-host`.
 */
import type { CSSProperties } from 'react';
import { MAP_BY_ID, type MapId } from './maps';
import { UV_GUIDE_BY_FAMILY, type UvGuideIsland } from './uvGuideData';
import './uvGuideOverlay.css';
import type { UvAtlasLayout } from './uvAtlasLayout';

/** Espace de coordonnées interne du SVG (le cadre est carré : échelle uniforme). */
const VB = 1000;

/** Couleur de contour par pièce (clés identiques à SKIN_REGIONS / DETAILS_REGIONS). */
const COLORS: Record<string, string> = {
  // carrosserie (Skin_01) — palette désaturée pour rester lisible sans crier
  top: '#f08a8a',
  fuelCap: '#f2cb82',
  left: '#7fd6a6',
  right: '#dcd67a',
  archL: '#86b6f0',
  archR: '#c39cf0',
  front: '#f0b878',
  rear: '#7fd6d6',
  spoiler: '#f08ad2',
  sillL: '#9ad9cc',
  sillR: '#dcbb96',
  shoulderL: '#b39cf0',
  shoulderR: '#f0a48f',
  rearLow: '#94c3f0',
  rearSideL: '#d0dd8a',
  // détails — une couleur par face réelle (normale du mesh)
  d_tail_hi: '#ff5a78',
  d_tail: '#ff9a55',
  d_head: '#ffe14a',
  d_front: '#f0b878',
  d_hood: '#f08a8a',
  d_cockpit: '#c39cf0',
  d_wing: '#f08ad2',
  d_rear: '#7fd6d6',
  d_side_l: '#7fd6a6',
  d_side_r: '#9ddeb8',
  d_floor: '#dcd67a',
  d_body: '#8ec5f0',
};
const LAMP_KEYS = new Set(['d_tail_hi', 'd_tail', 'd_head']);
const FALLBACK = '#c9ced8';

interface Props {
  atlas?:UvAtlasLayout;
  /** Map active de l'éditeur ; sa famille (skin/details/wheels) sélectionne les îlots. */
  activeMap: MapId;
  /** Affiche ou masque le guide. */
  visible: boolean;
  /** Îlot mis en avant en mode focus (carrosserie). */
  focusedRegion?: string | null;
  islands?: UvGuideIsland[];
  selectedRegion?: string | null;
  onSelect?: (key: string) => void;
  selectedElement?: UvGuideIsland | null;
  zoom?: number;
}

function polyArea(poly: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a) / 2;
}

/** Centre (moyenne des sommets) d'un polygone, en unités VB. */
function polyAnchor(poly: { x: number; y: number }[]): { x: number; y: number } | null {
  if (poly.length === 0) return null;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: (cx / poly.length) * VB, y: (cy / poly.length) * VB };
}

/**
 * Libellés à dessiner. Sur le néon, chaque îlot de feu/phare assez gros a le
 * sien, sauf s'il collerait à un libellé déjà posé. Ailleurs, un seul libellé
 * par zone, sur le plus grand îlot.
 */
function labelSpots(
  islands: UvGuideIsland[],
  lampsOnly: boolean,
): { key: string; label: string; x: number; y: number; color: string }[] {
  const candidates: { key: string; label: string; x: number; y: number; color: string; area: number }[] = [];
  for (const island of islands) {
    const color = COLORS[island.key] ?? FALLBACK;
    const ranked = island.polygons
      .map((poly) => ({ poly, area: polyArea(poly) }))
      .sort((a, b) => b.area - a.area);
    const keep = lampsOnly
      ? LAMP_KEYS.has(island.key)
        ? ranked.filter((p) => p.area >= 0.00035)
        : []
      : ranked.slice(0, 1);
    for (const { poly, area } of keep) {
      const anchor = polyAnchor(poly);
      if (!anchor) continue;
      const label = lampsOnly && LAMP_KEYS.has(island.key)
        ? ({ d_tail_hi: 'FEU HAUT', d_tail: 'FEU', d_head: 'PHARE' } as Record<string, string>)[island.key]
        : island.key === 'fuelCap' ? 'BOUCHON' : island.label;
      candidates.push({ key: island.key, label, ...anchor, color, area });
    }
  }
  candidates.sort((a, b) => b.area - a.area);
  const placed: { x: number; y: number }[] = [];
  const minDist = lampsOnly ? 180 : 28;
  const out: { key: string; label: string; x: number; y: number; color: string }[] = [];
  for (const c of candidates) {
    if (placed.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < minDist)) continue;
    placed.push(c);
    out.push(c);
  }
  return out;
}

export function UvGuideOverlay({ activeMap, visible, focusedRegion = null, islands: providedIslands, selectedRegion, selectedElement, onSelect, zoom = 1, atlas }: Props) {
  if (!visible) return null;
  const mapDef = MAP_BY_ID[activeMap];
  const family = mapDef.group;
  const islands = providedIslands ?? UV_GUIDE_BY_FAMILY[family];
  if (!islands || islands.length === 0) return null;
  const lampsOnly = mapDef.kind === 'illum';
  // Isolation can target a single contour; highlight its named zone as well.
  const focusedKey = focusedRegion?.split(':element:')[0] ?? null;
  const spots = atlas?[]:labelSpots(islands, lampsOnly).filter((spot) => !focusedKey || spot.key === focusedKey);

  return (
    <svg
      className="uv-guide-overlay"
      style={{ '--uv-guide-zoom': Number.isFinite(zoom) ? Math.max(.1, zoom) : 1 } as CSSProperties}
      viewBox={`0 0 ${VB} ${VB}`}
      preserveAspectRatio="none"
      aria-hidden={onSelect ? undefined : true}
    >
      {atlas?.groups.map(group=><g key={`frame:${group.key}`} className="uv-guide-overlay__atlas-frame">
        <rect x={group.x*VB} y={group.y*VB} width={group.w*VB} height={group.h*VB} rx={3} fill="none" stroke="#d6e7e0" strokeOpacity={.35} strokeWidth={.6}/>
        <svg x={(group.x+.003)*VB} y={(group.y+.001)*VB} width={(group.w-.006)*VB} height={group.header*VB} overflow="hidden"><text x={3} y="55%" dominantBaseline="middle" fill="#e7fff7" fontSize={Math.min(11,group.header*VB*.7)} fontWeight={600} fontFamily="Segoe UI, sans-serif">{group.label}</text></svg>
      </g>)}
      {islands.map((island) => {
        const color = COLORS[island.key] ?? FALLBACK;
        const focused = focusedKey === island.key || selectedRegion === island.key;
        const dimmed = focusedRegion != null && !focused;
        const quiet = lampsOnly && !LAMP_KEYS.has(island.key);
        const lamp = lampsOnly && LAMP_KEYS.has(island.key);
        return (
          <g
            key={island.key}
            role={onSelect ? 'button' : undefined}
            aria-label={onSelect ? `Sélectionner la zone ${island.label}` : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(island.key); } } : undefined}
            className={
              focused ? 'uv-guide-overlay__group--focused' : dimmed || quiet ? 'uv-guide-overlay__group--dimmed' : undefined
            }
          >
            {island.fillRule === 'evenodd' ? <path
              className={`uv-guide-overlay__poly${focused ? ' uv-guide-overlay__poly--focused' : ''}`}
              d={island.polygons.map((poly) => `M ${poly.map((p) => `${p.x * VB},${p.y * VB}`).join(' L ')} Z`).join(' ')}
              fillRule="evenodd" stroke={color} fill={color}
            /> : island.polygons.map((poly, i) => (
              <polygon
                key={i}
                className={`uv-guide-overlay__poly${focused ? ' uv-guide-overlay__poly--focused' : ''}${lamp ? ' uv-guide-overlay__poly--lamp' : ''}`}
                points={poly.map((p) => `${(p.x * VB).toFixed(1)},${(p.y * VB).toFixed(1)}`).join(' ')}
                stroke={color}
                fill={color}
              />
            ))}
          </g>
        );
      })}
      {selectedElement && <path className="uv-guide-overlay__element" fillRule={selectedElement.fillRule ?? 'nonzero'} d={selectedElement.polygons.map((poly) => `M ${poly.map((p) => `${p.x * VB},${p.y * VB}`).join(' L ')} Z`).join(' ')} />}
      {spots.map((spot, i) => (
        <text
          key={`${spot.key}-${i}`}
          className={`uv-guide-overlay__label${focusedKey === spot.key ? ' uv-guide-overlay__label--focused' : ''}${lampsOnly ? ' uv-guide-overlay__label--lamp' : ''}`}
          x={spot.x}
          y={spot.y}
          fill={spot.color}
        >
          {spot.label}
        </text>
      ))}
    </svg>
  );
}

export default UvGuideOverlay;
