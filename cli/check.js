#!/usr/bin/env node
const { boot } = require('../boot');

const HELP = `Usage: witness <command> [options] [files...]

Commands:
  dev <files...>        Tier 1 only (instant, static text checks)
  build <files...>      Tier 1 + 2 (bounded worst-case, with type checking)
  check [options] <files...>
    --full              Tier 1 + 2 + 3 (comprehensive)
    --figma <spec.json> Tier 3 only (Figma structural diff)
    --perf              Performance budget proofs
    --sbcl              Use SBCL Shen for proof checking (faster)
  measure <files...>    Pre-compute text measurements for SBCL proof checking
  help                  Show this help`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }

  // measure command — delegates to cli/measure.js
  if (command === 'measure') {
    const { execSync } = require('child_process');
    const measureFiles = args.slice(1);
    execSync(`node ${__dirname}/measure.js ${measureFiles.join(' ')}`, { stdio: 'inherit' });
    return;
  }

  // --sbcl flag — delegates to bin/witness-check.sh
  if (args.includes('--sbcl')) {
    const { execSync } = require('child_process');
    const sbclFiles = args.filter(a => !a.startsWith('--') && a !== command);
    try {
      execSync(`bash ${__dirname}/../bin/witness-check.sh ${sbclFiles.join(' ')}`, { stdio: 'inherit' });
    } catch (e) {
      process.exitCode = 1;
    }
    return;
  }

  const $ = await boot();

  // Parse flags
  const figmaIdx = args.indexOf('--figma');
  const figmaSpec = figmaIdx !== -1 ? args[figmaIdx + 1] : null;
  const hasFull = args.includes('--full');
  const files = args.slice(1).filter((f, i) => {
    if (f.startsWith('--')) return false;
    if (figmaIdx !== -1 && i === figmaIdx) return false;
    return true;
  });

  // Figma structural verification mode
  if (figmaSpec && files.length > 0) {
    console.log(`Verifying Figma spec ${figmaSpec} against ${files[0]}...`);
    try {
      await $.load(files[0]);
      const result = await $.exec(`(verify-figma "${figmaSpec}" [] 2)`);
      const tag = $.toArray(result)[0];
      if (tag === 'pass') {
        console.log('  \u2713 Figma verification passed');
      } else {
        console.error('  \u2717 Figma verification failed: structural drift detected');
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(`  \u2717 ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (files.length === 0) {
    console.error('No files specified. Run "witness help" for usage.');
    process.exitCode = 1;
    return;
  }

  // Tier selection based on command:
  //   dev   = Tier 1 only (assert-fits at load time, tc- so no type sigs needed)
  //   build = Tier 1 + 2 (tc+ for full type checking)
  //   check = defaults to dev behavior; --full enables tc+
  const useTypeChecking = command === 'build' || hasFull;

  if (!useTypeChecking) {
    // Disable type checking so files can define functions without signatures.
    // assert-fits still runs (it's a runtime check during load).
    await $.exec('(tc -)');
  }

  for (const file of files) {
    console.log(`Checking ${file}...`);
    try {
      await $.load(file);
      console.log(`  \u2713 ${file} passed`);
    } catch (err) {
      console.error(`  \u2717 ${file}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
