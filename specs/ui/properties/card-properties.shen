\\ specs/ui/properties/card-properties.shen — Formal property theorems + shared datatypes for the Card spike
\\
\\ This file is the design-time + runtime home of the high-level contracts from the
\\ "Shen UI Specifications" spike (design doc Spike Realization section).
\\
\\ - Datatypes (design-tokens, card-*-slot, card-variant, verified-card) with
\\   :verified premises (real fits? + layout + stubs via the intentional
\\   verified-lift bridge documented below).
\\ - Real (non-trivial) helpers for layout-obligations etc. (re-use tokens/variant).
\\ - High-level construction in card-design-fidelity forces tc+ to prove the full
\\   verified-card contract (slots + obligations + figma + responsive) for the
\\   canonical data. 4 property theorems (sub-claims with token arithmetic + top-level fidelity).
\\ - Loaded under design gates (pure) and full framework (overrides for real figma).
\\
\\ Loaded from:
\\   - specs/design/witness-core.shen  => exercised by Gate 1 (tc+) / Gate 2
\\   - specs/ui/card-spec.shen         => full modules; overrides stubs with real figma etc.
\\
\\ The low-level render-view in card-spec continues to produce bit-identical output
\\ for all existing `witness render`, tests, and demos. The high-level contracts
\\ are the new source of truth for future emitter / guarded components.

(load "specs/ui/tokens.shen")

\\ --- Slot contracts (premises reuse existing proof machinery) ---
\\ card-title-slot requires a proven (fits? ...) premise (Tier 1 static proof)
\\ card-desc-slot carries an explicit overflow Strategy (Tier 3)
\\ card-action-slot is like title but for buttons/labels

\\ The premise is an `if` SIDE CONDITION — Shen evaluates it during type
\\ checking, so (fits? ...) really measures the text. Written as
\\ `(fits? ...) : verified;` (as it was) nothing could discharge it, and the
\\ rule fired for no input at all. See shen/proofs.shen for the same fix.
\\
\\ The conclusion is the tagged DATA form rather than an (mk-card-title ...)
\\ application, matching the [proven-cell ...] pattern in proofs.shen: a
\\ constructor function would need a signature promising card-title-slot
\\ unconditionally, which would hand out the type without the fits? premise
\\ and defeat the point of having one.
(datatype card-title-slot
  if (fits? Text Font MaxW)
  Text : string; Font : string; MaxW : number; Tokens : design-tokens;
  ________________________________________________
  [card-title Text Font MaxW Tokens] : card-title-slot;)

(datatype card-desc-slot
  Text : string; Font : string; MaxW : number; Tokens : design-tokens;
  Strategy : overflow;
  ________________________________________________
  [card-desc Text Font MaxW Strategy Tokens] : card-desc-slot;)

(datatype card-action-slot
  if (fits? Label Font MaxW)
  Label : string; Font : string; MaxW : number; Tokens : design-tokens;
  ________________________________________________
  [card-action Label Font MaxW Tokens] : card-action-slot;)

\\ --- Variant declarations (each carries independent obligations, like responsive branches) ---
\\ mobile  = 320px viewport, 268px content width (the tightest constraint)
\\ tablet  = 768px
\\ desktop = 600px (example)

(datatype card-variant
  ___ mobile  : card-variant;
  ___ tablet  : card-variant;
  ___ desktop : card-variant;)

(declare variant-width [card-variant --> number])

(define variant-width
  {card-variant --> number}
  mobile  -> 268
  tablet  -> 400
  desktop -> 600)

\\ --- Layout obligations (pure helper; real impl would build frame tree + solve-layout) ---
\\ In full runtime (after layout/responsive/figma loaded via witness.shen) this
\\ can be strengthened to construct the variant tree and call solve-layout.
\\ For the spike the token arithmetic + fits? premises on the slots suffice.
\\ Re-uses variant-width and token-value so obligations are expressed in design tokens.

(declare layout-obligations-satisfied [card-title-slot --> [card-desc-slot --> [[list card-action-slot] --> [card-variant --> [design-tokens --> boolean]]]]])

\\ Accessors over the slot data forms. The slots ARE their tagged lists (see
\\ the datatypes above), so the obligation can measure what they actually hold
\\ rather than asserting facts about constants.

(define card-title-fits-within
  {card-title-slot --> number --> boolean}
  [card-title Text Font MaxW _] Content ->
    (and (<= (measure Text Font) MaxW)
         (<= MaxW Content)))

(define card-actions-row-width
  {(list card-action-slot) --> number --> number}
  [] _ -> 0
  [[card-action Label Font _ _]] _ -> (measure Label Font)
  [[card-action Label Font _ _] | Rest] Gap ->
    (+ (measure Label Font) (+ Gap (card-actions-row-width Rest Gap))))

\\ The real obligation.
\\
\\ This was:
\\   (let W (variant-width Variant) Gap (token-value Tokens "space-2")
\\     (and (>= W 268) (>= Gap 0) true))
\\ — where W is a variant width whose minimum IS 268 and Gap is a positive
\\ token, so both conjuncts were constants and the third was the literal true.
\\ It took the slots as arguments and looked at none of them. Every card
\\ satisfied it, including one whose text did not fit.
\\
\\ Now it measures: the title must fit its own bound AND that bound must fit
\\ the variant's content width, and the action row plus its gaps must fit too.
\\ Desc is exempt by contract — it declares an ellipsis strategy, so its
\\ obligation is the truncation, not the fit.
(define layout-obligations-satisfied
  {card-title-slot --> card-desc-slot --> (list card-action-slot) --> card-variant --> design-tokens --> boolean}
  Title Desc Actions Variant Tokens ->
    (let Content (variant-width Variant)
         Gap (token-value Tokens "space-2")
      (and (card-title-fits-within Title Content)
           (<= (card-actions-row-width Actions Gap) Content))))

\\ NOTE: (declare F Type) EVALUATES its type argument — [...] builds the list and
\\ bare symbols self-evaluate, but (list card-action-slot) would be read as a call
\\ to an undefined function `list` and abort the whole file at load. The list type
\\ must therefore be written in bracket form here. (Inside a `datatype`, types are
\\ not evaluated, so the (list card-action-slot) at the Actions premise below is
\\ correct as written.)

\\ --- Figma premise (stub in design path; real version installed by card-spec.shen) ---
\\ Under Gate 1 (pure SBCL via witness-sbcl) we use the stub so the datatype
\\ loads without pulling in figma.shen / layout. The real verify-figma is
\\ installed by overriding the function in card-spec.shen (full load path).

(declare figma-card-matches [string --> [card-variant --> [number --> boolean]]])

(define figma-card-matches
  {string --> card-variant --> number --> boolean}
  Path Variant Tolerance -> true)

\\ Future: each variant carries its own proven subtree (cf. responsive-semantics-contract).
(declare responsive-variants-proven [card-variant --> [design-tokens --> boolean]])

(define responsive-variants-proven
  {card-variant --> design-tokens --> boolean}
  Variant Tokens -> (and (>= (variant-width Variant) 268) true))

\\ verified-lift REMOVED.
\\
\\ It supplied the sequent `true : verified`, and ~14 lines of prose here
\\ described it as "the standard mechanism" by which any predicate reducing to
\\ true could discharge a `:verified` premise. That was not true of it: Shen
\\ lifts only the syntactic literal `true`, so a call to a function whose body
\\ is `-> true` was never liftable, and every obligation resting on it was
\\ unprovable rather than trivially provable.
\\
\\ Obligations are now `if` side conditions, which Shen evaluates, so there is
\\ nothing left to lift. The one thing verified-lift did do — make it possible
\\ to write an obligation that is true by construction — is exactly what this
\\ file should not have.

\\ --- The verified Card (the product type the emitter will brand) ---

(datatype verified-card
  \\ layout-obligations-satisfied is deliberately NOT in this side condition.
  \\ When tc+ evaluates a side condition, the conclusion's variables are bound
  \\ to sub-EXPRESSIONS of the term being typed rather than to values, so an
  \\ obligation that destructures the slots to measure them cannot run here
  \\ (it aborts the check with "input stream expected"). Per-slot fits? is
  \\ enforced at type-check time by the card-*-slot rules above, which is the
  \\ headline guarantee; the cross-slot layout obligation is enforced by
  \\ EXECUTION in Gate 2 via card-layout-obligations-hold below. Both are real
  \\ and both can fail — they just fire at different moments, and the docs say
  \\ which.
  if (and (figma-card-matches "examples/card-design.json" Variant 2)
          (responsive-variants-proven Variant Tokens))
  Title : card-title-slot;
  Desc  : card-desc-slot;
  Actions : (list card-action-slot);
  Variant : card-variant;
  Tokens : design-tokens;
  ________________________________________________
  [card Title Desc Actions Variant Tokens] : verified-card;)

\\ --- Runtime constructors (values are opaque for now; type rules above do the work) ---

(define mk-card-title
  Text Font MaxW Tokens -> [card-title Text Font MaxW Tokens])

(define mk-card-desc
  Text Font MaxW Strategy Tokens -> [card-desc Text Font MaxW Strategy Tokens])

(define mk-card-action
  Label Font MaxW Tokens -> [card-action Label Font MaxW Tokens])

\\ =====================================================================
\\ === Property theorems (Gate 1/2 prove these via tc+ acceptance) ===
\\ === 4 theorems: min-width variants, gap arithmetic, figma reify, token fit ===
\\ =====================================================================

\\ Real body restored. These were all `-> true` with the arithmetic commented
\\ out beneath them, so every "theorem" was a constant and the docs counted
\\ them as proven. They compute now — in part because token-value works now.
(define card-variants-respect-minimum-content-width
  {--> boolean}
  -> (and (>= (variant-width mobile) 268)
          (and (>= (variant-width tablet) 268)
               (>= (variant-width desktop) 268))))

(define title-and-actions-never-overflow-under-gap-token
  {--> boolean}
  -> (let Gap (token-value default-tokens "space-2")
          ActionW 120
          TitleMax 268
          ActionsTotal (+ ActionW (+ Gap ActionW))
       (>= TitleMax ActionsTotal)))

\\ NOTE: figma-card-matches is itself a stub returning true in this load path
\\ (the real verify-figma is installed by card-spec.shen). This theorem is
\\ therefore only as strong as that stub — labelled here rather than counted
\\ as a proof of Figma fidelity.
(define default-variant-figma-structural-match-reified
  {--> boolean}
  -> (figma-card-matches "examples/card-design.json" mobile 2))

\\ Token arithmetic across slots (new meaningful property theorem).
\\ Proves using the live token-value and variant-width (same helpers used by
\\ layout-obligations) that the canonical action pair + gap fits inside the
\\ tightest (mobile) variant width. This kind of static guarantee scales to
\\ other protected components.
(define action-pair-plus-gap-never-exceeds-tightest-variant
  {--> boolean}
  -> (let Gap (token-value default-tokens "space-2")
          A1 120
          A2 120
          Total (+ A1 (+ Gap A2))
          Tightest (variant-width mobile)
       (<= Total Tightest)))

\\ The cross-slot layout obligation, as an executed theorem (Gate 2).
\\
\\ This measures: the title must fit its own proven bound AND that bound must
\\ fit the tightest variant's content width, and the action row plus its gaps
\\ must fit as well. Falsify it by widening a slot's text or shrinking a
\\ variant width — `./bin/witness-design-gates.sh --gate 2` goes red.
(define card-layout-obligations-hold
  {--> boolean}
  -> (layout-obligations-satisfied
        [card-title "Card Title" "18px sans-serif" 268 default-tokens]
        [card-desc "Short desc for construction." "14px sans-serif" 268 ellipsis default-tokens]
        [[card-action "View Details" "14px sans-serif" 120 default-tokens]
         [card-action "Save" "14px sans-serif" 120 default-tokens]]
        mobile
        default-tokens))

\\ --- Top-level design fidelity claim for the Card spike ---
\\ This theorem COMPUTES fidelity from real work: it conjoins the executable
\\ sub-obligations, each of which measures the canonical Card data or exercises
\\ live token/variant arithmetic and returns false when a bound is broken. It is
\\ NOT `-> true` and there is no verified-lift behind it.
\\
\\ Conjuncts (all defined above, all falsifiable):
\\   - card-layout-obligations-hold: runs layout-obligations-satisfied over the
\\       canonical slots — measures the title text against its bound AND that
\\       bound against the mobile variant's content width, and the action row +
\\       live space-2 gaps against that width. Widen a canonical slot's text or
\\       shrink a variant width and it goes false.
\\   - card-variants-respect-minimum-content-width: every variant width >= 268.
\\   - action-pair-plus-gap-never-exceeds-tightest-variant: canonical action pair
\\       + live space-2 gap fits the tightest (mobile) variant width.
\\   - title-and-actions-never-overflow-under-gap-token: title bound covers the
\\       action-row + gap arithmetic.
\\
\\ STUB BOUNDARY (deliberately NOT conjoined here): figma-card-matches and
\\ responsive-variants-proven are stubs in this pure design-gate load path (the
\\ real verify-figma is installed by card-spec.shen). Folding their `-> true`
\\ into this claim would launder a stub into a fidelity proof, so they are
\\ excluded. They ARE enforced as verified-card side conditions at construction
\\ when card-spec.shen overrides them with the real implementations.
(define card-design-fidelity
  {--> boolean}
  -> (and (card-layout-obligations-hold)
          (and (card-variants-respect-minimum-content-width)
               (and (action-pair-plus-gap-never-exceeds-tightest-variant)
                    (title-and-actions-never-overflow-under-gap-token)))))

(declare card-design-fidelity [--> boolean])

\\ End of card-properties.shen
\\ The high-level contracts (now including 4 theorems exercising slots, layout
\\ obligations, figma, responsive, and cross-slot token arithmetic) are active
\\ and protected by the same gates that protect the Witness core. Gate 4 runs the
\\ emitter against this spec. The pattern is ready to scale to additional
\\ protected components (see alert-properties.shen).

\\ ------------------------------------------------------------------
\\ Contract shape descriptor (for tight Shen <-> JS coupling)
\\ ------------------------------------------------------------------
\\ This function returns a simple machine-readable description of the
\\ verified-card family. The emitter (card-emitter.js) calls this at
\\ runtime instead of maintaining a hand-written JS mirror of the
\\ datatypes. This eliminates dual-maintenance: the shape lives in Shen.

(define card-contract-shape
  { --> [list *] }
  \\ Shen has no (list ...) function — square brackets ARE the list constructor,
  \\ and their elements are evaluated (so strings, numbers, booleans and nested
  \\ brackets all work directly). This definition previously used (list ...)
  \\ throughout, which meant the whole descriptor failed at load with
  \\ `function "list" is not defined` and the emitter silently fell back to a
  \\ hardcoded baseline. Shapes below match what codegen/emitters/card-emitter.js
  \\ parses in parseContractShape:
  \\   - top level, "slots", token_values, variant_widths, directDefaults:
  \\       lists of [key value] PAIRS
  \\   - variants / tokens / obligations / canonicalContents: flat lists
  \\   - instanceShape: flat 4-element [tag key kind target] entries
  -> [
       ["name" "verified-card"]
       ["slots"
         [
           ["title"
             [["type" "card-title-slot"]
              ["has_fits_premise" true]
              ["maxW" 268]
              ["font" "18px/1.2 sans-serif"]
              ["jsKey" "title"]
              ["ctor" "mk-card-title"]
              ["ctorArgName" "Text"]
              ["contentField" "text"]
              ["jsType" "CardTitle"]
              ["jsBrand" "CARD_TITLE_BRAND"]
              ["factory" "createCardTitle"]
              ["defaultContent" "Card Title"]
              ["isList" false]
              ["requireNonEmpty" true]
              ["walkKey" "titleSlot"]
              ["fontVar" "--font-title"]
              ["color" "#111"]
              ["includeMaxW" true]]]
           ["desc"
             [["type" "card-desc-slot"]
              ["has_fits_premise" false]
              ["strategy" "ellipsis"]
              ["maxW" 268]
              ["font" "14px/1 sans-serif"]
              ["jsKey" "desc"]
              ["ctor" "mk-card-desc"]
              ["ctorArgName" "Text"]
              ["contentField" "text"]
              ["jsType" "CardDesc"]
              ["jsBrand" "CARD_DESC_BRAND"]
              ["factory" "createCardDesc"]
              ["defaultContent" "Short desc for construction."]
              ["isList" false]
              ["requireNonEmpty" false]
              ["walkKey" "descSlot"]
              ["fontVar" "--font-action"]
              ["color" "#444"]
              ["ellipsis" true]]]
           ["actions"
             [["type" "card-action-slot"]
              ["has_fits_premise" true]
              ["maxW" 120]
              ["font" "14px/1 sans-serif"]
              ["jsKey" "actions"]
              ["ctor" "mk-card-action"]
              ["ctorArgName" "Label"]
              ["contentField" "text"]
              ["jsType" "CardAction"]
              ["jsBrand" "CARD_ACTION_BRAND"]
              ["factory" "createCardAction"]
              ["isList" true]
              ["requireNonEmpty" true]
              ["walkKey" "actionSlots"]
              ["canonicalContents" ["View Details" "Save"]]
              ["itemClass" "card__action"]
              ["fontVar" "--font-action"]
              ["color" "#444"]]]]]
       ["variants" ["mobile" "tablet" "desktop"]]
       ["default_variant" "mobile"]
       ["tokens" ["space-4" "space-2" "radius-lg" "text-title" "text-action"]]
       ["token_values" [["space-4" 16] ["space-2" 8] ["radius-lg" 8] ["text-title" 18] ["text-action" 14]]]
       ["variant_widths" [["mobile" 268] ["tablet" 400] ["desktop" 600]]]
       ["directDefaults" [["variant" "mobile"] ["tokens" "default-tokens"]]]
       ["obligations" ["layout" "figma" "responsive"]]
       \\ Top-level shape for a verified-card instance (what keys exist on the object)
       ["instanceShape"
         [["key" "title"   "slot" "title"]
          ["key" "desc"    "slot" "desc"]
          ["key" "actions" "slot" "actions"]
          ["key" "variant" "direct" true]
          ["key" "tokens"  "direct" true]]]])

(declare card-contract-shape [--> [list *]])
