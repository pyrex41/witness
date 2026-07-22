// test/tc-enforcement.test.js
//
// The headline claim, as an executable test: under tc+, text that does not fit
// its container is a TYPE ERROR, and text that fits is not.
//
// This exists because the claim was false for the entire life of the project
// and nothing noticed. The datatype premise was written `(fits? ...) : verified`
// — a type ASSERTION, which the type checker never evaluates and nothing could
// discharge — so the rule fired for nothing: a 31.9px string in a 100px box was
// rejected exactly like the same string in a 10px box. Meanwhile the advertised
// API, `(proven-text ...)`, was declared as a plain function returning safe-text,
// so it accepted anything at all. The rule rejected everything, the API accepted
// everything, and neither consulted a measurement.
//
// What makes it work: an `if` SIDE CONDITION placed before the premises, which
// Shen evaluates during type checking (shen/proofs.shen), plus trust.shen's
// macro expanding the call form to the tagged data form the rule matches on.
//
// The boundary cases below are deliberately tight: "Save" in 14px sans-serif
// measures 31.91px, so 32 must pass and 31 must fail. A test that only checked
// a wildly-overflowing case would still pass if the ruler were off by 40% — as
// it in fact was, when canvas silently rejected the CSS shorthand font and
// measured at the default 10px size.

const { boot } = require('../boot');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRELUDE = ['.witness/measurements.shen', 'shen/witness-sbcl.shen'];
const repoRoot = path.join(__dirname, '..');

// Each case gets a fresh kernel: `tc` is global session state, and a file that
// fails mid-load can leave partial definitions behind.
async function checkSource(code) {
  const $ = await boot({ skipLoad: true });
  for (const rel of PRELUDE) await $.load(path.join(repoRoot, rel));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-tc-test-'));
  const file = path.join(dir, 'case.shen');
  fs.writeFileSync(file, code, 'utf8');
  try {
    await $.load(file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).split('\n')[0] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('=== tc+ layout enforcement ===\n');
  let passed = 0;
  let failed = 0;
  const check = (name, cond, detail) => {
    if (cond) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
  };

  // "Save" @ 14px sans-serif = 31.91px;  "Card Title" @ 18px sans-serif = 77.36px.
  const provenText = (text, font, maxW) =>
    `(define tc-case { --> safe-text } -> (proven-text "${text}" "${font}" ${maxW}))\n`;
  const dataForm = (text, font, maxW) =>
    `(define tc-case { --> safe-text } -> [proven-cell "${text}" "${font}" ${maxW}])\n`;

  console.log('Advertised API — (proven-text ...):');
  let r = await checkSource(provenText('Save', '14px sans-serif', 100));
  check('text that fits compiles', r.ok, r.error);

  r = await checkSource(provenText('Card Title', '18px sans-serif', 5));
  check('overflowing text is a TYPE ERROR', !r.ok, 'it compiled — the claim is broken');

  console.log('\nBoundary (text measures 31.91px — the ruler must be exact):');
  r = await checkSource(provenText('Save', '14px sans-serif', 32));
  check('maxW 32 compiles', r.ok, r.error);

  r = await checkSource(provenText('Save', '14px sans-serif', 31));
  check('maxW 31 is rejected', !r.ok, 'it compiled — measurement is not being consulted');

  console.log('\nUnderlying data form — [proven-cell ...]:');
  r = await checkSource(dataForm('Save', '14px sans-serif', 100));
  check('fitting cell compiles', r.ok, r.error);

  r = await checkSource(dataForm('Card Title', '18px sans-serif', 5));
  check('overflowing cell is a TYPE ERROR', !r.ok, 'it compiled');

  console.log('\nEscape hatches must remain open:');
  r = await checkSource(
    '(define tc-case { --> safe-text } -> [handled-cell "any long text at all" "18px sans-serif" 5 ellipsis])\n'
  );
  check('handled-text needs no proof', r.ok, r.error);

  console.log('\nTrust gate (literal-only first argument):');
  r = await checkSource('(define tc-case { string --> safe-text } X -> (proven-text X "14px sans-serif" 100))\n');
  check('dynamic first argument is rejected', !r.ok && /literal string/.test(r.error || ''), r.error);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('TC ENFORCEMENT TEST CRASHED:', e); process.exit(1); });
