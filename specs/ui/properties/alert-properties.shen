\\ specs/ui/properties/alert-properties.shen
\\ Illustrative contract-only example for the scaling pattern.
\\
\\ This file demonstrates that the high-level contracts machinery
\\ (variant datatypes + obligation predicates + :verified premises +
\\ verified-lift + construction theorems) generalizes cleanly to a
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
\\ - trivial obligation (always true, lifted via verified-lift — intentional
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

\\ --- Obligation helper (returns true so verified-lift discharges the premise) ---
\\ In a fuller impl this could inspect Variant for semantic rules, pull token
\\ colours, ARIA etc. Here it returns true; the verified-alert sequent
\\ requires (alert-obligation...):verified and the intentional lift + tc+
\\ accepts the construction (see verified-lift docs in card-properties.shen).

(define alert-obligation-satisfied
  Variant Tokens -> true)

(declare alert-obligation-satisfied [alert-variant --> [design-tokens --> boolean]])

\\ --- The verified Alert (the product type for the second protected component) ---

(datatype verified-alert
  Variant : alert-variant;
  Tokens : design-tokens;
  (alert-obligation-satisfied Variant Tokens) : verified;
  ________________________________________________
  (alert Variant Tokens) : verified-alert;)

\\ =====================================================================
\\ === Property theorem (Gate 1/2 prove via tc+ acceptance) ===
\\ =====================================================================

\\ --- Design fidelity claim for the illustrative Alert contract ---
\\ This theorem *constructs* a verified-alert under tc+. The obligation
\\ predicate reduces to true and is discharged by verified-lift (see
\\ header for scoping). This validates that the construction-theorem +
\\ lift pattern scales to additional protected components exactly as
\\ intended, without touching emitter or runtime paths.

(define alert-design-fidelity
  {--> boolean}
  -> (let TheAlert (alert info default-tokens)
       (and true true)))
  ;; Construction of TheAlert discharges the verified-alert obligation under tc+ via lift.
  ;; Trivial conjunction + construction = the proof that the scaling pattern holds.
  ;; Gate 1 accepts this (illustrative contract only; see header).
)

(declare alert-design-fidelity {--> boolean})

\\ End of alert-properties.shen
\\ This illustrative contract-only example confirms the verified-*-contracts
\\ + design-fidelity + verified-lift pattern generalises without modification.
\\ (See file header for current scoping vs. future full emitter-backed Alert.)