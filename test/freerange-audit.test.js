// test/freerange-audit.test.js
//
// The freerange -> Shen bridge turns another tool's human-readable output into
// facts that a proof system consumes. That makes its failure mode unusually
// nasty: a parser that misreads output does not produce an error, it produces a
// FACT. These tests pin the two soundness gates that decide whether an interval
// becomes a `(bounded Lo Hi)` fact.
//
// Both gates were absent, and both were found by review rather than by anything
// failing:
//
//   1. "fully analyzed" was inferred from the ABSENCE of partially-supported /
//      unsupported / skipped markers. Those buckets fill only on matching one
//      of eight hardcoded labels, so a renamed label meant empty buckets and a
//      function judged fully analyzed on the strength of output the parser did
//      not understand. Format drift manufactured confidence.
//
//   2. A "possibly NaN" return with finite bounds became a hard interval fact.
//      NaN satisfies no interval, so that fact is false, not merely imprecise.

const { parseAuditText, buildBoundsFacts } = require('../cli/freerange-audit');

const FILE = 'x.ts';

// A minimal well-formed audit report for one numeric function. `lo`/`hi` set
// the interval; `blame` appends a parsed blame suffix (e.g. "(can overflow at
// x.ts:3:5)") to the ensures line.
function auditText({
  domain = 'finite',
  coverage = '1/1 functions fully analyzed',
  extra = '',
  lo = 100,
  hi = 200,
  blame = '',
}) {
  const ensures = `  ensures: return is a ${domain} number from ${lo} through ${hi}${blame ? ' ' + blame : ''}`;
  return [
    `# ${FILE} (${coverage})`,
    '',
    '## Contracts',
    '',
    'someWidth',
    '  requires: Number.isFinite(w) (input at x.ts:1:1)',
    ensures,
    extra,
    '',
    'coverage: 1/1 named top-level function declarations fully analyzed; 0 partially supported; 0 unsupported.',
  ].filter(l => l !== '').join('\n');
}

function factsFor(text) {
  const report = parseAuditText(text, [FILE]);
  const result = buildBoundsFacts([{ ok: true, report }]);
  return result;
}

function main() {
  console.log('=== freerange audit bridge: soundness gates ===\n');
  let passed = 0;
  let failed = 0;
  const check = (name, cond, detail) => {
    if (cond) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); failed++; }
  };

  // Baseline: a clean, fully-analyzed, finite interval SHOULD produce a fact.
  // Without this the other assertions could pass by the bridge emitting nothing
  // ever, which is safe but useless.
  let r = factsFor(auditText({}));
  check('a clean finite interval becomes a fact', r.facts.length === 1,
    `got ${r.facts.length} facts`);

  // Gate 2: possibly-NaN must be excluded.
  r = factsFor(auditText({ domain: 'possibly NaN' }));
  check('possibly-NaN return is excluded', r.facts.length === 0, `got ${r.facts.length} facts`);
  check('  ... and says why', (r.excluded[0] || {}).reason === 'return-may-be-nan',
    JSON.stringify(r.excluded[0]));

  // Gate 2: possibly non-finite must be excluded.
  r = factsFor(auditText({ domain: 'possibly non-finite' }));
  check('possibly non-finite return is excluded', r.facts.length === 0, `got ${r.facts.length} facts`);

  // Gate 1: an UNRECOGNISED marker line must suppress facts for the file rather
  // than be ignored. This simulates freerange renaming a label.
  r = factsFor(auditText({ extra: '  not supported: something we do not recognise' }));
  check('an unrecognised line suppresses facts (drift degrades to silence)',
    r.facts.length === 0, `got ${r.facts.length} facts`);

  // Gate 1: the coverage header must corroborate. Here the per-function buckets
  // are clean but the header disagrees.
  const disagreeing = auditText({}).replace(
    'coverage: 1/1 named top-level function declarations fully analyzed; 0 partially supported; 0 unsupported.',
    'coverage: 0/1 named top-level function declarations fully analyzed; 0 partially supported; 1 unsupported.'
  );
  r = factsFor(disagreeing);
  check('a disagreeing coverage header suppresses facts', r.facts.length === 0,
    `got ${r.facts.length} facts`);

  // Gate 3: an INVERTED interval (lower > upper) is empty; no value satisfies
  // it, so it must never become a `(bounded Lo Hi)` fact. Fed "from 200 through
  // 100" the bridge used to emit `(bounded 200 100)`.
  r = factsFor(auditText({ lo: 200, hi: 100 }));
  check('an inverted interval is excluded', r.facts.length === 0, `got ${r.facts.length} facts`);
  check('  ... and says why', (r.excluded[0] || {}).reason === 'inverted-interval',
    JSON.stringify(r.excluded[0]));

  // Gate 2b: an overflow-blamed ensures is suspect even with a finite domain —
  // the blame suffix was parsed but never consulted, so it emitted anyway.
  r = factsFor(auditText({ blame: '(can overflow at x.ts:3:5)' }));
  check('an overflow-blamed finite interval is excluded', r.facts.length === 0,
    `got ${r.facts.length} facts`);
  check('  ... and says why', (r.excluded[0] || {}).reason === 'overflow-blamed',
    JSON.stringify(r.excluded[0]));

  // Regression: a plain finite interval with NEITHER defect still emits. (The
  // baseline above uses the default 100..200; this pins a different closed
  // interval so the two new gates can't pass by suppressing everything.)
  r = factsFor(auditText({ lo: 8, hi: 42 }));
  check('a normal finite interval still emits (regression)', r.facts.length === 1,
    `got ${r.facts.length} facts`);
  check('  ... with the stated bounds',
    r.facts.length === 1 && r.facts[0].lower === 8 && r.facts[0].upper === 42,
    JSON.stringify(r.facts[0]));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
