const { boot } = require('../boot');

async function main() {
  console.log('=== Boot.js Tests ===\n');

  const $ = await boot({ skipLoad: true });

  // Test 1: Shen evaluation works
  console.log('1. Shen evaluation...');
  const sum = await $.exec('(+ 1 1)');
  console.assert(sum === 2, `Expected 2, got ${sum}`);
  console.log(`   (+ 1 1) = ${sum} ✓`);

  // Test 2: textura.measure returns intrinsic text width
  console.log('2. textura.measure...');
  const width = await $.exec('(textura.measure "Submit" "14px sans-serif")');
  console.assert(typeof width === 'number' && width > 0, `Expected positive number, got ${width}`);
  console.assert(width < 100, `"Submit" at 14px should be < 100px, got ${width}`);
  console.log(`   "Submit" in 14px sans-serif = ${width.toFixed(2)}px ✓`);

  // Test 3: textura.measure for longer text
  console.log('3. Longer text measurement...');
  const longWidth = await $.exec('(textura.measure "A Really Long Button Label" "14px sans-serif")');
  console.assert(longWidth > width, `Long text (${longWidth}) should be wider than short (${width})`);
  console.log(`   "A Really Long Button Label" = ${longWidth.toFixed(2)}px ✓`);

  // Test 4: textura-box builder
  console.log('4. textura-box...');
  const box = await $.exec('(textura-box 100 50)');
  console.assert(box.width === 100 && box.height === 50, `Expected 100x50, got ${JSON.stringify(box)}`);
  console.log(`   (textura-box 100 50) = ${box.width}x${box.height} ✓`);

  // Test 5: textura-text builder
  console.log('5. textura-text...');
  const textNode = await $.exec('(textura-text "Hello" "16px sans-serif" 20 200)');
  console.assert(textNode.text === 'Hello', `Expected text "Hello", got ${textNode.text}`);
  console.assert(textNode.font === '16px sans-serif', `Expected font, got ${textNode.font}`);
  console.log(`   (textura-text "Hello" ...) = {text: "${textNode.text}", font: "${textNode.font}"} ✓`);

  // Test 6: textura.layout with a box
  console.log('6. textura.layout...');
  const layout = await $.exec('(textura.layout (textura-box 100 50))');
  console.assert(layout.width === 100, `Expected width 100, got ${layout.width}`);
  console.assert(layout.height === 50, `Expected height 50, got ${layout.height}`);
  console.log(`   Layout of box: ${layout.width}x${layout.height} at (${layout.x},${layout.y}) ✓`);

  console.log('\n=== All boot tests passed ===');
}

main().catch(err => {
  console.error('BOOT TEST FAILED:', err);
  process.exit(1);
});
