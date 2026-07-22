# The Witness fork: cross-file contract enforcement

This is a fork of [chenglou/freerange](https://github.com/chenglou/freerange) at v0.0.2
(commit `4e21242`, "Add Node support"), maintained inside the [Witness](../../) repository
at `vendor/freerange`. It adds one opt-in feature — `fr --cross-file` — and touches nothing
else. Everything below documents that one change: why it exists, what chenglou's own design
notes already say about it, how it is built, how it is meant to be consumed, and an honest
assessment of whether it belongs upstream.

## The gap this closes

freerange checks a function's leading `console.assert` calls as caller requirements and
enforces them at every call site — but only when the caller and the callee are declared in
the same file. A call like `cardActionSlotWidth(268, 0)` against

```ts
function cardActionSlotWidth(available: number, actionCount: number): number {
  console.assert(Number.isInteger(actionCount))
  console.assert(actionCount >= 1)
  return (available - 8 * (actionCount - 1)) / actionCount
}
```

is caught (`[declared-requirement]`, division by an impossible-to-reach-zero-safely
argument) when both live in one file. The same call is silently accepted — no finding, exit
0 — the moment `cardActionSlotWidth` is `import`ed from another file. Verified empirically
against the published `@chenglou/freerange@0.0.2` binary before any of this work started;
see the reproduction at the bottom of this document.

For Witness, whose whole thesis is that layout obligations proven in Shen should propagate
into hand-written TypeScript, that gap was the one thing standing between "the emitted
component is proven safe" and "nothing downstream of the emitter is checked at all," since
any real consumer imports the generated layout helpers rather than pasting them inline.

## chenglou's own stated position on cross-file analysis

Before writing any code, I read `current-decisions.md`, `engineering.md`, and
`goal-prompt.md` in full, because the task brief specifically asked whether cross-file
analysis had already been deliberately ruled out. It has not. Two passages are directly on
point, and they materially shaped the design below rather than just permitting it.

`current-decisions.md`'s "How should module initialization be modeled?" section states the
project's actual boundary precisely:

> Freerange does not build or execute a runtime module-dependency graph. [...] An imported
> binding normally stops the same way — the other module's contents are invisible — with
> one carve-out: an import resolving to `export const NAME = <numeric literal>` in a
> project file reads as that exact constant [...] anything beyond a literal keeps the stop.

So the *existing* cross-file support (imported numeric-literal constants) already resolves
the import target's own declaration through the TypeScript checker and reads project source
outside the current file — the seam this fork extends already existed for constants; it
simply had never been extended to function contracts.

More directly, the "Maybe Reconsider" section — prototypes not shipped for lack of
motivating evidence, explicitly kept open rather than rejected — lists:

> Procedure specifications, also called function contracts, for imported functions. A
> sidecar file similar to `.d.ts` could state `requires` and `ensures` using the same small
> condition language as static assertions, then compile those declarations into function
> summaries. A provider should verify its implementation against the contract when source
> is available; otherwise consumers must see that the contract is trusted rather than
> proven. Pretext's text-measurement functions are a concrete candidate because their
> opaque numeric results currently stop useful layout analysis. Prototype this only when
> imported numeric helpers block a specific proof, and settle representation, validation,
> and bounded caching together.

Witness's `cardActionSlotWidth` case is exactly the "specific proof" this passage asks for
before prototyping. It also states the design chenglou intended: when the provider's source
*is* available (true for every case Witness cares about — its own generated
`card-layout.ts` and any hand-written sibling module in the same project), verify the
contract by analyzing that source, rather than trusting an unverified sidecar file. This
fork follows exactly that: no sidecar `.d.ts`-shaped contract format, no unverified trust —
a cross-file call is only ever checked against a callee whose own file was analyzed and
whose requirements are fully proven (see "What counts as a usable contract" below).

**Conclusion:** cross-file analysis was not ruled out; it was deliberately deferred pending
a concrete blocking case, with a specific design already sketched for when one appeared.
This fork is that case.

## Architecture: where the seam actually is

A file's pipeline, in call order, is:

```
TypeScript source + checker (src/typescript/check.ts, src/typescript/project.ts)
  -> lowerSource (src/lower/program.ts): AST -> ProgramIR, one dense FunctionID
     sequence local to this file
       -> lowerFunction / lowerModuleInitializer (src/lower/module.ts)
            -> lowerExpression (src/lower/expression.ts): call sites resolve
               against context.functionsBySymbol, a same-file-only map built in
               lowerSource from the file's own top-level function declarations
  -> analyzeProgram (src/engine/analyze.ts + src/engine/transfer.ts): abstract
     interpretation over ProgramIR, producing per-function preconditions
     (src/requirements/infer.ts) and, for same-file calls, re-running the
     callee's own IR against the caller's actual argument intervals
  -> collectLintFindings (src/project.ts): turns stops and preconditions into
     the printed [declared-requirement] / [inferred-requirement] / ... findings
```

The exact seam is `src/lower/expression.ts`'s call-lowering, unpatched:

```ts
const symbol = resolvedSymbol(context.checker.getSymbolAtLocation(current.expression), context.checker)
const callee = symbol == null ? undefined : context.functionsBySymbol.get(symbol)
if (callee == null) throw unsupported(current, {kind: 'call', callee: current.expression.text})
```

`resolvedSymbol` already calls `checker.getAliasedSymbol` — for an imported identifier, the
TypeScript checker already resolves straight through to the exporting file's own
`FunctionDeclaration` node, in the *same* `ts.Program` (a project run loads the whole
project graph up front, in `src/typescript/project.ts`). The checker seam Track E's brief
asked me to find was already sitting one line away from being used: `symbol` at that point
*is* the resolved cross-file declaration whenever the callee is imported. The only reason
the call still rejects is that `context.functionsBySymbol` — built once per file, from that
file's own top-level declarations only — has nothing under that symbol.

The harder question was not "how do I find the declaration" but "what do I do with it once
found," because `context.functionsBySymbol.get(symbol)` doesn't just fail to find a name —
same-file calls are checked by a fundamentally single-program mechanism.
`engine/transfer.ts`'s `case 'call'` re-runs the callee's *own IR* against the caller's
actual argument intervals (`context.evaluateFunction`), which requires the callee to live in
the same dense `FunctionID` sequence as the caller — a same-`ProgramIR` operation by
construction. A cross-file callee lives in a different file's `ProgramIR`, with its own
`FunctionID` sequence starting back at 0, so that mechanism has no way to reach it. Merging
two files' `ProgramIR`s into one shared FunctionID space, so a cross-file call could reuse
`case 'call'` verbatim, would be the large rewrite the task brief said to avoid attempting.

## What this fork does instead

It does **not** attempt full interprocedural abstract interpretation across files. It
reuses a narrower mechanism that was already fully built for a different purpose: the
per-function `preconditions: InferredPrecondition[]` list every function's own *standalone*
analysis already produces (seeded with symbolic `{kind: 'parameter', index}` placeholders
instead of the caller's real arguments — this is exactly what `fr --audit`'s `requires:`
lines already print for a function's *own* console.assert-derived requirements, independent
of any caller). Those two requirement kinds — `declaredComparison` and `declaredNumberCheck`
— are structural expression trees with no dependency on which `ProgramIR` produced them.

So, under `--cross-file`:

1. **Resolve.** A call whose symbol is not one of the current file's own top-level
   functions is checked against its resolved `ts.FunctionDeclaration` (found the same way
   `src/lower/cross-file.ts`'s new `CrossFileResolver` classifies it: must be a named
   top-level function declaration in a different project file).
2. **Analyze the callee's own file**, through the *exact same* `lowerSource` +
   `analyzeProgram` pipeline used for every other file — nothing new was built for this
   step; it is one more call to the existing single-file pipeline, memoized per file so a
   function imported by many callers is analyzed once. Import cycles are guarded by a
   "currently analyzing" file set (the cross-file peer of the engine's existing 16-round
   loop-header fixed-point cap and 8-level `valueKind` recursion cap — see
   `maximumCrossFileDepth` in `src/lower/cross-file.ts`): a mutual-import cycle reports
   `{kind: 'cycle'}` instead of recursing forever.
3. **What counts as a usable contract.** Only a callee whose own analysis completed with
   `kind: 'analyzed'` (no stop anywhere in its body) publishes a contract. A callee that is
   itself only `'partial'` is treated as `'unsupported'` for cross-file purposes — its
   requirement list might be missing one past whatever stopped it, and publishing an
   incomplete list would let a caller pass a call off as "checked" when it never was.
4. **Lower the call anyway.** Unlike a normal unsupported call, a resolvable cross-file call
   with a contract lowers into a new `crossCall` instruction instead of aborting the whole
   containing function to `notLowered`. Its engine-time result (`engine/transfer.ts`'s new
   `case 'crossCall'`) is the honest *covering* value for the callee's declared return
   kind — a number with no narrower interval and no `assumes` claim if the return type is
   `number`, opaque otherwise — because nothing here re-verified the callee's body against
   this specific call's arguments, only its already-proven requirements.
5. **Check requirements structurally, at report time.** `src/project.ts`'s new
   `collectCrossFileFindings` walks every `crossCall` instruction in the caller's own
   (already-lowered) IR, expresses each argument as a `NumericExpression` the same way a
   same-file call's requirement propagation already does
   (`src/requirements/infer.ts`'s `numericExpression`), substitutes those expressions for
   the callee's own parameter placeholders in each of its requirements (new
   `substituteParameters`), and folds the result exactly the way an ordinary same-file
   requirement folds once every operand is a literal (`constantRequirementStatus`, unchanged
   — the new `crossFileRequirementStatus` just wraps it). A `false` result becomes a
   `[declared-requirement]` finding with the same message shape as the same-file case,
   pointing at both the call site and the requirement's real declaration site (in the
   callee's file — the `related` field on a lint finding gained an optional `file`, since
   until now every related location was implicitly in the same file as the finding itself).

## What is deliberately weaker than same-file checking, and why that is honest

A same-file call is checked by re-running the callee's body against the caller's actual
*abstract intervals* — it can prove a requirement false even when the argument is not a
literal, e.g. an argument known to be `0` only through a chain of narrowing. A cross-file
call is checked by *structural constant folding* only (`constantRequirementStatus`): it
catches a literal `0`, or arithmetic over literals, or a `const` bound to one, but an
argument that only resolves to `0` through interval reasoning (a branch, a loop, a call
result) folds to "cannot determine" and is silently **not** reported — never wrongly
reported as satisfied, just not checked. This is the same under-approximation
`constantRequirementStatus` already makes for same-file requirements it cannot express; nothing new was introduced, it is just reached more often here because there is no interval
engine backing it across the file boundary. The alternative — merging two files' `ProgramIR`s
so `case 'call'`'s full interval re-evaluation could run across the boundary — is exactly
the large rewrite this fork avoids; see "Upstreamability" below for whether that is worth
building later.

One further, deliberate scope boundary: a cross-file violation is reported as a lint
finding (and fails the CI gate, same as a same-file one), but — unlike a same-file
`requirementFailure` — it does not turn the containing function `'partial'` in the engine's
own bookkeeping. `fr --audit`'s per-function coverage classification and `requires:`/
`ensures:` lines do not yet reflect a cross-file check; only `fr`'s findings output does.
Wiring the cross-file check through the engine's own `Stop`/`RequirementFailure` types (so
`--audit` could show it too) would mean either giving those types a second, foreign-file
`SiteID` representation, or re-plumbing the whole `evaluateFunction` interprocedural
mechanism to be cross-`ProgramIR`-aware — again the large rewrite this fork avoids. The task
this fork was built for only needed the findings-mode gate, so that is the one thing built.

## The default (`--cross-file` absent) is byte-identical

Every existing code path is unchanged when the flag is off: `context.crossFile` is `null`,
`lowerCrossFileCall` returns `null` immediately, and every call to an imported symbol falls
through to the exact same `throw unsupported(current, {kind: 'call', ...})` it always did.
No `crossCall` instruction is ever created without the flag, so
`collectCrossFileFindings`'s walk is a no-op. All 193 tests that shipped with v0.0.2 pass
unmodified against this fork; see "Test results" below.

## Diff summary

```
fr.ts                     |  24 +++--      --cross-file flag parsing, threaded into
                                            runProjectFindings / runFileFindings /
                                            runProjectAudit / runFileAudit
src/analyze.ts             |  12 ++-       analyzeCheckedSource gains an optional
                                            CrossFileResolver parameter
src/engine/transfer.ts     |  10 ++        new case 'crossCall': the honest covering
                                            value for the callee's declared return kind
src/ir/instructions.ts     |  36 +++       new crossCall InstructionIR variant,
                                            CrossFileContract / CrossFileRequirement types
src/lower/context.ts       |   8 ++        FunctionContext gains crossFile: CrossFileResolver | null
src/lower/cross-file.ts    | 127 (new)     the resolver: memoized per-file analysis,
                                            per-function contract extraction, cycle guard
src/lower/expression.ts    | 146 +++---    lowerCallArguments extracted (pure refactor,
                                            reused by both call paths); lowerCrossFileCall,
                                            crossFileReturnKind added
src/lower/module.ts        |   4 +-        lowerModuleInitializer threads crossFile through
src/lower/program.ts       |  13 ++-       lowerSource threads crossFile through
src/project.ts             | 110 +++--     crossFile: boolean threaded through every CLI
                                            entry point; collectCrossFileFindings added;
                                            ErrorLintFinding.related gains an optional file
src/requirements/infer.ts  |  56 ++        substituteParameters, crossFileRequirementStatus
tests/cross-file.test.ts   | 168 (new)     see "Test results"
```

12 files touched, 2 new. No file outside this list was modified.

### A note on the module graph

`src/lower/cross-file.ts` needs a real, value-level import of `src/analyze.ts` (it calls
`analyzeCheckedSource` to analyze a callee's file) — but `src/lower/context.ts` and
`src/lower/expression.ts`, which `src/analyze.ts` transitively depends on through
`src/lower/program.ts`, only need `CrossFileResolver` as a *type*. Both use
`import type {CrossFileResolver} from './cross-file.ts'`, which TypeScript erases entirely
at compile time — `bun build`'s bundle output confirms there is no runtime cycle (30 modules
bundle cleanly). `current-decisions.md` already states that a type-only import cycle is a
non-issue in this codebase; `ir/instructions.ts` and `requirements/model.ts` already formed
one before this fork (instructions.ts's `ComparisonOperator`/`ArithmeticOperator` come from
requirements/model.ts's operand types, and requirements/model.ts's `InferredPrecondition`
comes from instructions.ts) and this fork's new `CrossFileContract` type — which embeds an
`InferredPrecondition` — closes that same cycle one more time, not a new one.

## How to build

```bash
cd vendor/freerange
bun install    # first checkout only
bun run build  # bun build fr.ts --target=node --packages=external
               # --banner="#!/usr/bin/env node" --outfile=dist/fr.js
```

`dist/fr.js` is a single self-contained file (`typescript` stays an external
`require`/`import`, per `--packages=external`) and runs under plain `node`, not just `bun`:

```bash
node vendor/freerange/dist/fr.js --cross-file
node vendor/freerange/dist/fr.js --cross-file --audit some/file.ts
```

## How Witness would consume it

Point Witness's own `package.json` dependency at this vendored build instead of the npm
package, e.g. a `file:` reference to `vendor/freerange` (bun and npm both resolve a `file:`
dependency's own `package.json` `bin` field, which still points at `dist/fr.js`), or copy
`dist/fr.js` directly into wherever the existing `@chenglou/freerange@0.0.2` binary is
referenced from (`node_modules/.bin/fr` today). Either way, Gate 5 (per the agreed
interface: `bin/witness-design-gates.sh`, dispatch `5|fr|freerange|numeric|range`) should
invoke it with `--cross-file` so it actually checks the emitted `card-layout.ts`'s
requirements against any hand-written consumer TypeScript that imports it — the entire
point of this fork. Without `--cross-file`, this build behaves exactly like the unpatched
0.0.2, so switching the binary alone changes nothing until the gate also passes the flag.

## Test results

New tests, `tests/cross-file.test.ts` (all against the built CLI end-to-end via
`Bun.spawnSync`, in the same style as `tests/project-report.test.ts`):

- **a cross-file requirement violation is invisible without `--cross-file` and caught with
  it** — writes a two-file fixture (`lib.ts` with the `cardActionSlotWidth` contract,
  `consumer.ts` calling it with a literal `0`), runs `fr` both without and with the flag in
  the same process, and checks: without the flag, exit 0, "No lint findings.",
  `1/2 ... fully analyzed; 0 partially supported; 1 unsupported`; with the flag, exit 1, a
  `[declared-requirement]` finding at the call site in `consumer.ts`, whose `related`
  "declared at" location is in `lib.ts` (not misattributed to the caller's own file) — and
  also checks `fr consumer.ts --cross-file` (the narrowed-to-one-file path) still resolves
  the import against the whole project's sources.
- **a satisfying cross-file call is clean, and the caller is genuinely analyzed rather than
  left unsupported** — the same fixture with a valid argument (`4` instead of `0`): exit 0,
  "No lint findings.", and — the check that actually distinguishes "really checked and
  passed" from "silently still unsupported" — coverage reads
  `2/2 ... fully analyzed; 0 partially supported; 0 unsupported`, which could not happen if
  `lowerCrossFileCall` were merely suppressing the old unsupported-call rejection instead of
  genuinely lowering and checking the call.
- **a mutual import cycle terminates under `--cross-file` instead of recursing forever** —
  `a.ts` and `b.ts` import and call each other; run under a 10-second `Bun.spawnSync`
  timeout and asserts the process exited on its own (`signalCode` is not `'SIGTERM'`, the
  value Bun reports when a spawn timeout kills the process) rather than hanging. Manually
  verified outside the test too (`time (...)` in a scratch directory): completes in well
  under a second, both functions report as unsupported (the honest outcome — neither side of
  a cycle can produce a trustworthy contract for the other), exit 1.

Full suite: `bun test` — **196 pass, 0 fail** (the 193 tests that shipped with v0.0.2,
unmodified, plus the 3 above). `node node_modules/@typescript/native/bin/tsc --noEmit -p
tsconfig.json` (TS 7) and `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
(TS 6, the version freerange's own `package.json` depends on) both report zero errors.
`oxlint --type-aware` and `bun knip` (via `bun run check`'s other two steps — `bunx
@typescript/native` itself failed only because this sandbox has no network access to
re-resolve an already-installed package; the two steps that matter for this diff run clean)
both exit 0 with no findings.

### The motivating case, reproduced against the published binary

```bash
$ cd /tmp/some-project   # tsconfig.json with strict: true, lib.ts + consumer.ts as above

$ node_modules/.bin/fr --cross-file    # published @chenglou/freerange@0.0.2: no such flag,
                                        # and the call is silently unsupported regardless
No lint findings.
0 findings (0 errors, 0 warnings).
coverage: 1/2 named top-level function declarations fully analyzed; 0 partially supported; 1 unsupported.

$ bun vendor/freerange/fr.ts                 # this fork, flag off: identical to 0.0.2
No lint findings.
0 findings (0 errors, 0 warnings).
coverage: 1/2 named top-level function declarations fully analyzed; 0 partially supported; 1 unsupported.

$ bun vendor/freerange/fr.ts --cross-file    # this fork, flag on: catches it
consumer.ts(4,10): error [declared-requirement]: call to cardActionSlotWidth makes its declared requirement definitely false (declared at lib.ts(3,3))
1 finding (1 error, 0 warnings).
coverage: 2/2 named top-level function declarations fully analyzed; 0 partially supported; 0 unsupported.
```

`node vendor/freerange/dist/fr.js --cross-file` (the built artifact, run under plain `node`
rather than `bun`, matching how Witness would actually invoke it) reproduces the same
output.

## Upstreamability: an honest assessment

**Worth proposing, but not as-is.** The strongest argument for upstreaming is that
`current-decisions.md` already names this exact feature as wanted, already sketches
(loosely) the right design point — verify against the callee's real source when available —
and this fork's structural-substitution mechanism reuses machinery (`InferredPrecondition`,
`numericExpression`, `constantRequirementStatus`) that chenglou already built and already
uses for a closely related purpose, rather than introducing a parallel system.

What would need to change before this is a PR chenglou would likely accept, based on how
`current-decisions.md` and `engineering.md` describe their own standards:

- **The coverage/`--audit` gap above is a real gap, not just a note.** chenglou's own prose
  treats `fr --audit`'s `requires:`/`ensures:` lines as *the* contract surface; a check that
  only shows up in `fr`'s findings and not in `--audit` is an inconsistent story for a
  maintainer who cares about that consistency as much as `current-decisions.md` suggests he
  does. Closing it means deciding how a cross-file `RequirementFailure` should carry a
  foreign file's location — a real design decision, not a mechanical extension, since
  `RequirementFailure` and `StopReason.requirementFailure.callee` were built assuming one
  `ProgramIR` throughout.
- **The weaker-than-same-file checking should be an explicit, documented trade-off in
  `current-decisions.md` itself**, not just this document — chenglou's writing style
  consistently states what a feature does *not* prove alongside what it does (see the
  "Additional decisions" and "Punted" sections), and a maintainer accepting this would
  almost certainly want that same treatment for "cross-file checking folds constants only,
  it does not re-run the callee's body against the caller's intervals."
- **Only fully `'analyzed'` callees produce a contract; `'partial'` callees are silently
  treated as unsupported.** That is the conservative, honest choice, but it means a
  moderately complex real-world callee (anything with one unrelated unsupported construct
  anywhere in its body) gets zero cross-file benefit even for requirements proven before the
  unsupported point. chenglou's own "Assertions in partially analyzed functions" entry in
  "Maybe Reconsider" is the direct precedent for revisiting this, and doing so here would
  compound two open design questions into one PR rather than one.
- **No `--cross-file` flag exists in the upstream CLI's vocabulary at all**, and whether
  cross-file checking should be opt-in forever, opt-in with a path to becoming default, or
  something scoped differently (e.g. only within one `tsconfig.json`'s project, never across
  `references`) is chenglou's call to make, not this fork's.

None of these are reasons to abandon the approach — they are exactly the kind of scope
questions `current-decisions.md`'s own "Prototype this only when imported numeric helpers
block a specific proof, and settle representation, validation, and bounded caching together"
sentence anticipates needing answered before shipping. This fork answers "does a concrete
blocking case exist and does the approach work" with a working, tested yes. It does not
answer the audit-surface and partial-callee questions, and a real PR should not paper over
that gap — it should raise it, most likely as a discussion issue with this fork linked as a
proof of concept, before a PR that tries to settle all four points at once.
