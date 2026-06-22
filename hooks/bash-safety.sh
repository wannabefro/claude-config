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

case "$cmd" in
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
  "dd if="*|\
  *"curl "*'|'*" sh"*|\
  *"curl "*'|'*" bash"*|\
  *"wget "*'|'*" sh"*|\
  *"wget "*'|'*" bash"*)
    deny "Blocked high-risk shell command"
    ;;
esac

if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])rm([[:space:]]|$)'; then
  if printf '%s' "$cmd" | grep -Eq '([[:space:]]|^)(\.env([[:alnum:]_.-])*|\.ssh|/etc/|/usr/|/System/|~/.claude|/Users/[^[:space:]]+/.claude)'; then
    deny "Blocked deletion of a sensitive path"
  fi
fi

exit 0
