#!/usr/bin/env bash
# Bounded codex exec with the two known failure modes handled.
#
#   codex-run.sh [-t SECONDS] [-s STALL_SECS] [-d DIR] [-M] [-N] "<prompt>"
#   codex-run.sh -f brief.md -N        # brief inlined from a file, no exploring
#   … | codex-run.sh -f - -N           # same, from stdin
#
# Use a file to CARRY the prompt, never to REFER to one. `-f` reads the file and
# inlines it, so Codex needs no tool call. Naming a path inside the prompt makes
# Codex open it, and tool use is the measured failure mode. `-N` appends the
# no-exploration constraint; omit it for a rescue that must read the repo.
#
# Exit codes are the point — a caller can branch on them instead of guessing
# from output shape:
#   0  answered
#   3  CLI unavailable (preflight failed; do NOT retry, do NOT go hunting)
#   4  stalled (no output for the stall window; killed)
#   5  empty (ran, exited 0, produced no assistant turn even at high effort)
#   6  refused (provider returned no capacity, e.g. out of credits — NOT a review)
#
# Why each guard exists, measured on this machine:
#  * Preflight. A wedged syspolicyd left `codex --version` itself hanging for
#    13d; every downstream call then burned its full timeout. 10s is generous
#    for a version string, and failing here is decisive rather than a retry.
#  * Effort. Default reasoning effort on gpt-5.5 is `none`, which consumes the
#    prompt and exits 0 with no turn. Always pass medium; retry once at high.
#  * Stall window. Silence inside the run means hung, not thinking. Note the
#    run is buffered to a temp file, so the CALLER sees nothing until the end
#    — that is normal, and is why the heartbeat below exists. Never infer a
#    stall from the caller's view; only this script's watcher can see it.
#  * No MCP. `codex exec` is non-interactive, so a tool carrying
#    approval_mode="approve" has no way to be approved. config.toml has 14 of
#    them plus context-mode's default_tools_approval_mode. Worse, codegraph
#    and serena index the whole repo: measured 2026-07-30 on a large monorepo,
#    a plan review with them enabled was still crawling at 600s, while the same
#    question with both disabled answered in well under 200s. Shell is built
#    in, not MCP, so the run keeps rg/sed/nl and loses nothing it needs.
#    Pass -M for a run that genuinely needs a remote MCP server.
#  * Never background. A backgrounded run leaves the async rescue wrapper
#    reporting "still running" forever with no rollout file.
set -uo pipefail

TIMEOUT=600
STALL=120
DIR="."
MCP=0
FROM_FILE=""
NO_EXPLORE=0
while [ $# -gt 0 ]; do
  case "$1" in
    -t) TIMEOUT="$2"; shift 2 ;;
    -s) STALL="$2"; shift 2 ;;
    -d) DIR="$2"; shift 2 ;;
    -M) MCP=1; shift ;;
    -f) FROM_FILE="$2"; shift 2 ;;
    -N) NO_EXPLORE=1; shift ;;
    *) break ;;
  esac
done

if [ -n "$FROM_FILE" ]; then
  if [ "$FROM_FILE" = "-" ]; then
    PROMPT=$(cat)
  else
    [ -r "$FROM_FILE" ] || { echo "codex-run: cannot read $FROM_FILE" >&2; exit 2; }
    PROMPT=$(cat "$FROM_FILE")
  fi
  [ -n "$PROMPT" ] || { echo "codex-run: $FROM_FILE is empty" >&2; exit 2; }
else
  PROMPT="${1:?usage: codex-run.sh [-t SECS] [-s SECS] [-d DIR] [-M] [-N] (-f FILE|-|\"<prompt>\")}"
fi

if [ "$NO_EXPLORE" -eq 1 ]; then
  PROMPT="$PROMPT

HARD CONSTRAINT: Do NOT read any files. Do NOT run any shell commands. Do NOT
search the repo. Everything you need is stated above. A run that explores the
repo is a failed run."
fi

if ! timeout 10 codex --version >/dev/null 2>&1; then
  echo "codex-run: CLI unavailable (preflight timed out or failed)." >&2
  echo "codex-run: do not retry or hunt processes — report it unavailable." >&2
  echo "codex-run: if this persists, a wedged syspolicyd has caused it before:" >&2
  echo "codex-run:   ps -o etime= -p \$(pgrep -x syspolicyd)   # days of uptime is the tell" >&2
  exit 3
fi

out=$(mktemp)
trap 'rm -f "$out"' EXIT

MCP_ARGS=()
[ "$MCP" -eq 0 ] && MCP_ARGS=(-c 'mcp_servers={}')

run_at() {
  local effort="$1"
  : > "$out"
  ( cd "$DIR" && timeout "$TIMEOUT" codex exec --skip-git-repo-check \
      "${MCP_ARGS[@]}" -c "model_reasoning_effort=$effort" "$PROMPT" \
      < /dev/null > "$out" 2>&1 ) &
  local pid=$! last=0 quiet=0 elapsed=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed+5))
    local now; now=$(wc -c < "$out" | tr -d ' ')
    if [ "$now" -gt "$last" ]; then last="$now"; quiet=0; else quiet=$((quiet+5)); fi
    # Output is buffered, so without this the caller cannot tell a working run
    # from a hung one and kills a healthy pass. Measured: that happened twice.
    if [ $((elapsed % 30)) -eq 0 ]; then
      echo "codex-run: ${effort} effort, ${elapsed}s elapsed, ${now} bytes, ${quiet}s quiet" >&2
    fi
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

# Codex exits 0 on a refusal. Match the exact phrase, or a rate-limit review fails.
refused() {
  grep -qiF 'workspace is out of credits' "$out"
}

run_at medium; rc=$?
if [ "$rc" -eq 99 ]; then
  echo "codex-run: STALLED — no output for ${STALL}s, killed." >&2
  echo "codex-run: MCP is already off unless you passed -M; if you did, drop it." >&2
  echo "codex-run: otherwise re-run with the code/context INLINE so the run needs" >&2
  echo "codex-run: no file reads. Waiting longer does not help." >&2
  cat "$out"
  exit 4
fi

if refused; then
  echo "codex-run: REFUSED — the provider returned no capacity, not a review." >&2
  echo "codex-run: this does NOT satisfy a cross-model pass. Report the gap." >&2
  cat "$out"
  exit 6
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
