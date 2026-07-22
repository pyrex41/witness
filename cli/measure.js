#!/usr/bin/env node
// cli/measure.js — Extract text/font pairs from Shen files and measure with Pretext
//
// Scans for (assert-fits "text" "font" N) and (proven-text "text" "font" N) calls,
// measures each unique (text, font) pair, writes .witness/measurements.shen

const fs = require('fs');
const path = require('path');

// Measurement is delegated to the single shared oracle in lib/measure-core.js.
// This file previously had its own canvas polyfill, its own font-availability
// check that WARNED and measured anyway, and its own `?? 0` fallback — while
// boot.js threw on the same inputs. Two rulers, one cache, and the cache is what
// every `:verified` premise is discharged against.
const {
  measureText,
  isFontAvailable,
  familyOf,
} = require('../lib/measure-core');


// Extract string literals from Shen source — matches (assert-fits "..." "..." N)
// and (proven-text "..." "..." N). Also handles (mk-font "name" size) inline.
function extractPairs(source) {
  const pairs = new Map();

  // Match (assert-fits "text" "font" N) or (assert-fits "text" (mk-font "name" size) N)
  // Match (proven-text "text" "font" N) or (proven-text "text" (mk-font "name" size) N)
  const patterns = [
    /\(assert-fits\s+"([^"]+)"\s+"([^"]+)"\s+[\d.]+\)/g,
    /\(assert-fits\s+"([^"]+)"\s+\(mk-font\s+"([^"]+)"\s+(\d+)\)\s+[\d.]+\)/g,
    /\(proven-text\s+"([^"]+)"\s+"([^"]+)"\s+[\d.]+\)/g,
    /\(proven-text\s+"([^"]+)"\s+\(mk-font\s+"([^"]+)"\s+(\d+)\)\s+[\d.]+\)/g,
    /\(fits\?\s+"([^"]+)"\s+"([^"]+)"\s+[\d.]+\)/g,
    /\(fits\?\s+"([^"]+)"\s+\(mk-font\s+"([^"]+)"\s+(\d+)\)\s+[\d.]+\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const text = match[1];
      let font;
      if (match[3]) {
        // mk-font pattern: name + size → "Npx Name"
        font = `${match[3]}px ${match[2]}`;
      } else {
        font = match[2];
      }
      const key = `${text}\0${font}`;
      if (!pairs.has(key)) {
        pairs.set(key, { text, font });
      }
    }
  }

  return [...pairs.values()];
}

async function main() {
  const files = process.argv.slice(2).filter(f => !f.startsWith('-'));
  if (!files.length) {
    console.error('Usage: witness measure <file.shen> [file2.shen ...]');
    process.exit(1);
  }

  // Collect all text/font pairs from all files
  const allPairs = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const pairs = extractPairs(source);
    allPairs.push(...pairs);
  }

  // Deduplicate
  const seen = new Set();
  const unique = allPairs.filter(p => {
    const key = `${p.text}\0${p.font}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!unique.length) {
    console.log('No text/font pairs found to measure.');
    return;
  }

  // An unavailable font is FATAL here, not a warning. This cache is the oracle
  // every layout obligation is discharged against; a width measured with a
  // substitute font is not a fact about what renders, and writing it would let
  // a proof succeed against a number nobody can reproduce.
  const missing = [...new Set(unique.map(u => u.font))].filter(f => !isFontAvailable(f));
  if (missing.length) {
    console.error('ERROR: cannot measure — font(s) not available:');
    for (const f of missing) console.error(`  - ${familyOf(f)}  (from ${JSON.stringify(f)})`);
    console.error('');
    console.error('Install the font, or use a generic family (sans-serif, serif, monospace).');
    console.error('Refusing to write measurements taken with a substitute font.');
    process.exit(1);
  }

  // measureText throws on a failed measurement rather than yielding 0.
  const measurements = unique.map(({ text, font }) => ({
    text,
    font,
    width: measureText(text, font),
  }));

  // Write .witness/measurements.shen — ALWAYS at the repo root.
  //
  // This used to be process.cwd()/.witness while every reader
  // (cli/shen-check.js, shen/witness-sbcl.shen's prelude) resolves the cache
  // relative to the repo root. Running the checker from a subdirectory wrote a
  // fresh cache somewhere nobody reads and then type-checked against whatever
  // stale cache happened to be at the root — with no error, and no way to tell
  // from the output. For a file that is the oracle behind every fits?
  // obligation, "which copy did we just prove against?" must not depend on cwd.
  //
  // The root it is written to follows the PROJECT, not the package: a consumer's
  // cache must live in its own repo. Writing into node_modules/witness/.witness
  // would put the measurements every downstream proof is discharged against
  // somewhere the next `npm install` destroys. Unset, this is the witness
  // package itself, exactly as before.
  const projectRoot = process.env.WITNESS_PROJECT_ROOT || path.join(__dirname, '..');
  const outDir = path.join(projectRoot, '.witness');
  fs.mkdirSync(outDir, { recursive: true });

  const lines = measurements.map(m =>
    `  ["${m.text}" "${m.font}" ${m.width}]`
  );

  const output = `\\\\ Auto-generated by witness measure — do not edit
\\\\ ${new Date().toISOString()}

(set *measurements* [
${lines.join('\n')}
])
`;

  const outPath = path.join(outDir, 'measurements.shen');
  fs.writeFileSync(outPath, output);

  console.log(`  Measured ${measurements.length} text/font pairs`);
  for (const m of measurements) {
    console.log(`    "${m.text}" in ${m.font} = ${m.width.toFixed(2)}px`);
  }
  console.log(`  Wrote ${outPath}`);
}

main().catch(err => {
  console.error('measure failed:', err.message);
  process.exit(1);
});
