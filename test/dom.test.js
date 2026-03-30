const { boot } = require('../boot');

async function main() {
  console.log('=== DOM.shen Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded (tc+ enabled)\n');

  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  }

  // --- px helper ---
  console.log('px helper:');

  const px42 = await $.exec('(px 42)');
  check('(px 42) = "42px"', px42 === '42px', px42);

  const px0 = await $.exec('(px 0)');
  check('(px 0) = "0px"', px0 === '0px', px0);

  const pxFloat = await $.exec('(px 3.5)');
  check('(px 3.5) = "3.5px"', pxFloat === '3.5px', pxFloat);

  // --- has-text? ---
  console.log('\nhas-text?:');

  // Register test helpers for mock layout objects
  await $.define('test.mock-text-layout', () => {
    return { x: 0, y: 0, width: 100, height: 20, text: 'Hello', children: [] };
  });
  await $.define('test.mock-box-layout', () => {
    return { x: 0, y: 0, width: 100, height: 20, children: [] };
  });

  // Shen booleans are Symbols — compare via .description
  const hasText = await $.exec('(has-text? (test.mock-text-layout))');
  check('has-text? true for text layout', hasText.description === 'true', String(hasText));

  const noText = await $.exec('(has-text? (test.mock-box-layout))');
  check('has-text? false for box layout', noText.description === 'false', String(noText));

  // --- each helper ---
  console.log('\neach helper:');

  const eachResult = await $.exec('(each (/. X X) [1 2 3])');
  check('each returns true', eachResult.description === 'true', String(eachResult));

  const eachEmpty = await $.exec('(each (/. X X) [])');
  check('each on empty list returns true', eachEmpty.description === 'true', String(eachEmpty));

  // --- Functions are defined ---
  console.log('\nFunction definitions:');

  const fnNames = ['px', 'has-text?', 'render-text', 'render-children',
                   'render-to-dom', 'dom-renderer', 'each'];
  for (const name of fnNames) {
    try {
      // Check function exists by partially applying it (Shen returns a lambda)
      const val = await $.exec(`(function ${name})`);
      check(`${name} is defined`, val !== undefined && val !== null, typeof val);
    } catch (e) {
      check(`${name} is defined`, false, e.message);
    }
  }

  // --- DOM rendering (skipped in Node.js) ---
  console.log('\nDOM rendering:');
  console.log('  (skipped — requires browser document/DOM environment)');

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('DOM TEST CRASHED:', err);
  process.exit(1);
});
