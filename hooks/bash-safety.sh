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

# rm targets are judged by resolved path, not by substring. The previous rule
# matched the raw command text, which was backwards: it blocked
# `cd <config-dir> && rm note.md` (tracked, recoverable) while allowing
# `rm -rf .` from that same directory and the $HOME spelling of the same path,
# because the fatal forms never name the path literally. rm-guard.py resolves
# each target and guards the config roots themselves without blocking
# deletions inside them.
guard="$(dirname "${BASH_SOURCE[0]}")/rm-guard.py"
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
