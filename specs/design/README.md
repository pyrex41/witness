# Witness Design Specs & Gates (sb-style backpressure)

This directory contains **formal design specifications** for the Witness architecture itself, written in Shen using sequent-calculus datatypes and `: verified` premises.

The goal is self-hosting backpressure: as we evolve Witness (especially while building the larger "Shen UI Specifications" system for components, codegen emitters, semantic CSS, etc.), the project's own proof machinery prevents design drift.

## Philosophy (directly modeled on sb-shen-backpressure)

- Specs in `specs/design/*.shen` are the single source of truth for key invariants.
- The existing Witness proof system (`fits?`, `measure` via Pretext, `layout-proofs`, `trust` macro, two-phase check with shen-sbcl `tc+`, Figma structural diff, etc.) acts as the oracle.
- **Gates** (run via `npm run gates` or `bin/witness-design-gates.sh`) enforce fidelity:
  1. `tc+` on the design specs (Gate 1 — catches broken claims in the spec).
  2. Execution of property proofs / cross-checks against the implementation.
  3. (Future) Emitter fidelity, regeneration/TCB audit, derive-style equivalence for the UI spec layer.
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
> This tiny runnable tour exercises Gate 4 (emitter fidelity on the high-level `verified-card` contracts) and the `witness loop --gate 4 --dry-run` banner + safety in one minute. Perfect for demos, onboarding, or a quick "feel the backpressure" check.
>
> Full recipes, violation UX, theorem walkthroughs, and the "relax the title width" end-to-end flow live in the companion cookbook:
> - [`docs/design-gates-examples.md`](docs/design-gates-examples.md)

**For a cookbook of runnable, copy-pasteable examples focused on the protected Card workflow (targeted gates, `witness loop` with all `--gate` modes, `--emit` regeneration, dry-run safety, and the exact DESIGN SPEC VIOLATION UX), see:**

- `docs/design-gates-examples.md`

The gate runner re-uses the project's excellent two-phase checker (`bin/witness-check.sh`):
- Phase 1: Node + Pretext measures all text in the design specs.
- Phase 2: shen-sbcl with `tc+` verifies all `: verified` premises.

Any violation becomes a hard failure (type error or overflow) before you can ship the change.

### Gate Structure (sb-style, modeled on `.claude/commands/sb/loop.md` + TCB audit)

- **Gate 1: tc+ Design Specs** — Runs `witness-check.sh` on every `*.shen` in `specs/design/`. Catches broken datatypes, unprovable `:verified` premises, or invariants that no longer hold in the live implementation. (Now includes the Card spike contracts via `witness-core.shen` loading `specs/ui/properties/card-properties.shen`.)
- **Gate 2: Property Proofs** — The theorems (`tier-1-always-requires-literal`, `witness-core-design-fidelity`, `renderer-contract`, `card-design-fidelity`, etc.) are proven by the successful `tc+` of their defining file. The type checker *is* the proof engine.
- **Gate 3: Regeneration / TCB Audit** — SHA-256 of the core TCB (`shen/witness.shen`, `trust.shen`, `layout.shen`, `proofs.shen`, `witness-sbcl.shen`, renderers `ssr.shen`/`dom.shen`, `bin/witness-check.sh`, `cli/measure.js`) vs the committed manifest embedded in the runner. Fails on any drift. Directly analogous to sb-shen-backpressure's Gate 5 `tcb-audit`.
- **Gate 4: Emitter Fidelity** — Runs the real `shen-witness` emitter (`codegen/emitters/card-emitter.js`) on the Card spec (`specs/ui/card-spec.shen`). Asserts that emitted `Card.tsx` + `card.css` contain the expected brands, factories, token vars, semantic classes, owl/container-query patterns. Protects the codegen bridge itself.

**CLI options** (portable, works on macOS bash 3.2 + Linux):
- `--gate 1` (or `tc`, `design`), `--gate 2` (`proofs`), `--gate 3` (`audit`, `tcb`, `regen`), `--gate 4` (`emit`, `emitter`, `codegen`)
- `--quick` — Gates 1+2 only (skip TCB audit + emitter; ideal for inner loop)
- `--full` — All four gates (default)
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

Future work: strengthen the walker to traverse the full `verified-card` datatype, add Yoga-tree measurement of emitted output against Figma, expand to stories/tests, etc. (See "To strengthen backpressure further" below.)

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

To add support for a new UI component (e.g. `Button` or `Modal`) under the same design backpressure + official codegen surface:

1. **Component spec**: Create `specs/ui/<name>-spec.shen` (and/or `specs/ui/properties/<name>-properties.shen`). Define the `verified-<name>` datatype (slots, variants, tokens), the `mk-*` factories, and a `<name>-design-fidelity` theorem that constructs an instance and discharges all `:verified` premises (layout overflow, figma match, responsive, renderer contract, etc.). Load the properties file from `specs/design/witness-core.shen` so it participates in Gate 1 (`tc+`) and Gate 2 (property proofs).

2. **Wire the gates**: The existing Gate 1/2 runner (via witness-core load + witness-check.sh) will automatically cover the new spec. Optionally extend `bin/witness-design-gates.sh` (run_gate_4 or a new gate) with fidelity assertions for the new component.

3. **Emitter**: Add (or generalize) an emitter under `codegen/emitters/<name>-emitter.js` that re-uses `boot.js`, loads the spec (under tc- for runtime), asks the live contracts for the shape via the component's `*-contract-shape` descriptor (or falls back to render-view), and emits the branded `<Name>.tsx` (Symbol brands + create* guarded factories) + semantic `<name>.css`. This is the current mechanism for tight Shen↔JS coupling with no hand-maintained shape duplication. Export an `emit({writeToDisk})` function for Gate use + direct calls.

4. **Official surface + CI**: `witness codegen --emit` (via the thin delegation in cli/check.js) and `npm run design-gates:full` / the GitHub workflow will pick it up once wired in Gate 4. Update HELP text and this README. Add a fidelity check similar to the Card markers.

5. **Tests/docs**: Add examples in `docs/`, ensure `witness render` still works for compat, run the gates locally before PR.

The Card implementation (`specs/ui/card-spec.shen`, `card-emitter.js`, Gate 4, `witness codegen`) is the reference. Start by copying its pattern; the sb-style backpressure guarantees you cannot drift the new spec from the emitter or core contracts.

## Relationship to the Big Vision

The design document at `/tmp/grok-design-doc-56d5ddf2.md` (the "Shen UI Specifications for Witness") describes the user-facing feature (formal component contracts + codegen for guarded React/Astro components + semantic CSS).

The Card spike in `specs/ui/card-spec.shen` is the concrete bootstrap of that vision (PR 1–2 in the plan). It is already under the design gates via the load in `witness-core.shen`. The emitter stub in `codegen/emitters/card-emitter-stub.js` documents the path to the generated branded components + semantic CSS.

This `specs/design/` system is the **meta** layer that will protect the faithful implementation of that feature. When we land PRs 4–6 (the `shen-witness` codegen and semantic CSS emitter), we will add design specs that prove "the emitted component produces a Yoga tree that satisfies the `verified-card` contract within Figma tolerance."

## See Also

- `docs/design-gates-examples.md` — runnable cookbook of protected Card workflows (`witness gates --quick`, `witness loop --gate 4 --dry-run`, emitter regeneration, DESIGN SPEC VIOLATION examples, etc.)
- `bin/witness-design-gates.sh` — the gate runner (sb-style)
- `bin/witness-loop.sh` — the Ralph-style protected loop launcher (rich banner + per-iteration enforcement)
- `bin/witness-check.sh` — the underlying two-phase proof engine (reused here)
- The full sb-shen-backpressure pattern in `.claude/skills/sb-shen-backpressure/SKILL.md` and `.claude/commands/sb/`
- `WITNESS_LEAN.md` and the main design doc for the long-term vision

Start small. Add one invariant. Run the gates. Feel the backpressure. Then scale.