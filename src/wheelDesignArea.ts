import type { MaterialDefinition, MaterialLayer } from './materials/types';
import { getWheelCoordinates } from './materials/wheelCoordinates';
import { atlasCoordinateMap, sourceAtlasGeometry } from './realUvAtlas';
import type { ProjectionTriangle, Vec3 } from './three/decalProjection';
import { poseIsActive, type VehiclePose } from './three/vehiclePose';
import { WHEEL_TREAD_UV } from './wheelTreads';

export type WheelVisibleSide = 'outer' | 'inner';
export interface WheelVisibleAreaOptions {
  /** Use the same placement as the editable material, including its offset and flip. */
  definition?: MaterialDefinition;
  /** Regions/exclusions of an existing material, in its original atlas. */
  layer?: MaterialLayer;
  /** Camera target immediately after focusing the wheel to represent this occurrence. */
  center?: readonly [number, number, number];
  /** Posed skinned meshes need deformed vertices, which projection geometry does not expose. */
  pose?: VehiclePose;
  size?: number;
}
type Bounds = { lo: Vec3; hi: Vec3 };
const finite = (p: readonly number[]) => p.every(Number.isFinite);
const bounds = (): Bounds => ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] });
const include = (box: Bounds, point: Vec3) => {
  for (let axis = 0; axis < 3; axis++) { box.lo[axis] = Math.min(box.lo[axis], point[axis]); box.hi[axis] = Math.max(box.hi[axis], point[axis]); }
};
const midpoint = (box: Bounds, axis: number) => (box.lo[axis] + box.hi[axis]) / 2;
const dimension = (box: Bounds, axis: number) => box.hi[axis] - box.lo[axis];

/** Return a transparent image with alpha only where the selected sidewall is
 * actually exposed to a perpendicular view. The mask is in artwork space,
 * not UV space. Meshes and artwork remain untouched. */
export function createWheelVisibleArea(geometry: readonly ProjectionTriangle[], side: WheelVisibleSide,
  options: WheelVisibleAreaOptions = {}): HTMLCanvasElement | null {
  const size = options.size ?? 256;
  if (!Number.isInteger(size) || size < 32 || size > 1024 || geometry.length < 1 || geometry.length > 500_000
    || (side !== 'outer' && side !== 'inner') || (options.center && !finite(options.center))
    || (options.pose && poseIsActive(options.pose))) return null;
  const transform = (options.definition ?? options.layer?.definition)?.transform ?? { projection: 'wheel-face', mode: 'contain', size: 256, angle: 0, offsetX: 0, offsetY: 0, flipX: false, flipY: false };
  // A repeating placement uses multiple copies of artwork. Do not imply a
  // single, exact printable mask where a source point appears several times.
  if (transform.projection !== 'wheel-face' || transform.mode === 'repeat'
    || !finite([transform.size, transform.angle, transform.offsetX, transform.offsetY]) || transform.size <= 0) return null;
  const all = bounds(), wheelBounds = bounds();
  const wheelIds: number[] = [];
  for (let i = 0; i < geometry.length; i++) {
    const triangle = geometry[i];
    if (!triangle.points || triangle.points.length !== 3 || !triangle.points.every(point => point.length === 3 && finite(point) && point.every(value => Math.abs(value) < 1e6))) return null;
    for (const point of triangle.points) include(all, point);
    if (triangle.family === 'wheels') {
      const uv = triangle.sourceUv ?? triangle.uv;
      if (!uv || uv.length !== 3 || !uv.every(point => point.length === 2 && finite(point))) return null;
      wheelIds.push(i); for (const point of triangle.points) include(wheelBounds, point);
    }
  }
  if (!wheelIds.length) return null;
  const midX = midpoint(wheelBounds, 0), midZ = midpoint(wheelBounds, 2);
  const groups = new Map<number, number[]>();
  for (const index of wheelIds) {
    const t = geometry[index], x = (t.points[0][0] + t.points[1][0] + t.points[2][0]) / 3;
    const z = (t.points[0][2] + t.points[1][2] + t.points[2][2]) / 3;
    const key = (x > midX ? 1 : 0) + (z > midZ ? 2 : 0);
    const group = groups.get(key) ?? []; group.push(index); groups.set(key, group);
  }
  const choices = [...groups.entries()].map(([key, indexes]) => {
    const box = bounds(); for (const index of indexes) for (const point of geometry[index].points) include(box, point);
    const center: Vec3 = [midpoint(box, 0), midpoint(box, 1), midpoint(box, 2)];
    const distance = options.center ? Math.hypot(center[0] - options.center[0], center[1] - options.center[1], center[2] - options.center[2]) : ((key & 1) ? 0 : 4) + ((key & 2) ? 0 : 1);
    return { key, indexes, box, center, distance };
  }).filter(group => dimension(group.box, 1) > 1e-5 && dimension(group.box, 2) > 1e-5).sort((a, b) => a.distance - b.distance);
  if (!choices.length) return null;
  const selected = choices[0], box = selected.box;
  const radiusY = dimension(box, 1), radiusZ = dimension(box, 2), tolerance = Math.max(radiusY, radiusZ) * .01;
  if (radiusY / radiusZ < .65 || radiusY / radiusZ > 1.55) return null;
  const pointsX = selected.indexes.flatMap(index => geometry[index].points.map(point => point[0])).sort((a, b) => a - b);
  const xMin = pointsX[Math.floor(pointsX.length * .05)] - radiusY * .05;
  const xMax = pointsX[Math.floor(pointsX.length * .95)] + radiusY * .05;
  const outward = selected.center[0] >= midX ? 1 : -1, depthSign = side === 'outer' ? outward : -outward;
  let chart, chartGeometry: readonly ProjectionTriangle[];
  try {
    if (options.layer?.nativeAtlas) chartGeometry = sourceAtlasGeometry(geometry);
    else if (options.layer?.organizedAtlas) {
      // Only wheel UVs are consulted here; mapping every body triangle through
      // the organized atlas would stall the workshop on large custom models.
      const map = atlasCoordinateMap('wheels', options.layer.organizedAtlas);
      chartGeometry = geometry.map(triangle => triangle.family === 'wheels'
        ? { ...triangle, sourceUv: triangle.uv, uv: triangle.atlasUv ?? triangle.uv.map(point => map(...point)) as ProjectionTriangle['uv'] } : triangle);
    } else chartGeometry = geometry;
    chart = getWheelCoordinates(chartGeometry, true);
  } catch { return null; }
  const spanX = chart.max[0] - chart.min[0], spanY = chart.max[1] - chart.min[1];
  const fit = transform.mode === 'cover' || transform.mode === 'stretch' ? Math.max(spanX, spanY) : Math.min(spanX, spanY);
  const denominator = fit * transform.size / 256;
  const scale = 2048 / Math.max(1e-6, dimension(all, 0), dimension(all, 1), dimension(all, 2));
  if (!Number.isFinite(denominator) || denominator < 1e-9 || !Number.isFinite(scale)) return null;
  const angle = -transform.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const flipX = transform.flipX ? -1 : 1, flipY = transform.flipY ? -1 : 1;
  const xOffset = transform.offsetX / scale, yOffset = transform.offsetY / scale;
  const drawingPoint = (index: number, corner: number): [number, number] => {
    const node = chart.triangleNodes[index * 3 + corner], x = chart.transverse[node] - xOffset, y = chart.longitudinal[node] - yOffset;
    return [(.5 + flipX * (cos * x - sin * y) / denominator) * size,
      (.5 + flipY * (sin * x + cos * y) / denominator) * size];
  };

  // Bin actual rim/mechanics triangles in the plane perpendicular to the axle.
  // Their 3D depth decides if rubber visible from this side is occluded.
  const binCount = 48, bins: ProjectionTriangle[][] = Array.from({ length: binCount * binCount }, () => []);
  let binEntries = 0;
  const binY = (value: number) => Math.max(0, Math.min(binCount - 1, Math.floor((value - box.lo[1]) / radiusY * binCount)));
  const binZ = (value: number) => Math.max(0, Math.min(binCount - 1, Math.floor((value - box.lo[2]) / radiusZ * binCount)));
  const wheelSet = new Set(selected.indexes);
  for (let index = 0; index < geometry.length; index++) {
    const triangle = geometry[index];
    if (triangle.family !== 'skin' && triangle.family !== 'details' && !(triangle.family === 'wheels' && wheelSet.has(index))) continue;
    // A detached wheel contains its real rim, not the rest of the body.
    if (!triangle.points.every(p => p[0] >= xMin - tolerance && p[0] <= xMax + tolerance
      && p[1] >= box.lo[1] - tolerance && p[1] <= box.hi[1] + tolerance
      && p[2] >= box.lo[2] - tolerance && p[2] <= box.hi[2] + tolerance)) continue;
    const ys = triangle.points.map(p => p[1]), zs = triangle.points.map(p => p[2]);
    const y0 = binY(Math.min(...ys)), y1 = binY(Math.max(...ys)), z0 = binZ(Math.min(...zs)), z1 = binZ(Math.max(...zs));
    if ((binEntries += (y1 - y0 + 1) * (z1 - z0 + 1)) > 2_000_000) return null;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) bins[y * binCount + z].push(triangle);
  }
  // Rasterize the same UV regions and holes as the material renderer, before
  // mapping them back to artwork space. Antialiased edges stay partially valid.
  const layer = options.layer, uvMaskSize = 1024;
  let uvMask: Uint8ClampedArray | undefined;
  if (layer && (layer.regions.length || layer.exclusions.length)) {
    const maskCanvas = document.createElement('canvas'); maskCanvas.width = maskCanvas.height = uvMaskSize;
    const mask = maskCanvas.getContext('2d'); if (!mask) return null;
    const drawRegion = (region: MaterialLayer['regions'][number]) => {
      mask.beginPath();
      for (const polygon of region.polygons) {
        if (!polygon.length) continue;
        mask.moveTo(polygon[0].x * uvMaskSize, polygon[0].y * uvMaskSize);
        for (const point of polygon.slice(1)) mask.lineTo(point.x * uvMaskSize, point.y * uvMaskSize);
        mask.closePath();
      }
      mask.fill(region.fillRule ?? 'nonzero');
    };
    mask.fillStyle = '#fff';
    if (!layer.regions.length) mask.fillRect(0, 0, uvMaskSize, uvMaskSize);
    else for (const region of layer.regions) drawRegion(region);
    mask.globalCompositeOperation = 'destination-out';
    for (const region of layer.exclusions) drawRegion(region);
    uvMask = mask.getImageData(0, 0, uvMaskSize, uvMaskSize).data;
    maskCanvas.width = maskCanvas.height = 1;
  }
  const nearest = new Float32Array(size * size); nearest.fill(-Infinity);
  const coverage = new Uint8ClampedArray(size * size);
  const worldY = new Float32Array(size * size), worldZ = new Float32Array(size * size);
  let work = 0;
  for (const index of selected.indexes) {
    const t = geometry[index], uv = t.sourceUv ?? t.uv, maskUV = chartGeometry[index].uv, src = [0, 1, 2].map(corner => drawingPoint(index, corner));
    const [a, b, c] = src, det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) continue;
    const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), right = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), bottom = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    work += Math.max(0, right - left + 1) * Math.max(0, bottom - top + 1);
    if (work > size * size * 50 + geometry.length * 20) return null;
    for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) {
      const x = px + .5, y = py + .5;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const sourceU = u * uv[0][0] + v * uv[1][0] + w * uv[2][0];
      if (side === 'outer' ? sourceU < WHEEL_TREAD_UV.maxU : sourceU > WHEEL_TREAD_UV.minU) continue;
      let alpha = 255;
      if (uvMask) {
        const mu = u * maskUV[0][0] + v * maskUV[1][0] + w * maskUV[2][0];
        const mv = u * maskUV[0][1] + v * maskUV[1][1] + w * maskUV[2][1];
        if (mu < 0 || mu > 1 || mv < 0 || mv > 1) continue;
        const mx = Math.max(0, Math.min(uvMaskSize - 1, Math.floor(mu * uvMaskSize)));
        const my = Math.max(0, Math.min(uvMaskSize - 1, Math.floor((1 - mv) * uvMaskSize)));
        alpha = uvMask[(my * uvMaskSize + mx) * 4 + 3];
        if (!alpha) continue;
      }
      const p = t.points, depth = depthSign * (u * p[0][0] + v * p[1][0] + w * p[2][0]), pixel = py * size + px;
      if (depth <= nearest[pixel]) continue;
      nearest[pixel] = depth;
      coverage[pixel] = alpha;
      worldY[pixel] = u * p[0][1] + v * p[1][1] + w * p[2][1];
      worldZ[pixel] = u * p[0][2] + v * p[1][2] + w * p[2][2];
    }
  }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  const image = ctx.createImageData(size, size), output = image.data;
  for (let pixel = 0; pixel < nearest.length; pixel++) {
    const depth = nearest[pixel]; if (!Number.isFinite(depth)) continue;
    const y = worldY[pixel], z = worldZ[pixel]; let blocked = false;
    for (const triangle of bins[binY(y) * binCount + binZ(z)]) {
      const [a, b, c] = triangle.points;
      const det = (b[2] - c[2]) * (a[1] - c[1]) + (c[1] - b[1]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-12) continue;
      const u = ((b[2] - c[2]) * (y - c[1]) + (c[1] - b[1]) * (z - c[2])) / det;
      const v = ((c[2] - a[2]) * (y - c[1]) + (a[1] - c[1]) * (z - c[2])) / det, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      if (depthSign * (u * a[0] + v * b[0] + w * c[0]) > depth + 1e-5) { blocked = true; break; }
    }
    if (!blocked) { const offset = pixel * 4; output[offset] = output[offset + 1] = output[offset + 2] = 255; output[offset + 3] = coverage[pixel]; }
  }
  ctx.putImageData(image, 0, 0); return canvas;
}
