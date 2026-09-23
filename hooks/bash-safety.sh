#!/usr/bin/env bash
set -euo pipefail

warn() {
  printf '[claude-hook] %s\n' "$1" >&2
}

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

if ! command -v jq >/dev/null 2>&1; then
  warn "jq is not installed; bash safety hook skipped"
  exit 0
fi

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

if [ -z "$cmd" ]; then
  exit 0
fi

guard="$(dirname "${BASH_SOURCE[0]}")/rm-guard.py"

# Pattern checks skip heredoc bodies a data sink reads; rm-guard.py owns that rule.
scan="$cmd"
if [[ "$cmd" == *"<<"* ]] && [ -f "$guard" ]; then
  scan=$(python3 "$guard" --strip-heredocs "$cmd" 2>/dev/null) || scan="$cmd"
  [ -n "$scan" ] || scan="$cmd"
fi

case "$scan" in
  *" rm -rf /"*|\
  "rm -rf /"*|\
  *"sudo rm -rf "*|\
  *"git reset --hard"*|\
  *"git checkout -- "*|\
  *"git clean -fd"*|\
  *"git clean -xdf"*|\
  *" mkfs."*|\
  "mkfs."*|\
  *" dd if="*|\
  "dd if="*)
    deny "Blocked high-risk shell command"
    ;;
esac

# A fetch piped into a shell. The pipe target must be the shell, not a later word.
fetch='(^|[[:space:]`(;&|])(curl|wget)[[:space:]]'
wrapper='((sudo|env|command|exec|nohup|time|builtin)([[:space:]][^|]*)?[[:space:]])?'
into_shell="\\|[[:space:]]*${wrapper}(ba|z|k|da)?sh([[:space:]]|\$|[;&|)\`])"
if [[ "$scan" =~ $fetch ]] && [[ "$scan" =~ $into_shell ]]; then
  deny "Blocked high-risk shell command"
fi

# Deny the clustered -r form; it replaces instead of recursing. See docs/gotchas.md.
rg_replace_re='(^|[|;&[:space:]])rg[[:space:]]([^|;&]*[[:space:]])?-r[a-zA-Z]'
if [[ $scan =~ $rg_replace_re ]]; then
  deny "rg -r means --replace, not --recursive. '-rn' is parsed as --replace=n and prints every match replaced by the literal 'n' — silently wrong output that looks real. rg already recurses; use 'rg -n' for line numbers. For a genuine replacement write '-r <value>' as a separate argument or --replace=<value>."
fi

# Judged by resolved path, not substring; rm-guard.py's module docstring says why.
if [ -f "$guard" ]; then
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
  set +e
  reason=$(python3 "$guard" "$cmd" "$cwd" 2>/dev/null)
  rc=$?
  set -e
  # rc 1 = block; rc 2 = unparseable, fail open like the jq check above.
  if [ "$rc" -eq 1 ]; then
    deny "$reason"
  fi
fi

exit 0
