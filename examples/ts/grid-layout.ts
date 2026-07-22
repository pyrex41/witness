// examples/ts/grid-layout.ts
//
// Witness × freerange, tier 2 (build-time numeric bounds).
//
// Witness proves layout obligations in Shen over values it can measure —
// literal text, declared tokens, fixed variant widths. This file is the other
// half: the arithmetic a real app writes *around* those proven values.
//
//   Shen (specs/ui/properties/*.shen)  proves the design
//   the emitter                        projects each obligation into a
//                                      leading console.assert(...)
//   freerange (Gate 5)                 statically proves the arithmetic
//                                      never violates one
//
// Run it:
//   ./node_modules/.bin/fr examples/ts/grid-layout.ts        # clean
//   ./node_modules/.bin/fr --audit examples/ts/grid-layout.ts # see the contracts
//
// The companion file grid-layout-broken.ts is the same math with one call site
// that violates a contract — freerange rejects it at build time, no browser.

// --- Design tokens (would be projected from (card-contract-shape) by an emitter) ---
// freerange only resolves module constants that are numeric literals, so these
// are inlined deliberately rather than imported. See the cross-file note below.
const GUTTER = 16; // token: space-4
const MIN_COL_W = 240; // narrowest a column may be before we drop to fewer columns
const CARD_PAD = 16; // token: space-4 (card's own left+right padding)

// How many columns fit in a container of the given width.
//
// The `containerWidth >= MIN_COL_W` requirement is what makes this function
// total: below one minimum column, the count would floor to 0 and every
// downstream division by it would be a division by zero.
export function gridColumnCount(containerWidth: number): number {
  console.assert(Number.isFinite(containerWidth));
  console.assert(containerWidth >= MIN_COL_W); // ⇒ result is at least 1
  return Math.floor((containerWidth + GUTTER) / (MIN_COL_W + GUTTER));
}

// Width of a single grid item. This is the division freerange has to prove safe:
// it can only accept it because gridColumnCount's own contract guarantees the
// divisor is >= 1 for every caller that satisfies the requirement above.
export function gridItemWidth(containerWidth: number): number {
  console.assert(Number.isFinite(containerWidth));
  console.assert(containerWidth >= MIN_COL_W);
  const columns = gridColumnCount(containerWidth);
  return (containerWidth - GUTTER * (columns - 1)) / columns;
}

// Content width inside a grid item, after the item's own padding.
// Mirrors cardContentWidth() in the generated codegen/emitters/generated/card/card-layout.ts.
export function gridItemContentWidth(containerWidth: number): number {
  console.assert(Number.isFinite(containerWidth));
  console.assert(containerWidth >= MIN_COL_W);
  return gridItemWidth(containerWidth) - 2 * CARD_PAD;
}

// --- In-file call sites ---
// freerange v0.0.2 does not check contracts across module imports, so the call
// sites that prove these contracts hold must live in this file. (The Witness
// fork at vendor/freerange lifts that restriction — see examples/ts/cross-file/.)
// Each of these is a real breakpoint from the responsive design.

export function mobileItemWidth(): number {
  return gridItemWidth(320);
}

export function tabletItemWidth(): number {
  return gridItemWidth(768);
}

export function desktopItemWidth(): number {
  return gridItemWidth(1280);
}

export function desktopItemContentWidth(): number {
  return gridItemContentWidth(1280);
}
