#!/usr/bin/env node
/**
 * bin/witness-component-loader.js
 *
 * Tiny generic component loader / discovery utility.
 *
 * - Discovers all specs/ui/properties/*-properties.shen files (the convention
 *   for protected component high-level contracts + design-fidelity theorems).
 * - Can print the exact (load "...") forms for inclusion.
 * - --update : safely rewrites the managed section inside
 *   specs/design/the prelude so that Gate 1/2 automatically cover
 *   every component's properties with ZERO manual wiring or edits to
 *   witness-core.shen when a new *-properties.shen is added.
 *
 * This (plus the per-emitter fidelityChecks[] + Gate 4 auto-discovery of
 * *-emitter.js) completes the "mechanical -> turnkey" step for protected
 * components.
 *
 * Used by:
 *   - `witness spec-init <Name>` (scaffolder invokes after writing skeleton)
 *   - Manual: node bin/witness-component-loader.js --update
 *   - CI / gates (optional pre-step, but committed state is authoritative)
 *
 * Philosophy: convention + tiny discoverer > hand-maintained lists.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROPERTIES_DIR = path.join(ROOT, 'specs', 'ui', 'properties');
// Target the PRELUDE, not specs/design/witness-core.shen.
//
// Component contracts must be loaded with type checking OFF: their constructor
// functions have no inline signatures, and under tc+ every define requires one.
// witness-core.shen is type-checked BY Gate 1 (it is in specs/design/), so
// loading contracts from there would pull them into tc+ and fail. The prelude
// loads them under tc-, exactly as it already does for shen/proofs.shen, and
// Gate 1 then checks specs that USE those contracts — which is where the
// obligations actually get evaluated.
const WITNESS_CORE = path.join(ROOT, 'shen', 'witness-sbcl.shen');

const START_MARKER = '--- UI component properties (auto-discovered + maintained by tiny generic loader) ---';
const END_MARKER = '--- End UI component properties loads ---';

function discoverProperties() {
  try {
    const entries = fs.readdirSync(PROPERTIES_DIR);
    return entries
      .filter((f) => /-properties\.shen$/.test(f))
      .map((f) => `specs/ui/properties/${f}`)
      .sort(); // deterministic alpha order
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function generateLoadStatements() {
  const files = discoverProperties();
  if (files.length === 0) {
    return ';; (no *-properties.shen files discovered yet)';
  }
  return files.map((p) => `(load "${p}")`).join('\n');
}

function getCurrentLoadsBlock() {
  const content = fs.readFileSync(WITNESS_CORE, 'utf8');
  const markerIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (markerIdx === -1 || endIdx === -1 || endIdx < markerIdx) {
    return null;
  }
  // Start replacing at the BEGINNING OF THE LINE holding the marker, not at the
  // marker text itself. The rewritten block supplies its own `\\ ` comment
  // prefix, so anchoring mid-line left the old prefix in place and prepended a
  // new one on every run — each invocation added another backslash, and the
  // file drifted (caught by Gate 3 after running the loader twice). The same
  // applies to the end marker's prefix.
  const startIdx = content.lastIndexOf('\n', markerIdx) + 1;
  const endMarkerLineStart = content.lastIndexOf('\n', endIdx) + 1;
  return {
    content,
    startIdx,
    endIdx: endMarkerLineStart,
    fullEnd: endIdx + END_MARKER.length,
  };
}

function updateWitnessCore(dryRun = false) {
  const block = getCurrentLoadsBlock();
  if (!block) {
    console.error('ERROR: Could not find managed loads section in shen/witness-sbcl.shen');
    console.error('       Look for the START/END markers. First run the scaffolder or insert the block manually.');
    process.exit(1);
  }

  const newLoads = generateLoadStatements();
  const before = block.content.slice(0, block.startIdx);
  const after = block.content.slice(block.fullEnd);
  // Preserve the header comment + blank line style around the loads
  const comment = '\\\\';
  const headerLines = [
    `${comment} --- UI component properties (auto-discovered + maintained by tiny generic loader) ---`,
    `${comment} The tiny loader (bin/witness-component-loader.js) discovers every`,
    `${comment} specs/ui/properties/*-properties.shen and keeps exactly this block`,
    `${comment} in sync (no more hand-editing loads when adding a protected component).`,
    `${comment}`,
    `${comment}   - Run manually: node bin/witness-component-loader.js --update`,
    `${comment}   - scaffolder (\`witness spec-init Foo\`) does this automatically after writing the skeleton.`,
    `${comment}`,
    `${comment} Loaded under tc- so the contracts are available to every spec that Gate 1`,
    `${comment} then type-checks under tc+, with zero per-component wiring by hand.`
  ];
  const replacement =
    headerLines.join('\n') + '\n' +
    newLoads + '\n' +
    `${comment} ${END_MARKER}`;

  const newContent = before + replacement + after;

  if (dryRun) {
    console.log('--- DRY RUN: would write the following loads block to witness-core.shen ---');
    console.log(newLoads);
    console.log('--- (no file modified) ---');
    return;
  }

  // Only write if changed (avoid unnecessary git noise)
  if (newContent === block.content) {
    console.log('✓ witness-core.shen loads block already up to date (' + discoverProperties().length + ' component properties).');
    return;
  }

  fs.writeFileSync(WITNESS_CORE, newContent, 'utf8');
  console.log('✓ Updated specs/design/witness-core.shen with current component properties loads:');
  console.log(newLoads.split('\n').map(l => '    ' + l).join('\n'));
}

function printHelp() {
  console.log(`Usage: node bin/witness-component-loader.js [options]

Tiny generic loader for protected UI component contracts.

Discovers specs/ui/properties/*-properties.shen (the convention for
high-level verified-* datatypes + *-design-fidelity theorems) and
keeps the load list inside specs/design/witness-core.shen in sync.

This removes the last piece of manual wiring when adding a new
protected component under the design gates (Gate 1/2).

Options:
  --print-loads, -p     Print the (load "...") statements for the discovered files (stdout)
  --update, -u          Rewrite the managed section in witness-core.shen (idempotent)
  --dry-run, -n         With --update: show what would change, do not write
  --help, -h            This help

Examples:
  node bin/witness-component-loader.js --print-loads
  node bin/witness-component-loader.js --update
  witness spec-init Button     # scaffolder creates + invokes this --update

After adding a new *-properties.shen (by hand or via spec-init) you only need
to run the update (or let the scaffolder do it). Gate 1/2 then see it
automatically via the witness-core load. Gate 4 sees the emitter automatically.
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const dry = args.includes('--dry-run') || args.includes('-n');

  if (args.includes('--print-loads') || args.includes('-p')) {
    console.log(generateLoadStatements());
    return;
  }

  if (args.includes('--update') || args.includes('-u')) {
    updateWitnessCore(dry);
    return;
  }

  console.error('Unknown options. Use --help');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  discoverProperties,
  generateLoadStatements,
  updateWitnessCore
};
