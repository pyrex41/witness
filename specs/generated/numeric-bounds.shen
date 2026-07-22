\\ specs/generated/numeric-bounds.shen — GENERATED FILE, DO NOT EDIT BY HAND
\\
\\ Generator:  cli/freerange-audit.js
\\ Invocation: node cli/freerange-audit.js codegen/emitters/generated/card/card-layout.ts --emit-shen specs/generated/numeric-bounds.shen
\\ Source(s):  codegen/emitters/generated/card/card-layout.ts
\\ Generated:  2026-07-22T15:44:31.558Z
\\
\\ Regenerate with:
\\   node cli/freerange-audit.js codegen/emitters/generated/card/card-layout.ts --emit-shen specs/generated/numeric-bounds.shen
\\
\\ HONEST LIMITATION: freerange is NUMBERS ONLY. Every fact below bounds a
\\ numeric layout WIDTH or COUNT that freerange's static interval analysis
\\ inferred for a fully-analyzed, top-level function's return value. This
\\ file says nothing about STRINGS -- bounded-string / max-chars worst-case
\\ proofs are a separate, pre-existing rule (the single-argument
\\ `S : (bounded N)` sequent in shen/proofs.shen, over string-length) that
\\ this generator does not touch and freerange cannot analyze.
\\
\\ Soundness gates applied before a function's return value becomes a fact
\\ here (see cli/freerange-audit.js's buildBoundsFacts):
\\   1. freerange reported the function as FULLY analyzed (no
\\      partially-supported / unsupported / skipped findings for it).
\\   2. Its `ensures` fact for the (whole, top-level) return value parsed
\\      to a CLOSED interval -- both a finite lower and a finite upper
\\      bound. One-sided or fully open ranges are excluded (see below):
\\      there is no "worst case" to discharge a fits?-style obligation
\\      against.
\\
\\ Each fact is a pair: `(define fr-bound-<fn> { --> (list number) } -> [Lo Hi])`
\\ plus companion integer?/finite? flags, consumable by the `(bounded Lo Hi)`
\\ rule in shen/proofs.shen.

\\ cardMobileActionSlot (codegen/emitters/generated/card/card-layout.ts) — from: ensures: return is a finite integer number from 114 through 114
(define fr-bound-card-mobile-action-slot { --> (list number) } -> [114 114])

(define fr-bound-card-mobile-action-slot-integer? { --> boolean } -> true)

(define fr-bound-card-mobile-action-slot-finite? { --> boolean } -> true)

\\ cardTabletActionSlot (codegen/emitters/generated/card/card-layout.ts) — from: ensures: return is a finite integer number from 180 through 180
(define fr-bound-card-tablet-action-slot { --> (list number) } -> [180 180])

(define fr-bound-card-tablet-action-slot-integer? { --> boolean } -> true)

(define fr-bound-card-tablet-action-slot-finite? { --> boolean } -> true)

\\ cardDesktopActionSlot (codegen/emitters/generated/card/card-layout.ts) — from: ensures: return is a finite integer number from 280 through 280
(define fr-bound-card-desktop-action-slot { --> (list number) } -> [280 280])

(define fr-bound-card-desktop-action-slot-integer? { --> boolean } -> true)

(define fr-bound-card-desktop-action-slot-finite? { --> boolean } -> true)

\\ cardMobileActionsRowWidth (codegen/emitters/generated/card/card-layout.ts) — from: ensures: return is a finite integer number from 248 through 248
(define fr-bound-card-mobile-actions-row-width { --> (list number) } -> [248 248])

(define fr-bound-card-mobile-actions-row-width-integer? { --> boolean } -> true)

(define fr-bound-card-mobile-actions-row-width-finite? { --> boolean } -> true)

\\ --- Not emitted (soundness gates above) ---
\\   cardContentWidth (codegen/emitters/generated/card/card-layout.ts): open-or-unbounded-interval [236, null]
\\   cardActionSlotWidth (codegen/emitters/generated/card/card-layout.ts): open-or-unbounded-interval [53, null]
\\   cardActionsRowWidth (codegen/emitters/generated/card/card-layout.ts): return-may-be-non-finite
\\   cardTitleAndActionsFit (codegen/emitters/generated/card/card-layout.ts): no-parsed-ensures-return-fact
\\   cardMobileActionsFitUnderTitle (codegen/emitters/generated/card/card-layout.ts): no-parsed-ensures-return-fact
