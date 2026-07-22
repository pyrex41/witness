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

\\ Shen has no `case` form. This was written as
\\   (define token-value Tokens Key -> (case Key "space-4" -> 16 ...))
\\ which collapsed to the fallback for EVERY key: token-value "space-4" raised
\\ "Unknown token space-4". So no design token has ever resolved, and every
\\ obligation expressed in terms of tokens was erroring rather than computing.
\\ Nothing caught it because the emitter reads token_values out of
\\ (card-contract-shape) as data and never calls this function.
\\
\\ Shen's actual mechanism is multiple pattern-matching rules on the arguments.
(define token-value
  { design-tokens --> string --> number }
  _ "space-4"    -> 16
  _ "space-2"    -> 8
  _ "text-title" -> 18
  _ "text-action" -> 14
  _ "radius-lg"  -> 8
  _ Key -> (simple-error (cn "Unknown token " Key)))
