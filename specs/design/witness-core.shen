\\ specs/design/witness-core.shen — Gate 1's payload.
\\
\\ This file is type-checked under tc+ by Gate 1 (bin/witness-design-gates.sh),
\\ with the component contracts already loaded under tc- by the prelude
\\ (shen/witness-sbcl.shen). Everything below is a CONSTRUCTION: building these
\\ values forces the type checker to evaluate the `if` side conditions on the
\\ contract datatypes in specs/ui/properties/card-properties.shen, which run the
\\ real Pretext ruler over the real declared fonts and widths.
\\
\\ This file was previously 20 lines of comments and nothing else, so Gate 1
\\ type-checked an empty file and reported "all :verified premises proven". If
\\ this file ever goes back to being inert, Gate 1 becomes decoration again —
\\ the whole point is that these constructions can FAIL.
\\
\\ To see that they can: widen a slot's text or shrink its MaxW below the
\\ measured width and re-run `./bin/witness-design-gates.sh --gate 1`. It must
\\ fail with a type error naming the definition.

\\ --- Tier 1: the canonical Card slots, measured for real ---
\\
\\ "Card Title" in 18px sans-serif measures 77.36px; the title slot's proven
\\ bound from (card-contract-shape) is 268px. The action labels measure 76.78px
\\ ("View Details") and 31.91px ("Save") against a 120px bound.
\\
\\ Each of these is the DATA form the contract datatype concludes on. The
\\ constructor functions (mk-card-title etc.) return exactly this shape; the
\\ data form is used here because a constructor with a signature promising
\\ card-title-slot would hand out the type without the fits? premise.

(define canonical-card-title
  { --> card-title-slot }
  -> [card-title "Card Title" "18px sans-serif" 268 default-tokens])

(define canonical-card-desc
  { --> card-desc-slot }
  -> [card-desc "Short desc for construction." "14px sans-serif" 268 ellipsis default-tokens])

(define canonical-card-action-primary
  { --> card-action-slot }
  -> [card-action "View Details" "14px sans-serif" 120 default-tokens])

(define canonical-card-action-secondary
  { --> card-action-slot }
  -> [card-action "Save" "14px sans-serif" 120 default-tokens])

\\ --- The composite obligation ---
\\
\\ Constructing a verified-card evaluates the layout / figma / responsive
\\ obligations in card-properties.shen's `if` clause, over slots that have each
\\ already discharged their own fits? side condition above.

(define canonical-verified-card
  { --> verified-card }
  -> [card (canonical-card-title)
           (canonical-card-desc)
           [(canonical-card-action-primary) (canonical-card-action-secondary)]
           mobile
           default-tokens])
