# Witness

A Shen extension that makes layout a compile-time proof.

## What it is

Shen + Textura + backpressure. Written in Shen, running on ShenScript,
rendering to DOM. Layout overflow is a type error. Figma specs are
test fixtures. AI agents self-correct against the compiler.

## The stack

```
Shen kernel (exists)        — types, Prolog, defcc, macros
ShenScript (exists)         — runs Shen on JS, 60KB, 50ms startup
Textura (exists)            — Pretext + Yoga: full DOM-free layout
  ├─ Pretext (inside)       — pure text measurement, 0.09ms/500 texts
  └─ Yoga WASM (inside)     — Facebook's flexbox engine (React Native)
node-canvas (exists)        — rasterization without a browser
─────────────────────────────────────────────────────────────
Witness                     — ~1.1k lines Shen + ~730 lines JS glue
```

Everything above the line exists and works. We write the glue.

## What's implemented today

| Capability | Status | Notes |
|---|---|---|
| Tier 1 — `assert-fits` load-time proof | ✅ works | `shen/proofs.shen`; throws during `$.load` |
| Tier 1 — `proven-text` sequent calculus under `tc+` | ✅ works | Requires static text, font, bound |
| Tier 1 — `handled-text` escape hatch (ellipsis/clip/visible) | ✅ works | Overflow CSS emitted by SSR + DOM renderers |
| Tier 2 — bounded-string worst-case proofs | 🚧 planned | `(bounded N)` type is declared, not wired to `assert-fits` |
| Tier 3 — Figma structural diff (library) | 🚧 **WIP** | `shen/figma.shen` works on hand-crafted fixtures; not yet validated against real Figma REST API exports |
| Tier 3 — Figma CLI (`witness check --figma`) | 🚧 **WIP** | End-to-end works on demo fixtures; see WIP note above |
| Tier 4 — runtime `fits?` branching | ✅ works | Standard Shen `if` on `(fits? ...)` |
| SSR renderer (`witness render`) | ✅ works | Emits static HTML with computed layout |
| DOM runtime (TEA `run-app`) | 🚧 browser harness TBD | `examples/counter.shen` not runnable in Node CLI |
| `witness agent` widen-fix loop | ✅ works | `cli/agent.js`; parses errors, rewrites widths |
| Structured error reports (`format-error`) | ✅ works | Surfaced by both `dev`/`check` and `agent` |
| Performance budget proofs (`--perf`) | 🚧 not implemented | Flag removed from CLI |

## Core idea in 30 seconds

Textura computes layout as pure math — no DOM, no reflow. Shen's
type system can evaluate pure functions as side conditions. Therefore:

```shen
(datatype layout-types
    Text : string;  Font : font;  MaxW : number;
    (<= (measure Text Font) MaxW);
  ______________________________________________
    (fits Text Font MaxW) : verified;)
```

If `measure` returns 147px and `MaxW` is 96px, the program
doesn't compile. Layout overflow is a type error.

For dynamic text, you must either:
- Prove worst-case fits (via bounded string length from API)
- Handle overflow explicitly (truncate, ellipsis)
- Branch with runtime `fits?` check

The compiler forces one of these. You can't put unproven text
into a fixed container.

---

## What we build (in order)

### Phase 1: Textura interop

Register Textura as Shen native functions in boot.js.
Textura already combines Pretext (text) and Yoga (flexbox) —
we get the full layout solver from a single `computeLayout` call.

```javascript
// boot.js
const { init, computeLayout } = require('textura');

async function boot() {
  const env = await shen.makeNode();
  await init(); // initialize Yoga WASM (once)

  // The entire layout engine in one registration
  env.defun('textura.layout', 1, (tree) => computeLayout(tree));

  // Text measurement (Pretext under the hood)
  env.defun('textura.measure', 2, (text, font) => {
    const result = computeLayout({
      text, font, lineHeight: 20, width: 999999
    });
    return result.width;
  });

  // DOM interop
  env.defun('dom.create-element', 1, (tag) => document.createElement(tag));
  env.defun('dom.set-style', 2, (el, styles) => {
    Object.assign(el.style, styles); return el;
  });
  env.defun('dom.set-text', 2, (el, t) => { el.textContent = t; return el; });
  env.defun('dom.append', 2, (p, c) => { p.appendChild(c); return p; });
  env.defun('dom.get-by-id', 1, (id) => document.getElementById(id));
  env.defun('dom.on', 3, (el, evt, fn) => {
    el.addEventListener(evt, (e) => env.call(fn, [e])); return el;
  });
  env.defun('dom.raf', 1, (fn) => requestAnimationFrame(() => env.call(fn, [])));

  // JSON (for structured errors and Figma specs)
  env.defun('json.stringify', 1, (o) => JSON.stringify(o, null, 2));
  env.defun('json.parse', 1, (s) => JSON.parse(s));

  // HTTP (for effects)
  env.defun('http.fetch', 2, async (url, opts) => {
    const r = await fetch(url, opts);
    return { status: r.status, body: await r.json() };
  });

  await env.load('shen/witness.shen');
  return env;
}
```

### Phase 2: Layout proof types

The `datatype` declarations that make overflow a type error.
~100 lines of sequent calculus rules, organized into tiers.

**Key insight: proofs are build-time assertions, not runtime code.**
Once the compiler verifies "Submit" fits in 96px, there's zero reason
to check again at runtime. The text didn't change. The font didn't change.
The container didn't change. The proof is done. Ship without it.

Proofs are erased after compilation, just like TypeScript types after `tsc`.
What ships is plain JS calling Textura for layout and DOM for rendering.
The only proof-related code that survives into production are explicit
`fits?` runtime branches the developer chose to write — and those are
just if-statements, not proof machinery.

#### Proof tiers

The mental model: **proofs are tests that run at compile time.** Like tests,
you have fast ones you run constantly, slow ones on CI, and expensive ones
before release. The difference: these "tests" are mathematically exhaustive,
not example-based.

| Tier | When | Cost | What |
|------|------|------|------|
| 1: Always | Every keystroke in dev | ~1ms | Static text fits static containers |
| 2: Build | CI / pre-commit | ~50ms | Bounded string worst-case proofs |
| 3: Comprehensive | Nightly / pre-release | ~500ms | Figma verification, i18n sweep |
| 4: Runtime | Production (opt-in) | per-check | User-generated content, dynamic fonts |

```
$ witness dev <files...>              # tier 1 — assert-fits at load time
$ witness build <files...>            # tier 1 with type checking (tc+)
$ witness check --figma <spec> <file> # tier 3 — Figma structural diff
$ witness render <file.shen>          # render verified tree to static HTML
$ witness agent <file.shen>           # auto-widen containers on overflow
```

The proof mechanism has two complementary layers:

**Layer 1: Type-level structural guarantee** — The type system forces you to
either prove text fits (`where (fits? ...)`) or explicitly handle overflow
(`handled-text`). You cannot put unproven text into a container. This is
enforced by Shen's sequent calculus type checker via the `: verified` type.

**Layer 2: Load-time assertion** — `(assert-fits Text Font MaxW)` evaluates
at file load time. If text overflows, it throws a clear error with
measurements before the app ever runs. This is true compile-time rejection.

```shen
\\ shen/proofs.shen — The core innovation
\\ NOTE: (tc +) is enabled by witness.shen AFTER this file loads

\\ Measure text width (calls Pretext under the hood)
(define measure
  Text Font -> (textura.measure Text Font))

(define fits?
  Text Font MaxW -> (<= (measure Text Font) MaxW))

(define mk-font
  Name Size -> (cn (str Size) (cn "px " Name)))

\\ Type declarations for the type checker
(declare measure [string --> [string --> number]])
(declare fits? [string --> [string --> [number --> boolean]]])
(declare mk-font [string --> [number --> string]])

\\ Compile-time assertion: call at top level to catch overflow during loading
(define assert-fits
  Text Font MaxW ->
    (if (fits? Text Font MaxW) true
        (simple-error (cn "Layout overflow: '" (cn Text
          (cn "' in " (cn Font
            (cn " = " (cn (str (measure Text Font))
              (cn "px, container = " (cn (str MaxW) "px")))))))))))

(declare assert-fits [string --> [string --> [number --> boolean]]])

\\ === PROOF DATATYPES ===

(datatype layout-proofs

  \\ Tier 1: static text — requires (fits? ...) : verified from where clause.
  \\ The internal tag is [proven-cell ...]: the public face is the
  \\ (proven-text X F W) function, gated at read time by trust.shen's
  \\ macro so X must be a literal string.
  Text : string; Font : string; MaxW : number;
  (fits? Text Font MaxW) : verified;
  ______________________________________________
  [proven-cell Text Font MaxW] : safe-text;

  \\ Bounded strings (from API layer)
  S : string; N : number;
  (>= N (string-length S)) : verified;
  ______________________________________________
  S : (bounded N);

  \\ Handled text: developer explicitly chose an overflow strategy.
  \\ MaxW is the declared container width (carried through to CSS).
  Text : string; Font : string; MaxW : number; Overflow : overflow;
  _______________________________________________
  [handled-cell Text Font MaxW Overflow] : safe-text;)

(datatype overflow-types
  ___ ellipsis : overflow;
  ___ clip : overflow;
  ___ visible : overflow;)
```

User code pattern — three tiers, picked at the call site:

```shen
\\ Tier 1: literal text, proven to fit
(assert-fits "Submit" (mk-font "Inter" 14) 96)  \\ load-time check

(define submit-btn
  {safe-text}
  -> (proven-text "Submit" (mk-font "Inter" 14) 96))  \\ literal-only

\\ Tier 2: dynamic prop bounded at the component boundary
(prop-spec "title" (max-chars 80))
(prop-spec "title" (max-width (mk-font "Inter" 14) 200))

\\ Tier 3: dynamic content, CSS fail-soft
(define dynamic-text
  Text -> [text-node (handled-text Text (mk-font "Inter" 14) 200 ellipsis)])
```

Dynamic content never reaches `proven-text`. A call like
`(proven-text (js.get Props "title") Font W)` fails at read time with a
message naming the offending expression and pointing at `handled-text`
or `prop-spec` as alternatives.

### Phase 3: Declarative layout → Textura tree

Map Witness layout nodes to Textura's declarative tree format.
Textura already takes exactly this shape and returns exact positions.

```shen
\\ shen/layout.shen — Build Textura trees from Witness nodes

\\ A Witness layout node
(datatype node-types
    Props : frame-props;  Children : (list node);
  ________________________________________________
    (frame Props Children) : node;

    T : safe-text;
  __________________
    (text-node T) : node;

    W : number;  H : number;
  ____________________________
    (spacer W H) : node;)

\\ Convert Witness node tree → Textura input tree
(define to-textura
  {node --> textura-tree}

  (frame Props Children) ->
    (textura-obj
      (get-width Props) (get-height Props)
      (get-direction Props) (get-gap Props)
      (get-padding Props)
      (get-justify Props) (get-align Props)
      (get-grow Props) (get-shrink Props)
      (map to-textura Children))

  (text-node (proven-text Text Font MaxW)) ->
    (textura-text Text (font->css Font) 20 MaxW)

  (text-node (handled-text Text Font _)) ->
    (textura-text Text (font->css Font) 20 999999)

  (spacer W H) ->
    (textura-box W H))

\\ Run the layout solver
(define solve-layout
  {node --> number --> number --> computed-layout}
  Root AvailW AvailH ->
    (let Tree (to-textura Root)
         _ (textura-set-root-size Tree AvailW AvailH)
      (textura.layout Tree)))
```

### Phase 4: TEA runtime

Elm architecture in Shen. Model/Update/View. Commands as data.

```shen
\\ shen/tea.shen

(define run-app
  {(app Model Msg Flags) --> Flags --> renderer --> unit}
  App Flags Renderer ->
    (let Result ((get-init App) Flags)
         Model (fst Result)
         Cmd (snd Result)
         _ (set *model* Model)
         _ (set *app* App)
         _ (set *renderer* Renderer)
         _ (execute-cmd Cmd)
         _ (render-frame)
      unit))

(define dispatch
  {Msg --> unit}
  Msg ->
    (let App (value *app*)
         Model (value *model*)
         Result ((get-update App) Msg Model)
         NewModel (fst Result)
         Cmd (snd Result)
         _ (set *model* NewModel)
         _ (execute-cmd Cmd)
         _ (schedule-render)
      unit))

(define render-frame
  {unit}
  -> (let App (value *app*)
          Model (value *model*)
          Renderer (value *renderer*)
          Tree ((get-view App) Model)
          Layout (solve-layout Tree
                   (viewport-width) (viewport-height))
          _ (Renderer Layout)
       unit))

(define schedule-render
  {unit}
  -> (dom.raf (/. _ (render-frame))))
```

Commands and subscriptions as data:

```shen
(datatype cmd-types
  ___ cmd-none : (cmd Msg);
  ___ (cmd-batch Cmds) : (cmd Msg)  where (list? Cmds);
  ___ (cmd-http Url Opts OnOk OnErr) : (cmd Msg);
  ___ (cmd-delay Ms M) : (cmd Msg);
  ___ (cmd-navigate Url) : (cmd Msg);)

(datatype sub-types
  ___ sub-none : (sub Msg);
  ___ (sub-every Ms M) : (sub Msg);
  ___ (sub-on-key OnKey) : (sub Msg);
  ___ (sub-on-resize OnResize) : (sub Msg);)
```

### Phase 5: DOM renderer

Walk Textura's computed layout, emit positioned DOM nodes.

```shen
\\ shen/dom.shen

(define dom-renderer
  {string --> renderer}
  ContainerID ->
    (let Root (dom.get-by-id ContainerID)
      (/. Layout
        (let _ (dom.clear Root)
          (render-to-dom Layout Root)))))

(define render-to-dom
  {computed-layout --> dom-element --> unit}
  Layout Parent ->
    (let El (dom.create-element "div")
         _ (dom.set-style El {
              position "absolute"
              left (px (get-x Layout))
              top (px (get-y Layout))
              width (px (get-w Layout))
              height (px (get-h Layout)) })
         _ (if (has-text Layout)
             (let Span (dom.create-element "span")
                  _ (dom.set-text Span (get-text Layout))
                  _ (dom.set-style Span (text-styles Layout))
               (dom.append El Span))
             (each (/. Child (render-to-dom Child El))
                   (get-children Layout)))
      (dom.append Parent El)))
```

### Phase 6: Tailwind bridge

`defcc` grammar that parses Tailwind classes into Textura props.

```shen
\\ shen/tailwind.shen

(defcc <tw-class>
  w- <tw-size>      := [width <tw-size>];
  h- <tw-size>      := [height <tw-size>];
  p- <tw-size>      := [padding <tw-size>];
  px- <tw-size>     := [padding-x <tw-size>];
  py- <tw-size>     := [padding-y <tw-size>];
  gap- <tw-size>    := [gap <tw-size>];
  flex              := [display flex];
  flex-col          := [direction column];
  flex-row          := [direction row];
  items-center      := [align center];
  justify-between   := [justify space-between];
  text-xs           := [font-size 12];
  text-sm           := [font-size 14];
  text-base         := [font-size 16];
  text-lg           := [font-size 18];
  font-medium       := [font-weight 500];
  font-bold         := [font-weight 700];
  rounded-lg        := [radius 8];
  truncate          := [overflow ellipsis];
  grow              := [flex-grow 1];)

(defcc <tw-size>
  0 := 0;    1 := 4;    2 := 8;    3 := 12;   4 := 16;
  5 := 20;   6 := 24;   8 := 32;   10 := 40;  12 := 48;
  16 := 64;  20 := 80;  24 := 96;  32 := 128;
  full := 100%;  auto := auto;)

\\ Macro: (tw [w-32 px-4 text-sm] (text "Hello"))
(defmacro tw-macro
  [tw Classes | Children] ->
    [frame (parse-tw-classes Classes) Children])
```

### Phase 7: Error messages

Structured JSON. Proof traces. Ranked fixes.

```shen
\\ shen/errors.shen

(define make-layout-error
  {string --> font --> number --> number --> error-report}
  Text Font MeasuredW AvailW ->
    { code "W0200"
      category "layout-proof"
      message (format "~A in ~A = ~Apx, container = ~Apx"
                Text (font->css Font) MeasuredW AvailW)
      suggestions
        [{ fix "Add truncate" effort "trivial" confidence 1.0 }
         { fix (format "Widen to ~Apx" (ceiling MeasuredW))
           effort "trivial" confidence 0.95 }
         { fix "Use smaller font" effort "small" confidence 0.9 }] })
```

### Phase 8: Figma structural verification

Parse Figma JSON. Run Textura on code. Diff the two layout trees.
Not pixel comparison — position/size comparison with tolerance.

```shen
\\ shen/figma.shen

(define verify-figma
  {string --> node --> number --> verification-result}
  FigmaJsonPath CodeNode Tolerance ->
    (let Spec (json.parse (read-file FigmaJsonPath))
         FigmaTree (figma-json->positions Spec)
         CodeLayout (solve-layout CodeNode
                      (get-figma-width Spec)
                      (get-figma-height Spec))
         CodeTree (layout->positions CodeLayout)
         Diffs (diff-positions FigmaTree CodeTree Tolerance)
      (if (empty? Diffs)
        (pass "All nodes within tolerance")
        (fail Diffs))))
```

### Phase 9: Agent loop

```javascript
// cli/agent.js
async function agent(files, maxIter = 10) {
  const env = await boot();
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

## What we DON'T build (v1)

- JS code emitter (ShenScript IS the runtime)
- PixiJS / Three.js / Canvas renderers (DOM only; clean interface for later)
- Module system (use Shen's `load`)
- Server-side runtime
- SQL DSL
- Pixel-perfect screenshot diffing (structural diff only)

All are Phase 2+. The render backend is trivial to add later because
Textura's output is already renderer-agnostic — just `{x, y, w, h}` trees.

---

## File structure

```
witness/
├── package.json            # shen-script, textura
├── boot.js                 # ShenScript + Textura + DOM interop (212 lines)
├── shen/
│   ├── witness.shen        # loads everything (17 lines)
│   ├── proofs.shen         # layout proof datatypes (96 lines)
│   ├── layout.shen         # node types + Textura bridge + overflow→CSS (138 lines)
│   ├── errors.shen         # structured JSON errors + fix suggestions (95 lines)
│   ├── figma.shen          # structural diff against Figma exports (240 lines)
│   ├── ssr.shen            # SSR renderer → static HTML (140 lines)
│   ├── dom.shen            # DOM renderer (browser) (84 lines)
│   ├── tailwind.shen       # defcc grammar for tw macro (146 lines)
│   └── tea.shen            # optional Elm-Architecture runtime (127 lines)
├── cli/
│   ├── check.js            # dev / build / check / render / measure (190 lines)
│   ├── verify.js           # standalone Figma diff wrapper (44 lines)
│   ├── agent.js            # agent self-correction loop (128 lines)
│   └── measure.js          # pre-compute measurements for SBCL (160 lines)
└── examples/
    ├── card.shen
    ├── card-overflow.shen
    └── counter.shen
```

**~1,095 lines of Shen. ~734 lines of JS glue. ~1,830 lines total.** Bigger than the original 700-line sketch because SSR, the measure/agent CLIs, font validation, and Figma diffing all landed as separate modules.

**Core vs. extensions.** The compile-time proofs themselves are small: `proofs.shen` + `layout.shen` + `errors.shen` + `witness.shen` ≈ 346 lines of Shen. Everything else is stuff you can use *with* the proofs but don't need:

| Module | Role | Required for proofs? |
|---|---|---|
| `proofs.shen`, `layout.shen`, `errors.shen` | The actual backpressure — `assert-fits`, `proven-text`, `handled-text`, structured errors | yes (core) |
| `figma.shen` | Tier 3: structural diff against Figma JSON | no (extension) |
| `ssr.shen`, `dom.shen` | Render a verified tree to HTML / DOM | no (extension — could use any renderer) |
| `tailwind.shen` | `tw` macro sugar for layout props | no (extension — plain `mk-props` works) |
| `tea.shen` | Reactive Model/Update/View runtime | no (extension — only needed for interactive apps) |

**TEA specifically is an optional runtime, not part of the compiler.** The proofs run at `$.load` time against any node tree; what happens to that tree afterwards is up to the caller. You can:
- Render it once to static HTML (`witness render` → `ssr.shen`) — no TEA.
- Diff it against a Figma spec (`witness check --figma` → `figma.shen`) — no TEA.
- Hand the tree to your own React/canvas/whatever renderer — no TEA.
- Use TEA if you want a reactive app with Elm-style state management, where every re-render keeps the same proof guarantees.

TEA is included because interactive apps are a common target and we wanted a zero-dep story, but it's strictly additive.

---

## Module breakdown

Actual lines by module. Planned estimates from the original sketch are shown for reference; real sizes landed higher because SSR, the agent/measure CLIs, font validation, and tree-walking Figma diff all grew larger than the initial pencil-math.

| Module | Role | Planned | Actual |
|---|---|---|---|
| `proofs.shen` | Layout proof datatypes (tiered) | ~100 | 96 |
| `layout.shen` | Node types + Textura bridge + overflow→CSS | ~100 | 138 |
| `errors.shen` | Structured JSON errors + fix suggestions | ~60 | 95 |
| `figma.shen` | Structural diff against Figma JSON | ~120 | 240 |
| `ssr.shen` | SSR renderer → static HTML | (unplanned) | 140 |
| `dom.shen` | DOM renderer (browser) | ~80 | 84 |
| `tailwind.shen` | `defcc` grammar for `tw` macro | ~100 | 146 |
| `tea.shen` | Optional Elm-Architecture runtime | ~120 | 127 |
| `witness.shen` | Loader | ~10 | 17 |
| **Total Shen** | | **~700** | **~1,095** |

JS glue: `boot.js` 212, `cli/check.js` 190, `cli/agent.js` 128, `cli/measure.js` 160, `cli/verify.js` 44. **~730 lines total JS glue.**

---

## What Textura replaced

The previous spec had `solver.shen` at ~300 lines — a hand-rolled
flex layout algorithm. Textura replaces it entirely with one function
call to `computeLayout`, backed by Yoga WASM (the same engine that
powers React Native's layout). We deleted the riskiest, most complex
piece of custom code and replaced it with battle-tested infrastructure.

What Textura gives us that the hand-rolled solver didn't:
- Full flexbox spec compliance (wrap, grow, shrink, basis, align-content)
- WASM performance (Yoga is C++ compiled to WASM)
- React Native compatibility (same layout engine)
- Worker-thread layout (Textura is DOM-free by design)
- Pretext integration already done (text measurement wired in)

---

## Why this works

Shen gives us types, Prolog, defcc, macros — for free.
Textura gives us Pretext + Yoga as a single `computeLayout` — for free.
ShenScript gives us JS interop — for free.

We're not building a language or a layout engine.
We're writing ~1,100 lines of Shen (plus ~730 lines of JS glue)
that connect three existing, proven tools in a way nobody has before.

Proofs erase after compilation. Zero proof code ships to production.
The tiered system means developers get instant feedback on static
proofs (~1ms), thorough bounded checks on CI (~50ms), and exhaustive
verification before release (~500ms). Runtime `fits?` branches are
opt-in and rare — just if-statements, not proof machinery.

The result: layout overflow is a type error, Figma designs are
enforceable contracts, and AI agents have a 50ms feedback loop
for UI generation.

---

## Example: complete app

```shen
(tc +)
(load "witness")

\\ Types
(datatype app-types
  ___ increment : msg;
  ___ decrement : msg;
  ___ (count N) : model  where (number? N);)

\\ Init
(define init {unit --> (model * (cmd msg))}
  _ -> (@p (count 0) cmd-none))

\\ Update
(define update {msg --> model --> (model * (cmd msg))}
  increment (count N) -> (@p (count (+ N 1)) cmd-none)
  decrement (count N) -> (@p (count (- N 1)) cmd-none))

\\ View — layout proofs checked at compile time
(define view {model --> node}
  (count N) ->
    (tw [flex flex-col items-center gap-4 p-8]
      [(text-node (handled-text (str N) (mk-font "Inter" 32) visible))
       (tw [flex gap-2]
         [(button "-" decrement)
          (button "+" increment)])]))

(define button {string --> msg --> node}
  Label Msg ->
    (tw [px-4 py-2 rounded-lg text-sm font-medium]
      [(text-node (proven-text Label (mk-font "Inter" 14) 96))]))
\\ Compiler: measure("-", Inter 14) = 7px. 7 ≤ 96 ✓
\\ Compiler: measure("+", Inter 14) = 11px. 11 ≤ 96 ✓

\\ Run
(run-app (mk-app init update view (/. _ sub-none))
  unit
  (dom-renderer "root"))
```
