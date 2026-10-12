import type { UvGuideIsland } from './uvGuideData';

/**
 * Bouchon intégré au panneau « top » du Stadium CAR2020 : son contour n'est
 * pas une frontière UV. Ces 32 sommets suivent la cassure de normales dans
 * le creux du joint de Skin_01 (StadiumCAR2020_OffsetFix.fbx), en UV éditeur.
 * Conserver le panneau parent permet de repeindre la carrosserie entière ;
 * cette sous-zone donne aussi accès au bouchon seul, sans cercle approximatif.
 */
export const FUEL_CAP_UV_GUIDE: UvGuideIsland = {
  key: 'fuelCap',
  label: 'BOUCHON DE RÉSERVOIR',
  family: 'skin',
  polygons: [[
    { x: 0.652875, y: 0.199052 },
    { x: 0.653121, y: 0.196442 },
    { x: 0.653847, y: 0.193931 },
    { x: 0.655044, y: 0.191615 },
    { x: 0.656687, y: 0.189588 },
    { x: 0.658704, y: 0.187929 },
    { x: 0.661004, y: 0.1867 },
    { x: 0.663499, y: 0.185954 },
    { x: 0.666093, y: 0.185726 },
    { x: 0.668682, y: 0.186022 },
    { x: 0.67116, y: 0.186823 },
    { x: 0.673431, y: 0.188096 },
    { x: 0.675412, y: 0.189788 },
    { x: 0.677033, y: 0.19183 },
    { x: 0.678245, y: 0.19414 },
    { x: 0.679009, y: 0.196635 },
    { x: 0.679296, y: 0.19923 },
    { x: 0.679086, y: 0.20183 },
    { x: 0.678372, y: 0.204337 },
    { x: 0.677174, y: 0.206653 },
    { x: 0.675537, y: 0.208684 },
    { x: 0.673526, y: 0.210347 },
    { x: 0.671223, y: 0.211577 },
    { x: 0.668719, y: 0.212321 },
    { x: 0.666115, y: 0.212548 },
    { x: 0.663519, y: 0.212248 },
    { x: 0.661034, y: 0.211441 },
    { x: 0.658739, y: 0.210176 },
    { x: 0.656713, y: 0.208508 },
    { x: 0.655053, y: 0.206486 },
    { x: 0.653842, y: 0.204174 },
    { x: 0.653114, y: 0.201663 },
  ]],
};
