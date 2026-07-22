# Witness

> A Shen extension that makes layout overflow a compile-time type error.

---

## Quick start

```bash
git clone https://github.com/pyrex41/witness
cd witness && npm install

# Tier 1: static text proofs (fails on overflow)
node cli/check.js dev examples/card.shen
node cli/check.js dev examples/card-overflow.shen

# Render layout to static HTML
node cli/check.js render examples/card.shen --output card.html

# Tier 3: diff computed layout against a Figma export
node cli/check.js check --figma examples/card-design.json examples/card.shen

# Agent: parse structured overflow errors and auto-widen containers
node cli/agent.js examples/card-overflow.shen

# Tier 2: numeric bounds on the layout math downstream of the proofs
./node_modules/.bin/fr examples/ts/grid-layout.ts          # clean — 7/7 analyzed
./node_modules/.bin/fr examples/ts/grid-layout-broken.ts   # one range error, caught
bash docs/freerange-demo.sh                                # the 60-second tour
```

See [`docs/DEMO.md`](docs/DEMO.md) for the extended pitch with screenshots and [`WITNESS_LEAN.md`](WITNESS_LEAN.md) for the spec and roadmap.

---

## What's implemented today

| Capability | Status |
|---|---|
| `assert-fits` load-time proof (Tier 1) | works |
| `proven-text` — literal-only, enforced at read time by `trust.shen` macro | works |
| `prop-spec` — component-boundary bounds (`max-chars`, `min-chars`, `max-width`) enforced before render (Tier 2) | works |
| `handled-text` — visual fail-soft via CSS `ellipsis` / `clip` / `visible` (Tier 3) | works |
| Figma structural diff, library + CLI | **WIP** — works on hand-crafted fixtures; [not yet validated](#figma-status) against real REST API exports |
| SSR renderer → static HTML | works |
| Structured error reports with fix suggestions (`dev` / `check` / `agent`) | works |
| `witness agent` widen-fix loop | works — **note it rewrites your `.shen` files in place**, with no `--dry-run` |
| DOM runtime (`run-app`, TEA) | library exists; browser harness TBD |

---

## The core idea

Layout bugs are discovered at the worst possible time: in the browser, after deployment, by a user whose screen is slightly narrower than yours. A button label wraps. A price overflows its box. A translated string destroys a card.

Witness makes these impossible to ship. If text doesn't fit its container, **the program doesn't compile**.

```shen
(datatype layout-proofs
    if (<= (measure Text Font) MaxW)
    Text : string;  Font : string;  MaxW : number;
  ______________________________________________
    [proven-cell Text Font MaxW] : safe-text;)
```

If `measure` returns 147px and `MaxW` is 96px, you get a type error — not a runtime bug.

The `if` matters more than it looks. Shen **evaluates** an `if` side condition
during type checking, so `(measure Text Font)` really runs the ruler. A premise
written `(fits? Text Font MaxW) : verified;` — or as a bare expression, which is
sugar for the same thing — is an assertion the checker never evaluates and
nothing can discharge, so the rule fires for no input at all. This codebase had
it the second way for most of its life; see `test/tc-enforcement.test.js`, which
pins the behaviour at the exact boundary (text measuring 31.91px: `maxW` 32
compiles, 31 does not).

---

## The mental model

Think of layout proofs the way you think of tests — but mathematically exhaustive instead of example-based, and enforced at compile time instead of run time:

| Tier | When | What | Status |
|------|------|------|--------|
| 1: Always | Load / type-check time | Static text fits static containers | **works** — `if (<= (measure ...) MaxW)` side conditions + `assert-fits` |
| 2: Build | CI / pre-commit | Bounds at the component boundary; numeric ranges in generated TS | **partly** — `prop-spec` works and Gate 5 checks numeric ranges; bounded-*string* worst-case is not wired |
| 3: Comprehensive | Nightly / pre-release | Figma verification, i18n sweep | **WIP** — see the Figma status note below; no i18n sweep exists |
| 4: Runtime | Production (opt-in) | User-generated content, dynamic fonts | **by construction** — `handled-text` truncation; no runtime prover ships |

The per-tier costs previously quoted here (~1ms / ~50ms / ~500ms) were design
targets, not measurements, so they have been removed rather than dressed up.
What is measured: the full five-gate suite runs in ~12s, of which Gate 1's
type-checking pass is ~2s.

Proofs **erase after compilation** — just like TypeScript types after `tsc`. Zero proof machinery ships to production. What survives is plain JS calling Textura for layout and DOM for rendering.

---

## The stack

```
Shen kernel          — types, Prolog, defcc, macros
ShenScript           — runs Shen on JS, 60KB, 50ms startup
Textura              — Pretext + Yoga: full DOM-free layout
  ├─ Pretext         — pure text measurement, 0.09ms/500 texts
  └─ Yoga WASM       — Facebook's flexbox engine (React Native)
freerange            — static numeric range analyzer, checks generated TS arithmetic
──────────────────────────────────────────────────────────────
Witness              — ~1.7k lines Shen + ~2.4k lines JS (runtime + CLI)
```

Everything above the line exists and works. Witness itself is ~1,660 lines of Shen (proofs, layout bridge, errors, figma diff, SSR + DOM renderers, tailwind macro, TEA runtime) plus ~2,430 lines of JS (ShenScript/Textura interop, the measurement oracle, CLI commands, agent loop), ~1,300 lines of codegen emitter, and ~1,900 lines of gate tooling.

### Why each piece matters

**Shen** is a Lisp-family language with a sequent-calculus type system. Unlike Hindley-Milner, Shen's `datatype` declarations are theorems — premises above a horizontal line must be proven before a type is granted. Crucially, those premises can call pure functions as side conditions. Layout measurement is pure math. So the type checker can *run the ruler* at compile time.

**Pretext** is Cheng Lou's canvas-based text measurement library. It uses `measureText` + `Intl.Segmenter` for near-perfect fidelity to browser layout — handling `white-space:normal`, `overflow-wrap:break-word`, bidi, CJK, and emoji. It achieves exceptional accuracy across engines at 0.09ms per 500 texts. No reflows, no DOM.

**Textura** combines Pretext with Yoga (Meta's battle-tested flexbox engine from React Native), exposing a single `computeLayout(tree)` call that returns pure `{x, y, w, h}` output. It replaced a previous ~300-line hand-rolled flex solver — deleting the riskiest piece of custom code and replacing it with battle-tested infrastructure.

**freerange** is, like Pretext, Cheng Lou's work: a static numeric-range analyzer for TypeScript. It tracks min/max/integer-ness/NaN/Infinity for every number through named top-level functions, and reads a function's leading `console.assert(...)` calls as the caller's requirements — checking every call site against them. There's a pleasing symmetry in that: Witness already stands on Cheng Lou's measurement stack (Pretext for text, Yoga/Textura for layout), and freerange closes the one gap that stack couldn't reach — the plain arithmetic a code generator writes once a Shen obligation leaves the type checker and becomes TypeScript. See [Gate 5](#gate-5-numeric-range-analysis-freerange) below.

**ShenScript** runs Shen on Node.js / browsers with a tiny footprint and clean foreign-function interop.

---

## How it works

### For static text (Tier 1)

The compiler measures the text at build time and either grants or denies the `verified` type:

```shen
;; This compiles:
;; measure("Submit", Inter 14) = 7px. 7 ≤ 96. ✓
(assert-fits "Submit" (mk-font "Inter" 14) 96)

(define submit-btn
  {safe-text}
  -> (proven-text "Submit" (mk-font "Inter" 14) 96))
```

If the text were "Submit your very long application for review", the `assert-fits` would fail to load with an exact measurement error. `(proven-text ...)` is further gated at read time: its first argument **must** be a literal string. Passing a variable or any other expression is a compile-time error, not a runtime one — the fallback to `handled-text` or `prop-spec` is spelled out in the error message.

### For dynamic text, you have two choices

Dynamic content (props, API responses, user input) never reaches `proven-text`. The compiler forces you to pick between:

```shen
;; Option 1: Declare a bound at the component boundary (Tier 2)
;; The Astro runtime enforces (max-chars N) and (max-width Font W) against
;; props BEFORE render runs, so a malformed prop fails with a message
;; pointing at the offending key — not at a downstream layout overflow.
(prop-spec "title" (max-chars 80))
(prop-spec "title" (max-width (mk-font "Inter" 14) 200))

;; Option 2: Explicit visual fail-soft with handled-text (Tier 3)
;; CSS truncation: text-overflow:ellipsis for ellipsis, overflow:hidden
;; for clip, nothing for visible. The build does not fail on overflow;
;; the rendered text does.
(define dynamic-label
  Text -> [text-node (handled-text Text (mk-font "Inter" 14) 200 ellipsis)])
```

The two tiers compose: `prop-spec` is the editorial safety net (80 chars = "this is a title, not an essay"), `handled-text` is the visual contract for what passes through. Try to feed a dynamic value into `proven-text`, and you get a load-time error before any HTML is emitted.

### Figma specs as executable contracts

Witness can parse a Figma-shaped JSON export and structurally diff it against your actual computed layout — comparing positions and sizes with a configurable tolerance. Not pixel comparison; position/size comparison. The idea: Figma designs become enforceable contracts, not reference images.

<a id="figma-status"></a>
> **Status: WIP.** `shen/figma.shen` consumes a narrow subset of Figma's schema — `name`, `absoluteBoundingBox.{x,y,width,height}`, and `children`, recursively. Everything else Figma emits (`type`, `fills`, `characters`, `constraints`, `layoutMode`, component instances, vector paths) is silently ignored. The library is tested against hand-crafted fixtures (`test/fixtures/simple-card.json`, `examples/card-design.json`) that match that schema. **It has not been validated against an actual REST API export from a live Figma file.** Real-world exports may break on: missing `absoluteBoundingBox` (masks/invisible nodes), duplicate sibling names, deeply nested component instances, or sheer size (the tree walk is unbounded recursion). Treat this as a design sketch that works for the demo, not a production integration.

### AI agent loop

Because the compiler produces structured JSON errors with ranked fix suggestions (widen the container, use ellipsis, reduce font size), AI agents can self-correct against the type checker in a tight loop (~50ms). The agent applies the top-ranked fix and recompiles until the program is clean.

```js
async function agent(files, maxIter = 10) {
  for (let i = 0; i < maxIter; i++) {
    const errors = await env.call('check-all', [files]);
    if (!errors.length) { console.log(`Done in ${i+1} iterations`); return; }
    for (const err of errors) {
      if (err.suggestions?.[0]?.edit) applyEdit(err.suggestions[0].edit);
    }
  }
}
```

---

## The runtime (optional)

**The compile-time proofs don't require a runtime.** `assert-fits`, `proven-text`, `handled-text`, the Figma diff, and the structured error/agent loop all work on plain node trees — you can ship Witness-checked layouts through any renderer (SSR to HTML, your own React components, a canvas painter). The proofs are where the value lives; what you do with the verified tree afterwards is your choice.

If you want reactive apps with the same proof guarantees frame-to-frame, Witness ships an optional **Elm Architecture (TEA)** runtime (`shen/tea.shen`, ~130 lines). Model → Update → View, with commands as data. The view function returns a layout tree; `solve-layout` runs; a renderer callback paints. Every re-render goes through the same `proven-text`/`handled-text` types, so overflow proofs hold across state changes, not just at first paint.

```
[ your node tree ]  ──►  compile-time proofs  ──►  [ verified tree ]
                                                     │
                             ┌───────────────────────┼───────────────────────┐
                             ▼                       ▼                       ▼
                       SSR → HTML          Figma structural diff        TEA runtime
                    (witness render)      (witness check --figma)    (shen/tea.shen)
```

You can use any subset. Counter-style reactive apps pick TEA; static pages pick SSR; design-vs-code diffing picks Figma. The proofs are identical across all three.

The Tailwind-style `tw` macro makes layout declarations readable:

```shen
(define view {model --> node}
  (count N) ->
    (tw [flex flex-col items-center gap-4 p-8]
      [(text-node (handled-text (str N) (mk-font "Inter" 32) 200 visible))
       (tw [flex gap-2]
         [(button "-" decrement)
          (button "+" increment)])]))
```

The `tw` macro is parsed by a `defcc` grammar that maps Tailwind class tokens to Textura props. `w-32` becomes `[width 128]`. `flex-col` becomes `[direction column]`. `truncate` becomes `[overflow ellipsis]`.

---

## CLI

```sh
witness dev <files...>         # tier 1 — assert-fits at load time, no type sigs required
witness build <files...>       # tier 1 with type checking (tc+)
witness check --full <files...># tier 1 with type checking (tc+)
witness check --figma <spec> <file>   # tier 3 — structural diff against Figma export
witness render <file.shen>     # render computed layout to static HTML
witness agent <file.shen>      # parse structured errors, auto-widen containers
```

Today these map to `node cli/check.js <command>` and `node cli/agent.js`.

---

## File structure

```
witness/
├── boot.js                 # ShenScript + Textura + DOM interop
├── shen/
│   ├── witness.shen        # loads everything
│   ├── proofs.shen         # layout proof datatypes
│   ├── layout.shen         # node types + Textura bridge, overflow → CSS
│   ├── tea.shen            # TEA runtime: Model/Update/View
│   ├── dom.shen            # DOM renderer (browser)
│   ├── ssr.shen            # SSR renderer (Node → static HTML)
│   ├── tailwind.shen       # defcc grammar for tw macro
│   ├── errors.shen         # structured JSON error construction
│   └── figma.shen          # structural diff against Figma exports
├── cli/
│   ├── check.js            # dev / build / check / render / measure
│   ├── verify.js           # standalone Figma structural diff wrapper
│   └── agent.js            # agent self-correction loop
└── examples/
    ├── card.shen
    ├── card-overflow.shen
    └── counter.shen
```

~1,660 lines of Shen. ~2,430 lines of JS runtime + CLI. ~1,300 lines of emitter. ~1,900 lines of gate tooling.

---

## Design Backpressure & Gates (sb-style self-hosting)

Witness now has its own **sb-shen-backpressure-style gate system** to protect its evolution.

> **🚀 Try the protected Card workflow in 60 seconds**
>
> ```bash
> bash docs/card-protected-demo.sh
> ```
>
> Runs Gate 4 (high-level `verified-card` emitter fidelity via the live `(card-contract-shape)` descriptor + `fidelityChecks[]` + `tsc --noEmit`) + the rich `witness loop --gate 4 --dry-run` experience. The fastest 60-second way to feel the modern tighter-coupling backpressure on the Card contracts.

The system has moved from "rough but promising" to a solid, intentional self-hosting backpressure platform:

- High-level contracts (`verified-card`, slots) are proven by Gate 1: `specs/design/witness-core.shen` constructs the canonical Card, which forces the type checker to evaluate each slot's `if (fits? ...)` side condition against a real Pretext measurement. Shrink a slot's bound below its measured width and Gate 1 goes red.
- Gate 2 executes every property theorem it discovers and requires each to return true.
- The emitter is driven by the live `(card-contract-shape)` descriptor from Shen; if that descriptor cannot be read, the emitter fails rather than falling back.
- Gate 4 auto-discovers `*-emitter.js`, runs declared `fidelityChecks[]`, `tsc`, and a semantic check that measures the emitted slots **unclamped** against their proven bounds.
- Adding a new protected component: `witness spec-init MyComponent` scaffolds the properties file and emitter; the loader wires the contract into the prelude and Gate 4 discovers the emitter. Its theorems are picked up by Gate 2 automatically.

> **A note on how these gates got here.** Every one of the claims above was
> false at some point in this project's life, in ways nothing detected: Gate 1
> type-checked two comment-only files, Gate 2 was two `echo` calls, Gate 4's
> semantic check passed a 500-character title, the emitter ran on hardcoded
> fallbacks because its Shen descriptor had never loaded, and the ruler measured
> at 10px because a canvas silently rejects CSS font shorthand with a
> line-height. Each gate now has a documented way to make it fail, and the ones
> that could not fail were rebuilt rather than re-described.

Formal design specs live in `specs/design/*.shen`. Obligations are written as `if` **side conditions**, which Shen evaluates during type checking — not as `: verified` assertions, which it does not.

Run the gates with:

```bash
witness gates
npm run gates
./bin/witness-design-gates.sh --gate 2   # single gate; full suite is ~12s
```

**Current gates** (numbered, individually addressable, with TCB/regeneration audit):

1. `tc+` on all design specs (using the real `fits?` / Pretext measurement + ShenScript in-process for `tc+`; `WITNESS_SHEN_ENGINE=native` uses `shen-cl` / `shen-sbcl` instead)
2. Property theorems — discovered by shape in `specs/ui/properties/*.shen` and **executed**; false, erroring, or none-found all fail the gate
3. Regeneration audit (SHA-256 fidelity check on the Trusted Computing Base — `witness.shen`, `trust.shen`, `layout.shen`, renderers, checker, etc.)
4. Emitter fidelity (auto-discovers `codegen/emitters/*-emitter.js`, diffs what the emitter produces against what is committed on disk, runs their `fidelityChecks[]` against the live contract, project-wide `tsc`, and a semantic check that measures each emitted slot unclamped against its proven bound)
5. Numeric range analysis (`fr` / freerange over the emitted TypeScript — checks the arithmetic behind Gate 4's artifacts against `console.assert` pre- AND postconditions projected from the same Shen obligations)

This is the meta layer that will ensure the Card spike, `shen-witness` codegen emitter, semantic CSS, and guarded component factories stay faithful to their specs.

### Gate 5: numeric range analysis (freerange)

Gate 4 proves the *shape* of what the emitter writes — tokens, factories, brands — against the live `(card-contract-shape)`. It has nothing to say about the arithmetic a generated numeric helper performs. That's Gate 5's job, and it's a genuinely different kind of composition:

1. **Shen proves the design over known values.** `card-properties.shen` discharges obligations like "a card's content width is `variant-width - 2 * space-4`, and every variant width is ≥ the minimum" against the baked constants in `(card-contract-shape)`.
2. **The emitter projects those obligations into `console.assert`s** in a self-contained generated module (`codegen/emitters/generated/card/card-layout.ts`), each tagged with the Shen theorem it came from. Leading asserts are *preconditions* (freerange enforces them at call sites); non-leading asserts are *postconditions* freerange must **prove**. The postconditions are what make token drift visible — with preconditions alone the emitter wrote both sides of the check, and setting `space-4` to 200 (every computed width negative) produced zero findings.
3. **freerange statically checks the arithmetic** against those asserts at every call site — catching a caller who could violate a precondition that Shen proved was excluded *for the values it knows about*.

```ts
// before — plain arithmetic, nothing for freerange to check
return (available - SPACE_2 * (n - 1)) / n;          // n = 0 ⇒ silent NaN

// after — Shen's `actionCount >= 1` obligation projected as a precondition
console.assert(n >= 1);                               // from card-contract-shape
return (available - SPACE_2 * (n - 1)) / n;           // freerange now proves n ≠ 0
```

Run it: `./bin/witness-design-gates.sh --gate 5` (aliases: `fr`, `freerange`, `numeric`, `range`). Full write-up — including the negative fixture that keeps the gate honest and the obligation → `console.assert` projection convention for new emitters — lives in [`specs/design/README.md`](specs/design/README.md).

> **Two honest limitations.**
> **(a) No cross-file enforcement upstream.** freerange v0.0.2 does not check contracts across `import`s — the contracted function and every call site must live in the *same file*. That's why the emitter writes self-contained modules with in-file call sites rather than importing shared layout math. **A fork under [`vendor/freerange`](vendor/freerange/WITNESS-FORK.md) closes this** with an opt-in `fr --cross-file` (default behaviour unchanged; 196/196 tests pass). On `examples/ts/cross-file/`, published 0.0.2 reports 0 findings while the fork catches both violations and lifts coverage from 2/4 to 4/4 functions. Gate 5 still runs the *published* binary — the fork is not yet the default.
> **(b) It's a text-scraping, non-fatal bridge.** freerange hard-requires `strictNullChecks` and ships no JSON output or programmatic API in v0.0.2. The audit bridge (`cli/freerange-audit.js`) parses its human-readable `--audit` output and is deliberately non-fatal — a parse-shape change in a future release degrades to "no facts learned," not a broken build.

See:
- `specs/design/README.md`
- `bin/witness-design-gates.sh --help`
- `.claude/commands/witness/` (for `/witness:gates`, `/witness:loop`, `/witness:spec-init` etc. — `witness spec-init` is already live via the main CLI)
- The full design document for the Shen UI Specifications vision

As we build the larger system, the same proof machinery that protects *your* components will protect the implementation of the protector.

---

## What Witness is not building (v1)

- A JS code emitter (ShenScript is the runtime)
- Canvas / WebGL / PixiJS renderers (DOM only; Textura's `{x,y,w,h}` output makes this trivial to add later)
- A module system (use Shen's `load`)
- Pixel-perfect screenshot diffing (structural position/size diff only)

---

## Why this matters

Every UI framework treats layout as a runtime concern. You write the layout, run the app, look at the screen, and fix what's broken. With Witness, the type system *is* the screen. The compiler runs the ruler. If it fits, it ships. If it doesn't, it can't.

Shen gives us types, Prolog, and parser combinators — for free.  
Textura gives us Pretext + Yoga as a single `computeLayout` call — for free.  
ShenScript gives us JS interop — for free.

We're not building a language or a layout engine. We're writing ~1,660 lines of Shen (plus the JS that binds it to Pretext, Yoga and freerange) that connect four proven tools in a way nobody has before.
