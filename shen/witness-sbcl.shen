\\ witness-sbcl.shen — SBCL Shen module loader for proof checking
\\
\\ Loads only the modules that are pure Shen (no JS dependencies).
\\ Requires *measurements* to be set before loading (from .witness/measurements.shen).
\\ Skips dom.shen (browser-only) and figma.shen (needs js.get).

(load "shen/proofs.shen")
(load "shen/errors.shen")
(load "shen/tailwind.shen")

\\ trust.shen's read-time macro was missing from this prelude, so the proof
\\ path — cli/shen-check.js, bin/witness-check.sh, and therefore Gate 1 — had
\\ NO literal gate at all: a dynamic first argument to (proven-text ...) was
\\ accepted there while being rejected in the Astro/test path that does load
\\ it. It must load before user code is read, and (like every module above)
\\ before (tc +), since it defines a macro rather than typed functions.
(load "shen/trust.shen")

\\ \\ --- UI component properties (auto-discovered + maintained by tiny generic loader) ---
\\ The tiny loader (bin/witness-component-loader.js) discovers every
\\ specs/ui/properties/*-properties.shen and keeps exactly this block
\\ in sync (no more hand-editing loads when adding a protected component).
\\
\\   - Run manually: node bin/witness-component-loader.js --update
\\   - scaffolder (`witness spec-init Foo`) does this automatically after writing the skeleton.
\\
\\ Loaded under tc- so the contracts are available to every spec that Gate 1
\\ then type-checks under tc+, with zero per-component wiring by hand.
(load "specs/ui/properties/alert-properties.shen")
(load "specs/ui/properties/card-properties.shen")
\\ --- End UI component properties loads ---

\\ Enable type checking for user code
(tc +)
