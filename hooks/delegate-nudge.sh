#!/usr/bin/env bash
# PostToolUse delegate nudge.
#
# Counts consecutive read-only tool calls (Read/Grep/Glob) in the main thread.
# On the Nth, injects a context reminder to dispatch a subagent instead of
# continuing to read inline. Any Edit/Write/MultiEdit/Task resets the counter
# (real work started, or a delegation already happened). Non-blocking: it only
# adds context via hookSpecificOutput.additionalContext, never denies a tool.
#
# Why this exists: nothing in the platform forces delegation — it's always a
# model decision. This converts the "3rd consecutive read -> Explore" guideline
# into an interrupt fired at the moment the inline-read gravity takes over.
set -uo pipefail

THRESHOLD=4
STATE_DIR="$HOME/.claude/hooks/state"
mkdir -p "$STATE_DIR" 2>/dev/null || true

# Best-effort prune of counters older than a day so the dir doesn't grow.
find "$STATE_DIR" -name 'delegate-nudge-*.count' -mtime +1 -delete 2>/dev/null || true

input="$(cat)"
jq_bin="$(command -v jq || echo /opt/homebrew/bin/jq)"
[ -x "$jq_bin" ] || exit 0   # no jq -> no-op

sid="$("$jq_bin" -r '.session_id // "nosession"' <<<"$input" 2>/dev/null)"
tool="$("$jq_bin" -r '.tool_name // ""' <<<"$input" 2>/dev/null)"
counter="$STATE_DIR/delegate-nudge-${sid}.count"

case "$tool" in
  Read|Grep|Glob)
    n=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
    if [ "$n" -ge "$THRESHOLD" ]; then
      echo 0 > "$counter"
      "$jq_bin" -n \
        --arg m "Delegation check: ${THRESHOLD} consecutive read-only calls (Read/Grep/Glob) in the main thread. If this is open-ended exploration, research, or an audit, dispatch an Explore or general-purpose subagent (own context, cheaper) and keep the conclusion, not the file dumps. If you're mid-implementation on tightly-coupled code that needs the full conversation, this is fine — ignore." \
        '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
    else
      echo "$n" > "$counter"
    fi
    ;;
  Edit|Write|MultiEdit|Task)
    echo 0 > "$counter" 2>/dev/null || true
    ;;
esac
exit 0
