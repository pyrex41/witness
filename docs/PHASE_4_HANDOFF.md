# Phase 4 handoff — type-level trust split for text nodes

You are picking up Task #13 on a proof system for layout overflow (the
`witness` repo, a Shen extension sitting between an Astro site and
Textura + Pretext for SSR measurement). The previous agent (me) finished
Phases 0–3: the prover now measures with the same font binary the
browser renders, has no secret width buffer, and has a black-box
geometry harness that compares its predictions against a real browser.

What's missing is the original promise of the system: **"layout
overflow is a compile-time type error."** Right now, for any dynamic
text (a CMS title, a prop, a `js.get` result), it's a *runtime* error.
This document is the briefing for closing that gap.

Read the whole thing once before you write code. The sharp edges are
not in the Shen type system — they're in the interaction between the
type system, the `safe-text` datatype, the prop-spec layer, and the
live geometry test. Get that mental model first.

---

## 1. What currently holds (post Phases 0–3)

### Measurement parity (Phase 2)
`boot.js` registers `@fontsource/jetbrains-mono`'s WOFF with node-canvas,
so any `(mk-font "JetBrains Mono" N)` measured on the server uses the
same glyph widths the browser does (the browser loads the same file via
`@font-face`; see `src/styles/global.css` in `../my-blog`). Fonts other
than "JetBrains Mono" or CSS generics still fall through fontconfig —
if you introduce a second pinned font, register it the same way.

### No hidden buffer (Phase 3)
Textura's `MeasureFunc` adds ~15% width to unsized text cells to hide
font divergence. `boot.js` sidesteps that by pre-measuring text nodes
with raw Pretext, setting `width` + `whiteSpace: 'pre-wrap'`, and
routing through textura's unbuffered `Exactly + shouldWrap` branch.
`textura-text` no longer forwards a `width` unless the caller is
explicitly truncating (ellipsis/clip). Predicted widths now match
browser widths to ≤1px.

### Geometry oracle (Phase 1)
`test/geometry.test.js` drives a running blog via `rodney` (Chrome
automation), reads every `[data-witness-text]` span, and checks
`browserW ≈ predicted` and `browserW ≤ parent.clientWidth`. Run it
whenever you touch layout, ssr, or the measurement path:

```
cd /Users/reuben/projects/my-blog && bun run dev --port 5173 --host &
cd /Users/reuben/projects/witness && \
  WITNESS_PARITY_HARD_FAIL=1 bun run test:geometry
```

Current baseline: 15 visible cells + 12 clipped cells across `/`,
`/projects`, `/subscribe`; mean parity divergence 0.64px, max 0.80px.

### Props-layer proof (Phase 0 companion)
`shen/props.shen` + `astro/runtime.js` check `prop-spec` declarations
(e.g. `(prop-spec "title" (max-chars 80))`) at the component boundary
*before* render. This is editorial ("malformed frontmatter") not
layout.

### Per-render fit on `proven-text` (Phase 0 companion)
`shen/layout.shen` around line 123: when `to-textura` encounters a
`proven-text` node, it re-runs `(fits? Text Font MaxW)` and throws if
it fails. This is the fallback that catches dynamic strings — and it's
exactly what Phase 4 is meant to *replace* with a type-level check.

---

## 2. What Phase 4 must change

### The gap
`proven-text` is declared in `shen/proofs.shen` (lines 66–89) with

```
Text : string; Font : string; MaxW : number;
(fits? Text Font MaxW) : verified;
______________________________________________
[proven-text Text Font MaxW] : safe-text;
```

Shen's type system treats `fits?` as an opaque predicate it must
discharge from context (via a `where` clause on the caller) — it does
**not** evaluate `measure` on the string. For a static literal
`"reuben.brooks"` the framework satisfies the obligation via top-level
`assert-fits` at load time. For a dynamic value like
`(js.get Props "title")` there is nothing in the type context that
justifies `(fits? ...)`, but Shen-script's typechecker silently accepts
it because `string → safe-text` is too coarse to reject it at the
argument level.

Net effect: authors can write

```shen
(proven-text (js.get Props "title") (mono 14) 160)
```

…and it compiles. Overflow only surfaces at render (the Phase 0
fallback). That's a runtime error, not a type error. The original
pitch of the system is broken.

### The goal
Make `proven-text`'s first argument accept **only** strings that can be
proved to fit at typecheck time. Dynamic strings (prop accesses, values
from `js.get`, concatenations, user content) must be rejected at
typecheck and forced through one of:

- `handled-text` (CSS truncation — the honest escape hatch)
- a new runtime-checked combinator (see §5)
- a `prop-spec` with `(max-width Font W)` that proves the bound
  externally (the prop-layer already has `max-width` as a constructor
  — currently unused by the type system)

### Acceptance criteria
A successful Phase 4:

1. A component with `(proven-text (js.get Props "x") F W)` fails
   `witness-verify` with a message that names `proven-text` and the
   untrusted source.
2. A component with `(proven-text "literal" F W)` typechecks; top-level
   `assert-fits` continues to catch static overflow.
3. A component with `(handled-text (js.get Props "x") F W ellipsis)`
   continues to typecheck and render (CSS truncates on overflow).
4. Existing tests pass unchanged:
   - `bun test` (smoke, cli, responsive, astro-runtime)
   - `bun run test:geometry` with `WITNESS_PARITY_HARD_FAIL=1`
5. The consumer repo `../my-blog` builds (`bun run build`) and its
   `SiteHeader.shen` / `ProjectEntry.shen` still render.
6. `shen/proofs.shen` header comment + the witness README reflect the
   three-tier model (static literal / prop-spec-bounded / handled).
7. The Phase 0 render-time `fits?` fallback in `shen/layout.shen`
   around line 123 is either removed (if the type system fully
   replaces it) or justified in a comment explaining why both layers
   coexist (belt-and-suspenders defense, e.g. for code paths that
   bypass typecheck).

---

## 3. Key files and line anchors

Don't go hunting — these are the files you will actually touch or
reference.

### Must understand
- `shen/proofs.shen` — `measure`, `fits?`, `mk-font`, `assert-fits`,
  the `layout-proofs` datatype. Line 72–74 is the current `safe-text`
  introduction rule.
- `shen/layout.shen` — `node-types` datatype at line 45–56 with
  `T : safe-text / [text-node T] : node`. This is the *only* place
  `safe-text` is consumed. Lines 123–130 host the Phase 0 runtime
  fallback.
- `shen/witness.shen` — load order. `(tc +)` is enabled only after all
  framework modules load. User `.shen` files are typechecked against
  whatever rules are in scope at that point.
- `astro/runtime.js` — `(tc -)` is set before loading user files in
  the Astro path (line 38-ish). CLI verifiers (`cli/verify.js`) should
  *not* disable tc+ — Phase 4 checks must fire there.

### Will likely need edits
- `shen/proofs.shen` — new datatype(s) or phantom-type machinery.
- `shen/layout.shen` — tighten the `[text-node T]` rule if you split
  `safe-text`; adjust the per-render fallback.
- `shen/props.shen` — if you wire `(max-width Font W)` specs into the
  type context, the bridge lives here + in `astro/runtime.js`.
- `cli/verify.js` — emit a clear "proven-text on untrusted string"
  diagnostic.
- Test additions under `test/` — at minimum a `test/trust.test.js`
  that constructs a bad `.shen` fixture and confirms typecheck rejects
  it.

### Must not break
- `../my-blog/src/chrome/SiteHeader.shen` — uses `proven-text` on
  **literals only**. Should keep compiling.
- `../my-blog/src/chrome/ProjectEntry.shen` — uses `handled-text` on
  prop values with `ellipsis`. Should keep compiling.

---

## 4. Approaches to consider

I did *not* prototype Phase 4 — I deliberately left the design open.
Two sketches, both plausible, with tradeoffs:

### Approach A — Phantom types on the string itself
Split `string` in the caller's view into `trusted-string` and
`untrusted-string`. Literals are trusted by default. `js.get`, prop
accesses, and concatenations yield `untrusted-string`. Require
`proven-text`'s first arg to be `trusted-string`.

```
(datatype trust
  S : string;
  ____________________
  S : trusted-string;)     \\ literals; match via sequent on context

(declare js.get [js-object --> [string --> untrusted-string]])
```

Pros: localized change; doesn't disturb the `safe-text` rule. Cons:
Shen's type system promotes literals to `string` aggressively — you'll
need a rule that injects `: trusted-string` only for literal constants
(Shen's `where`-based local assumptions might suffice; otherwise a
custom tactic).

### Approach B — Split `safe-text` into two tags
Make `[proven-text ...] : proven-safe-text` and
`[handled-text ...] : handled-safe-text`, with `[text-node T]`
accepting either. Then change the `proven-text` introduction rule to
require either (a) a literal or (b) a bound in context (from
`prop-spec` or `where`). The type system already supports `where` on
user `define`s, so "bound in context" is the path that already works
for static analysis elsewhere in Shen.

Pros: incremental; lets the prop-spec layer *earn* the right to call
`proven-text` on a prop value by declaring `(max-width ...)`. Cons:
touches more sites. You'll need to wire prop-spec declarations into
the type context before the component's `render` rule is checked —
that's a real integration, not a comment.

My bet is Approach B is closer to the system's grain. Approach A is
simpler but harder to make Shen actually enforce. Prototype one, stop
if it gets hairy, try the other. Do not merge without `witness-verify`
catching the bad case in tests.

---

## 5. The "dynamic string with runtime bound" question

Phase 0 added a runtime `fits?` check inside `proven-text`'s
`to-textura` branch. That exists precisely because `proven-text` is
being called with dynamic strings today. Once Phase 4 rejects that
pattern, there are two legitimate places a runtime check might still
belong:

1. **Never** — every dynamic string must go through `handled-text`.
   The runtime check is removed. CSS truncation is the only policy.
   *Pro:* honest; no hidden runtime behavior. *Con:* forces authors to
   pick a strategy (ellipsis/clip) even for "this should never overflow
   because the spec says so."

2. **Via a new combinator**, e.g. `checked-text` or
   `runtime-checked-text`: typechecks on any string, runs `fits?` at
   render, throws on failure. Effectively the current behavior but
   named honestly. *Pro:* preserves the "trust but verify" use case.
   *Con:* a third text constructor authors have to learn.

I'd pick (1) and retire the runtime check. `prop-spec` with
`(max-width Font W)` is the right home for "this prop is bounded"; the
enforcement runs at the component boundary, not inside the layout
engine. But that's your call — document whichever you pick and move the
Phase 0 code to match.

---

## 6. Non-goals / don't expand scope

- Don't add a second pinned font. `JetBrains Mono` is enough; widening
  the font set needs its own task.
- Don't rework the Astro integration. `astro/runtime.js`'s `(tc -)` is
  load-order-motivated, not Phase-4-motivated; leave it alone.
- Don't touch `boot.js`'s `pinTextWidths` or `registerFont`. Those are
  geometry work and `bun run test:geometry` is the floor.
- Don't delete the per-render fallback before tests catch its removal.
  Replace, then remove.

---

## 7. How to start

```
cd /Users/reuben/projects/witness
bun test                                    # baseline, must pass
cd /Users/reuben/projects/my-blog && \
  bun run dev --port 5173 --host &          # keep running
cd /Users/reuben/projects/witness && \
  WITNESS_PARITY_HARD_FAIL=1 bun run test:geometry   # baseline
```

Then write the failing test first:

```js
// test/trust.test.js (sketch)
// Fixture that MUST be rejected by typecheck:
//   (define render Props -> [text-node [proven-text (js.get Props "title") (mono 14) 160]])
// Under tc+ this should throw from $.load.
```

Make that test fail for the right reason (currently it *passes* — that
is, shen accepts the module), then implement whichever approach rejects
it. Close by pointing to the updated README section.

---

## 8. One thing to know about Shen-script

`witness/vendor/shen-script/lib/shen.js` is the kernel. It's a port
of Shen to JS, not a 1:1 SBCL equivalent. A handful of type-system
primitives behave differently or are slower. If you hit a case where
SBCL-Shen's type checker accepts something shen-script rejects (or
vice versa), the `cli/verify.js` path is the source of truth because
that's what the Astro build uses. Prototype your type rules in the
REPL (`node -e "..."` wrapping `boot()`) before wiring them into
`proofs.shen`.

If you get stuck, the sequent-calculus-style datatypes in
`shen/proofs.shen` and `shen/layout.shen` are the pattern to follow.
There is no reflection and no macro-expansion trick that will save you
from a misdesigned rule — measure twice.

Good hunting.
