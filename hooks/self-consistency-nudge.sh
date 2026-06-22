#!/usr/bin/env bash
# PostToolUse self-consistency nudge.
#
# After a Write/Edit/MultiEdit, inspects the edited file path. If it matches a
# high-stakes surface (auth, payments, migrations, public API), injects a
# non-blocking reminder suggesting the /self-consistency cross-check. Never
# denies a tool — only adds context via hookSpecificOutput.additionalContext.
#
# Why this exists: best-of-N can't be diff-triggered (it runs before any diff),
# but the self-consistency check runs on an existing change. This fires the
# "high-stakes diff -> triangulate it" guideline at the moment the diff lands.
# Mirrors the shape of delegate-nudge.sh.
set -uo pipefail

input="$(cat)"
jq_bin="$(command -v jq || echo /opt/homebrew/bin/jq)"
[ -x "$jq_bin" ] || exit 0   # no jq -> no-op

path="$("$jq_bin" -r '.tool_input.file_path // ""' <<<"$input" 2>/dev/null)"
[ -n "$path" ] || exit 0

# High-stakes path surface, mirroring the sam-review / delegate-nudge heuristic
# (auth, payments, migrations, public API). Case-insensitive substring match.
shopt -s nocasematch
case "$path" in
  *auth*|*login*|*session*|*permission*|*oauth* \
  |*payment*|*billing*|*charge*|*invoice*|*checkout* \
  |*migration*|*migrate*|*schema* \
  |*/api/*|*/public/*|*public_api*|*webhook*)
    "$jq_bin" -n \
      --arg p "$path" \
      --arg m "Self-consistency check: a high-stakes file (${path}) was just changed. If this is a behavioral change worth high assurance, consider running /self-consistency to triangulate the implementation against an independently-derived spec and tests. Skip for trivial or non-behavioral edits." \
      '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
    ;;
esac
exit 0
