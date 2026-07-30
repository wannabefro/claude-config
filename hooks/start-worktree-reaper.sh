#!/usr/bin/env bash
# Ensure the cmux worktree reaper is running, from inside cmux.
#
# cmux's socketControlMode is cmuxOnly, so only a process started inside cmux can
# reach the socket. A launchd agent cannot. A session hook can, because it
# inherits CMUX_SOCKET_CAPABILITY. See docs/worktree-reaper.md.
set -uo pipefail

[ -n "${CMUX_WORKSPACE_ID:-}" ] || exit 0

# A pid file, not pgrep: a pgrep pattern also matches this script's own line.
pidfile="$HOME/.claude/hooks/state/worktree-reaper.pid"
if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi

listener="$HOME/.claude/scripts/cmux-worktree-reaper.sh"
[ -x "$listener" ] || exit 0

nohup "$listener" >/dev/null 2>&1 &
exit 0
