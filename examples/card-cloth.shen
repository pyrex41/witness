\\ examples/card-cloth.shen — HTML-in-canvas cloth demo (proven texture)
\\
\\ Inspired by html-in-canvas/plugins/html-cloth.mjs, which rasterizes live
\\ HTML into a texture and drapes it over a physics-simulated cloth.
\\
\\ That trick raises the stakes for layout proofs: once HTML becomes texture
\\ pixels, there is no DOM left to fail soft. An overflowing label isn't a
\\ scrollbar or a wrapped line any more — it's baked into the fabric.
\\ So every piece of text woven into the cloth is either:
\\   - proven-text: statically proven to fit its column at load time, or
\\   - handled-text: explicitly fail-soft (ellipsis) before rasterization.
\\
\\ Usage:
\\   node cli/check.js dev examples/card-cloth.shen        # run the proofs
\\   node examples/card-cloth.js                            # build the demo
\\   open examples/card-cloth.html                          # drag the cloth
\\
\\ Texture geometry: 360px wide, 20px padding => 320px content column.

\\ --- Tier 1 static proofs (checked at load time) ---

(assert-fits "Proven Cloth" (mk-font "sans-serif" 24) 320)
(assert-fits "HTML, woven into canvas" (mk-font "sans-serif" 14) 320)
(assert-fits "assert-fits" (mk-font "sans-serif" 12) 150)
(assert-fits "handled-text" (mk-font "sans-serif" 12) 150)

\\ --- Helpers ---

(define cloth-chip
  Cell ->
    (tw ["px-4" "py-2" "rounded-lg" "text-sm"]
      [[text-node Cell]]))

\\ --- The texture view ---
\\ Rendered by examples/card-cloth.js via:
\\   (render-html-doc (solve-layout (render-view) 360 600))
\\ then rasterized into a <canvas> texture through an SVG foreignObject.

(define render-view
  -> [frame (mk-props9 360 240 "column" 12 20 "" "" 0 0)
      [[text-node (proven-text "Proven Cloth" (mk-font "sans-serif" 24) 320)]
       [text-node (proven-text "HTML, woven into canvas" (mk-font "sans-serif" 14) 320)]
       [text-node (handled-text "Rasterized HTML has no DOM to fail soft: overflow would be baked into the pixels, so it is proven out before the weave." (mk-font "sans-serif" 13) 320 ellipsis)]
       (tw ["flex" "gap-2"]
         [(cloth-chip (proven-text "assert-fits" (mk-font "sans-serif" 12) 150))
          (cloth-chip (proven-text "handled-text" (mk-font "sans-serif" 12) 150))])]])
