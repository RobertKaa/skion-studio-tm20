import type { PreparedReliefTemplate, ReliefTemplateAsset, ReliefTemplateManifest, ReliefVariant } from './types';

const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 48 * 1024 * 1024;

function asset(value: ReliefTemplateAsset): boolean {
  return !!value && Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && value.byteLength <= MAX_ASSET_BYTES
    && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256)
    && typeof value.url === 'string' && /^(?:\/models\/relief\/)?(?:(?:dense|full|tyres)\/)?[a-zA-Z0-9_.-]+$/.test(value.url)
    && !value.url.includes('..');
}
function numbers(values: number[], length: number, min: number, max: number): boolean {
  return Array.isArray(values) && values.length === length && values.every(value => Number.isFinite(value) && value >= min && value <= max);
}

/** Bounded numeric arrays keep the full rig manifest smaller than decimal JSON. */
export function decodeReliefManifest(input: unknown): ReliefTemplateManifest {
  if (!input || typeof input !== 'object') throw new Error('Description du relief invalide.');
  const value = input as ReliefTemplateManifest;
  if (value.encoding === undefined) return value;
  if (value.encoding !== 'numeric-base64-v1' || !Array.isArray(value.geometries) || value.geometries.length > 32) throw new Error('Encodage du relief invalide.');
  let total = 0;
  function decode(source: unknown, kind: 'float' | 'uint' | 'bool'): number[] | boolean[] {
    if (typeof source !== 'string' || source.length % 4 || source.length > 20_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source) || (total += source.length) > MAX_MANIFEST_BYTES) throw new Error('Tableau du relief trop volumineux ou invalide.');
    const raw = atob(source), stride = kind === 'bool' ? 1 : 4;
    if (raw.length % stride) throw new Error('Dimensions du relief invalides.');
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0)), view = new DataView(bytes.buffer);
    if (kind === 'bool') { if (bytes.some(v => v > 1)) throw new Error('Masque du relief invalide.'); return Array.from(bytes, v => v === 1); }
    return Array.from({ length: bytes.length / 4 }, (_, i) => kind === 'float' ? view.getFloat32(i * 4, true) : view.getUint32(i * 4, true));
  }
  return { ...value, geometries: value.geometries.map(entry => {
    const copy = { ...entry } as unknown as Record<string, unknown>;
    for (const key of ['positions','normals','uv','hoodWeights','tangents']) if (copy[key] !== undefined) copy[key] = decode(copy[key], 'float');
    for (const key of ['indices','bindings','parents']) if (copy[key] !== undefined) copy[key] = decode(copy[key], 'uint');
    copy.bodyVertices = decode(copy.bodyVertices, 'bool');
    return copy as unknown as typeof entry;
  }) };
}

export function validateReliefManifest(value: ReliefTemplateManifest): void {
  if (!value || value.schemaVersion !== 1 || !asset(value.preview) || !asset(value.variants?.standard) || !asset(value.variants?.normal)
    || !Array.isArray(value.geometries) || !value.geometries.length || value.geometries.length > 32
    || (value.surfaceMethod !== undefined && value.surfaceMethod !== 'dense-heightfield-v1')
    || (value.interfaceProtectionVersion !== undefined && value.interfaceProtectionVersion !== 1)
    || !Array.isArray(value.dependencies) || value.dependencies.length > 32) throw new Error('Version du modèle de relief invalide.');
  let vertices = 0, indices = 0;
  const ranges: Record<ReliefVariant, [number, number][]> = { standard: [], normal: [] };
  const accessors = new Set<number>();
  for (const geometry of value.geometries) {
    const count = geometry?.positions?.length / 3;
    if (!Number.isSafeInteger(count) || count < 3 || (vertices += count) > 600_000
      || (geometry.family !== undefined && !['skin','details','wheels'].includes(geometry.family))
      || (geometry.bindings !== undefined && (!numbers(geometry.bindings, count, 0, 255) || geometry.bindings.some(v => !Number.isInteger(v))))
      || !numbers(geometry.positions, count * 3, -20, 20) || !numbers(geometry.normals, count * 3, -1.001, 1.001)
      || (geometry.tangents !== undefined && !numbers(geometry.tangents, count * 3, -1.001, 1.001))
      || !numbers(geometry.uv, count * 2, -2, 3) || !numbers(geometry.hoodWeights, count, 0, 1)
      || !Array.isArray(geometry.bodyVertices) || geometry.bodyVertices.length !== count || geometry.bodyVertices.some(value => typeof value !== 'boolean')
      || geometry.hoodWeights.some((weight, vertex) => weight > 0 && !geometry.bodyVertices[vertex])
      || !Array.isArray(geometry.indices) || geometry.indices.length % 3 || (indices += geometry.indices.length) > 3_600_000
      || geometry.indices.some(index => !Number.isInteger(index) || index < 0 || index >= count)
      || !['dec3n', 'float32'].includes(geometry.normalEncoding)) throw new Error('Géométrie du modèle de relief invalide.');
    if (geometry.legacyVertexCount !== undefined) {
      const old = geometry.legacyVertexCount;
      if (!Number.isInteger(old) || old < 3 || old > count || !Array.isArray(geometry.parents) || geometry.parents.length !== (count - old) * 2
        || geometry.parents.some((v, i) => !Number.isInteger(v) || v < 0 || v >= old + Math.floor(i / 2))) throw new Error('Migration du relief invalide.');
      if(geometry.bindings)for(let i=old;i<count;i++)if(geometry.parents.slice((i-old)*2,(i-old)*2+2).some(parent=>geometry.bindings![parent]!==geometry.bindings![i]))throw new Error('Attaches de migration incohérentes.');
      for (const variant of ['standard','normal'] as const) {
        const offsets = geometry.legacyOffsets?.[variant], bytes = value.legacyVariantBytes?.[variant];
        if (!bytes || bytes > MAX_ASSET_BYTES || !offsets || !Number.isSafeInteger(offsets.positionOffset) || offsets.positionOffset < 0 || offsets.positionOffset + old * 12 > bytes
          || !Number.isSafeInteger(offsets.normalOffset) || offsets.normalOffset < 0 || offsets.normalOffset + old * 4 > bytes
          || !Number.isSafeInteger(offsets.uvOffset) || offsets.uvOffset < 0 || offsets.uvOffset + old * 8 > bytes) throw new Error('Offsets de migration invalides.');
      }
    }
    if ((value.interfaceProtectionVersion === 1 && geometry.boundaryPoints === undefined)
      || (geometry.boundaryPoints !== undefined && (geometry.boundaryPoints.length > 60_000 || geometry.boundaryPoints.length % 3
        || !numbers(geometry.boundaryPoints, geometry.boundaryPoints.length, -20, 20)))) throw new Error('Interfaces fixes du modèle de relief invalides.');
    for (let vertex = 0; vertex < count; vertex++) {
      const length = Math.hypot(...geometry.normals.slice(vertex * 3, vertex * 3 + 3));
      if (length < .9 || length > 1.1) throw new Error('Normales du modèle de relief invalides.');
    }
    if ((geometry.positionAccessor === undefined) !== (geometry.normalAccessor === undefined)) throw new Error('Accesseurs du modèle de relief incomplets.');
    for (const index of [geometry.positionAccessor, geometry.normalAccessor].filter((value): value is number => value !== undefined)) {
      if (!Number.isInteger(index) || index < 0 || index > 4096 || accessors.has(index)) throw new Error('Accesseurs du modèle de relief invalides.');
      accessors.add(index);
    }
    for (const variant of ['standard', 'normal'] as const) {
      const offset = geometry.offsets?.[variant], normalBytes = geometry.normalEncoding === 'dec3n' ? 4 : 12;
      if (!offset || !Number.isSafeInteger(offset.positionOffset) || offset.positionOffset < 0
        || !Number.isSafeInteger(offset.normalOffset) || offset.normalOffset < 0
        || offset.positionOffset + count * 12 > value.variants[variant].byteLength
        || offset.normalOffset + count * normalBytes > value.variants[variant].byteLength) throw new Error('Offsets du modèle de relief invalides.');
      ranges[variant].push([offset.positionOffset, offset.positionOffset + count * 12], [offset.normalOffset, offset.normalOffset + count * normalBytes]);
      if (offset.tangentOffset !== undefined) {
        if (geometry.tangents === undefined || geometry.normalEncoding !== 'dec3n' || !Number.isSafeInteger(offset.tangentOffset) || offset.tangentOffset < 0
          || offset.tangentOffset + count * 4 > value.variants[variant].byteLength) throw new Error('Offsets de tangentes du modèle de relief invalides.');
        ranges[variant].push([offset.tangentOffset, offset.tangentOffset + count * 4]);
      }
    }
  }
  for (const intervals of Object.values(ranges)) {
    intervals.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) if (intervals[i][0] < intervals[i - 1][1]) throw new Error('Plages du modèle de relief superposées.');
  }
  const names = new Set<string>();
  let totalBytes = value.preview.byteLength + value.variants.standard.byteLength + value.variants.normal.byteLength;
  for (const dependency of value.dependencies) {
    if (!asset(dependency) || !/^[a-zA-Z0-9_.-]{1,128}\.(?:dds|gbx|json)$/i.test(dependency.name)
      || ['mainbody.mesh.gbx', 'skin_n.dds'].includes(dependency.name.toLowerCase()) || names.has(dependency.name.toLowerCase())
      || (totalBytes += dependency.byteLength) > 192 * 1024 * 1024) throw new Error('Dépendances du modèle de relief invalides.');
    names.add(dependency.name.toLowerCase());
  }
}

async function checkAsset(data: Uint8Array, expected: ReliefTemplateAsset): Promise<void> {
  if (data.byteLength !== expected.byteLength) throw new Error('Taille du modèle de relief incorrecte.');
  const hash = await crypto.subtle.digest('SHA-256', data.slice().buffer);
  const actual = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected.sha256) throw new Error('Le modèle de relief a été modifié ou est incomplet.');
}

export async function verifyPreparedReliefTemplate(template: PreparedReliefTemplate): Promise<void> {
  validateReliefManifest(template.manifest);
  if (template.dependencies.length !== template.manifest.dependencies.length) throw new Error('Dépendances du modèle de relief manquantes.');
  await Promise.all([
    checkAsset(template.preview, template.manifest.preview),
    checkAsset(template.variants.standard, template.manifest.variants.standard),
    checkAsset(template.variants.normal, template.manifest.variants.normal),
    ...template.manifest.dependencies.map((entry, i) => {
      if (template.dependencies[i].name !== entry.name) throw new Error('Dépendance du modèle de relief incorrecte.');
      return checkAsset(template.dependencies[i].data, entry);
    }),
  ]);
  for (const variant of ['standard', 'normal'] as const) {
    const bytes = template.variants[variant];
    if (bytes[0] !== 71 || bytes[1] !== 66 || bytes[2] !== 88 || bytes[7] !== 85) throw new Error('Le modèle GBX de relief doit être préparé sans compression.');
  }
}

const loading = new Map<boolean | 'full' | 'tyres', Promise<PreparedReliefTemplate>>();

/** No uploaded .blend or GBX is parsed or executed; this loads product assets. */
export function loadPreparedReliefTemplate(dense: boolean | 'full' | 'tyres' = false): Promise<PreparedReliefTemplate> {
  const cached = loading.get(dense); if (cached) return cached;
  const base = import.meta.env?.BASE_URL ?? '/';
  const withBase = (url: string) => `${base.replace(/\/$/, '')}${url.startsWith('/') ? url : `/models/relief/${url}`}`;
  const fetchBytes = async (entry: ReliefTemplateAsset): Promise<Uint8Array> => {
    const response = await fetch(withBase(entry.url), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Le modèle du prototype est indisponible.');
    const declared = Number(response.headers.get('content-length'));
    if (declared && declared > MAX_ASSET_BYTES) throw new Error('Modèle de relief trop volumineux.');
    const data = new Uint8Array(await response.arrayBuffer());
    await checkAsset(data, entry); return data;
  };
  const pending = (async () => {
    const response = await fetch(withBase(`/models/relief/${dense === 'full' || dense === 'tyres' ? `${dense}/` : dense ? 'dense/' : ''}manifest.json`), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Le modèle du prototype est indisponible.');
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES) throw new Error('Description du modèle de relief trop volumineuse.');
    const manifest = decodeReliefManifest(JSON.parse(text));
    validateReliefManifest(manifest);
    const [preview, standard, normal, dependencies] = await Promise.all([
      fetchBytes(manifest.preview), fetchBytes(manifest.variants.standard), fetchBytes(manifest.variants.normal),
      Promise.all(manifest.dependencies.map(async entry => ({ name: entry.name, data: await fetchBytes(entry) }))),
    ]);
    const template = { manifest, preview, variants: { standard, normal }, dependencies };
    await verifyPreparedReliefTemplate(template); return template;
  })();
  loading.set(dense, pending);
  pending.catch(() => { loading.delete(dense); });
  return pending;
}
