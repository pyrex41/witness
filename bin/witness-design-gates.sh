#!/bin/bash
# bin/witness-design-gates.sh
#
# Design-fidelity gate runner. The same proof machinery that makes layout overflow a
# compile-time error for users is turned on Witness's own contracts: the specs are
# constructed and type-checked, the theorems executed, the emitter regenerated and
# diffed, and the emitted TypeScript checked by freerange.
#
# Four gates:
#   Gate 1: tc+ on specs/design/*.shen — constructs the canonical contracts, so the type
#           checker evaluates each `if (fits? ...)` side condition against a real Pretext
#           measurement. Fails when a slot's text exceeds its bound.
#   Gate 2: Property theorems — discovered by shape in specs/ui/properties/*.shen and
#           EXECUTED; false / erroring / none-found all fail.
#   Gate 3: Emitter fidelity — regenerate from the live (card-contract-shape), diff against
#           what is committed, run the emitter's fidelityChecks against the contract, tsc,
#           and a semantic check that measures each emitted slot unclamped against its bound.
#   Gate 4: Numeric range enforcement — freerange over the emitted TypeScript.
#
# Integrity of the source files is provided by git + review, not a self-hashed manifest.
#
# Usage:
#   ./bin/witness-design-gates.sh            # all four
#   ./bin/witness-design-gates.sh --quick    # Gates 1 + 2 only
#   ./bin/witness-design-gates.sh --gate 3   # a single gate
#   npm run gates

set -euo pipefail

# SCRIPT_DIR is the witness PACKAGE — where the proof machinery (cli/, boot.js,
# vendor/shen-script) lives. It is derived from this script's own location, so it
# is correct whether the script is run from a checkout or from node_modules.
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# PROJECT_ROOT is the codebase being GATED. It defaults to the witness package,
# so running this inside the witness repo behaves exactly as it always has. A
# consuming project points it at itself — via --project-root or
# WITNESS_PROJECT_ROOT — and the gates then discover ITS specs, theorems and
# emitters instead of witness's own. Before this split every directory below was
# SCRIPT_DIR-derived, so a downstream `npx witness gates` silently re-gated the
# installed dependency and reported green without ever seeing the caller's code.
PROJECT_ROOT="${WITNESS_PROJECT_ROOT:-$SCRIPT_DIR}"

# Individually overridable so a project with a different layout can adopt the
# gates without renaming its directories. Each defaults to the conventional path
# under PROJECT_ROOT.
DESIGN_SPECS_DIR="${WITNESS_DESIGN_SPECS_DIR:-}"
PROPERTIES_DIR="${WITNESS_PROPERTIES_DIR:-}"
EMITTERS_DIR="${WITNESS_EMITTERS_DIR:-}"
GENERATED_DIR="${WITNESS_GENERATED_DIR:-}"
PROJECT_TSCONFIG="${WITNESS_TSCONFIG:-}"

# Prefer shen-cl (faster kernel from https://github.com/pyrex41/shen-cl)
# Fall back to official shen-sbcl if shen-cl is not installed or fails basic smoke test
# (some builds have REPL/tty problems in headless environments; local dev machines are usually fine).
test_shen() {
  local bin="$1"
  if ! command -v "$bin" &> /dev/null; then
    return 1
  fi
  if echo '(+ 1 1)' | timeout 4 "$bin" 2>&1 | grep -Eq 'Error opening /dev/tty|not of type|fatal error'; then
    return 1
  fi
  return 0
}

# Phase 2 engine. Default is ShenScript (in-process, via cli/shen-check.js) — it
# needs no native binary, no pty wrapper, and no availability probe, and runs the
# design specs in ~1s instead of the many minutes the native path can take here.
# See the header of bin/witness-check.sh for the full rationale.
WITNESS_SHEN_ENGINE="${WITNESS_SHEN_ENGINE:-shenscript}"

if [ "$WITNESS_SHEN_ENGINE" = "shenscript" ]; then
  SHEN_BIN="ShenScript (in-process)"
elif [ -n "${SHEN_BIN:-}" ] && test_shen "$SHEN_BIN"; then
  : # user override works
elif test_shen shen-cl; then
  SHEN_BIN="shen-cl"
elif test_shen shen-sbcl; then
  SHEN_BIN="shen-sbcl"
else
  echo "ERROR: No working Shen binary found (WITNESS_SHEN_ENGINE=native was requested)."
  echo "Either install shen-cl / shen-sbcl (see bin/witness-check.sh) or use the"
  echo "default in-process engine: WITNESS_SHEN_ENGINE=shenscript"
  exit 1
fi
export WITNESS_SHEN_ENGINE

# Color setup (CI-safe: disabled when stdout is not a tty)
setup_colors() {
  if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
  else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
  fi
}

print_gate_header() {
  local num="$1" desc="$2"
  echo -e "${BOLD}${BLUE}Gate $num: ${desc}${NC}"
  echo -e "  ${YELLOW}started $(date '+%Y-%m-%d %H:%M:%S')${NC}"
}

fail_gate() {
  local num="$1" msg="$2"
  echo -e "${RED}✗ Gate $num FAILED${NC}: $msg"
  echo ""
  echo -e "${YELLOW}Actionable fixes:${NC}"
  echo "  1. Read the failure details above."
  echo "  2. Consult specs/design/README.md for the contracts and how they map to source."
  echo "  3. Either fix the implementation to restore the invariant, or (if the design"
  echo "     itself evolved) update the spec in specs/design/ or specs/ui/."
  echo "  4. Re-run: ./bin/witness-design-gates.sh   (or npm run gates)"
  echo ""
  exit 1
}

# --- Gate implementations ---

run_gate_1() {
  local gate_start=$SECONDS
  print_gate_header 1 "Type-checking design specs (tc+ via Witness proof engine)"
  echo "  Discovers specs/design/*.shen and runs them through bin/witness-check.sh"
  echo "  (Phase 1: Node/Pretext measure of all text/font; Phase 2: $SHEN_BIN (tc+))."
  echo "  The design specs CONSTRUCT contract values; tc+ evaluates each contract's"
  # Single-quoted: backticks inside a double-quoted string are command
  # substitution, so this line ran `if` as a command and emitted a bash syntax
  # error into the middle of Gate 1's banner on every single run.
  echo '  `if` side condition, which runs the real Pretext ruler over the declared text.'
  echo ""
  if [ ! -d "$DESIGN_SPECS_DIR" ]; then
    fail_gate 1 "$DESIGN_SPECS_DIR does not exist. Create specs/design/ and add witness-core.shen (or run future 'witness design-init')."
  fi

  local DESIGN_FILES=($(find "$DESIGN_SPECS_DIR" -name "*.shen" | sort))
  if [ ${#DESIGN_FILES[@]} -eq 0 ]; then
    echo "  (no *.shen files in $DESIGN_SPECS_DIR — nothing for tc+ to check; vacuously passed)"
    local elapsed=$(( SECONDS - gate_start ))
    echo -e "  ${GREEN}✓ Gate 1 passed${NC} (vacuous) [${elapsed}s]"
    echo ""
    return 0
  fi

  echo "  Design specs under test:"
  for f in "${DESIGN_FILES[@]}"; do
    echo "    - ${f#$PROJECT_ROOT/}"
  done
  echo ""

  # Delegate to the battle-tested two-phase checker (exactly as current design intends)
  if ! "$SCRIPT_DIR/bin/witness-check.sh" "${DESIGN_FILES[@]}"; then
    fail_gate 1 "One or more design specs failed tc+ (type error, unprovable :verified premise, or layout overflow in a design claim). See output above."
  fi

  local elapsed=$(( SECONDS - gate_start ))
  echo -e "  ${GREEN}✓ Gate 1 passed${NC} (design specs constructed; every if side condition evaluated against real measurements) [${elapsed}s]"
  echo ""
}

run_gate_2() {
  local gate_start=$SECONDS
  print_gate_header 2 "Property proofs (design theorems executed)"
  echo "  Runs cli/theorem-run.js: discovers every nullary boolean theorem in"
  echo "  specs/ui/properties/*.shen and EXECUTES it. A theorem that returns false"
  echo "  fails the gate; so does one that errors; so does finding none at all."
  echo ""
  echo "  This gate was previously two echo calls — no command, no exit code, no"
  echo "  dependency on Gate 1 — so it passed on an empty checkout, and the three"
  echo "  theorems its banner named did not exist anywhere in the repo."
  echo ""

  if ! node "$SCRIPT_DIR/cli/theorem-run.js" --properties-dir "$PROPERTIES_DIR"; then
    echo ""
    echo -e "${RED}✗ Gate 2 FAILED${NC}: a design theorem does not hold."
    echo ""
    echo -e "${YELLOW}Actionable fixes:${NC}"
    echo "  1. The named theorem returned false — the property it asserts is no longer"
    echo "     true of the contracts. Either the contract changed (fix the contract) or"
    echo "     the property was wrong (fix or retire the theorem)."
    echo "  2. If it ERRORED, the theorem calls something undefined in the tc- prelude;"
    echo "     check specs/ui/properties/*.shen and shen/witness-sbcl.shen's load block."
    echo "  3. Theorems are discovered by shape — a nullary (define name {--> boolean} ...)"
    echo "     in specs/ui/properties/. Adding a component adds its theorems automatically."
    echo ""
    exit 1
  fi

  local elapsed=$(( SECONDS - gate_start ))
  echo -e "  ${GREEN}✓ Gate 2 passed${NC} (every discovered property theorem executed and holds) [${elapsed}s]"
  echo ""
}

run_gate_3() {
  local gate_start=$SECONDS
  print_gate_header 3 "Emitter fidelity (shen-witness codegen — fidelity convention + tsc + semantic)"
  echo "  Auto-discovers codegen/emitters/*-emitter.js (non-stub), boots Shen via each,"
  echo "  walks its verified-* contracts (high-level path preferred), emits branded .tsx/.css"
  echo "  (+ richer), runs the emitter'\''s own declared fidelityChecks[], tsc --noEmit on .tsx,"
  echo "  and (for Card) runs *real* factories (createCardTitle/createCard...) to build"
  echo "  VerifiedCard, feeds it to headless Textura/Yoga+Pretext, and compares geometry"
  echo "  against the proven obligations (maxWs, gap arithmetic, layout-obligations)."
  echo "  Marker checks + tsc = fast path. Semantic = actual verifier (opt-out: WITNESS_GATE4_SEMANTIC=0)."
  echo "  The Card emitter is the reference; new components are protected automatically."
  echo "  Drift = gate fail. Legacy low-level path remains 100% working."
  echo ""
  echo "  (Card-specific --emit path and early existence check kept for regeneration UX;"
  echo "   the check phase itself is now fully general via the emitter convention.)"
  echo ""

  local do_emit=false
  if [ "$EMIT" = true ]; then do_emit=true; fi

  # Emitters are discovered, not named. This used to hard-fail unless
  # codegen/emitters/card-emitter.js existed by that exact filename, which made
  # the gate unusable for any project that does not ship witness's own Card.
  if [ ! -d "$EMITTERS_DIR" ]; then
    fail_gate 3 "emitters directory not found: $EMITTERS_DIR (set WITNESS_EMITTERS_DIR or --project-root)"
  fi
  local EMITTER_PATHS=($(find "$EMITTERS_DIR" -maxdepth 1 -name "*-emitter.js" \
    ! -name "*stub*" ! -name "demo-*" | sort))
  if [ ${#EMITTER_PATHS[@]} -eq 0 ]; then
    fail_gate 3 "no *-emitter.js found in $EMITTERS_DIR"
  fi

  # Run each emitter (it prints a summary on CLI; we also invoke programmatically below)
  echo "  Invoking ${#EMITTER_PATHS[@]} emitter(s)..."
  for emitter_path in "${EMITTER_PATHS[@]}"; do
    if $do_emit; then
      echo "  (write mode: ${emitter_path##*/} artifacts will be written under $GENERATED_DIR/)"
      if ! node "$emitter_path" --emit 2>&1; then
        fail_gate 3 "${emitter_path##*/} failed during --emit write (see output above)"
      fi
    else
      if ! node "$emitter_path" 2>&1 | tail -5; then
        fail_gate 3 "${emitter_path##*/} failed to produce artifacts (see output above)"
      fi
    fi
  done

  # Programmatic fidelity check — now uses the fidelity convention:
  #   auto-discover codegen/emitters/*-emitter.js (excluding stubs)
  #   require each, call emit({writeToDisk:false})
  #   run every exported .fidelityChecks entry (test fn over the files map)
  #   + strengthened: for any *.tsx output, run tsc --noEmit (with React shim + temp tsconfig)
  #     using local ./node_modules/.bin/tsc if present, else npx --yes typescript (cached)
  # This makes Gate 3 discover+enforce for new components with zero changes to this script.
  echo "  Running fidelity assertions (auto-discover emitters + declared fidelityChecks + tsc on TS)..."
  export SCRIPT_DIR EMITTERS_DIR GENERATED_DIR PROJECT_ROOT PROJECT_TSCONFIG
  if ! node -e '
    const path = require("path");
    const fs = require("fs");
    const { execSync } = require("child_process");
    const scriptDir = process.env.SCRIPT_DIR || process.cwd();
    const projectRoot = process.env.PROJECT_ROOT || scriptDir;
    const emittersDir = process.env.EMITTERS_DIR || path.join(scriptDir, "codegen", "emitters");
    const generatedDir = process.env.GENERATED_DIR || path.join(emittersDir, "generated");
    let emitterFiles = [];
    try {
      emitterFiles = fs.readdirSync(emittersDir).filter(function(f) {
        return /-emitter\.js$/.test(f) && !/stub/.test(f) && !/^demo-/.test(f);
      });
    } catch (e) {
      console.error("  emitters dir missing:", emittersDir);
      process.exit(1);
    }
    if (emitterFiles.length === 0) {
      console.error("  No *-emitter.js found for fidelity check.");
      process.exit(1);
    }
    const allFailures = [];
    (async function() {
      for (const ef of emitterFiles) {
        const emitterPath = path.join(emittersDir, ef);
        let mod;
        try {
          mod = require(emitterPath);
        } catch (e) {
          allFailures.push(ef + ": load error: " + (e.message || e));
          continue;
        }
        if (typeof mod.emit !== "function") {
          allFailures.push(ef + ": missing emit() export");
          continue;
        }
        let files;
        let meta = null;
        try {
          // Prefer emitWithMeta so checks can compare emitted values against the
          // CONTRACT rather than against literals copied into the emitter.
          if (typeof mod.emitWithMeta === "function") {
            const r = await mod.emitWithMeta({ writeToDisk: false, highLevel: true });
            files = r.files;
            meta = { shape: r.shape };
          } else {
            files = await mod.emit({ writeToDisk: false, highLevel: true });
          }
        } catch (e) {
          allFailures.push(ef + ": emit() threw: " + (e.message || e));
          continue;
        }

        // REGENERATION CHECK: what the emitter produces now must equal what is
        // committed on disk. Gate 3 ran its checks against the in-memory map
        // while tsc and freerange ran against the files, and nothing compared
        // the two — so a stale generated/ directory, or a hand-edit to it,
        // passed every gate. They happened to match; nothing enforced it.
        //
        // The output directory belongs to the emitter, declared via its
        // outDirName export (falling back to the filename stem: alert-emitter.js
        // -> alert). It was hardcoded to generated/card for EVERY discovered
        // emitter, so a second component regeneration check silently no-opped —
        // or, worse, diffed its output against the Card artifacts on a filename
        // collision.
        const outDirName = (typeof mod.outDirName === "string" && mod.outDirName)
          ? mod.outDirName
          : ef.replace(/-emitter\.js$/, "");
        const genDir = path.join(generatedDir, outDirName);
        // A missing output directory is a FAILURE, not a skip. This check used
        // to be wrapped in a bare existsSync, so an emitter whose artifacts had
        // never been written — or whose outDirName resolved somewhere nothing
        // lives — silently diffed against nothing and reported green forever.
        // The whole point of the check is that committed output matches the
        // emitter, and "there is no committed output" is the loudest way to
        // fail that.
        if (!fs.existsSync(genDir)) {
          allFailures.push(ef + ": no emitted output at " + genDir +
            " — run with --emit and commit the result");
        } else {
          for (const name of Object.keys(files)) {
            const onDisk = path.join(genDir, name);
            if (!fs.existsSync(onDisk)) {
              allFailures.push(ef + ": " + name + " is emitted but missing on disk (run --emit)");
              continue;
            }
            if (fs.readFileSync(onDisk, "utf8") !== files[name]) {
              allFailures.push(ef + ": " + name + " on disk differs from what the emitter produces (run --emit)");
            }
          }
        }

        const checks = Array.isArray(mod.fidelityChecks) ? mod.fidelityChecks : [];
        for (const chk of checks) {
          try {
            if (!chk.test || !chk.test(files, meta)) {
              allFailures.push(ef + ": " + (chk.label || "unnamed fidelity check"));
            }
          } catch (e) {
            allFailures.push(ef + ": check error for " + (chk.label || "check"));
          }
        }
        if (checks.length > 0) {
          console.log("  ✓ " + ef + " (" + checks.length + " fidelityChecks passed)");
        } else {
          console.log("  ✓ " + ef + " (no fidelityChecks declared; structural emit ok)");
        }
        // Project-wide TypeScript check now lives in Gate 4 (bin/witness-design-gates.sh
        // run_gate_5(), via ./node_modules/.bin/fr — freerange is a strict superset of tsc, run
        // over the real root tsconfig.json, so it subsumes this check). The old per-emitted-.tsx
        // temp-dir + "npx --yes -- tsc" hack is gone (see git history); it is invoked once,
        // project-wide, below instead of per file / per temp project.

        // Next-2: Deep semantic verification for the Card (real factories + Yoga geometry).
        // Runs the executable createCard* factories (producing a branded VerifiedCard),
        // feeds the result through cardToTexturaTree + computeLayout, then asserts the
        // measured geometry satisfies the exact numeric obligations from the contracts
        // (maxWs, gap arithmetic, min variant widths). This is the "actual verifier"
        // step: shallow marker + tsc is the fast path; this exercises the runtime
        // path that the emitted code would take and cross-checks against Gate 1/2 proofs.
        // Opt-out: WITNESS_GATE4_SEMANTIC=0 (keeps gate fast while developing).
        //
        // Any emitter exporting runSemanticVerification() gets this, not just
        // Card. The filename equality test that used to guard it meant a new
        // component could ship a semantic verifier that was never once called,
        // while the gate still reported green. runSemanticCardVerification is
        // accepted as the legacy name so the Card emitter keeps working.
        const semanticFn = (typeof mod.runSemanticVerification === "function")
          ? mod.runSemanticVerification
          : (typeof mod.runSemanticCardVerification === "function")
            ? mod.runSemanticCardVerification
            : null;
        if (semanticFn) {
          if (process.env.WITNESS_GATE4_SEMANTIC !== "0") {
            try {
              const sem = await semanticFn.call(mod);
              if (sem && sem.pass) {
                console.log("  ✓ " + ef + " (semantic: factories + Yoga vs contract obligations)");
                if (sem.geometry) {
                  console.log("    geometry: root=" + JSON.stringify(sem.geometry.root) +
                    " titleW=" + sem.geometry.title + " actionsW=" + sem.geometry.actions);
                }
              } else {
                const why = (sem && sem.failures) ? sem.failures.join("; ") : "unknown";
                allFailures.push(ef + ": semantic verification: " + why);
              }
            } catch (e) {
              allFailures.push(ef + ": semantic verification threw: " + (e && (e.message || e)));
            }
          } else {
            console.log("  (semantic verification skipped via WITNESS_GATE4_SEMANTIC=0)");
          }
        }
      }

      // Single project-wide tsc sanity check (replaces the old per-.tsx temp-dir/npx hack).
      // Full, authoritative TypeScript + numeric-range enforcement is Gate 4 (freerange, a
      // strict superset of tsc, over this exact tsconfig.json). This is a fast local echo of
      // that so Gate 3 fails fast without waiting on Gate 4.
      // Resolve tsc and the tsconfig against the PROJECT being gated, falling
      // back to the witness package. A consumer typecheck must use the
      // consumer tsconfig; using witness own config would check witness files.
      const tscCandidates = [
        path.join(projectRoot, "node_modules", ".bin", "tsc"),
        path.join(scriptDir, "node_modules", ".bin", "tsc"),
      ];
      const localTsc = tscCandidates.find(function(p) { return fs.existsSync(p); });
      const rootTsconfig = process.env.PROJECT_TSCONFIG || path.join(projectRoot, "tsconfig.json");
      if (localTsc && fs.existsSync(rootTsconfig)) {
        try {
          execSync("\"" + localTsc + "\" -p \"" + rootTsconfig + "\"", { cwd: projectRoot, stdio: "pipe", timeout: 180000 });
          console.log("  ✓ tsc -p tsconfig.json (project-wide; full enforcement is Gate 4)");
        } catch (e) {
          const out = ((e && (e.stdout || e.stderr)) || "").toString().slice(0, 1200);
          console.error("  ✗ tsc -p tsconfig.json FAILED:\\n" + out);
          allFailures.push("tsc -p tsconfig.json (project-wide check; see Gate 4 for full freerange enforcement)");
        }
      } else {
        console.log("  (./node_modules/.bin/tsc or tsconfig.json not found; skipping project-wide tsc sanity check here — Gate 4 still enforces via freerange)");
      }

      if (allFailures.length > 0) {
        console.error("  FIDELITY DRIFT / tsc failure: " + allFailures.join(" | "));
        process.exit(1);
      }
      console.log("  ✓ All auto-discovered component emitters passed fidelityChecks + tsc.");
      process.exit(0);
    })().catch(function(e) {
      console.error("  Gate 3 discovery/check error:", e && (e.message || e));
      process.exit(1);
    });
  ' 2>&1 ; then
    echo ""
    echo -e "${RED}✗ Gate 3 FAILED: Emitter fidelity drift, tsc error, or check failure.${NC}"
    echo ""
    echo "  One or more auto-discovered *-emitter.js no longer satisfy their declared"
    echo "  fidelityChecks (moved into the emitter for co-location) or the emitted .tsx"
    echo "  failed tsc --noEmit (new strengthening)."
    echo ""
    echo -e "${YELLOW}To regenerate (for Card):${NC}"
    echo "    ./bin/witness-design-gates.sh --emit --gate 3"
    echo "    # inspect codegen/emitters/generated/card/ then re-run without --emit"
    echo ""
    echo "  New components: implement *-emitter.js exporting emit() + fidelityChecks[],"
    echo "  Gate 3 will discover it automatically (no edit to this script)."
    echo ""
    echo "  The same backpressure that protects user layouts now protects the generator (stronger)."
    echo ""
    exit 1
  fi

  local elapsed=$(( SECONDS - gate_start ))
  echo -e "  ${GREEN}✓ Gate 3 passed${NC} (emitter produces faithful Card.tsx + card.css + richer targets) [${elapsed}s]"
  echo ""
}

run_gate_4() {
  local gate_start=$SECONDS
  print_gate_header 4 "Numeric range enforcement (freerange over emitted TypeScript)"
  echo "  Runs ./node_modules/.bin/fr over the project (respects tsconfig.json's include: "
  echo "  codegen/emitters/generated/**/* + codegen/ts/**/*) to statically verify the numeric"
  echo "  layout arithmetic that consumes Witness's proven design constants — division-by-zero,"
  echo "  out-of-range indexing, NaN propagation — against console.assert(...) preconditions"
  echo "  projected from (card-contract-shape). freerange is a strict superset of tsc, so this"
  echo "  also subsumes the project-wide TypeScript check (Gate 3 keeps a fast local echo of it)."
  echo "  This is Tier 2 backpressure: Shen proves the design; freerange propagates the numeric"
  echo "  obligations into the TypeScript that actually computes layout."
  echo ""
  echo "  CROSS-FILE LIMITATION (freerange v0.0.2, verified empirically): contracts are NOT"
  echo "  enforced across file boundaries. A console.assert precondition on a function is only"
  echo "  checked at call sites in the SAME file. Emitted layout modules must keep contract +"
  echo "  call sites co-located to get real enforcement."
  echo ""

  # freerange is a devDependency of witness, so it is ABSENT after a normal
  # install of witness as a dependency. Prefer the gated project's own copy and
  # fall back to witness's — otherwise Gate 4 fails for every consumer with a
  # message telling them to npm install inside node_modules/witness.
  local fr_bin=""
  for cand in "$PROJECT_ROOT/node_modules/.bin/fr" "$SCRIPT_DIR/node_modules/.bin/fr"; do
    if [ -x "$cand" ]; then fr_bin="$cand"; break; fi
  done
  if [ -z "$fr_bin" ]; then
    echo -e "${RED}✗ Gate 4 FAILED${NC}: freerange is not installed."
    echo ""
    echo -e "${YELLOW}Actionable fixes:${NC}"
    echo "  1. Run, in $PROJECT_ROOT:  npm install -D @chenglou/freerange"
    echo "  2. Verify: ./node_modules/.bin/fr    (should run against ./tsconfig.json, not error 'not found')"
    echo "  3. Re-run: ./bin/witness-design-gates.sh --gate 4"
    echo ""
    echo "  Note: freerange requires strictNullChecks; your tsconfig.json must set it."
    echo ""
    exit 1
  fi

  echo "  Running: $fr_bin   (cwd=$PROJECT_ROOT, resolves ./tsconfig.json)"
  local fr_output fr_exit=0
  fr_output=$(cd "$PROJECT_ROOT" && "$fr_bin" 2>&1) || fr_exit=$?
  echo "$fr_output" | sed 's/^/  /'
  echo ""

  if [ $fr_exit -ne 0 ]; then
    echo -e "${RED}✗ Gate 4 FAILED${NC}: freerange reported errors over the project (see output above)."
    echo ""
    echo -e "${YELLOW}Actionable fixes:${NC}"
    echo "  1. [declared-requirement] finding: a call site provably violates a leading"
    echo "     console.assert(...) precondition on the function it calls. Either fix the call"
    echo "     site's argument, or (if the precondition doesn't match the true contract) correct"
    echo "     the obligation in specs/ui/properties/card-properties.shen (card-contract-shape)"
    echo "     and regenerate — the assert must trace back to a named Shen theorem."
    echo "  2. Missing precondition on a divisor / array index / .length access: add a leading"
    echo "     console.assert(Number.isInteger(n)) / console.assert(n >= 1)-style guard at the"
    echo "     top of the function so freerange can discharge the obligation before the"
    echo "     arithmetic that depends on it."
    echo "  3. Plain TypeScript error (TS2503, TS7031, ...): freerange is a strict superset of"
    echo "     tsc, so this is an ordinary type error in the emitted/hand-written source; fix it"
    echo "     directly, same as you would under 'npx tsc -p tsconfig.json'."
    echo "  4. To regenerate the emitted TypeScript from the live Shen contracts:"
    echo "       ./bin/witness-design-gates.sh --emit --gate 3"
    echo "  5. CROSS-FILE LIMITATION: freerange never checks a contract against a call site in a"
    echo "     different file (the caller counts as 'unsupported', silently). If a bad call isn't"
    echo "     being caught, check whether the contracted function and the call live in the same"
    echo "     module before assuming the contract itself is wrong."
    echo ""
    exit 1
  fi

  echo -e "  ${GREEN}✓${NC} freerange: no findings over the project."
  echo ""

  # --- Negative fixture: proves Gate 4 is LIVE, not vacuously green. ---
  # codegen/ts/demo/consumer-bad.ts is deliberately excluded from tsconfig.json's "include" (per
  # the agreed cross-track interface) so it never pollutes the real project-wide run above. To
  # still analyze it, freerange must be invoked from a cwd with NO tsconfig.json in its parent
  # chain -- verified empirically that `fr <path>` then falls back to standalone file analysis
  # instead of rejecting the file as "not part of the project". See the header comment in
  # codegen/ts/demo/consumer-bad.ts for the full empirical basis of this choice.
  local bad_fixture="$SCRIPT_DIR/codegen/ts/demo/consumer-bad.ts"
  if [ ! -f "$bad_fixture" ]; then
    fail_gate 4 "negative fixture missing: codegen/ts/demo/consumer-bad.ts (must exist -- it is what proves this gate is not vacuously green; do not delete it)"
  fi

  echo "  Running negative fixture (EXPECT FAILURE): fr codegen/ts/demo/consumer-bad.ts"
  local neutral_dir neg_output neg_exit=0
  neutral_dir=$(mktemp -d)
  neg_output=$(cd "$neutral_dir" && "$fr_bin" "$bad_fixture" 2>&1) || neg_exit=$?
  rmdir "$neutral_dir" 2>/dev/null || true
  echo "$neg_output" | sed 's/^/  /'
  echo ""

  if [ $neg_exit -eq 0 ]; then
    echo -e "${RED}✗ Gate 4 FAILED${NC}: the negative fixture was NOT rejected by freerange."
    echo ""
    echo "  codegen/ts/demo/consumer-bad.ts calls cardActionSlotWidth(268, 0) in the same file as"
    echo "  its console.assert(actionCount >= 1) precondition, and freerange exited 0 (silent)."
    echo "  A gate that cannot fail is not a gate. Check that:"
    echo "    - ./node_modules/.bin/fr is still the real @chenglou/freerange binary (npm install)"
    echo "    - codegen/ts/demo/consumer-bad.ts was not edited to remove the bad call"
    echo "    - the invocation still runs from a neutral cwd with no tsconfig.json in its parent"
    echo "      chain (this script uses mktemp -d) -- otherwise freerange rejects the file as"
    echo "      'not part of the project' instead of analyzing it standalone"
    echo ""
    exit 1
  fi
  if ! echo "$neg_output" | grep -q '\[declared-requirement\]'; then
    echo -e "${YELLOW}⚠ negative fixture failed, but not with a [declared-requirement] finding.${NC}"
    echo "  freerange exited non-zero as expected, but the finding vocabulary changed -- inspect"
    echo "  the output above; this may mean freerange's error format drifted from what this gate"
    echo "  (and the ground-truth notes it was written against) expects."
    echo ""
  fi
  echo -e "  ${GREEN}✓ negative fixture correctly rejected${NC}"
  echo ""


  local elapsed=$(( SECONDS - gate_start ))
  echo -e "  ${GREEN}✓ Gate 4 passed${NC} (freerange clean over the project + negative fixture correctly rejected) [${elapsed}s]"
  echo ""
}

usage() {
  cat <<'EOF'
witness-design-gates.sh — sb-style design fidelity backpressure for the Witness project

Usage:
  ./bin/witness-design-gates.sh [options]
  npm run gates [-- options]

Options:
  --gate <spec>     Run a single gate only. <spec> can be: 1, tc, design ; 2, proofs, property ;
                    3, emit, emitter, codegen ; 4, fr, freerange, numeric, range
  --quick           Run Gates 1 + 2 only (skip emitter + freerange). Fast for the inner dev loop.
  --full            Run all four gates (default).
  --emit            When running Gate 3, also write each emitter's artifacts to disk under
                    <emitters>/generated/<outDirName>/ before checking them.
  --project-root D  Gate the project at D instead of the witness package itself. D supplies
                    specs/design/, specs/ui/properties/, codegen/emitters/, .witness/ and
                    tsconfig.json; witness supplies the proof machinery. Also settable as
                    WITNESS_PROJECT_ROOT.
  -h, --help        Show this help.

Individual directory overrides (each defaults under --project-root):
  WITNESS_DESIGN_SPECS_DIR, WITNESS_PROPERTIES_DIR, WITNESS_EMITTERS_DIR,
  WITNESS_GENERATED_DIR, WITNESS_TSCONFIG

Examples:
  npm run gates
  ./bin/witness-design-gates.sh --quick
  ./bin/witness-design-gates.sh --gate 3
  ./bin/witness-design-gates.sh --emit --gate 3
  ./bin/witness-design-gates.sh --gate 4
  ./bin/witness-design-gates.sh --project-root ~/projects/my-app

This runner is the enforcement mechanism for the self-hosting design specs.
It will be wired into CI, the witness agent loop, and future Ralph-style autonomous evolution loops
for the Shen UI Specifications (Card spike, shen-witness emitter, guarded components, semantic CSS).

See:
  specs/design/README.md
  .claude/skills/sb-shen-backpressure/SKILL.md   (the pattern we are self-hosting)
  .claude/commands/sb/loop.md                    (gate ordering inspiration)
EOF
}

# --- Main entry ---

setup_colors

GATE_SPEC=""
MODE="full"
EMIT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gate)
      [[ $# -lt 2 ]] && { echo "Missing argument for --gate"; usage; exit 1; }
      GATE_SPEC="$2"
      shift 2
      ;;
    --quick)
      MODE="quick"
      shift
      ;;
    --full)
      MODE="full"
      shift
      ;;
    --emit)
      EMIT=true
      shift
      ;;
    --project-root)
      [[ $# -lt 2 ]] && { echo "Missing argument for --project-root"; usage; exit 1; }
      PROJECT_ROOT="$(cd "$2" && pwd)" || { echo "--project-root: no such directory: $2"; exit 1; }
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      usage
      exit 1
      ;;
  esac
done

# Fill in any directory the caller did not override. Done after arg parsing so
# --project-root is already final.
DESIGN_SPECS_DIR="${DESIGN_SPECS_DIR:-$PROJECT_ROOT/specs/design}"
PROPERTIES_DIR="${PROPERTIES_DIR:-$PROJECT_ROOT/specs/ui/properties}"
EMITTERS_DIR="${EMITTERS_DIR:-$PROJECT_ROOT/codegen/emitters}"
GENERATED_DIR="${GENERATED_DIR:-$EMITTERS_DIR/generated}"
PROJECT_TSCONFIG="${PROJECT_TSCONFIG:-$PROJECT_ROOT/tsconfig.json}"
# Consumed by boot.js (sibling `(load …)` resolution) and by the cli/ entry
# points, which each take the same env var.
export WITNESS_PROJECT_ROOT="$PROJECT_ROOT"

echo -e "${BOLD}=== Witness design-fidelity gates ===${NC}"
echo "The Witness proof system validates its own contracts."
echo "This backpressure protects evolution toward the full Shen UI Specifications (design doc)."
if [ "$PROJECT_ROOT" != "$SCRIPT_DIR" ]; then
  echo ""
  echo "  gating project: $PROJECT_ROOT"
  echo "  witness package: $SCRIPT_DIR"
fi
echo ""

TOTAL_START=$SECONDS

if [ -n "$GATE_SPEC" ]; then
  case "$GATE_SPEC" in
    1|tc|design|spec|specs)
      run_gate_1
      ;;
    2|proof|proofs|property|theorem)
      run_gate_2
      ;;
    3|emit|emitter|codegen|fidelity-emit)
      run_gate_3
      ;;
    4|fr|freerange|numeric|range)
      run_gate_4
      ;;
    *)
      echo -e "${RED}Unknown --gate value: '$GATE_SPEC'${NC}"
      echo "Valid: 1 / tc / design ,  2 / proofs / property ,  3 / emit / emitter / codegen ,  4 / fr / freerange / numeric / range"
      exit 1
      ;;
  esac
else
  run_gate_1
  run_gate_2
  if [ "$MODE" = "full" ]; then
    run_gate_3
    run_gate_4
  else
    echo -e "${YELLOW}--quick mode: Gate 3 (emitter) + Gate 3 (freerange) skipped${NC}"
    echo ""
  fi
fi

TOTAL_ELAPSED=$(( SECONDS - TOTAL_START ))

echo -e "${BOLD}${GREEN}=== All design gates passed ===${NC}"
echo "Total elapsed: ${TOTAL_ELAPSED}s"
echo "The implementation is faithful to specs/design/*.shen (and the Card spike contracts + emitter)."
echo "Safe to continue evolving (add UI component specs, improve the shen-witness emitter, etc.)."
echo ""
echo "Design contracts + README:"
echo "  specs/design/README.md  (Gate structure, contracts, how to extend backpressure)"
echo ""
echo "Common commands:"
echo "  npm run gates          # full suite (Gates 1-4, recommended before PRs)"
echo "  npm run gates -- --quick"
echo "  ./bin/witness-design-gates.sh --gate 3      # emitter fidelity only"
echo "  ./bin/witness-design-gates.sh --emit --gate 3   # regenerate emitted artifacts + check"
echo "  ./bin/witness-design-gates.sh --gate 4       # freerange numeric-range enforcement only"
echo "  ./bin/witness-design-gates.sh --project-root DIR  # gate a consuming project"
echo ""
echo "To strengthen backpressure further:"
echo "  - Add more *.shen under specs/design/ (e.g. ui-component-fidelity.shen, codegen-emitter-fidelity.shen)"
echo "  - Extend emitter further (more components, full live Shen value bridge for verified-card, CI wiring)"
echo "  - Wire into .github/workflows/ and the cli/agent.js loop (like /sb:loop)"
echo ""
exit 0