#!/usr/bin/env bash
# pr-explain-nudge.sh — PreToolUse(Bash) nudge.
# A big structural PR needs a "How this works" diagram in its body. The trigger
# lives here, not in make-pr-easy-to-review, because that skill does not always
# run. Rationale and thresholds: skills/make-pr-easy-to-review/SKILL.md.
#
# Emits permissionDecision "ask" — a confirmable pause, never a hard block.
# Silent when the body already carries a mermaid block, so it never nags twice.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

case "$cmd" in
  *"gh pr create"*) ;;
  *"gh pr edit"*) case "$cmd" in *"--body"*) ;; *) exit 0 ;; esac ;;
  *) exit 0 ;;
esac

# Already explained? Look in --body, in --body-file, and in the PR body on GitHub.
body=""
case "$cmd" in
  *"--body-file"*)
    bf="$(printf '%s' "$cmd" | sed -n 's/.*--body-file[= ]*\([^ ]*\).*/\1/p' | tr -d "\"'")"
    [ -n "$bf" ] && [ -r "$bf" ] && body="$(cat "$bf")" ;;
esac
[ -z "$body" ] && body="$cmd"
case "$body" in *'```mermaid'*) exit 0 ;; esac

if [ -n "${PR_EXPLAIN_TEST_STAT:-}" ]; then
  changed_files="${PR_EXPLAIN_TEST_FILES_N:-0}"
  changed_lines="${PR_EXPLAIN_TEST_LINES:-0}"
  files="${PR_EXPLAIN_TEST_STAT}"
  added_files="${PR_EXPLAIN_TEST_ADDED:-}"
else
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
  base="$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  [ -z "$base" ] && base="main"
  range="origin/${base}...HEAD"
  files="$(git diff --name-only "$range" 2>/dev/null || true)"
  [ -z "$files" ] && exit 0
  changed_files="$(printf '%s\n' "$files" | grep -c . || true)"
  changed_lines="$(git diff --numstat "$range" 2>/dev/null |
    awk '{a+=$1; d+=$2} END {print a+d+0}')"
  added_files="$(git diff --name-only --diff-filter=A "$range" 2>/dev/null || true)"
fi

# Size gate: the 75th percentile of merged PRs here (median 7 files, 304 lines).
[ "${changed_files:-0}" -ge 10 ] || [ "${changed_lines:-0}" -ge 600 ] || exit 0

# Shape gate: mechanical diffs fail it however large. A rename needs a sentence.
shape_re='(^|/)(migrations?|migrate)(/|_|\.)|(^|/)schema|(^|/)models?(/|_|\.)|(^|/)api(/|_|\.)|routes?(/|_|\.)|openapi|\.proto$|\.sql$|(^|/)(queue|worker|job|jobs|scheduler|cron)(/|_|\.)|state[_-]?machine|middleware|(^|/)contracts?(/|_|\.)|concurren|retry|timeout|(^|/)workflows?(/|_|\.)'
reason=""
if printf '%s\n' "$files" | grep -Eiq "$shape_re"; then
  reason="$(printf '%s\n' "$files" | grep -Ei "$shape_re" | head -3 | paste -sd ', ' -)"
else
  new_modules="$(printf '%s\n' "$added_files" |
    grep -Ev '(^$|test|spec|fixture|snapshot|__|\.md$|\.json$|\.lock$)' | grep -c . || true)"
  [ "${new_modules:-0}" -ge 3 ] || exit 0
  reason="${new_modules} new non-test files — a new boundary"
fi

msg="Big structural PR (${changed_files} files, ${changed_lines} lines; ${reason}). Add a 'How this works' section to the body with one mermaid diagram and a read-this-first table. GitHub renders mermaid in PR bodies. Approve to proceed if it is already explained or the diff is mechanical."

jq -nc --arg m "$msg" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: $m,
    additionalContext: ("Pre-PR explain gate: " + $m + " Pick ONE diagram: flowchart for a new boundary, sequenceDiagram for a request or job path, stateDiagram-v2 for a status field, or a before/after table for a schema change. Keep it under ~12 nodes; past that, split the PR. Template and both gates: skills/make-pr-easy-to-review/SKILL.md. Do NOT link an Artifact instead — it is private by default, so a reviewer sees nothing until it is shared.")
  }
}'
