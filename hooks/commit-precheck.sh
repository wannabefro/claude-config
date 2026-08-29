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

trim_output() {
  printf '%s' "$1" | awk 'NR<=40 { print }' | cut -c1-3000
}

if ! command -v jq >/dev/null 2>&1; then
  warn "jq is not installed; commit precheck hook skipped"
  exit 0
fi

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')

if [ -z "$cmd" ] || [ -z "$cwd" ]; then
  exit 0
fi

case "$cmd" in
  *"git commit"*|*"git commit "*|*"rtk git commit"*|*"rtk git commit "*)
    ;;
  *)
    exit 0
    ;;
esac

if printf '%s' "$cmd" | grep -Eq -- '(^|[[:space:]])git[[:space:]]+commit([[:space:]]|$).*--no-verify'; then
  deny "Do not bypass commit checks with --no-verify"
fi

if ! repo_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
  exit 0
fi

# A merge stages every upstream file, so the staged set is not authored content.
merging=false
if git -C "$repo_root" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  merging=true
fi

density="$HOME/.claude/scripts/comment-density.py"
if [ "$merging" = false ] && [ -f "$density" ] && command -v python3 >/dev/null 2>&1; then
  set +e
  # Structure only: --max-density 101 disables the density check on a diff.
  cmt_out=$(python3 "$density" --staged "$repo_root" --max-density 101 2>&1)
  cmt_status=$?
  set -e
  if [ $cmt_status -eq 1 ]; then
    cmt_out=$(trim_output "$cmt_out")
    deny "Staged comments break rules/principles.md. Delete or shorten them, then commit.\n$cmt_out"
  fi
fi

check_cmd=""
if [ -x "$repo_root/.claude/pre-commit-check" ]; then
  check_cmd="$repo_root/.claude/pre-commit-check"
elif [ -f "$repo_root/.claude/pre-commit-check.sh" ]; then
  check_cmd="bash \"$repo_root/.claude/pre-commit-check.sh\""
elif [ -f "$repo_root/.pre-commit-config.yaml" ] && command -v pre-commit >/dev/null 2>&1; then
  staged_files=()
  while IFS= read -r -d '' file; do
    staged_files+=("$file")
  done < <(git -C "$repo_root" diff --cached --name-only -z)
  if [ "${#staged_files[@]}" -eq 0 ]; then
    exit 0
  fi

  set +e
  output=$(cd "$repo_root" && pre-commit run --files "${staged_files[@]}" 2>&1)
  status=$?
  set -e

  if [ $status -ne 0 ]; then
    output=$(trim_output "$output")
    deny "Pre-commit checks failed. Fix the issues before committing.\n$output"
  fi

  exit 0
fi

if [ -z "$check_cmd" ]; then
  exit 0
fi

set +e
output=$(cd "$repo_root" && sh -c "$check_cmd" 2>&1)
status=$?
set -e

if [ $status -ne 0 ]; then
  output=$(trim_output "$output")
  deny "Project pre-commit checks failed. Fix the issues before committing.\n$output"
fi

exit 0
