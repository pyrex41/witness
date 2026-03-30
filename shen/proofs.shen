\\ proofs.shen — Layout overflow as a compile-time type error
\\
\\ Architecture:
\\   1. Type system requires `where (fits? ...)` or `handled-text` — structural guarantee
\\   2. Top-level `assert-fits` catches static overflow at load time — compile-time rejection
\\   3. `handled-text` explicitly opts out of proof (for dynamic text, user content, etc.)
\\
\\ Tiered proof system:
\\   Tier 1 (always): static text — assert-fits at load time, ~1ms
\\   Tier 2 (build): bounded worst-case — assert-fits with worst-case measurement
\\   Tier 3 (comprehensive): Figma verification, i18n sweep
\\   Tier 4 (runtime): dynamic text — where (fits? ...) guard at runtime
\\
\\ NOTE: (tc +) is enabled by witness.shen AFTER this file loads,
\\ so user code is type-checked but framework code is not.

\\ --- Measure text width (calls Pretext under the hood) ---

(define measure
  Text Font -> (textura.measure Text Font))

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

\\ --- TIERED PROOF DATATYPES ---

(datatype layout-proofs

  \\ A text measurement proof: text fits in MaxW pixels
  \\ Requires (fits? Text Font MaxW) : verified in the type context
  \\ The `where` clause in user define rules provides this
  Text : string; Font : string; MaxW : number;
  (fits? Text Font MaxW) : verified;
  ______________________________________________
  [proven-text Text Font MaxW] : safe-text;

  \\ Bounded string: string is known to be at most N chars
  S : string; N : number;
  (>= N (string-length S)) : verified;
  ______________________________________________
  S : (bounded N);

  \\ Handled text: developer explicitly chose an overflow strategy
  \\ No proof required — this is the escape hatch
  Text : string; Font : string; Overflow : overflow;
  _______________________________________________
  [handled-text Text Font Overflow] : safe-text;)

\\ --- Overflow strategies ---

(datatype overflow-types
  ___ ellipsis : overflow;
  ___ clip : overflow;
  ___ visible : overflow;)
