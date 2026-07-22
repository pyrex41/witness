# Using Witness from another project

Witness ships two separable things: the **proof machinery** (Shen kernel, the
Pretext ruler, the gate runner) and **witness's own contracts** (the Card). A
consuming project wants the first and none of the second.

Everything below is a package/project split. Witness is the *package*; your repo
is the *project*. The gates read the project's files and use the package's
machinery.

## Install

```bash
npm install github:pyrex41/witness
npm install -D @chenglou/freerange    # only if you want Gate 4
```

`canvas` builds natively; on Linux CI you need
`libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg8 libgif7 librsvg2-2`.

## What you must provide

| path (under your repo) | role |
|---|---|
| `specs/ui/properties/*-properties.shen` | your contracts + nullary boolean theorems (Gate 2 discovers these) |
| `specs/design/*.shen` | **constructions** of your contract values — Gate 1's payload |
| `shen/witness-sbcl.shen` | your prelude (see below) |
| `.witness/measurements.shen` | the measurement cache; generated, but commit it |
| `codegen/emitters/*-emitter.js` | your emitters (Gate 3 discovers these) |
| `tsconfig.json` | only for Gates 3/4, and it must set `strictNullChecks` |

### The prelude

Your prelude loads witness's Shen modules by their *package-relative* paths and
then your own contracts. `boot()` searches your project root first and falls
back to the witness package, so `shen/proofs.shen` resolves inside the package
while `specs/ui/properties/…` resolves inside your repo:

```shen
(load "shen/proofs.shen")
(load "shen/errors.shen")
(load "shen/tailwind.shen")
(load "shen/trust.shen")

\\ --- UI component properties (auto-discovered + maintained by tiny generic loader) ---
(load "specs/ui/properties/badge-properties.shen")
\\ --- End UI component properties loads ---

(tc +)
```

Keep the two marker comments verbatim — `witness-component-loader.js --update`
rewrites what is between them.

## Run the gates

```bash
npx witness gates --project-root "$PWD"
# or
WITNESS_PROJECT_ROOT="$PWD" bash node_modules/witness/bin/witness-design-gates.sh
```

Individual directories are overridable if your layout differs:
`WITNESS_DESIGN_SPECS_DIR`, `WITNESS_PROPERTIES_DIR`, `WITNESS_EMITTERS_DIR`,
`WITNESS_GENERATED_DIR`, `WITNESS_TSCONFIG`.

Without `--project-root`, the gates check **witness's own** contracts. That is a
self-test of the installed dependency and says nothing about your code.

## Seeding the measurement cache

Every literal text/font pair behind a `fits?` obligation must be in
`.witness/measurements.shen` or the proof raises. Gate 1 regenerates it from
`specs/design/` automatically, but the extractor only recognises the *call*
forms `(fits? "t" "font" N)`, `(assert-fits …)` and `(proven-text …)` — not the
data forms (`[badge "NEW" "14px sans-serif" 60]`) that contract constructions
typically use. Seed it explicitly for any file Gate 1 does not scan:

```bash
WITNESS_PROJECT_ROOT="$PWD" node node_modules/witness/cli/measure.js \
  specs/ui/properties/badge-properties.shen
```

The cache is written to **your** `.witness/`, not into `node_modules`.

## Writing an emitter

Gate 3 discovers `codegen/emitters/*-emitter.js` (excluding `*stub*` and
`demo-*`). The contract is:

| export | required | purpose |
|---|---|---|
| `emit(opts) → Promise<{[filename]: string}>` | yes | produce the artifacts |
| `emitWithMeta(opts) → Promise<{files, shape}>` | preferred | lets checks compare against the *live* contract instead of literals |
| `fidelityChecks: [{label, test(files, meta)}]` | strongly recommended | **an emitter with none is trivially green** |
| `outDirName: string` | recommended | subdirectory under `generated/`; defaults to the filename stem |
| `runSemanticVerification() → {pass, failures[]}` | optional | measured geometry vs. the proven bounds |

`emit({writeToDisk: true})` must write to `generated/<outDirName>/`, and what it
writes must byte-match what it returns — Gate 3 diffs the two, so a stale or
hand-edited generated file fails the gate.

Read your contract out of Shen rather than hardcoding it:

```js
const { boot } = require('witness');
const $ = await boot({ skipLoad: true, projectRoot: PROJECT_ROOT });
await $.load(path.join(PROJECT_ROOT, '.witness', 'measurements.shen'));
await $.load(path.join(PROJECT_ROOT, 'shen', 'witness-sbcl.shen'));
const raw = await $.exec('(badge-contract-shape)');
```

## Prove your gates can fail

Do this once per component, and keep a way to reproduce it:

- **Gate 1** — shrink a bound below the measured width; expect a type error
  naming the definition.
- **Gate 2** — a theorem returning `false` fails; so does finding none at all.
- **Gate 3** — change the contract without regenerating; expect
  "on disk differs from what the emitter produces".

A gate that has never been observed failing is decoration.

## Known limits

- **Gate 4 is TypeScript-only.** freerange analyses `.ts`; there is no
  equivalent for other target languages. A non-TS emitter gets Gates 1–3.
- **freerange does not enforce across `import`s** (v0.0.2), so an emitted module
  must keep its `console.assert` contracts and their call sites in one file.
- **Descriptor keys are TypeScript-flavoured.** The reference Card contract
  carries `jsType` / `jsBrand` / `factory` in the Shen descriptor. A non-TS
  target needs its own keys added to its own contract.
