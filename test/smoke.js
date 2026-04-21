// Polyfill OffscreenCanvas for Node.js (Pretext needs it for text measurement)
const { createCanvas } = require('canvas');
globalThis.OffscreenCanvas = class OffscreenCanvas {
  constructor(w, h) { this._canvas = createCanvas(w, h); }
  getContext(type) { return this._canvas.getContext(type); }
};

const Shen = require('../vendor/shen-script/lib/shen.js');
const { init, computeLayout } = require('textura');

async function main() {
  console.log('=== Witness Smoke Test ===\n');

  // Test 1: ShenScript basic evaluation
  console.log('1. Testing ShenScript...');
  const $ = await new Shen();
  const result = await $.exec('(+ 1 1)');
  console.assert(result === 2, `Expected 2, got ${result}`);
  console.log(`   (+ 1 1) = ${result} ✓`);

  // Test 2: ShenScript define + call
  console.log('2. Testing $.define...');
  await $.define('test.add', (a, b) => a + b);
  const sum = await $.exec('(test.add 3 4)');
  console.assert(sum === 7, `Expected 7, got ${sum}`);
  console.log(`   (test.add 3 4) = ${sum} ✓`);

  // Test 3: Textura init
  console.log('3. Testing Textura init...');
  await init();
  console.log('   Yoga WASM initialized ✓');

  // Test 4: Textura computeLayout
  console.log('4. Testing computeLayout...');
  const layout = computeLayout({ width: 100, height: 50 });
  console.assert(typeof layout.x === 'number', `Missing x`);
  console.assert(typeof layout.y === 'number', `Missing y`);
  console.assert(layout.width === 100, `Expected width 100, got ${layout.width}`);
  console.assert(layout.height === 50, `Expected height 50, got ${layout.height}`);
  console.log(`   Layout: ${layout.width}x${layout.height} at (${layout.x},${layout.y}) ✓`);

  // Test 5: Textura text measurement
  console.log('5. Testing text layout...');
  const textLayout = computeLayout({
    width: 200,
    flexDirection: 'column',
    children: [
      { text: 'Hello World', font: '16px sans-serif', lineHeight: 20 }
    ]
  });
  console.assert(textLayout.children && textLayout.children.length === 1, 'Expected 1 child');
  const textChild = textLayout.children[0];
  console.assert(textChild.width > 0, `Text width should be > 0, got ${textChild.width}`);
  console.log(`   Text "Hello World" measured at ${textChild.width}px wide ✓`);

  console.log('\n=== All smoke tests passed ===');
}

main().catch(err => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
