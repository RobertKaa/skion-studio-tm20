/**
 * Test headless du chemin d'EXPORT complet (hors DOM).
 *
 * On construit une image RGBA distinctive par map, on passe par le cœur PUR
 * `buildSkinZipFromImages` (le même code que `exportSkinZip`, mais sans canvas),
 * on décompresse le zip obtenu (JSZip) puis on vérifie :
 *   (a) tous les fichiers attendus sont présents (une DDS par map + ReadMe) ;
 *   (b) chaque DDS a le bon magic / fourcc / dimensions / nombre de mips ;
 *   (c) un motif peint distinct survit à l'aller-retour encode→decode ;
 *   (d) le canal ALPHA de Details_I encode bien le RÔLE d'illumination (BC3/DXT5).
 *
 * Lancer :  npx.cmd tsx scripts/test-export.ts
 */
import JSZip from 'jszip';
import {
  applyIllumRole,
  buildSkinZipFromImages,
} from '../src/skinZip';
import { SKIN3D_MESH_FILE, isGameZipPassthrough } from '../src/skin3d';
import { decodeDDS, type RGBAImage } from '../src/dds';
import {
  ILLUM_ROLES,
  MAPS,
  MAP_BY_ID,
  type BCFormat,
  type IllumRole,
  type MapId,
} from '../src/maps';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) {
    failures++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

const fourCCStr = (v: number): string =>
  String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);

const EXPECTED_FOURCC: Record<BCFormat, string> = {
  BC1: 'DXT1',
  BC3: 'DXT5',
  BC4: 'ATI1',
  BC5: 'ATI2',
};

/** Nombre de mips d'une image carrée : log2(size)+1. */
const mipCountFor = (size: number) => Math.floor(Math.log2(size)) + 1;

/**
 * Motif distinctif par map : gradient horizontal sur R, vertical sur G, plus un
 * carré marqueur au centre. Chaque map reçoit une teinte de base différente
 * (via `seed`) pour prouver qu'aucune map n'écrase une autre à l'export.
 */
function paintPattern(size: number, seed: number): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const cx = size >> 1;
  const q = size >> 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inMarker = x > cx - q && x < cx + q && y > cx - q && y < cx + q;
      data[i] = inMarker ? 240 : Math.round((x * 255) / (size - 1));
      data[i + 1] = inMarker ? 30 : Math.round((y * 255) / (size - 1));
      data[i + 2] = (seed * 37) & 255;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Motif d'illumination : moitié gauche « allumée » (vive), moitié droite noire. */
function paintIllum(size: number): RGBAImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const lit = x < size / 2;
      data[i] = lit ? 255 : 0;
      data[i + 1] = lit ? 40 : 0;
      data[i + 2] = lit ? 10 : 0;
      data[i + 3] = 255; // le canvas couleur n'a pas d'alpha « rôle »
    }
  }
  return { width: size, height: size, data };
}

async function main() {
  const illumRole: IllumRole = 'head'; // alpha attendu 0x67
  const roleAlpha = ILLUM_ROLES.find((r) => r.id === illumRole)!.alpha;

  // 1) Construit une image par map à sa exportRes, avec un motif unique.
  const images = {} as Record<MapId, RGBAImage>;
  MAPS.forEach((def, idx) => {
    images[def.id] =
      def.kind === 'illum'
        ? paintIllum(def.exportRes)
        : paintPattern(def.exportRes, idx + 1);
  });

  // 2) Passe par le cœur PUR d'export (le même que exportSkinZip).
  const blob = await buildSkinZipFromImages(images, {
    skinName: 'TestSkin',
    illumRole,
  });
  const buf = Buffer.from(await blob.arrayBuffer());
  check('zip non vide', buf.byteLength > 0, `taille=${buf.byteLength}`);

  // 3) Décompresse et vérifie le contenu.
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);

  check('ReadMe.txt présent', names.includes('ReadMe.txt'));

  for (const def of MAPS) {
    const entry = zip.file(def.fileName);
    check(`${def.id} → ${def.fileName} présent`, !!entry);
    if (!entry) continue;

    const ab = await entry.async('arraybuffer');
    const dv = new DataView(ab);

    check(`${def.id} magic DDS`, fourCCStr(dv.getUint32(0, true)) === 'DDS ');
    check(
      `${def.id} fourcc ${EXPECTED_FOURCC[def.format]}`,
      fourCCStr(dv.getUint32(84, true)) === EXPECTED_FOURCC[def.format],
      `got ${fourCCStr(dv.getUint32(84, true))}`,
    );
    check(
      `${def.id} dimensions ${def.exportRes}²`,
      dv.getUint32(12, true) === def.exportRes && dv.getUint32(16, true) === def.exportRes,
      `got ${dv.getUint32(16, true)}x${dv.getUint32(12, true)}`,
    );
    const mips = dv.getUint32(28, true);
    check(
      `${def.id} chaîne de mips complète`,
      mips === mipCountFor(def.exportRes),
      `got ${mips}, want ${mipCountFor(def.exportRes)}`,
    );
  }

  // 4) Survie du motif : décode chaque DDS et compare aux canaux pertinents.
  for (const def of MAPS) {
    if (def.kind === 'illum') continue; // testé séparément (alpha)
    const ab = await zip.file(def.fileName)!.async('arraybuffer');
    const dec = decodeDDS(ab);
    check(`${def.id} décodage OK`, !!dec);
    if (!dec) continue;

    const src = images[def.id];
    // Canaux vérifiés selon le format : BC1=RVB, BC4=R seul, BC5=R+G.
    const channels = def.format === 'BC5' ? [0, 1] : def.format === 'BC4' ? [0] : [0, 1, 2];
    // Échantillonne le pixel marqueur central (doit être bien distinct du fond).
    const cx = def.exportRes >> 1;
    const p = (cx * def.exportRes + cx) * 4;
    let maxErr = 0;
    for (const ch of channels) {
      maxErr = Math.max(maxErr, Math.abs(dec.data[p + ch] - src.data[p + ch]));
    }
    check(`${def.id} motif survit (marqueur)`, maxErr <= 48, `maxErr=${maxErr}`);
  }

  // 5) Details_I : le RÔLE doit être écrit dans l'alpha (BC3/DXT5).
  {
    const def = MAP_BY_ID.Details_I;
    const ab = await zip.file(def.fileName)!.async('arraybuffer');
    const dec = decodeDDS(ab)!;
    const size = def.exportRes;
    // Colonne allumée (gauche) → alpha ≈ roleAlpha ; colonne éteinte (droite) → 0.
    const litIdx = (Math.floor(size / 2) * size + Math.floor(size / 4)) * 4;
    const offIdx = (Math.floor(size / 2) * size + Math.floor((size * 3) / 4)) * 4;
    check(
      `Details_I alpha zone allumée ≈ rôle (${roleAlpha})`,
      Math.abs(dec.data[litIdx + 3] - roleAlpha) <= 20,
      `got ${dec.data[litIdx + 3]}`,
    );
    // Convention Nadeo : zone ÉTEINTE = RVB noir + alpha BLANC (255).
    check(
      'Details_I alpha zone éteinte ≈ 255 (fond blanc Nadeo)',
      dec.data[offIdx + 3] >= 235,
      `got ${dec.data[offIdx + 3]}`,
    );
    check(
      'Details_I RVB zone éteinte ≈ noir (aucune émission)',
      dec.data[offIdx] <= 20 && dec.data[offIdx + 1] <= 20 && dec.data[offIdx + 2] <= 20,
      `got RGB=${dec.data[offIdx]},${dec.data[offIdx + 1]},${dec.data[offIdx + 2]}`,
    );
    // La couleur d'émission (RVB) doit être préservée dans la zone allumée.
    check(
      'Details_I couleur allumée préservée (R élevé)',
      dec.data[litIdx] > 150,
      `got R=${dec.data[litIdx]}`,
    );
  }

  // 6) applyIllumRole : non destructif + rôle EXACT dans l'alpha (255/103/3),
  //    couleur d'émission conservée sur les zones allumées, fond = RVB noir +
  //    alpha 255 (convention Nadeo). paintIllum : moitié gauche allumée
  //    (RVB=255,40,10), moitié droite éteinte (RVB=0).
  {
    const base = paintIllum(16);
    const snapshot = Uint8ClampedArray.from(base.data);
    const litPx = 0; // x=0 → allumé
    const offPx = (8) * 4; // x=8 → éteint
    for (const role of ILLUM_ROLES) {
      const res = applyIllumRole(base, role.id);
      // Alpha EXACT du rôle sur la zone allumée (pas de tolérance : avant DXT5).
      check(
        `applyIllumRole(${role.id}) alpha allumé = ${role.alpha} (exact)`,
        res.data[litPx + 3] === role.alpha,
        `got ${res.data[litPx + 3]}`,
      );
      // Couleur d'émission RVB conservée telle quelle sur la zone allumée.
      check(
        `applyIllumRole(${role.id}) RVB émission conservé`,
        res.data[litPx] === 255 && res.data[litPx + 1] === 40 && res.data[litPx + 2] === 10,
        `got ${res.data[litPx]},${res.data[litPx + 1]},${res.data[litPx + 2]}`,
      );
      // Zone éteinte : RVB noir + alpha blanc (255), quel que soit le rôle.
      check(
        `applyIllumRole(${role.id}) fond = noir + alpha 255`,
        res.data[offPx] === 0 &&
          res.data[offPx + 1] === 0 &&
          res.data[offPx + 2] === 0 &&
          res.data[offPx + 3] === 255,
        `got ${res.data[offPx]},${res.data[offPx + 1]},${res.data[offPx + 2]},a=${res.data[offPx + 3]}`,
      );
    }
    check(
      'applyIllumRole ne mute pas la source',
      base.data.every((v, i) => v === snapshot[i]),
    );
  }

  // 6b) Néon entièrement noir : les feux de vitesse sont quand même exportés,
  //     blancs, alpha 97 (compteur visible sans freiner). Le reste du calque reste éteint.
  {
    const blackImages = {} as Record<MapId, RGBAImage>;
    for (const def of MAPS) {
      const d = new Uint8ClampedArray(def.exportRes * def.exportRes * 4);
      if (def.id !== 'Details_I') d.fill(128);
      blackImages[def.id] = { width: def.exportRes, height: def.exportRes, data: d };
    }
    const blobBlack = await buildSkinZipFromImages(blackImages, {
      skinName: 'NoNeon',
      illumRole: 'brake',
      speedColor: '#ffffff',
    });
    const zipBlack = await JSZip.loadAsync(Buffer.from(await blobBlack.arrayBuffer()));
    const rearFile = zipBlack.file('Details_I.dds');
    check('Details_I noir ⇒ fichier présent (vitesse blanche)', rearFile != null);
    check('Skin_B toujours présent', zipBlack.file('Skin_B.dds') != null);
    if (rearFile) {
      const dec = decodeDDS(await rearFile.async('arraybuffer'))!;
      const size = MAP_BY_ID.Details_I.exportRes;
      const at = (u: number, v: number) => {
        const x = Math.round(u * size);
        const y = Math.round(v * size);
        return (y * size + x) * 4;
      };
      const rear = at(0.413, 0.03);
      const pill = at(0.678, 0.417);
      const off = at(0.75, 0.5);
      const feuOctagon = at(0.42, 0.1);
      check(
        'vitesse par défaut ⇒ blanc, alpha compteur (97)',
        dec.data[rear] > 180 &&
          dec.data[rear + 1] > 180 &&
          dec.data[rear + 2] > 180 &&
          Math.abs(dec.data[rear + 3] - 97) <= 12,
        `got ${dec.data[rear]},${dec.data[rear + 1]},${dec.data[rear + 2]},${dec.data[rear + 3]}`,
      );
      check(
        'hors vitesse, calque noir ⇒ éteint',
        dec.data[off] <= 20 && dec.data[off + 1] <= 20 && dec.data[off + 2] <= 20 && dec.data[off + 3] >= 235,
        `got ${dec.data[off]},${dec.data[off + 1]},${dec.data[off + 2]},${dec.data[off + 3]}`,
      );
      check(
        'pastille vitesse ⇒ blanc, alpha compteur (97)',
        dec.data[pill] > 180 &&
          dec.data[pill + 1] > 180 &&
          dec.data[pill + 2] > 180 &&
          Math.abs(dec.data[pill + 3] - 97) <= 12,
        `got ${dec.data[pill]},${dec.data[pill + 1]},${dec.data[pill + 2]}`,
      );
      check(
        'octogone FEU ⇒ pas rempli',
        dec.data[feuOctagon] <= 20 && dec.data[feuOctagon + 1] <= 20 && dec.data[feuOctagon + 2] <= 20,
        `got ${dec.data[feuOctagon]},${dec.data[feuOctagon + 1]},${dec.data[feuOctagon + 2]}`,
      );
    }
  }

  // 6c) Néon peint ailleurs : les îlots des feux arrière prennent la couleur
  //     de vitesse (blanc par défaut) et prennent l'alpha 97 du compteur.
  {
    const painted = {} as Record<MapId, RGBAImage>;
    for (const def of MAPS) {
      const d = new Uint8ClampedArray(def.exportRes * def.exportRes * 4);
      d.fill(def.id === 'Details_I' ? 0 : 128);
      if (def.id === 'Details_I') d[3] = 255;
      painted[def.id] = { width: def.exportRes, height: def.exportRes, data: d };
    }
    painted.Details_I.data[0] = 255;
    painted.Details_I.data[1] = 0;
    painted.Details_I.data[2] = 0;
    painted.Details_I.data[3] = 255;
    const blobRear = await buildSkinZipFromImages(painted, { skinName: 'RearLights', illumRole: 'always' });
    const zipRear = await JSZip.loadAsync(Buffer.from(await blobRear.arrayBuffer()));
    const decRear = decodeDDS(await zipRear.file('Details_I.dds')!.async('arraybuffer'))!;
    const size = MAP_BY_ID.Details_I.exportRes;
    const x = Math.round(0.413 * size);
    const y = Math.round(0.03 * size);
    const i = (y * size + x) * 4;
    check(
      'feu arrière laissé noir ⇒ émission blanche',
      decRear.data[i] > 180 && decRear.data[i + 1] > 180 && decRear.data[i + 2] > 180,
      `got ${decRear.data[i]},${decRear.data[i + 1]},${decRear.data[i + 2]}`,
    );
    check(
      'feu vitesse ⇒ alpha compteur (97)',
      Math.abs(decRear.data[i + 3] - 97) <= 12,
      `got ${decRear.data[i + 3]}`,
    );
  }

  // 6d) Rôle frein sur une zone peinte : la vitesse garde sa couleur et reste
  //     allumée, le pixel peint ailleurs prend l'alpha frein.
  {
    const mixed = {} as Record<MapId, RGBAImage>;
    for (const def of MAPS) {
      const d = new Uint8ClampedArray(def.exportRes * def.exportRes * 4);
      d.fill(def.id === 'Details_I' ? 0 : 128);
      if (def.id === 'Details_I') d[3] = 255;
      mixed[def.id] = { width: def.exportRes, height: def.exportRes, data: d };
    }
    const size = MAP_BY_ID.Details_I.exportRes;
    const gx = Math.round(0.75 * size);
    const gy = Math.round(0.5 * size);
    const gi = (gy * size + gx) * 4;
    mixed.Details_I.data[gi] = 0;
    mixed.Details_I.data[gi + 1] = 255;
    mixed.Details_I.data[gi + 2] = 0;
    mixed.Details_I.data[gi + 3] = 255;
    const blobMix = await buildSkinZipFromImages(mixed, {
      skinName: 'BrakeAndSpeed',
      illumRole: 'brake',
      speedColor: '#ff3300',
    });
    const zipMix = await JSZip.loadAsync(Buffer.from(await blobMix.arrayBuffer()));
    const decMix = decodeDDS(await zipMix.file('Details_I.dds')!.async('arraybuffer'))!;
    const rx = Math.round(0.413 * size);
    const ry = Math.round(0.03 * size);
    const ri = (ry * size + rx) * 4;
    check(
      'vitesse colorée ⇒ rouge, alpha compteur, même si le rôle global est frein',
      decMix.data[ri] > 180 &&
        decMix.data[ri + 1] < 120 &&
        decMix.data[ri + 2] < 80 &&
        Math.abs(decMix.data[ri + 3] - 97) <= 12,
      `got ${decMix.data[ri]},${decMix.data[ri + 1]},${decMix.data[ri + 2]},${decMix.data[ri + 3]}`,
    );
    check(
      'zone peinte hors vitesse ⇒ alpha frein',
      decMix.data[gi + 1] > 160 && decMix.data[gi + 3] < 40,
      `got ${decMix.data[gi]},${decMix.data[gi + 1]},${decMix.data[gi + 2]},${decMix.data[gi + 3]}`,
    );
  }

  // 7) Garantie « aucune map oubliée » : une map manquante lève une erreur.
  {
    const partial = { ...images };
    delete (partial as Partial<Record<MapId, RGBAImage>>).Wheels_R;
    let threw = false;
    try {
      await buildSkinZipFromImages(partial as Record<MapId, RGBAImage>, { skinName: 'x' });
    } catch {
      threw = true;
    }
    check('map manquante ⇒ erreur (pas d’oubli silencieux)', threw);
  }

  // 8) OPTIMISATION POIDS/RESPAWN : une map laissée en APLAT (couleur unie, non
  //    éditée) doit être exportée en TOUT PETIT (4×4) — mais TOUJOURS présente,
  //    avec une chaîne de mips complète et le bon FourCC — tandis qu'une map
  //    RÉELLEMENT peinte reste à sa pleine résolution. C'est le cœur du gain de
  //    temps de (re)chargement au respawn : on ne charge plus 9 maps pleines.
  {
    const FLAT_RES = 4;
    const mkFlat = (def: (typeof MAPS)[number]): RGBAImage => {
      // Aplat par défaut (blanc opaque) : uniforme → doit être rétréci.
      const d = new Uint8ClampedArray(def.exportRes * def.exportRes * 4);
      d.fill(255);
      return { width: def.exportRes, height: def.exportRes, data: d };
    };

    // Scénario « carrosserie + néon » : seules Skin_B et Details_I sont éditées.
    const flatImages = {} as Record<MapId, RGBAImage>;
    MAPS.forEach((def, idx) => {
      if (def.id === 'Skin_B') flatImages[def.id] = paintPattern(def.exportRes, idx + 1);
      else if (def.id === 'Details_I') flatImages[def.id] = paintIllum(def.exportRes);
      else flatImages[def.id] = mkFlat(def);
    });

    const blob2 = await buildSkinZipFromImages(flatImages, {
      skinName: 'FlatTest',
      illumRole: 'always',
    });
    const zip2 = await JSZip.loadAsync(Buffer.from(await blob2.arrayBuffer()));

    for (const def of MAPS) {
      const ab = await zip2.file(def.fileName)!.async('arraybuffer');
      const dv = new DataView(ab);
      const w = dv.getUint32(16, true);
      const h = dv.getUint32(12, true);
      const mips = dv.getUint32(28, true);
      const expectedMips = Math.floor(Math.log2(Math.max(w, h))) + 1;
      const edited = def.id === 'Skin_B' || def.id === 'Details_I';

      // FourCC toujours correct, même après rétrécissement.
      check(
        `${def.id} fourcc conservé après shrink`,
        fourCCStr(dv.getUint32(84, true)) === EXPECTED_FOURCC[def.format],
      );
      // Chaîne de mips TOUJOURS complète (sinon le jeu régénère au chargement).
      check(
        `${def.id} mips complets (${w}×${h} ⇒ ${expectedMips})`,
        mips === expectedMips,
        `got ${mips}`,
      );
      if (edited) {
        check(`${def.id} édité ⇒ pleine résolution ${def.exportRes}²`, w === def.exportRes,
          `got ${w}`);
      } else {
        check(`${def.id} aplat ⇒ rétréci à ${FLAT_RES}²`, w === FLAT_RES && h === FLAT_RES,
          `got ${w}×${h}`);
      }
    }

    // Preuve quantitative : le total DDS décompressé chute fortement quand seules
    // 2 maps sont éditées (au lieu des 9 maps pleines).
    let total2 = 0;
    for (const def of MAPS) total2 += (await zip2.file(def.fileName)!.async('arraybuffer')).byteLength;
    check(
      'poids DDS décompressé « carrosserie+néon » < 5 Mo',
      total2 < 5 * 1024 * 1024,
      `got ${(total2 / 1048576).toFixed(2)} Mo`,
    );
  }

  // 9) Skin 3D : MainBody.Mesh.gbx recopié tel quel, DDS hors maps aussi.
  //    Sans mesh, le zip reste un skin texture (pas de GBX).
  {
    check('passthrough fakeshad.dds', isGameZipPassthrough('fakeshad.dds'));
    check('passthrough Shape.gbx', isGameZipPassthrough('Foo.Shape.gbx'));
    check('Skin_B.dds n’est pas un passthrough', !isGameZipPassthrough('Skin_B.dds'));
    check('mesh pré-skinfix exclu', !isGameZipPassthrough('Body.Mesh.gbx'));
    check('preview.glb exclu du zip de jeu', !isGameZipPassthrough('preview.glb'));

    const mesh = new Uint8Array([7, 1, 2, 3, 4, 5, 6, 8, 9]);
    const shade = new Uint8Array([4, 4, 4, 4]);
    const blob3d = await buildSkinZipFromImages(images, {
      skinName: 'MeshSkin',
      illumRole,
      meshGbx: mesh,
      passthrough: [
        { name: 'fakeshad.dds', data: shade },
        { name: 'preview.glb', data: new Uint8Array([1]) },
        { name: 'Skin_B.dds', data: new Uint8Array([2, 2]) },
      ],
    });
    const zip3d = await JSZip.loadAsync(await blob3d.arrayBuffer());
    const meshEntry = zip3d.file(SKIN3D_MESH_FILE);
    check('MainBody.Mesh.gbx présent', !!meshEntry);
    if (meshEntry) {
      const got = new Uint8Array(await meshEntry.async('arraybuffer'));
      check(
        'MainBody.Mesh.gbx identique',
        got.length === mesh.length && mesh.every((b, i) => b === got[i]),
      );
    }
    const shadeEntry = zip3d.file('fakeshad.dds');
    check('fakeshad.dds recopié', !!shadeEntry);
    if (shadeEntry) {
      const got = new Uint8Array(await shadeEntry.async('arraybuffer'));
      check('fakeshad.dds identique', got.length === 4 && got[0] === 4);
    }
    check('preview.glb absent du zip de jeu', !zip3d.file('preview.glb'));
    const painted = zip3d.file('Skin_B.dds');
    check('Skin_B.dds reste l’encodage de l’app', !!painted && (await painted.async('arraybuffer')).byteLength !== 2);

    const plain = await buildSkinZipFromImages(images, { skinName: 'TextureOnly', illumRole });
    const zipPlain = await JSZip.loadAsync(await plain.arrayBuffer());
    check('sans mesh : pas de MainBody.Mesh.gbx', !zipPlain.file(SKIN3D_MESH_FILE));
  }

  if (failures) {
    console.error(`\n${failures} test(s) d'export en échec`);
    process.exit(1);
  }
  console.log(`\nTous les tests d'export passent (${MAPS.length} maps couvertes).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
