#!/usr/bin/env bash
# docs/freerange-demo.sh
#
# 60-second tour of the Witness × freerange composition (Gate 5).
#
# Usage (from repo root):
#   bash docs/freerange-demo.sh
#
# Companion to docs/card-protected-demo.sh (which tours the Shen-side Card
# contracts + Gate 4). This one tours the TypeScript side: what happens to the
# numeric layout math *downstream* of the proofs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

if [[ -t 1 ]]; then
  BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
else
  BOLD=''; GREEN=''; CYAN=''; YELLOW=''; RED=''; NC=''
fi

FR="./node_modules/.bin/fr"
FORK="./vendor/freerange/dist/fr.js"

if [ ! -x "$FR" ]; then
  echo "freerange not installed. Run: npm install"
  exit 1
fi

# freerange resolves its tsconfig from cwd, not from the target file. The
# deliberately-failing examples are excluded from the project tsconfig, so they
# are analyzed standalone from a neutral directory (same trick Gate 5 uses).
fr_standalone() {
  local target="$SCRIPT_DIR/$1"
  local neutral
  neutral=$(mktemp -d)
  ( cd "$neutral" && "$SCRIPT_DIR/$FR" "$target" 2>&1 | sed "s|[^ ]*/examples/|examples/|g" ) || true
  rmdir "$neutral" 2>/dev/null || true
}

echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  WITNESS × FREERANGE — NUMERIC BOUNDS FOR LAYOUT MATH (GATE 5)       ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Witness proves layout obligations in Shen over values it can measure."
echo "freerange proves the arithmetic an app writes around them. Together:"
echo ""
echo -e "  ${CYAN}Shen${NC}      proves the design      (specs/ui/properties/*.shen)"
echo -e "  ${CYAN}emitter${NC}   projects each obligation into console.assert(...)"
echo -e "  ${CYAN}freerange${NC} proves no call site violates one, and proves the"
echo -e "            postconditions hold                       ← Gate 5"
echo ""

echo -e "${BOLD}── 1. The math that ships ─────────────────────────────────────────────${NC}"
echo "examples/ts/grid-layout.ts — a responsive grid. The division by the column"
echo "count is only safe because gridColumnCount's contract guarantees it is >= 1."
echo ""
fr_standalone examples/ts/grid-layout.ts
echo ""
echo -e "${YELLOW}What freerange proved (fr --audit):${NC}"
NEUTRAL=$(mktemp -d)
( cd "$NEUTRAL" && "$SCRIPT_DIR/$FR" --audit "$SCRIPT_DIR/examples/ts/grid-layout.ts" 2>&1 \
  | sed "s|[^ ]*/examples/|examples/|g" | grep -E "^[a-zA-Z]+$|ensures|requires" | head -12 ) || true
rmdir "$NEUTRAL" 2>/dev/null || true
echo ""
echo -e "  ${GREEN}Note${NC}: it derived the real breakpoint widths — 320 / 245.33 / 243.2 px —"
echo "  statically. No browser, no reflow, no screenshot."
echo ""

echo -e "${BOLD}── 2. The bug that doesn't ship ───────────────────────────────────────${NC}"
echo "examples/ts/grid-layout-broken.ts is identical, plus one call that leaves"
echo "200px of content width. tsc says it's fine — the argument is a good number."
echo ""
fr_standalone examples/ts/grid-layout-broken.ts
echo -e "  ${GREEN}A range error, not a type error. Caught at build time.${NC}"
echo ""

echo -e "${BOLD}── 3. Across file boundaries (the Witness fork) ───────────────────────${NC}"
echo "Published freerange 0.0.2 does not check contracts through an import — so"
echo "the guarantee stops at the file boundary, which is where every real"
echo "consumer of generated code lives. examples/ts/cross-file/app.ts violates"
echo "TWO contracts from ./card-math.ts:"
echo ""
echo -e "${YELLOW}  published @chenglou/freerange@0.0.2:${NC}"
( cd examples/ts/cross-file && "$SCRIPT_DIR/$FR" 2>&1 | sed 's/^/    /' ) || true
echo ""
if [ -f "$FORK" ]; then
  echo -e "${YELLOW}  vendor/freerange (Witness fork, --cross-file):${NC}"
  ( cd examples/ts/cross-file && node "$SCRIPT_DIR/$FORK" --cross-file 2>&1 | sed 's/^/    /' ) || true
  echo ""
  echo -e "  ${GREEN}Both violations caught; coverage goes 2/4 → 4/4 functions analyzed.${NC}"
  echo "  See vendor/freerange/WITNESS-FORK.md for the change and whether it's upstreamable."
else
  echo -e "  ${RED}vendor/freerange/dist/fr.js not built.${NC} Build it with:"
  echo "    cd vendor/freerange && bun run build"
fi
echo ""

echo -e "${BOLD}── 4. The same check, as a gate ───────────────────────────────────────${NC}"
echo "Gate 5 runs freerange over the whole project AND runs a deliberately-broken"
echo "fixture that it expects to fail — a gate that cannot fail is not a gate."
echo ""
echo -e "  ${CYAN}./bin/witness-design-gates.sh --gate 5${NC}          # ~1s"
echo -e "  ${CYAN}./bin/witness-design-gates.sh --gate 5 --audit${NC}  # + the Shen bounds bridge"
echo -e "  ${CYAN}npm run gates${NC}                                   # all five"
echo ""
echo "The generated module Gate 5 protects: codegen/emitters/generated/card/card-layout.ts"
echo "Its console.asserts are projected from the Shen theorems, one comment each."
echo ""
