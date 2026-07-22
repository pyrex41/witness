# Protected Card Workflow — Design Gates & Loop Examples

This guide shows the **living, protected development environment** for the Shen UI Specifications (Card spike) now that the high-level verified contracts are active and wired into the sb-style backpressure system.

The same proof engine (`fits?`, `tc+`, layout oracles, Figma structural checks) that turns "layout overflow" into a compile-time error for end-user `.shen` files now protects the **Card itself**:

- High-level datatypes + obligations (`verified-card`, `card-title-slot`, `card-desc-slot`, `card-action-slot`, `card-variant`, `layout-obligations-satisfied`, `figma-card-matches`, `responsive-variants-proven`) live in `specs/ui/properties/card-properties.shen`.
- The composite theorem `card-design-fidelity` is executed by Gate 2. The canonical `verified-card` is constructed in `specs/design/witness-core.shen` and type-checked by Gate 1 (`mk-card-title`, `mk-card-desc`, `mk-card-action`, `card ...`). `tc+` acceptance of the construction is what discharges the slot premises; Gate 2 separately executes the theorem bodies.
- `specs/ui/card-spec.shen` keeps the thin low-level `render-view` (100% backward compat for `witness render`, tests, demos) while the high-level path is what the emitter and future codegen target.
- Gate 1 (`tc+` over `specs/design/*.shen`) type-checks constructions of the canonical Card. Building those values forces the type checker to evaluate each slot's `if (fits? ...)` side condition against a real Pretext measurement, so a slot whose text exceeds its bound turns the gate red.
- Gate 4 runs the real `shen-witness` emitter (`codegen/emitters/card-emitter.js`) against the Card spec and enforces faithful branded output (`Card.tsx` + `card.css`).

The result: **you cannot silently drift the Card contracts or the emitter**. The gates + `witness loop` give you a first-class "Ralph-style" protected shell for evolving the UI spec layer.

> **Why this design — the hybrid (Shen source-of-truth + low-effort deterministic generation)**
>
> Shen (`specs/ui/properties/card-properties.shen` + the live `(card-contract-shape)` descriptor) is the single source of truth for every verified datatype, slot field (`maxW`, `font`, `strategy`, `fits?` premises), variant matrix, token, obligation, and the exact construction shape used by `card-design-fidelity`.
>
> The emitter (`card-emitter.js`) is deliberately a thin, deterministic projector: it calls the Shen descriptor at runtime, parses the narrow list-of-pairs once, and drives canonical construction, walking, and all artifact generation from it. There is no complete hand-written JS mirror of the contracts.
>
> This hybrid delivers:
> - Full formal power (sequent calculus, `:verified`, `tc+` proofs of layout/figma/responsive obligations) stays where the theorems are actually checked.
> - Generation cost stays near-zero and is automatically kept in sync — the "what" (numbers, fields, variants) comes from the spec; the emitter only encodes the "how to emit" strategy.
> - Gate 4 (`fidelityChecks[]` co-located with the emitter + auto-discovery + real `tsc --noEmit`) makes any drift a hard, loud failure.
>
> Newcomers: you edit the Shen spec and theorem; the emitter and generated code follow with minimal mechanical work. The gates (not humans) enforce fidelity. This is the direction of the entire Shen UI Specifications effort.

## 1. Targeted Gate Runs Focused on the Card

Run individual gates or the fast inner-loop subset. These are the commands you reach for while iterating on `specs/ui/card-spec.shen`, `specs/ui/properties/card-properties.shen`, or the emitter.

```bash
# Fast inner-loop (Gates 1+2 only) — proves the Card theorems via tc+
# (witness-core loads the properties + asserts; card-design-fidelity constructs verified-card)
npm run gates -- --quick
# or
witness gates --quick
```

```bash
# Emitter fidelity only (Gate 4) — perfect while tuning card-emitter.js
# Walks the Card shape, emits, then asserts brands / factories / tokens / semantic classes / owl / container queries
witness gates --gate 4

# Typical output (≈3s, passes cleanly):
# === Witness Design Fidelity Gates (sb-style backpressure) ===
# ...
# Gate 4: Emitter fidelity (first shen-witness codegen on Card)
#   ...
#   ✓ All emitter fidelity markers present.
#   ✓ Gate 4 passed (emitter produces faithful Card.tsx + card.css) [3s]
#
# === All design gates passed ===
# Total elapsed: 3s
# The implementation is faithful to specs/design/*.shen (and the Card spike contracts + emitter).
```

```bash
# Other useful single-gate targets while working on the Card
witness gates --gate 1          # tc+ on design specs (exercises Card datatypes + fidelity theorem)
witness gates --gate 2          # property proofs (theorems are proven by successful tc+)
witness gates --gate 3          # emitter fidelity
```

All of the above are also available directly:

```bash
./bin/witness-design-gates.sh --quick
./bin/witness-design-gates.sh --gate 4
./bin/witness-design-gates.sh --emit --gate 3   # regenerate + check emitter fidelity
```

See `witness gates --help` (or the gate runner source) for the full alias list (`tc`, `proofs`, `emitter`, `tcb`, ...).

## 2. The Gate-Protected Loop — `witness loop` for Card Evolution

`witness loop` (backed by `bin/witness-loop.sh`) is the **first-class protected dev environment**. It prints a rich banner, runs your chosen gates *before every agent iteration*, and turns any design violation into a loud, actionable `DESIGN SPEC VIOLATION` block (no silent drift).

The loop already ships with Card-focused examples in its help text.

```bash
# See the banner + all supported --gate modes
witness loop --help
```

### Typical inner-loop session on the Card contracts (fast gates)

```bash
witness loop specs/ui/card-spec.shen --max-iter 8
# (defaults to --gate quick)
```

### Strict mode while touching core + specs

```bash
witness loop specs/ui/card-spec.shen specs/design/witness-core.shen \
  --max-iter 5 --gate full
```

### Focused emitter work (Gate 4 only, with dry-run safety)

```bash
witness loop codegen/emitters/card-emitter.js specs/ui/card-spec.shen \
  --max-iter 20 --gate 4 --dry-run
```

### Direct binary form (after `npm link` or global install)

```bash
witness-loop specs/ui/card-spec.shen --gate quick --max-iter 10
```

### The rich protected-environment banner (real captured run)

```bash
witness loop specs/ui/card-spec.shen --dry-run --max-iter 1 --gate 4
```

**Actual banner + execution (Gate 4, dry-run, single iter — finishes fast because the Card is currently faithful):**

```
=== Witness Gate-Protected Loop (Ralph-style) ===
Self-hosting backpressure for the Shen UI spec system (Card, emitter, contracts).

  Gate mode this run : 3   (quick=fast 1+2 | full=1-4 | N=single gate)
  Max agent iters    : 1
  Dry-run            : true
  Files under watch  :
    - specs/ui/card-spec.shen

Design gates will run before every iteration.
Gate failures surface as first-class DESIGN SPEC VIOLATION blocks with exact remediation.
The same machinery that protects user layouts now protects the evolution of Witness itself.

[dry-run mode] Gates will execute and agent will report, but no file mutations will occur.
  (You will still see the full rich gate output and iteration logs — ideal for observing backpressure without risk.)
Equivalent direct command: node cli/agent.js specs/ui/card-spec.shen --max-iter 1 --respect-design-gates --gate 4 --dry-run

Launching gate-aware agent...

=== Witness Design Fidelity Gates ... ===
Gate 4: Emitter fidelity (first shen-witness codegen on Card)
  ...
  ✓ All emitter fidelity markers present.
  ✓ Gate 4 passed ... [2s]

=== All design gates passed ===
...
Done in 1 iteration
```

Because the gates passed and there were no user-level layout overflows in the loaded spec, the loop succeeded in one iteration — exactly the "green" experience you want while safely iterating.

## 3. Regenerating the Emitter Output (with Gate 4 Guard)

The emitter is itself under protection. To (re)write the guarded `Card.tsx` + `card.css`:

```bash
# Write the artifacts + immediately run the fidelity check
witness gates --emit --gate 4
```

Inside the gate runner you will see:

```
  (write mode: artifacts will be written under codegen/emitters/generated/card/)
  ...
  ✓ Gate 4 passed ...
```

Then inspect the results:

```bash
ls -l codegen/emitters/generated/card/
cat codegen/emitters/generated/card/Card.tsx | head -30
cat codegen/emitters/generated/card/card.css | head -20
```

The emitted files are stamped with:

```ts
// GENERATED by shen-witness (codegen/emitters/card-emitter.js)
// from specs/ui/card-spec.shen — do not edit by hand.
// Regenerate: node codegen/emitters/card-emitter.js --emit
// Gate 4 (emitter fidelity) protects this output.
```

And the CSS starts with the design tokens from `tokens.shen`:

```css
:root {
  --space-4: 16px;
  --space-2: 8px;
  ...
}
.card { width: 300px; ... }
```

Future strengthening of Gate 4 will also walk the full `verified-card` datatype and measure the Yoga tree of the emitted component.

## 4. Dry-Run Safety — Observe Backpressure Without Risk

```bash
# Everything runs (gates before each iter, full logs, violation messages) but no writes
witness loop specs/ui/card-spec.shen --dry-run --gate full --max-iter 3
```

The banner explicitly calls it out:

```
[dry-run mode] Gates will execute and agent will report, but no file mutations will occur.
  (You will still see the full rich gate output and iteration logs — ideal for observing backpressure without risk.)
```

Perfect for demos, pairing, or when you want to watch the self-hosting protection in action.

## 5. What a DESIGN SPEC VIOLATION Looks Like (the Backpressure in Action)

If you edit `card-properties.shen` (or the emitter, or core) in a way that breaks a theorem, Gate 1/4/etc. will fail **before** the agent is allowed to propose any further changes.

The agent surfaces this as a first-class error:

```
<file: <design-gates>>
message:
  DESIGN SPEC VIOLATION (Gate 4 — high-priority backpressure):
  <full gate runner output with the exact failure, e.g. "FIDELITY DRIFT detected in: Symbol brands...">

  The design contracts in specs/design/ (witness-core, load-order-trust, renderer contracts,
  Card verified datatypes, emitter fidelity, etc.) have been violated...

  Remediation (exact instructions — follow these):
    1. Read the gate failure details above (full runner output).
    2. Diagnose further: witness gates --gate 4   (or 'witness gates' for the complete suite)
    3. Either:
         • Edit the design spec (specs/design/*.shen or specs/ui/card-spec.shen + properties/)
           to reflect the new intended contracts, OR
         • Fix the implementation (shen/*.shen, cli/, bin/, codegen/emitters/, etc.)
           to restore fidelity to the existing proven contracts.
    4. Re-validate: witness loop ... --gate 4 --max-iter ...
    5. Only continue autonomous changes once 'witness gates' (and the chosen --gate) is fully green.

  This is the self-hosting protection: the same proof engine that turns layout overflow into a
  compile-time error for users now prevents silent drift while evolving the Witness/Card/emitter system.
  Do not ignore or work around this block.
```

**Key UX points:**

- No auto-fix is attempted for design-gate failures (unlike user overflow widen edits).
- The full original gate output is preserved so you have the precise error (e.g. which fidelity marker failed).
- The suggested commands are concrete and re-entrant.
- The loop stops; you must make the gates green again before continuing.

This is exactly the "protected" feeling the earlier sb-shen-backpressure pattern was designed to deliver — now self-hosted for the Card.

## 6. The Contracts You Are Actually Protecting

While you run the commands above, you are exercising real formal artifacts:

- `specs/ui/properties/card-properties.shen`
  - Datatypes: `design-tokens`, `card-title-slot` (with `(fits? ...):verified`), `card-desc-slot` (overflow strategy), `card-action-slot`, `card-variant` (mobile/tablet/desktop with `variant-width`), `verified-card` (product type carrying the three obligations).
  - Theorems (whose `tc+` acceptance = proof):
    - `card-variants-respect-minimum-content-width`
    - `title-and-actions-never-overflow-under-gap-token`
    - `default-variant-figma-structural-match-reified`
    - `card-design-fidelity` ← the star: constructs `TheCard` with factories + canonical data, conjoins the sub-theorems. All `:verified` premises must be discharged by the type checker.

- `specs/ui/card-spec.shen` — loads tokens, provides the low-level `render-view` (and `variant-tree`, `figma-card-matches` overrides for full runtime), plus the high-level comment block describing the Phase 2 activation.

- `specs/design/witness-core.shen` — explicitly loads the Card properties + the three `assert-fits` for the canonical strings so that Gate 1's measurement cache + tc+ actually runs the slot sequents inside `card-design-fidelity`.

The thin `examples/card.shen` just does `(load "specs/ui/card-spec.shen")` so every existing demo, test, and `witness render` continues to work unchanged.

## 7. Recipe Card — Realistic End-to-End Flows & Protected Development Loop

This section expands the quick command list into **narrative, scenario-driven recipes** that show exactly what a developer does when the high-level verified-card contracts (powered by the `(card-contract-shape)` descriptor), the shape-driven emitter, and Gate 4 are live.

The 60-second demo (`docs/card-protected-demo.sh`) and everything below remain the fastest way to feel the modern protected experience.

### Protected Development Loop — A Realistic 5–10 Minute Session

A typical focused session while evolving the Card emitter or contracts looks like this (you stay inside the protected environment the entire time):

1. **Observe first (dry-run + Gate 4)**  
   You want to experiment with richer high-level slot emission in `card-emitter.js`. You start the Ralph-style loop in dry-run so you can watch every gate execution and banner without any file writes:

   ```bash
   witness loop codegen/emitters/card-emitter.js specs/ui/card-spec.shen \
     --gate 4 --dry-run --max-iter 8
   ```

   You see the exact banner from `bin/witness-loop.sh`, the pre-iteration Gate 4 runs (high-level verified-card walk driven by the live `(card-contract-shape)` descriptor + fidelity markers), and clean "Done in N iterations" output. No risk. This 1–2 minutes of observation tells you the backpressure (and the new tighter coupling) is working.

2. **Go live — remove `--dry-run`**  
   Satisfied that the cadence is correct and the Card is still faithful, you drop the safety flag for real development:

   ```bash
   witness loop codegen/emitters/card-emitter.js specs/ui/card-spec.shen \
     --gate 4 --max-iter 12
   ```

   Now every edit you make (or every autonomous step the agent proposes) is preceded by a fresh Gate 4 run. If you introduce a fidelity drift (wrong brand, missing semantic class, token mismatch), the loop immediately surfaces a `DESIGN SPEC VIOLATION` block with the full gate output and the exact remediation commands. The loop stops until you restore green.

   A 5–10 minute real session typically contains:
   - 2–3 quick manual edits to the emitter (adding an extra high-level contract reference in the TS types or CSS).
   - One or two gate failures that teach you the precise marker the assertion cares about.
   - Re-generation via `--emit` (or letting the loop continue after the fix).
   - Final clean exit with "Done in 5 iterations".

3. **Exit and seal the change**  
   After the loop reports success you run one last manual check (and optionally regenerate the artifacts):

   ```bash
   witness gates --emit --gate 4
   witness gates --gate 4
   ```

   Commit only when both the loop and the standalone gate are green. This is the "green-only" development experience the gates were built to provide.

The same pattern works for `--gate quick` (inner-loop speed) or `--gate full` (when you also touch `witness-core.shen` or load-order-trust).

### "I want to relax the title width contract — what exact commands do I run?"

**Scenario:** The design team relaxed the mobile title content constraint from 268 px to 280 px. This affects the canonical construction inside `card-design-fidelity`, the high-level walk inside the emitter, and the numbers baked into the generated `Card.tsx` factories.

**Protected reality:** The high-level path in `card-emitter.js` consumes the live `(card-contract-shape)` descriptor from Shen (no hand mirror) and walks values constructed exactly as in `card-design-fidelity`. Any drift is caught by Gate 4 before it can ship. The loop keeps the edit-sync-verify cycle fast and deterministic.

**Exact end-to-end commands (copy-paste, ~3 minutes to green):**

```bash
# 0. Baseline — everything must be green before you start
witness gates --gate 4

# 1. Locate the contract values (source of truth is the spec)
grep -n '268' specs/ui/properties/card-properties.shen

# 2. Relax the width in the formal design spec
#    (open specs/ui/properties/card-properties.shen in your editor)
#    Change the 268 in the `let Title = (mk-card-title ... 268 ...)` line
#    (and the matching desc line) inside the `card-design-fidelity` definition.
#    The fits? premise for the wider value is still trivially true.

# 3. Confirm the *spec change alone* does not break the theorems (Gate 1/2)
witness gates --quick
# (succeeds — widening a proven bound is safe)

# 4. The high-level walk (makeCanonical + contractShape) will pick up many
#    values from the live descriptor. The emitted factories in Card.tsx still
#    embed the concrete proven numbers, so re-emit after Gate 4 to refresh.

# 5. Observe what Gate 4 would have caught had the numbers drifted silently
witness gates --gate 4
# (structural markers still pass today; numeric drift detection can be added later.
#  The important thing is you were forced to look at the emitter after touching the spec.)

# 6. Re-emit the guarded artifacts (now reflecting the relaxed contract) under protection
witness gates --emit --gate 4
# Writes updated Card.tsx + card.css into codegen/emitters/generated/card/
# with the new 280 values and refreshed "proven at spec load time" comments.

# 7. Final gate (or do the whole dance inside the protected loop)
witness gates --gate 4

# 8. Recommended for any real session — start in dry-run, then go live
witness loop specs/ui/card-spec.shen codegen/emitters/card-emitter.js \
  specs/ui/properties/card-properties.shen \
  --gate 4 --dry-run --max-iter 6
# Watch every gate, confirm the cadence, then re-run without --dry-run.
```

**Outcome:** The title-width contract is now 280 px in the verified theorem, the emitter high-level path and the generated component are updated atomically, Gate 4 remains green, and the change is fully auditable. The same machinery that prevents user layout bugs prevented an inconsistent Card contract from shipping.

You can apply the identical discipline to:
- Adding a new field or obligation to `verified-card`
- Changing token values that appear in both `tokens.shen` and the emitter's token map
- Introducing a new `card-variant`
- Strengthening any of the three sub-theorems conjoined by `card-design-fidelity`

In every case the commands are: edit spec → `witness gates --emit --gate 4` (or the loop) → green. (High-level data is now driven from the contract shape where possible.)

### "I added a new slot in the Shen spec — what exactly changed in the emitter?" (the new tighter coupling in action)

**Scenario:** The design team adds an optional "media" area (image / icon / illustration) at the top of the Card. This is a non-trivial structural change:

- New `card-media-slot` datatype (with its own `maxW`/`font` or `strategy` + `fits?` premise if it carries a layout obligation).
- Extension of the `verified-card` product type, the canonical construction inside `card-design-fidelity`, and — crucially — the machine-readable `(card-contract-shape)` descriptor (new entry under `"slots"`, new row in `"instanceShape"`).
- The emitted `Card.tsx` + `card.css` must gain the corresponding Symbol brand, guarded factory, interface, semantic `card__media` class, and CSS rule.

**Protected reality with the `*-contract-shape` pattern:** The high-level emitter path (`getCardContractShape`, `parseContractShape`, `makeCanonicalVerifiedCard`, `walkVerifiedCard`, `extractHighLevelCardShape`, and the generators) is deliberately written to *consume the live shape*. Once you extend the descriptor in Shen, the walked `shape` object automatically contains the new media data (defaults, maxW, etc.) pulled straight from the spec. The emitter code only needs the *small mechanical delta* required to emit the new artifact pieces for a slot of that kind. The data, the numbers, the field names — they all come from `(card-contract-shape)` at runtime. This is the reduced-duplication promise delivered.

**Exact end-to-end commands (copy-paste, a few minutes to green):**

```bash
# 0. Everything green before you start
witness gates --gate 4

# 1. Edit the Shen source of truth (specs/ui/properties/card-properties.shen)
#    - Define the new slot datatype + any fits? sequent it needs.
#    - Update the canonical `card-design-fidelity` construction to include
#      the media value via its mk- factory (so the theorem still proves).
#    - Extend `card-contract-shape`: add the slot descriptor under "slots"
#      and the matching ("key" "media" "slot" "media") row under "instanceShape".
#    (The type checker will tell you immediately if a premise is un-discharged.)

# 2. Confirm the spec change is still proven (Gate 1/2 only)
witness gates --quick
# Succeeds — you grew the proven surface; the new premises are satisfied.

# 3. The high-level walk now sees the extended shape automatically
#    (the emitter calls (card-contract-shape) and the instanceShape loop
#     produces the media entry with zero hand-written JS data for it).

# 4. Mechanical emitter work (the only "new code" you write)
#    In codegen/emitters/card-emitter.js:
#    - Extend the shape consumers (if not already fully generic) with a
#      tiny branch for the media slot (ctor, defaults from slotDesc).
#    - generateCardTs: emit CARD_MEDIA_BRAND, CardMedia interface,
#      createCardMedia factory, and wire it into the VerifiedCard result.
#    - generateCardCss: add the .card__media rule (and variant bits if any).
#    - Add one new fidelityChecks entry for the media brand / class
#      (co-located with the emitter; Gate 4 will discover and run it).

# 5. Re-emit the artifacts and let Gate 4 + tsc protect the change
witness gates --emit --gate 4
witness gates --gate 4
# ✓ new fidelity marker present
# ✓ tsc --noEmit on the freshly emitted Card.tsx (now containing media)
# ✓ all previous checks still pass

# 6. Experience it inside the protected loop (recommended)
witness loop codegen/emitters/card-emitter.js specs/ui/card-spec.shen \
  specs/ui/properties/card-properties.shen \
  --gate 4 --dry-run --max-iter 5
# Watch Gate 4 run before every iteration. Drop --dry-run when ready.
```

**Outcome:** The new media slot is formally part of `verified-card` and proven by `card-design-fidelity` (Gate 1/2). The emitter high-level path picked up the extended contract shape with only the minimal emission logic added. Generated `Card.tsx` and `card.css` contain the new branded factory and semantic slot. Your new `fidelityChecks` entry (plus the existing ones) plus `tsc` are now enforced on every gate run and every loop iteration. You changed the authoritative Shen spec; the "dual maintenance" problem has been replaced by a shape descriptor + thin, auditable projector. Future slots, fields, or variants follow the identical low-tax pattern.

This is exactly how the new tighter coupling works in practice — and why the design-gates + `witness loop` experience now feels so much lighter when evolving the UI specification layer.

### Quick Reference Commands (Copy-Paste)

```bash
# 1. Quick health check of the Card contracts (most common)
witness gates --quick

# 2. Emitter-only iteration
witness gates --gate 4

# 3. Safe emitter regeneration + re-check
witness gates --emit --gate 4

# 4. Protected loop on just the Card spec (fast)
witness loop specs/ui/card-spec.shen --max-iter 10

# 5. Strict protected loop (full gate suite) while touching design + core
witness loop specs/ui/card-spec.shen specs/design/witness-core.shen --gate full --max-iter 5

# 6. Dry-run emitter tuning (see banner + every gate run, zero risk)
witness loop codegen/emitters/card-emitter.js specs/ui/card-spec.shen --gate 4 --dry-run --max-iter 20

# 7. Direct sh runner forms (useful in scripts/CI)
./bin/witness-design-gates.sh --quick
./bin/witness-loop.sh specs/ui/card-spec.shen --gate 4 --max-iter 3 --dry-run

# 8. See exactly what the agent will be told to do
witness loop specs/ui/card-spec.shen --dry-run --gate full
```

Combine with normal Witness usage:

```bash
witness render specs/ui/card-spec.shen --expr "(render-view)" --output /tmp/card.html
witness check --figma examples/card-design.json specs/ui/card-spec.shen
```

All of the above remain bit-for-bit compatible.

## 8. Living Documentation & Next Steps

- This file (`docs/design-gates-examples.md`) is the runnable cookbook. Update it whenever new gates, stronger emitter contracts, or additional verified components land.
- Architecture & gate rationale: `specs/design/README.md`
- Gate implementation: `bin/witness-design-gates.sh`
- Loop UX layer: `bin/witness-loop.sh`
- The contracts under protection: `specs/ui/properties/card-properties.shen` and `specs/ui/card-spec.shen`
- The emitter being guarded: `codegen/emitters/card-emitter.js` (and its generated/ artifacts)
- Agent integration (the enforcement point): `cli/agent.js` (the `<design-gates>` error path)

As the system grows (more UI components, full `verified-card` walker in the emitter, Yoga measurement of emitted output, stories, etc.), the same commands (`witness gates --gate 4`, `witness loop ... --gate full`) will automatically give you backpressure on the larger surface.

Run the gates. Feel the loop. Evolve safely.

---

**The Card is now a first-class, self-proving citizen of the Shen UI Specifications system.**

Everything above the line exists, is green under the gates, and is exercised by the exact commands shown in this document.