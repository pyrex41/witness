#!/bin/bash
# bin/witness-design-gates.sh
#
# sb-style gate runner for Witness design fidelity backpressure.
# 
# Uses the project's own two-phase proof system (Node + Pretext measurement + shen-sbcl tc+)
# to validate that the implementation stays faithful to the formal design specs in specs/design/.
#
# This is the meta-application of Witness: the same machinery that makes "layout overflow a
# compile-time type error" for users now makes "design drift a compile-time error" for us.
#
# Gate structure (modeled on sb-shen-backpressure's core 5 gates + TCB audit from SKILL.md / loop.md):
#   Gate 1: tc+ on all specs/design/*.shen   (catches broken invariants/claims in the specs themselves)
#   Gate 2: Property proof verification     (theorems about load-order, renderer contracts, tier model
#                                            are proven by tc+ acceptance of their :verified premises)
#   Gate 3: Regeneration / TCB Audit        (SHA-256 of core impl files vs committed hashes; fails on
#                                            drift in witness.shen load order, trust macro, layout rules,
#                                            renderers, etc. — the TCB for the design contracts)
#
#   Gate 4: Emitter fidelity — run card-emitter.js on the Card contracts,
#           assert emitted Card.tsx + card.css + stories + fixture match the
#           verified shape (brands, factories, tokens, variant matrix from spec).
#
# Supports:
#   - Running individual gates: --gate 1 , --gate audit , --gate tc , --gate 3
#   - Modes: --full (default, all gates incl. audit) vs --quick (Gates 1+2 only)
#   - --update-manifest : after intentional core changes, prints new hash block to paste into this script
#   - Colored output (auto-disabled in non-tty / CI)
#   - Per-gate + total timing
#   - Actionable failure messages with links to README
#
# Usage:
#   ./bin/witness-design-gates.sh
#   ./bin/witness-design-gates.sh --quick
#   ./bin/witness-design-gates.sh --gate audit
#   npm run gates
#   npm run gates -- --gate 2
#
# Philosophy (from sb pattern): Compiler / proof-system enforcement, not LLM policing.
# The LLM (or human) proposes evolution; these gates + tc+ say "no" on fidelity loss.
# Regeneration (here: hash audit) + host verification provides the hammer.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESIGN_SPECS_DIR="$SCRIPT_DIR/specs/design"

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

# --- Design fidelity TCB: core files whose contracts are formalized in specs/design/witness-core.shen
#     (load order + trust macro + layout overflow rules + renderer contracts + measurement/checker)
#     Any change here must be reviewed against the design specs; the audit gate enforces it.
CORE_FILES=(
  shen/witness.shen
  shen/trust.shen
  shen/layout.shen
  shen/proofs.shen
  shen/witness-sbcl.shen
  shen/ssr.shen
  shen/dom.shen
  bin/witness-check.sh
  cli/measure.js
  cli/shen-check.js
  cli/theorem-run.js
  cli/freerange-audit.js
  # Everything below was OUTSIDE the TCB while being fully capable of disabling
  # a gate. The specs in particular are how witness-core.shen was hollowed out
  # to a comment-only stub without anything noticing for however long.
  bin/witness-design-gates.sh
  boot.js
  lib/measure-core.js
  codegen/emitters/card-emitter.js
  tsconfig.json
  specs/design/witness-core.shen
  specs/design/load-order-trust.shen
  specs/ui/tokens.shen
  specs/ui/card-spec.shen
  specs/ui/properties/card-properties.shen
  specs/ui/properties/alert-properties.shen
)

# Embedded expected SHA-256 hashes for the TCB (current approved design state).
# Portable format (no bash 4+ assoc arrays — macOS /bin/bash is 3.2).
# These are the "committed" side of the TCB audit, analogous to committed generated guard files
# in the sb-shen-backpressure tcb-audit gate.
# To refresh after a deliberate, reviewed change to one of these files:
#   1. Run: ./bin/witness-design-gates.sh --update-manifest
#   2. Paste the new FIDELITY_MANIFEST here-doc below (replacing the old one)
#   3. Re-run the gates to confirm
#   4. Commit the diff to this script (the gate runner is part of the TCB)
FIDELITY_MANIFEST=$(cat <<'MANIFEST_EOF'
shen/witness.shen 04517fdc2326c73cdb339e2d59cd4ae3bf99ae9cccafa8743e0eeea6954000de
shen/trust.shen b736703f85cac4fd6d8bcb3fb53c94174926a3986c762304db40aadad469b870
shen/layout.shen 6122b6db8e0a137bc75ce137454a5dd04b4697e534bb64798958f1d0aba5fc23
shen/proofs.shen f7093624eb9438797d1def2fd4b39e74c4723e47285d9a31e1ef2ea70b42dea1
shen/witness-sbcl.shen f457ca39b7c1aba500394e35763382f84f4d30492ecb24e962b76a18d107f39b
shen/ssr.shen 7249622e990120992b30d55b97fd51b367ef52cd8c254987a0cf91fd1c42ad4f
shen/dom.shen 3d8c6cfe989f942e4851b33596296f0d0abf49e7052a71c532d2d5080a17387b
bin/witness-check.sh 46a9c68c1f33396255e3f37ca58977d3b08a9039326fc1377b0f958db933eed8
cli/measure.js 8547998ca449c4ceb14a154576efb0efdd188f4b1652a29954c4981cea31e4d5
cli/shen-check.js a7ae36ec28e5caac731f8315b097fccf48f23c802eeedbae778723f1ce155977
cli/theorem-run.js 95af352c1988ee1097f7b62e15bb2a7b8badb2d60b253bca2e643480cd604b16
cli/freerange-audit.js 810a11d34c08148265364ca42f06f1760d3a0d061334892272b079818ade3a3b
bin/witness-design-gates.sh 1969d33df38d1d2947bd7cb393f4f2bdbfe1c609717e2d4ded3840543f5f9e86
boot.js 3e9741f28517140a5a96618b3bbe654ae565cd2433c09ce03fcb9b36df5b0079
lib/measure-core.js de4b69323cc3786274d7e2e5a302e3e07d7eea98d4e718eeab4f64cb19d06bce
codegen/emitters/card-emitter.js 9cf9d6e5966d9b4ae6ddae7e87e4ccfdca17e76e6461eb01ef6179c56b602600
tsconfig.json 3143e710ee17579baf1991db8452bb869c019e02d8acf39f62ad3dee365e6686
specs/design/witness-core.shen 2fe1197c9f273775e738bb3403e848ab0fd88dfa55e56532ec636bae6547c4ed
specs/design/load-order-trust.shen c7c353813af921a08f9f87b450cac3e45ea2de377e9b54ae2327ecb8eedfb6f4
specs/ui/tokens.shen b0723307b6f4536849db37daa84583fd68ea328530953e3ae9fd71f8c045758a
specs/ui/card-spec.shen f346aca2844699f92c05f1e79845e58eb26b806e5e5ca601f7ad651eacb12506
specs/ui/properties/card-properties.shen 1c6d18c894c68113bcb6e81aeded0dbdd6fa671456c7a1c79bffa077f937e089
specs/ui/properties/alert-properties.shen 3c89d6a99a729c82cfd3264188e075ce2b11d98b5983240385429f520127c85a
MANIFEST_EOF
)

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

get_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

# This script is itself in the TCB, which creates a fixpoint problem: recording
# its hash edits the manifest, which changes the hash. So hash the runner with
# its manifest block ELIDED. Any other change to the runner — a weakened check,
# a skipped gate, a new exemption — still moves the hash, which is the point.
get_tcb_sha256() {
  local file="$1"
  if [ "$file" = "$SCRIPT_DIR/bin/witness-design-gates.sh" ]; then
    local normalized
    normalized=$(sed '/^FIDELITY_MANIFEST=\$(cat <<.MANIFEST_EOF./,/^MANIFEST_EOF$/d' "$file")
    if command -v sha256sum >/dev/null 2>&1; then
      printf '%s' "$normalized" | sha256sum | awk '{print $1}'
    else
      printf '%s' "$normalized" | shasum -a 256 | awk '{print $1}'
    fi
  else
    get_sha256 "$file"
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
  echo "  2. Consult specs/design/README.md for the exact contracts (witness-load-order-contract,"
  echo "     renderer-contract, witness-proof-tier, etc.) and how they map to source."
  echo "  3. Either fix the implementation to restore the invariant, or (if the design itself"
  echo "     evolved) update the spec in specs/design/ and/or the fidelity hashes here."
  echo "  4. Re-run: ./bin/witness-design-gates.sh   (or npm run gates)"
  echo ""
  echo "This gate system exists so we can evolve Witness (UI specs, Card spike, shen-witness emitter,"
  echo "semantic CSS, Astro guarded components) without ever losing the proven foundations."
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
  echo "  `if` side condition, which runs the real Pretext ruler over the declared text."
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
    echo "    - ${f#$SCRIPT_DIR/}"
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

  if ! node "$SCRIPT_DIR/cli/theorem-run.js"; then
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
  print_gate_header 3 "Regeneration / TCB Audit (fidelity hash check)"
  echo "  SHA-256 of the trusted computing base (core .shen + checker + measure) vs embedded approved hashes."
  echo "  Analogous to sb-shen-backpressure Gate 5 (tcb-audit.sh): any drift in the files that implement"
  echo "  the contracts formalized by the design specs causes immediate failure."
  echo "  Protects load-order discipline (witness.shen:7-26 + trust.shen:25), overflow->css (layout.shen:63),"
  echo "  the three-tier model (proofs.shen), renderer contracts (ssr.shen, dom.shen), and the two-phase engine."
  echo ""
  local drift_detected=0
  for f in "${CORE_FILES[@]}"; do
    local full_path="$SCRIPT_DIR/$f"
    if [ ! -f "$full_path" ]; then
      echo -e "  ${RED}✗ Core TCB file missing: $f${NC}"
      drift_detected=1
      continue
    fi
    local actual
    actual=$(get_tcb_sha256 "$full_path")
    # Portable lookup in the manifest (bash 3.2 compatible, no assoc arrays)
    local expected
    expected=$(printf '%s\n' "$FIDELITY_MANIFEST" | awk -v file="$f" '$1 == file {print $2; exit}')
    if [ -z "$expected" ]; then
      # Previously a yellow "?" that did NOT set drift_detected — so adding a
      # file to the TCB without a hash silently passed, which defeats the audit.
      echo -e "  ${RED}✗ $f is in CORE_FILES but has no recorded hash${NC}"
      echo "      Run --update-manifest and commit the result."
      drift_detected=1
    elif [ "$actual" != "$expected" ]; then
      echo -e "  ${RED}✗ DRIFT: $f${NC}"
      echo "      Expected (approved design state): $expected"
      echo "      Actual   (current on disk)      : $actual"
      drift_detected=1
    else
      echo -e "  ${GREEN}✓${NC} $f"
    fi
  done

  local elapsed=$(( SECONDS - gate_start ))
  if [ $drift_detected -eq 1 ]; then
    echo ""
    echo -e "${RED}✗ Gate 3 FAILED: Design fidelity drift in the TCB.${NC}"
    echo ""
    echo "  One or more files that realize the design contracts (load order, trust macro, layout rules,"
    echo "  renderer overflow handling, proof sequents, measurement) have changed without a corresponding"
    echo "  update to the approved hashes in this script."
    echo ""
    echo "  This breaks the guarantee that the specs in specs/design/ accurately describe the implementation."
    echo ""
    echo -e "${YELLOW}To accept the change as the new approved design state (after you have reviewed it):${NC}"
    echo "    ./bin/witness-design-gates.sh --update-manifest"
    echo "    # copy the printed declare -A block into this file (replacing the old hashes)"
    echo "    ./bin/witness-design-gates.sh   # verify it now passes"
    echo "    git add bin/witness-design-gates.sh && git commit -m 'chore: update design fidelity TCB hashes'"
    echo ""
    echo "  See specs/design/README.md section on the TCB Audit gate for rationale (directly from the sb pattern)."
    echo ""
    exit 1
  fi

  echo -e "  ${GREEN}✓ Gate 3 passed${NC} (no drift — implementation matches the design fidelity snapshot) [${elapsed}s]"
  echo ""
}

run_gate_4() {
  local gate_start=$SECONDS
  print_gate_header 4 "Emitter fidelity (shen-witness codegen — fidelity convention + tsc + semantic)"
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

  local emitter_path="$SCRIPT_DIR/codegen/emitters/card-emitter.js"
  if [ ! -f "$emitter_path" ]; then
    fail_gate 4 "card-emitter.js not found at $emitter_path"
  fi

  # Run the emitter (it prints summary on CLI; we also invoke programmatically for checks)
  echo "  Invoking emitter..."
  if $do_emit; then
    echo "  (write mode: artifacts will be written under codegen/emitters/generated/card/)"
    if ! node "$emitter_path" --emit 2>&1; then
      fail_gate 4 "Emitter failed during --emit write (see output above)"
    fi
  else
    if ! node "$emitter_path" 2>&1 | tail -5; then
      fail_gate 4 "Emitter failed to produce artifacts (see output above)"
    fi
  fi

  # Programmatic fidelity check — now uses the fidelity convention:
  #   auto-discover codegen/emitters/*-emitter.js (excluding stubs)
  #   require each, call emit({writeToDisk:false})
  #   run every exported .fidelityChecks entry (test fn over the files map)
  #   + strengthened: for any *.tsx output, run tsc --noEmit (with React shim + temp tsconfig)
  #     using local ./node_modules/.bin/tsc if present, else npx --yes typescript (cached)
  # This makes Gate 4 discover+enforce for new components with zero changes to this script.
  echo "  Running fidelity assertions (auto-discover emitters + declared fidelityChecks + tsc on TS)..."
  export SCRIPT_DIR
  if ! node -e '
    const path = require("path");
    const fs = require("fs");
    const { execSync } = require("child_process");
    const scriptDir = process.env.SCRIPT_DIR || process.cwd();
    const emittersDir = path.join(scriptDir, "codegen", "emitters");
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
        try {
          files = await mod.emit({ writeToDisk: false, highLevel: true });
        } catch (e) {
          allFailures.push(ef + ": emit() threw: " + (e.message || e));
          continue;
        }
        const checks = Array.isArray(mod.fidelityChecks) ? mod.fidelityChecks : [];
        for (const chk of checks) {
          try {
            if (!chk.test || !chk.test(files)) {
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
        // Project-wide TypeScript check now lives in Gate 5 (bin/witness-design-gates.sh
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
        // When present on any emitter it is exercised automatically — Card is first.
        if (ef === "card-emitter.js" && typeof mod.runSemanticCardVerification === "function") {
          if (process.env.WITNESS_GATE4_SEMANTIC !== "0") {
            try {
              const sem = await mod.runSemanticCardVerification();
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
      // Full, authoritative TypeScript + numeric-range enforcement is Gate 5 (freerange, a
      // strict superset of tsc, over this exact tsconfig.json). This is a fast local echo of
      // that so Gate 4 fails fast without waiting on Gate 5.
      const localTsc = path.join(scriptDir, "node_modules", ".bin", "tsc");
      const rootTsconfig = path.join(scriptDir, "tsconfig.json");
      if (fs.existsSync(localTsc) && fs.existsSync(rootTsconfig)) {
        try {
          execSync("\"" + localTsc + "\" -p \"" + rootTsconfig + "\"", { cwd: scriptDir, stdio: "pipe", timeout: 180000 });
          console.log("  ✓ tsc -p tsconfig.json (project-wide; full enforcement is Gate 5)");
        } catch (e) {
          const out = ((e && (e.stdout || e.stderr)) || "").toString().slice(0, 1200);
          console.error("  ✗ tsc -p tsconfig.json FAILED:\\n" + out);
          allFailures.push("tsc -p tsconfig.json (project-wide check; see Gate 5 for full freerange enforcement)");
        }
      } else {
        console.log("  (./node_modules/.bin/tsc or tsconfig.json not found; skipping project-wide tsc sanity check here — Gate 5 still enforces via freerange)");
      }

      if (allFailures.length > 0) {
        console.error("  FIDELITY DRIFT / tsc failure: " + allFailures.join(" | "));
        process.exit(1);
      }
      console.log("  ✓ All auto-discovered component emitters passed fidelityChecks + tsc.");
      process.exit(0);
    })().catch(function(e) {
      console.error("  Gate 4 discovery/check error:", e && (e.message || e));
      process.exit(1);
    });
  ' 2>&1 ; then
    echo ""
    echo -e "${RED}✗ Gate 4 FAILED: Emitter fidelity drift, tsc error, or check failure.${NC}"
    echo ""
    echo "  One or more auto-discovered *-emitter.js no longer satisfy their declared"
    echo "  fidelityChecks (moved into the emitter for co-location) or the emitted .tsx"
    echo "  failed tsc --noEmit (new strengthening)."
    echo ""
    echo -e "${YELLOW}To regenerate (for Card):${NC}"
    echo "    ./bin/witness-design-gates.sh --emit --gate 4"
    echo "    # inspect codegen/emitters/generated/card/ then re-run without --emit"
    echo ""
    echo "  New components: implement *-emitter.js exporting emit() + fidelityChecks[],"
    echo "  Gate 4 will discover it automatically (no edit to this script)."
    echo ""
    echo "  The same backpressure that protects user layouts now protects the generator (stronger)."
    echo ""
    exit 1
  fi

  local elapsed=$(( SECONDS - gate_start ))
  echo -e "  ${GREEN}✓ Gate 4 passed${NC} (emitter produces faithful Card.tsx + card.css + richer targets) [${elapsed}s]"
  echo ""
}

run_gate_5() {
  local gate_start=$SECONDS
  print_gate_header 5 "Numeric range enforcement (freerange over emitted TypeScript)"
  echo "  Runs ./node_modules/.bin/fr over the project (respects tsconfig.json's include: "
  echo "  codegen/emitters/generated/**/* + codegen/ts/**/*) to statically verify the numeric"
  echo "  layout arithmetic that consumes Witness's proven design constants — division-by-zero,"
  echo "  out-of-range indexing, NaN propagation — against console.assert(...) preconditions"
  echo "  projected from (card-contract-shape). freerange is a strict superset of tsc, so this"
  echo "  also subsumes the project-wide TypeScript check (Gate 4 keeps a fast local echo of it)."
  echo "  This is Tier 2 backpressure: Shen proves the design; freerange propagates the numeric"
  echo "  obligations into the TypeScript that actually computes layout."
  echo ""
  echo "  CROSS-FILE LIMITATION (freerange v0.0.2, verified empirically): contracts are NOT"
  echo "  enforced across file boundaries. A console.assert precondition on a function is only"
  echo "  checked at call sites in the SAME file. Emitted layout modules must keep contract +"
  echo "  call sites co-located to get real enforcement."
  echo ""

  local fr_bin="$SCRIPT_DIR/node_modules/.bin/fr"
  if [ ! -x "$fr_bin" ]; then
    echo -e "${RED}✗ Gate 5 FAILED${NC}: freerange is not installed."
    echo ""
    echo -e "${YELLOW}Actionable fixes:${NC}"
    echo "  1. Run: npm install   (installs the @chenglou/freerange devDependency)"
    echo "  2. Verify: ./node_modules/.bin/fr    (should run against ./tsconfig.json, not error 'not found')"
    echo "  3. Re-run: ./bin/witness-design-gates.sh --gate 5"
    echo ""
    exit 1
  fi

  echo "  Running: ./node_modules/.bin/fr   (cwd=$SCRIPT_DIR, resolves ./tsconfig.json)"
  local fr_output fr_exit=0
  fr_output=$(cd "$SCRIPT_DIR" && "$fr_bin" 2>&1) || fr_exit=$?
  echo "$fr_output" | sed 's/^/  /'
  echo ""

  if [ $fr_exit -ne 0 ]; then
    echo -e "${RED}✗ Gate 5 FAILED${NC}: freerange reported errors over the project (see output above)."
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
    echo "       ./bin/witness-design-gates.sh --emit --gate 4"
    echo "  5. CROSS-FILE LIMITATION: freerange never checks a contract against a call site in a"
    echo "     different file (the caller counts as 'unsupported', silently). If a bad call isn't"
    echo "     being caught, check whether the contracted function and the call live in the same"
    echo "     module before assuming the contract itself is wrong."
    echo ""
    exit 1
  fi

  echo -e "  ${GREEN}✓${NC} freerange: no findings over the project."
  echo ""

  # --- Negative fixture: proves Gate 5 is LIVE, not vacuously green. ---
  # codegen/ts/demo/consumer-bad.ts is deliberately excluded from tsconfig.json's "include" (per
  # the agreed cross-track interface) so it never pollutes the real project-wide run above. To
  # still analyze it, freerange must be invoked from a cwd with NO tsconfig.json in its parent
  # chain -- verified empirically that `fr <path>` then falls back to standalone file analysis
  # instead of rejecting the file as "not part of the project". See the header comment in
  # codegen/ts/demo/consumer-bad.ts for the full empirical basis of this choice.
  local bad_fixture="$SCRIPT_DIR/codegen/ts/demo/consumer-bad.ts"
  if [ ! -f "$bad_fixture" ]; then
    fail_gate 5 "negative fixture missing: codegen/ts/demo/consumer-bad.ts (must exist -- it is what proves this gate is not vacuously green; do not delete it)"
  fi

  echo "  Running negative fixture (EXPECT FAILURE): fr codegen/ts/demo/consumer-bad.ts"
  local neutral_dir neg_output neg_exit=0
  neutral_dir=$(mktemp -d)
  neg_output=$(cd "$neutral_dir" && "$fr_bin" "$bad_fixture" 2>&1) || neg_exit=$?
  rmdir "$neutral_dir" 2>/dev/null || true
  echo "$neg_output" | sed 's/^/  /'
  echo ""

  if [ $neg_exit -eq 0 ]; then
    echo -e "${RED}✗ Gate 5 FAILED${NC}: the negative fixture was NOT rejected by freerange."
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

  # --- Opt-in --audit sub-mode: Track C's freerange-audit bridge (cli/freerange-audit.js). ---
  if [ "${GATE5_AUDIT:-false}" = true ]; then
    echo "  --audit: running the freerange-audit bridge..."
    local audit_script="$SCRIPT_DIR/cli/freerange-audit.js"
    if [ ! -f "$audit_script" ]; then
      echo -e "  ${YELLOW}⚠ cli/freerange-audit.js does not exist yet -- skipping --audit sub-mode.${NC}"
    else
      local audit_targets=()
      [ -f "$SCRIPT_DIR/codegen/emitters/generated/card/card-layout.ts" ] && \
        audit_targets+=("codegen/emitters/generated/card/card-layout.ts")
      [ -f "$SCRIPT_DIR/codegen/emitters/generated/card/Card.tsx" ] && \
        audit_targets+=("codegen/emitters/generated/card/Card.tsx")
      if [ ${#audit_targets[@]} -eq 0 ]; then
        echo -e "  ${YELLOW}⚠ no emitted TS artifacts found to audit yet -- skipping --audit sub-mode.${NC}"
      else
        if ! (cd "$SCRIPT_DIR" && node "$audit_script" "${audit_targets[@]}") 2>&1 | sed 's/^/  /'; then
          fail_gate 5 "cli/freerange-audit.js reported an error (see output above); the bridge is documented as non-fatal, so this indicates a real problem worth a look."
        fi
        echo -e "  ${GREEN}✓${NC} freerange-audit bridge ran cleanly."
      fi
    fi
    echo ""
  fi

  local elapsed=$(( SECONDS - gate_start ))
  echo -e "  ${GREEN}✓ Gate 5 passed${NC} (freerange clean over the project + negative fixture correctly rejected) [${elapsed}s]"
  echo ""
}

print_update_manifest() {
  echo "# === UPDATED FIDELITY_MANIFEST (replace the here-doc in bin/witness-design-gates.sh) ==="
  echo "# Generated on $(date)"
  echo "# Run this gate runner again after pasting to confirm all gates pass."
  echo 'FIDELITY_MANIFEST=$(cat <<'"'"'MANIFEST_EOF'"'"''
  for f in "${CORE_FILES[@]}"; do
    local full="$SCRIPT_DIR/$f"
    if [ -f "$full" ]; then
      local h
      h=$(get_tcb_sha256 "$full")
      echo "$f $h"
    fi
  done
  echo "MANIFEST_EOF"
  echo ")"
  echo "# === END OF UPDATED BLOCK ==="
  echo "# After replacing, run the gates (full) to self-verify."
}

usage() {
  cat <<'EOF'
witness-design-gates.sh — sb-style design fidelity backpressure for the Witness project

Usage:
  ./bin/witness-design-gates.sh [options]
  npm run gates [-- options]

Options:
  --gate <spec>     Run a single gate only. <spec> can be: 1, 2, 3, 4, 5, tc, proofs, audit, design,
                    property, regen, hash, tcb, emit, emitter, fr, freerange, numeric, range
  --quick           Run Gates 1 + 2 only (skip TCB audit + emitter + freerange). Fast for inner dev loop.
  --full            Run all five gates (default).
  --emit            When running Gate 4, also write the emitted Card.tsx + card.css to codegen/emitters/generated/card/
  --audit           Opt-in sub-mode for Gate 5: also runs Track C's cli/freerange-audit.js bridge
                    over the emitted layout TS (skips gracefully with a note if that file doesn't exist yet).
  --update-manifest Print a fresh FIDELITY_MANIFEST here-doc with current hashes (for intentional TCB changes).
  -h, --help        Show this help.

Examples:
  npm run gates
  ./bin/witness-design-gates.sh --quick
  ./bin/witness-design-gates.sh --gate audit
  ./bin/witness-design-gates.sh --gate 4
  ./bin/witness-design-gates.sh --emit --gate 4
  ./bin/witness-design-gates.sh --gate 5
  ./bin/witness-design-gates.sh --gate 5 --audit
  ./bin/witness-design-gates.sh --update-manifest

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
UPDATE=false
EMIT=false
GATE5_AUDIT=false

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
    --update-manifest|--update-fidelity|--update)
      UPDATE=true
      shift
      ;;
    --emit)
      EMIT=true
      shift
      ;;
    --audit)
      GATE5_AUDIT=true
      shift
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

if $UPDATE; then
  print_update_manifest
  exit 0
fi

echo -e "${BOLD}=== Witness Design Fidelity Gates (sb-style backpressure) ===${NC}"
echo "Self-hosting: the Witness proof system validates its own design invariants."
echo "This backpressure protects evolution toward the full Shen UI Specifications (design doc)."
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
    3|audit|tcb|regen|regeneration|hash|fidelity)
      run_gate_3
      ;;
    4|emit|emitter|codegen|fidelity-emit)
      run_gate_4
      ;;
    5|fr|freerange|numeric|range)
      run_gate_5
      ;;
    *)
      echo -e "${RED}Unknown --gate value: '$GATE_SPEC'${NC}"
      echo "Valid: 1 / tc / design ,  2 / proofs / property ,  3 / audit / tcb / regen ,  4 / emit / emitter / codegen ,  5 / fr / freerange / numeric / range"
      exit 1
      ;;
  esac
else
  run_gate_1
  run_gate_2
  if [ "$MODE" = "full" ]; then
    run_gate_3
    run_gate_4
    run_gate_5
  else
    echo -e "${YELLOW}--quick mode: Gate 3 (TCB audit) + Gate 4 (emitter) + Gate 5 (freerange) skipped${NC}"
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
echo "  npm run gates          # full suite (Gates 1-5, recommended before PRs)"
echo "  npm run gates -- --quick"
echo "  ./bin/witness-design-gates.sh --gate 4      # emitter fidelity only"
echo "  ./bin/witness-design-gates.sh --emit --gate 4   # regenerate emitted artifacts + check"
echo "  ./bin/witness-design-gates.sh --gate 5       # freerange numeric-range enforcement only"
echo "  ./bin/witness-design-gates.sh --gate 5 --audit  # + Track C's freerange-audit bridge (opt-in)"
echo "  ./bin/witness-design-gates.sh --gate audit   # quick TCB drift check"
echo "  ./bin/witness-design-gates.sh --update-manifest"
echo ""
echo "To strengthen backpressure further:"
echo "  - Add more *.shen under specs/design/ (e.g. ui-component-fidelity.shen, codegen-emitter-fidelity.shen)"
echo "  - Extend emitter further (more components, full live Shen value bridge for verified-card, CI wiring)"
echo "  - Wire into .github/workflows/ and the cli/agent.js loop (like /sb:loop)"
echo ""
exit 0