import type { UvGuideIsland } from './uvGuideData';
import { WHEEL_TREAD_UV } from './wheelTreads';

const band = (key: string, label: string, x: number, right: number): UvGuideIsland => ({ key, label, family: 'wheels', polygons: [[{ x, y: 0 }, { x: right, y: 0 }, { x: right, y: 1 }, { x, y: 1 }]] });
/** Named work zones in the unchanged official tyre atlas. */
export const WHEEL_PART_GUIDES = [
  band('tyres:tread', 'PNEU · BANDE DE ROULEMENT', WHEEL_TREAD_UV.minU, WHEEL_TREAD_UV.maxU),
  band('tyres:outer', 'PNEU · FLANC EXTÉRIEUR', WHEEL_TREAD_UV.maxU, 1),
  band('tyres:inner', 'PNEU · FLANC INTÉRIEUR', 0, WHEEL_TREAD_UV.minU),
];
