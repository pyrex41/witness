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

\\ Enable type checking for user code
(tc +)
