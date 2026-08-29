#!/usr/bin/env bash
# Run one implementation brief through the fixed Codex Luna writer route.
#
# Usage: luna-run.sh PROMPT_FILE WORKING_DIRECTORY
#
# The prompt travels through stdin. This preserves its bytes and prevents shell
# expansion. The wrapper owns the model, effort, sandbox, approval, and MCP
# policy. Callers cannot select a different route through environment values.
set -u -o pipefail

USAGE=64
MISSING_RUNTIME=69
RUNTIME_FAILURE=70
TIMEOUT_FAILURE=124

if [ "$#" -ne 2 ]; then
  echo "luna-run: usage: luna-run.sh PROMPT_FILE WORKING_DIRECTORY" >&2
  exit "$USAGE"
fi

PROMPT_FILE=$1
WORKING_DIRECTORY=$2

if [ ! -f "$PROMPT_FILE" ] || [ ! -r "$PROMPT_FILE" ]; then
  echo "luna-run: prompt file is missing or unreadable" >&2
  exit "$USAGE"
fi
if [ ! -s "$PROMPT_FILE" ]; then
  echo "luna-run: prompt file is empty" >&2
  exit "$USAGE"
fi
PROMPT_DIR=${PROMPT_FILE%/*}
PROMPT_BASE=${PROMPT_FILE##*/}
if [ "$PROMPT_DIR" = "$PROMPT_FILE" ]; then PROMPT_DIR=.; fi
if ! PROMPT_FILE=$(cd "$PROMPT_DIR" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$PROMPT_BASE"); then
  echo "luna-run: cannot resolve prompt file" >&2
  exit "$USAGE"
fi
if [ ! -d "$WORKING_DIRECTORY" ] || [ ! -r "$WORKING_DIRECTORY" ] || [ ! -x "$WORKING_DIRECTORY" ]; then
  echo "luna-run: working directory is missing or inaccessible" >&2
  exit "$USAGE"
fi

CODEX_BIN=$(command -v codex 2>/dev/null || true)
if [ -z "$CODEX_BIN" ] || [ ! -x "$CODEX_BIN" ]; then
  echo "luna-run: approved Codex CLI is unavailable" >&2
  exit "$MISSING_RUNTIME"
fi
# Resolve the approved command once. Tests inject a fake approved command by
# placing it first in PATH; callers cannot replace the runtime with an env var.
CODEX_BIN=$(realpath "$CODEX_BIN" 2>/dev/null) || {
  echo "luna-run: approved Codex CLI path could not be resolved" >&2
  exit "$MISSING_RUNTIME"
}
[ -x "$CODEX_BIN" ] || {
  echo "luna-run: resolved Codex CLI is not executable" >&2
  exit "$MISSING_RUNTIME"
}

PERL_BIN=/usr/bin/perl
if [ ! -x "$PERL_BIN" ]; then
  PERL_BIN=$(command -v perl 2>/dev/null || true)
fi
if [ ! -x "$PERL_BIN" ]; then
  echo "luna-run: required runtime is unavailable" >&2
  exit "$MISSING_RUNTIME"
fi

TIMEOUT_SECONDS=${LUNA_RUN_TIMEOUT_SECONDS:-900}
STALL_SECONDS=${LUNA_RUN_STALL_SECONDS:-0}
case "$TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    echo "luna-run: timeout must be a positive integer" >&2
    exit "$USAGE"
    ;;
esac
if [ "$TIMEOUT_SECONDS" -lt 1 ] || [ "$TIMEOUT_SECONDS" -gt 3600 ]; then
  echo "luna-run: timeout must be between 1 and 3600 seconds" >&2
  exit "$USAGE"
fi
case "$STALL_SECONDS" in
  ''|*[!0-9]*)
    echo "luna-run: stall timeout must be a non-negative integer" >&2
    exit "$USAGE"
    ;;
esac
if [ "$STALL_SECONDS" -gt "$TIMEOUT_SECONDS" ]; then
  echo "luna-run: stall timeout cannot exceed the hard timeout" >&2
  exit "$USAGE"
fi

# Resolve the directory before the child starts. This rejects a path that looks
# valid but cannot become the requested working root.
if ! WORKING_DIRECTORY=$(cd "$WORKING_DIRECTORY" 2>/dev/null && pwd -P); then
  echo "luna-run: cannot resolve working directory" >&2
  exit "$USAGE"
fi

# A version probe is local and confirms that the selected binary can start.
# It does not select a model, read a prompt, or contact a provider.
if ! "$PERL_BIN" -e 'alarm shift; exec @ARGV' 10 "$CODEX_BIN" --version >/dev/null 2>&1; then
  echo "luna-run: Codex CLI failed its local preflight" >&2
  exit "$MISSING_RUNTIME"
fi

process_group() {
  "$PERL_BIN" -e 'my $group = getpgrp(shift); print $group if defined $group && $group >= 0' "$1" 2>/dev/null || true
}

# `--approve-for-me` uses Codex review approval with the workspace-write
# sandbox. `mcp_servers={}` disables MCP for this implementation run.
# The watcher owns the child process group: a timed-out Codex process cannot
# leave a descendant alive to keep writing in the private worktree.
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/claude-luna-run.XXXXXXXX") || {
  echo "luna-run: private runtime directory could not be created" >&2
  exit "$MISSING_RUNTIME"
}
run_owner=$(stat -f '%u' "$run_dir" 2>/dev/null || stat -c '%u' "$run_dir" 2>/dev/null || true)
run_mode=$(stat -f '%Lp' "$run_dir" 2>/dev/null || stat -c '%a' "$run_dir" 2>/dev/null || true)
if [ "$run_owner" != "$(id -u)" ] || [ "$run_mode" != '700' ]; then
  rm -rf -- "$run_dir"
  echo "luna-run: private runtime directory is not owner-private" >&2
  exit "$MISSING_RUNTIME"
fi
out="$run_dir/output"
cleanup_out() {
  if [ -n "${run_dir:-}" ] && [ -d "$run_dir" ] && [ ! -L "$run_dir" ]; then
    rm -rf -- "$run_dir"
  fi
}
trap cleanup_out EXIT HUP INT TERM
(
  cd "$WORKING_DIRECTORY" || exit "$USAGE"
  exec "$PERL_BIN" -e 'setpgrp(0, 0); exec @ARGV' "$CODEX_BIN" exec \
    --model gpt-5.6-luna \
    --sandbox workspace-write \
    --approve-for-me \
    --ephemeral \
    -c 'model_reasoning_effort=xhigh' \
    -c 'mcp_servers={}' \
    -C "$WORKING_DIRECTORY" \
    - < "$PROMPT_FILE"
) > "$out" 2>&1 &
child_pid=$!
child_group=''
self_group=$(process_group $$)
for _ in 1 2 3 4 5 6 7 8 9 10; do
  child_group=$(process_group "$child_pid")
  [ -n "$child_group" ] && [ "$child_group" != "$self_group" ] && break
  sleep 0.05
done
kill_group() {
  # The background subshell briefly shares the caller's group before Perl's
  # setpgrp runs. Refresh at the point of termination so a slow exec cannot
  # force the unsafe PID-only fallback.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    local current_group
    current_group=$(process_group "$child_pid")
    if [[ "$current_group" =~ ^[0-9]+$ ]] && [ "$current_group" != "$self_group" ]; then
      child_group="$current_group"
      break
    fi
    sleep 0.05
  done
  kill_descendants() {
    local parent=$1 kid
    for kid in $(pgrep -P "$parent" 2>/dev/null || true); do
      kill_descendants "$kid"
      kill -TERM "$kid" 2>/dev/null || true
      kill -KILL "$kid" 2>/dev/null || true
    done
  }
  # Keep the recursive fallback even when a process-group id was observed: a
  # provider may daemonize or deliberately create a new session, in which case
  # that descendant is outside the original group.
  kill_descendants "$child_pid"
  if [[ "$child_group" =~ ^[0-9]+$ ]] && [ "$child_group" != '0' ] && [ "$child_group" != "$self_group" ]; then
    kill -TERM -- "-$child_group" 2>/dev/null || true
    sleep 0.1
    kill -KILL -- "-$child_group" 2>/dev/null || true
  else
    kill -TERM "$child_pid" 2>/dev/null || true
    sleep 0.1
    kill -KILL "$child_pid" 2>/dev/null || true
  fi
}
on_signal() {
  kill_group
  wait "$child_pid" 2>/dev/null || true
  exit 130
}
trap on_signal HUP INT TERM
last_bytes=0
quiet_seconds=0
elapsed=0
while kill -0 "$child_pid" 2>/dev/null; do
  sleep 1
  elapsed=$((elapsed + 1))
  now_bytes=$(wc -c < "$out" | tr -d ' ')
  if [ "$now_bytes" -gt "$last_bytes" ]; then
    last_bytes=$now_bytes
    quiet_seconds=0
  else
    quiet_seconds=$((quiet_seconds + 1))
  fi
  if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
    kill_group
    wait "$child_pid" 2>/dev/null || true
    echo "luna-run: Codex implementation timed out; private process group was terminated and reaped" >&2
    exit "$TIMEOUT_FAILURE"
  fi
  if [ "$STALL_SECONDS" -gt 0 ] && [ "$quiet_seconds" -ge "$STALL_SECONDS" ]; then
    kill_group
    wait "$child_pid" 2>/dev/null || true
    echo "luna-run: Codex implementation stalled; private process group was terminated and reaped" >&2
    exit "$TIMEOUT_FAILURE"
  fi
done
wait "$child_pid" 2>/dev/null
status=$?
cat "$out"
if [ "$status" -eq 0 ]; then
  exit 0
fi
echo "luna-run: Codex implementation failed" >&2
exit "$RUNTIME_FAILURE"
