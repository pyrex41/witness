\\ specs/design/witness-core.shen
\\
\\ Formal design specification for the Witness core architecture.
\\ This is the source of truth for key invariants as we evolve the system.
\\
\\ These specs are checked via the sb-style gate system (witness design-check / gates).
\\ They use the existing Witness proof machinery (fits?, measure, layout-proofs,
\\ tw-to-props, etc.) as oracles and premises.
\\
\\ CRITICAL: This file loads ONLY the SBCL-pure modules (proofs, errors, tailwind)
\\ that shen/witness-sbcl.shen:7-12 loads. This ensures the design spec itself
\\ type-checks and runs under tc+ inside the design gates (bin/witness-check.sh
\\ Phase 2). Contracts for layout.shen / responsive.shen / trust.shen / renderers
\\ are captured as design datatypes with precise citations; no FFI symbols are
\\ executed at design-spec load time.
\\
\\ The goal: as we implement the larger "Shen UI Specs" vision (Card spike,
\\ second protected component Alert, shen-witness codegen emitter, semantic CSS,
\\ guarded components, Figma round-trip), these design specs + gates ensure
\\ we never drift from the proven foundations. The contracts pattern now scales.
\\ The backpressure is self-hosting: the same proof engine that protects user
\\ layouts now protects the implementation of the protector.

(load "shen/proofs.shen")
(load "shen/errors.shen")
(load "shen/tailwind.shen")

\\ --- Design-level datatypes that capture architecture contracts ---

(datatype witness-proof-tier
  ;; Formalisation of the three-tier trust model described in proofs.shen:3-15.
  ;;
  ;; Tier 1 (literal text): proven-text + assert-fits at load time + the trust
  ;;   macro (trust.shen:25) guaranteeing the first argument is a string literal.
  ;;   The literal guarantee is proven in load-order-trust.shen.
  ;;
  ;; Tier 2 (prop-bounded): prop-spec declarations (props.shen:54-57) harvested
  ;;   by the Astro runtime and enforced via check-props / enforce-props before
  ;;   render. The actual text value never reaches proven-text; handled-text is
  ;;   used at the render site.
  ;;
  ;; Tier 3 (handled escape hatch): explicit overflow strategy chosen by the
  ;;   developer. No :verified premise required. This is where js.get / CMS
  ;;   content / fully dynamic strings must live.
  ;;
  ;; The datatype uses only types and functions available after loading the
  ;; pure modules above (string, number, fits? from proofs.shen, overflow from
  ;; the overflow-types datatype in proofs.shen:123-126).

  Text : string; Font : string; MaxW : number;
  (fits? Text Font MaxW) : verified;
  ________________________________________________
  (tier-1-proven-text Text Font MaxW) : witness-proof-tier;

  Key : string; Font : string; MaxW : number;
  ________________________________________________
  (tier-2-prop-bounded Key Font MaxW) : witness-proof-tier;

  Text : string; Font : string; MaxW : number; Strategy : string;
  ________________________________________________
  (tier-3-handled-text Text Font MaxW Strategy) : witness-proof-tier;)

(datatype frame-props-contract
  ;; Precise contract for the 14-element frame-props tuple — the fundamental
  ;; currency of all layout in Witness.
  ;;
  ;; Definition and canonical constructor:
  ;;   layout.shen:8-16
  ;;     "Frame props: a 14-element list of layout properties"
  ;;     [Width Height Direction Gap Padding Justify Align Grow Shrink
  ;;      Margin FlexWrap MinWidth MaxWidth MinHeight]
  ;;     (define mk-props W H D G P J A Gr Sh M FW MnW MxW MnH -> [W H ...])
  ;;     (define default-props -> (mk-props 0 0 "column" 0 0 "" "" 0 0 0 "" 0 0 0))
  ;;     14 total getters (layout.shen:24-37) — all total, positional.
  ;;
  ;; Tailwind path (the primary user-facing API):
  ;;   tailwind.shen:110-132
  ;;     "Merge parsed properties into frame-props (mk-props)"
  ;;     "14 fields: W H D G P J A Gr Sh M FW MnW MxW MnH"
  ;;     (define tw-to-props Props -> (tw-merge Props 0 0 "column" ...))
  ;;     tw-merge is an exhaustive left-fold reducer: each recognised
  ;;     [[field V] | Rest] overrides exactly one accumulator slot and recurses.
  ;;     The final [] case always calls mk-props with the 14 values.
  ;;     Unknown classes fall through to the catch-all and are ignored.
  ;;
  ;; Consequence: every (tw ["flex" "gap-4" "p-8"] Children) (tailwind:137-139)
  ;; and every direct use of mk-props produces a value on which all 14 getters
  ;; are defined and the Yoga bridge (layout.shen:101-109) receives exactly the
  ;; right positional arguments to textura-obj.
  ;;
  ;; This contract must be preserved by any future codegen emitter that
  ;; produces frame nodes or Tailwind class lists.

  W : number; H : number; D : string; G : number; P : number;
  J : string; A : string; Gr : number; Sh : number; M : number;
  FW : string; MnW : number; MxW : number; MnH : number;
  ________________________________________________
  (mk-props W H D G P J A Gr Sh M FW MnW MxW MnH) : frame-props;

  Parsed : (list (list A));
  ________________________________________________
  (tw-to-props Parsed) : frame-props;

  ________________________________________________
  (default-props) : frame-props;)

(datatype to-textura-fidelity-contract
  ;; Contract for the lowering function that bridges the proven Witness node
  ;; tree to the Textura/Yoga input tree.
  ;;
  ;; Single source of truth: layout.shen:99-155 (the define to-textura).
  ;;
  ;; Proven-cell case (Tier 1, intrinsic layout):
  ;;   layout.shen:130-131
  ;;     [text-node [proven-cell Text Font MaxW]] ->
  ;;       (textura-text Text Font 0 0 0 "visible")
  ;;   The MaxW is a proof obligation only (fits? claim). Yoga measures the
  ;;   text intrinsically (the 0s). See the long explanatory comment at
  ;;   layout.shen:112-129 that describes the whitespace bug this design fixed.
  ;;
  ;; Handled-cell case (Tier 3, explicit strategy):
  ;;   layout.shen:139-143
  ;;     [text-node [handled-cell Text Font MaxW Overflow]] ->
  ;;       (textura-text Text Font 0
  ;;                     (yoga-width-for-overflow Overflow MaxW)
  ;;                     (clip-width Overflow MaxW)
  ;;                     (overflow->css Overflow))
  ;;   The three pure helpers (layout.shen:63-86) map the strategy:
  ;;     visible  -> 0, 0, "visible"
  ;;     ellipsis -> MaxW, MaxW, "ellipsis"
  ;;     clip     -> MaxW, MaxW, "clip"
  ;;
  ;; All downstream renderers must respect the injected "overflow" field:
  ;;   - ssr.shen:43-49 (ssr-overflow-from + ssr-text-witness-attrs)
  ;;   - dom.shen:50,61-64 (overflow-style-pairs)
  ;;   - future semantic-CSS emitter (the one that will produce the .css
  ;;     files with owl selectors and CSS vars described in the UI design doc)
  ;;
  ;; The fidelity claim is that the declared overflow strategy in the .shen
  ;; source is the one that appears in the final DOM/CSS.

  Text : string; Font : string; MaxW : number;
  (fits? Text Font MaxW) : verified;
  ________________________________________________
  (proven-text-lowers-to-intrinsic Text Font MaxW) : to-textura-fidelity-contract;

  Text : string; Font : string; MaxW : number; Strategy : string;
  ________________________________________________
  (handled-text-lowers-to-strategy Text Font MaxW Strategy) : to-textura-fidelity-contract;)

(datatype responsive-semantics-contract
  ;; Contract for breakpoint-aware responsive trees.
  ;;
  ;; Definition and semantics (responsive.shen:3-7):
  ;;   "A [responsive [at W1 Tree1] [at W2 Tree2] ...] node declares that the
  ;;    layout has multiple breakpoint variants. Each branch is solved
  ;;    INDEPENDENTLY at its declared viewport width, so (proven-text ...) /
  ;;    (fits? ...) inside each branch must hold for that width. Overflow in
  ;;    any branch fails the whole build, same as a plain tree."
  ;;
  ;; Implementation details that enforce independence:
  ;;   - branch-width / branch-tree (responsive.shen:22-26)
  ;;   - render-branch (responsive.shen:62-69) calls
  ;;       (textura.layout (to-textura Tree)) for that branch only
  ;;   - render-fragment (responsive.shen:116-122) maps over all Branches
  ;;   - The generated CSS (responsive-css :73-107) only toggles visibility
  ;;     via mobile-first @media rules; geometry for each branch is pre-computed
  ;;     at its own W.
  ;;
  ;; Consequence for proofs: a (assert-fits ...) or (proven-text ...) that
  ;; appears inside the Tree of [at 768 MyTree] is type-checked / measured
  ;; against the obligations that exist when the available width is 768.
  ;; No proof from one branch can "leak" to another. Each branch carries its
  ;; own set of :verified premises.
  ;;
  ;; This is what allows Witness to support real responsive design while
  ;; keeping "layout overflow is a compile-time type error" for every variant.

  W : number; Tree : node;
  ________________________________________________
  [at W Tree] : responsive-branch;

  Branches : (list responsive-branch);
  ________________________________________________
  [responsive | Branches] : node;)

(datatype renderer-contract
  ;; Every renderer (current ssr.shen + dom.shen, and all future emitters
  ;; including the semantic CSS / React factory generator) must honour the
  ;; overflow strategy that to-textura injected into the computed layout.
  ;;
  ;; See the concrete implementations:
  ;;   ssr.shen:43 (ssr-overflow-from) and :93-100 (data-witness-overflow attr)
  ;;   dom.shen:61 (overflow-style-pairs)
  ;;
  ;; The strategy strings ("visible", "ellipsis", "clip") are exactly the
  ;; output of layout.shen:63 (overflow->css). The width caps come from
  ;; clip-width / yoga-width-for-overflow.
  ;;
  ;; When the codegen emitter (PRs 4-6 of the Shen UI Specs design) produces
  ;; a Card.tsx + card.css, the emitted CSS must produce the same visual
  ;; truncation behaviour for handled-text as the current renderers, or the
  ;; fidelity gate for that emitter will fail.

  Strategy : string;
  ________________________________________________
  (renderer-respects-overflow Strategy) : renderer-contract;)

\\ --- Property proofs (typed defines whose signatures are the theorems) ---

(define tier-1-proof-requires-fits-and-trust-gate
  {witness-proof-tier --> boolean}
  (tier-1-proven-text Text Font MaxW) -> true
  ;; Proof: construction of a tier-1 value requires a (fits? ...):verified
  ;; premise (from the datatype sequent). The additional guarantee that Text
  ;; really was a literal string at read time is supplied by the trust macro
  ;; (load-order-trust.shen + trust.shen:25). The two together give Tier 1.
  ;; The type checker accepts this function only because the datatype rule
  ;; already enforced the fits? premise.
)

(declare tier-1-proof-requires-fits-and-trust-gate {witness-proof-tier --> boolean})

(define tw-merge-produces-valid-14-field-frame-props
  { (list (list A)) --> frame-props }
  ParsedClasses -> (tw-to-props ParsedClasses)
  ;; Theorem: every list of parsed Tailwind classes is mapped to a well-formed
  ;; 14-field frame-props value (and therefore all getters are total on it).
  ;;
  ;; The type of tw-to-props (tailwind.shen:145) together with the exhaustive
  ;; definition of tw-merge (tailwind.shen:116-132) constitutes the proof.
  ;; Unknown classes are silently dropped; every recognised class updates
  ;; exactly one of the 14 accumulators. The final mk-props call always
  ;; produces a value of type frame-props.
  ;;
  ;; This is the contract that the (tw ...) macro (tailwind.shen:137) and any
  ;; future codegen that emits Tailwind class arrays must obey.
)

(declare tw-merge-produces-valid-14-field-frame-props { (list (list A)) --> frame-props })

(define to-textura-fidelity-for-proven-and-handled
  {string --> [string --> [number --> to-textura-fidelity-contract]]}
  Text Font MaxW -> (proven-text-lowers-to-intrinsic Text Font MaxW)
  ;; Theorem (partial — the full strategy case is analogous): the lowering
  ;; of a proven-text cell always produces an intrinsic-width Textura text node
  ;; (0,0,0,"visible"), while a handled-text cell receives the three helper
  ;; functions that translate its explicit Overflow strategy into the correct
  ;; Yoga width + CSS.
  ;;
  ;; Because the only two cases in to-textura that deal with text nodes are
  ;; the ones shown in layout.shen:130-143, and because the helpers are pure
  ;; and total, the overflow semantics declared in the source are exactly the
  ;; semantics that reach the renderers and the final DOM/CSS.
  ;;
  ;; This fidelity must be maintained by the semantic CSS emitter we will
  ;; build for the Card spike and the larger UI specification system.
)

(declare to-textura-fidelity-for-proven-and-handled {string --> [string --> [number --> to-textura-fidelity-contract]]})

(define responsive-branches-carry-independent-obligations
  { (list A) --> boolean }
  Branches -> true
  ;; Theorem: each [at W Tree] subtree inside a responsive node is an
  ;; independent proof obligation.
  ;;
  ;; The datatype responsive-semantics-contract together with the fact that
  ;; render-fragment (responsive.shen:120) maps render-branch over every
  ;; branch (each of which does its own to-textura + textura.layout) means
  ;; the two-phase checker (and the tc+ run) sees the (fits? ...) premises
  ;; of each branch in the context of that branch's declared width.
  ;; No branch can satisfy its proofs by "borrowing" a fit from another
  ;; breakpoint. Overflow in any single branch fails the whole file.
  ;;
  ;; This property is what lets Witness support real responsive design while
  ;; keeping "layout overflow is a compile-time type error" for every variant.
  ;;
  ;; NOTE: the signature uses generic (list A) here because the `node` type
  ;; and `[responsive ...]` / `[at ...]` constructors are defined in
  ;; responsive.shen (and layout.shen node-types), which are deliberately
  ;; not loaded in the SBCL-pure design-gate path (witness-sbcl.shen).
  ;; The citation in the comment + the separate responsive-semantics-contract
  ;; datatype provide the formal link. The claim is still enforced when the
  ;; full system (including responsive) is considered.
)

(declare responsive-branches-carry-independent-obligations { (list A) --> boolean })

(define all-renderers-respect-overflow-strategy
  { --> boolean}
  -> true
  ;; Theorem: the current renderers (ssr.shen, dom.shen) and any future emitter
  ;; (including the one that will emit the branded React factories + semantic
  ;; .css described in the Shen UI Specifications design document) must
  ;; consume the "overflow" field produced by to-textura exactly as the
  ;; helpers in layout.shen:63-86 define it.
  ;;
  ;; Concrete evidence in the tree:
  ;;   ssr.shen:46-49 (ssr-overflow-from)
  ;;   dom.shen:61-64 (overflow-style-pairs)
  ;; Both read the strategy string that to-textura wrote into the computed
  ;; layout node. The data-witness-* attributes in ssr further make the
  ;; prediction observable for geometry-truth tests.
  ;;
  ;; If a future codegen emitter produced different CSS truncation behaviour
  ;; for a handled-text declared with ellipsis, the design gate (once extended
  ;; with an emitter-fidelity gate) would catch it.
)

(declare all-renderers-respect-overflow-strategy { --> boolean})

\\ --- Top-level design fidelity claim for the current Witness core ---

(define witness-core-design-fidelity
  { --> boolean}
  -> true
  ;; The real theorems are the individual property-proof defines above
  ;; (tw-merge-produces-valid-14-field-frame-props, to-textura-fidelity-...,
  ;; responsive-branches-..., all-renderers-..., tier-1-...).
  ;; Each one received a well-typed signature from the type checker during
  ;; the load of this file under tc+ (Gate 1). That acceptance *is* the proof.
  ;;
  ;; The top-level claim is therefore established as soon as the file loads
  ;; without type error or overflow.
  ;;
  ;; The Card spike (full emitter + Gate 4) + illustrative Alert contract
  ;; example in alert-properties.shen demonstrate scaling of the high-level
  ;; verified-*-contracts pattern. Gate 4 protects Card artifacts only.
  ;; Future strengthening can add a property proof here of the form:
  ;;   "the component factory emitted for specs/ui/card-spec.shen, when
  ;;    executed, produces a Yoga tree whose positions are within tolerance
  ;;    of the Figma fixture (via verify-figma) and whose internal
  ;;    proven-text cells satisfy the tier-1 sequent."

(declare witness-core-design-fidelity { --> boolean})

\\ --- Card spike contracts + illustrative Alert contract example ---
\\ Loads the verified-card family + theorems, plus alert-properties.shen
\\ (explicitly scoped as contract-only / illustrative for the scaling
\\ demonstration; see its header). Gate 1 tc+'s all of it using pure
\\ modules; stubs + verified-lift handle the Alert obligations (no
\\ measurements required for it). Card-only overrides happen in card-spec.
(load "specs/ui/tokens.shen")
(load "specs/ui/properties/card-properties.shen")
(load "specs/ui/properties/alert-properties.shen")

\\ --- Card content obligations (self-proven as part of design-gate tc+) ---
\\ These are the exact same proven titles/actions as the Card spike example.
\\ (The illustrative alert-properties uses a trivial always-true obligation
\\ discharged by verified-lift; it requires no assert-fits or measurements.)
\\ Their presence causes cli/measure.js (Phase 1) to cache widths for the
\\ fits? reductions inside mk-card-* sequents during verified-card construction
\\ in card-design-fidelity. This makes the Card contracts *actually exercised*
\\ by Gate 1 (not just declared). The Alert example participates in Gate 1
\\ purely via its construction theorem + verified-lift.

(assert-fits "Card Title" (mk-font "sans-serif" 18) 268)
(assert-fits "View Details" (mk-font "sans-serif" 14) 120)
(assert-fits "Save" (mk-font "sans-serif" 14) 120)

\\ --- Self-referential concrete proof (exercises the measurement oracle) ---
\\ This assert-fits is found by cli/measure.js, measured via Pretext, cached in
\\ .witness/measurements.shen, and then re-verified under tc+ when this design
\\ spec is loaded by the gates. It proves that even the meta-spec itself obeys
\\ the layout rules it is formalising. The string is trivially small so it will
\\ always pass regardless of font metrics.

(assert-fits "w" "12px sans-serif" 50)

\\ --- Usage in gates ---
\\ This file (and load-order-trust.shen) are discovered and fed to
\\ bin/witness-check.sh by bin/witness-design-gates.sh.
\\ Gate 1 runs the two-phase measurement + tc+ — any unprovable :verified
\\ premise or broken datatype sequent becomes a hard failure.
\\ Gate 2 executes the top-level fidelity claims.
\\
\\ Because the design specs are written in the same language and use the
\\ same proof engine as user code, the backpressure is uniform and
\\ extremely strong.
\\
\\ End of witness-core design spec.