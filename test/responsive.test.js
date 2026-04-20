const { boot } = require('../boot');

async function main() {
  console.log('=== Responsive.shen Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded\n');
  // Drop tc+ so we can define test-only helpers without type sigs.
  await $.exec('(tc -)');

  let passed = 0, failed = 0;
  function check(name, condition, detail) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  }

  // --- wt-bp-class ---
  const cls = await $.exec('(wt-bp-class 375)');
  check('wt-bp-class emits "wt-bp-<W>"', cls === 'wt-bp-375', cls);

  // --- render-fragment (plain tree) ---
  const plain = await $.exec(`
    (render-fragment
      [frame (mk-props9 200 0 "row" 0 0 "" "" 0 0)
        [[text-node [proven-text "hi" "14 monospace" 80]]]])
  `);
  check('plain fragment has position:relative wrapper',
    plain.startsWith('<div style="position:relative;">'),
    plain.slice(0, 60));
  check('plain fragment contains the text',
    plain.includes('>hi</span>'),
    'missing text span');
  check('plain fragment has no @media (no responsive CSS)',
    !plain.includes('@media'),
    'unexpected media query');

  // --- render-fragment (responsive tree) ---
  const resp = await $.exec(`
    (render-fragment
      [responsive
        [at 375 [frame (mk-props9 360 0 "row" 0 0 "" "" 0 0)
                  [[text-node [proven-text "hi" "14 monospace" 80]]]]]
        [at 1024 [frame (mk-props9 1000 0 "row" 0 0 "" "" 0 0)
                   [[text-node [proven-text "hello" "14 monospace" 80]]]]]])
  `);
  check('responsive fragment starts with <style>',
    resp.startsWith('<style>'),
    resp.slice(0, 30));
  check('responsive fragment hides larger breakpoint by default',
    resp.includes('.wt-bp-1024{display:none;}'),
    'missing default hide rule');
  check('responsive fragment has min-width media query at 1024',
    resp.includes('@media(min-width:1024px)'),
    'missing media query');
  check('responsive fragment contains both breakpoint divs',
    resp.includes('class="wt-bp-375"') && resp.includes('class="wt-bp-1024"'),
    'missing wrapper classes');
  check('responsive branches are position:relative',
    (resp.match(/position:relative;/g) || []).length >= 2,
    `found ${(resp.match(/position:relative;/g) || []).length}`);
  check('both branch texts rendered',
    resp.includes('>hi</span>') && resp.includes('>hello</span>'),
    'missing one or both texts');

  // --- 3-breakpoint cascade ---
  const three = await $.exec(`
    (render-fragment
      [responsive
        [at 360 [frame (mk-props9 340 0 "row" 0 0 "" "" 0 0)
                  [[text-node [proven-text "s" "14 monospace" 80]]]]]
        [at 768 [frame (mk-props9 720 0 "row" 0 0 "" "" 0 0)
                  [[text-node [proven-text "m" "14 monospace" 80]]]]]
        [at 1024 [frame (mk-props9 1000 0 "row" 0 0 "" "" 0 0)
                   [[text-node [proven-text "l" "14 monospace" 80]]]]]])
  `);
  check('3-bp cascade has one media step per non-smallest width',
    (three.match(/@media\(min-width:/g) || []).length === 2,
    `found ${(three.match(/@media\(min-width:/g) || []).length}`);
  check('3-bp cascade hides both non-smallest by default',
    three.includes('.wt-bp-768,.wt-bp-1024{display:none;}'),
    'wrong default hide rule');
  check('3-bp cascade toggles 360→768 correctly',
    three.includes('@media(min-width:768px){.wt-bp-360{display:none;}.wt-bp-768{display:block;}}'),
    'bad 768 step');
  check('3-bp cascade toggles 768→1024 correctly',
    three.includes('@media(min-width:1024px){.wt-bp-768{display:none;}.wt-bp-1024{display:block;}}'),
    'bad 1024 step');

  // --- Out-of-order breakpoints get sorted ---
  const unordered = await $.exec(`
    (render-fragment
      [responsive
        [at 1024 [frame (mk-props9 1000 0 "row" 0 0 "" "" 0 0)
                   [[text-node [proven-text "l" "14 monospace" 80]]]]]
        [at 375 [frame (mk-props9 360 0 "row" 0 0 "" "" 0 0)
                  [[text-node [proven-text "s" "14 monospace" 80]]]]]])
  `);
  check('unordered input still produces ascending cascade',
    unordered.includes('.wt-bp-1024{display:none;}') &&
      unordered.includes('@media(min-width:1024px)'),
    'CSS not sorted');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('\n=== All responsive tests passed ===');
}

main().catch(err => { console.error(err); process.exit(1); });
