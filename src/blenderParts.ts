import { UV_GUIDE_BY_FAMILY, type UvGuideIsland, type UvGuideFamily } from './uvGuideData';

export type BlenderPart = UvGuideIsland & { mesh: string; fillRule: 'evenodd' };
const LABELS: Record<string, string> = {
  sWitchBrim_Lod1: 'Chapeau · bord', sWitchCrown_Lod1: 'Chapeau · couronne', sWitchTip_Lod1: 'Chapeau · pointe',
  sWitchRolledEdge_Lod1: 'Chapeau · rebord', sWitchRibbon_Lod1: 'Chapeau · ruban', sWitchBrassBuckle_Lod1: 'Chapeau · boucle',
  sWitchBucklePin_Lod1: 'Chapeau · ardillon', sWitchBuckleRivet_Lod1: 'Chapeau · rivet', sWitchMoonBrooch_Lod1: 'Chapeau · broche lune',
  sWitchCockpitSaddle_Lod1: 'Chapeau · support', sWitchCrownSeam_Lod1: 'Chapeau · couture',
  sWitchCrownStitches_Lod1: 'Chapeau · points de couture', sWitchBrimStitches_Lod1: 'Chapeau · points du bord',
  sWitchRibbonStitches_Lod1: 'Chapeau · points du ruban', sWitchRibbonLowerPiping_Lod1: 'Chapeau · liseré inférieur',
  sWitchRibbonUpperPiping_Lod1: 'Chapeau · liseré supérieur', wWheels_Lod1: 'Pneus · UV communes',
  wWheel_Lod1: 'Pneus · UV communes', sWitchSwitchbucklerivet_Lod1: 'Chapeau · rivet gauche',
};

/** Stock Stadium meshes retain the named guide zones; custom meshes add their own outlines. */
export function paintIslandsForModel(parts: BlenderPart[] | undefined, family: UvGuideFamily): UvGuideIsland[] {
  const custom = parts?.filter((part) => part.family === family && !/^[sd](Body|Details)_Lod/i.test(part.mesh)) ?? [];
  return [...(family === 'wheels' && custom.length ? [] : UV_GUIDE_BY_FAMILY[family]), ...custom];
}
type Point = { x: number; y: number };
function inPolygon(polygon: Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const a = polygon[i], b = polygon[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside; }
  return inside;
}
function polygonArea(polygon: Point[]) { return Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2; }

export function uvElementIsland(island: UvGuideIsland, index: number): UvGuideIsland | null {
  const polygon = island.polygons[index]; if (!polygon) return null;
  // Retain holes inside this connected contour, without the other disconnected elements.
  const polygons = island.fillRule === 'evenodd' ? [polygon, ...island.polygons.filter((candidate, i) => i !== index && polygonArea(candidate) < polygonArea(polygon) && candidate.every((p) => inPolygon(polygon, p.x, p.y)))] : [polygon];
  return { ...island, key: `${island.key}:element:${index}`, label: `${island.label} · élément ${index + 1}`, polygons };
}

/** A named part can contain many independent shapes. Choose the smallest hit contour. */
export function uvElementAt(islands: UvGuideIsland[], x: number, y: number) {
  const hits = islands.flatMap((island) => {
    if (island.fillRule === 'evenodd' && island.polygons.filter((p) => inPolygon(p, x, y)).length % 2 === 0) return [];
    return island.polygons.flatMap((polygon, index) => inPolygon(polygon, x, y) ? [{ island, index, area: polygonArea(polygon) }] : []);
  }).sort((a, b) => a.area - b.area);
  return hits[0];
}
const pointKey = (p: Point) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;

/** Limits apply before Fabric, SVG or canvas sees imported geometry. */
export function validateBlenderParts(value: unknown): asserts value is BlenderPart[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('Pièces Blender invalides (128 maximum).');
  let points = 0; const keys = new Set<string>();
  for (const part of value) {
    if (!part || typeof part !== 'object' || typeof part.key !== 'string' || !/^blender:[\w.-]{1,100}$/.test(part.key) || keys.has(part.key) ||
      typeof part.label !== 'string' || !part.label.trim() || part.label.length > 120 || typeof part.mesh !== 'string' || part.mesh.length > 160 ||
      !['skin', 'details', 'wheels'].includes(part.family) || part.fillRule !== 'evenodd' || !Array.isArray(part.polygons) || !part.polygons.length) throw new Error('Pièce Blender invalide.');
    keys.add(part.key);
    for (const polygon of part.polygons) {
      if (!Array.isArray(polygon) || polygon.length < 3 || (points += polygon.length) > 50000 || polygon.some((p: Point) =>
        !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) throw new Error('Contours UV Blender invalides.');
    }
  }
}

/** UV boundaries, with duplicate faces removed (mirrored/shared wheel atlases). */
export function uvContours(triangles: Point[][]): Point[][] {
  const edges = new Map<string, { a: Point; b: Point; count: number }>();
  const faces = new Set<string>();
  for (const triangle of triangles) {
    const keys = triangle.map(pointKey); const face = [...keys].sort().join(';');
    if (new Set(keys).size < 3 || faces.has(face)) continue;
    faces.add(face);
    for (let i = 0; i < 3; i++) {
      const a = triangle[i], b = triangle[(i + 1) % 3];
      const key = [pointKey(a), pointKey(b)].sort().join(';');
      const previous = edges.get(key);
      if (previous) previous.count++; else edges.set(key, { a, b, count: 1 });
    }
  }
  const boundary = [...edges.values()].filter((edge) => edge.count === 1);
  const adjacency = new Map<string, number[]>();
  boundary.forEach((edge, index) => { for (const p of [edge.a, edge.b]) { const key = pointKey(p); adjacency.set(key, [...(adjacency.get(key) ?? []), index]); } });
  const visited = new Set<number>(); const polygons: Point[][] = [];
  for (let i = 0; i < boundary.length; i++) {
    if (visited.has(i)) continue;
    const first = boundary[i].a; let current = first; let edgeIndex: number | undefined = i;
    const polygon: Point[] = [];
    while (edgeIndex !== undefined && !visited.has(edgeIndex)) {
      visited.add(edgeIndex); polygon.push(current);
      const edge = boundary[edgeIndex]; current = pointKey(edge.a) === pointKey(current) ? edge.b : edge.a;
      if (pointKey(current) === pointKey(first)) break;
      edgeIndex = adjacency.get(pointKey(current))?.find((index) => !visited.has(index));
    }
    if (polygon.length >= 3 && pointKey(current) === pointKey(first)) polygons.push(polygon);
  }
  return polygons;
}

/** Shared guard: imported previews must contain their own geometry and images. */
export function embeddedGlbData(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 28 || buffer.byteLength > 64 * 1024 * 1024 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Aperçu GLB invalide.');
  const jsonSize = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonSize > 8 * 1024 * 1024 || 28 + jsonSize > buffer.byteLength) throw new Error('Configuration GLB invalide.');
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonSize)));
  const binStart = 28 + jsonSize, binSize = view.getUint32(20 + jsonSize, true);
  if (view.getUint32(24 + jsonSize, true) !== 0x004e4942 || binStart + binSize > buffer.byteLength) throw new Error('Données GLB invalides.');
  if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1 || gltf.buffers[0]?.uri !== undefined ||
    !Number.isSafeInteger(gltf.buffers[0]?.byteLength) || gltf.buffers[0].byteLength < 0 || gltf.buffers[0].byteLength > binSize ||
    (gltf.images !== undefined && (!Array.isArray(gltf.images) || gltf.images.some((image: { uri?: unknown }) => !image || image.uri !== undefined)))) throw new Error('Le GLB doit contenir ses ressources : les liens externes sont refusés.');
  return { gltf, view, binStart, binSize };
}

/** Reads embedded GLB buffers only; never fetches external URIs. */
export function blenderPartsFromGlb(buffer: ArrayBuffer): BlenderPart[] {
  const { gltf, view, binStart, binSize } = embeddedGlbData(buffer);
  if (!Array.isArray(gltf.meshes) || gltf.meshes.length > 128 || !Array.isArray(gltf.accessors) || !Array.isArray(gltf.bufferViews)) throw new Error('Géométrie GLB invalide.');
  const accessor = (index: number, components: number) => {
    const a = gltf.accessors[index]; const b = gltf.bufferViews[a?.bufferView];
    const bytes = ({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 } as Record<number, number>)[a?.componentType];
    if (!a || !b || b.buffer !== 0 || a.sparse || !bytes || a.type !== (components === 2 ? 'VEC2' : 'SCALAR') || !Number.isInteger(a.count) || a.count < 0 || a.count > 1e6) throw new Error('UV GLB non pris en charge.');
    const offset = binStart + (b.byteOffset ?? 0) + (a.byteOffset ?? 0); const stride = b.byteStride ?? components * bytes;
    if (!Number.isInteger(offset) || !Number.isInteger(stride) || offset < binStart || stride < components * bytes || offset + Math.max(0, a.count - 1) * stride + components * bytes > binStart + binSize) throw new Error('UV GLB tronqués.');
    const read = (i: number, c = 0) => {
      if (!Number.isInteger(i) || i < 0 || i >= a.count) throw new Error('Index UV invalide.');
      const p = offset + i * stride + c * bytes;
      const raw = a.componentType === 5126 ? view.getFloat32(p, true) : bytes === 4 ? view.getUint32(p, true) : bytes === 2 ? view.getUint16(p, true) : view.getUint8(p);
      return a.normalized && a.componentType !== 5126 ? raw / (2 ** (bytes * 8) - 1) : raw;
    };
    return { count: a.count, read };
  };
  const parts: BlenderPart[] = []; let faceCount = 0;
  for (const [mi, mesh] of gltf.meshes.entries()) {
    if (!Array.isArray(mesh.primitives) || mesh.primitives.length > 16) throw new Error('Pièces GLB trop complexes.');
    for (const [pi, primitive] of mesh.primitives.entries()) {
      const material = String(gltf.materials?.[primitive.material]?.name ?? '');
      const family = /Wheels/i.test(material) ? 'wheels' : /Details/i.test(material) ? 'details' : /Skin/i.test(material) ? 'skin' : null;
      if (!family || primitive.attributes?.TEXCOORD_0 === undefined || (primitive.mode ?? 4) !== 4) continue;
      const uv = accessor(primitive.attributes.TEXCOORD_0, 2); const indices = primitive.indices === undefined ? null : accessor(primitive.indices, 1);
      const count = indices?.count ?? uv.count;
      if (count % 3 || (faceCount += count / 3) > 250000) throw new Error('Géométrie GLB trop complexe.');
      const triangles: Point[][] = [];
      for (let i = 0; i < count; i += 3) {
        const triangle = [0, 1, 2].map((c) => { const vi = indices?.read(i + c) ?? i + c; return { x: uv.read(vi), y: 1 - uv.read(vi, 1) }; });
        // Tiled textures cannot be separated reliably in a single 0..1 atlas.
        if (triangle.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= -1e-6 && p.x <= 1.000001 && p.y >= -1e-6 && p.y <= 1.000001)) triangles.push(triangle.map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) })));
      }
      const polygons = uvContours(triangles);
      if (!polygons.length) continue;
      const name = String(gltf.nodes?.find((node: { mesh?: number }) => node.mesh === mi)?.name ?? mesh.name ?? `Pièce ${mi + 1}`).slice(0, 160);
      const label = LABELS[name] ?? LABELS[name.replace(/_Lod\d.*$/, '_Lod1')] ?? name.replace(/^[sdw](?=[A-Z])/, '').replace(/_Lod\d.*$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').slice(0, 120);
      parts.push({ key: `blender:${mi}.${pi}`, mesh: name, label, family, polygons, fillRule: 'evenodd' });
    }
  }
  validateBlenderParts(parts); return parts;
}

export function uvRegionBounds(island: UvGuideIsland) {
  const points = island.polygons.flat();
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y));
  return { x, y, w: Math.max(...points.map((p) => p.x)) - x, h: Math.max(...points.map((p) => p.y)) - y, label: island.label };
}

export function uvRegionAt(islands: UvGuideIsland[], x: number, y: number) {
  // Smaller parts win where contours overlap; shared UVs remain a shared texture.
  return [...islands].sort((a, b) => { const aa = uvRegionBounds(a), bb = uvRegionBounds(b); return aa.w * aa.h - bb.w * bb.h; }).find((island) => {
    const hits = island.polygons.map((polygon) => {
      return inPolygon(polygon, x, y);
    });
    return island.fillRule === 'evenodd' ? hits.filter(Boolean).length % 2 === 1 : hits.some(Boolean);
  });
}
