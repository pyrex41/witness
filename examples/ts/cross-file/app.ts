// examples/ts/cross-file/app.ts
//
// Hand-written consumer code — the code Witness most wants to protect, because
// it is the code no proof currently reaches.
//
// Both calls below violate a contract declared in ./card-math.ts:
//   - cardActionSlotWidth(w, 0)  violates  console.assert(actionCount >= 1)
//                                (a division by zero, one render away)
//   - cardContentWidth(200)      violates  console.assert(variantWidth >= 268)
//
// Published @chenglou/freerange@0.0.2 reports NEITHER. Cross-module calls are
// silently unanalyzed, so the guarantee stops dead at the file boundary:
//
//   cd examples/ts/cross-file && ../../../node_modules/.bin/fr
//   → No lint findings. 0 findings (0 errors, 0 warnings).
//
// The Witness fork (vendor/freerange, `--cross-file`) resolves the imported
// callee through the TypeScript checker, analyzes its file, and applies its
// requirements here:
//
//   cd examples/ts/cross-file && node ../../../vendor/freerange/dist/fr.js --cross-file
//   → app.ts(N,M): error [declared-requirement]: call to cardActionSlotWidth
//     makes its declared requirement definitely false (declared at card-math.ts(...))
//
// Run both with: bash docs/freerange-demo.sh

import { cardActionSlotWidth, cardContentWidth } from './card-math';

export function actionWidthForEmptyToolbar(): number {
  const available = cardContentWidth(268);
  return cardActionSlotWidth(available, 0);
}

export function contentWidthForNarrowInset(): number {
  return cardContentWidth(200);
}
