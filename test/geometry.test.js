// geometry.test.js — browser-oracle truth test for the proof system.
//
// Loads live pages in a real browser (via rodney) and checks that every
// text cell marked `data-witness-text` satisfies two invariants:
//
//   1. Fit — for overflow="visible" the rendered text must not exceed its
//      declaring cell. If span.getBoundingClientRect().width is wider than
//      the parent div's clientWidth, the prover lied about the box fitting.
//
//   2. Parity — the prover's predicted width (data-witness-text="<px>")
//      must match the browser's rendered span width within PARITY_TOLERANCE.
//      Today there is a ~15% buffer baked into Textura's MeasureFunc, so we
//      report the divergence but do not hard-fail on it. Phase 3 of the
//      roadmap drops the buffer — at that point tolerance should tighten
//      to ±1px and parity failures become hard errors.
//
// The test is a plain node script (matches witness/package.json convention).
// It requires `rodney` running (see `rodney status`) and a reachable base
// URL — by default http://localhost:5173, override with WITNESS_BASE_URL.
//
// Paths can be overridden with WITNESS_PROBE_PATHS="/,/projects,/subscribe".

const { execFileSync } = require('child_process');

const BASE_URL = process.env.WITNESS_BASE_URL || 'http://localhost:5173';
const PROBE_PATHS = (process.env.WITNESS_PROBE_PATHS || '/,/projects,/subscribe')
  .split(',').map(s => s.trim()).filter(Boolean);
const PARITY_TOLERANCE = Number(process.env.WITNESS_PARITY_TOLERANCE || '1');
const PARITY_HARD_FAIL = process.env.WITNESS_PARITY_HARD_FAIL === '1';

function rodney(...args) {
  try {
    return execFileSync('rodney', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const out = (err.stdout || '').toString() + (err.stderr || '').toString();
    throw new Error(`rodney ${args.join(' ')} failed: ${out || err.message}`);
  }
}

function ensureRodneyRunning() {
  try {
    const status = rodney('status');
    if (!/Browser running/i.test(status)) {
      throw new Error(`rodney not running:\n${status}\nStart with: rodney start`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

// Probe runs in the browser. Returns a JSON-serializable array — one entry
// per [data-witness-text] cell visible in the layout (zero-size cells are
// elided since they belong to hidden breakpoint branches). Written as a
// single expression with no // line comments so it survives whitespace
// collapse when shelled into `rodney js`.
const PROBE = [
  '(() => {',
  '  const out = [];',
  '  for (const span of document.querySelectorAll("[data-witness-text]")) {',
  '    const parent = span.parentElement;',
  '    if (!parent) continue;',
  '    const sr = span.getBoundingClientRect();',
  '    const pr = parent.getBoundingClientRect();',
  '    if (pr.width === 0 && pr.height === 0) continue;',
  '    out.push({',
  '      text: span.textContent,',
  '      predicted: Number(span.dataset.witnessText),',
  '      overflow: span.dataset.witnessOverflow || "visible",',
  '      browserW: Math.round(sr.width * 100) / 100,',
  '      parentW: Math.round(pr.width * 100) / 100,',
  '      parentClientW: parent.clientWidth,',
  '    });',
  '  }',
  '  return out;',
  '})()',
].join(' ');

function probe(url) {
  rodney('open', url);
  // Small settling delay so layout/fonts commit before we measure.
  execFileSync('sleep', ['0.3']);
  const raw = rodney('js', PROBE);
  try { return JSON.parse(raw); }
  catch (err) { throw new Error(`Could not parse probe output for ${url}:\n${raw}`); }
}

function main() {
  ensureRodneyRunning();

  console.log(`=== Geometry-truth tests ===`);
  console.log(`base: ${BASE_URL}`);
  console.log(`paths: ${PROBE_PATHS.join(', ')}`);
  console.log(`parity tolerance: ±${PARITY_TOLERANCE}px (hard-fail=${PARITY_HARD_FAIL ? 'yes' : 'no'})\n`);

  let visibleCells = 0, clippedCells = 0;
  let fitFailures = 0, parityFailures = 0, cellWidthFailures = 0;
  let maxDiverge = 0, sumDiverge = 0;
  const hardFailures = [];

  for (const p of PROBE_PATHS) {
    const url = `${BASE_URL}${p}`;
    let cells;
    try { cells = probe(url); }
    catch (err) { console.error(`  ✗ ${p}: ${err.message}`); hardFailures.push(err.message); continue; }
    console.log(`  ${p}: ${cells.length} text cells`);
    for (const c of cells) {
      if (c.overflow === 'visible') {
        // Visible cells must not overflow, and the browser's rendered width
        // should match the prover's prediction (once the buffer is dropped).
        visibleCells++;
        if (c.browserW > c.parentClientW + 0.5) {
          console.log(`    ✗ FIT      "${c.text}": browser=${c.browserW}px > cell=${c.parentClientW}px`);
          fitFailures++;
          hardFailures.push(`${p} "${c.text}" fit`);
        }
        const diverge = Math.abs(c.browserW - c.predicted);
        sumDiverge += diverge;
        if (diverge > maxDiverge) maxDiverge = diverge;
        if (diverge > PARITY_TOLERANCE) {
          parityFailures++;
          const sign = c.browserW < c.predicted ? 'shorter' : 'WIDER';
          console.log(`    ${PARITY_HARD_FAIL ? '✗' : '·'} PARITY   "${c.text}": browser=${c.browserW}px ${sign} than predicted=${c.predicted}px (Δ=${diverge.toFixed(2)}px)`);
          if (PARITY_HARD_FAIL) hardFailures.push(`${p} "${c.text}" parity Δ=${diverge.toFixed(2)}`);
        }
      } else {
        // Clipped cells (ellipsis/clip): text is allowed to overflow, CSS
        // truncates it visually. What we verify is that the parent cell's
        // rendered width matches the predicted clip width — i.e. the prover
        // declared a clipWidth and the browser respects it as the cell size.
        clippedCells++;
        const cellDiff = Math.abs(c.parentClientW - c.predicted);
        if (cellDiff > 1) {
          console.log(`    ✗ CELL-W  "${c.text}" [${c.overflow}]: cell=${c.parentClientW}px ≠ predicted=${c.predicted}px`);
          cellWidthFailures++;
          hardFailures.push(`${p} "${c.text}" clip cell width`);
        }
      }
    }
  }

  const totalVisible = visibleCells;
  const meanDiverge = totalVisible > 0 ? (sumDiverge / totalVisible).toFixed(2) : '0';
  console.log(`\n--- Summary ---`);
  console.log(`visible cells: ${visibleCells}   clipped cells: ${clippedCells}`);
  console.log(`fit failures (text overflows visible cell): ${fitFailures}`);
  console.log(`cell-width failures (clipped cell ≠ predicted): ${cellWidthFailures}`);
  console.log(`parity divergences > ${PARITY_TOLERANCE}px (visible only): ${parityFailures}`);
  console.log(`parity divergence mean=${meanDiverge}px max=${maxDiverge.toFixed(2)}px`);

  if (hardFailures.length > 0) {
    console.error(`\n${hardFailures.length} hard failure(s):`);
    for (const f of hardFailures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n=== Geometry-truth tests passed ===`);
}

main();
