#!/usr/bin/env node
// witness agent <files...> [--max-iter N] [--dry-run] [--respect-design-gates] [--gate <quick|full|N|...>]
// Self-correcting agent loop: check files, report errors, apply fixes, iterate.
// With --respect-design-gates (or `witness loop`), design gates are first-class
// citizens: gate failures become high-priority spec violations fed back to the caller/model.
// --gate chooses the gate set run before each iteration (quick=default fast 1+2, full=all incl TCB+emitter, or specific like 4).
const fs = require('fs');
const path = require('path');
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

async function agent(files, maxIter, dryRun, respectDesignGates = false, gateSpec = 'quick') {
  const $ = await boot();
  // Disable type checking so files can define functions without signatures.
  // assert-fits still runs as a runtime check during load.
  await $.exec('(tc -)');

  for (let i = 0; i < maxIter; i++) {
    const errors = [];

    // Design gates as first-class citizens in the loop (sb-style backpressure).
    // Run before proposing/ applying any edits in this iteration. Failure is a
    // high-priority spec violation that the model must address by editing the
    // design spec OR the implementation.
    if (respectDesignGates) {
      const { execSync } = require('child_process');
      const gateScript = path.join(__dirname, '..', 'bin', 'witness-design-gates.sh');
      let gateCmd = `bash ${gateScript}`;
      if (gateSpec === 'quick') {
        gateCmd += ' --quick';
      } else if (gateSpec === 'full') {
        gateCmd += ' --full';
      } else if (gateSpec) {
        gateCmd += ` --gate ${gateSpec}`;
      } else {
        gateCmd += ' --quick';
      }

      let gateOutput = '';
      try {
        gateOutput = execSync(gateCmd, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        if (gateOutput) console.log(gateOutput.trim());
      } catch (e) {
        gateOutput = (e.stdout || '') + (e.stderr || '');
        if (gateOutput) console.log(gateOutput.trim());
        const gateLabel = gateSpec || 'quick';
        const suggestedGateCmd = gateSpec ? `witness gates --gate ${gateSpec}` : 'witness gates --quick';
        const suggestedLoopCmd = `witness loop ${files.join(' ')} --gate ${gateLabel} --max-iter ${maxIter}`;
        errors.push({
          file: '<design-gates>',
          message:
            `DESIGN SPEC VIOLATION (Gate ${gateLabel} — high-priority backpressure):\n${gateOutput}\n\n` +
            `The design contracts in specs/design/ (witness-core, renderer contracts, ` +
            `Card verified datatypes, emitter fidelity, etc.) have been violated by the current state.\n\n` +
            `Remediation (exact instructions — follow these):\n` +
            `  1. Read the gate failure details above (full runner output).\n` +
            `  2. Diagnose further: ${suggestedGateCmd}   (or 'witness gates' for the complete suite)\n` +
            `  3. Either:\n` +
            `       • Edit the design spec (specs/design/*.shen or specs/ui/card-spec.shen + properties/)\n` +
            `         to reflect the new intended contracts, OR\n` +
            `       • Fix the implementation (shen/*.shen, cli/, bin/, codegen/emitters/, etc.)\n` +
            `         to restore fidelity to the existing proven contracts.\n` +
            `  4. Re-validate: ${suggestedLoopCmd}\n` +
            `  5. Only continue autonomous changes once 'witness gates' (and the chosen --gate) is fully green.\n\n` +
            `This is the self-hosting protection: the same proof engine that turns layout overflow into a\n` +
            `compile-time error for users now prevents silent drift while evolving the Witness/Card/emitter system.\n` +
            `Do not ignore or work around this block.`
        });
      }
    }

    // Only attempt user-file loads if no design gate failure (keeps high-prio clean)
    if (errors.length === 0) {
      for (const file of files) {
        try {
          await $.load(path.resolve(file));
        } catch (err) {
          errors.push({ file, message: err.message });
        }
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

      if (err.file === '<design-gates>') {
        // No automatic fix for design violations; the exact message above is the
        // feedback for the model / autonomous loop. Stop after reporting.
        continue;
      }

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
    console.log(`Usage: witness agent <files...> [--max-iter N] [--dry-run] [--respect-design-gates] [--gate <quick|full|N|...>]

Self-correcting agent loop. Checks files against layout proofs,
reports structured errors with fix suggestions, and auto-applies fixes.

When --respect-design-gates is given (or via 'witness loop' / witness-loop),
before/after proposing edits the agent runs the chosen design gates
(\`witness gates --quick\` by default, or --gate full / --gate 4 / etc.).
Any design gate failure is treated as a high-priority "DESIGN SPEC VIOLATION"
with the *full* rich gate output + exact remediation commands ("edit spec or
implementation", suggested witness gates / loop re-run). This is the
sb-style backpressure that protects the Card spike, emitter, and all specs.

Options:
  --max-iter N              Maximum iterations (default: 10)
  --dry-run                 Show fixes without applying them
  --respect-design-gates    Run design fidelity gates each iteration; gate
                            errors are fatal spec violations (recommended
                            for work on specs/design/, specs/ui/, or core)
  --gate <spec>             Gate selection for the respect mode (default: quick):
                              quick   = Gates 1+2 only (fast inner loop)
                              full    = all 1-4 (TCB audit + emitter fidelity)
                              1|2|3|4|audit|emitter|tc|proofs = single gate or alias
                            (see: witness gates --help for full list)`);
    return;
  }

  const maxIterIdx = args.indexOf('--max-iter');
  const maxIter = maxIterIdx !== -1 ? parseInt(args[maxIterIdx + 1], 10) : 10;
  const dryRun = args.includes('--dry-run');
  const respectDesignGates = args.includes('--respect-design-gates');
  const gateIdx = args.indexOf('--gate');
  const gateSpec = gateIdx !== -1 ? args[gateIdx + 1] : 'quick';
  const files = args.filter((f, i) =>
    !f.startsWith('--') &&
    f !== '--respect-design-gates' &&
    (maxIterIdx === -1 || i !== maxIterIdx + 1) &&
    (gateIdx === -1 || (i !== gateIdx && i !== gateIdx + 1))
  );

  await agent(files, maxIter, dryRun, respectDesignGates, gateSpec);
}

main().catch(err => { console.error(err); process.exit(1); });
