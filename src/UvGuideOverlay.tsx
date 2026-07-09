/**
 * Overlay SVG affichant les SILHOUETTES UV PRÉCISES des îlots du mesh Skin
 * (contours réels extraits du FBX, cf. src/uvGuideData.ts) au lieu des simples
 * rectangles de SKIN_REGIONS. Se positionne en absolu sur le cadre du canvas
 * (`.canvas-frame`) et ne capte aucun événement souris (`pointer-events:none`).
 *
 * Drop-in : `<UvGuideOverlay activeMap={activeMap} visible={showGuide} />`
 * à placer à l'intérieur de `.canvas-frame`, après `.canvas-host`.
 */
import { MAP_BY_ID, type MapId } from './maps';
import { UV_GUIDE_BY_FAMILY, type UvGuideIsland } from './uvGuideData';
import './uvGuideOverlay.css';

/** Espace de coordonnées interne du SVG (le cadre est carré : échelle uniforme). */
const VB = 1000;

/** Couleur de contour par pièce (clés identiques à SKIN_REGIONS / DETAILS_REGIONS). */
const COLORS: Record<string, string> = {
  // carrosserie (Skin_01)
  top: '#ff5a5a',
  left: '#3ad884',
  right: '#e0e02a',
  archL: '#4aa0ff',
  archR: '#b45aff',
  front: '#ff9a28',
  rear: '#28dcdc',
  spoiler: '#ff40c8',
  sillL: '#6ae0c8',
  sillR: '#e0a86a',
  shoulderL: '#9a6aff',
  shoulderR: '#ff8060',
  rearLow: '#60b0ff',
  rearSideL: '#c8e040',
  // détails (Details_01) — une couleur par zone sémantique
  d_front: '#ff9a28',
  d_hood: '#ff5a5a',
  d_cockpit: '#b45aff',
  d_wing: '#ff40c8',
  d_rear: '#28dcdc',
  d_side: '#3ad884',
  d_floor: '#e0e02a',
};
const FALLBACK = '#d8dee6';

interface Props {
  /** Map active de l'éditeur ; sa famille (skin/details/wheels) sélectionne les îlots. */
  activeMap: MapId;
  /** Affiche ou masque le guide. */
  visible: boolean;
  /** Îlot mis en avant en mode focus (carrosserie). */
  focusedRegion?: string | null;
}

/** Centre (moyenne des sommets) du plus grand polygone d'un îlot, en unités VB. */
function labelAnchor(island: UvGuideIsland): { x: number; y: number } | null {
  let best: { x: number; y: number }[] | null = null;
  let bestArea = -1;
  for (const poly of island.polygons) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    }
    const area = Math.abs(a) / 2;
    if (area > bestArea) { bestArea = area; best = poly; }
  }
  if (!best || best.length === 0) return null;
  let cx = 0, cy = 0;
  for (const p of best) { cx += p.x; cy += p.y; }
  return { x: (cx / best.length) * VB, y: (cy / best.length) * VB };
}

export function UvGuideOverlay({ activeMap, visible, focusedRegion = null }: Props) {
  if (!visible) return null;
  const family = MAP_BY_ID[activeMap].group;
  const islands = UV_GUIDE_BY_FAMILY[family];
  if (!islands || islands.length === 0) return null;

  return (
    <svg
      className="uv-guide-overlay"
      viewBox={`0 0 ${VB} ${VB}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {islands.map((island) => {
        const color = COLORS[island.key] ?? FALLBACK;
        const anchor = labelAnchor(island);
        const focused = focusedRegion === island.key;
        const dimmed = focusedRegion != null && !focused;
        return (
          <g
            key={island.key}
            className={
              focused ? 'uv-guide-overlay__group--focused' : dimmed ? 'uv-guide-overlay__group--dimmed' : undefined
            }
          >
            {island.polygons.map((poly, i) => (
              <polygon
                key={i}
                className={`uv-guide-overlay__poly${focused ? ' uv-guide-overlay__poly--focused' : ''}`}
                points={poly.map((p) => `${(p.x * VB).toFixed(1)},${(p.y * VB).toFixed(1)}`).join(' ')}
                stroke={color}
                fill={color}
              />
            ))}
            {anchor && (
              <text
                className={`uv-guide-overlay__label${focused ? ' uv-guide-overlay__label--focused' : ''}`}
                x={anchor.x}
                y={anchor.y}
                fill={color}
              >
                {island.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default UvGuideOverlay;
