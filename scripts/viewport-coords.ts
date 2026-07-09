/**
 * Vérifie la cohérence overlay ↔ scène pour divers vpt.
 * Usage : npx.cmd tsx scripts/viewport-coords.ts
 */

const WORK_RES = 1024;
const FRAME = 500;

/** vpt pan backstore → pan cadre CSS (fix overlays). */
function overlayPan(vpt: number[], frameW: number, backW: number) {
  const s = frameW / backW;
  return [vpt[0], vpt[1], vpt[2], vpt[3], vpt[4] * s, vpt[5] * s];
}

/** Position cadre d'un point scène via matrice overlay (enfants en coords scène normalisées). */
function sceneToFrameViaOverlay(
  sceneX: number,
  sceneY: number,
  vpt: number[],
  frameW: number,
  backW: number,
) {
  const localX = (sceneX / backW) * frameW;
  const localY = (sceneY / backW) * frameW;
  const m = overlayPan(vpt, frameW, backW);
  return {
    x: m[0] * localX + m[2] * localY + m[4],
    y: m[1] * localX + m[3] * localY + m[5],
  };
}

/** Position cadre attendue (pipeline fabric : vpt backstore puis scale CSS). */
function sceneToFrameExpected(sceneX: number, sceneY: number, vpt: number[], frameW: number, backW: number) {
  const bx = vpt[0] * sceneX + vpt[2] * sceneY + vpt[4];
  const by = vpt[1] * sceneX + vpt[3] * sceneY + vpt[5];
  return { x: (bx / backW) * frameW, y: (by / backW) * frameW };
}

const cases: { name: string; vpt: number[]; scene: { x: number; y: number } }[] = [
  { name: '100 % centré', vpt: [1, 0, 0, 1, 0, 0], scene: { x: 512, y: 512 } },
  { name: '200 % centré', vpt: [2, 0, 0, 2, -512, -512], scene: { x: 512, y: 512 } },
  { name: '200 % coin', vpt: [2, 0, 0, 2, 0, 0], scene: { x: 256, y: 256 } },
  { name: '400 % + pan', vpt: [4, 0, 0, 4, -800, -200], scene: { x: 100, y: 900 } },
];

let failed = 0;
for (const { name, vpt, scene } of cases) {
  const fixed = sceneToFrameViaOverlay(scene.x, scene.y, vpt, FRAME, WORK_RES);
  // ancien bug : pan non converti
  const localX = (scene.x / WORK_RES) * FRAME;
  const localY = (scene.y / WORK_RES) * FRAME;
  const legacy = {
    x: vpt[0] * localX + vpt[4],
    y: vpt[1] * localY + vpt[5],
  };
  const expected = sceneToFrameExpected(scene.x, scene.y, vpt, FRAME, WORK_RES);
  const err = Math.hypot(fixed.x - expected.x, fixed.y - expected.y);
  const legacyErr = Math.hypot(legacy.x - expected.x, legacy.y - expected.y);
  const ok = err < 0.01;
  if (!ok) failed++;
  console.log(
    `${ok ? '✓' : '✗'} ${name}: err=${err.toFixed(2)}px (legacy=${legacyErr.toFixed(2)}px) scene=(${scene.x},${scene.y})`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} cas en échec`);
  process.exit(1);
}
console.log('\nTous les cas overlay ↔ scène sont cohérents.');

// ---------------------------------------------------------------------------
// Invariant : pan/zoom ne modifie pas les coords scène des objets ni la texture.
// ---------------------------------------------------------------------------

/** Coords objet (inchangées par le vpt — le vpt n'est que visuel). */
function applyVptToScenePoint(sceneX: number, sceneY: number, vpt: number[]) {
  return {
    x: vpt[0] * sceneX + vpt[2] * sceneY + vpt[4],
    y: vpt[1] * sceneX + vpt[3] * sceneY + vpt[5],
  };
}

/** Pixel texture (vpt identité) : coords scène = coords pixel. */
function texturePixel(sceneX: number, sceneY: number) {
  return { x: sceneX, y: sceneY };
}

const objectAt = { left: 320, top: 480 };
const vptCases = [
  [1, 0, 0, 1, 0, 0],
  [2, 0, 0, 2, -512, -512],
  [4, 0, 0, 4, -800, -200],
  [1, 0, 0, 1, 150, -80],
];

let objFailed = 0;
for (let i = 0; i < vptCases.length; i++) {
  const vpt = vptCases[i];
  const display = applyVptToScenePoint(objectAt.left, objectAt.top, vpt);
  const tex = texturePixel(objectAt.left, objectAt.top);
  const isIdentity = vpt[0] === 1 && vpt[4] === 0 && vpt[5] === 0;
  const texMatchesScene = tex.x === objectAt.left && tex.y === objectAt.top;
  const displayDiffersWhenPanned =
    isIdentity || Math.hypot(display.x - tex.x, display.y - tex.y) > 0.01;
  const ok = texMatchesScene && displayDiffersWhenPanned;
  if (!ok) objFailed++;
  console.log(
    `${ok ? '✓' : '✗'} objet (${objectAt.left},${objectAt.top}) vpt zoom=${vpt[0]} pan=(${vpt[4]},${vpt[5]}) → écran (${display.x.toFixed(0)},${display.y.toFixed(0)}), texture (${tex.x},${tex.y})`,
  );
}

if (objFailed > 0) {
  console.error(`\n${objFailed} cas coords objet en échec`);
  process.exit(1);
}
console.log('\nCoords scène stables ; seul l\'affichage (vpt) se décale — la texture reste fixe.');

// ---------------------------------------------------------------------------
// scenePointToFrameLocal (coords cadre absolues, hors overlay React).
// ---------------------------------------------------------------------------

function scenePointToFrameLocal(
  sceneX: number,
  sceneY: number,
  vpt: number[],
  frameW: number,
  backW: number,
) {
  const s = frameW / backW;
  const bx = vpt[0] * sceneX + vpt[2] * sceneY + vpt[4];
  const by = vpt[1] * sceneX + vpt[3] * sceneY + vpt[5];
  return { x: bx * s, y: by * s };
}

/** Ancien bug : zoom appliqué en backstore, pan déjà en px cadre. */
function scenePointToFrameLegacy(sceneX: number, sceneY: number, vpt: number[], frameW: number, backW: number) {
  const s = frameW / backW;
  return {
    x: vpt[0] * sceneX + vpt[2] * sceneY + vpt[4] * s,
    y: vpt[1] * sceneX + vpt[3] * sceneY + vpt[5] * s,
  };
}

function brushDiameterInFrame(brushSize: number, zoom: number, frameW: number, backW: number) {
  return brushSize * zoom * (frameW / backW);
}

let frameFailed = 0;
for (const { name, vpt, scene } of cases) {
  const fixed = scenePointToFrameLocal(scene.x, scene.y, vpt, FRAME, WORK_RES);
  const legacy = scenePointToFrameLegacy(scene.x, scene.y, vpt, FRAME, WORK_RES);
  const expected = sceneToFrameExpected(scene.x, scene.y, vpt, FRAME, WORK_RES);
  const err = Math.hypot(fixed.x - expected.x, fixed.y - expected.y);
  const legacyErr = Math.hypot(legacy.x - expected.x, legacy.y - expected.y);
  const ok = err < 0.01;
  if (!ok) frameFailed++;
  console.log(
    `${ok ? '✓' : '✗'} frameLocal ${name}: err=${err.toFixed(2)}px (legacy=${legacyErr.toFixed(2)}px)`,
  );
}

if (frameFailed > 0) {
  console.error(`\n${frameFailed} cas scenePointToFrameLocal en échec`);
  process.exit(1);
}

const brushCases = [
  { zoom: 1, brush: 18 },
  { zoom: 2, brush: 18 },
  { zoom: 4, brush: 40 },
];
for (const { zoom, brush } of brushCases) {
  const d = brushDiameterInFrame(brush, zoom, FRAME, WORK_RES);
  const expected = brush * zoom * (FRAME / WORK_RES);
  const ok = Math.abs(d - expected) < 0.01;
  console.log(`${ok ? '✓' : '✗'} brush Ø zoom=${zoom} size=${brush}: ${d.toFixed(2)}px (attendu ${expected.toFixed(2)})`);
  if (!ok) frameFailed++;
}

if (frameFailed > 0) {
  process.exit(1);
}
console.log('\nAperçu pinceau (frame absolu) cohérent avec fabric.');
