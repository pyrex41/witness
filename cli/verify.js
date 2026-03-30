#!/usr/bin/env node
// witness verify <figma.json> <shen-file> [tolerance]
// Figma structural verification wrapper
const { boot } = require('../boot');

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: witness verify <figma.json> <shen-file> [tolerance]');
    console.error('  Compares Figma design export against computed Shen layout.');
    process.exitCode = 1;
    return;
  }

  const [figmaJson, shenFile] = args;
  const tolerance = args[2] || '2';

  console.log(`Verifying ${shenFile} against Figma spec ${figmaJson} (tolerance: ${tolerance}px)...`);

  const $ = await boot();
  await $.load(shenFile);

  const result = await $.exec(`(verify-figma "${figmaJson}" [] ${tolerance})`);
  const arr = $.toArray(result);

  if (arr[0] === 'pass') {
    console.log(`  \u2713 ${arr[1]}`);
  } else {
    console.error('  \u2717 Structural drift detected:');
    for (let i = 1; i < arr.length; i++) {
      console.error(`    ${JSON.stringify(arr[i])}`);
    }
    process.exitCode = 1;
  }
}

main().catch(err => { console.error(err); process.exit(1); });
