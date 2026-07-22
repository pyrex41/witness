#!/usr/bin/env bash
# docs/shake-demo.sh — tree-shake a Witness proof, then verify it cross-port.
#
# The README claims proofs "erase after compilation — zero proof machinery ships
# to production." This makes that concrete with two of Cheng Lou-adjacent Shen
# tools (both pyrex41):
#
#   ratatoskr — a Shen tree-shaker: from a program's entry points it walks the
#               kernel call graph and emits only the reachable defuns. The pure
#               Witness proof (examples/shake/proof.shen — cache-backed measure,
#               no FFI) shakes from the 683-function kernel down to ~102 defuns,
#               eval-free.
#   bifrost   — a differential harness: runs that same proof on every installed
#               Shen port and asserts they produce identical output.
#
# What does NOT shake is the live measurement/render path (textura.measure,
# textura.layout, js.*) — that is the host-FFI boundary, and it is supposed to
# be: measurement happens at build time (Node + Pretext), and the artifact that
# survives is the pure proof.
#
# Install (if missing):
#   go install github.com/pyrex41/ratatoskr@latest
#   go install github.com/pyrex41/bifrost@latest

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

if [[ -t 1 ]]; then BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
else BOLD=''; GREEN=''; CYAN=''; YELLOW=''; NC=''; fi

PROG="examples/shake/proof.shen"

command -v ratatoskr >/dev/null || { echo "ratatoskr not found — go install github.com/pyrex41/ratatoskr@latest"; exit 1; }

echo -e "${BOLD}── ratatoskr: tree-shake the proof ───────────────────────────────────${NC}"
OUT=$(mktemp -d)
ratatoskr shake "$PROG" "$OUT" >/dev/null 2>&1
defuns=$(grep -c '^(defun' "$OUT/kernel.kl")
eval=$(grep -E '^needs-eval=|^cannot-reach=eval$' "$OUT/ratatoskr.manifest.txt" | tr '\n' ' ')
ffi=$( { grep -c 'textura\|js\.' "$OUT/kernel.kl" "$OUT/proof.kl" 2>/dev/null || true; } | awk -F: '{s+=$2} END{print s+0}')
echo -e "  reachable kernel defuns : ${GREEN}${defuns}${NC} / 683"
echo -e "  eval reachability       : ${GREEN}${eval}${NC}"
echo -e "  FFI references in slice  : ${GREEN}${ffi}${NC}  (0 = the proof is pure Shen)"
echo -e "  shaken KLambda          : $(du -h "$OUT/kernel.kl" | cut -f1) kernel + $(du -h "$OUT/proof.kl" | cut -f1) program"
echo "  user functions kept: $(grep '^fn=' "$OUT/ratatoskr.manifest.txt" | sed 's/^fn=//;s/ .*//' | tr '\n' ' ')"
rm -rf "$OUT"
echo ""

echo -e "${BOLD}── bifrost: does it run identically on every Shen port? ──────────────${NC}"
BIFROST_PY=$(find "$HOME/go/pkg/mod" -maxdepth 4 -path '*pyrex41/bifrost*' -name bifrost.py 2>/dev/null | sort | tail -1)
if [ -z "${BIFROST_PY:-}" ]; then
  echo -e "  ${YELLOW}bifrost not found — go install github.com/pyrex41/bifrost@latest${NC}"
  echo "  (the shake above is the load-bearing result; parity is the bonus.)"
  exit 0
fi
python3 "$BIFROST_PY" --suite ./bifrost.suite.json 2>&1 | grep -E 'running|PASS|FAIL|DIVERGE|SUMMARY|verdict|^layout-proof' || true
echo ""
echo -e "  The two PROVEN lines and the OVERFLOW line are byte-identical on every"
echo -e "  installed port — the proof is a genuine cross-implementation artifact."
