#!/usr/bin/env bash
# pr-guardrail-review.sh — PreToolUse(Bash) nudge.
# When a PR is about to be opened/readied on a guardrail-critical diff, pause
# and remind to run the review council before it goes up for review.
#
# Both tiers route to /council. It already classifies risk itself and forces the
# full six-lens seating — including the Codex outsider — on exactly these
# surfaces, so the cheap seat can never decide a migration is low-risk. The
# floor/escalate split below therefore only shapes the WORDING; it no longer
# picks a different review path. It used to send the escalate tier to
# /sam-review and the floor tier to /codex:adversarial-review, which pointed the
# one enforcing gate at paths that were never taken.
#
# Non-evidence-based: emits permissionDecision "ask" (a confirmable pause, NOT a
# hard block). Approve to proceed if the review already ran. Silent on
# non-PR-creating commands, non-git dirs, and non-critical diffs.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Gate only at the review-ready moment: `gh pr ready`, or a non-draft `gh pr create`.
is_pr_ready=0
case "$cmd" in
  *"gh pr ready"*) is_pr_ready=1 ;;
  *"gh pr create"*)
    case "$cmd" in *"--draft"*|*" -d "*|*" -d") ;; *) is_pr_ready=1 ;; esac ;;
esac
[ "$is_pr_ready" -eq 0 ] && exit 0

# Collect changed files. Test override lets the classifier be exercised without a repo.
if [ -n "${PR_GUARDRAIL_TEST_FILES:-}" ]; then
  files="$PR_GUARDRAIL_TEST_FILES"
else
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
  base="$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  [ -z "$base" ] && base="main"
  files="$(git diff --name-only "origin/${base}...HEAD" 2>/dev/null || true)"
  [ -z "$files" ] && files="$(git diff --name-only HEAD 2>/dev/null || true)"
fi
[ -z "$files" ] && exit 0

# Highest-stakes subset → wording escalates; both tiers route to /council.
escalate_re='(^|/)(migrations?|migrate)(/|_|\.)|payment|billing|charge|stripe|invoice|(^|/)auth(n|z)?(/|_|\.)|authentic|authoriz|(^|/)permission|(^|/)security(/|_|\.)'
# Broader guardrail-critical floor → at least the Codex adversarial pass.
floor_re="${escalate_re}|(^|/)api(/|_|\.)|serializ|(^|/)schema|(^|/)models?(/|_|\.)|middleware|webhook|(^|/)iam(/|_|\.)|public"

tier=""
if printf '%s\n' "$files" | grep -Eiq "$escalate_re"; then
  tier="escalate"
elif printf '%s\n' "$files" | grep -Eiq "$floor_re"; then
  tier="floor"
fi
[ -z "$tier" ] && exit 0

hits="$(printf '%s\n' "$files" | grep -Ei "${floor_re}" | head -5 | paste -sd ', ' -)"

if [ "$tier" = "escalate" ]; then
  msg="Guardrail-critical diff (payments/migrations/auth/security touched: ${hits}). Run /council before this PR is review-ready. If it already ran this session, approve to proceed."
else
  msg="Guardrail-critical diff (touched: ${hits}). Run /council before this PR is review-ready — its triage will size the seating. If it already ran this session, approve to proceed."
fi

jq -nc --arg m "$msg" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: $m,
    additionalContext: ("Pre-PR guardrail gate: " + $m + " Per shipping.md, the cross-family review is mandatory on guardrail-critical diffs before marking a PR ready. /council forces the full six-lens seating on these surfaces, so do not substitute a cheaper single-lens review.")
  }
}'
