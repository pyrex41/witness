# Witness tutorial: from clone to caught overflow

A step-by-step walkthrough of the demo, with every command you need and the
output you should expect. There is a narrated video of the same walkthrough:
[`docs/video/witness-tutorial.mp4`](video/witness-tutorial.mp4) (about four
minutes).

If you only read one section, read [Where does Witness run?](#where-does-witness-run)
first. It is the question people ask most.

---

## Where does Witness run?

Witness has two sides. Keep them apart and the rest makes sense.

**1. The build side: where the proofs run.** This is always **Node.js on your
dev machine or in CI**. You don't install a Shen compiler. Shen runs in-process
through ShenScript, which is vendored in `vendor/shen-script`. Text is measured
with Pretext on a `node-canvas` canvas, so no browser is involved either.

| Requirement | Notes |
|---|---|
| Node.js 20+ | CI runs Node 20. Node 22 works too. |
| macOS or Linux | `canvas` is a native module. macOS gets a prebuilt binary. On Linux you may need `libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev` (Debian/Ubuntu names). |
| `npm install` | This pulls in everything else: Pretext, Textura/Yoga, freerange, and TypeScript. |
| *Optional:* Go + [`ratatoskr`](https://github.com/pyrex41/ratatoskr) | Needed only for `docs/shake-demo.sh`, the tree-shaking tour. |
| *Optional:* `shen-cl` / `shen-sbcl` | Needed only to cross-check against a native Shen kernel (`WITNESS_SHEN_ENGINE=native`). |

**2. The output side: what you ship.** The proofs are erased. What you ship
never contains a type checker. It is one of the following:

| Target | How | Status |
|---|---|---|
| Static HTML | `node cli/check.js render file.shen --output out.html` | works |
| Astro sites | `import witness from 'witness/astro'` lets you import `.shen` components into `.astro` pages (see `astro/index.js`) | works |
| React / TSX | The Card emitter writes typed `Card.tsx`, CSS, and layout TS from the Shen contract. Gates 3 and 4 check the output. | works, Card only |
| Any Shen port | The pure proof core tree-shakes to about 100 functions and runs byte-identically on shen-go, shen-lua, ShenScript, and shen-swift | works (needs ratatoskr) |
| Browser DOM runtime | `shen/tea.shen` + `shen/dom.shen` | library exists, no browser harness yet |

So "does it run in the browser?" has two answers. The proof doesn't run there.
The layout it proved does.

### Fonts: the one environment detail that changes numbers

The ruler measures with the fonts on the **build machine**. A generic family
like `sans-serif` resolves to Helvetica or Arial on macOS and to DejaVu Sans on
most Linux boxes, which is wider. The same string therefore gets different
widths:

| | macOS | Linux (DejaVu Sans) |
|---|---|---|
| `"A Very Long Card Title That Will Definitely Overflow"` @ 18px `sans-serif` | ~410px | ~462px |

The verdict is the same on both: neither fits in 268px. The pixel counts in
error messages will still differ, though. The docs were written on macOS, so if
your numbers don't match them, this is why.

For proofs that describe what users actually see, don't measure generic
families. Measure the real face. Register it in `.witness/fonts.json`
([`docs/CONSUMING.md`](CONSUMING.md)) or use the pinned `JetBrains Mono` that
`boot.js` registers. Witness refuses to measure a named font it can't find,
because a substitute font would make the proof lie.

---

## Step 0: Install

```bash
git clone https://github.com/pyrex41/witness
cd witness
npm install
```

To check the install, run the test suite (about 30 seconds):

```bash
npm test
```

Every block should end in `0 failed`.

## Step 1: A proof that passes

`examples/card.shen` is a card whose title, description, and buttons live in
fixed-width boxes. Loading it runs every `assert-fits`, which means it really
measures each string:

```bash
node cli/check.js dev examples/card.shen
```

```
Checking examples/card.shen...
  ✓ examples/card.shen passed
```

The real contract is in `specs/ui/card-spec.shen`. `examples/card.shen` is a
thin wrapper that loads it.

## Step 2: An overflow that doesn't compile

`examples/card-overflow.shen` makes one change: the title is long.

```shen
(assert-fits "A Very Long Card Title That Will Definitely Overflow" (mk-font "sans-serif" 18) 268)
```

```bash
node cli/check.js dev examples/card-overflow.shen
```

```
Checking examples/card-overflow.shen...
  ✗ examples/card-overflow.shen: Layout overflow: 'A Very Long Card Title That Will Definitely Overflow' in 18px sans-serif = 462.1025390625px, container = 268px
    [W0200] A Very Long Card Title That Will Definitely Overflow in 18px sans-serif = 462.1025390625px, container = 268px
    Suggestions:
      - Add truncate/ellipsis overflow [trivial, confidence=1]
      - Widen container to 463px [trivial, confidence=0.95]
      - Use smaller font [small, confidence=0.9]
```

The command exits non-zero, so CI goes red. The error is structured, with a
code, a measurement, and ranked fixes, so a person or an agent can act on it.
Your pixel count depends on your fonts ([see above](#fonts-the-one-environment-detail-that-changes-numbers)).

## Step 3: Render the proven layout to HTML

```bash
node cli/check.js render examples/card.shen --output card.html
open card.html        # or xdg-open on Linux
```

The output is absolutely-positioned HTML. Every box comes from the Yoga layout
that was computed at build time. Text that went through `handled-text` gets
real CSS truncation (`text-overflow: ellipsis`).

## Step 4: Let an agent fix it

`cli/agent.js` reads the structured error, applies the top fix it can make
mechanically (widening the container), and re-checks until the file is clean.
**It rewrites the file in place**, so run it on a copy:

```bash
cp examples/card-overflow.shen /tmp/fix-me.shen
node cli/agent.js /tmp/fix-me.shen
diff examples/card-overflow.shen /tmp/fix-me.shen
```

```
Iteration 1: 1 error
  [W0200] A Very Long Card Title That Will Definitely Overflow in 18px sans-serif = 462.1025390625px, container = 268px
  ...
  Applied fix: widened 268 -> 463 (2 occurrences in /tmp/fix-me.shen)
Done in 2 iterations
```

## Step 5: The design gates

This is the same proof machinery pointed at Witness's own component contracts.
The CI workflow runs it on every push:

```bash
npm run gates
```

| Gate | What it checks |
|---|---|
| 1 | Type-checks `specs/design/*.shen` with `tc+`. Every `if (fits? …)` side condition runs the real ruler. |
| 2 | Finds the property theorems in `specs/ui/properties/*.shen` and runs them. All must return `true`. |
| 3 | Emitter fidelity. The generated `Card.tsx`/CSS/TS must byte-match a fresh emit, pass `tsc`, and pass the semantic checks. |
| 4 | freerange numeric-range analysis over the generated TypeScript. |

The full suite takes about 12 seconds. Run one gate with
`./bin/witness-design-gates.sh --gate 3`. To gate *your* project instead of
Witness itself, see [`docs/CONSUMING.md`](CONSUMING.md).

## Step 6: Numeric bounds on layout math (freerange)

Proofs cover text. freerange covers the arithmetic around it. The clean example
analyzes cleanly:

```bash
./node_modules/.bin/fr examples/ts/grid-layout.ts
```

The broken example is excluded from the project `tsconfig.json` on purpose.
Because freerange resolves its tsconfig from the current directory, you have
to run it from a neutral directory:

```bash
(cd "$(mktemp -d)" && "$OLDPWD/node_modules/.bin/fr" "$OLDPWD/examples/ts/grid-layout-broken.ts")
```

```
…/examples/ts/grid-layout-broken.ts(42,10): error [declared-requirement]: call to gridItemWidth makes its declared requirement definitely false
1 finding (1 error, 0 warnings).
```

`bash docs/freerange-demo.sh` gives the full narrated tour.

## Step 7 (WIP): Figma structural diff

```bash
node cli/check.js check --figma examples/card-design.json examples/card.shen
```

This compares node positions and sizes, not pixels, against a Figma-shaped
JSON export. It is **work in progress**. The parser reads only `name`,
`absoluteBoundingBox`, and `children`, and it hasn't been validated against a
real Figma REST export. Against the bundled hand-made fixture, the current card
**reports drift**:

```
  ✗ Figma verification failed: structural drift detected
    - unnamed node #1 (matched by position): height 124 in Figma, 130 in code
    - unnamed node #2 (matched by position): width 268 in Figma, 87 in code; height 20 in Figma, 26 in code
    ...
```

The fixture says the title spans the full 268px content width. In the code,
the title node shrinks to fit its text, and its line height depends on the
host font. So the check is doing its job: it reports how the design file and
the code disagree. There is no pass to show here yet.

---

## Where to go next

- [`README.md`](../README.md): the pitch, the tier model, and what's implemented.
- [`docs/DEMO.md`](DEMO.md): the same demo with screenshots.
- [`docs/CONSUMING.md`](CONSUMING.md): run the gates against your own project.
- [`WITNESS_LEAN.md`](../WITNESS_LEAN.md): the spec and roadmap.
- [`docs/video/`](video/): the narrated video, plus the script that rebuilds it.
