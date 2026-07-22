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
// Load order below is identical to bin/witness-check.sh's phase 2:
//   1. .witness/measurements.shen   (tc -)  — the Pretext measurement cache
//   2. shen/witness-sbcl.shen       (tc -)  — proofs/errors/tailwind, then (tc +)
//   3. each spec under test         (tc +)  — the actual proof obligation
//
// Exit 0 = every file loaded and type-checked. Exit 1 = a type error, an
// unprovable :verified premise, or a load failure (reported with the file).
//
// Usage: node cli/shen-check.js <file.shen> [file2.shen ...]

const path = require('path');
const fs = require('fs');
const os = require('os');
const { boot } = require('../boot');

const PRELUDE = ['.witness/measurements.shen', 'shen/witness-sbcl.shen'];

// An ill-typed definition: the signature promises a number, the body returns a
// string. Under tc+ this MUST fail to load. Used as a liveness probe for the
// type checker itself — see the call site.
const PROBE_SRC = '(define shen-check-tc-probe { --> number } -> "not a number")\n';

function writeProbe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'witness-tc-probe-'));
  const p = path.join(dir, 'probe.shen');
  fs.writeFileSync(p, PROBE_SRC, 'utf8');
  return p;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node cli/shen-check.js <file.shen> [file2.shen ...]');
    process.exit(2);
  }

  const repoRoot = path.join(__dirname, '..');
  const probePath = writeProbe();

  let failed = 0;
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
    // Relative label for in-tree files; absolute for anything outside the repo
    // (a `../../../..` prefix is noise, not information).
    const rel = path.relative(repoRoot, abs);
    const label = !rel ? f : rel.startsWith('..') ? abs : rel;

    // A missing file is not a type error, and must not be reported as one.
    if (!fs.existsSync(abs)) {
      failed++;
      console.error(`  ✗ ${label}: file not found`);
      continue;
    }

    // FRESH KERNEL PER FILE. `tc` is global session state, so a single `(tc -)`
    // anywhere in a file used to silently disable type checking for every file
    // after it — while this script still printed "type-checked under tc+".
    // Per-file isolation also stops one file's definitions from satisfying the
    // next file's references, and stops a half-loaded file from leaving partial
    // definitions behind that make a later file pass.
    const $ = await boot({ skipLoad: true });

    for (const rel of PRELUDE) {
      try {
        await $.load(path.join(repoRoot, rel));
      } catch (e) {
        console.error(`  ✗ failed to load ${rel} (proof prelude): ${firstLine(e)}`);
        console.error('    The prelude must load cleanly before any spec can be checked.');
        process.exit(1);
      }
    }

    // ACTIVE PROBE: prove the type checker is actually on, rather than assuming
    // the prelude left it on. The probe is ill-typed by construction, so if it
    // LOADS, tc+ is off and every result from this run would be a false green.
    try {
      await $.load(probePath);
      console.error(`  ✗ ${label}: ABORTING — tc+ is not active (the ill-typed probe loaded clean).`);
      console.error('    Every "pass" in this run would be meaningless. Check for a (tc -) in the');
      console.error('    prelude or in a file loaded by it.');
      process.exit(1);
    } catch (_) {
      // Expected: the probe must fail. tc+ is live.
    }

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
