#!/usr/bin/env node
// cli/theorem-run.js — execute the design theorems and require each to be true.
//
// Gate 2 used to be two `echo` calls. Its entire body printed a banner and then
// "✓ Gate 2 passed", with no command, no exit code, and no dependency on Gate
// 1's result — it passed on an empty checkout. The theorems its banner named
// (tier-1-always-requires-literal, witness-core-design-fidelity,
// renderer-respects-overflow) did not exist anywhere in the repo.
//
// This runs the real ones. A property theorem is, by convention, a nullary
// boolean function declared in a component contract:
//
//     (define some-property-name
//       {--> boolean}
//       -> <expression that computes>)
//
// Discovery is by that shape, so a new component's theorems are picked up with
// no wiring — the same convention Gate 4 uses for *-emitter.js.
//
// A theorem that returns false fails the gate. So does one that errors. So does
// finding no theorems at all: an empty theorem set passing green is precisely
// the failure mode this replaces.

const fs = require('fs');
const path = require('path');
const { boot } = require('../boot');

const repoRoot = path.join(__dirname, '..');
const PRELUDE = ['.witness/measurements.shen', 'shen/witness-sbcl.shen'];
const CONTRACT_DIRS = [path.join(repoRoot, 'specs', 'ui', 'properties')];

// (define NAME {--> boolean}  — a NULLARY boolean define, so it can simply be
// called. Discovery is deliberately formatting-agnostic: the name and its
// signature may sit on the same line or be split across lines, with any amount
// of surrounding whitespace (\s matches newlines too). Nullarity is enforced
// structurally by requiring `-->` to be the FIRST token inside the braces:
// `{--> boolean}` has no argument types, whereas a boolean-returning function
// with parameters spells them before the arrow (`{number --> boolean}`,
// `{card-title-slot --> ... --> boolean}`) and therefore does NOT match — those
// are not theorems and must not be discovered.
const THEOREM_RE = /\(define\s+([A-Za-z][\w?!*<>=/+-]*)\s+\{\s*-->\s*boolean\s*\}/g;

function discoverTheorems() {
  const found = [];
  for (const dir of CONTRACT_DIRS) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir).filter(f => f.endsWith('.shen'));
    } catch (_) {
      continue;
    }
    for (const f of entries) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      let m;
      THEOREM_RE.lastIndex = 0;
      while ((m = THEOREM_RE.exec(src)) !== null) {
        found.push({ name: m[1], file: path.relative(repoRoot, path.join(dir, f)) });
      }
    }
  }
  return found;
}

function isShenTrue(v) {
  if (v === true) return true;
  if (typeof v === 'symbol') {
    return (Symbol.keyFor(v) || v.description || String(v)) === 'true';
  }
  return false;
}

async function main() {
  const theorems = discoverTheorems();
  if (theorems.length === 0) {
    console.error('  ✗ No property theorems found in specs/ui/properties/*.shen.');
    console.error('    A theorem is a nullary boolean define: (define name\\n  {--> boolean}\\n  -> ...).');
    console.error('    Passing with an empty theorem set is exactly the vacuity this gate exists to prevent.');
    process.exit(1);
  }

  // Contracts load under tc- via the prelude; theorems are then EXECUTED, which
  // is a different and stronger check than Gate 1's type checking of them.
  const $ = await boot({ skipLoad: true });
  for (const rel of PRELUDE) {
    try {
      await $.load(path.join(repoRoot, rel));
    } catch (e) {
      console.error(`  ✗ prelude failed to load (${rel}): ${String((e && e.message) || e).split('\n')[0]}`);
      process.exit(1);
    }
  }

  let failed = 0;
  for (const t of theorems) {
    let value;
    try {
      value = await $.exec(`(${t.name})`);
    } catch (e) {
      console.error(`  ✗ ${t.name} [${t.file}] errored: ${String((e && e.message) || e).split('\n')[0]}`);
      failed++;
      continue;
    }
    if (isShenTrue(value)) {
      console.log(`  ✓ ${t.name}`);
    } else {
      console.error(`  ✗ ${t.name} [${t.file}] returned ${String(value)} — the property does not hold.`);
      failed++;
    }
  }

  console.log('');
  if (failed > 0) {
    console.error(`  ${failed} of ${theorems.length} theorem(s) failed.`);
    process.exit(1);
  }
  console.log(`  All ${theorems.length} property theorems executed and hold.`);
  process.exit(0);
}

main().catch(e => {
  console.error('  ✗ theorem runner error:', String((e && e.message) || e).split('\n')[0]);
  process.exit(1);
});
