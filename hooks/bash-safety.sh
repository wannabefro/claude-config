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

# ripgrep's -r is --replace, NOT grep's --recursive (rg recurses by default). So the muscle-memory
# `rg -rn 'Foo' src` clusters as `-r n` and prints every match REPLACED BY THE LITERAL "n".
#
# This belongs in the safety hook because the failure is silent and the output looks plausible.
# Measured on 2026-07-29: five occurrences in one session. `rg -rn 'SaveStyleSheet' src` reported
# `export { n } from "./n"`, which read as a mangled file; `rg -rn '...|ready|valid'` turned
# "already provisioned" into "aln provisioned". Two of those led to wrong conclusions being stated
# out loud — first that the file was corrupt, then that another tool's hook was rewriting output.
# Nothing was wrong except the flag.
#
# Only the CLUSTERED form is caught. A real replacement is written `-r '$1'`, `-r ""` or
# `--replace=...`, none of which put a bare letter immediately after -r. Denied rather than
# auto-corrected, because silently dropping -r would break a genuine --replace.
# The middle group is OPTIONAL because `rg -rn ...` puts -r immediately after the command word,
# with no second space to match. Bounded by | ; & so another tool's -r in the same line (`sort -rn`,
# `xargs -r`) can't trip it.
rg_replace_re='(^|[|;&[:space:]])rg[[:space:]]([^|;&]*[[:space:]])?-r[a-zA-Z]'
if [[ $cmd =~ $rg_replace_re ]]; then
  deny "rg -r means --replace, not --recursive. '-rn' is parsed as --replace=n and prints every match replaced by the literal 'n' — silently wrong output that looks real. rg already recurses; use 'rg -n' for line numbers. For a genuine replacement write '-r <value>' as a separate argument or --replace=<value>."
fi

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
