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
| `witness agent` widen-fix loop | works |
| Bounded-string worst-case proofs — `(bounded N)` type | declared, not wired |
| DOM runtime (`run-app`, TEA) | library exists; browser harness TBD |

---

## The core idea

Layout bugs are discovered at the worst possible time: in the browser, after deployment, by a user whose screen is slightly narrower than yours. A button label wraps. A price overflows its box. A translated string destroys a card.

Witness makes these impossible to ship. If text doesn't fit its container, **the program doesn't compile**.

```
(datatype layout-proofs
    Text : string;  Font : font;  MaxW : number;
    (<= (measure Text Font) MaxW);
  ______________________________________________
    (fits Text Font MaxW) : verified;)
```

If `measure` returns 147px and `MaxW` is 96px, you get a type error — not a runtime bug.

---

## The mental model

Think of layout proofs the way you think of tests — but mathematically exhaustive instead of example-based, and enforced at compile time instead of run time:

| Tier | When | Cost | What |
|------|------|------|------|
| 1: Always | Every keystroke in dev | ~1ms | Static text fits static containers |
| 2: Build | CI / pre-commit | ~50ms | Bounded string worst-case proofs |
| 3: Comprehensive | Nightly / pre-release | ~500ms | Figma verification, i18n sweep |
| 4: Runtime | Production (opt-in) | per-check | User-generated content, dynamic fonts |

Proofs **erase after compilation** — just like TypeScript types after `tsc`. Zero proof machinery ships to production. What survives is plain JS calling Textura for layout and DOM for rendering.

---

## The stack

```
Shen kernel          — types, Prolog, defcc, macros
ShenScript           — runs Shen on JS, 60KB, 50ms startup
Textura              — Pretext + Yoga: full DOM-free layout
  ├─ Pretext         — pure text measurement, 0.09ms/500 texts
  └─ Yoga WASM       — Facebook's flexbox engine (React Native)
──────────────────────────────────────────────────────────────
Witness              — ~1.1k lines Shen + ~730 lines JS glue
```

Everything above the line exists and works. Witness itself is ~1,100 lines of Shen (proofs, layout bridge, errors, figma diff, SSR + DOM renderers, tailwind macro, TEA runtime) plus ~730 lines of JS glue (ShenScript/Textura interop, CLI commands, agent loop).

### Why each piece matters

**Shen** is a Lisp-family language with a sequent-calculus type system. Unlike Hindley-Milner, Shen's `datatype` declarations are theorems — premises above a horizontal line must be proven before a type is granted. Crucially, those premises can call pure functions as side conditions. Layout measurement is pure math. So the type checker can *run the ruler* at compile time.

**Pretext** is Cheng Lou's canvas-based text measurement library. It uses `measureText` + `Intl.Segmenter` for near-perfect fidelity to browser layout — handling `white-space:normal`, `overflow-wrap:break-word`, bidi, CJK, and emoji. It achieves exceptional accuracy across engines at 0.09ms per 500 texts. No reflows, no DOM.

**Textura** combines Pretext with Yoga (Meta's battle-tested flexbox engine from React Native), exposing a single `computeLayout(tree)` call that returns pure `{x, y, w, h}` output. It replaced a previous ~300-line hand-rolled flex solver — deleting the riskiest piece of custom code and replacing it with battle-tested infrastructure.

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

~1,100 lines of Shen. ~730 lines of JS glue.

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

We're not building a language or a layout engine. We're writing ~1,100 lines of Shen (plus ~730 lines of JS glue) that connect three proven tools in a way nobody has before.
