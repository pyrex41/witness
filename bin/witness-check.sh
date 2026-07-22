#!/bin/bash
# bin/witness-check.sh — Two-phase proof checking: measure (Node) + check (tc+)
#
# Usage: witness-check.sh <file.shen> [file2.shen ...]
#
# Phase 1: Node.js + Pretext measures all text/font pairs
# Phase 2: Shen type-checks (tc+) with cached measurements
#
# Phase 2 engine selection, in order:
#   1. ShenScript (cli/shen-check.js)  — DEFAULT. Runs the Shen kernel in-process
#      via vendor/shen-script + boot.js. Same (tc +) semantics, ~1s for the design
#      specs, and a real exception on failure instead of a scraped REPL prompt.
#   2. A native kernel (shen-cl / shen-sbcl) — legacy path, kept because it is a
#      genuinely independent implementation; useful as a cross-check.
#
# Why ShenScript is the default: the native path decides pass/fail by grepping
# scraped terminal output for a `(N+)` prompt, and both binaries have practical
# problems here — shen-cl reads /dev/tty and hangs forever on piped stdin (hence
# the `script -q /dev/null` pty wrapper below), while shen-sbcl's 4-second
# availability probe yields false negatives on a loaded machine and full runs
# have exceeded 15 minutes. ShenScript needs no probe, no pty, and no scraping.
#
# Force a specific engine:
#   WITNESS_SHEN_ENGINE=shenscript ./bin/witness-check.sh <files>   (default)
#   WITNESS_SHEN_ENGINE=native    ./bin/witness-check.sh <files>
#   SHEN_BIN=shen-cl WITNESS_SHEN_ENGINE=native ./bin/witness-check.sh <files>

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

WITNESS_SHEN_ENGINE="${WITNESS_SHEN_ENGINE:-shenscript}"

if [ "$WITNESS_SHEN_ENGINE" = "shenscript" ]; then
  if [ $# -eq 0 ]; then
    echo "Usage: witness-check.sh <file.shen> [file2.shen ...]"
    echo ""
    echo "Two-phase proof checking:"
    echo "  Phase 1: Measure text with Pretext (Node.js)"
    echo "  Phase 2: Type-check under tc+ (ShenScript, in-process)"
    exit 1
  fi

  echo "Phase 1: Measuring text..."
  node "$SCRIPT_DIR/cli/measure.js" "$@" || exit 1

  echo ""
  echo "Phase 2: Type-checking with ShenScript (tc+)..."
  node "$SCRIPT_DIR/cli/shen-check.js" "$@"
  exit $?
fi

# ---------------------------------------------------------------------------
# Legacy native-kernel path (WITNESS_SHEN_ENGINE=native)
# ---------------------------------------------------------------------------

# Prefer shen-cl (faster kernel from https://github.com/pyrex41/shen-cl)
# Fall back to official shen-sbcl if shen-cl is not installed or fails a basic smoke test.
# (Some shen-cl builds have REPL/tty issues in non-interactive/CI environments.)
test_shen() {
  local bin="$1"
  if ! command -v "$bin" &> /dev/null; then
    return 1
  fi
  # Quick smoke: must produce a clean prompt without immediate type errors or tty failures.
  if echo '(+ 1 1)' | timeout 4 "$bin" 2>&1 | grep -Eq 'Error opening /dev/tty|not of type|fatal error'; then
    return 1
  fi
  return 0
}

if [ -n "${SHEN_BIN:-}" ] && test_shen "$SHEN_BIN"; then
  : # user-forced and working
elif test_shen shen-cl; then
  SHEN_BIN="shen-cl"
elif test_shen shen-sbcl; then
  SHEN_BIN="shen-sbcl"
else
  echo "ERROR: No working Shen binary found (shen-cl or shen-sbcl)."
  echo ""
  echo "shen-cl (fast, recommended for local iteration):"
  echo "  git clone https://github.com/pyrex41/shen-cl"
  echo "  cd shen-cl && make && make install"
  echo "  (If it fails the smoke test here, run with SHEN_BIN=shen-cl on your dev machine.)"
  echo ""
  echo "Reliable fallback:"
  echo "  brew install shen-sbcl"
  exit 1
fi

if [ $# -eq 0 ]; then
  echo "Usage: witness-check.sh <file.shen> [file2.shen ...]"
  echo ""
  echo "Two-phase proof checking:"
  echo "  Phase 1: Measure text with Pretext (Node.js)"
  echo "  Phase 2: Type-check (fast when SHEN_BIN=shen-cl)"
  exit 1
fi

FILES="$@"

# Phase 1: Measure (Node.js + Pretext)
echo "Phase 1: Measuring text..."
node "$SCRIPT_DIR/cli/measure.js" $FILES

# Phase 2: Type-check (SBCL Shen)
echo ""
echo "Phase 2: Type-checking with $SHEN_BIN (tc+)..."

# Build the Shen commands: cd to project root, load measurements, load framework, load user files
SHEN_CMDS=""
SHEN_CMDS+="(cd \"$SCRIPT_DIR/\")"$'\n'
SHEN_CMDS+="(load \".witness/measurements.shen\")"$'\n'
SHEN_CMDS+="(load \"shen/witness-sbcl.shen\")"$'\n'
for f in $FILES; do
  # Make path relative to SCRIPT_DIR if possible, else use absolute
  ABSPATH="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
  RELPATH="${ABSPATH#$SCRIPT_DIR/}"
  SHEN_CMDS+="(load \"$RELPATH\")"$'\n'
done

# Run the Shen in background, scan output for result.
# shen-cl (the user's fast SBCL port) is sensitive to pipe vs. pty and
# tends to drop into the low-level ldb debugger on certain fatal errors.
# When we detect shen-cl we give it a real pty via `script` so it behaves
# more like a normal terminal session. This dramatically reduces the
# silent ldb> / broken-pipe deaths.
TMPOUT=$(mktemp)

if [[ "$SHEN_BIN" == *"shen-cl"* ]]; then
  # pty wrapper for shen-cl robustness
  script -q /dev/null "$SHEN_BIN" < <(printf '%s\n' "$SHEN_CMDS") > "$TMPOUT" 2>&1 &
  SHEN_PID=$!
else
  echo "$SHEN_CMDS" | timeout 120 "$SHEN_BIN" > "$TMPOUT" 2>&1 &
  SHEN_PID=$!
fi

RESULT="unknown"
for i in $(seq 1 250); do
  sleep 0.5

  if grep -q "type error" "$TMPOUT" 2>/dev/null; then
    RESULT="type_error"
    break
  fi

  if grep -q "Layout overflow" "$TMPOUT" 2>/dev/null; then
    RESULT="overflow"
    break
  fi

  # After tc+ is enabled and user files load, the prompt changes to (N+).
  # We need to wait for the LAST file to load. Check for the tc+ prompt
  # appearing AFTER the user file's content (not just after witness-sbcl.shen).
  # Count how many "loaded" or prompt lines appear after tc+ prompt.
  if grep -qE '^\([0-9]+\+\)' "$TMPOUT" 2>/dev/null; then
    # tc+ is active. Check that user file(s) loaded too.
    # The user file load produces "loaded" or function names after the (N+) prompt.
    TC_LINE=$(grep -nE '^\([0-9]+\+\)' "$TMPOUT" 2>/dev/null | head -1 | cut -d: -f1)
    TOTAL_LINES=$(wc -l < "$TMPOUT" 2>/dev/null)
    if [ "$TOTAL_LINES" -gt "$((TC_LINE + 2))" ] 2>/dev/null; then
      RESULT="pass"
      break
    fi
  fi

  # Check if shen died
  if ! kill -0 "$SHEN_PID" 2>/dev/null; then
    break
  fi
done

# Kill shen
kill "$SHEN_PID" 2>/dev/null
wait "$SHEN_PID" 2>/dev/null

case "$RESULT" in
  pass)
    echo "  ✓ All proofs verified"
    rm -f "$TMPOUT"
    exit 0
    ;;
  type_error)
    echo "  ✗ Type error detected:"
    grep -A2 "type error" "$TMPOUT" | head -5
    rm -f "$TMPOUT"
    exit 1
    ;;
  overflow)
    echo "  ✗ Layout overflow detected:"
    grep "Layout overflow" "$TMPOUT" | head -5
    rm -f "$TMPOUT"
    exit 1
    ;;
  *)
    echo "  ? Check did not complete within timeout (or shen-cl hit a fatal condition)"
    if grep -q "ldb>" "$TMPOUT" 2>/dev/null; then
      echo "  Detected: shen-cl dropped into the SBCL low-level debugger (ldb>)"
      echo "  This is usually a fatal internal error during loading under tc+."
      echo "  Full captured output follows:"
      cat "$TMPOUT"
    else
      echo "  Last part of captured output:"
      tail -50 "$TMPOUT"
    fi
    rm -f "$TMPOUT"
    exit 1
    ;;
esac
