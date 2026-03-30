\\ witness-sbcl.shen — SBCL Shen module loader for proof checking
\\
\\ Loads only the modules that are pure Shen (no JS dependencies).
\\ Requires *measurements* to be set before loading (from .witness/measurements.shen).
\\ Skips dom.shen (browser-only) and figma.shen (needs js.get).

(load "shen/proofs.shen")
(load "shen/errors.shen")
(load "shen/tailwind.shen")

\\ Enable type checking for user code
(tc +)
