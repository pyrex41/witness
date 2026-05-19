\\ examples/card.shen — thin compatibility wrapper for the Card spike
\\
\\ All implementation, layout helpers, render-view, and (most importantly) the
\\ formal Shen datatype contracts (card-title-slot, verified-card, layout
\\ obligations, figma-card-matches, design fidelity proof, etc.) now live in:
\\   specs/ui/card-spec.shen
\\
\\ This file exists only so that all existing usage continues to work exactly:
\\   witness render examples/card.shen --expr "(render-view)"
\\   witness dev examples/card.shen
\\   witness check --figma examples/card-design.json examples/card.shen
\\   (and all references in docs/DEMO.md, READMEs, etc.)
\\
\\ The real Card spec is now a first-class citizen under the sb-style design
\\ gates (npm run gates), exactly as requested.
\\
\\ See specs/ui/card-spec.shen for the full spike (tokens + datatypes +
\\ fidelity proof that runs real Yoga + Figma diff on every load).

(load "specs/ui/card-spec.shen")

\\ (render-view is provided by the loaded card-spec.shen — no other code needed here)
