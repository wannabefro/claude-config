#!/usr/bin/env bash
# UserPromptSubmit delegate nudge.
#
# If a freshly submitted prompt looks like open-ended investigation/research,
# inject an entry-point reminder to delegate the read-heavy phase to a subagent
# rather than doing it inline on the main thread. Catches the leak before the
# first read, complementing delegate-nudge.sh (which catches it mid-stream).
#
# Deliberately narrow keyword set to avoid noise on ordinary implementation
# prompts. Non-blocking: only adds context, never blocks the prompt.
set -uo pipefail

input="$(cat)"
jq_bin="$(command -v jq || echo /opt/homebrew/bin/jq)"
[ -x "$jq_bin" ] || exit 0

prompt="$("$jq_bin" -r '.prompt // .user_prompt // ""' <<<"$input" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
[ -z "$prompt" ] && exit 0

# Skip system/agent-task notifications: they arrive through this event but
# aren't user investigation prompts, and routinely contain trigger words
# (agent names, "research", "audit") that cause false-positive nudges.
case "$prompt" in
  *"task-notification"*|*"system notification"*|*"automated background-task"*|*"not user input"*) exit 0 ;;
esac

if printf '%s' "$prompt" | grep -Eq '(investigate|\baudit\b|find out why|trace (the|this|down)|research |dig into|look into|where (is|are|does)|how does .* work)'; then
  "$jq_bin" -n \
    --arg m "This prompt reads as investigation/research. Default to dispatching an Explore (read-heavy codebase) or general-purpose (multi-step) subagent for the gathering phase — isolated context, cheaper than main-thread Opus — and synthesize its conclusion here. Skip only if the work is tightly coupled to this conversation's state." \
    '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $m}}'
fi
exit 0
