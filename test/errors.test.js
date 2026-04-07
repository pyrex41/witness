const { boot } = require('../boot');

async function main() {
  console.log('=== Errors.shen Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded\n');

  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  }

  // --- check-text: text that fits ---
  console.log('check-text:');
  const okResult = await $.exec('(check-text "Submit" (mk-font "sans-serif" 14) 200)');
  const okArr = $.toArray(okResult);
  check('fitting text returns [ok]', okArr.length === 1 && okArr[0].description === 'ok',
    JSON.stringify(okArr));

  // --- check-text: text that overflows ---
  const errResult = await $.exec('(check-text "A Really Long Button Label That Overflows" (mk-font "sans-serif" 14) 50)');
  const errArr = $.toArray(errResult);
  check('overflow returns error-report', errArr[0].description === 'error-report',
    JSON.stringify(errArr.map(x => typeof x === 'object' && x.description ? x.description : x)));

  // --- make-layout-error with known values ---
  console.log('\nmake-layout-error:');
  const report = await $.exec('(make-layout-error "Hello" "14px sans-serif" 120.5 100)');
  const reportArr = $.toArray(report);
  check('error code is W0200', reportArr[1] === 'W0200', reportArr[1]);

  const message = reportArr[3];
  check('message contains text name', typeof message === 'string' && message.includes('Hello'), message);
  check('message contains font', message.includes('14px sans-serif'), message);
  check('message contains measured width', message.includes('120.5'), message);
  check('message contains available width', message.includes('100'), message);

  // --- error-code, error-message, error-suggestions accessors ---
  console.log('\nAccessors:');
  const code = await $.exec('(error-code (make-layout-error "X" "14px sans-serif" 120 100))');
  check('error-code extracts code', code === 'W0200', code);

  const msg = await $.exec('(error-message (make-layout-error "X" "14px sans-serif" 120 100))');
  check('error-message extracts message', typeof msg === 'string' && msg.includes('X in 14px sans-serif'), msg);

  const suggestions = await $.exec('(error-suggestions (make-layout-error "X" "14px sans-serif" 120 100))');
  const sugArr = $.toArray(suggestions);
  check('error-suggestions returns 3 suggestions', sugArr.length === 3, sugArr.length);

  // --- format-error ---
  console.log('\nformat-error:');
  const formatted = await $.exec('(format-error (make-layout-error "Hello" "14px sans-serif" 120.5 100))');
  check('format-error returns string', typeof formatted === 'string', typeof formatted);
  check('formatted output contains error code', formatted.includes('[W0200]'), formatted);
  check('formatted output contains Suggestions:', formatted.includes('Suggestions:'), formatted);
  check('formatted output contains fix description', formatted.includes('Add truncate'), formatted);
  check('formatted output contains widen suggestion', formatted.includes('Widen container to 121px'), formatted);
  console.log('\n  Formatted output:\n' + formatted.split('\n').map(l => '    ' + l).join('\n'));

  // --- ceiling helper ---
  console.log('\nceiling:');
  const c1 = await $.exec('(ceiling 3.2)');
  check('ceiling 3.2 = 4', c1 === 4, c1);
  const c2 = await $.exec('(ceiling 5.0)');
  check('ceiling 5.0 = 5', c2 === 5, c2);
  const c3 = await $.exec('(ceiling 0.1)');
  check('ceiling 0.1 = 1', c3 === 1, c3);

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('ERRORS TEST CRASHED:', err);
  process.exit(1);
});
