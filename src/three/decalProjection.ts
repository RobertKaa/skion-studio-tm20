import type { MapDef } from '../maps';
import type { SurfaceMaterial } from '../material';

export type Vec3 = [number, number, number];
export type DecalFamily = MapDef['group'];
export interface SurfaceAnchor { point: Vec3; normal: Vec3; tangent: Vec3 }
export interface DecalProjection {
  source: string;
  center: Vec3;
  normal: Vec3;
  tangent: Vec3;
  width: number;
  height: number;
  depth: number;
  angle: number;
  families: DecalFamily[];
  material?: SurfaceMaterial;
}
export interface ProjectionTriangle {
  family: DecalFamily;
  points: [Vec3, Vec3, Vec3];
  uv: [[number, number], [number, number], [number, number]];
}
export interface PixelSource { width: number; height: number; data: Uint8ClampedArray }
export interface ProjectionBitmap { width: number; height: number; data: Uint8ClampedArray; triangles: number }

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const n = Math.hypot(...a) || 1; return a.map((v) => v / n) as Vec3; };

/** Transport de l'axe de l'image sur la nouvelle surface, sans saut de rotation aux coutures UV. */
export function moveProjection(decal: DecalProjection, anchor: SurfaceAnchor): DecalProjection {
  const normal = unit(anchor.normal);
  const along = dot(decal.tangent, normal);
  let tangent = decal.tangent.map((v, i) => v - normal[i] * along) as Vec3;
  if (Math.hypot(...tangent) < .05) tangent = anchor.tangent;
  return { ...decal, center: [...anchor.point], normal, tangent: unit(tangent) };
}

function walkTriangle(points: [number, number][], w: number, h: number, visit: (x: number, y: number, a: number, b: number, c: number) => void) {
  const [p, q, r] = points;
  const determinant = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
  if (Math.abs(determinant) < 1e-10) return;
  const x0 = Math.max(0, Math.floor(Math.min(p[0], q[0], r[0])));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(p[0], q[0], r[0])));
  const y0 = Math.max(0, Math.floor(Math.min(p[1], q[1], r[1])));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(p[1], q[1], r[1])));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const a = ((q[1] - r[1]) * (x + .5 - r[0]) + (r[0] - q[0]) * (y + .5 - r[1])) / determinant;
    const b = ((r[1] - p[1]) * (x + .5 - r[0]) + (p[0] - r[0]) * (y + .5 - r[1])) / determinant;
    const c = 1 - a - b;
    if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) visit(x, y, a, b, c);
  }
}

/** Projection orthographique dans les atlas existants. Aucun nouveau mesh n'est requis par le jeu. */
export function bakeProjection(triangles: ProjectionTriangle[], decal: DecalProjection, source: PixelSource, resolution = 1024): Map<DecalFamily, ProjectionBitmap> {
  const output = new Map<DecalFamily, ProjectionBitmap>();
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > 2048 ||
    !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1 ||
    source.width * source.height > 32 * 1024 * 1024 || source.data.length < source.width * source.height * 4) return output;
  if (![decal.width, decal.height, decal.depth, ...decal.center, ...decal.normal, ...decal.tangent, decal.angle].every(Number.isFinite) ||
    decal.width <= 0 || decal.height <= 0 || decal.depth <= 0 || source.width <= 0 || source.height <= 0 || resolution < 1) return output;
  const normal = unit(decal.normal);
  const tangent = unit(decal.tangent);
  const up = unit(cross(normal, tangent));
  const angle = decal.angle * Math.PI / 180;
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  const right = tangent.map((v, i) => v * cos + up[i] * sin) as Vec3;
  const top = up.map((v, i) => v * cos - tangent[i] * sin) as Vec3;
  const candidates = triangles.flatMap((triangle) => {
    if (!decal.families.includes(triangle.family)) return [];
    const face = unit(cross(sub(triangle.points[1], triangle.points[0]), sub(triangle.points[2], triangle.points[0])));
    if (dot(face, normal) <= 1e-5) return []; // Seules les faces arrière ou exactement de profil sont exclues.
    const local = triangle.points.map((p) => {
      const delta = sub(p, decal.center);
      return [dot(delta, right) / decal.width + .5, .5 - dot(delta, top) / decal.height, dot(delta, normal)] as Vec3;
    });
    if ([0, 1].some((axis) => Math.max(...local.map((p) => p[axis])) < 0 || Math.min(...local.map((p) => p[axis])) > 1) ||
      Math.max(...local.map((p) => p[2])) < -decal.depth / 2 || Math.min(...local.map((p) => p[2])) > decal.depth / 2) return [];
    const [p, q, r] = local;
    const determinant = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    if (Math.abs(determinant) < 1e-12) return [];
    return [{ triangle, local, inverse: 1 / determinant }];
  });
  // La grille ne sert qu'à retrouver les triangles : la profondeur est évaluée au point exact.
  // Comparer deux points voisins d'un tampon raster créait des trous sur les faces inclinées.
  const visibilitySize = 64;
  const visibility: number[][] = Array.from({ length: visibilitySize * visibilitySize }, () => []);
  candidates.forEach(({ local }, index) => {
    const x0 = Math.max(0, Math.floor(Math.min(...local.map((p) => p[0])) * visibilitySize));
    const x1 = Math.min(visibilitySize - 1, Math.floor(Math.max(...local.map((p) => p[0])) * visibilitySize));
    const y0 = Math.max(0, Math.floor(Math.min(...local.map((p) => p[1])) * visibilitySize));
    const y1 = Math.min(visibilitySize - 1, Math.floor(Math.max(...local.map((p) => p[1])) * visibilitySize));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) visibility[y * visibilitySize + x].push(index);
  });
  const isOccluded = (s: number, t: number, z: number, self: number) => {
    for (const index of visibility[Math.floor(t * visibilitySize) * visibilitySize + Math.floor(s * visibilitySize)]) {
      if (index === self) continue;
      const { local: [p, q, r], inverse } = candidates[index];
      const a = ((q[1] - r[1]) * (s - r[0]) + (r[0] - q[0]) * (t - r[1])) * inverse;
      const b = ((r[1] - p[1]) * (s - r[0]) + (p[0] - r[0]) * (t - r[1])) * inverse;
      const c = 1 - a - b;
      if (a < -1e-7 || b < -1e-7 || c < -1e-7) continue;
      const front = a * p[2] + b * q[2] + c * r[2];
      if (Math.abs(front) <= decal.depth / 2 && front > z + 1e-4) return true;
    }
    return false;
  };
  const depths = new Map<DecalFamily, Float32Array>();
  for (let candidate = 0; candidate < candidates.length; candidate++) {
    const { triangle, local } = candidates[candidate];
    let bitmap = output.get(triangle.family);
    if (!bitmap) {
      bitmap = { width: resolution, height: resolution, data: new Uint8ClampedArray(resolution * resolution * 4), triangles: 0 };
      output.set(triangle.family, bitmap);
      depths.set(triangle.family, new Float32Array(resolution * resolution).fill(-Infinity));
    }
    const data = bitmap.data; const depth = depths.get(triangle.family)!;
    let touched = false;
    walkTriangle(triangle.uv.map(([u, v]) => [u * resolution, (1 - v) * resolution]), resolution, resolution, (x, y, a, b, c) => {
      const s = a * local[0][0] + b * local[1][0] + c * local[2][0];
      const t = a * local[0][1] + b * local[1][1] + c * local[2][1];
      const z = a * local[0][2] + b * local[1][2] + c * local[2][2];
      if (s < 0 || s >= 1 || t < 0 || t >= 1 || Math.abs(z) > decal.depth / 2) return;
      if (z < depth[y * resolution + x] || isOccluded(s, t, z, candidate)) return;
      const sx = Math.max(0, Math.min(source.width - 1, s * source.width - .5));
      const sy = Math.max(0, Math.min(source.height - 1, t * source.height - .5));
      const ix = Math.floor(sx); const iy = Math.floor(sy); const fx = sx - ix; const fy = sy - iy;
      const indices = [(iy * source.width + ix) * 4, (iy * source.width + Math.min(ix + 1, source.width - 1)) * 4,
        (Math.min(iy + 1, source.height - 1) * source.width + ix) * 4, (Math.min(iy + 1, source.height - 1) * source.width + Math.min(ix + 1, source.width - 1)) * 4];
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const alpha = indices.reduce((value, index, i) => value + source.data[index + 3] * weights[i], 0);
      if (alpha < 1) return;
      const index = (y * resolution + x) * 4;
      for (let channel = 0; channel < 3; channel++) data[index + channel] = indices.reduce((value, offset, i) => value + source.data[offset + channel] * source.data[offset + 3] * weights[i], 0) / alpha;
      data[index + 3] = alpha;
      depth[y * resolution + x] = z;
      touched = true;
    });
    if (touched) bitmap.triangles++;
  }
  for (const [family, bitmap] of output) if (!bitmap.triangles) output.delete(family);
  return output;
}

/** Le masque de matière reprend l'alpha de l'image, jamais son rectangle englobant. */
export function materialBitmap(color: ProjectionBitmap | PixelSource, material: SurfaceMaterial): Uint8ClampedArray {
  const data = new Uint8ClampedArray(color.data.length);
  const byte = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = byte(material.roughness); data[i + 1] = byte(material.metalness); data[i + 3] = color.data[i + 3];
  }
  return data;
}
