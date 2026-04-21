\\ props.shen — Per-component prop constraints, orthogonal to layout.
\\
\\ The layout proofs in proofs.shen / layout.shen answer "does this string
\\ fit this cell?" — coupled to a render site. Some constraints are not
\\ render-coupled: a CMS title might be capped at 80 chars regardless of
\\ where it renders, a slug must be ASCII, etc. prop-spec captures those
\\ shape constraints declaratively at the top of a .shen component file.
\\
\\ Usage in a component:
\\   (prop-spec "title"   (max-chars 80))
\\   (prop-spec "tagline" (max-width (mono 11) 192))
\\
\\ The Astro runtime harvests the registered specs after loading the file
\\ and runs (check-props specs JsObj) before each render call, so a stray
\\ frontmatter value from a content collection fails the build at the
\\ component boundary with the offending key named.
\\
\\ NOTE: Loaded WITHOUT (tc +) — see witness.shen. Specs use a global
\\ pending-list because shen has no implicit "current file" context;
\\ harvest-prop-specs drains it after each load so per-file isolation is
\\ the runtime's responsibility (it serializes loads through a mutex).

\\ --- string length (shen-script lacks string-length primitive) ---
\\ Walks tlstr until empty; OK for prop sanity bounds (titles, taglines).
\\ Don't reach for it on body-text-sized strings.

(define str-len
  S -> (str-len-walk S 0))

(define str-len-walk
  "" N -> N
  S  N -> (str-len-walk (tlstr S) (+ N 1)))

\\ --- Constraint constructors ---
\\ Return tagged tuples so they can be stored as plain data and pattern-matched
\\ later. Defining them as functions (rather than quoted lists) means callers
\\ write (max-chars 80) instead of fighting Shen's eager evaluation.

(define max-chars
  N -> [max-chars N])

(define max-width
  Font W -> [max-width Font W])

\\ Min-chars catches "" / null-ish content from CMS frontmatter that should
\\ never be empty. Cheap to add now; a common CMS gotcha.
(define min-chars
  N -> [min-chars N])

\\ --- Pending registry ---

(set *pending-prop-specs* [])

(define prop-spec
  Key Constraint ->
    (set *pending-prop-specs*
      [[Key Constraint] | (value *pending-prop-specs*)]))

(define harvest-prop-specs
  -> (let Specs (reverse (value *pending-prop-specs*))
        (do (set *pending-prop-specs* []) Specs)))

\\ --- Per-prop check ---
\\ Returns [ok] or [violation Key Reason] so the caller can format a single
\\ structured error covering all failures rather than throwing at the first.

(define check-prop-constraint
  Key Value [max-chars N] ->
    (if (<= (str-len Value) N)
        [ok]
        [violation Key
          (cn "exceeds max-chars=" (cn (str N)
            (cn " (length=" (cn (str (str-len Value)) ")"))))])
  Key Value [min-chars N] ->
    (if (>= (str-len Value) N)
        [ok]
        [violation Key
          (cn "below min-chars=" (cn (str N)
            (cn " (length=" (cn (str (str-len Value)) ")"))))])
  Key Value [max-width Font W] ->
    (if (fits? Value Font W)
        [ok]
        [violation Key
          (cn "exceeds max-width=" (cn (str W)
            (cn "px in " (cn Font
              (cn " (measured=" (cn (str (measure Value Font)) "px)"))))))]))

\\ --- Run all specs against a JS props object ---
\\ Returns [] when every spec passes, otherwise a list of violation tuples.
\\ The runtime joins these into one error message so a malformed prop bag
\\ surfaces all problems in one build failure, not one per re-run.

(define check-props
  [] _ -> []
  [[Key Constraint] | Rest] Props ->
    (let Value (js.get Props Key)
         Result (check-prop-constraint Key Value Constraint)
         Tail (check-props Rest Props)
      (if (= Result [ok])
          Tail
          [Result | Tail])))

\\ --- Format violations for an error message ---

(define format-violation
  [violation Key Reason] -> (cn "  - " (cn Key (cn ": " Reason))))

(define format-violations
  [] -> ""
  [V] -> (format-violation V)
  [V | Rest] -> (cn (format-violation V) (cn (n->string 10) (format-violations Rest))))

\\ --- Throw if any violations ---
\\ Convenience for the runtime: one call, errors with a structured multi-line
\\ message naming every offending key. No-op when specs is empty.

(define enforce-props
  [] _ -> true
  Specs Props ->
    (let Vs (check-props Specs Props)
      (if (= Vs [])
          true
          (simple-error
            (cn "prop-spec violations:" (cn (n->string 10)
              (format-violations Vs)))))))
