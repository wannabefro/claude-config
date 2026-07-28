#!/usr/bin/env bash
# Bounded codex exec with the two known failure modes handled.
#
#   codex-run.sh [-t SECONDS] [-d DIR] "<prompt>"
#
# Exit codes are the point — a caller can branch on them instead of guessing
# from output shape:
#   0  answered
#   3  CLI unavailable (preflight failed; do NOT retry, do NOT go hunting)
#   4  stalled (no output for the stall window; killed)
#   5  empty (ran, exited 0, produced no assistant turn even at high effort)
#
# Why each guard exists, measured on this machine:
#  * Preflight. A wedged syspolicyd left `codex --version` itself hanging for
#    13d; every downstream call then burned its full timeout. 10s is generous
#    for a version string, and failing here is decisive rather than a retry.
#  * Effort. Default reasoning effort on gpt-5.5 is `none`, which consumes the
#    prompt and exits 0 with no turn. Always pass medium; retry once at high.
#  * Stall window. A healthy run streams within seconds — sampled 8 runs at
#    5-8s. Silence for minutes means hung on tool use, not thinking, and the
#    fix is to re-run with context inlined, never to wait longer.
#  * Never background. A backgrounded run leaves the async rescue wrapper
#    reporting "still running" forever with no rollout file.
set -uo pipefail

TIMEOUT=600
STALL=120
DIR="."
while [ $# -gt 0 ]; do
  case "$1" in
    -t) TIMEOUT="$2"; shift 2 ;;
    -s) STALL="$2"; shift 2 ;;
    -d) DIR="$2"; shift 2 ;;
    *) break ;;
  esac
done
PROMPT="${1:?usage: codex-run.sh [-t SECS] [-d DIR] \"<prompt>\"}"

if ! timeout 10 codex --version >/dev/null 2>&1; then
  echo "codex-run: CLI unavailable (preflight timed out or failed)." >&2
  echo "codex-run: do not retry or hunt processes — report it unavailable." >&2
  echo "codex-run: if this persists, a wedged syspolicyd has caused it before:" >&2
  echo "codex-run:   ps -o etime= -p \$(pgrep -x syspolicyd)   # days of uptime is the tell" >&2
  exit 3
fi

out=$(mktemp)
trap 'rm -f "$out"' EXIT

run_at() {
  local effort="$1"
  : > "$out"
  ( cd "$DIR" && timeout "$TIMEOUT" codex exec --skip-git-repo-check \
      -c "model_reasoning_effort=$effort" "$PROMPT" > "$out" 2>&1 ) &
  local pid=$! last=0 quiet=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5
    local now; now=$(wc -c < "$out" | tr -d ' ')
    if [ "$now" -gt "$last" ]; then last="$now"; quiet=0; else quiet=$((quiet+5)); fi
    if [ "$quiet" -ge "$STALL" ]; then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 99
    fi
  done
  wait "$pid" 2>/dev/null
  return $?
}

# An assistant turn is anything beyond the echoed prompt and rmcp/oauth noise.
answered() {
  grep -vE '^\s*$|rmcp|oauth|OAuth|^user$|^codex$|tokens used|^\[|ERROR codex_' "$out" \
    | grep -qv -F -x "$PROMPT"
}

run_at medium; rc=$?
if [ "$rc" -eq 99 ]; then
  echo "codex-run: STALLED — no output for ${STALL}s, killed." >&2
  echo "codex-run: hung on tool use. Re-run with the code/context INLINE in the prompt" >&2
  echo "codex-run: so the run needs no file reads or MCP. Waiting longer does not help." >&2
  cat "$out"
  exit 4
fi

if ! answered; then
  run_at high; rc=$?
  if [ "$rc" -eq 99 ]; then
    echo "codex-run: STALLED at high effort — killed. Inline the context and retry." >&2
    cat "$out"; exit 4
  fi
  if ! answered; then
    echo "codex-run: EMPTY — ran and exited $rc with no assistant turn, at medium and high." >&2
    echo "codex-run: report this as an empty pass. It does NOT satisfy a cross-model review." >&2
    cat "$out"
    exit 5
  fi
fi

cat "$out"
exit 0
