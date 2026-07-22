\\ trust.shen -- Compile-time gate on proven-text's first argument.
\\
\\ Loaded last by witness.shen. Fires at read time on every subsequent
\\ (proven-text X Y Z) call form in user .shen files. Policy:
\\   - X is a string literal : form passes through unchanged.
\\   - X is anything else    : throw at expansion time, naming the
\\                             offending expression.
\\
\\ Why a read-time macro, not a type rule:
\\   User files load under (tc -) in the Astro path (see astro/
\\   runtime.js) because render helpers rarely carry inline
\\   signatures, so the proof datatype rule in proofs.shen is dormant
\\   for those files. A defmacro runs regardless of tc state, so the
\\   check fires uniformly across Astro, CLI verify, and tests.
\\   Dynamic values have a home: handled-text for visual truncation,
\\   or prop-spec (max-width Font W) at the component boundary.
\\
\\ Why only the call form triggers it:
\\   Shen macros rewrite function-application forms, not quoted data
\\   lists. The framework exposes proven-text as a function (defined
\\   in proofs.shen) whose return value is the same tagged list that
\\   layout.shen pattern-matches on, so downstream code is unaffected
\\   and the gate is mandatory for construction.

\\ The macro expands to the DATA form [proven-cell X Y Z], not to a call to
\\ the proven-text function. That is what puts the advertised API under the
\\ proof rule.
\\
\\ Previously it expanded to (proven-text X Y Z), and proven-text is declared
\\ [string --> [string --> [number --> safe-text]]] — an unconditional promise
\\ of safe-text. So the function form typed clean for ANY arguments: a 77.36px
\\ title declared into a 5px box was accepted under tc+. The layout-proofs rule
\\ only ever governed [proven-cell ...], which the advertised path never
\\ produced at type-check time. The proof rule and the API were disconnected.
\\
\\ Expanding to the data form means the `if (<= (measure Text Font) MaxW)` side
\\ condition in proofs.shen decides it, and the runtime value is identical —
\\ [proven-cell X Y Z] is exactly what the function returned, and what
\\ layout.shen's to-textura already pattern-matches on. Under tc- (the Astro
\\ path) nothing changes; the literal check below still fires at read time.
\\ Note the expansion is written with explicit `cons` applications rather than
\\ as [proven-cell X Y Z]. A macro returns CODE, and a returned list value is
\\ read back as an application of its head symbol — so [proven-cell X Y Z]
\\ expanded to a call of a function named proven-cell, which does not exist
\\ ("number expected" at load). The cons chain below evaluates to the code that
\\ CONSTRUCTS the tagged list, which is what the layout-proofs rule matches on.
(defmacro proven-text-literal-check
  [proven-text X Y Z] -> (if (string? X) [cons proven-cell [cons X [cons Y [cons Z []]]]] (simple-error (cn "witness: proven-text requires a literal string as its first argument. Got: " (cn (str X) ". Use handled-text for dynamic values, or declare the prop with (prop-spec KEY (max-width Font W)).")))) Other -> Other)
