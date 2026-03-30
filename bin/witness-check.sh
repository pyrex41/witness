#!/bin/bash
# bin/witness-check.sh — Two-phase proof checking: measure (Node) + check (SBCL)
#
# Usage: witness-check.sh <file.shen> [file2.shen ...]
#
# Phase 1: Node.js + Pretext measures all text/font pairs
# Phase 2: SBCL Shen type-checks with cached measurements (fast)

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SHEN_BIN="${SHEN_BIN:-shen-sbcl}"

if [ $# -eq 0 ]; then
  echo "Usage: witness-check.sh <file.shen> [file2.shen ...]"
  echo ""
  echo "Two-phase proof checking:"
  echo "  Phase 1: Measure text with Pretext (Node.js)"
  echo "  Phase 2: Type-check with SBCL Shen (fast)"
  exit 1
fi

# Check shen-sbcl is available
if ! command -v "$SHEN_BIN" &> /dev/null; then
  echo "ERROR: $SHEN_BIN not found. Install via: brew install shen-sbcl"
  exit 1
fi

FILES="$@"

# Phase 1: Measure (Node.js + Pretext)
echo "Phase 1: Measuring text..."
node "$SCRIPT_DIR/cli/measure.js" $FILES

# Phase 2: Type-check (SBCL Shen)
echo ""
echo "Phase 2: Type-checking with SBCL..."

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

# Run shen-sbcl in background, scan output for result
# (shen-sbcl loops on empty stream instead of exiting)
TMPOUT=$(mktemp)
echo "$SHEN_CMDS" | timeout 30 "$SHEN_BIN" > "$TMPOUT" 2>&1 &
SHEN_PID=$!

RESULT="unknown"
for i in $(seq 1 60); do
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
    echo "  ? Check did not complete within timeout"
    echo "  Output:"
    cat "$TMPOUT" | grep -v "empty stream" | head -20
    rm -f "$TMPOUT"
    exit 1
    ;;
esac
