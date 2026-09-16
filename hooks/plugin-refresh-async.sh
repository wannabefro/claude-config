#!/usr/bin/env bash
# SessionStart: kick the throttled plugin refresh and return immediately.
#
# Fully detached, because a network fetch must never sit in front of a session
# start. The refresh script owns the once-per-day throttle and the lock.
set -uo pipefail

refresh="$(dirname "${BASH_SOURCE[0]}")/../scripts/plugin-refresh.sh"
[ -x "$refresh" ] || exit 0

nohup setsid "$refresh" >/dev/null 2>&1 &
disown 2>/dev/null || true
exit 0
