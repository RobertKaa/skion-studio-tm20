/**
 * Vérifie que chaque pièce de SKIN_REGIONS et chaque zone de DETAILS_REGIONS
 * possède une orientation « voiture » cohérente, que les numéros de course
 * (top/left/right) reçoivent l'angle attendu, et que les zones details ont bien
 * des silhouettes dans le guide UV. Lancer: npx.cmd tsx scripts/check-orient.ts
 */
import {
  SKIN_REGIONS,
  DETAILS_REGIONS,
  REGION_ORIENTATION,
  getRegionOrientation,
} from '../src/maps.ts';
import { UV_GUIDE_BY_FAMILY } from '../src/uvGuideData.ts';

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) fail++;
};

console.log('1) Chaque pièce a une orientation :');
for (const key of Object.keys(SKIN_REGIONS)) {
  const o = getRegionOrientation(key);
  ok(
    REGION_ORIENTATION[key] !== undefined && Number.isFinite(o.angle) && typeof o.flipX === 'boolean',
    `${key} → angle=${o.angle}° flipX=${o.flipX}`,
  );
}

console.log('\n2) Angles attendus des panneaux à numéros (dérivés du FBB) :');
const expect: Record<string, number> = { top: 180, left: 270, right: 90, front: 0, rear: 180, spoiler: 0 };
for (const [key, ang] of Object.entries(expect)) {
  const measured = getRegionOrientation(key).angle;
  const delta = Math.abs((((measured - ang) % 360) + 540) % 360 - 180);
  ok(delta <= 3, `${key} ≈ ${ang}° (mesuré ${measured}°)`);
}

console.log('\n3) Convention gauche/droite (documentée) :');
ok(SKIN_REGIONS.left.label.includes('GAUCHE') && SKIN_REGIONS.left.x > 0.5, 'FLANC GAUCHE = îlot u≈0.8 (monde +X)');
ok(SKIN_REGIONS.right.label.includes('DROIT') && SKIN_REGIONS.right.x < 0.5, 'FLANC DROIT = îlot u≈0.15 (monde −X)');

console.log('\n4) Zones DÉTAILS — orientation présente pour chaque zone :');
for (const key of Object.keys(DETAILS_REGIONS)) {
  const o = getRegionOrientation(key);
  ok(
    REGION_ORIENTATION[key] !== undefined && Number.isFinite(o.angle) && typeof o.flipX === 'boolean',
    `${key} → angle=${o.angle}° flipX=${o.flipX}`,
  );
}

console.log('\n5) Zones DÉTAILS — silhouettes présentes dans le guide (famille "details") :');
const detailsIslands = UV_GUIDE_BY_FAMILY.details;
ok(detailsIslands.length > 0, `${detailsIslands.length} zone(s) details dans UV_GUIDE_BY_FAMILY`);
for (const key of Object.keys(DETAILS_REGIONS)) {
  const island = detailsIslands.find((i) => i.key === key);
  const polys = island?.polygons.length ?? 0;
  ok(!!island && polys > 0, `${key} → ${polys} contour(s)`);
}

console.log('\n6) Cohérence des clés : chaque silhouette details a une région + une orientation :');
for (const i of detailsIslands) {
  ok(
    DETAILS_REGIONS[i.key] !== undefined && REGION_ORIENTATION[i.key] !== undefined,
    `${i.key} (région + orientation présentes)`,
  );
}
// Les clés skin et details ne doivent pas se chevaucher (lookup global par clé).
const skinKeys = new Set(Object.keys(SKIN_REGIONS));
const overlap = Object.keys(DETAILS_REGIONS).filter((k) => skinKeys.has(k));
ok(overlap.length === 0, `aucune collision de clé skin/details (${overlap.join(', ') || 'aucune'})`);

console.log(fail === 0 ? '\nTOUS LES CONTRÔLES PASSENT ✅' : `\n${fail} CONTRÔLE(S) EN ÉCHEC ❌`);
process.exit(fail === 0 ? 0 : 1);
