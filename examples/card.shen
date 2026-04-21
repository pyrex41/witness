\\ card.shen — Demo card component with layout proofs
\\
\\ Demonstrates:
\\   - Static text proofs for button labels and title
\\   - handled-text for dynamic description
\\   - Tailwind-style layout (flex, padding, gap)
\\   - SSR-renderable with: witness render examples/card.shen --expr "(render-view)"
\\
\\ Layout: 300px wide card with title, description, and action buttons.
\\ Card has 16px padding, so content area is 268px.

\\ --- Static text proofs (Tier 1: verified at load time) ---

(assert-fits "Card Title" (mk-font "sans-serif" 18) 268)
(assert-fits "View Details" (mk-font "sans-serif" 14) 120)
(assert-fits "Save" (mk-font "sans-serif" 14) 120)

\\ --- Card components ---
\\ Under the Phase 4 trust model, (proven-text ...) requires a literal string
\\ at its call site. Components that want to carry proven content take the
\\ pre-proven cell as a parameter rather than building it internally from a
\\ variable.

(define card-title
  Cell -> [text-node Cell])

(define card-description
  Desc ->
    [text-node (handled-text Desc (mk-font "sans-serif" 14) 268 ellipsis)])

(define card-button
  Cell ->
    (tw ["px-4" "py-2" "rounded-lg" "text-sm"]
      [[text-node Cell]]))

\\ --- Render the card view ---
\\ Called by: witness render examples/card.shen --expr "(render-view)"

(define render-view
  -> [frame (mk-props9 300 0 "column" 16 16 "" "" 0 0)
      [(card-title (proven-text "Card Title" (mk-font "sans-serif" 18) 268))
       (card-description "This is a description of the card. It can be any length because handled-text accepts overflow with ellipsis.")
       (tw ["flex" "gap-2"]
         [(card-button (proven-text "View Details" (mk-font "sans-serif" 14) 120))
          (card-button (proven-text "Save" (mk-font "sans-serif" 14) 120))])]])
