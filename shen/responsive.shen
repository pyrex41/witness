\\ responsive.shen — Breakpoint-keyed layouts with compile-time fit proofs.
\\
\\ A [responsive [at W1 Tree1] [at W2 Tree2] ...] node declares that the
\\ layout has multiple breakpoint variants. Each branch is solved
\\ INDEPENDENTLY at its declared viewport width, so (proven-text ...) /
\\ (fits? ...) inside each branch must hold for that width. Overflow in any
\\ branch fails the whole build, same as a plain tree.
\\
\\ Render output stitches all branches into one HTML fragment plus an
\\ inline <style> block with mobile-first @media rules that toggle display
\\ between branches. Breakpoints are derived from each branch's W value:
\\ the smallest W shows by default, each larger W takes over at that
\\ min-width.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen

\\ --- Helpers ---

(define wt-bp-class
  W -> (cn "wt-bp-" (str W)))

(define branch-width
  [at W _] -> W)

(define branch-tree
  [at _ Tree] -> Tree)

\\ Sort widths ascending. Small list (typically 2-4 breakpoints) so insertion
\\ sort is fine.
(define insert-asc
  W [] -> [W]
  W [X | Xs] -> [W X | Xs] where (< W X)
  W [X | Xs] -> [X | (insert-asc W Xs)])

(define sort-asc
  [] -> []
  [X | Xs] -> (insert-asc X (sort-asc Xs)))

\\ Filter out elements equal to a given value.
(define remove-eq
  _ [] -> []
  V [V | Xs] -> (remove-eq V Xs)
  V [X | Xs] -> [X | (remove-eq V Xs)])

\\ --- Branch rendering ---
\\ Each branch becomes a <div class="wt-bp-W" style="position:relative;">...</div>
\\ wrapping its solved layout. position:relative so children's position:absolute
\\ is scoped to the wrapper rather than the page.

(define render-branch
  [at W Tree] ->
    (let Q (n->string 34)
         Layout (textura.layout (to-textura Tree))
         Body (render-node-html Layout)
         Attrs (concat-strings
                 ["class=" Q (wt-bp-class W) Q
                  " style=" Q "position:relative;" Q])
      (concat-strings [(open-tag-attrs "div" Attrs) Body (close-tag "div")])))

\\ --- CSS generation ---
\\ Mobile-first cascade: the smallest-width branch is the default (display
\\ inherits — block for divs). Every other branch is hidden at first. Each
\\ subsequent breakpoint flips its class on and its predecessor off at a
\\ min-width media query.

\\ Build the default "hide these" rule for non-smallest widths.
\\ (hide-rule-css widths-tail) returns e.g. ".wt-bp-768,.wt-bp-1024{display:none;}"
(define hide-rule-css
  [] -> ""
  Ws -> (cn (join-selectors Ws) "{display:none;}"))

(define join-selectors
  [W] -> (cn "." (wt-bp-class W))
  [W | Ws] -> (cn "." (cn (wt-bp-class W) (cn "," (join-selectors Ws)))))

\\ One media query per step: at min-width Wi, hide prev, show Wi.
\\ (media-step-css Prev This) → "@media(min-width:This px){.wt-bp-Prev{display:none;}.wt-bp-This{display:block;}}"
(define media-step-css
  Prev This ->
    (concat-strings
      ["@media(min-width:" (str This) "px){"
       "." (wt-bp-class Prev) "{display:none;}"
       "." (wt-bp-class This) "{display:block;}}"]))

\\ Walk ascending widths, emitting one step per adjacent pair.
(define media-steps-css
  [_] -> ""
  [Prev This | Rest] -> (cn (media-step-css Prev This) (media-steps-css [This | Rest])))

\\ Full stylesheet for a responsive block.
(define responsive-css
  Sorted ->
    (let Tail (tl Sorted)
         Hide (hide-rule-css Tail)
         Steps (media-steps-css Sorted)
      (cn (open-tag "style") (cn Hide (cn Steps (close-tag "style"))))))

\\ --- Fragment entry point ---
\\ Renders either a responsive tree or a plain tree as a self-contained
\\ HTML fragment (no <!doctype>/<html>/<body>). Plain trees get a
\\ position:relative wrapper so descendant absolute-positioned nodes
\\ are scoped locally rather than to the page.

(define render-fragment
  [responsive | Branches] ->
    (let Widths (map (/. B (branch-width B)) Branches)
         Sorted (sort-asc Widths)
         Css (responsive-css Sorted)
         Bodies (map (/. B (render-branch B)) Branches)
         Joined (concat-strings Bodies)
      (cn Css Joined))

  Tree ->
    (let Q (n->string 34)
         Layout (textura.layout (to-textura Tree))
         Body (render-node-html Layout)
         Attrs (concat-strings ["style=" Q "position:relative;" Q])
      (concat-strings [(open-tag-attrs "div" Attrs) Body (close-tag "div")])))

\\ --- Type declarations ---

(declare wt-bp-class [number --> string])
(declare render-fragment [node --> string])
