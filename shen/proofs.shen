\\ proofs.shen — Layout overflow as a compile-time type error
\\
\\ Three-tier trust model (post Phase 4):
\\   Tier 1 — literal text:      (proven-text "lit" F W) + (assert-fits "lit" F W).
\\                               Literal is verified at load time; the function-form
\\                               call is gated by trust.shen's macro so only a
\\                               string literal is accepted as the first argument.
\\   Tier 2 — prop-bounded text: (prop-spec "key" (max-width Font W)) declared in
\\                               the component, enforced at the component boundary
\\                               via enforce-props. The prop value never reaches
\\                               proven-text — the bound is checked earlier, and
\\                               the component uses handled-text for render.
\\   Tier 3 — dynamic text:      handled-text — CSS truncation at MaxW. No proof
\\                               required. This is where any js.get / user content
\\                               must go.
\\
\\ The framework-level rule below still requires (fits? ...) : verified in the
\\ type context for [proven-text ...] to type as safe-text. That matters under
\\ tc+ (cli/verify with inline signatures). For the common tc- path (Astro
\\ runtime) the read-time macro in trust.shen is the actual enforcement point.

\\ --- Measure text width ---
\\ Two paths:
\\   1. If *measurements* is set (SBCL path): pure Shen cache lookup
\\   2. Otherwise (ShenScript path): calls Pretext via textura.measure
\\ This lets proof checking run on any Shen implementation.

(define measure
  Text Font -> (if (trap-error (do (value *measurements*) true) (/. _ false))
                   (lookup-measurement Text Font (value *measurements*))
                   (textura.measure Text Font)))

(define lookup-measurement
  Text Font [[Text Font W] | _] -> W
  Text Font [_ | Rest] -> (lookup-measurement Text Font Rest)
  Text Font [] -> (simple-error
                    (cn "No cached measurement for: '" (cn Text (cn "' in " Font)))))

(define fits?
  Text Font MaxW -> (<= (measure Text Font) MaxW))

\\ --- Font helper ---

(define mk-font
  Name Size -> (cn (str Size) (cn "px " Name)))

\\ --- Type declarations for framework functions ---
\\ These let the type checker reason about our functions

(declare measure [string --> [string --> number]])
(declare fits? [string --> [string --> [number --> boolean]]])
(declare mk-font [string --> [number --> string]])

\\ --- Compile-time assertion ---
\\ Call at top level to catch overflow during file loading

(define assert-fits
  Text Font MaxW ->
    (if (fits? Text Font MaxW)
        true
        (simple-error
          (cn "Layout overflow: '" (cn Text
            (cn "' in " (cn Font
              (cn " = " (cn (str (measure Text Font))
                (cn "px, container = " (cn (str MaxW) "px")))))))))))

(declare assert-fits [string --> [string --> [number --> boolean]]])

\\ --- Safe-text constructors ---
\\ proven-text and handled-text are FUNCTIONS. Users call them; the
\\ framework pattern-matches on the tagged lists they return (see
\\ layout.shen's to-textura). The internal tags are proven-cell and
\\ handled-cell: these are private to the framework. Construction via
\\ the data-list form [proven-cell ...] would bypass trust.shen's
\\ macro gate, so the tag is deliberately named to discourage that.
\\
\\ The function-call form (proven-text X F W) is the only advertised
\\ path, and trust.shen's defmacro catches non-literal first arguments
\\ at read time.

(define proven-text
  Text Font MaxW -> [proven-cell Text Font MaxW])

(declare proven-text [string --> [string --> [number --> safe-text]]])

(define handled-text
  Text Font MaxW Overflow -> [handled-cell Text Font MaxW Overflow])

(declare handled-text [string --> [string --> [number --> [overflow --> safe-text]]]])

\\ --- TIERED PROOF DATATYPES ---

(datatype layout-proofs

  \\ A text measurement proof: text fits in MaxW pixels
  \\ Requires (fits? Text Font MaxW) : verified in the type context.
  \\ The `where` clause in user define rules provides this under tc+.
  \\ Under tc- (the common Astro path), trust.shen's read-time macro
  \\ gates construction instead — a non-literal first argument to
  \\ (proven-text ...) is rejected before this rule ever applies.
  Text : string; Font : string; MaxW : number;
  (fits? Text Font MaxW) : verified;
  ______________________________________________
  [proven-cell Text Font MaxW] : safe-text;

  \\ Bounded string: string is known to be at most N chars
  S : string; N : number;
  (>= N (string-length S)) : verified;
  ______________________________________________
  S : (bounded N);

  \\ Handled text: developer explicitly chose an overflow strategy
  \\ No proof required — this is the escape hatch.
  \\ MaxW declares the container width the text is rendered into:
  \\   - ellipsis / clip : text is truncated at MaxW (CSS text-overflow)
  \\   - visible         : MaxW is a documentation hint; text may render wider
  Text : string; Font : string; MaxW : number; Overflow : overflow;
  _______________________________________________
  [handled-cell Text Font MaxW Overflow] : safe-text;)

\\ --- Overflow strategies ---

(datatype overflow-types
  ___ ellipsis : overflow;
  ___ clip : overflow;
  ___ visible : overflow;)

\\ =====================================================================
\\ === Tier 2 (numeric half): (bounded Lo Hi) — freerange range oracle ===
\\ =====================================================================
\\
\\ APPENDED, ADDITIVE BLOCK. Nothing above this comment is touched —
\\ layout-proofs and overflow-types are unchanged. shen/proofs.shen is in
\\ the gate runner's TCB hash manifest (bin/witness-design-gates.sh's
\\ CORE_FILES), so this addition is deliberately a *new* datatype rather
\\ than an edit to the existing rules.
\\
\\ `(bounded Lo Hi)` is a DIFFERENT type from the `(bounded N)` rule above
\\ (a 2-argument shape of the same head symbol `bounded`, vs. that rule's
\\ 1-argument shape over string-length) — Shen's sequent matcher dispatches
\\ structurally on the type term, so the two coexist without collision.
\\
\\ Where `(bounded N)` answers "is this string at most N chars?" (checked
\\ against a live string value), `(bounded Lo Hi)` answers "is this number
\\ known, for EVERY value a caller can produce, to lie in [Lo, Hi]?" — the
\\ interval-arithmetic half of Tier 2 the README called "declared, not
\\ wired". The oracle for Lo/Hi is external: cli/freerange-audit.js runs
\\ `fr --audit` (@chenglou/freerange) over generated numeric layout code
\\ and, for functions it can fully and soundly analyze, emits closed-
\\ interval facts (`fr-bound-*`) into specs/generated/numeric-bounds.shen.
\\ Lo/Hi below are typically read from one of those facts, not hand-typed.
\\
\\ HONEST LIMITATION: freerange is NUMBERS ONLY. This wires bounded
\\ numeric WIDTHS and COUNTS (e.g. a generated card-layout.ts function's
\\ return value). It does NOT wire bounded STRINGS / max-chars — that is
\\ still, and only, the pre-existing `S : (bounded N)` rule above; nothing
\\ here changes what that rule can prove, and freerange has nothing to say
\\ about strings at all.

(datatype numeric-range-proofs

  \\ A number W, statically known to satisfy Lo <= W <= Hi for every value
  \\ a caller can produce, carries the (bounded Lo Hi) type. This is the
  \\ range-oracle analogue of the string (bounded N) rule above: same
  \\ "compute a boolean, lift it to :verified" shape (see verified-lift in
  \\ card-properties.shen for the established pattern this follows), but
  \\ over a live pair of comparisons rather than a single string-length check.
  W : number; Lo : number; Hi : number;
  (<= Lo W) : verified;
  (<= W Hi) : verified;
  ________________________________________________
  W : (bounded Lo Hi);

  \\ Worst-case discharge: this is the "fits?-style obligation, discharged
  \\ against a RANGE rather than a literal" the README described as
  \\ deferred. If W is (bounded Lo Hi) and even the worst case (Hi) is
  \\ still <= MaxW, then W <= MaxW for every value the caller can produce —
  \\ not just the one value happened to be checked. Lo is threaded through
  \\ so the conclusion names the whole witness (not just the binding Hi
  \\ edge); it plays no role in this particular (upper-bound) discharge.
  W : (bounded Lo Hi); MaxW : number;
  (<= Hi MaxW) : verified;
  ________________________________________________
  (bound-fits? W Lo Hi MaxW) : verified;)
