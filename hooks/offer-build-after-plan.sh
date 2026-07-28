#!/usr/bin/env bash
# PostToolUse / Skill — after ce-plan finishes, make the build step an explicit offer.
#
# Why a hook and not a rule: /build cannot self-start. Typing it IS the opt-in the
# Workflow tool requires, so the only way an approved plan reaches a fan-out is if
# the user is handed the exact command. A rule asking the assistant to remember is
# honour-system; this fires deterministically.
#
# Emits additionalContext (advisory) rather than a decision — it must never block
# or alter the Skill result, only make sure the offer gets made.
set -u

payload=$(cat 2>/dev/null || true)
[ -z "$payload" ] && exit 0

skill=$(printf '%s' "$payload" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")
case "$skill" in
  *ce-plan*) ;;
  *) exit 0 ;;
esac

# A plan path, if ce-plan reported one. Best-effort: the offer still works without it.
plan=$(printf '%s' "$payload" \
  | jq -r '[.tool_response, .tool_input] | tostring' 2>/dev/null \
  | grep -oE '[A-Za-z0-9_./-]*docs/plans/[A-Za-z0-9_.-]+\.md' \
  | head -1)

if [ -n "$plan" ]; then
  target="$plan"
  hint="/build $plan"
else
  target="the plan just written"
  hint="/build <plan-path>"
fi

jq -n --arg t "$target" --arg h "$hint" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: (
      "ce-plan just completed for " + $t + ". Before ending this turn, offer the build step " +
      "explicitly — the user cannot act on what they are not shown, and /build cannot self-start " +
      "(typing it IS the Workflow opt-in).\n\n" +
      "Put it in the Next slot as a literal, copy-pasteable command: `" + $h + "`. Add that " +
      "prefixing their reply with \"ultracode:\" skips the round trip by supplying the opt-in " +
      "up front.\n\n" +
      "Do NOT start the fan-out yourself. If the plan is coupled rather than decomposable, say so " +
      "and point at ce-work with the explicit plan path instead."
    )
  }
}'
