const { boot } = require('../boot');

async function main() {
  console.log('=== Tailwind.shen Tests ===\n');
  console.log('Loading Witness environment...');
  const $ = await boot();
  console.log('Environment loaded (tc+ enabled)\n');

  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    if (condition) { console.log(`  \u2713 ${name}`); passed++; }
    else { console.log(`  \u2717 ${name}: ${detail || 'false'}`); failed++; }
  }

  // Normalize a value: Shen symbols become their .description string
  function norm(v) {
    if (typeof v === 'symbol') return v.description;
    return v;
  }

  function arrEq(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => norm(v) === b[i]);
  }

  function toNormArray(shenList) {
    return $.toArray(shenList).map(norm);
  }

  // --- parse-tw-class: simple classes ---
  console.log('parse-tw-class (simple):');

  const flex = toNormArray(await $.exec('(parse-tw-class "flex")'));
  check('flex => [direction "row"]', arrEq(flex, ['direction', 'row']), JSON.stringify(flex));

  const flexCol = toNormArray(await $.exec('(parse-tw-class "flex-col")'));
  check('flex-col => [direction "column"]', arrEq(flexCol, ['direction', 'column']), JSON.stringify(flexCol));

  const itemsCenter = toNormArray(await $.exec('(parse-tw-class "items-center")'));
  check('items-center => [align "center"]', arrEq(itemsCenter, ['align', 'center']), JSON.stringify(itemsCenter));

  const justifyBetween = toNormArray(await $.exec('(parse-tw-class "justify-between")'));
  check('justify-between => [justify "space-between"]', arrEq(justifyBetween, ['justify', 'space-between']), JSON.stringify(justifyBetween));

  const grow = toNormArray(await $.exec('(parse-tw-class "grow")'));
  check('grow => [flex-grow 1]', arrEq(grow, ['flex-grow', 1]), JSON.stringify(grow));

  const truncate = toNormArray(await $.exec('(parse-tw-class "truncate")'));
  check('truncate => [overflow ellipsis]', truncate[0] === 'overflow' && truncate[1] === 'ellipsis', JSON.stringify(truncate));

  const textSm = toNormArray(await $.exec('(parse-tw-class "text-sm")'));
  check('text-sm => [font-size 14]', arrEq(textSm, ['font-size', 14]), JSON.stringify(textSm));

  const fontBold = toNormArray(await $.exec('(parse-tw-class "font-bold")'));
  check('font-bold => [font-weight 700]', arrEq(fontBold, ['font-weight', 700]), JSON.stringify(fontBold));

  // --- parse-tw-class: sized classes ---
  console.log('\nparse-tw-class (sized):');

  const w4 = toNormArray(await $.exec('(parse-tw-class "w-4")'));
  check('w-4 => [width 16]', arrEq(w4, ['width', 16]), JSON.stringify(w4));

  const h8 = toNormArray(await $.exec('(parse-tw-class "h-8")'));
  check('h-8 => [height 32]', arrEq(h8, ['height', 32]), JSON.stringify(h8));

  const gap2 = toNormArray(await $.exec('(parse-tw-class "gap-2")'));
  check('gap-2 => [gap 8]', arrEq(gap2, ['gap', 8]), JSON.stringify(gap2));

  const p6 = toNormArray(await $.exec('(parse-tw-class "p-6")'));
  check('p-6 => [padding 24]', arrEq(p6, ['padding', 24]), JSON.stringify(p6));

  // --- parse-tw-classes ---
  console.log('\nparse-tw-classes:');

  const classes = await $.exec('(parse-tw-classes ["flex" "gap-4" "p-8"])');
  const classList = $.toArray(classes).map(x => toNormArray(x));
  check('parses 3 classes', classList.length === 3, classList.length);
  check('first is [direction "row"]', arrEq(classList[0], ['direction', 'row']), JSON.stringify(classList[0]));
  check('second is [gap 16]', arrEq(classList[1], ['gap', 16]), JSON.stringify(classList[1]));
  check('third is [padding 32]', arrEq(classList[2], ['padding', 32]), JSON.stringify(classList[2]));

  // --- tw-to-props ---
  console.log('\ntw-to-props:');

  const props = await $.exec('(tw-to-props (parse-tw-classes ["flex" "w-10" "gap-4" "p-6"]))');
  const propsList = $.toArray(props);
  check('width is 40', propsList[0] === 40, propsList[0]);
  check('height is 0 (default)', propsList[1] === 0, propsList[1]);
  check('direction is "row"', propsList[2] === 'row', propsList[2]);
  check('gap is 16', propsList[3] === 16, propsList[3]);
  check('padding is 24', propsList[4] === 24, propsList[4]);
  check('justify is "" (default)', propsList[5] === '', propsList[5]);
  check('align is "" (default)', propsList[6] === '', propsList[6]);
  check('grow is 0 (default)', propsList[7] === 0, propsList[7]);
  check('shrink is 0 (default)', propsList[8] === 0, propsList[8]);

  // --- tw function ---
  console.log('\ntw function:');

  const node = await $.exec('(tw ["flex" "gap-2"] [[spacer 50 50]])');
  const nodeList = $.toArray(node);
  check('tw produces frame node', norm(nodeList[0]) === 'frame', norm(nodeList[0]));
  const twProps = $.toArray(nodeList[1]);
  check('tw frame direction is "row"', twProps[2] === 'row', twProps[2]);
  check('tw frame gap is 8', twProps[3] === 8, twProps[3]);
  const children = $.toArray(nodeList[2]);
  check('tw frame has 1 child', children.length === 1, children.length);

  // --- tw with more complex classes ---
  console.log('\ntw (complex):');

  const complex = await $.exec('(tw ["flex-col" "w-32" "h-24" "gap-4" "p-8" "items-center" "justify-center" "grow"] [[spacer 10 10]])');
  const cList = $.toArray(complex);
  const cProps = $.toArray(cList[1]);
  check('complex width is 128', cProps[0] === 128, cProps[0]);
  check('complex height is 96', cProps[1] === 96, cProps[1]);
  check('complex direction is "column"', cProps[2] === 'column', cProps[2]);
  check('complex gap is 16', cProps[3] === 16, cProps[3]);
  check('complex padding is 32', cProps[4] === 32, cProps[4]);
  check('complex justify is "center"', cProps[5] === 'center', cProps[5]);
  check('complex align is "center"', cProps[6] === 'center', cProps[6]);
  check('complex grow is 1', cProps[7] === 1, cProps[7]);

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('TAILWIND TEST CRASHED:', err);
  process.exit(1);
});
