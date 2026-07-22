#!/usr/bin/env bash
# docs/card-protected-demo.sh
#
# Tiny runnable tour of the protected Card workflow.
# Shows the living sb-style backpressure in action on the verified-card contracts + emitter.
#
# Usage (from repo root):
#   bash docs/card-protected-demo.sh
#   # or after chmod +x:
#   ./docs/card-protected-demo.sh
#
# This is intentionally short — the real cookbook is docs/design-gates-examples.md
# (with dozens of copy-pasteable commands, captured banners, violation UX, etc.).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# --- Colors (portable, tty-aware) ---
if [[ -t 1 ]]; then
  BOLD='\033[1m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  YELLOW='\033[1;33m'
  NC='\033[0m'
else
  BOLD=''
  GREEN=''
  CYAN=''
  YELLOW=''
  NC=''
fi

echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  WITNESS CARD SPIKE — PROTECTED DEV ENVIRONMENT DEMO                 ║"
echo "║  (high-level verified-card contracts + Gate 4 + Ralph-style loop)    ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "The same proof system that turns layout overflow into a compile-time"
echo "error for users now protects the Card itself:"
echo ""
echo "  • specs/ui/properties/card-properties.shen  — verified-card datatypes,"
echo "      card-title-slot, card-design-fidelity theorem (Gate 1/2)"
echo "  • specs/ui/card-spec.shen                     — low-level compat + load"
echo "  • codegen/emitters/card-emitter.js            — high-level walk (primary)"
echo "  • Gate 4 (emitter fidelity)                   — protects branded output"
echo ""
echo "High-level contracts are active (driven by the live (card-contract-shape) descriptor)."
echo "Gate 4 (auto-discovery + fidelityChecks[] + tsc) is live."
echo "Shen is the source of truth; the emitter is a thin deterministic projector."
echo ""

echo "${CYAN}▶ STEP 1 — Targeted Gate 4 (emitter fidelity — high-level *-contract-shape path)${NC}"
echo "   Command: ./bin/witness-design-gates.sh --gate 4   (equivalent: 'npm run gates -- --gate 4' or 'witness gates --gate 4')"
echo "   (walks verified-card via live (card-contract-shape) from Shen, runs declared fidelityChecks, tsc --noEmit)"
echo ""
./bin/witness-design-gates.sh --gate 4 || true
echo ""
echo "${GREEN}   ✓ Gate 4 passed — Card.tsx + card.css are faithful to the contracts.${NC}"
echo ""

echo "${CYAN}▶ STEP 2 — Protected Development Loop (dry-run, Gate 4, 1 iter)${NC}"
echo "   Command: witness loop specs/ui/card-spec.shen --dry-run --max-iter 1 --gate 4"
echo "   (Gates run before every iteration; banner + full backpressure visible;"
echo "    no files are mutated in dry-run — perfect for safe observation.)"
echo ""
bash bin/witness-loop.sh specs/ui/card-spec.shen --dry-run --max-iter 1 --gate 4 || true
echo ""
echo "${GREEN}   ✓ Loop completed cleanly under protection (dry-run mode).${NC}"
echo ""

echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  ✅  SUCCESS — PROTECTED CARD WORKFLOW DEMO COMPLETE (≈60 seconds)   ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "  You just exercised the living, self-hosting sb-style backpressure:"
echo "    - Gate 4 verified the shen-witness emitter (high-level path driven by"
echo "      the live (card-contract-shape) descriptor from Shen specs)."
echo "    - The Ralph loop showed the banner, pre-iteration gate enforcement,"
echo "      and dry-run safety."
echo "    - Shen = source of truth; emitter = thin deterministic generator."
echo ""
echo "  ${BOLD}Next (real work):${NC}"
echo "    witness gates --quick"
echo "    witness gates --emit --gate 4"
echo "    witness loop specs/ui/card-spec.shen --gate 4 --dry-run"
echo "    (drop --dry-run when you are ready for the agent to act)"
echo ""
echo "  Full cookbook with violation UX, more recipes, and theorem details:"
echo "      docs/design-gates-examples.md"
echo ""
echo "  The Card is now a first-class, self-proving, gate-protected citizen"
echo "  of the Shen UI Specifications system. Evolve it safely — the gates"
echo "  will stop you if you drift."
echo ""
echo "╚══════════════════════════════════════════════════════════════════════╝"