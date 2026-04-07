const { boot } = require('../boot');

async function main() {
  console.log('=== Layout.shen Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded (tc+ enabled)\n');

  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  }

  // --- Props tests ---
  console.log('Frame props:');

  const w = await $.exec('(get-width (mk-props9 100 200 "row" 8 16 "center" "center" 1 0))');
  check('get-width returns 100', w === 100, w);

  const h = await $.exec('(get-height (mk-props9 100 200 "row" 8 16 "center" "center" 1 0))');
  check('get-height returns 200', h === 200, h);

  const dir = await $.exec('(get-direction (mk-props9 100 200 "row" 8 16 "center" "center" 1 0))');
  check('get-direction returns "row"', dir === 'row', dir);

  const gap = await $.exec('(get-gap (mk-props9 100 200 "row" 8 16 "center" "center" 1 0))');
  check('get-gap returns 8', gap === 8, gap);

  const pad = await $.exec('(get-padding (mk-props9 100 200 "row" 8 16 "center" "center" 1 0))');
  check('get-padding returns 16', pad === 16, pad);

  const grow = await $.exec('(get-grow (mk-props9 100 200 "row" 8 16 "center" "center" 1 0))');
  check('get-grow returns 1', grow === 1, grow);

  const shrink = await $.exec('(get-shrink (mk-props9 100 200 "row" 8 16 "center" "center" 1 0))');
  check('get-shrink returns 0', shrink === 0, shrink);

  // --- default-props ---
  console.log('\nDefault props:');
  const dw = await $.exec('(get-width (default-props))');
  check('default width is 0', dw === 0, dw);

  const dd = await $.exec('(get-direction (default-props))');
  check('default direction is "column"', dd === 'column', dd);

  // --- to-textura: spacer ---
  console.log('\nto-textura (spacer):');
  const spacer = await $.exec('(to-textura [spacer 50 10])');
  check('spacer has width', spacer.width === 50, spacer.width);
  check('spacer has height', spacer.height === 10, spacer.height);

  // --- to-textura: text-node with handled-text ---
  console.log('\nto-textura (text-node):');
  const textNode = await $.exec('(to-textura [text-node [handled-text "Hello" "14px sans-serif" ellipsis]])');
  check('text node has text', textNode.text === 'Hello', textNode.text);
  check('text node has font', textNode.font === '14px sans-serif', textNode.font);
  check('text node has lineHeight', textNode.lineHeight === 20, textNode.lineHeight);
  check('text node width is 999999 (handled)', textNode.width === 999999, textNode.width);

  // --- to-textura: frame with children ---
  console.log('\nto-textura (frame with children):');
  const frame = await $.exec(`
    (to-textura
      [frame (mk-props9 300 0 "column" 8 16 "" "" 0 0)
        [[spacer 100 20]
         [text-node [handled-text "Test" "14px sans-serif" ellipsis]]
         [spacer 100 20]]])`);
  check('frame has children array', Array.isArray(frame.children), typeof frame.children);
  check('frame has 3 children', frame.children.length === 3, frame.children?.length);
  check('frame has flexDirection', frame.flexDirection === 'column', frame.flexDirection);
  check('frame has width 300', frame.width === 300, frame.width);
  check('frame has gap 8', frame.gap === 8, frame.gap);
  check('frame has padding 16', frame.padding === 16, frame.padding);
  check('first child is spacer', frame.children[0]?.width === 100, frame.children[0]);
  check('second child is text', frame.children[1]?.text === 'Test', frame.children[1]);

  // --- solve-layout: simple frame ---
  console.log('\nsolve-layout:');
  const layout = await $.exec(`
    (solve-layout
      [frame (mk-props9 200 100 "column" 0 0 "" "" 0 0)
        [[spacer 50 30]]]
      200 100)`);
  check('layout result is object', typeof layout === 'object' && layout !== null, typeof layout);
  check('layout has width', typeof layout.width === 'number', layout.width);
  check('layout has height', typeof layout.height === 'number', layout.height);
  check('layout has x', typeof layout.x === 'number', layout.x);
  check('layout has y', typeof layout.y === 'number', layout.y);

  // --- solve-layout: frame with multiple children ---
  console.log('\nsolve-layout (multiple children):');
  const multi = await $.exec(`
    (solve-layout
      [frame (mk-props9 300 200 "column" 8 0 "" "" 0 0)
        [[spacer 100 40]
         [spacer 100 40]
         [spacer 100 40]]]
      300 200)`);
  check('multi-child layout is object', typeof multi === 'object' && multi !== null, typeof multi);
  check('multi-child layout has children', Array.isArray(multi.children), typeof multi.children);
  check('multi-child has 3 children', multi.children?.length === 3, multi.children?.length);
  // Each child should have layout coordinates
  if (multi.children && multi.children.length === 3) {
    check('child 0 has y=0', multi.children[0].y === 0, multi.children[0].y);
    check('child 1 has y=48 (40+8 gap)', multi.children[1].y === 48, multi.children[1].y);
    check('child 2 has y=96 (40+8+40+8)', multi.children[2].y === 96, multi.children[2].y);
  }

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('LAYOUT TEST CRASHED:', err);
  process.exit(1);
});
