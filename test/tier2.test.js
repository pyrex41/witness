// test/tier2.test.js — Tier 2 (structured-bounded) worst-case proofs
//
// Tier 1 proves a literal string fits. Tier 2 proves that EVERY string drawn
// from an alphabet, up to N chars, fits — for any runtime value. These tests
// exercise the math (widest-glyph / worst-case-width / bounded-fits?), the
// load-time gate (assert-bounded-fits), the dynamic cell constructor
// (bounded-text), the boundary guards (in-alphabet? / bounded? / assert-bounded),
// and end-to-end rendering of a price column.

const { boot } = require('../boot');
const fs = require('fs');
const path = require('path');

async function loadShen($, code) {
  const tmp = path.join('/tmp', `witness-tier2-${Date.now()}-${Math.random().toString(36).slice(2)}.shen`);
  fs.writeFileSync(tmp, code);
  try {
    await $.load(tmp);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.unlinkSync(tmp);
  }
}

const isTrue = (v) => v && v.description === 'true';
const isFalse = (v) => v && v.description === 'false';

async function main() {
  console.log('=== Tier 2 (bounded-string) Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded (tc+ enabled)\n');

  let passed = 0, failed = 0;
  function check(name, condition, detail) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  }

  // --- Worst-case math ---
  console.log('Worst-case math:');

  const oneDigit = await $.exec('(measure "0" (mk-font "monospace" 14))');
  const widestMono = await $.exec('(widest-advance (digits) (mk-font "monospace" 14))');
  check('widest-advance of digits = single digit advance (tabular = exact)',
    Math.abs(widestMono - oneDigit) < 1e-9, `${widestMono} vs ${oneDigit}`);

  const wcw = await $.exec('(worst-case-width (digits) 6 (mk-font "monospace" 14))');
  check('worst-case-width = N x widest advance',
    Math.abs(wcw - 6 * widestMono) < 1e-9, `${wcw} vs ${6 * widestMono}`);

  // Proportional font: widest glyph is the wide one, not the average.
  const wWide = await $.exec('(measure "W" (mk-font "sans-serif" 14))');
  const widestProp = await $.exec('(widest-advance (alphabet-of "iW.") (mk-font "sans-serif" 14))');
  check('widest-advance picks the widest glyph in a proportional font',
    Math.abs(widestProp - wWide) < 1e-9, `${widestProp} vs W=${wWide}`);

  const fitsTrue = await $.exec('(bounded-fits? (digits) 6 (mk-font "monospace" 14) 96)');
  check('bounded-fits? true when worst case <= MaxW', isTrue(fitsTrue), String(fitsTrue));
  const fitsFalse = await $.exec('(bounded-fits? (digits) 6 (mk-font "monospace" 14) 30)');
  check('bounded-fits? false when worst case > MaxW', isFalse(fitsFalse), String(fitsFalse));

  // --- Load-time assertion ---
  console.log('\nLoad-time assertion (assert-bounded-fits):');

  const a1 = await loadShen($, '(assert-bounded-fits (price-chars) 12 "14px monospace" 110)');
  check('assert-bounded-fits passes for a provable price column', a1.ok, a1.error);

  const a2 = await loadShen($, '(assert-bounded-fits (digits) 20 "14px monospace" 96)');
  check('assert-bounded-fits catches worst-case overflow at load time', !a2.ok, 'should have failed');
  check('error message names it a Bounded overflow', /Bounded overflow/.test(a2.error || ''), a2.error);
  check('error message reports widest glyph and container',
    /widest glyph/.test(a2.error || '') && /container = 96px/.test(a2.error || ''), a2.error);

  // --- bounded-text: dynamic content, no literal gate ---
  console.log('\nbounded-text (dynamic, Tier-2 cell):');

  // trust.shen gates proven-text to literals; bounded-text must NOT be gated —
  // a variable first argument is the whole point.
  const b1 = await loadShen($, `
(define price-cell
  {string --> safe-text}
  P -> (bounded-text P (price-chars) 12 "14px monospace" 110)
    where (bounded-fits? (price-chars) 12 "14px monospace" 110))`);
  check('bounded-text accepts a dynamic (variable) value', b1.ok, b1.error);

  // proven-text with the same variable would be rejected (contrast check).
  const b2 = await loadShen($, `
(define bad-proven
  {string --> safe-text}
  P -> (proven-text P "14px monospace" 110))`);
  check('proven-text still rejects the same dynamic value (contrast)',
    !b2.ok && /literal string/.test(b2.error || ''), b2.error);

  // --- Boundary guards (parse-don't-validate) ---
  console.log('\nBoundary guards:');

  check('string-length is now defined (was the dormant (bounded N) gap)',
    (await $.exec('(string-length "hello")')) === 5, 'string-length');
  check('in-alphabet? true for conforming value',
    isTrue(await $.exec('(in-alphabet? "1,299.00" (price-chars))')), 'in-alphabet?');
  check('in-alphabet? false for a stray letter',
    isFalse(await $.exec('(in-alphabet? "12a" (digits))')), 'in-alphabet?');
  check('bounded? enforces both length and alphabet',
    isTrue(await $.exec('(bounded? "42.50" (price-chars) 12)')) &&
    isFalse(await $.exec('(bounded? "9,999,999.99X" (price-chars) 12)')), 'bounded?');

  const ab1 = await loadShen($, '(assert-bounded "42.50" (price-chars) 12)');
  check('assert-bounded passes a conforming value', ab1.ok, ab1.error);
  const ab2 = await loadShen($, '(assert-bounded "haha" (digits) 12)');
  check('assert-bounded throws on a non-conforming value', !ab2.ok, 'should have failed');

  // --- End-to-end: a price column renders, widest cell within the bound ---
  console.log('\nEnd-to-end (price column):');

  await $.exec('(tc -)');
  const r = await loadShen($, fs.readFileSync(path.join(__dirname, '..', 'examples', 'price-column.shen'), 'utf8'));
  check('examples/price-column.shen loads (proof discharged)', r.ok, r.error);

  const html = await $.exec('(render-html-doc (solve-layout (render-view) 200 200))');
  check('renders the largest price', /9,999,999\.99/.test(html), 'render');
  // Widest rendered cell width must be <= the proven bound (110px).
  const widths = [...html.matchAll(/<span[^>]*>([0-9,\.]+)<\/span>/g)];
  check('all price cells rendered', widths.length === 4, `got ${widths.length}`);
  const cellWidths = [...html.matchAll(/width:([\d.]+)px[^>]*><span/g)].map(m => parseFloat(m[1]));
  const maxCell = Math.max(...cellWidths);
  check('widest rendered cell <= proven bound (110px)', maxCell <= 110, `max cell = ${maxCell}px`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('TIER2 TEST CRASHED:', err);
  process.exit(1);
});
