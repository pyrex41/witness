// examples/ts/grid-layout-broken.ts
//
// The failing twin of grid-layout.ts — the TypeScript counterpart to
// examples/card-overflow.shen.
//
// Everything here typechecks perfectly under `tsc`. It is a real bug that ships,
// renders a NaN-wide column, and is discovered by a user on a narrow screen.
// freerange rejects it at build time instead:
//
//   ./node_modules/.bin/fr examples/ts/grid-layout-broken.ts
//
//   examples/ts/grid-layout-broken.ts(43,10): error [declared-requirement]: call to
//   gridItemWidth makes its declared requirement definitely false (declared at ...)
//
// Excluded from tsconfig.json's include on purpose: it is *meant* to fail, and a
// gate that never sees a failure isn't a gate. Gate 5 runs the equivalent fixture
// (codegen/ts/demo/consumer-bad.ts) and fails if freerange stays silent about it.

const GUTTER = 16;
const MIN_COL_W = 240;

export function gridColumnCount(containerWidth: number): number {
  console.assert(Number.isFinite(containerWidth));
  console.assert(containerWidth >= MIN_COL_W);
  return Math.floor((containerWidth + GUTTER) / (MIN_COL_W + GUTTER));
}

export function gridItemWidth(containerWidth: number): number {
  console.assert(Number.isFinite(containerWidth));
  console.assert(containerWidth >= MIN_COL_W);
  const columns = gridColumnCount(containerWidth);
  return (containerWidth - GUTTER * (columns - 1)) / columns;
}

// THE BUG: a sidebar-inset breakpoint that leaves 200px of content width.
//
// 200 < MIN_COL_W (240), so gridColumnCount would floor to 0, and gridItemWidth
// would divide by it. Nothing about this line is a *type* error — the argument is
// a perfectly good `number`. It is a *range* error, and range is exactly what
// Witness proves in Shen and freerange proves in TypeScript.
export function narrowSidebarItemWidth(): number {
  return gridItemWidth(200);
}
