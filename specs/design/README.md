# Witness Design Specs & Gates (sb-style backpressure)

This directory contains **formal design specifications** for the Witness architecture itself, written in Shen using sequent-calculus datatypes and `: verified` premises.

The goal is self-hosting backpressure: as we evolve Witness (especially while building the larger "Shen UI Specifications" system for components, codegen emitters, semantic CSS, etc.), the project's own proof machinery prevents design drift.

## Philosophy (directly modeled on sb-shen-backpressure)

- Specs in `specs/design/*.shen` are the single source of truth for key invariants.
- The existing Witness proof system (`fits?`, `measure` via Pretext, `layout-proofs`, `trust` macro, two-phase check with `shen-cl` (preferred) or `shen-sbcl` + `tc+`, Figma structural diff, etc.) acts as the oracle.
- **Gates** (run via `npm run gates` or `bin/witness-design-gates.sh`) enforce fidelity:
  1. `tc+` on the design specs (Gate 1 — catches broken claims in the spec).
  2. Execution of property proofs / cross-checks against the implementation.
  3. Emitter fidelity + regeneration/TCB audit (Gates 3 & 4 — the codegen bridge itself is protected).
  4. Numeric range analysis over the emitted TypeScript (Gate 5 — freerange checks the arithmetic that Gate 4 only checks the shape of; see [Gate 5](#gate-5-numeric-range-analysis-freerange) below).
- Regeneration + host "build" (in this case the proof run + CI) provides the enforcement, exactly like `shengen` + compiler in the sb pattern.
- The LLM / human proposes changes; the gates + proof system say "no" if fidelity is lost.

## Current Specs

- `load-order-trust.shen` — TCB ordering contract (the sb-style "trust gate" for the proof system itself):
  - `witness-load-sequence` datatype that models the exact required bootstrap order
    (proofs → layout → errors → tea → tailwind → dom → ssr → responsive → props → figma → **trust last** → `(tc +)`).
  - Three property proofs (typed `define`s) whose `tc+` acceptance is the theorem:
    - `trust-macro-installed-before-any-user-proven-text`
    - `current-witness-shen-7-26-satisfies-load-contract` (cites witness.shen:7-26 and trust.shen:25 line-by-line)
    - `no-bypass-of-trust-via-data-list-construction` (defense-in-depth, analogous to sb "module-private" + factory pattern)

- `witness-core.shen` — Core architecture contracts (loads only the SBCL-pure modules proofs+errors+tailwind so it passes the design gates' tc+):
  - `witness-proof-tier` datatype (clean three-tier model using only available oracles).
  - `frame-props-contract` — precise 14-field model + merging rules. Cites layout.shen:8-16 (mk-props, getters, default-props) and tailwind.shen:110-132 (tw-merge last-wins reducer, the 14 explicit fields).
  - `to-textura-fidelity-contract` — proven-cell vs handled-cell lowering, intrinsic vs strategy-aware. Cites layout.shen:99-155 (the full define + the long whitespace-bug comment at 112-129) and the three helpers (63-86).
  - `responsive-semantics-contract` — each `[at W Tree]` branch is an independent proof obligation. Cites responsive.shen:3-7 (the prose) and :62-69, :116-122 (the per-branch solve).
  - `renderer-contract` — ssr/dom/future emitters must honour the injected overflow strategy.
  - Five meaningful property proofs (typed `define` functions):
    - `tier-1-proof-requires-fits-and-trust-gate`
    - `tw-merge-produces-valid-14-field-frame-props`
    - `to-textura-fidelity-for-proven-and-handled`
    - `responsive-branches-carry-independent-obligations`
    - `all-renderers-respect-overflow-strategy`
  - Top-level `witness-core-design-fidelity` claim that conjoins several of the above (executed by Gate 2).

All citations are to real file:line locations in the live shen/ tree. The design specs are the single source of truth for these invariants.

## Running the Gates

```bash
npm run gates
# or
./bin/witness-design-gates.sh
```

> **🚀 Try the protected Card workflow in 60 seconds**
>
> ```bash
> bash docs/card-protected-demo.sh
> ```
>
> This tiny runnable tour exercises Gate 4 (high-level `*-contract-shape`-driven emitter fidelity, `fidelityChecks[]`, `tsc --noEmit`) and the rich `witness loop --gate 4 --dry-run` banner + safety in one minute. Perfect for demos, onboarding, or a quick "feel the new tighter coupling + backpressure" check.
>
> Full recipes, violation UX, theorem walkthroughs, and the "relax the title width" end-to-end flow live in the companion cookbook:
> - [`docs/design-gates-examples.md`](docs/design-gates-examples.md)

**For a cookbook of runnable, copy-pasteable examples focused on the protected Card workflow (targeted gates, `witness loop` with all `--gate` modes, `--emit` regeneration, dry-run safety, and the exact DESIGN SPEC VIOLATION UX), see:**

- `docs/design-gates-examples.md`

The gate runner re-uses the project's excellent two-phase checker (`bin/witness-check.sh`):
- Phase 1: Node + Pretext measures all text in the design specs.
- Phase 2: ShenScript in-process (`cli/shen-check.js`) with `tc+` verifies all `: verified` premises — ~1s for the design specs, no native binary needed. `WITNESS_SHEN_ENGINE=native` runs `shen-cl` / `shen-sbcl` instead (an independent kernel, useful as a cross-check).

Any violation becomes a hard failure (type error or overflow) before you can ship the change.

### Gate Structure (sb-style, modeled on `.claude/commands/sb/loop.md` + TCB audit)

- **Gate 1: tc+ Design Specs** — Runs `witness-check.sh` on every `*.shen` in `specs/design/`. Catches broken datatypes, unprovable `:verified` premises, or invariants that no longer hold in the live implementation. (Now includes the Card spike contracts via `witness-core.shen` loading `specs/ui/properties/card-properties.shen`.)
- **Gate 2: Property Proofs** — The theorems (`tier-1-always-requires-literal`, `witness-core-design-fidelity`, `renderer-contract`, `card-design-fidelity`, etc.) are proven by the successful `tc+` of their defining file. The type checker *is* the proof engine.
- **Gate 3: Regeneration / TCB Audit** — SHA-256 of the core TCB (`shen/witness.shen`, `trust.shen`, `layout.shen`, `proofs.shen`, `witness-sbcl.shen` (loader for `shen-cl` or `shen-sbcl`), renderers `ssr.shen`/`dom.shen`, `bin/witness-check.sh`, `cli/measure.js`) vs the committed manifest embedded in the runner. Fails on any drift. Directly analogous to sb-shen-backpressure's Gate 5 `tcb-audit`.
- **Gate 4: Emitter Fidelity** — Auto-discovers `codegen/emitters/*-emitter.js`, runs each emitter on its spec/contracts (high-level verified-* walk), enforces the checks declared in the emitter's `fidelityChecks[]` export (brands, factories, tokens, semantic CSS, richer targets, etc.), and (new) runs `tsc --noEmit` (shim + temp tsconfig) on every emitted `*.tsx`. The Card emitter (`card-emitter.js`) is the seed; adding components is now turnkey (`witness spec-init`) + the tiny generic loader + the convention (no edits to any gate runner). The new tools + Gate 4 auto-discovery make the whole experience one-command for 80 % of the work. Protects the codegen bridge itself, stronger than before.
- **Gate 5: Numeric Range Analysis** — Runs `fr` (freerange) over the TypeScript covered by the root `tsconfig.json`, principally the generated `codegen/emitters/generated/card/card-layout.ts`. Where Gate 4 checks that the emitter's *shape* (brands, tokens, factories) is faithful, Gate 5 checks that the *arithmetic* inside the generated numeric helpers can't violate the `console.assert` preconditions projected from the same Shen obligations. See [below](#gate-5-numeric-range-analysis-freerange) for the full write-up.

**CLI options** (portable, works on macOS bash 3.2 + Linux):
- `--gate 1` (or `tc`, `design`), `--gate 2` (`proofs`), `--gate 3` (`audit`, `tcb`, `regen`), `--gate 4` (`emit`, `emitter`, `codegen`), `--gate 5` (`fr`, `freerange`, `numeric`, `range`)
- `--quick` — Gates 1+2 only (skip TCB audit, emitter, and freerange; ideal for inner loop)
- `--full` — All five gates (default)
- `--emit` — For Gate 4: also write the emitted artifacts to `codegen/emitters/generated/card/`
- `--update-manifest` — After intentional core changes, prints the new `FIDELITY_MANIFEST` here-doc to paste into the script
- Colored output (auto off in CI / non-tty), per-gate timing, actionable failure messages pointing to this README.

Example individual gate:
```bash
./bin/witness-design-gates.sh --gate audit
```

### Gate 4: Emitter Fidelity (Live)

Gate 4 is fully implemented and passing (`bin/witness-design-gates.sh` and `npm run gates` run it by default).

- Invokes the real minimal `shen-witness` emitter (`codegen/emitters/card-emitter.js`).
- Loads `specs/ui/card-spec.shen` (which exercises tokens + render-view + the high-level contracts via the design path).
- Emits branded `Card.tsx` (Symbol brands + guarded factories + `VerifiedCard`) and semantic `card.css` (token vars, `.card__*` slots, modern nesting/owl + container queries).
- Fidelity assertions verify the key markers from the Card contract; `--emit` writes the artifacts for inspection under `codegen/emitters/generated/card/`.

The high-level `verified-card` / slot datatypes + `card-design-fidelity` theorems live in `specs/ui/properties/card-properties.shen` (loaded by `witness-core.shen` for Gate 1/2; card-spec.shen keeps low-level render compat).

A key step toward eliminating dual maintenance: `card-properties.shen` now exports `(card-contract-shape)`, which the emitter (`card-emitter.js`) calls at runtime. The high-level path in the emitter now consumes the live contract shape from Shen instead of maintaining a complete hand-written JS mirror of the datatype. Gate 4 enforces this.

This is the first concrete instance of the self-hosting codegen bridge: the same backpressure that makes "layout overflow a type error" for users now makes "emitter drift a gate failure" for the generator.

Current state: Gate 4 is live and strong (auto-discovery, per-emitter `fidelityChecks[]`, real `tsc --noEmit`). Next steps: deeper emitter walker over live `verified-card` values, Yoga + Figma verification inside Gate 4, more output targets, and CI hardening. (See "To strengthen backpressure further" below.)

### Gate 5: Numeric Range Analysis (freerange)

Gate 4 answers "does the emitter faithfully project the contract shape?" — brands, tokens, factories, semantic CSS. It has nothing to say about whether the *arithmetic* inside a generated numeric helper can misbehave for some input the type checker never considered. That's a real gap: `card-properties.shen` proves obligations like "divide the available width by `actionCount`" hold *given a contract-shape value*, but the moment that math becomes plain TypeScript, Shen's proof no longer runs over it. Gate 5 closes that gap with [freerange](https://github.com/chenglou/freerange) (`@chenglou/freerange`), Cheng Lou's static numeric-range analyzer.

**What it runs.** `./node_modules/.bin/fr`, invoked from the repo root so it picks up the root `tsconfig.json` (`"strict": true`, `include` covering `codegen/emitters/generated/**/*` and `codegen/ts/**/*`, `exclude` on `codegen/ts/demo/**`). freerange is a superset of `tsc`: it reports ordinary TypeScript errors first, then its own numeric findings. It tracks min/max/integer-ness/NaN/Infinity through every named top-level function, and reads a function's *leading* `console.assert(...)` calls as the caller's declared requirements — checked against every call site in the same file.

**How to run it:**
```bash
./bin/witness-design-gates.sh --gate 5
```
(aliases: `fr`, `freerange`, `numeric`, `range`). Gate 5 is part of `--full` (the default) and skipped by `--quick`, alongside Gates 3 and 4.

**What failure means.** A non-zero exit from `fr` means freerange found a call site where a declared numeric precondition — a `console.assert` the emitter projected straight from a Shen premise — is definitely or possibly false. Concretely: a caller passing `actionCount = 0` into `cardActionSlotWidth`, which the Shen obligation `actionCount >= 1` was supposed to rule out. A Gate 5 failure means the *emitted* arithmetic has drifted from what Shen proved — either the emitter regenerated stale, or a hand-written call site in `codegen/ts/**` violates the contract. Fix by regenerating (`./bin/witness-design-gates.sh --emit --gate 4`) or correcting the offending call; never by deleting the assert to make the gate pass.

**Why the gate isn't vacuous.** Alongside the real generated module, `codegen/ts/demo/` carries a deliberately unsafe fixture (e.g. a call that divides by an `actionCount` of `0`) and a clean positive fixture exercising the same functions with in-range values. Both are excluded from the main tsconfig `include` (negative fixtures that fail-by-design can't sit in a `strict: true` build) and checked with targeted `fr <path>` invocations instead: the bad fixture is run *expecting* a finding, and Gate 5 itself fails if freerange stays silent on it. That's what proves the gate is actually checking something rather than passing because there was nothing to check.

**The obligation → `console.assert` projection convention.** New component emitters that want Gate 5 coverage should follow the pattern established for Card layout math:
- Emit one self-contained TypeScript module of **named, top-level, synchronous** functions doing the component's numeric layout arithmetic — freerange's supported subset.
- **Inline every constant the arithmetic touches** (`const SPACE_4 = 16;` projected from `token_values`, not imported) — freerange does not analyze across file boundaries (see limitation (a) below), so an imported constant is invisible to it.
- For each Shen obligation discharged over that arithmetic, emit a **leading** `console.assert(...)` expressing it as a precondition — direct calls only (no aliasing), literal / object-path / `.length` comparands, complex conditions extracted to a variable first. Put the caller's requirements first; anything after the leading run of asserts must be independently provable by freerange or it errors.
- Trail each assert with a comment naming the Shen theorem or obligation it came from, so drift between the spec and the generated precondition is legible on sight.
- Give the module **in-file call sites** (a positive demo consumer, at minimum) — an emitted function with no call site in the same file is never actually checked.
- Extend the emitter's `fidelityChecks[]` so that every token/obligation the layout module depends on is asserted to appear in the generated file — the same convention Gate 4 already uses for `Card.tsx`, now applied to the numeric module, so a Shen value changing without regeneration fails Gate 4, not just Gate 5.

```ts
// GENERATED — obligation: card-variants-respect-minimum-content-width
const SPACE_4 = 16;           // token_values.space-4, inlined (no import)
const MOBILE_W = 268;         // variant_widths.mobile

export function cardContentWidth(variantWidth: number): number {
  console.assert(variantWidth >= MOBILE_W);   // ← projected Shen premise
  return variantWidth - 2 * SPACE_4;
}
```

**Two honest limitations, worth keeping in view every time this bridge comes up:**
- **(a) freerange v0.0.2 does not enforce contracts across file imports.** The contracted function and its call sites must be in the same file — an imported function is simply not analyzed, and an imported constant only resolves if it's a numeric literal. This is why the projection convention above insists on self-contained modules and in-file call sites; without that, Gate 5 would be silently checking nothing. A fork adding cross-file propagation is being explored, but nothing in this repo should assume it exists yet.
- **(b) freerange requires `strictNullChecks` and has no JSON output or programmatic API in v0.0.2.** The root `tsconfig.json` therefore has to run with `"strict": true` for `fr` to run at all. The audit bridge (`node cli/freerange-audit.js <path...> [--json] [--emit-shen <outfile>]`, feeding `specs/generated/numeric-bounds.shen` — the oracle for the `(bounded N)` sequent) has to scrape freerange's human-readable `--audit` text output rather than parse structured data, and it is deliberately non-fatal: unrecognized lines are collected, never fatal, and it always exits 0. A future freerange release changing its output format degrades the bridge to "no facts learned," not a broken build.

### Adding More Backpressure

1. Add `*.shen` under `specs/design/` with new datatypes + `:verified` premises.
2. Extend `witness-design-gates.sh` with more gates or a `properties.shen` execution step.
3. Wire `npm run gates` into CI and `cli/agent.js` (the `/witness` agent loop) exactly as `/sb:loop` uses the five gates.

## Adding More Backpressure (as we build the UI spec layer)

1. Add new `*.shen` files in this directory for higher-level contracts (e.g., `ui-component-contract.shen`, `codegen-emitter-fidelity.shen`).
2. Write property proofs (`define my-fidelity-theorem {sig}`) whose `tc+` acceptance is the proof.
3. Extend `witness-design-gates.sh` with additional gates (e.g., diff of generated Card.tsx against a golden layout tree, regeneration audit of any emitted artifacts).
4. Wire the gates into CI and the `witness agent` loop (so the agent must satisfy the design specs, not just user layout proofs).

**The Card spike is already live and protected** (specs/ui/card-spec.shen + tokens.shen, loaded from witness-core.shen). Its `card-design-fidelity-proof` (which executes real `verify-figma` + layout obligations) is part of Gate 1/2.

This creates a beautiful recursive system: the tool that gives users "layout overflow is a type error" now gives its own developers the same guarantee about the tool's design — starting with the canonical Card example.

## Extending the system

**Next-3 goal achieved**: Adding a protected component is now genuinely turnkey.

The modern pattern uses the tighter `*-contract-shape` coupling (Shen single source of truth) + two tiny new tools:

- **Tiny generic component loader** (`bin/witness-component-loader.js`): auto-discovers every `specs/ui/properties/*-properties.shen` and keeps the load list inside `specs/design/witness-core.shen` in a managed block. Gate 1/2 therefore cover new components with **zero manual wiring**.
- **One-command scaffolder** (`witness spec-init <Name>` / `bin/witness-spec-init.js`): given a component name, emits a correct skeleton `*-properties.shen` (datatypes + verified-lift + design-fidelity theorem) + a basic but *self-consistent* `*-emitter.js` (exports `emit()` + `fidelityChecks[]` that Gate 4 will auto-discover and that pass on the emitted artifacts). It then calls the loader so everything is wired.

" `witness spec-init Button` " gives you ~80 % of the boilerplate and leaves the gates in a runnable state.

### One-command turnkey flow (the recommended path)
```bash
witness spec-init MyComponent     # or "witness-spec-init MyComponent"
# (creates properties + emitter, auto-updates witness-core loads via the tiny loader)

witness gates --quick             # Gate 1/2: tc+ proves your new *-design-fidelity theorem
witness gates --gate 4            # Gate 4: auto-discovers emitter + fidelityChecks + tsc on .tsx
witness gates --emit --gate 4     # also materialises generated/ artifacts
```

Then iterate:
- Flesh out the real verified-* datatypes, obligations, and the construction theorem in the properties file.
- Evolve the emitter to drive from the live `(<name>-contract-shape)` (copy the high-level walk pattern from `card-emitter.js`).
- (Optional) Add a thin `specs/ui/<name>-spec.shen` for 100% `witness render` compat.

All subsequent `witness gates`, `witness loop --gate 4`, and `npm run gates` pick up the new component with **no further changes** to any runner or manifest.

### Why the coupling + tooling (high-level overview)
- The authoritative contract (verified datatypes, slots with `fits?` premises, variants, tokens, obligations, `instanceShape` for canonical construction) lives in Shen as a narrow, machine-readable descriptor exported by `(<name>-contract-shape)`.
- The emitter calls it at runtime, parses once, and drives high-level `makeCanonical*` + walking from the live data. No complete hand-written JS mirror.
- `fidelityChecks[]` live next to the emitter. Gate 4 auto-discovers every non-stub `*-emitter.js`, runs `emit()`, executes every check, and `tsc`s any `.tsx`.
- The two new tools (loader + scaffolder) removed the last hand steps (writing two files + editing a load list).

### Step-by-step (Card + the new tools as living reference)
1. **One command (the new 80 % starting point)**: Run `witness spec-init MyComponent`. This creates:
   - `specs/ui/properties/my-component-properties.shen` (skeleton with variants, verified-* datatype, obligation lift, and a `* -design-fidelity` theorem ready for tc+).
   - `codegen/emitters/my-component-emitter.js` (basic `emit()` + `fidelityChecks[]` that are self-consistent — Gate 4 will be green immediately).
   It then calls the tiny generic loader, so `witness-core.shen` is updated with the new load line. No hand-written files, no manifest edits.

2. **Shen contracts (single source of truth — the interesting work)**: Open the generated properties file. Replace the skeleton datatypes with your real slots (each carrying `(fits? ...):verified` or other obligations), the `verified-<name>` product, factories, and a rich `<name>-design-fidelity` theorem that constructs a canonical instance and discharges every premise. Export `(<name>-contract-shape)`. The loader already wired it; Gate 1/2 now prove it on every run.

3. **Thin low-level compat (optional, for full runtime parity)**: If you need `witness render` / existing tests to keep working exactly, add `specs/ui/<name>-spec.shen` with the legacy `render-view` path (high-level lives alongside).

4. **Emitter evolution (the remaining 20 %)**: The generated stub is deliberately minimal but already protected. Evolve it (following `card-emitter.js`):
   - Boot + load, call the live `(<name>-contract-shape)`.
   - Implement the high-level `makeCanonicalVerified*` + walk helpers driven purely by the shape.
   - Emit the full branded `*.tsx` + semantic CSS + stories + fixture.
   - Extend `fidelityChecks[]` with your new obligations. (Gate 4 needs zero changes.)

5. **Zero-wiring surface + verify**: Everything is already discovered. Run `witness gates --quick`, `--gate 4`, `--emit --gate 4`. The `witness loop`, `npm run gates`, and `witness codegen` all see it. Gate 4 will run your `fidelityChecks` and `tsc` your emitted TS. Polish docs / examples and you are done.

The Card spike (`specs/ui/card-spec.shen` + `card-properties.shen` with its `card-contract-shape`, the full high-level `card-emitter.js` + its `fidelityChecks`, the generated tree, and the loader/scaffolder tooling) is the complete reference implementation. The combination of contract-shape + tiny loader + scaffolder + auto-discovering Gate 4 makes adding a protected component a fast, low-risk, fully backpressured operation. You cannot drift from the proven contracts.

This is exactly the reduced-duplication, tighter-coupling reality the design now delivers.

## Relationship to the Big Vision

The design document at `/tmp/grok-design-doc-56d5ddf2.md` (the "Shen UI Specifications for Witness") describes the user-facing feature (formal component contracts + codegen for guarded React/Astro components + semantic CSS).

The Card spike in `specs/ui/card-spec.shen` is the concrete bootstrap of that vision. It is already under the design gates via the load in `witness-core.shen`. The real emitter (`codegen/emitters/card-emitter.js`) + Gate 4 produce the guarded branded components + semantic CSS from the live contracts. The historical sketch lives in `card-emitter-stub.js` for provenance only.

This `specs/design/` system is the **meta** layer that will protect the faithful implementation of that feature. When we land PRs 4–6 (the `shen-witness` codegen and semantic CSS emitter), we will add design specs that prove "the emitted component produces a Yoga tree that satisfies the `verified-card` contract within Figma tolerance."

## See Also

- `docs/design-gates-examples.md` — runnable cookbook of protected Card workflows (`witness gates --quick`, `witness loop --gate 4 --dry-run`, emitter regeneration, DESIGN SPEC VIOLATION examples, etc.)
- `bin/witness-design-gates.sh` — the gate runner (sb-style)
- `bin/witness-loop.sh` — the Ralph-style protected loop launcher (rich banner + per-iteration enforcement)
- `bin/witness-check.sh` — the underlying two-phase proof engine (reused here)
- The full sb-shen-backpressure pattern in `.claude/skills/sb-shen-backpressure/SKILL.md` and `.claude/commands/sb/`
- `WITNESS_LEAN.md` and the main design doc for the long-term vision

Start small. Add one invariant. Run the gates. Feel the backpressure. Then scale.