// Smoke test for astro/runtime.js (no Astro required).
// Verifies: multiple .shen files can be loaded with their own (render Props)
// entry points, and each renders in isolation through the shared shen env.

const { writeFileSync, mkdirSync, rmSync } = require('fs');
const path = require('path');
const os = require('os');

async function main() {
  const dir = path.join(os.tmpdir(), 'witness-astro-test-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const fileA = path.join(dir, 'A.shen');
  const fileB = path.join(dir, 'B.shen');
  // fileA routes a dynamic prop value through handled-text — the
  // post-Phase-4 honest path for strings whose content is not known at
  // compile time. proven-text would now be rejected at load by the
  // trust.shen macro (exercised separately in trust.test.js).
  writeFileSync(fileA, `
(define render
  Props ->
    [frame (mk-props9 200 0 "row" 0 0 "" "" 0 0)
      [[text-node (handled-text (js.get Props "label") "14px monospace" 120 visible)]]])
`);
  // fileB keeps its static literal proven-text branches; dynamic prop
  // values go through handled-text.
  writeFileSync(fileB, `
(define render
  Props ->
    [responsive
      [at 375 [frame (mk-props9 300 0 "row" 0 0 "" "" 0 0)
                [[text-node (proven-text "small" "14px monospace" 80)]]]]
      [at 1024 [frame (mk-props9 900 0 "row" 0 0 "" "" 0 0)
                 [[text-node (handled-text (js.get Props "label") "14px monospace" 200 visible)]]]]])
`);

  const { renderComponent, invalidate } = await import('../astro/runtime.js');

  let passed = 0, failed = 0;
  const check = (name, cond, detail) => {
    if (cond) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  };

  console.log('\n=== astro/runtime smoke ===\n');

  const a1 = await renderComponent(fileA, { label: 'hello' });
  check('A renders with props.label=hello', a1.includes('>hello</span>'), a1.slice(0, 80));
  check('A is a plain fragment (no <style>)', !a1.includes('<style>'), 'unexpected <style>');

  const a2 = await renderComponent(fileA, { label: 'there' });
  check('A re-renders with different props', a2.includes('>there</span>'), a2.slice(0, 80));

  const b1 = await renderComponent(fileB, { label: 'desktop-label' });
  check('B is responsive (has <style>)', b1.startsWith('<style>'), b1.slice(0, 40));
  check('B desktop branch contains props.label', b1.includes('>desktop-label</span>'), 'missing label');
  check('B mobile branch still rendered (with its literal)', b1.includes('>small</span>'), 'missing mobile label');

  // A should still work after B was loaded — verifies entry-point rename isolation.
  const a3 = await renderComponent(fileA, { label: 'again' });
  check('A still works after B loaded (no clobber)', a3.includes('>again</span>'), a3.slice(0, 80));

  // Post-Phase-4: a component that tries to pass a dynamic value to
  // (proven-text ...) is rejected at load time by trust.shen's macro
  // — before any render runs. Covered in detail by trust.test.js; here
  // we just confirm the mechanism triggers through renderComponent's
  // loadFile path.
  const fileBad = path.join(dir, 'Bad.shen');
  writeFileSync(fileBad, `
(define render
  Props ->
    [frame (mk-props9 200 0 "row" 0 0 "" "" 0 0)
      [[text-node (proven-text (js.get Props "label") "14px monospace" 120)]]])
`);
  let badLoadThrew = false;
  let badLoadMsg = '';
  try {
    await renderComponent(fileBad, { label: 'anything' });
  } catch (e) {
    badLoadMsg = String(e && e.message || e);
    badLoadThrew = /proven-text requires a literal string/.test(badLoadMsg);
  }
  check('dynamic (proven-text ...) rejected at load', badLoadThrew,
    `expected literal-string rejection, got: ${badLoadMsg.slice(0, 160)}`);

  invalidate(fileA);
  const a4 = await renderComponent(fileA, { label: 'reloaded' });
  check('invalidate+re-render works', a4.includes('>reloaded</span>'), a4.slice(0, 80));

  // --- prop-spec layer ---
  const fileC = path.join(dir, 'C.shen');
  writeFileSync(fileC, `
(prop-spec "title" (max-chars 10))
(prop-spec "tagline" (min-chars 1))
(define render
  Props ->
    [frame (mk-props9 200 0 "row" 0 0 "" "" 0 0)
      [[text-node (handled-text (js.get Props "title") "12px monospace" 200 ellipsis)]]])
`);

  const c1 = await renderComponent(fileC, { title: 'short', tagline: 'ok' });
  check('prop-spec passes when within bounds', c1.includes('>short</span>'),
    c1.slice(0, 80));

  let propMaxThrew = false;
  let propMaxMsg = '';
  try {
    await renderComponent(fileC, { title: 'this title is way too long', tagline: 'ok' });
  } catch (e) {
    propMaxThrew = /prop-spec violations/.test(String(e?.message ?? e));
    propMaxMsg = String(e?.message ?? e);
  }
  check('prop-spec max-chars violation throws', propMaxThrew,
    `expected prop-spec violations error, got: ${propMaxMsg.slice(0, 120)}`);
  check('violation message names the offending key', /title/.test(propMaxMsg),
    propMaxMsg.slice(0, 120));

  let propMinThrew = false;
  try {
    await renderComponent(fileC, { title: 'short', tagline: '' });
  } catch (e) {
    propMinThrew = /min-chars/.test(String(e?.message ?? e));
  }
  check('prop-spec min-chars violation throws', propMinThrew,
    'expected min-chars violation');

  // max-width is the Tier-2 bridge from props to layout: the prop value
  // is measured at the component boundary and rejected if it would
  // overflow MaxW at the declared font, so downstream layout never sees
  // an overflowing string. This is the honest path for prop-driven text
  // that must fit a proven cell — proven-text itself only accepts
  // literals.
  const fileD = path.join(dir, 'D.shen');
  writeFileSync(fileD, `
(prop-spec "label" (max-width "14px monospace" 60))
(define render
  Props ->
    [frame (mk-props9 200 0 "row" 0 0 "" "" 0 0)
      [[text-node (handled-text (js.get Props "label") "14px monospace" 60 visible)]]])
`);

  const d1 = await renderComponent(fileD, { label: 'ok' });
  check('prop-spec max-width passes for fitting text',
    d1.includes('>ok</span>'), d1.slice(0, 80));

  let propMaxWThrew = false;
  let propMaxWMsg = '';
  try {
    await renderComponent(fileD, { label: 'this label will not fit in sixty pixels' });
  } catch (e) {
    propMaxWMsg = String(e?.message ?? e);
    propMaxWThrew = /prop-spec violations/.test(propMaxWMsg)
      && /max-width/.test(propMaxWMsg);
  }
  check('prop-spec max-width violation throws', propMaxWThrew,
    `expected max-width violation, got: ${propMaxWMsg.slice(0, 160)}`);
  check('max-width violation names the key and measured width',
    /label/.test(propMaxWMsg) && /measured=/.test(propMaxWMsg),
    propMaxWMsg.slice(0, 160));

  // Components without prop-spec forms must not pay any penalty
  const c2 = await renderComponent(fileA, { label: 'no specs here' });
  check('files without prop-spec render unaffected', c2.includes('>no specs here</span>'),
    c2.slice(0, 80));

  rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('\n=== astro runtime smoke OK ===');
}

main().catch(e => { console.error(e); process.exit(1); });
