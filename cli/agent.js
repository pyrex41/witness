#!/usr/bin/env node
// witness agent <files...> [--max-iter N]
// Self-correcting agent loop: check files, report errors, iterate
const { boot } = require('../boot');

async function agent(files, maxIter) {
  const $ = await boot();
  // Disable type checking so files can define functions without signatures.
  // assert-fits still runs as a runtime check during load.
  await $.exec('(tc -)');

  for (let i = 0; i < maxIter; i++) {
    const errors = [];

    for (const file of files) {
      try {
        await $.load(file);
      } catch (err) {
        errors.push({ file, message: err.message });
      }
    }

    if (!errors.length) {
      console.log(`Done in ${i + 1} iteration${i > 0 ? 's' : ''}`);
      return;
    }

    console.log(`Iteration ${i + 1}: ${errors.length} error${errors.length > 1 ? 's' : ''}`);
    for (const err of errors) {
      console.error(`  ${err.file}: ${err.message}`);

      // Try to generate structured error reports via check-text
      const match = err.message.match(/Layout overflow: '(.+?)' in (.+?) = ([\d.]+)px, container = ([\d.]+)px/);
      if (match) {
        const [, text, font, measured, available] = match;
        try {
          const report = await $.exec(`(format-error (make-layout-error "${text}" "${font}" ${measured} ${available}))`);
          console.error(`  ${report}`);
        } catch (_) { /* structured report not available */ }
      }
    }

    // v1: report only, don't auto-fix
    // Future: parse errors, compute fixes, rewrite files, re-check
    break;
  }

  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`Usage: witness agent <files...> [--max-iter N]

Self-correcting agent loop. Checks files against layout proofs,
reports structured errors with fix suggestions.

Options:
  --max-iter N    Maximum iterations (default: 10)`);
    return;
  }

  const maxIterIdx = args.indexOf('--max-iter');
  const maxIter = maxIterIdx !== -1 ? parseInt(args[maxIterIdx + 1], 10) : 10;
  const files = args.filter((f, i) => !f.startsWith('--') && (maxIterIdx === -1 || i !== maxIterIdx + 1));

  await agent(files, maxIter);
}

main().catch(err => { console.error(err); process.exit(1); });
