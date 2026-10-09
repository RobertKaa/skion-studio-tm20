/** Original editable vector artwork. Coordinates: front→rear, bottom→top. */
export type MotifPoint = { x: number; y: number };
export type MotifPolygon = MotifPoint[];
const points = (values: number[][]): MotifPolygon => values.map(([x, y]) => ({ x, y }));

/** Long interlocking barbs, with hooked ends and intentional negative space. */
export function tribalMotif(variant: number): MotifPolygon[] {
  if (variant === 1) return [
    // Mechanical dragon: snout, swept horns, jaw, sinuous spine and tail.
    points([[.12,.51],[.21,.70],[.25,.73],[.20,.88],[.32,.79],[.37,.68],[.49,.73],[.62,.67],[.70,.75],[.86,.79],[.78,.69],[.94,.62],[.79,.60],[.67,.56],[.76,.49],[.89,.50],[.77,.38],[.65,.43],[.53,.59],[.40,.60],[.33,.54],[.27,.55],[.30,.45],[.20,.48],[.16,.54]]),
    points([[.35,.57],[.42,.48],[.38,.36],[.48,.43],[.57,.51],[.64,.43],[.70,.31],[.61,.35],[.52,.40],[.47,.34],[.53,.29],[.40,.32],[.31,.44]]),
    points([[.48,.76],[.56,.83],[.59,.76],[.68,.84],[.74,.83],[.65,.71],[.59,.73]]),
  ];
  if (variant === 2) return [
    points([[.09,.40],[.27,.53],[.37,.72],[.34,.82],[.49,.74],[.56,.58],[.78,.56],[.93,.66],[.79,.47],[.56,.48],[.47,.56],[.40,.58],[.33,.42]]),
    points([[.15,.64],[.29,.72],[.39,.63],[.54,.32],[.70,.27],[.58,.41],[.55,.59],[.68,.69],[.84,.75],[.68,.77],[.54,.68],[.44,.50],[.36,.49],[.26,.61]]),
    points([[.24,.32],[.34,.38],[.40,.51],[.38,.42],[.47,.29],[.37,.34]]),
  ];
  return [
    points([[.09,.49],[.30,.61],[.41,.78],[.38,.87],[.52,.75],[.62,.65],[.85,.73],[.94,.79],[.83,.62],[.62,.56],[.48,.62],[.37,.54],[.25,.52]]),
    points([[.16,.36],[.35,.43],[.51,.61],[.61,.53],[.77,.49],[.91,.54],[.80,.39],[.58,.44],[.47,.52],[.35,.37]]),
    points([[.39,.28],[.51,.35],[.59,.47],[.75,.37],[.87,.39],[.73,.28],[.59,.34],[.52,.28]]),
  ];
}

/** Smooth flame tongues, sampled as curves so they stay editable polygons. */
export function flameMotif(variant: number): MotifPolygon[] {
  const out: MotifPolygon[] = [];
  for (let row = 0; row < 3; row++) {
    const y = .32 + row * .17;
    const center: MotifPoint[] = [];
    const end = .88 - row * .065 + variant * .013;
    for (let i = 0; i <= 36; i++) {
      const t = i / 36;
      center.push({ x: .13 + (end - .13) * t, y: y + Math.sin(t * Math.PI * (1.3 + variant * .2)) * (.075 + row*.01) + t * .025 });
    }
    const upper = center.map((p, i) => ({ x: p.x, y: p.y + .038 * Math.pow(1-i/36, .62) }));
    const lower = center.map((p, i) => ({ x: p.x, y: p.y - .033 * Math.pow(1-i/36, .62) }));
    out.push([...upper, ...lower.reverse()]);
    const fork = center[20];
    out.push(points([[fork.x-.08,fork.y+.024],[fork.x+.07,fork.y+.085],[fork.x+.10,fork.y+.14],[fork.x+.16,fork.y+.13],[fork.x+.10,fork.y+.085],[fork.x+.04,fork.y+.035],[fork.x-.025,fork.y-.01]]));
  }
  return out;
}

/** Jagged, torn chrome stripes inspired by period show-car vinyls. */
export function tornMotif(variant: number): MotifPolygon[] {
  return Array.from({ length: variant === 2 ? 4 : 3 }, (_, row) => {
    const y = .32 + row * .125;
    const upper: MotifPoint[] = [], lower: MotifPoint[] = [];
    const count = 24;
    for (let i = 0; i <= count; i++) {
      const t = i/count, x = .12 + .79*t;
      const center = y + .12*t + .025*Math.sin(t*6 + row);
      const edge = (i % 4 === 1 ? .024 : i % 4 === 3 ? -.01 : 0);
      const width = .032*Math.sin(Math.PI*t) + .004;
      upper.push({ x, y: center + width + edge });
      lower.push({ x, y: center - width + edge*.3 });
    }
    return [...upper, ...lower.reverse()];
  });
}

export function transformMotif(polys: MotifPolygon[], fn: (p: MotifPoint) => MotifPoint): MotifPolygon[] {
  return polys.map((poly) => poly.map(fn));
}

/** Two parallel edges of a continuous ribbon. */
export function ribbon(points: MotifPoint[], width: number): MotifPolygon {
  return [...points.map((p) => ({x:p.x,y:p.y+width/2})), ...points.map((p) => ({x:p.x,y:p.y-width/2})).reverse()];
}
