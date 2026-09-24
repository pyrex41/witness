// lib/figma-report.js — human-readable lines for a verify-figma drift result.
//
// verify-figma returns [fail Diffs], where Diffs is a Shen list of
//   [name-diff Name [[w-diff F C] ...]]   a named node that drifted
//   [[h-diff F C] ...]                    an unnamed node, matched by position
//   [count-mismatch NFigma NCode]         the trees have different node counts
// JSON.stringify on those cons cells drops every symbol, so the old output was
// an unreadable {"head":…,"tail":…} dump with no hint of which field drifted.

const FIELD = { 'x-diff': 'x', 'y-diff': 'y', 'w-diff': 'width', 'h-diff': 'height' };

function toPlain($, v) {
  if (typeof v === 'symbol') return $.nameOf(v);
  if (v === null || $.isCons(v)) return $.toArray(v).map(x => toPlain($, x));
  return v;
}

function fieldDiffs(diffs) {
  return diffs
    .map(([kind, figma, code]) => `${FIELD[kind] || kind} ${figma} in Figma, ${code} in code`)
    .join('; ');
}

function formatFigmaDrift($, diffs) {
  let unnamed = 0;
  return toPlain($, diffs).map(d => {
    if (d[0] === 'name-diff') return `${d[1]}: ${fieldDiffs(d[2])}`;
    if (d[0] === 'count-mismatch') return `node count: ${d[1]} in Figma, ${d[2]} in code`;
    unnamed += 1;
    return `unnamed node #${unnamed} (matched by position): ${fieldDiffs(d)}`;
  });
}

module.exports = { formatFigmaDrift };
