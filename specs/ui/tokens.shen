\\ specs/ui/tokens.shen — central design tokens with proven relationships
\\ 
\\ Part of the Card spike (Shen UI Specifications design).
\\ These tokens are the single source of truth for sizes, fonts, radii used by
\\ the card-spec.shen contracts. The datatype + token-value let us write
\\ layout obligations and generated CSS in terms of named tokens rather than
\\ magic numbers.
\\
\\ Loaded by specs/ui/card-spec.shen (and transitively by design gates via
\\ witness-core.shen).

(datatype design-tokens
  ___ default-tokens : design-tokens;)

(define token-value
  Tokens Key -> (case Key
                  "space-4" -> 16
                  "space-2" -> 8
                  "text-title" -> 18
                  "text-action" -> 14
                  "radius-lg" -> 8
                  _ -> (simple-error (cn "Unknown token " Key))))

(declare token-value [design-tokens --> [string --> number]])
