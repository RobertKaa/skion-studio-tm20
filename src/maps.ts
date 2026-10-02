export type MapId =
  | 'Skin_B'
  | 'Skin_R'
  | 'Skin_I'
  | 'Skin_CoatR'
  | 'Skin_DirtMask'
  | 'Details_B'
  | 'Details_R'
  | 'Details_I'
  | 'Details_DirtMask'
  | 'Wheels_B'
  | 'Wheels_R'
  | 'Wheels_I'
  | 'Wheels_DirtMask';

export type BCFormat = 'BC1' | 'BC3' | 'BC4' | 'BC5';

/**
 * Rôle du canal, pour adapter l'UI d'édition :
 * - basecolor : couleur RVB classique
 * - roughmetal : R = rugosité, G = métal (sliders dédiés + légende)
 * - grayscale : niveaux de gris (vernis, saleté)
 * - illum : auto-illumination (néon / feux), couleur RVB + rôle via l'alpha
 */
export type MapKind = 'basecolor' | 'roughmetal' | 'grayscale' | 'illum';

export interface MapDef {
  id: MapId;
  label: string;
  fileName: string;
  format: BCFormat;
  kind: MapKind;
  /** Groupe de matériau (utilisé pour le regroupement visuel des onglets). */
  group: 'skin' | 'details' | 'wheels';
  /** Résolution de travail du canvas d'édition */
  workRes: number;
  /** Résolution d'export dans le DDS */
  exportRes: number;
  defaultFill: string;
  description: string;
}

export const MAPS: MapDef[] = [
  {
    id: 'Skin_B',
    label: 'Carrosserie',
    fileName: 'Skin_B.dds',
    format: 'BC1',
    kind: 'basecolor',
    group: 'skin',
    workRes: 1024,
    exportRes: 2048,
    defaultFill: '#c4c8cc',
    description: 'Couleur de base de la carrosserie (RVB).',
  },
  {
    id: 'Skin_R',
    label: 'Rugosité / Métal',
    fileName: 'Skin_R.dds',
    format: 'BC5',
    kind: 'roughmetal',
    group: 'skin',
    workRes: 1024,
    // Rugosité/métal = données basse fréquence : 1024 est visuellement identique
    // à 2048 sur la voiture, pour 4× moins de VRAM à (re)charger au respawn.
    exportRes: 1024,
    defaultFill: '#5a3c00',
    description:
      'Réglez la brillance et l’aspect métallique de la carrosserie. Une faible rugosité donne des reflets nets ; une forte rugosité donne un aspect mat.',
  },
  {
    id: 'Skin_I', label: 'Carrosserie néon / feux', fileName: 'Skin_I.dds',
    format: 'BC3', kind: 'illum', group: 'skin', workRes: 1024, exportRes: 2048,
    defaultFill: '#000000',
    description: 'Lumière de la carrosserie. Ajoutez une image ou peignez sur les pièces ; noir = éteint. Chaque élément possède son propre comportement.',
  },
  {
    id: 'Skin_CoatR',
    label: 'Vernis',
    fileName: 'Skin_CoatR.dds',
    format: 'BC4',
    kind: 'grayscale',
    group: 'skin',
    workRes: 1024,
    // Masque de vernis basse fréquence : 1024 suffit largement (4× moins lourd).
    exportRes: 1024,
    defaultFill: '#000000',
    description:
      'Niveaux de gris : blanc = vernis brillant / peinture pailletée, noir = aucun vernis. Peignez en blanc les zones à vernir.',
  },
  {
    id: 'Skin_DirtMask',
    label: 'Masque de saleté',
    fileName: 'Skin_DirtMask.dds',
    format: 'BC4',
    kind: 'grayscale',
    group: 'skin',
    workRes: 1024,
    // Masque de saleté basse fréquence : 1024 suffit largement (4× moins lourd).
    exportRes: 1024,
    defaultFill: '#000000',
    description:
      'Masque de saleté de la carrosserie : 0 % (noir) protège la peinture ; 100 % (blanc) autorise la saleté. Les gris dosent son effet, sans changer la couleur du skin.',
  },
  {
    id: 'Details_B',
    label: 'Détails',
    fileName: 'Details_B.dds',
    format: 'BC1',
    kind: 'basecolor',
    group: 'details',
    workRes: 1024,
    exportRes: 1024,
    defaultFill: '#7a7d80',
    description: 'Couleur des éléments de détail (aileron, châssis, intérieur…).',
  },
  {
    id: 'Details_R',
    label: 'Détails rugosité / métal',
    fileName: 'Details_R.dds',
    format: 'BC5',
    kind: 'roughmetal',
    group: 'details',
    workRes: 1024,
    exportRes: 1024,
    defaultFill: '#8c5a00',
    description:
      'Brillance et aspect métallique de l’aileron, du châssis et des autres détails. Les finitions peuvent être différentes sur chaque élément.',
  },
  {
    id: 'Details_I',
    label: 'Détails néon / feux',
    fileName: 'Details_I.dds',
    format: 'BC3',
    kind: 'illum',
    group: 'details',
    workRes: 1024,
    exportRes: 1024,
    defaultFill: '#000000',
    description:
      'Peignez les zones qui émettent de la lumière. Noir = éteint. Chaque calque peut être un néon permanent, un phare de nuit ou un feu de frein. Le compteur a sa propre couleur.',
  },
  {
    id: 'Details_DirtMask', label: 'Détails · masque de saleté', fileName: 'Details_DirtMask.dds',
    format: 'BC4', kind: 'grayscale', group: 'details', workRes: 1024, exportRes: 1024,
    defaultFill: '#000000', description: 'Masque de saleté des détails : 0 % protège les pièces ; 100 % autorise la saleté. Peignez les zones séparément pour doser l’effet.',
  },
  {
    id: 'Wheels_B',
    label: 'Roues',
    fileName: 'Wheels_B.dds',
    format: 'BC1',
    kind: 'basecolor',
    group: 'wheels',
    workRes: 1024,
    exportRes: 1024,
    defaultFill: '#2b2d30',
    description:
      'Couleur des jantes et pneus. La jante (flanc de roue) et le pneu occupent des îlots UV distincts — voir le repère « côté de la roue ».',
  },
  {
    id: 'Wheels_R',
    label: 'Roues rugosité / métal',
    fileName: 'Wheels_R.dds',
    format: 'BC5',
    kind: 'roughmetal',
    group: 'wheels',
    workRes: 1024,
    exportRes: 1024,
    defaultFill: '#d91a00',
    description:
      'Brillance et aspect métallique des roues. Pour une jante en chrome ou en alu, augmentez le métal et réduisez la rugosité. Le pneu peut garder une finition mate.',
  },
  {
    id: 'Wheels_I', label: 'Roues néon / feux', fileName: 'Wheels_I.dds',
    format: 'BC3', kind: 'illum', group: 'wheels', workRes: 1024, exportRes: 1024,
    defaultFill: '#000000', description: 'Lumière des roues. Images et dessins restent éditables séparément ; noir = éteint.',
  },
  {
    id: 'Wheels_DirtMask', label: 'Roues · masque de saleté', fileName: 'Wheels_DirtMask.dds',
    format: 'BC4', kind: 'grayscale', group: 'wheels', workRes: 1024, exportRes: 1024,
    defaultFill: '#000000', description: 'Masque de saleté des roues : 0 % protège pneus et jantes ; 100 % autorise la saleté. Ce masque modifie uniquement l’apparence.',
  },
];

export const DIRT_MASK_IDS: MapId[] = ['Skin_DirtMask', 'Details_DirtMask', 'Wheels_DirtMask'];
export const isDirtMask = (id: MapId) => DIRT_MASK_IDS.includes(id);

export const MAP_BY_ID: Record<MapId, MapDef> = Object.fromEntries(
  MAPS.map((m) => [m.id, m]),
) as Record<MapId, MapDef>;

/** Painting another mesh family must keep the same appearance channel. */
export function resolvePaintMap(activeMap: MapId, family: MapDef['group']): MapId | null {
  const current = MAP_BY_ID[activeMap];
  if (current.group === family) return activeMap;
  return MAPS.find((map) => map.group === family && map.kind === current.kind &&
    (current.kind !== 'grayscale' || isDirtMask(map.id) === isDirtMask(activeMap)))?.id ?? null;
}

/** Résout un nom de fichier (issu d'un zip importé) vers une map connue. */
export function mapIdFromFileName(fileName: string): MapId | null {
  const stem = fileName
    .split(/[/\\]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, MapId> = {
    skinb: 'Skin_B',
    skindiffuse: 'Skin_B',
    skinr: 'Skin_R',
    skini: 'Skin_I',
    skinillum: 'Skin_I',
    skincoatr: 'Skin_CoatR',
    skindirtmask: 'Skin_DirtMask',
    detailsb: 'Details_B',
    detailsdiffuse: 'Details_B',
    detailsr: 'Details_R',
    detailsi: 'Details_I',
    detailsillum: 'Details_I',
    detailsdirtmask: 'Details_DirtMask',
    wheelsb: 'Wheels_B',
    wheelsdiffuse: 'Wheels_B',
    wheelsr: 'Wheels_R',
    wheelsi: 'Wheels_I',
    wheelsillum: 'Wheels_I',
    wheelsdirtmask: 'Wheels_DirtMask',
  };
  return aliases[stem] ?? null;
}

/**
 * Rôle des zones illuminées d'une map `_I`. TM2020 lit une valeur précise dans
 * le canal ALPHA pour décider quand la zone s'allume :
 * - always  : blanc (255) → toujours allumé (néons, tableau de bord…)
 * - head    : ~103 (#67) → phares (allumés la nuit / tunnels)
 * - brake   : ~3 (#03) → feux de frein (s'allument au freinage)
 * La couleur (RVB) peinte reste la couleur d'émission ; seul l'alpha porte le rôle.
 */
export type IllumRole = 'always' | 'head' | 'brake';

export const ILLUM_ROLES: { id: IllumRole; label: string; alpha: number }[] = [
  { id: 'always', label: 'Toujours allumé (néon)', alpha: 255 },
  { id: 'head', label: 'Phares (nuit)', alpha: 0x67 },
  { id: 'brake', label: 'Feux de frein', alpha: 0x03 },
];

/** Zones UV utilisées par l'aperçu 3D et le guide (fractions du canvas, origine en haut à gauche). */
export interface UVRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/**
 * Orientation « voiture » d'un îlot UV : rotation (degrés, sens horaire fabric) et
 * miroir horizontal à appliquer à un décalque/numéro dessiné DROIT dans le canvas
 * pour qu'il apparaisse DROIT / vers l'avant SUR LA VOITURE.
 *
 * Valeurs DÉRIVÉES de la vraie géométrie FBX (voir scripts/uv-orient.ts) : pour
 * chaque îlot on ajuste la carte linéaire monde→canvas (moindres carrés) puis on
 * calcule comment la direction « haut voiture » de référence se projette dans le
 * canvas. Repère monde vérifié : +Z = avant (nez), +Y = haut, +X = flanc GAUCHE.
 *
 * Référence « haut » choisie par pièce :
 *   - panneaux ~horizontaux (toit/capot, ailes) : le haut du décalque pointe vers
 *     l'AVANT (+Z) ;
 *   - flancs et faces avant/arrière : le haut du décalque pointe vers le HAUT (+Y).
 */
export interface RegionOrientation {
  /** Rotation en degrés (sens horaire, convention fabric). */
  angle: number;
  /** Miroir horizontal (l'îlot UV est déplié en miroir). */
  flipX: boolean;
}

/**
 * Orientation par pièce, mesurée sur le FBX (scripts/uv-orient.ts). Les grands
 * panneaux plats sont calés sur le multiple de 90° le plus proche (l'écart vient
 * de la courbure) ; les ailes gardent leur angle diagonal réel.
 */
export const REGION_ORIENTATION: Record<string, RegionOrientation> = {
  top: { angle: 180, flipX: false },
  left: { angle: 271, flipX: false },
  right: { angle: 89, flipX: false },
  archL: { angle: 163, flipX: true },
  archR: { angle: 163, flipX: false },
  front: { angle: 359, flipX: false },
  rear: { angle: 177, flipX: false },
  spoiler: { angle: 359, flipX: false },
  sillL: { angle: 279, flipX: false },
  sillR: { angle: 81, flipX: false },
  shoulderL: { angle: 182, flipX: false },
  shoulderR: { angle: 178, flipX: false },
  rearLow: { angle: 179, flipX: true },
  rearSideL: { angle: 63, flipX: true },
  // --- DÉTAILS (mesh Details_01) : mesuré par scripts/uv-details-gen.ts.
  // Chaque zone regroupe les îlots qui regardent la même face. L'angle est
  // l'orientation moyenne (décalque droit sur la voiture).
  d_tail_hi: { angle: 311, flipX: true },
  d_tail: { angle: 269, flipX: true },
  d_head: { angle: 83, flipX: false },
  d_wing: { angle: 262, flipX: true },
  d_cockpit: { angle: 171, flipX: false },
  d_hood: { angle: 275, flipX: true },
  d_front: { angle: 267, flipX: false },
  d_rear: { angle: 282, flipX: true },
  d_side_r: { angle: 131, flipX: true },
  d_floor: { angle: 263, flipX: false },
  d_body: { angle: 163, flipX: true },
};

/** Orientation « voiture » d'une pièce (défaut neutre si la clé est inconnue). */
export function getRegionOrientation(key: string): RegionOrientation {
  return REGION_ORIENTATION[key] ?? { angle: 0, flipX: false };
}

/**
 * Îlots UV réels du mesh `Skin_01` du modèle Stadium Car TM2020, mesurés
 * directement sur le FBX (voir scripts/uv-islands.ts) : chaque rectangle est la
 * bounding box d'un îlot UV, en fractions 0..1, origine en haut à gauche (repère
 * de l'éditeur, cohérent avec `flipY = true` de la CanvasTexture).
 *
 * Contrairement à l'ancien découpage (pensé pour la voiture procédurale), la
 * texture du vrai modèle est dépliée en panneaux irréguliers avec symétrie
 * gauche/droite. Peindre à l'intérieur d'un rectangle atteint donc la partie
 * correspondante de la voiture dans l'aperçu 3D.
 *
 * CONVENTION D'AXES VÉRIFIÉE (scripts/uv-orient.ts + scripts/uv-frontcheck.ts) :
 *   - +Z = AVANT (nez) : confirmé par l'effilement du nez côté +Z puis l'aile
 *     avant large à l'extrémité, et la verrière centrale.
 *   - +Y = HAUT.
 *   - +X = flanc GAUCHE, −X = flanc DROIT (repère main droite, det(monde)=+1 :
 *     droite = avant × haut = +Z × +Y = −X, donc gauche = +X).
 * Les libellés ci-dessous ont été RE-VÉRIFIÉS contre les centroïdes 3D réels des
 * îlots : l'îlot à u≈0.8 a un centroïde monde x≈+60 (⇒ gauche) et celui à u≈0.15
 * un centroïde x≈−60 (⇒ droite) ; l'îlot « avant » est à z≈+174 (nez). Aucun
 * échange gauche/droite ni avant/arrière n'est nécessaire.
 * Voir REGION_ORIENTATION pour l'angle/miroir « voiture » de chaque pièce.
 */
export const SKIN_REGIONS: Record<string, UVRegion> = {
  // Panneau central : habitacle + toit + capot (plus gros îlot UV).
  top: { x: 0.266, y: 0.006, w: 0.468, h: 0.805, label: 'TOIT / CAPOT' },
  // Flancs : îlots distincts (pas de miroir). Vérifié : u≈0.8 → monde +X = GAUCHE.
  left: { x: 0.721, y: 0.384, w: 0.157, h: 0.366, label: 'FLANC GAUCHE' },
  right: { x: 0.122, y: 0.384, w: 0.157, h: 0.366, label: 'FLANC DROIT' },
  // Jantes : deux disques (vérifié en 3D avec une texture diagnostique — ils
  // habillent les roues, pas les ailes). Chaque disque est partagé par les
  // roues des deux côtés (centroïde monde x≈0). Le disque le plus grand
  // (archR) correspond aux roues arrière, plus larges sur la CarSport.
  archL: { x: 0.082, y: 0.024, w: 0.199, h: 0.198, label: 'JANTES AV.' },
  archR: { x: 0.7, y: 0.016, w: 0.228, h: 0.228, label: 'JANTES AR.' },
  // Nez avant.
  front: { x: 0.387, y: 0.793, w: 0.226, h: 0.202, label: 'AVANT (nez)' },
  // Bloc / bouclier arrière.
  rear: { x: 0.043, y: 0.868, w: 0.336, h: 0.112, label: 'ARRIÈRE' },
  // Winglets / aileron latéral.
  spoiler: { x: 0.622, y: 0.703, w: 0.218, h: 0.203, label: 'AILERON' },
  // Bas de caisse latéral (bandes verticales aux bords de l'atlas UV).
  sillL: { x: 0.893, y: 0.063, w: 0.096, h: 0.689, label: 'BAS DE CAISSE G.' },
  sillR: { x: 0.010, y: 0.063, w: 0.096, h: 0.689, label: 'BAS DE CAISSE D.' },
  // Épaules / passages de roue supérieurs (au-dessus des flancs).
  shoulderL: { x: 0.678, y: 0.268, w: 0.168, h: 0.170, label: 'ÉPAULE G.' },
  shoulderR: { x: 0.153, y: 0.268, w: 0.168, h: 0.170, label: 'ÉPAULE D.' },
  // Sous le bloc arrière (diffuseur / bas de caisse arrière).
  rearLow: { x: 0.043, y: 0.758, w: 0.294, h: 0.108, label: 'SOUS ARRIÈRE' },
  // Coins arrière latéraux gauche (petits îlots près de l'aileron).
  rearSideL: { x: 0.665, y: 0.763, w: 0.316, h: 0.228, label: 'ARRIÈRE LAT. G.' },
};

/**
 * Zones UV des DÉTAILS (mesh `Details_01`), mesurées sur le FBX par
 * scripts/uv-details-gen.ts. Les îlots sont classés par la face qu'ils
 * regardent (normale d'abord) :
 *   - d_tail_hi / d_tail : petits îlots face arrière (feux, panneau des chiffres),
 *   - d_head             : petits îlots face avant (phares),
 *   - les autres         : aileron, cockpit, capot, avant, arrière, flanc, dessous.
 *
 * Le rectangle est la bounding-box UNION (souvent large, les îlots sont
 * dispersés). Le remplissage et le guide utilisent les contours réels
 * (UV_GUIDE_ISLANDS), pas ce rectangle.
 */
export const DETAILS_REGIONS: Record<string, UVRegion> = {
  d_tail_hi: { x: 0.0576, y: 0.2451, w: 0.918, h: 0.6211, label: 'FEU ARRIÈRE HAUT' },
  d_tail: { x: 0.002, y: 0.0215, w: 0.9453, h: 0.9746, label: 'FEU ARRIÈRE' },
  d_head: { x: 0.002, y: 0.0645, w: 0.9824, h: 0.9316, label: 'PHARE' },
  d_wing: { x: 0.0244, y: 0.0293, w: 0.9678, h: 0.9678, label: 'AILERON' },
  d_cockpit: { x: 0.0029, y: 0.002, w: 0.8662, h: 0.8994, label: 'COCKPIT' },
  d_hood: { x: 0.1357, y: 0.0068, w: 0.7168, h: 0.9893, label: 'CAPOT' },
  d_front: { x: 0.002, y: 0.0029, w: 0.9922, h: 0.9941, label: 'AVANT' },
  d_rear: { x: 0.0605, y: 0.0029, w: 0.9336, h: 0.9941, label: 'ARRIÈRE' },
  d_side_r: { x: 0.5752, y: 0.3633, w: 0.2715, h: 0.4131, label: 'FLANC DROIT' },
  d_floor: { x: 0.002, y: 0.0244, w: 0.9922, h: 0.9727, label: 'DESSOUS' },
  d_body: { x: 0.002, y: 0.0039, w: 0.9922, h: 0.9932, label: 'CARÉNAGE' },
};

/** Ensembles de zones UV par famille de map (pour l'UI « Remplir une pièce »). */
export const REGIONS_BY_FAMILY: Partial<Record<MapDef['group'], Record<string, UVRegion>>> = {
  skin: SKIN_REGIONS,
  details: DETAILS_REGIONS,
};

/** Cibles de copie pixel-perfect entre maps compatibles (même UV/layout). */
export const COPY_COMPATIBLE_TARGETS: Record<MapId, MapId[]> = {
  Skin_B: ['Skin_R', 'Skin_I', 'Skin_CoatR', 'Skin_DirtMask'],
  Skin_R: ['Skin_B', 'Skin_I', 'Skin_CoatR', 'Skin_DirtMask'],
  Skin_I: ['Skin_B', 'Skin_R', 'Skin_CoatR', 'Skin_DirtMask'],
  Skin_CoatR: ['Skin_B', 'Skin_R', 'Skin_I', 'Skin_DirtMask'],
  Skin_DirtMask: ['Skin_B', 'Skin_R', 'Skin_I', 'Skin_CoatR'],
  Details_B: ['Details_R', 'Details_I', 'Details_DirtMask'],
  Details_R: ['Details_B', 'Details_I', 'Details_DirtMask'],
  Details_I: ['Details_B', 'Details_R', 'Details_DirtMask'],
  Details_DirtMask: ['Details_B', 'Details_R', 'Details_I'],
  Wheels_B: ['Wheels_R', 'Wheels_I', 'Wheels_DirtMask'],
  Wheels_R: ['Wheels_B', 'Wheels_I', 'Wheels_DirtMask'],
  Wheels_I: ['Wheels_B', 'Wheels_R', 'Wheels_DirtMask'],
  Wheels_DirtMask: ['Wheels_B', 'Wheels_R', 'Wheels_I'],
};
