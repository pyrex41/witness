const { boot } = require('../boot');
const fs = require('fs');
const path = require('path');

// Helper to write a temp .shen file and try loading it
async function loadShen($, code) {
  const tmp = path.join('/tmp', `witness-test-${Date.now()}.shen`);
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

async function main() {
  console.log('=== Proofs.shen Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded (tc+ enabled)\n');

  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  }

  // --- Basic measurement tests ---
  console.log('Measurement:');
  const submitW = await $.exec('(measure "Submit" (mk-font "sans-serif" 14))');
  check('measure returns number', typeof submitW === 'number' && submitW > 0, submitW);
  check('Submit < 96px', submitW < 96, `${submitW}px`);

  const longW = await $.exec('(measure "A Really Long Button Label" (mk-font "sans-serif" 14))');
  check('long text > 96px', longW > 96, `${longW}px`);

  // Shen booleans are Symbols
  const fits = await $.exec('(fits? "Submit" (mk-font "sans-serif" 14) 96)');
  check('fits? true for short text', fits.description === 'true', String(fits));

  const noFit = await $.exec('(fits? "A Really Long Button Label" (mk-font "sans-serif" 14) 96)');
  check('fits? false for long text', noFit.description === 'false', String(noFit));

  const font = await $.exec('(mk-font "Inter" 14)');
  check('mk-font produces CSS string', font === '14px Inter', font);

  // --- Type system tests ---
  console.log('\nType system (where + verified):');

  // proven-text with where guard — should pass
  const r1 = await loadShen($, `
(define good-btn
  {string --> string --> number --> safe-text}
  Text Font MaxW -> [proven-text Text Font MaxW]
    where (fits? Text Font MaxW))`);
  check('proven-text with where guard compiles', r1.ok, r1.error);

  // proven-text WITHOUT where guard — should be TYPE ERROR
  const r2 = await loadShen($, `
(define bad-btn
  {string --> string --> number --> safe-text}
  Text Font MaxW -> [proven-text Text Font MaxW])`);
  check('proven-text without guard is type error', !r2.ok, 'should have failed');

  // handled-text — no proof needed
  const r3 = await loadShen($, `
(define handled-btn
  {string --> safe-text}
  _ -> [handled-text "Any text" "14px sans-serif" 100 ellipsis])`);
  check('handled-text compiles without proof', r3.ok, r3.error);

  // handled-text with clip
  const r4 = await loadShen($, `
(define clip-btn
  {string --> safe-text}
  _ -> [handled-text "Any text" "14px sans-serif" 100 clip])`);
  check('handled-text with clip compiles', r4.ok, r4.error);

  // --- Compile-time assertion tests ---
  console.log('\nCompile-time assertions (assert-fits):');

  // assert-fits for text that fits — should pass
  const r5 = await loadShen($, `(assert-fits "Submit" "14px sans-serif" 96)`);
  check('assert-fits passes for fitting text', r5.ok, r5.error);

  // assert-fits for text that overflows — should ERROR at load time
  const r6 = await loadShen($, `(assert-fits "A Really Long Button Label" "14px sans-serif" 96)`);
  check('assert-fits catches overflow at load time', !r6.ok, 'should have failed');
  check('error message includes text', r6.error?.includes('A Really Long Button Label'), r6.error);
  check('error message includes measurement', r6.error?.includes('px'), r6.error);

  // --- Full pattern: assert at load + typed function ---
  console.log('\nFull pattern (assert + typed function):');

  const r7 = await loadShen($, `
(assert-fits "Submit" "14px sans-serif" 96)
(assert-fits "Cancel" "14px sans-serif" 96)

(define submit-btn
  {string --> safe-text}
  _ -> [proven-text "Submit" "14px sans-serif" 96]
    where (fits? "Submit" "14px sans-serif" 96))

(define cancel-btn
  {string --> safe-text}
  _ -> [proven-text "Cancel" "14px sans-serif" 96]
    where (fits? "Cancel" "14px sans-serif" 96))`);
  check('multiple static buttons compile', r7.ok, r7.error);

  // Full pattern with one overflow — caught at assert-fits
  const r8 = await loadShen($, `
(assert-fits "OK" "14px sans-serif" 96)
(assert-fits "This Label Is Way Too Long For The Container" "14px sans-serif" 96)`);
  check('overflow caught in multi-assert file', !r8.ok, 'should have failed');

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('PROOF TEST CRASHED:', err);
  process.exit(1);
});
