#!/usr/bin/env node
// examples/three-hud/build.js — prove the HUD, then bake it for three.js.
//
// Pipeline:
//   1. Load hud.shen — Tier 1 static proofs (assert-fits) run at load time.
//   2. enforce-props: every locale bundle in locales.json is checked against
//      the (prop-spec ...) bounds declared in hud.shen. A translation that
//      outgrows its slot FAILS THE BUILD here, with the key named — before
//      any texture exists.
//   3. Worst-case proofs for the two runtime-dynamic strings (player name,
//      score): the pinned font is strictly monospace, so proving an N-char
//      string of any glyph proves EVERY string of <= N chars. The runtime
//      enforces the same N; see WORST_CASE below.
//   4. SSR each HUD panel per locale (solve-layout + render-html-doc) and
//      extract the fragments + solved row geometry.
//   5. Emit a self-contained index.html: three.js UMD + the exact measured
//      TTF (base64) + fragments + runtime.js. Works offline from file://.
//
// Usage: node examples/three-hud/build.js   (writes examples/three-hud/index.html)

const fs = require('fs');
const path = require('path');
const { boot, PINNED_FONT_FAMILY, PINNED_FONT_FILE } = require('../../boot');

const DIR = __dirname;
const OUT_FILE = path.join(DIR, 'index.html');
const LOCALES = JSON.parse(fs.readFileSync(path.join(DIR, 'locales.json'), 'utf8'));

// Worst-case ceilings for runtime-dynamic strings. Monospace worst case:
// N repetitions of any glyph measure identically to every N-char string.
// SLOT is the pixel budget the runtime draws into (HUD_DATA.bounds mirrors
// this object verbatim, and the runtime clamps to the same ceilings).
const WORST_CASE = {
  NAME_MAX: 12, NAME_FONT: 14, NAME_SLOT: 104,
  SCORE_DIGITS: 6, SCORE_FONT: 20, SCORE_SLOT: 76,
};

async function main() {
  const $ = await boot();
  await $.exec('(tc -)');
  await $.load(path.join(DIR, 'hud.shen')); // Tier 1 proofs run here
  await $.exec('(set __hud_specs (harvest-prop-specs))');

  // --- Tier 2: enforce every locale bundle against the declared bounds ---
  for (const [loc, bundle] of Object.entries(LOCALES)) {
    await $.define('__hud_props', () => bundle);
    try {
      await $.exec('(enforce-props (value __hud_specs) (__hud_props))');
    } catch (err) {
      console.error(`✗ locale '${loc}' violates the HUD contract:\n${err.message}`);
      process.exit(1);
    }
    console.log(`✓ locale '${loc}': all prop-spec bounds hold`);
  }

  // --- Worst-case proofs for runtime-dynamic slots ---
  const worst = async (label, text, px, slot) => {
    await $.exec(
      `(assert-fits ${JSON.stringify(text)} (mk-font "${PINNED_FONT_FAMILY}" ${px}) ${slot})`
    );
    console.log(`✓ worst case '${label}': ${JSON.stringify(text)} @${px}px fits ${slot}px`);
  };
  await worst('player name', 'M'.repeat(WORST_CASE.NAME_MAX), WORST_CASE.NAME_FONT, WORST_CASE.NAME_SLOT);
  await worst('score', '0'.repeat(WORST_CASE.SCORE_DIGITS), WORST_CASE.SCORE_FONT, WORST_CASE.SCORE_SLOT);

  // --- SSR each panel per locale ---
  // Locale strings are passed via $.define thunks (never spliced into shen
  // source) so quoting and non-ASCII round-trip exactly.
  async function renderPanel(expr) {
    const doc = await $.exec(`(render-html-doc (solve-layout ${expr} 400 800))`);
    const body = doc.match(/<body>\s*([\s\S]*?)\s*<\/body>/);
    if (!body) throw new Error('no <body> in render output');
    const frag = body[1];
    const root = frag.match(/width:(\d+(?:\.\d+)?)px;height:(\d+(?:\.\d+)?)px/);
    // Direct children of the root frame: absolutely positioned rows. Their
    // solved top/height lets the runtime composite bars and digits in exact
    // alignment with the proven label column.
    const rows = [];
    const rowRe = /left:(?:12|14|20)px;top:([\d.]+)px;width:[\d.]+px;height:([\d.]+)px/g;
    for (let m; (m = rowRe.exec(frag)); ) {
      rows.push({ top: parseFloat(m[1]), h: parseFloat(m[2]) });
    }
    return {
      frag,
      w: Math.ceil(parseFloat(root[1])),
      h: Math.ceil(parseFloat(root[2])),
      rows,
    };
  }

  const locales = {};
  for (const [loc, bundle] of Object.entries(LOCALES)) {
    const arg = async (name, value) => { await $.define(name, () => value); };
    await arg('__a1', bundle['score.label']);
    await arg('__a2', bundle['health.label']);
    await arg('__a3', bundle['stamina.label']);
    await arg('__a4', bundle['prompt']);
    await arg('__a5', bundle['item.name']);
    await arg('__a6', bundle['item.rarity']);
    await arg('__a7', bundle['item.blurb']);
    locales[loc] = {
      status: await renderPanel('(hud-status-panel (__a1) (__a2) (__a3))'),
      prompt: await renderPanel('(hud-prompt-panel (__a4))'),
      tooltip: await renderPanel('(hud-tooltip-panel (__a5) (__a6) (__a7))'),
    };
    console.log(
      `✓ baked '${loc}': status ${locales[loc].status.w}x${locales[loc].status.h}, ` +
      `prompt ${locales[loc].prompt.w}x${locales[loc].prompt.h}, ` +
      `tooltip ${locales[loc].tooltip.w}x${locales[loc].tooltip.h}`
    );
  }

  // --- Assemble the self-contained page ---
  const fontDataUri = 'data:font/ttf;base64,' +
    fs.readFileSync(PINNED_FONT_FILE).toString('base64');
  const threeSrc = fs.readFileSync(path.join(DIR, 'vendor', 'three.min.js'), 'utf8');
  const runtimeSrc = fs.readFileSync(path.join(DIR, 'runtime.js'), 'utf8');

  const localeCount = Object.keys(LOCALES).length;
  const slotCount = Object.values(LOCALES)[0] ? Object.keys(Object.values(LOCALES)[0]).length : 0;
  const hudData = {
    fontFamily: PINNED_FONT_FAMILY,
    fontDataUri,
    locales,
    bounds: WORST_CASE,
    defaultLocale: 'en',
  };

  const html = `<!DOCTYPE html>
<!-- Generated by examples/three-hud/build.js — do not edit by hand.
     Every string in the HUD textures below was proven (or explicitly
     handled) by witness at build time; the embedded TTF is the exact file
     Node measured with. -->
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>witness — proven HUD in three.js</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; box-sizing: border-box; }
  body {
    height: 100vh; display: flex; flex-direction: column;
    background: #060913; color: #cbd5e1; font-family: system-ui, sans-serif;
    overflow: hidden;
  }
  header { text-align: center; padding: 14px 16px 10px; }
  header h1 { color: #f1f5f9; font-size: 18px; font-weight: 650; }
  header p { font-size: 12px; color: #7c8aa5; margin-top: 3px; }
  header .proof { color: #4ade80; }
  #scene { flex: 1; width: 100%; min-height: 0; touch-action: none; cursor: grab; }
  footer {
    display: flex; gap: 14px; align-items: center; justify-content: center;
    flex-wrap: wrap; padding: 10px 16px 14px; font-size: 12px; color: #7c8aa5;
  }
  footer button {
    background: #172136; color: #bfdbfe; border: 1px solid #2b3b5c;
    border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer;
  }
  footer button:hover { background: #1d2b47; }
  footer button.active { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
  footer input {
    background: #0d1526; color: #e2e8f0; border: 1px solid #2b3b5c;
    border-radius: 8px; padding: 5px 10px; font-size: 12px; width: 130px;
  }
  footer label { display: flex; gap: 6px; align-items: center; }
</style>
</head>
<body>
<header>
  <h1>Proven HUD, rendered by three.js</h1>
  <p>
    Every HUD texture below was typeset from witness-proven HTML.
    <span class="proof">${2 + 2} static proofs ✓</span>
    <span class="proof">${slotCount} slots × ${localeCount} locales enforced ✓</span>
    <span class="proof">worst-case: name ≤ ${WORST_CASE.NAME_MAX} ch, score ≤ ${'9'.repeat(WORST_CASE.SCORE_DIGITS)} ✓</span>
  </p>
  <p>Drag to orbit · click shards to collect · hover the amber prism, then press E</p>
</header>
<canvas id="scene"></canvas>
<footer>
  <span>Locale</span>
  <button data-locale="en">EN</button>
  <button data-locale="de">DE</button>
  <button data-locale="fr">FR</button>
  <label>Player name <input id="name" spellcheck="false"></label>
  <span id="hint">name is clamped to the proven ${WORST_CASE.NAME_MAX}-char worst case</span>
</footer>
<script>${threeSrc}</script>
<script>window.HUD_DATA = ${JSON.stringify(hudData)};</script>
<script>${runtimeSrc}</script>
</body>
</html>
`;

  fs.writeFileSync(OUT_FILE, html);
  const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
  console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)} (${kb} KB, ${localeCount} locales)`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
