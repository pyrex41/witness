#!/bin/bash
# bin/witness-loop.sh
#
# Dedicated Ralph-style gate-protected loop launcher for Witness.
# Provides the first-class "protected development environment" experience
# for evolving the Shen UI Specifications (Card spike, emitters, design contracts).
#
# This is the implementation behind `witness loop` (and `witness-loop` binary).
# It normalizes args, prints a rich banner, supports flexible --gate selection
# (quick for speed, full for TCB+emitter, or individual gates like 4 for emitter work),
# then delegates to the gate-aware agent (cli/agent.js) which runs the chosen
# gates *before every internal iteration* and surfaces rich DESIGN SPEC VIOLATION
# feedback on failure (sb-style backpressure).
#
# On gate failure the exact output from the gate runner + remediation instructions
# are fed back so autonomous agents (or /witness:loop in Claude) cannot drift.
#
# Usage is the same as the subcommand; this script adds the nice UX layer.
#
# Supports:
#   --max-iter N
#   --dry-run
#   --gate <quick|full|1|2|3|4|audit|emitter|tc|proofs|...>
#     quick  = Gates 1+2 (fast, default for inner loop)
#     full   = all gates (1-4, TCB audit + emitter fidelity)
#     N      = single gate (e.g. --gate 4 while iterating on the Card emitter)
#     audit|emitter etc. map to the gate runner's --gate values
#
# Philosophy: the same proof system that makes overflow a compile error for users
# now makes design drift a hard stop for the evolution of the system itself.
#
# See:
#   witness gates --help
#   .claude/commands/witness/loop.md
#   specs/design/README.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- Colors (match style of witness-design-gates.sh) ---
setup_colors() {
  if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    CYAN='\033[0;36m'
    NC='\033[0m'
  else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    CYAN=''
    NC=''
  fi
}

usage() {
  cat <<'EOF'
witness-loop.sh — Ralph-style gate-protected autonomous loop (first-class protected dev env)

Usage:
  ./bin/witness-loop.sh <files...> [options]
  witness loop <files...> [options]
  witness-loop <files...> [options]
  npm run loop -- <files...> [options]   (if configured)

Options:
  --max-iter N         Maximum agent iterations (default: 10). Agent will stop early on success.
  --dry-run            Run the protected loop (gates execute before each iter, reports appear) but do not apply any auto-fixes to files.
  --gate <spec>        Gate strictness / selection for every iteration (before loads/fixes):
                         quick   — fast (Gates 1 + 2 only, default)
                         full    — strict (Gates 1-4: tc+, proofs, TCB audit, emitter fidelity)
                         1|2|3|4 — single gate (e.g. --gate 4 for Card emitter work)
                         audit|emitter|tc|proofs|design|property|regen|tcb — aliases supported by gates runner
  -h, --help           Show this help.

The loop turns your terminal (or the agent's observation) into a live verified environment:
- Design gates run *before each agent iteration*.
- Any gate failure becomes a high-priority DESIGN SPEC VIOLATION with the *full* gate output
  and exact instructions ("edit the spec or the implementation").
- The agent can still auto-apply simple layout widen fixes for user .shen files (overflow proofs),
  but design violations have no auto-fix — the rich message stops the loop and becomes feedback.
- Perfect for the Card spike, shen-witness emitter, adding new verified components, etc.

Examples (Card spike focus):
  # Typical inner-loop work on Card contracts (fast gates)
  witness loop specs/ui/card-spec.shen --max-iter 8

  # Strict full fidelity (includes TCB hash + emitter check) while evolving core + specs
  witness loop specs/ui/card-spec.shen specs/design/witness-core.shen --max-iter 5 --gate full

  # Focused emitter development (only Gate 4 fidelity on every step)
  witness loop codegen/emitters/card-emitter.js specs/ui/card-spec.shen --max-iter 20 --gate 4 --dry-run

  # Direct binary (after npm install -g or npm link)
  witness-loop examples/counter.shen --respect-design-gates --max-iter 3

  # See exactly what would be invoked
  witness loop specs/ui/card-spec.shen --dry-run --gate full

The underlying agent still supports the explicit form:
  witness agent <files...> --respect-design-gates --gate 4 --max-iter 10

This is the self-hosting backpressure in action: the proof engine protects its own evolution.
EOF
}

# --- Parse args ---
MAX_ITER=10
DRY_RUN=false
GATE_SPEC="quick"
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-iter)
      [[ $# -lt 2 ]] && { echo "Missing value for --max-iter"; usage; exit 1; }
      MAX_ITER="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --gate)
      [[ $# -lt 2 ]] && { echo "Missing value for --gate"; usage; exit 1; }
      GATE_SPEC="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ "$1" != --* ]]; then
        FILES+=("$1")
      else
        echo -e "${RED}Unknown option: $1${NC}"
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo -e "${RED}No files specified.${NC}"
  echo ""
  usage
  exit 1
fi

setup_colors

# --- Banner (the "protected environment" feel) ---
echo -e "${BOLD}${BLUE}=== Witness Gate-Protected Loop (Ralph-style) ===${NC}"
echo -e "Self-hosting backpressure for the Shen UI spec system (Card, emitter, contracts)."
echo ""
echo -e "  Gate mode this run : ${CYAN}${GATE_SPEC}${NC}   (quick=fast 1+2 | full=1-4 TCB+emitter | N=single gate)"
echo -e "  Max agent iters    : ${YELLOW}${MAX_ITER}${NC}"
echo -e "  Dry-run            : ${YELLOW}${DRY_RUN}${NC}"
echo -e "  Files under watch  :"
for f in "${FILES[@]}"; do
  echo -e "    - ${f}"
done
echo ""
echo -e "${YELLOW}Design gates will run before every iteration.${NC}"
echo -e "Gate failures surface as first-class ${RED}DESIGN SPEC VIOLATION${NC} blocks with exact remediation."
echo -e "The same machinery that protects user layouts now protects the evolution of Witness itself."
echo ""
if $DRY_RUN; then
  echo -e "${BOLD}[dry-run mode]${NC} Gates will execute and agent will report, but no file mutations will occur."
  echo -e "  (You will still see the full rich gate output and iteration logs — ideal for observing backpressure without risk.)"
fi
echo -e "Equivalent direct command: node cli/agent.js ${FILES[*]} --max-iter ${MAX_ITER} --respect-design-gates --gate ${GATE_SPEC}${DRY_RUN:+ --dry-run}"
echo ""

# --- Delegate to the real agent (which contains the per-iteration gate enforcement + auto-fix logic) ---
# We always inject --respect-design-gates and the chosen --gate so the internal loop in agent.js
# runs the selected gates (quick/full/single) before attempting loads or widen fixes.
AGENT_ARGS=("${FILES[@]}")
AGENT_ARGS+=(--max-iter "${MAX_ITER}")
AGENT_ARGS+=(--respect-design-gates)
AGENT_ARGS+=(--gate "${GATE_SPEC}")
if $DRY_RUN; then
  AGENT_ARGS+=(--dry-run)
fi

echo -e "${BOLD}Launching gate-aware agent...${NC}"
echo ""

# Exec so signals / exit codes propagate cleanly; all the rich gate + iteration output flows through.
exec node "${SCRIPT_DIR}/cli/agent.js" "${AGENT_ARGS[@]}"
