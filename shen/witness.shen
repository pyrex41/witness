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

\\ Trust gate for proven-text must load LAST — before tc+ is fine, but
\\ it has to come after every framework file whose read-time forms
\\ include [proven-text ...] patterns (to-textura in layout.shen, for
\\ one). Once installed, the macro fires on every subsequent load, so
\\ user .shen files get the literal check regardless of tc+/tc-.
(load "shen/trust.shen")

\\ Enable type checking for all subsequent code
(tc +)
