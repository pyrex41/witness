// codegen/ts/demo/consumer-bad.ts
//
// Negative fixture for Gate 5 (freerange numeric-range enforcement).
//
// SELF-CONTAINED ON PURPOSE: per the empirical ground truth for @chenglou/freerange v0.0.2,
// cross-file contracts are NOT enforced (an imported function's console.assert preconditions
// are invisible to freerange at the call site in another file — the caller just counts as
// "unsupported"). So the contracted function AND the bad call site MUST live in the same file
// for freerange to actually catch the violation. This file exists solely to prove Gate 5 is
// live (not vacuously green): it is run directly via
//   ./node_modules/.bin/fr codegen/ts/demo/consumer-bad.ts
// and MUST produce a [declared-requirement] finding.
//
// Design decision (documented per Track A brief step 2, verified empirically against the
// installed @chenglou/freerange@0.0.2 binary):
//
//   `fr <path>` resolves a tsconfig.json by searching upward from `process.cwd()` (NOT from
//   the target file's directory). Two behaviors observed:
//     1. If a tsconfig.json IS found from cwd (e.g. running `fr codegen/ts/demo/consumer-bad.ts`
//        from the repo root, where ./tsconfig.json exists), freerange requires the target file
//        to be a member of that project's "include". Since this file is deliberately EXCLUDED
//        (see "codegen/ts/demo/**" in tsconfig.json's "exclude"), that invocation fails with
//        "File is not part of the project resolved from .../tsconfig.json" — a hard error, not
//        a lint finding, and NOT what Gate 5 wants.
//     2. If NO tsconfig.json is found searching upward from cwd, freerange falls back to
//        analyzing the file standalone ("analyzeFileAlone"), fully independent of the project
//        include/exclude list, and correctly reports the [declared-requirement] violation below.
//
//   So this fixture stays OUT of the main tsconfig "include" (per the agreed interface — it must
//   never be swept into a normal `fr` / `tsc -p tsconfig.json` project-wide run, since it is
//   deliberately broken) and Gate 5 invokes `fr` against its ABSOLUTE path from a neutral cwd
//   (a directory with no tsconfig.json in its parent chain, e.g. a mktemp -d) to force path 2.
//   See run_gate_5() in bin/witness-design-gates.sh for the exact invocation.

const SPACE_2 = 8; // token_values: space-2

// Mirrors the shape of the layout math the card emitter projects from
// (card-contract-shape): a divisor obligation (actionCount >= 1) discharging
// division-by-zero / non-finite results in the slot-width arithmetic.
export function cardActionSlotWidth(available: number, actionCount: number): number {
  console.assert(Number.isInteger(actionCount));
  console.assert(actionCount >= 1);
  return (available - SPACE_2 * (actionCount - 1)) / actionCount;
}

// Deliberately violates the actionCount >= 1 requirement declared above (0 actions ->
// division by zero). freerange must report this as a [declared-requirement] error since
// caller and callee are in the same file.
export function useItBadly(): number {
  return cardActionSlotWidth(268, 0);
}
