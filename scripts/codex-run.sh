#!/usr/bin/env bash
# Bounded Codex planning/review pass with one fixed model and effort.
#
#   codex-run.sh [-t SECONDS] [-s STALL_SECS] [-d DIR] [-B BUNDLE] [-S FILE] [-M] [-N] "<prompt>"
#   codex-run.sh -f brief.md -N        # brief inlined from a file, no exploring
#   … | codex-run.sh -f - -N           # same, from stdin
#
# Use a file to CARRY the prompt, never to REFER to one. `-f` reads the file and
# sends it through stdin, so the CLI never receives a giant prompt in argv and
# Codex needs no tool call. Naming a path inside the prompt makes
# Codex open it, and tool use is the measured failure mode. `-N` appends the
# no-exploration constraint; omit it for a rescue that must read the repo.
#
# Planning, diagnosis, and review always use gpt-5.6-sol at xhigh effort. The
# script makes one attempt only: an empty pass is reported, not retried at a
# different model or effort.
#
# Exit codes are the point — a caller can branch on them instead of guessing
# from output shape:
#   0  answered with a real assistant result
#   3  CLI unavailable (preflight failed; do NOT retry, do NOT go hunting)
#   4  stalled (no output for the stall window; killed)
#   5  empty (ran, exited 0, produced no assistant result)
#   6  refused (provider returned no capacity, e.g. out of credits — NOT a review)
#   7  runtime failure (CLI exited non-zero before producing an answer)
#   8  secret scan refused transfer (review content was not sent cross-provider)
#
# Why each guard exists, measured on this machine:
#  * Preflight. A wedged syspolicyd left `codex --version` itself hanging for
#    13d; every downstream call then burned its full timeout. 10s is generous
#    for a version string, and failing here is decisive rather than a retry.
#  * Model, effort, and sandbox. The fixed Sol/xhigh/read-only arguments prevent
#    default-model inheritance and avoid silent effort fallback or writes.
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
umask 077

TIMEOUT=600
STALL=120
DIR="."
BUNDLE=""
SECRET_FILE=""
MCP=0
FROM_FILE=""
NO_EXPLORE=0
PREFLIGHT_FAILURE=68
while [ $# -gt 0 ]; do
  case "$1" in
    -t) TIMEOUT="$2"; shift 2 ;;
    -s) STALL="$2"; shift 2 ;;
    -d) DIR="$2"; shift 2 ;;
    -B) BUNDLE="$2"; shift 2 ;;
    -S) SECRET_FILE="$2"; shift 2 ;;
    -M) MCP=1; shift ;;
    -f) FROM_FILE="$2"; shift 2 ;;
    -N) NO_EXPLORE=1; shift ;;
    *) break ;;
  esac
done

if [ -n "$FROM_FILE" ]; then
  if [ "$FROM_FILE" = "-" ]; then
    : # stdin is copied byte-for-byte after the runtime directory is ready
  else
    [ -r "$FROM_FILE" ] || { echo "codex-run: cannot read $FROM_FILE" >&2; exit 2; }
  fi
else
  if [ $# -lt 1 ]; then
    echo 'usage: codex-run.sh [-t SECS] [-s SECS] [-d DIR] [-B BUNDLE] [-S FILE] [-M] [-N] (-f FILE|-|"<prompt>")' >&2
    exit 2
  fi
  PROMPT="$1"
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" 2>/dev/null && pwd -P)" || {
  echo "codex-run: wrapper directory could not be resolved." >&2
  exit 3
}
source "$SCRIPT_DIR/codex-preflight.sh" || {
  echo "codex-run: shared Codex preflight is unavailable." >&2
  exit 3
}
if ! codex_preflight review; then
  echo "codex-run: CLI unavailable (approved Codex command failed preflight)." >&2
  echo "codex-run: do not retry or hunt processes — report it unavailable." >&2
  exit 3
fi
PERL_BIN="$CODEX_PREFLIGHT_PERL"

SECRET_SCANNER="$SCRIPT_DIR/review-secret-scan.sh"
[ -x "$SECRET_SCANNER" ] || { echo 'codex-run: cross-provider secret scanner unavailable; refusing transfer.' >&2; exit 3; }
if [ -n "$BUNDLE" ]; then
  "$SECRET_SCANNER" "$BUNDLE" >/dev/null || {
    echo 'codex-run: review bundle failed the secret scan; refusing cross-provider transfer.' >&2
    exit 8
  }
fi
if [ -n "$SECRET_FILE" ]; then
  "$SECRET_SCANNER" --file "$SECRET_FILE" >/dev/null || {
    echo 'codex-run: planning brief failed the secret scan; refusing cross-provider transfer.' >&2
    exit 8
  }
fi

run_dir=$(mktemp -d "${TMPDIR:-/tmp}/claude-codex-run.XXXXXXXX") || {
  echo "codex-run: private runtime directory could not be created." >&2
  exit 3
}
run_owner=$(stat -f '%u' "$run_dir" 2>/dev/null || stat -c '%u' "$run_dir" 2>/dev/null || true)
run_mode=$(stat -f '%Lp' "$run_dir" 2>/dev/null || stat -c '%a' "$run_dir" 2>/dev/null || true)
if [ "$run_owner" != "$(id -u)" ] || [ "$run_mode" != '700' ]; then
  rm -rf -- "$run_dir"
  echo "codex-run: private runtime directory is not owner-private." >&2
  exit 3
fi
out="$run_dir/output"
last_message="$run_dir/last-message"
prompt_input="$run_dir/input"
preflight_failure="$run_dir/preflight-failure"
cleanup_run_dir() {
  if [ -n "${run_dir:-}" ] && [ -d "$run_dir" ] && [ ! -L "$run_dir" ]; then
    rm -rf -- "$run_dir"
  fi
}
trap cleanup_run_dir EXIT HUP INT TERM
if [ -n "$FROM_FILE" ]; then
  if [ "$FROM_FILE" = "-" ]; then cat > "$prompt_input"; else cat "$FROM_FILE" > "$prompt_input"; fi
else
  printf '%s' "$PROMPT" > "$prompt_input"
fi
[ -s "$prompt_input" ] || { echo "codex-run: prompt input is empty" >&2; exit 2; }
if [ "$NO_EXPLORE" -eq 1 ]; then
  printf '\n\nHARD CONSTRAINT: Do NOT read any files. Do NOT run any shell commands. Do NOT\nsearch the repo. Everything you need is stated above. A run that explores the\nrepo is a failed run.' >> "$prompt_input"
fi

MCP_ARGS=()
[ "$MCP" -eq 0 ] && MCP_ARGS=(-c 'mcp_servers={}')

run_once() {
  : > "$out"
  : > "$last_message"
  rm -f "$preflight_failure"
  # Scan the exact bytes that will be sent on stdin, immediately before every
  # Codex exec. Bundle and brief scans above are useful preflight checks, but
  # neither is a substitute for this final payload check.
  if ! "$SECRET_SCANNER" --file "$prompt_input" >/dev/null; then return 98; fi
  (
    cd "$DIR" || exit 1
    if ! codex_preflight_revalidate; then
      : > "$preflight_failure"
      exit "$PREFLIGHT_FAILURE"
    fi
    exec "$PERL_BIN" -e 'setpgrp(0, 0); alarm shift; exec @ARGV' "$TIMEOUT" "$CODEX_BIN" exec \
      --skip-git-repo-check \
      --model gpt-5.6-sol \
      --sandbox read-only \
      "${MCP_ARGS[@]}" \
      -c 'model_reasoning_effort=xhigh' \
      --output-last-message "$last_message" \
      -
  ) < "$prompt_input" > "$out" 2>&1 &
  local pid=$! last=0 quiet=0 elapsed=0
  local group_pid self_group
  group_pid=''
  self_group=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ' || true)
  for _ in 1 2 3 4 5; do
    group_pid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
    [ -n "$group_pid" ] && [ "$group_pid" != "$self_group" ] && break
    sleep 0.05
  done
  kill_group() {
    if [[ "$group_pid" =~ ^[0-9]+$ ]] && [ "$group_pid" != '0' ] && [ "$group_pid" != "$self_group" ]; then
      kill -KILL -- "-$group_pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    else
      kill -KILL "$pid" 2>/dev/null || true
    fi
  }
  while kill -0 "$pid" 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed+5))
    local now; now=$(wc -c < "$out" | tr -d ' ')
    if [ "$now" -gt "$last" ]; then last="$now"; quiet=0; else quiet=$((quiet+5)); fi
    # Output is buffered, so without this the caller cannot tell a working run
    # from a hung one and kills a healthy pass. Measured: that happened twice.
    if [ $((elapsed % 30)) -eq 0 ]; then
      echo "codex-run: Sol xhigh, ${elapsed}s elapsed, ${now} bytes, ${quiet}s quiet" >&2
    fi
    if [ "$quiet" -ge "$STALL" ]; then
      kill_group
      wait "$pid" 2>/dev/null
      return 99
    fi
  done
  wait "$pid" 2>/dev/null
  local rc=$?
  if [ -e "$preflight_failure" ]; then
    return 100
  fi
  # Perl's alarm kills the leader at the hard timeout; reap the whole private
  # process group so descendants cannot survive a timeout.
  if [ "$rc" -eq 142 ]; then kill_group; fi
  return "$rc"
}

answered() {
  # --output-last-message is the authoritative assistant-result channel. A
  # header, echoed prompt, or telemetry line can never satisfy this check.
  [ -s "$last_message" ] && awk 'NF { found=1; exit } END { exit(found ? 0 : 1) }' "$last_message"
}

# Codex exits 0 on a refusal. Match the exact phrase, or a rate-limit review fails.
refused() {
  grep -qiF 'workspace is out of credits' "$out"
}

run_once; rc=$?
if [ "$rc" -eq 100 ]; then
  echo 'codex-run: CLI unavailable (selected Codex CLI changed after preflight).' >&2
  echo 'codex-run: do not retry or hunt processes — report it unavailable.' >&2
  exit 3
fi
if [ "$rc" -eq 98 ]; then
  echo 'codex-run: prompt input failed the secret scan; refusing cross-provider transfer.' >&2
  exit 8
fi
if [ "$rc" -eq 99 ]; then
  echo "codex-run: STALLED — no output for ${STALL}s, killed." >&2
  echo "codex-run: MCP is already off unless you passed -M; if you did, drop it." >&2
  echo "codex-run: otherwise re-run with the code/context INLINE so the run needs" >&2
  echo "codex-run: no file reads. Waiting longer does not help." >&2
  cat "$out" >&2
  exit 4
fi

if [ "$rc" -ne 0 ]; then
  echo "codex-run: RUNTIME FAILURE — Codex exited with status $rc before returning a review." >&2
  cat "$out" >&2
  exit 7
fi

if refused; then
  echo "codex-run: REFUSED — the provider returned no capacity, not a review." >&2
  echo "codex-run: this does NOT satisfy a cross-model pass. Report the gap." >&2
  cat "$out" >&2
  exit 6
fi

if ! answered; then
  echo "codex-run: EMPTY — one fixed gpt-5.6-sol xhigh pass produced no assistant result (exit $rc)." >&2
  echo "codex-run: report this as an empty pass. No model or effort fallback was attempted." >&2
  cat "$out" >&2
  exit 5
fi

# The provider's transport stream contains headers, telemetry, and sometimes
# echoed input. Only the explicit assistant-result file is authoritative and
# may be returned on stdout to the caller.
cat "$last_message"
exit 0
