#!/usr/bin/env bash
# Subscribe to cmux workspace.closed and hand each path to reap-worktree.sh.
#
# The cursor file makes a restart resume where it stopped, so a close that
# happened while this was down is still processed. Design: docs/worktree-reaper.md
set -uo pipefail

CMUX="${CMUX_BIN:-/Applications/cmux.app/Contents/Resources/bin/cmux}"
STATE="$HOME/.claude/hooks/state"
LOG="$STATE/worktree-reaper.log"
CURSOR="$STATE/worktree-reaper.cursor"
REAP="$HOME/.claude/scripts/reap-worktree.sh"
mkdir -p "$STATE"

printf '%s  listener up\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"

# Refuse to start a second subscriber; two of them race on the cursor file.
# A pid file, not pgrep: a pgrep pattern also matches the process doing the check.
PIDFILE="$STATE/worktree-reaper.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  printf '%s  already running (pid %s) — exiting\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat "$PIDFILE")" >>"$LOG"
  exit 0
fi
printf '%s' "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

# cmux's socketControlMode defaults to cmuxOnly, so only a process started
# inside cmux may connect. Exit 0 so launchd's KeepAlive stops retrying.
probe=$(CMUX_QUIET=1 "$CMUX" list-windows 2>&1 | head -1)
case "$probe" in
  *"Access denied"*)
    printf '%s  BLOCKED — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$probe" >>"$LOG"
    printf '%s  a launchd agent is not "inside cmux". Set socketControlMode plus a\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
    printf '%s  password, or start this listener from inside cmux. See docs/worktree-reaper.md\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG"
    exit 0 ;;
esac

CMUX_QUIET=1 "$CMUX" events \
  --name workspace.closed --reconnect --cursor-file "$CURSOR" --no-ack --no-heartbeat 2>>"$LOG" |
while IFS= read -r line; do
  path=$(printf '%s' "$line" | python3 -c '
import json,sys
try: e=json.load(sys.stdin)
except Exception: sys.exit(1)
print((e.get("payload") or {}).get("cwd") or "")
' 2>/dev/null) || continue
  [ -z "$path" ] && continue

  # One handler per root at a time; each sleeps through its own debounce.
  lock="$STATE/reap.$(printf '%s' "$path" | shasum | cut -c1-12).lock"
  if mkdir "$lock" 2>/dev/null; then
    ( trap 'rmdir "$lock" 2>/dev/null' EXIT; "$REAP" "$path" ) >/dev/null 2>&1 &
  fi
done
