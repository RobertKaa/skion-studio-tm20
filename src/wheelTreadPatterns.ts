import type { WheelTreadPresetMode } from './wheelTreads';

export type TreadPoint = readonly [number, number];
export interface TreadStroke {
  points: readonly TreadPoint[];
  width: number;
  endWidth?: number;
  depth: number;
  bevel?: number;
}
export interface TreadBlock { points: readonly TreadPoint[]; bevel?: number }
export interface TreadPattern { strokes: TreadStroke[]; blocks?: TreadBlock[]; depth: number }

const WIDTH = .283, CIRCUMFERENCE = 2.289;
const DEPTH: Record<WheelTreadPresetMode, number> = {
  'semi-slick': .0052, road: .0075, rain: .009, gravel: .0105,
  touring: .008, winter: .0095, mud: .014, classic: .0065,
};
type Pitch = { y: number; length: number; index: number };

/** A closed mould sequence with several actual block lengths, not a sine-wave grid. */
function pitches(count: number): Pitch[] {
  const sizes = [1, .86, 1.12, .94, 1.06, .89, 1.16, .97, 1.09, .92, 1.03];
  const weights = Array.from({ length: count }, (_, index) => sizes[(index * 7 + Math.floor(index / 9) * 3) % sizes.length]);
  const scale = CIRCUMFERENCE / weights.reduce((sum, value) => sum + value, 0);
  let y = 0;
  return weights.map((weight, index) => { const length = weight * scale, row = { y, length, index }; y += length; return row; });
}

/** X is a fraction of physical tread width; Y is a fraction of this mould pitch. */
function at(row: Pitch, points: readonly TreadPoint[]): TreadPoint[] {
  return points.map(([x, y]) => [x * WIDTH, row.y + y * row.length]);
}
function mirrored(points: readonly TreadPoint[]): TreadPoint[] {
  return points.map(([x, y]) => [1 - x, y]);
}
function bezier(points: readonly TreadPoint[], steps = 8): TreadPoint[] {
  const [a, b, c, d] = points;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps, s = 1 - t;
    return [s ** 3 * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t ** 3 * d[0],
      s ** 3 * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t ** 3 * d[1]];
  });
}

/**
 * Original geometry informed by manufacturer tread photographs, without logos.
 * A052: https://www.y-yokohama.com/global/product/tire/tires/passenger/advan_a052/
 * PS4S: https://www.michelinman.com/auto/tires/michelin-pilot-sport-4-s
 * RW/K: https://www.pirelli.com/tyres/en-gb/motorsport/car/rally/catalog
 * Winter: https://www.michelinman.com/auto/tires/michelin-x-ice-snow
 * Mud: https://www.bfgoodrich.co.th/auto/tyres/bfgoodrich-mud-terrain-t-a-km3
 * Touring: https://www.michelinman.com/auto/tires/michelin-defender2
 * Classic: https://www.michelin.fr/classic/tyres/michelin-xas
 * Lengths are metres; all generated cuts have recessed floors and narrow bevels.
 */
export function createWheelTreadPattern(mode: WheelTreadPresetMode): TreadPattern {
  if (!Object.hasOwn(DEPTH, mode)) throw new Error('Profil de pneu inconnu.');
  const pattern: TreadPattern = { strokes: [], depth: DEPTH[mode] };
  const cut = (points: readonly TreadPoint[], width: number, depth = pattern.depth, endWidth?: number, bevel = .00055) => {
    pattern.strokes.push({ points, width, depth, bevel, ...(endWidth === undefined ? {} : { endWidth }) });
  };
  const slot = (row: Pitch, points: readonly TreadPoint[], width: number, depth = pattern.depth, endWidth?: number, bevel = .00055) =>
    cut(at(row, points), width, depth, endWidth, bevel);
  const curved = (row: Pitch, points: readonly TreadPoint[], width: number, depth = pattern.depth, endWidth?: number, bevel = .00055) =>
    cut(bezier(at(row, points)), width, depth, endWidth, bevel);
  const channel = (x: number, width: number, depth = pattern.depth, bevel = .00055) =>
    cut([[x * WIDTH, 0], [x * WIDTH, CIRCUMFERENCE]], width, depth, undefined, bevel);
  const block = (row: Pitch, points: readonly TreadPoint[], bevel = .0007) => {
    (pattern.blocks ??= []).push({ points: at(row, points), bevel });
  };

  if (mode === 'semi-slick') {
    // Two principal drainage channels on the inside, a very thin outside cut,
    // and a broad outside contact land. Small cuts die within their own ribs.
    channel(.275, .0082); channel(.465, .0096); channel(.685, .0021, .0029, .00028);
    for (const row of pitches(46)) {
      curved(row, [[-.008, .08], [.065, .10], [.15, .24], [.215, .30]], .0037, .0046, .0010);
      slot(row, [[.293, .53], [.365, .38], [.407, .35]], .0025, .0038, .00025, .00038);
      slot(row, [[.485, .18], [.548, .35], [.593, .36]], .0019, .0029, .0003, .00028);
      // The large outer land remains solid apart from short cooling pockets.
      if (row.index % 2 === 0) curved(row, [[.758, .73], [.815, .76], [.867, .84], [.912, .89]], .0020, .0027, .0005, .00030);
      slot(row, [[.990, .18], [.942, .24]], .0016, .0021, .0002, .00026);
    }
  } else if (mode === 'road') {
    // Five unequal, mostly continuous ribs. Tapered blind pockets distinguish
    // a high-performance road mould from a tiled rectangular block texture.
    channel(.233, .0100); channel(.410, .0114); channel(.584, .0107); channel(.758, .0091);
    for (const row of pitches(62)) {
      curved(row, [[.008, .12], [.065, .11], [.145, .31], [.214, .42]], .0050, .0065, .0003);
      slot(row, [[.254, .67], [.317, .44], [.369, .32]], .0030, .0043, .0001, .00035);
      slot(row, [[.431, .19], [.482, .38], [.536, .51]], .0028, .0042, .0001, .00035);
      curved(row, [[.606, .80], [.640, .70], [.694, .63], [.729, .61]], .0033, .0047, .0001, .0004);
      curved(row, [[.784, .37], [.844, .17], [.925, .13], [.987, .23]], .0047, .0059, .0004);
      if (row.index % 2 === 0) {
        curved(row, [[.008, .63], [.086, .59], [.155, .69], [.213, .75]], .00065, .0017, undefined, .00018);
        curved(row, [[.783, .88], [.859, .80], [.936, .81], [.997, .94]], .00065, .0017, undefined, .00018);
      }
    }
  } else if (mode === 'rain') {
    // Three deep longitudinal channels connect wide sweeping transverse
    // outlets. The centre forms a rounded directional V, as on full-wet tyres.
    channel(.278, .0128); channel(.500, .0116); channel(.722, .0128);
    for (const row of pitches(43)) {
      curved(row, [[-.015, .02], [.16, -.02], [.325, .39], [.500, .68]], .0110, .009, .0093, .0007);
      curved(row, [[1.015, .02], [.84, -.02], [.675, .39], [.500, .68]], .0110, .009, .0093, .0007);
      // Narrow supplementary inner cuts do not cross the load-bearing blocks.
      slot(row, [[.319, .76], [.383, .88]], .0009, .0023, .0004, .00022);
      slot(row, [[.681, .76], [.617, .88]], .0009, .0023, .0004, .00022);
    }
  } else if (mode === 'touring') {
    // A quiet touring design has a continuous middle rib, hooked shoulder
    // channels, and multiple very fine zigzag sipes rather than large open cuts.
    channel(.277, .0093); channel(.421, .0096); channel(.579, .0096); channel(.723, .0093);
    for (const row of pitches(57)) {
      curved(row, [[.276, .18], [.187, .12], [.086, -.02], [.016, .18]], .0043, .0069, .0021);
      slot(row, [[.016, .18], [.020, .48], [.060, .54]], .0021, .0045, .0003, .00035);
      curved(row, [[.724, .68], [.813, .62], [.914, .48], [.984, .68]], .0043, .0069, .0021);
      slot(row, [[.984, .68], [.980, .98], [.940, 1.04]], .0021, .0045, .0003, .00035);
      slot(row, [[.294, .49], [.342, .64], [.399, .80]], .0022, .0047, .0004, .00035);
      slot(row, [[.601, .20], [.658, .04], [.706, -.11]], .0022, .0047, .0004, .00035);
      for (const offset of [.10, .38, .67]) {
        slot(row, [[.440, offset + .20], [.457, offset + .15], [.466, offset + .19], [.486, offset + .11], [.496, offset + .14], [.516, offset + .06], [.527, offset + .10], [.558, offset]], .00060, .0024, undefined, .00017);
        slot(row, [[.297, offset + .05], [.323, offset + .13], [.335, offset + .10], [.364, offset + .18], [.377, offset + .15], [.401, offset + .22]], .00058, .0022, undefined, .00017);
        slot(row, [[.599, offset + .56], [.623, offset + .49], [.636, offset + .52], [.665, offset + .44], [.677, offset + .47], [.703, offset + .39]], .00058, .0022, undefined, .00017);
      }
      slot(row, [[.072, .74], [.111, .69], [.130, .72], [.159, .67], [.180, .71], [.208, .67], [.253, .73]], .00065, .0021, undefined, .00018);
      slot(row, [[.747, .23], [.792, .17], [.820, .21], [.841, .17], [.870, .22], [.889, .19], [.928, .24]], .00065, .0021, undefined, .00018);
    }
  } else if (mode === 'classic') {
    // Period-correct zigzag ribs: angular mould lines, small lateral notches,
    // and visibly narrower ribs than a modern highway tyre.
    const rows = pitches(64);
    for (let rib = 0; rib < 5; rib++) {
      const x = .116 + rib * .192, sign = rib % 2 ? -1 : 1;
      const path: TreadPoint[] = [];
      for (const row of rows) path.push(...at(row, [[x, 0], [x + sign * .023, .25], [x - sign * .013, .63], [x, 1]]));
      cut(path, rib === 2 ? .0050 : .0043, pattern.depth, undefined, .00045);
    }
    for (const row of rows) {
      slot(row, [[-.01, .37], [.065, .57], [.101, .58]], .0017, .0038, .0007, .00030);
      slot(row, [[1.01, .81], [.948, .61], [.907, .60]], .0017, .0038, .0007, .00030);
      for (let rib = 0; rib < 4; rib++) {
        const x = .147 + rib * .192;
        slot(row, [[x, .24], [x + .044, .42], [x + .069, .40]], .00075, .0022, .0002, .00022);
      }
    }
  } else if (mode === 'winter') {
    // Discrete interlocking chevrons and stepped shoulder blocks. Each snow
    // block carries its own shallow zigzag sipes, never an atlas-wide hatch.
    for (const row of pitches(49)) {
      const centre: TreadPoint[] = [[.267, .77], [.488, .08], [.488, .88], [.435, 1.04], [.267, 1.57]];
      const shoulder: TreadPoint[] = [[.004, .48], [.134, .38], [.239, .76], [.245, 1.54], [.137, 1.17], [.004, 1.28]];
      block(row, centre, .00065); block(row, mirrored(centre), .00065);
      block(row, shoulder, .00075); block(row, mirrored(shoulder), .00075);
      for (const offset of [.12, .31, .50, .69]) {
        const sipe: TreadPoint[] = [[.285, .73 + offset], [.314, .63 + offset], [.327, .65 + offset], [.354, .51 + offset], [.371, .51 + offset], [.400, .38 + offset], [.416, .39 + offset], [.445, .24 + offset], [.474, .19 + offset]];
        slot(row, sipe, .00065, .0045, undefined, .00018);
        slot(row, mirrored(sipe), .00065, .0045, undefined, .00018);
      }
      for (const offset of [.20, .47, .72]) {
        const sipe: TreadPoint[] = [[.025, .55 + offset], [.067, .51 + offset], [.096, .55 + offset], [.122, .52 + offset], [.151, .61 + offset], [.180, .68 + offset], [.216, .79 + offset]];
        slot(row, sipe, .00062, .0043, undefined, .00018);
        slot(row, mirrored(sipe), .00062, .0043, undefined, .00018);
      }
    }
  } else if (mode === 'gravel') {
    // Rally gravel differs from mud terrain: tighter asymmetric block rows,
    // interlocking bent lugs inside, small shoulder blocks and blind centres.
    const rallyLug = (row: Pitch, points: readonly TreadPoint[], bevel: number) => {
      const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
      // Rally blocks retain a dense contact patch. Increasing only their depth
      // would leave the sparse, disconnected footprint of a mud-terrain tyre.
      const verticalScale = Math.min(1.36, .90 / (maxY - minY));
      block(row, points.map(([x, y]) => [Math.max(.001, Math.min(.999, centerX + (x - centerX) * 1.17)), centerY + (y - centerY) * verticalScale]), bevel);
    };
    for (const row of pitches(43)) {
      rallyLug(row, [[.004, .07], [.083, .08], [.170, .28], [.190, .51], [.131, .66], [.004, .50]], .0008);
      rallyLug(row, [[.209, .18], [.300, .43], [.394, .18], [.425, .37], [.316, .78], [.219, .60]], .00075);
      rallyLug(row, [[.443, .22], [.492, .12], [.625, .34], [.617, .83], [.556, .91], [.444, .72]], .00075);
      rallyLug(row, [[.659, .03], [.788, .10], [.793, .57], [.672, .64]], .0007);
      rallyLug(row, [[.827, .27], [.994, .14], [.997, .75], [.908, .87], [.826, .72]], .0008);
      slot(row, [[.029, .29], [.102, .34], [.143, .43]], .0014, .0046, undefined, .00028);
      slot(row, [[.241, .40], [.304, .56], [.383, .35]], .0014, .0046, undefined, .00028);
      slot(row, [[.483, .34], [.572, .48], [.574, .69]], .0016, .0047, undefined, .00028);
      slot(row, [[.724, .19], [.725, .44]], .0018, .0048, undefined, .0003);
      slot(row, [[.888, .49], [.947, .44]], .0018, .0048, undefined, .0003);
    }
  } else {
    // Mud terrain uses much larger, sparse polygonal lugs. Central blocks
    // stagger by half a pitch; wide, connected voids remain between the rows.
    for (const row of pitches(28)) {
      block(row, [[.003, .04], [.169, .02], [.249, .18], [.256, .58], [.201, .72], [.120, .67], [.003, .86]], .0010);
      block(row, [[.284, .30], [.382, .25], [.483, .44], [.481, .97], [.419, 1.08], [.295, .92]], .0009);
      block(row, [[.520, -.16], [.618, -.29], [.712, -.05], [.709, .46], [.657, .58], [.534, .43]], .0009);
      block(row, [[.747, .46], [.807, .30], [.892, .36], [.997, .15], [.997, .98], [.835, 1.03], [.747, .87]], .0010);
      slot(row, [[.028, .30], [.095, .25], [.173, .34], [.201, .43]], .0025, .0062, .0010, .0004);
      slot(row, [[.799, .71], [.856, .79], [.919, .69], [.974, .63]], .0025, .0062, .0010, .0004);
      slot(row, [[.335, .48], [.394, .55], [.436, .76]], .0017, .0056, .0007, .00035);
      slot(row, [[.557, .02], [.613, .08], [.658, .29]], .0017, .0056, .0007, .00035);
    }
  }
  return pattern;
}
