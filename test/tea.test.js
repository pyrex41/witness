const { boot } = require('../boot');

async function main() {
  console.log('=== TEA (Elm Architecture) Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded\n');

  let passed = 0;
  let failed = 0;

  function isShenTrue(val) {
    return typeof val === 'symbol' && val.description === 'true';
  }

  function check(name, condition, detail) {
    if (condition) { console.log(`  \u2713 ${name}`); passed++; }
    else { console.log(`  \u2717 ${name}: ${String(detail)}`); failed++; }
  }

  // --- mk-app and accessors ---
  console.log('mk-app and accessors:');
  await $.exec('(set *test-app* (mk-app 1 2 3 4))');
  const init = await $.exec('(get-init (value *test-app*))');
  check('get-init returns first element', init === 1, init);

  const update = await $.exec('(get-update (value *test-app*))');
  check('get-update returns second element', update === 2, update);

  const view = await $.exec('(get-view (value *test-app*))');
  check('get-view returns third element', view === 3, view);

  const subs = await $.exec('(get-subs (value *test-app*))');
  check('get-subs returns fourth element', subs === 4, subs);

  // --- execute-cmd with cmd-none ---
  console.log('\nexecute-cmd:');
  const noneResult = await $.exec('(execute-cmd cmd-none)');
  check('cmd-none executes without error', isShenTrue(noneResult), noneResult);

  // --- execute-cmd with cmd-batch of empty ---
  const batchEmpty = await $.exec('(execute-cmd [cmd-batch []])');
  check('cmd-batch [] executes without error', isShenTrue(batchEmpty), batchEmpty);

  // --- execute-cmd with cmd-batch of cmd-none ---
  const batchNone = await $.exec('(execute-cmd [cmd-batch [cmd-none]])');
  check('cmd-batch [cmd-none] executes', isShenTrue(batchNone), batchNone);

  // --- execute-cmd with cmd-delay ---
  const delayResult = await $.exec('(execute-cmd [cmd-delay 1000 tick])');
  check('cmd-delay stores pending delay', isShenTrue(delayResult), delayResult);
  const pendingMs = await $.exec('(fst (value *pending-delay*))');
  check('pending delay has correct ms', pendingMs === 1000, pendingMs);

  // --- Counter app: dispatch cycle ---
  console.log('\nCounter app dispatch cycle:');

  // Define a minimal counter app
  await $.exec(`
    (define counter-init
      Flags -> (@p 0 cmd-none))
  `);
  await $.exec(`
    (define counter-update
      increment Model -> (@p (+ Model 1) cmd-none)
      decrement Model -> (@p (- Model 1) cmd-none)
      _ Model -> (@p Model cmd-none))
  `);
  // View returns a simple spacer (no DOM needed)
  await $.exec(`
    (define counter-view
      Model -> [spacer 100 50])
  `);
  await $.exec(`
    (define counter-subs
      Model -> sub-none)
  `);

  // Build the app
  await $.exec('(set *counter-app* (mk-app (function counter-init) (function counter-update) (function counter-view) (function counter-subs)))');

  // Use a no-op renderer (we're in Node, no DOM)
  await $.exec('(define noop-renderer Layout -> true)');

  // Run the app
  await $.exec('(run-app (value *counter-app*) [] (function noop-renderer))');

  const initialModel = await $.exec('(value *model*)');
  check('initial model is 0', initialModel === 0, initialModel);

  // Dispatch increment
  await $.exec('(dispatch increment)');
  const afterInc = await $.exec('(value *model*)');
  check('after increment model is 1', afterInc === 1, afterInc);

  // Dispatch increment again
  await $.exec('(dispatch increment)');
  const afterInc2 = await $.exec('(value *model*)');
  check('after second increment model is 2', afterInc2 === 2, afterInc2);

  // Dispatch decrement
  await $.exec('(dispatch decrement)');
  const afterDec = await $.exec('(value *model*)');
  check('after decrement model is 1', afterDec === 1, afterDec);

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('TEA TEST CRASHED:', err);
  process.exit(1);
});
