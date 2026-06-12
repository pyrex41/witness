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

\\ ============================================================
\\ TIER 2 — Structured-bounded worst-case proofs
\\ ============================================================
\\
\\ The load-bearing tier. Tier 1 proves a *literal* string fits. Tier 2
\\ proves that *every* string drawn from an alphabet Sigma, up to N
\\ characters long, fits — for any runtime value, without ever measuring
\\ that value.
\\
\\ The math (pure; the checker runs it at build time):
\\
\\   worst-case(Sigma, N, Font) = N * max{ measure(c, Font) : c in Sigma }
\\
\\ If worst-case <= MaxW then for all s in Sigma^<=N, measure(s) <= MaxW:
\\ the width of any string is at most the sum of its glyph advances, and
\\ each advance is at most the widest glyph in Sigma. With tabular
\\ (monospace) numerals every digit shares one advance, so the bound is
\\ exact — the flagship claim: a price column provably never overflows,
\\ for any price.
\\
\\ Soundness rests on subadditivity (measure(ab) <= measure(a)+measure(b)),
\\ true for the declared metrics model absent ligature / positive-kern
\\ expansion. Bake the same safety margin used elsewhere into MaxW.

\\ --- string length (walk; shen-script lacks the primitive) ---
\\ Also makes the (bounded N) datatype rule below live: it cites
\\ string-length as its side condition but the function was never defined.

(define string-length
  S -> (string-length-walk S 0))

(define string-length-walk
  "" N -> N
  S  N -> (string-length-walk (tlstr S) (+ N 1)))

(declare string-length [string --> number])
(declare string-length-walk [string --> [number --> number]])

\\ --- max of two numbers ---

(define maxn
  X Y -> (if (> X Y) X Y))

(declare maxn [number --> [number --> number]])

\\ --- widest glyph in an alphabet ---
\\ Returns [Char Advance] for the widest single character in Alphabet under
\\ Font. The empty alphabet yields ["" 0] — a degenerate Sigma admits only
\\ the empty string, whose width is 0.

(define widest-glyph
  Alphabet Font -> (widest-glyph-walk Alphabet Font "" 0))

(define widest-glyph-walk
  "" _ C Max -> [C Max]
  S Font C Max ->
    (let H (pos S 0)
         W (measure H Font)
      (if (> W Max)
          (widest-glyph-walk (tlstr S) Font H W)
          (widest-glyph-walk (tlstr S) Font C Max))))

(define glyph-char  [C _] -> C)
(define glyph-width [_ W] -> W)

(define widest-advance
  Alphabet Font -> (glyph-width (widest-glyph Alphabet Font)))

(declare widest-glyph [string --> [string --> [list A]]])
(declare widest-glyph-walk [string --> [string --> [string --> [number --> [list A]]]]])
(declare glyph-char [[list A] --> string])
(declare glyph-width [[list A] --> number])
(declare widest-advance [string --> [string --> number]])

\\ --- worst-case width of any Sigma^<=N string ---

(define worst-case-width
  Alphabet N Font -> (* N (widest-advance Alphabet Font)))

(declare worst-case-width [string --> [number --> [string --> number]]])

\\ --- the Tier-2 side condition (discharged by the type checker) ---

(define bounded-fits?
  Alphabet N Font MaxW -> (<= (worst-case-width Alphabet N Font) MaxW))

(declare bounded-fits? [string --> [number --> [string --> [number --> boolean]]]])

\\ --- load-time assertion (mirrors assert-fits for the bounded tier) ---

(define assert-bounded-fits
  Alphabet N Font MaxW ->
    (if (bounded-fits? Alphabet N Font MaxW)
        true
        (simple-error (bounded-overflow-message Alphabet N Font MaxW))))

\\ Worst case is N copies of the widest glyph in the alphabet; report that
\\ glyph, the resulting width, and the container so the fix is obvious.
(define bounded-overflow-message
  Alphabet N Font MaxW ->
    (cn "Bounded overflow: worst case " (cn (str N)
      (cn " x widest glyph '" (cn (glyph-char (widest-glyph Alphabet Font))
        (cn "' of " (cn (alphabet-label Alphabet)
          (cn " in " (cn Font
            (cn " = " (cn (str (worst-case-width Alphabet N Font))
              (cn "px, container = " (cn (str MaxW) "px")))))))))))))

(declare assert-bounded-fits [string --> [number --> [string --> [number --> boolean]]]])
(declare bounded-overflow-message [string --> [number --> [string --> [number --> string]]]])

\\ Abbreviate long alphabets in error messages.

(define alphabet-label
  Alphabet -> (if (> (string-length Alphabet) 12)
                  (cn "'" (cn (take-chars Alphabet 12) "...'"))
                  (cn "'" (cn Alphabet "'"))))

(define take-chars
  _ 0 -> ""
  "" _ -> ""
  S N -> (cn (pos S 0) (take-chars (tlstr S) (- N 1))))

(declare alphabet-label [string --> string])
(declare take-chars [string --> [number --> string]])

\\ --- standard alphabets (Sigma is just a string of allowed characters) ---

(define digits      -> "0123456789")
(define hex-digits  -> "0123456789abcdefABCDEF")
(define lower       -> "abcdefghijklmnopqrstuvwxyz")
(define upper       -> "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
(define letters     -> (cn (upper) (lower)))
(define alnum       -> (cn (digits) (letters)))
\\ digits plus decimal point and thousands separator: the price column.
(define price-chars -> (cn (digits) ".,"))
\\ Identity passthrough so non-standard alphabets read declaratively:
\\   (assert-bounded-fits (alphabet-of "0123456789$.,-") 9 Font W)
(define alphabet-of S -> S)

(declare digits [--> string])
(declare hex-digits [--> string])
(declare lower [--> string])
(declare upper [--> string])
(declare letters [--> string])
(declare alnum [--> string])
(declare price-chars [--> string])
(declare alphabet-of [string --> string])

\\ --- runtime conformance (parse-don't-validate at the trust boundary) ---
\\ bounded-text trusts that its value is in Sigma^<=N. Verify it once where
\\ the value enters the system (API decode, form parse), not at every
\\ render. Downstream layout proofs then consume the bound statically.

(define char-in?
  _ "" -> false
  C Alphabet -> (if (= C (pos Alphabet 0))
                    true
                    (char-in? C (tlstr Alphabet))))

(define in-alphabet?
  "" _ -> true
  S Alphabet -> (if (char-in? (pos S 0) Alphabet)
                    (in-alphabet? (tlstr S) Alphabet)
                    false))

(define bounded?
  S Alphabet N -> (and (<= (string-length S) N)
                       (in-alphabet? S Alphabet)))

(define assert-bounded
  S Alphabet N ->
    (if (bounded? S Alphabet N)
        S
        (simple-error
          (cn "Value '" (cn S
            (cn "' violates bound length<=" (cn (str N)
              (cn " over alphabet " (alphabet-label Alphabet)))))))))

(declare char-in? [string --> [string --> boolean]])
(declare in-alphabet? [string --> [string --> boolean]])
(declare bounded? [string --> [string --> [number --> boolean]]])
(declare assert-bounded [string --> [string --> [number --> string]]])

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

\\ bounded-text — the Tier-2 cell. Text is DYNAMIC (no literal gate): this
\\ is the sanctioned home for runtime values that are provably bounded,
\\ complementing handled-text (fail-soft truncation) with a fail-never
\\ guarantee. The proof obligation is over (Alphabet N Font MaxW), wholly
\\ independent of Text — once (bounded-fits? Alphabet N Font MaxW) is
\\ verified, no value the alphabet and length admit can overflow the cell.
\\ Pair with assert-bounded at the data boundary so Text is known to
\\ conform; the layout proof itself never inspects Text.

(define bounded-text
  Text Alphabet N Font MaxW -> [bounded-cell Text Alphabet N Font MaxW])

(declare bounded-text
  [string --> [string --> [number --> [string --> [number --> safe-text]]]]])

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

  \\ Tier 2 — bounded cell. Any Text drawn from Sigma = Alphabet, up to N
  \\ characters, provably fits MaxW once the worst case is discharged. Text
  \\ itself is unconstrained by the proof: the bound is over the alphabet,
  \\ not the value, which is what makes it provable for runtime-dynamic
  \\ content. See bounded-fits? in this file for the discharging math.
  Text : string; Alphabet : string; N : number; Font : string; MaxW : number;
  (bounded-fits? Alphabet N Font MaxW) : verified;
  ______________________________________________
  [bounded-cell Text Alphabet N Font MaxW] : safe-text;

  \\ Bounded string: string is known to be at most N chars (string-length
  \\ is now defined above, so this rule is live).
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
