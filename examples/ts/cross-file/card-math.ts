// examples/ts/cross-file/card-math.ts
//
// The contracted layout helpers a real app would import — the shape the Witness
// emitter generates (see codegen/emitters/generated/card/card-layout.ts).
//
// The console.assert calls are caller requirements projected from the Shen
// theorems in specs/ui/properties/card-properties.shen.

const SPACE_2 = 8; // token: space-2
const SPACE_4 = 16; // token: space-4
const MOBILE_W = 268; // variant_widths["mobile"] — tightest variant

export function cardContentWidth(variantWidth: number): number {
  console.assert(Number.isInteger(variantWidth));
  console.assert(variantWidth >= MOBILE_W); // card-variants-respect-minimum-content-width
  return variantWidth - 2 * SPACE_4;
}

export function cardActionSlotWidth(available: number, actionCount: number): number {
  console.assert(Number.isFinite(available));
  console.assert(Number.isInteger(actionCount));
  console.assert(actionCount >= 1); // action-pair-plus-gap-never-exceeds-tightest-variant
  return (available - SPACE_2 * (actionCount - 1)) / actionCount;
}
