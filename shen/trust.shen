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

(defmacro proven-text-literal-check
  [proven-text X Y Z] -> (if (string? X) [proven-text X Y Z] (simple-error (cn "witness: proven-text requires a literal string as its first argument. Got: " (cn (str X) ". Use handled-text for dynamic values, or declare the prop with (prop-spec KEY (max-width Font W)).")))) Other -> Other)
