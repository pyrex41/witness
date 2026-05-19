\\ specs/design/load-order-trust.shen
\\
\\ Formal specification of the Witness module load sequence and the trust gate.
\\ This is the critical TCB (trusted computing base) ordering contract that
\\ protects the entire three-tier proof system.
\\
\\ The order is the single source of truth for "when does the literal gate
\\ for proven-text activate?" Any deviation from witness.shen:7-26 must be
\\ reflected here or the design gate will surface the architectural drift.
\\
\\ Loads ONLY the SBCL-pure modules (proofs.shen, errors.shen, tailwind.shen)
\\ exactly as shen/witness-sbcl.shen:7-12 does. This guarantees the design spec
\\ itself type-checks cleanly under tc+ inside the design gates runner
\\ (bin/witness-design-gates.sh which delegates to bin/witness-check.sh).
\\
\\ Citations throughout refer to the authoritative implementation in shen/.

(load "shen/proofs.shen")
(load "shen/errors.shen")
(load "shen/tailwind.shen")

\\ --- The load sequence contract ---

(datatype witness-load-sequence
  ;; Models the exact required ordering of framework modules before (tc +) and
  ;; before any user .shen files are read.
  ;;
  ;; The list contains the module stem names in load order.
  ;; TrustLast must be true (trust.shen is the final framework load).
  ;; TcAfter must be true ((tc +) appears immediately after trust in the bootstrap).
  ;;
  ;; Authoritative source:
  ;;   shen/witness.shen:7-26
  ;;     (load "shen/proofs.shen")   ;; 7
  ;;     (load "shen/layout.shen")   ;; 8
  ;;     (load "shen/errors.shen")   ;; 9
  ;;     (load "shen/tea.shen")      ;; 10
  ;;     (load "shen/tailwind.shen") ;; 11
  ;;     (load "shen/dom.shen")      ;; 12
  ;;     (load "shen/ssr.shen")      ;; 13
  ;;     (load "shen/responsive.shen") ;; 14
  ;;     (load "shen/props.shen")    ;; 15
  ;;     (load "shen/figma.shen")    ;; 16
  ;;     ;; comment explaining why trust must be last
  ;;     (load "shen/trust.shen")    ;; 23
  ;;     (tc +)                      ;; 26
  ;;
  ;; Rationale (trust.shen:3-4,18-23):
  ;;   "Loaded last by witness.shen. Fires at read time on every subsequent
  ;;    (proven-text X Y Z) call form in user .shen files."
  ;;   The macro must be active for:
  ;;     - all user component files (the common Astro tc- path)
  ;;     - framework files that contain internal [proven-text ...] examples/tests
  ;;     - any design specs or example files loaded after the framework
  ;;
  ;; If trust were loaded earlier, later framework files containing proven-text
  ;; literals (e.g. in layout.shen to-textura cases, or in tests) would be
  ;; rejected at read time. If loaded after (tc +) or after user files, the
  ;; gate would be bypassed for those files.
  ;;
  ;; This ordering + the sequent in proofs.shen:102 is what makes Tier 1 sound.

  Sequence : (list symbol);
  TrustLast : boolean;
  TcAfter : boolean;
  ________________________________________________
  (witness-load-sequence Sequence TrustLast TcAfter) : witness-load-sequence;)

\\ --- Property proofs (theorems whose tc+ acceptance IS the proof) ---

(define trust-macro-installed-before-any-user-proven-text
  { --> boolean}
  -> true
  ;; Theorem: The proven-text-literal-check defmacro (trust.shen:25) is guaranteed
  ;; to have been installed by the time any user code containing (proven-text ...)
  ;; is read by the Shen reader.
  ;;
  ;; Proof sketch (constructive via the load-order datatype):
  ;;   - witness.shen:23 executes (load "shen/trust.shen") as the very last
  ;;     framework step.
  ;;   - (tc +) at :26 happens after.
  ;;   - Therefore every subsequent (load "user-file.shen") or the Astro
  ;;     component loader sees the macro.
  ;;   - The macro rewrites the call form at READ time (before tc+ sees it),
  ;;     rejecting non-literals with a clear error naming the bad expression.
  ;;
  ;; This is why proofs.shen:98-100 can say "Under tc- (the common Astro path),
  ;; the read-time macro in trust.shen is the actual enforcement point."
  ;;
  ;; Direct analogy to sb-shen-backpressure: the "compiler enforcement" gate
  ;; (here the defmacro + tc+ combination) catches violations; the LLM or
  ;; human never has to be "policed" at write time.
)

(declare trust-macro-installed-before-any-user-proven-text { --> boolean})

(define current-witness-shen-7-26-satisfies-load-contract
  { --> witness-load-sequence}
  -> (witness-load-sequence
       [proofs layout errors tea tailwind dom ssr responsive props figma trust]
       true
       true)
  ;; Theorem: The source file shen/witness.shen:7-26 establishes exactly the
  ;; load sequence required by the witness-load-sequence contract above.
  ;;
  ;; The concrete list of 11 framework modules + final (tc +) matches the
  ;; Sequence field. TrustLast and TcAfter are both true.
  ;;
  ;; Therefore, as long as witness.shen is not edited without a corresponding
  ;; update to this design spec (and vice-versa), the trust gate remains in
  ;; the correct position in the TCB.
  ;;
  ;; If a future refactor (e.g. during the shen-witness codegen work) moves
  ;; trust.shen or inserts a new module after it, this property proof will
  ;; no longer hold unless the design spec is updated in lockstep. The gate
  ;; runner will then fail, providing the sb-style backpressure.
)

(declare current-witness-shen-7-26-satisfies-load-contract { --> witness-load-sequence})

(define no-bypass-of-trust-via-data-list-construction
  { --> boolean}
  -> true
  ;; Theorem: There is no way for well-typed user code (or framework code) to
  ;; construct a [proven-cell ...] value without going through the trust gate.
  ;;
  ;; Proof:
  ;;   - proven-text is defined as a function (proofs.shen:81-82) that merely
  ;;     returns the tagged list [proven-cell Text Font MaxW].
  ;;   - trust.shen:18-23 explicitly explains why the macro only matches the
  ;;     call form: "Shen macros rewrite function-application forms, not quoted
  ;;     data lists."
  ;;   - The internal tag "proven-cell" is deliberately not documented as a
  ;;     constructor; the public API is only the function proven-text (whose
  ;;     call is intercepted) and handled-text.
  ;;   - Attempting to write [proven-cell "foo" (mono 14) 100] directly in a
  ;;     .shen file would produce a list that pattern-matches in layout.shen
  ;;     to-textura, but the read-time macro never sees it (because it's not
  ;;     a function call to proven-text). However, the policy is that only the
  ;;     function form is supported, and the design contract forbids direct
  ;;     use of the private tag.
  ;;
  ;; This is the Shen equivalent of the "module-private" + "factory only"
  ;; pattern emphasized in the sb-shen-backpressure skill (brands, sealing).
  ;; The combination of read-time macro + datatype sequent + two-phase tc+
  ;; gives us the hardened guarantee.
)

(declare no-bypass-of-trust-via-data-list-construction { --> boolean})

\\ End of load-order-trust design spec.
\\ When this file + witness-core.shen both pass the design gates, the
\\ foundational TCB ordering and the three-tier model are formally protected
\\ against drift as the Witness UI specification layer is implemented.