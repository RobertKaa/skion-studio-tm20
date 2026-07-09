/**
 * Throwaway : vérifie que TOUS les objets générés par `generateSkin` sur la
 * carrosserie (Skin_B) tombent bien à l'intérieur d'un îlot UV réel de
 * `SKIN_REGIONS` (bandes, numéros, camo, géo, éclaboussures).
 *
 * Lancer : npx.cmd tsx scripts/gen-verify.ts
 *
 * fabric a besoin d'un DOM minimal en Node : on stub `document`/`window` avec un
 * contexte 2D dont `measureText` est proportionnel à la taille de police, ce qui
 * suffit pour que la logique de placement/ajustement soit auto-cohérente.
 */

// -- DOM minimal ------------------------------------------------------------
const makeCtx = () => {
  let font = '10px sans-serif';
  const noop = () => {};
  return {
    get font() {
      return font;
    },
    set font(v: string) {
      font = v;
    },
    measureText: (s: string) => {
      const m = /(\d+(?:\.\d+)?)px/.exec(font);
      const px = m ? parseFloat(m[1]) : 10;
      return { width: s.length * px * 0.6 };
    },
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillText: noop,
    strokeText: noop,
    scale: noop,
    translate: noop,
    rotate: noop,
    transform: noop,
    setTransform: noop,
    fillRect: noop,
    clearRect: noop,
    strokeRect: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: noop,
    drawImage: noop,
  };
};
const makeEl = (tag: string) => {
  const el: Record<string, unknown> = {
    tagName: tag,
    style: {},
    width: 0,
    height: 0,
    getContext: () => makeCtx(),
    setAttribute: () => {},
    getAttribute: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: (c: unknown) => c,
    remove: () => {},
    classList: { add: () => {}, remove: () => {} },
  };
  return el;
};
(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => makeEl(tag),
  createElementNS: (_ns: string, tag: string) => makeEl(tag),
  documentElement: { style: {} },
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as unknown as { window: unknown }).window = {
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
};

// -- imports (après le stub DOM) -------------------------------------------
const { generateSkin, DEFAULT_OPTIONS, THEME_LABELS } = await import('../src/generator.ts');
const { SKIN_REGIONS, MAP_BY_ID } = await import('../src/maps.ts');
type FabricObj = { name?: string; getBoundingRect: () => { left: number; top: number; width: number; height: number } };

const S = MAP_BY_ID.Skin_B.workRes;
const regions = Object.values(SKIN_REGIONS).map((r) => ({
  x: r.x * S,
  y: r.y * S,
  w: r.w * S,
  h: r.h * S,
  label: r.label,
}));

/** Un stub d'EditorCore qui capture les objets ajoutés par map. */
function makeEditor() {
  const captured: Record<string, FabricObj[]> = {};
  const editor = {
    batch(id: string, _opts: unknown, fn: (c: unknown) => void) {
      const objs: FabricObj[] = [];
      const c = {
        backgroundColor: '',
        backgroundImage: undefined as unknown,
        add: (o: FabricObj) => objs.push(o),
        discardActiveObject: () => {},
        getObjects: () => objs,
        remove: () => {},
        requestRenderAll: () => {},
      };
      fn(c);
      captured[id] = objs;
    },
    flushTexture() {},
  };
  return { editor, captured };
}

const EPS = 1.5; // tolérance pixel
const inSomeRegion = (b: { left: number; top: number; width: number; height: number }) =>
  regions.find(
    (r) =>
      b.left >= r.x - EPS &&
      b.top >= r.y - EPS &&
      b.left + b.width <= r.x + r.w + EPS &&
      b.top + b.height <= r.y + r.h + EPS,
  );

let failures = 0;
let checked = 0;
const patterns = ['stripes', 'camo', 'geo', 'splatter'] as const;
for (const pattern of patterns) {
  for (const seed of ['1', '7', '42', '1234', '99999']) {
    const { editor, captured } = makeEditor();
    generateSkin(editor as never, {
      ...DEFAULT_OPTIONS,
      pattern,
      raceNumber: true,
      raceNumberValue: '', // aléatoire (2 chiffres)
      complexity: 90,
      seed,
    });
    for (const obj of captured.Skin_B ?? []) {
      const b = obj.getBoundingRect();
      checked++;
      const hit = inSomeRegion(b);
      if (!hit) {
        failures++;
        console.error(
          `✗ [${pattern} seed=${seed}] « ${obj.name} » hors îlot : ` +
            `left=${b.left.toFixed(0)} top=${b.top.toFixed(0)} ` +
            `right=${(b.left + b.width).toFixed(0)} bottom=${(b.top + b.height).toFixed(0)}`,
        );
      }
    }
  }
}

// Test bonus : numéro à 3 chiffres sur les flancs étroits ne doit pas déborder.
for (const seed of ['3', '8', '55']) {
  const { editor, captured } = makeEditor();
  generateSkin(editor as never, {
    ...DEFAULT_OPTIONS,
    pattern: 'solid',
    raceNumber: true,
    raceNumberValue: '888',
    seed,
  });
  for (const obj of captured.Skin_B ?? []) {
    const b = obj.getBoundingRect();
    checked++;
    if (!inSomeRegion(b)) {
      failures++;
      console.error(`✗ [numéro 888 seed=${seed}] « ${obj.name} » déborde de son îlot.`);
    }
  }
}

console.log(`\n${checked} objets vérifiés — ${failures} hors îlot.`);
if (failures > 0) {
  console.error('ÉCHEC : certains objets générés sortent des îlots UV.');
  process.exit(1);
}
console.log('OK : tous les objets générés tombent dans un îlot UV réel.');

// ---------------------------------------------------------------------------
// Vérification par THÈME : pour chaque livrée × plusieurs graines, on contrôle
//  1) les formes carrosserie (Skin_B) restent dans un îlot,
//  2) Skin_R (matériau) et Skin_CoatR (vernis) reçoivent EXACTEMENT la même
//     géométrie que Skin_B (matériau stratégique qui suit le dessin),
//  3) le néon (Details_I) reçoit bien du contenu quand il est demandé.
// ---------------------------------------------------------------------------
console.log('\n— Vérification par thème —');
const themes = [
  'random',
  'racingGT',
  'chrome',
  'stealth',
  'cyber',
  'rally',
  'retro',
  'sponsor',
  'full',
] as const;
const themeSeeds = ['1', '7', '42', '1234', '99999', '271828'];
let themeFailures = 0;
let neonForced = 0; // # de générations où on force le néon pour tester Details_I

for (const theme of themes) {
  let bMax = 0;
  let rMax = 0;
  let coatMax = 0;
  let neonMax = 0;
  let outOfIsland = 0;
  let mismatch = 0;
  for (let i = 0; i < themeSeeds.length; i++) {
    const seed = themeSeeds[i];
    // Sur la moitié des graines, on force le néon accent pour éprouver Details_I.
    const forceNeon = i % 2 === 0;
    if (forceNeon) neonForced++;
    const { editor, captured } = makeEditor();
    generateSkin(editor as never, {
      ...DEFAULT_OPTIONS,
      theme,
      complexity: 80,
      raceNumber: true,
      raceNumberValue: '',
      neon: forceNeon ? 'accent' : DEFAULT_OPTIONS.neon,
      neonRole: 'always',
      seed,
    });
    const b = captured.Skin_B ?? [];
    const r = captured.Skin_R ?? [];
    const coat = captured.Skin_CoatR ?? [];
    const neon = captured.Details_I ?? [];
    bMax = Math.max(bMax, b.length);
    rMax = Math.max(rMax, r.length);
    coatMax = Math.max(coatMax, coat.length);
    neonMax = Math.max(neonMax, neon.length);

    // 1) formes carrosserie dans un îlot (le dégradé plein-canvas est toléré).
    for (const obj of b) {
      if (obj.name === 'Dégradé de fond') continue;
      const bb = obj.getBoundingRect();
      checked++;
      if (!inSomeRegion(bb)) {
        outOfIsland++;
        themeFailures++;
        console.error(`✗ [${theme} seed=${seed}] « ${obj.name} » hors îlot.`);
      }
    }

    // 2) Skin_R et Skin_CoatR portent la même géométrie que le dessin de Skin_B.
    //    (Skin_B = fond + [dégradé] + formes ; R et Coat = uniquement les formes.)
    const designCount = b.length - (b.some((o) => o.name === 'Dégradé de fond') ? 1 : 0);
    if (r.length !== designCount || coat.length !== designCount) {
      mismatch++;
      themeFailures++;
      console.error(
        `✗ [${theme} seed=${seed}] géométrie désalignée : Skin_B=${designCount} formes, ` +
          `Skin_R=${r.length}, Skin_CoatR=${coat.length}.`,
      );
    }

    // 3) néon forcé → Details_I doit avoir au moins une bande.
    if (forceNeon && neon.length === 0) {
      themeFailures++;
      console.error(`✗ [${theme} seed=${seed}] néon demandé mais Details_I vide.`);
    }
  }
  console.log(
    `  ${THEME_LABELS[theme].padEnd(24)} Skin_B≤${bMax}  Skin_R≤${rMax}  Coat≤${coatMax}  ` +
      `Néon≤${neonMax}  (hors-îlot=${outOfIsland}, désalign.=${mismatch})`,
  );
}

console.log(`\nNéon forcé sur ${neonForced} générations, ${themeFailures} échec(s) thème.`);
if (themeFailures > 0) {
  console.error('ÉCHEC : anomalies dans la génération par thème.');
  process.exit(1);
}
console.log('OK : thèmes cohérents — matériau/vernis alignés sur le dessin, néon présent.');
