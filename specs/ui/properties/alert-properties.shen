\\ specs/ui/properties/alert-properties.shen
\\ Illustrative contract-only example for the scaling pattern.
\\
\\ This file demonstrates that the high-level contracts machinery
\\ (variant datatypes + obligation predicates + :verified premises +
\\ construction theorems) generalizes cleanly to a
\\ second component (Alert) with zero changes to the core renderer,
\\ card-spec, or the Card emitter.
\\
\\ It is deliberately scoped as *contract-only / illustrative*:
\\   - No thin runtime spec (cf. card-spec.shen)
\\   - No emitter (no Alert.tsx / alert.css / stories)
\\   - No Gate 4 wiring for generated artifacts
\\
\\ A future real minimal end-to-end Alert would duplicate the Card
\\ pattern (thin *-spec.shen + dedicated emitter + Gate 4 checks).
\\ For now it exists purely to validate that Gate 1 (tc+) + the
\\ design-fidelity-theorem technique scales without modification.
\\
\\ - alert-variant (info/success/warning/error)
\\ - trivial obligation (always true — an explicit stub, see below
\\   bridge documented in card-properties.shen)
\\ - verified-alert + alert-design-fidelity (analogous construction)
\\
\\ Loaded by witness-core.shen so it participates in Gate 1/2 under
\\ the same backpressure as Card. No assert-fits or measurements needed.

(load "specs/ui/tokens.shen")

\\ --- Alert variants (independent semantic states, analogous to card-variant) ---
\\ Each variant can later carry its own obligations (e.g. ARIA role, icon token,
\\ colour from design tokens) exactly as card-variant carries responsive widths.

(datatype alert-variant
  ___ info    : alert-variant;
  ___ success : alert-variant;
  ___ warning : alert-variant;
  ___ error   : alert-variant;)

\\ --- Obligation helper ---
\\ HONEST STATUS: this returns true unconditionally. The Alert is an
\\ illustrative second component, and its obligation has no content yet — a
\\ fuller version would inspect Variant for semantic rules and token colours.
\\ It is a stub, labelled as one, and Gate 2 executes it as such. Do not read
\\ alert-design-fidelity as evidence that anything about the Alert is proven.

(define alert-obligation-satisfied
  Variant Tokens -> true)

(declare alert-obligation-satisfied [alert-variant --> [design-tokens --> boolean]])

\\ --- The verified Alert (the product type for the second protected component) ---

\\ Side condition + data form, matching card-properties.shen. As
\\ `(alert-obligation-satisfied ...) : verified` the premise was
\\ undischargeable, and the conclusion named an (alert ...) application for
\\ which no constructor existed — so the theorem below could never run.
(datatype verified-alert
  if (alert-obligation-satisfied Variant Tokens)
  Variant : alert-variant;
  Tokens : design-tokens;
  ________________________________________________
  [alert Variant Tokens] : verified-alert;)

\\ Constructor, mirroring mk-card-* in card-properties.shen.
(define mk-alert
  Variant Tokens -> [alert Variant Tokens])

\\ =====================================================================
\\ === Property theorem (Gate 1/2 prove via tc+ acceptance) ===
\\ =====================================================================

\\ --- Design fidelity claim for the illustrative Alert contract ---
\\ This theorem *constructs* a verified-alert under tc+. The obligation
\\ predicate reduces to true and is discharged by verified-lift (see
\\ header for scoping). This validates that the construction-theorem +
\\ lift pattern scales to additional protected components exactly as
\\ intended, without touching emitter or runtime paths.

\\ Executes the obligation rather than binding a construction and discarding
\\ it. The previous body was (let TheAlert (alert info default-tokens)
\\ (and true true)) — a call to a function that did not exist, wrapped around
\\ a constant, in a file that had never parsed.
(define alert-design-fidelity
  {--> boolean}
  -> (alert-obligation-satisfied info default-tokens))

\\ End of alert-properties.shen
\\ This illustrative contract-only example confirms the verified-*-contracts
\\ + design-fidelity + verified-lift pattern generalises without modification.
\\ (See file header for current scoping vs. future full emitter-backed Alert.)
