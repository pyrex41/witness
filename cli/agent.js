#!/usr/bin/env node
// witness agent <files...> [--max-iter N] [--dry-run]
// Self-correcting agent loop: check files, report errors, apply fixes, iterate
const fs = require('fs');
const { boot } = require('../boot');

function applyWidenEdit(filePath, oldWidth, newWidth) {
  const source = fs.readFileSync(filePath, 'utf8');
  // Replace container width values in assert-fits and proven-text calls
  // Match patterns like: (assert-fits "..." "..." OldWidth) and (proven-text "..." "..." OldWidth)
  const oldStr = String(oldWidth);
  const newStr = String(newWidth);
  const patterns = [
    new RegExp(`(\\(assert-fits\\s+"[^"]*"\\s+"[^"]*"\\s+)${oldStr.replace('.', '\\.')}(\\))`, 'g'),
    new RegExp(`(\\(assert-fits\\s+"[^"]*"\\s+\\(mk-font\\s+"[^"]*"\\s+\\d+\\)\\s+)${oldStr.replace('.', '\\.')}(\\))`, 'g'),
    new RegExp(`(\\(proven-text\\s+"[^"]*"\\s+"[^"]*"\\s+)${oldStr.replace('.', '\\.')}(\\))`, 'g'),
    new RegExp(`(\\(proven-text\\s+"[^"]*"\\s+\\(mk-font\\s+"[^"]*"\\s+\\d+\\)\\s+)${oldStr.replace('.', '\\.')}(\\))`, 'g'),
    new RegExp(`(\\(fits\\?\\s+"[^"]*"\\s+"[^"]*"\\s+)${oldStr.replace('.', '\\.')}(\\))`, 'g'),
    new RegExp(`(\\(fits\\?\\s+"[^"]*"\\s+\\(mk-font\\s+"[^"]*"\\s+\\d+\\)\\s+)${oldStr.replace('.', '\\.')}(\\))`, 'g'),
  ];
  let modified = source;
  let changes = 0;
  for (const pattern of patterns) {
    const replaced = modified.replace(pattern, `$1${newStr}$2`);
    if (replaced !== modified) {
      changes += (modified.match(pattern) || []).length;
      modified = replaced;
    }
  }
  if (changes > 0) {
    fs.writeFileSync(filePath, modified);
    return changes;
  }
  return 0;
}

async function agent(files, maxIter, dryRun) {
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

    let fixesApplied = 0;
    for (const err of errors) {
      console.error(`  ${err.file}: ${err.message}`);

      // Try to generate structured error reports and apply fixes
      const match = err.message.match(/Layout overflow: '(.+?)' in (.+?) = ([\d.]+)px, container = ([\d.]+)px/);
      if (match) {
        const [, text, font, measured, available] = match;
        try {
          const report = await $.exec(`(format-error (make-layout-error "${text}" "${font}" ${measured} ${available}))`);
          console.error(`  ${report}`);

          // Get the widen edit suggestion
          const editArr = await $.exec(`(suggestion-edit (hd (tl (error-suggestions (make-layout-error "${text}" "${font}" ${measured} ${available})))))`);
          const edit = $.toArray(editArr);

          if (edit[0] && typeof edit[0] === 'symbol' && $.nameOf(edit[0]) === 'widen') {
            const oldWidth = edit[1];
            const newWidth = edit[2];
            if (dryRun) {
              console.log(`  [dry-run] Would widen ${oldWidth} -> ${newWidth} in ${err.file}`);
            } else {
              const changes = applyWidenEdit(err.file, oldWidth, newWidth);
              if (changes > 0) {
                console.log(`  Applied fix: widened ${oldWidth} -> ${newWidth} (${changes} occurrence${changes > 1 ? 's' : ''} in ${err.file})`);
                fixesApplied += changes;
              } else {
                console.log(`  Could not apply widen edit to ${err.file}`);
              }
            }
          }
        } catch (_) { /* structured report not available */ }
      }
    }

    if (fixesApplied === 0) {
      console.log('  No auto-fixable errors found. Stopping.');
      break;
    }
  }

  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`Usage: witness agent <files...> [--max-iter N] [--dry-run]

Self-correcting agent loop. Checks files against layout proofs,
reports structured errors with fix suggestions, and auto-applies fixes.

Options:
  --max-iter N    Maximum iterations (default: 10)
  --dry-run       Show fixes without applying them`);
    return;
  }

  const maxIterIdx = args.indexOf('--max-iter');
  const maxIter = maxIterIdx !== -1 ? parseInt(args[maxIterIdx + 1], 10) : 10;
  const dryRun = args.includes('--dry-run');
  const files = args.filter((f, i) => !f.startsWith('--') && (maxIterIdx === -1 || i !== maxIterIdx + 1));

  await agent(files, maxIter, dryRun);
}

main().catch(err => { console.error(err); process.exit(1); });
