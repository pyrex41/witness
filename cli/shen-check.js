#!/usr/bin/env node
// cli/shen-check.js — Phase 2 type-checking (tc+) via ShenScript.
//
// The original two-phase checker shells out to a native Shen kernel (shen-cl or
// shen-sbcl) and scrapes its REPL prompt to decide pass/fail. That path is
// fragile in ways that bite in practice:
//
//   - shen-cl reads from /dev/tty and hangs indefinitely on piped stdin, so it
//     has to be wrapped in `script -q /dev/null` and even then can drop into the
//     low-level ldb debugger;
//   - shen-sbcl's availability probe is a 4-second smoke test, which produces
//     false negatives whenever the machine is busy;
//   - deciding "did it type-check?" by grepping for a `(N+)` prompt in scraped
//     terminal output is guesswork, and slow (minutes).
//
// ShenScript is already a dependency (vendor/shen-script, driven by boot.js) and
// runs the same Shen kernel in-process, so it type-checks the same files with the
// same `(tc +)` semantics — in seconds, with a real exception instead of a prompt
// to inspect. `boot({skipLoad: true})` gives the kernel plus witness's JS FFI but
// WITHOUT shen/witness.shen, which matters: witness.shen enables (tc +) at load
// time, and the measurement cache must be read under (tc -) before that happens.
//
// Load order below is identical to bin/witness-check.sh's phase 2, and is the
// order the load-order contract in specs/design/load-order-trust.shen describes:
//   1. .witness/measurements.shen   (tc -)  — the Pretext measurement cache
//   2. shen/witness-sbcl.shen       (tc -)  — proofs/errors/tailwind, then (tc +)
//   3. each spec under test         (tc +)  — the actual proof obligation
//
// Exit 0 = every file loaded and type-checked. Exit 1 = a type error, an
// unprovable :verified premise, or a load failure (reported with the file).
//
// Usage: node cli/shen-check.js <file.shen> [file2.shen ...]

const path = require('path');
const { boot } = require('../boot');

const PRELUDE = ['.witness/measurements.shen', 'shen/witness-sbcl.shen'];

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node cli/shen-check.js <file.shen> [file2.shen ...]');
    process.exit(2);
  }

  const repoRoot = path.join(__dirname, '..');
  const $ = await boot({ skipLoad: true });

  for (const rel of PRELUDE) {
    const abs = path.join(repoRoot, rel);
    try {
      await $.load(abs);
    } catch (e) {
      console.error(`  ✗ failed to load ${rel} (proof prelude): ${firstLine(e)}`);
      console.error('    The prelude must load cleanly before any spec can be checked.');
      process.exit(1);
    }
  }

  let failed = 0;
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
    const label = path.relative(repoRoot, abs) || f;
    try {
      await $.load(abs);
      console.log(`  ✓ ${label}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${label}: ${firstLine(e)}`);
    }
  }

  if (failed > 0) {
    console.error(`\n  ${failed} of ${files.length} file(s) failed tc+.`);
    process.exit(1);
  }
  console.log(`\n  All ${files.length} file(s) type-checked under tc+.`);
  process.exit(0);
}

function firstLine(e) {
  return String((e && e.message) || e).split('\n')[0].trim();
}

main().catch(e => {
  console.error('  ✗ shen-check internal error:', firstLine(e));
  process.exit(1);
});
