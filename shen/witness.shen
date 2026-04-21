\\ witness.shen — load all modules, then enable type checking
\\
\\ Framework code loads WITHOUT (tc +) so foreign function wrappers
\\ aren't type-checked. Type checking activates AFTER all modules load,
\\ so user code (apps, components) is verified against proof rules.

(load "shen/proofs.shen")
(load "shen/layout.shen")
(load "shen/errors.shen")
(load "shen/tea.shen")
(load "shen/tailwind.shen")
(load "shen/dom.shen")
(load "shen/ssr.shen")
(load "shen/responsive.shen")
(load "shen/props.shen")
(load "shen/figma.shen")

\\ Enable type checking for all subsequent code
(tc +)
