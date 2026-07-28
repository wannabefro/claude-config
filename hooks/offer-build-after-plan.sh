#!/usr/bin/env bash
# PostToolUse / Skill — after ce-plan lands a plan that is actually worth a
# fan-out, hand over the exact /build command.
#
# Why a hook: /build cannot self-start. Typing it IS the opt-in the Workflow
# tool requires, so an approved plan only reaches a fan-out if the user is
# handed the command. A rule asking the assistant to remember is honour-system.
#
# Why gated: offering /build on a single-unit or strictly-sequential plan is
# noise, and noise is how a useful prompt gets ignored. Measured over 140 real
# ce-plan outputs: only 20 carry implementation units at all; of those, 4 are
# chains where a fan-out buys nothing and 6 are genuinely parallel. The rest
# declare no dependencies, and for those /build's own step 1 (one decomposer
# agent, no fan-out) is the cheap way to find out — so they get the offer.
#
# Emits additionalContext only: never blocks, never alters the Skill result.
set -u

payload=$(cat 2>/dev/null || true)
[ -z "$payload" ] && exit 0

skill=$(printf '%s' "$payload" | jq -r '.tool_input.skill // ""' 2>/dev/null || echo "")
case "$skill" in *ce-plan*) ;; *) exit 0 ;; esac

cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""' 2>/dev/null || echo "")
rel=$(printf '%s' "$payload" \
  | jq -r '[.tool_response, .tool_input] | tostring' 2>/dev/null \
  | grep -oE '[A-Za-z0-9_./-]*docs/plans/[A-Za-z0-9_.-]+\.md' | head -1)
[ -z "$rel" ] && exit 0

plan=""
for c in "$rel" "$cwd/$rel" "$cwd/${rel#./}"; do
  [ -n "$c" ] && [ -f "$c" ] && { plan="$c"; break; }
done
# Path reported but unreadable from here — say nothing rather than guess.
[ -z "$plan" ] && exit 0

# NB: `grep -c` prints 0 AND exits 1 on no-match, so `|| echo 0` would append a
# second zero and every later [ -lt ] would die with "integer expression expected".
count() { c=$(grep -cE "$1" "$plan" 2>/dev/null || true); printf '%s' "${c:-0}"; }
counti() { c=$(grep -ciE "$1" "$plan" 2>/dev/null || true); printf '%s' "${c:-0}"; }
units=$(count '^### U[0-9]')
declared=$(counti 'Dependencies:\*\*')
free=$(counti 'Dependencies:\*\*[[:space:]]*none')

# Nothing to parallelise.
[ "$units" -lt 2 ] && exit 0

if [ "$declared" -gt 0 ] && [ "$free" -lt 2 ]; then
  # Dependencies are declared and form a chain: /build would report a critical
  # path near the unit count and fan out to almost nothing.
  jq -n --arg p "$plan" --arg u "$units" '{
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext:
      ("Plan " + $p + " has " + $u + " units but declares fewer than two that can start " +
       "immediately — it is a dependency chain, so /build would buy little. Do NOT offer /build. " +
       "Offer ce-work with the explicit plan path instead, and say in one clause why " +
       "(chain, not parallelisable).") } }'
  exit 0
fi

if [ "$declared" -gt 0 ]; then
  why="$free of $units units can start immediately"
else
  why="$units units, dependencies not declared — /build step 1 costs one decomposer agent and reports critical_path before any fan-out"
fi

jq -n --arg p "$plan" --arg w "$why" '{
  hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext:
    ("Plan " + $p + " looks worth a fan-out (" + $w + "). Before ending this turn, put the literal " +
     "command in the Next slot: `/build " + $p + "`. Note that prefixing their reply with " +
     "\"ultracode:\" supplies the Workflow opt-in up front and skips the round trip. " +
     "Do NOT start the fan-out yourself.") } }'
