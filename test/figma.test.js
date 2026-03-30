const { boot } = require('../boot');
const path = require('path');

async function main() {
  console.log('=== Figma.shen Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded (tc+ enabled)\n');

  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    if (condition) { console.log(`  \u2713 ${name}`); passed++; }
    else { console.log(`  \u2717 ${name}: ${String(detail)}`); failed++; }
  }

  // Helper to check if a Shen value is a specific symbol
  function isSym(val, name) {
    return typeof val === 'symbol' && $.nameOf(val) === name;
  }

  const fixturePath = path.resolve(__dirname, 'fixtures/simple-card.json');

  // --- read-file-string ---
  console.log('read-file-string:');
  const content = await $.exec(`(read-file-string "${fixturePath}")`);
  check('reads file to string', typeof content === 'string' && content.length > 0, typeof content);
  check('contains Card', content.includes('"Card"'), 'missing "Card"');
  check('is valid JSON', (() => { try { JSON.parse(content); return true; } catch { return false; } })(), 'invalid JSON');

  // --- figma-json->positions ---
  console.log('\nfigma-json->positions:');
  const positions = await $.exec(`(figma-json->positions (json.parse (read-file-string "${fixturePath}")))`);
  const posArr = $.toArray(positions);
  check('returns a list', Array.isArray(posArr), typeof posArr);
  check('has 3 nodes (root + 2 children)', posArr.length === 3, posArr.length);

  // Check root position
  const root = $.toArray(posArr[0]);
  check('root tag is position', isSym(root[0], 'position'), $.nameOf(root[0]));
  check('root x is 0', root[1] === 0, root[1]);
  check('root y is 0', root[2] === 0, root[2]);
  check('root width is 300', root[3] === 300, root[3]);
  check('root height is 200', root[4] === 200, root[4]);

  // Check first child (Title)
  const title = $.toArray(posArr[1]);
  check('title x is 16', title[1] === 16, title[1]);
  check('title y is 16', title[2] === 16, title[2]);
  check('title width is 268', title[3] === 268, title[3]);
  check('title height is 32', title[4] === 32, title[4]);

  // --- layout->positions ---
  console.log('\nlayout->positions:');
  const layoutPositions = await $.exec(`
    (layout->positions
      (solve-layout
        [frame (mk-props 300 200 "column" 0 0 "" "" 0 0)
          [[spacer 268 32]
           [spacer 268 120]]]
        300 200))`);
  const lpArr = $.toArray(layoutPositions);
  check('returns a list', Array.isArray(lpArr), typeof lpArr);
  check('has 3 positions (root + 2 children)', lpArr.length === 3, lpArr.length);

  const lpRoot = $.toArray(lpArr[0]);
  check('layout root tag is position', isSym(lpRoot[0], 'position'), $.nameOf(lpRoot[0]));
  check('layout root x is 0', lpRoot[1] === 0, lpRoot[1]);
  check('layout root y is 0', lpRoot[2] === 0, lpRoot[2]);

  // --- diff-positions: matching ---
  console.log('\ndiff-positions (matching):');
  const noDiffs = await $.exec(`
    (diff-positions
      [[position 0 0 300 200] [position 16 16 268 32]]
      [[position 0 0 300 200] [position 16 16 268 32]]
      2)`);
  const noDiffArr = $.toArray(noDiffs);
  check('matching positions produce empty diffs', noDiffArr.length === 0, noDiffArr.length);

  // --- diff-positions: within tolerance ---
  console.log('\ndiff-positions (within tolerance):');
  const tolDiffs = await $.exec(`
    (diff-positions
      [[position 0 0 300 200] [position 16 16 268 32]]
      [[position 0 0 300 200] [position 17 15 269 33]]
      2)`);
  const tolDiffArr = $.toArray(tolDiffs);
  check('positions within tolerance produce empty diffs', tolDiffArr.length === 0, tolDiffArr.length);

  // --- diff-positions: mismatched ---
  console.log('\ndiff-positions (mismatched):');
  const diffs = await $.exec(`
    (diff-positions
      [[position 0 0 300 200] [position 16 16 268 32]]
      [[position 0 0 300 200] [position 50 50 200 100]]
      2)`);
  const diffArr = $.toArray(diffs);
  check('mismatched positions produce diffs', diffArr.length > 0, diffArr.length);

  // Check the diff content — should report x, y, w, h differences
  const firstDiff = $.toArray(diffArr[0]);
  check('diff contains multiple fields', firstDiff.length > 0, firstDiff.length);

  // --- diff-positions: count mismatch ---
  console.log('\ndiff-positions (count mismatch):');
  const countDiffs = await $.exec(`
    (diff-positions
      [[position 0 0 300 200] [position 16 16 268 32]]
      [[position 0 0 300 200]]
      2)`);
  const countDiffArr = $.toArray(countDiffs);
  check('count mismatch produces diff', countDiffArr.length > 0, countDiffArr.length);
  const mismatch = $.toArray(countDiffArr[0]);
  check('count mismatch tag', isSym(mismatch[0], 'count-mismatch'), $.nameOf(mismatch[0]));

  // --- abs helper ---
  console.log('\nabs helper:');
  const absPos = await $.exec('(abs 5)');
  check('abs of positive', absPos === 5, absPos);
  const absNeg = await $.exec('(abs -7)');
  check('abs of negative', absNeg === 7, absNeg);
  const absZero = await $.exec('(abs 0)');
  check('abs of zero', absZero === 0, absZero);

  // --- verify-figma: matching layout ---
  console.log('\nverify-figma (matching layout):');
  // Figma fixture: root (0,0,300,200), title (16,16,268,32), body (16,64,268,120)
  // With padding=16, column direction, gap=16:
  //   root: (0,0,300,200), child0: (16,16,268,32), child1: (16,64,268,120)
  const passResult = await $.exec(`
    (verify-figma
      "${fixturePath}"
      [frame (mk-props 300 200 "column" 16 16 "" "" 0 0)
        [[spacer 268 32]
         [spacer 268 120]]]
      2)`);
  const passArr = $.toArray(passResult);
  check('verify-figma pass tag', isSym(passArr[0], 'pass'), $.nameOf(passArr[0]));

  // --- verify-figma: mismatched layout ---
  console.log('\nverify-figma (mismatched layout):');
  const failResult = await $.exec(`
    (verify-figma
      "${fixturePath}"
      [frame (mk-props 400 300 "row" 0 0 "" "" 0 0)
        [[spacer 100 100]
         [spacer 100 100]]]
      2)`);
  const failArr = $.toArray(failResult);
  check('verify-figma fail tag', isSym(failArr[0], 'fail'), $.nameOf(failArr[0]));
  const failDiffs = $.toArray(failArr[1]);
  check('verify-figma fail has diffs', failDiffs.length > 0, failDiffs.length);

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('FIGMA TEST CRASHED:', err);
  process.exit(1);
});
