import type { PreparedReliefTemplate, ReliefTemplateAsset, ReliefTemplateManifest, ReliefVariant } from './types';

const MAX_ASSET_BYTES = 64 * 1024 * 1024;

function asset(value: ReliefTemplateAsset): boolean {
  return !!value && Number.isSafeInteger(value.byteLength) && value.byteLength > 0 && value.byteLength <= MAX_ASSET_BYTES
    && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256)
    && typeof value.url === 'string' && /^(?:\/models\/relief\/)?(?:dense\/)?[a-zA-Z0-9_.-]+$/.test(value.url)
    && !value.url.includes('..');
}
function numbers(values: number[], length: number, min: number, max: number): boolean {
  return Array.isArray(values) && values.length === length && values.every(value => Number.isFinite(value) && value >= min && value <= max);
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
    if (!Number.isSafeInteger(count) || count < 3 || (vertices += count) > 200_000
      || !numbers(geometry.positions, count * 3, -20, 20) || !numbers(geometry.normals, count * 3, -1.001, 1.001)
      || (geometry.tangents !== undefined && !numbers(geometry.tangents, count * 3, -1.001, 1.001))
      || !numbers(geometry.uv, count * 2, -2, 3) || !numbers(geometry.hoodWeights, count, 0, 1)
      || !Array.isArray(geometry.bodyVertices) || geometry.bodyVertices.length !== count || geometry.bodyVertices.some(value => typeof value !== 'boolean')
      || geometry.hoodWeights.some((weight, vertex) => weight > 0 && !geometry.bodyVertices[vertex])
      || !Array.isArray(geometry.indices) || geometry.indices.length % 3 || (indices += geometry.indices.length) > 1_200_000
      || geometry.indices.some(index => !Number.isInteger(index) || index < 0 || index >= count)
      || !['dec3n', 'float32'].includes(geometry.normalEncoding)) throw new Error('Géométrie du modèle de relief invalide.');
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

const loading = new Map<boolean, Promise<PreparedReliefTemplate>>();

/** No uploaded .blend or GBX is parsed or executed; this loads product assets. */
export function loadPreparedReliefTemplate(dense = false): Promise<PreparedReliefTemplate> {
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
    const response = await fetch(withBase(`/models/relief/${dense ? 'dense/' : ''}manifest.json`), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Le modèle du prototype est indisponible.');
    const text = await response.text();
    if (text.length > 40 * 1024 * 1024) throw new Error('Description du modèle de relief trop volumineuse.');
    const manifest = JSON.parse(text) as ReliefTemplateManifest;
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
