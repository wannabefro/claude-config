#!/usr/bin/env bash
# Close this cmux workspace and remove its worktree, merged or not.
#
# Deliberately ungated: no merge check, no unpushed check, no debounce. The one
# refusal left is a primary checkout, which is never what you meant.
#
# Nothing is destroyed. Uncommitted and untracked files go to a stash first, and
# `refs/stash` is shared rather than per-worktree, so the stash outlives the
# worktree and is recoverable from the main checkout. Commits survive because the
# branch is kept. Design: docs/worktree-button.md
set -uo pipefail

CMUX="${CMUX_BIN:-/Applications/cmux.app/Contents/Resources/bin/cmux}"
WT="${WORKTRUNK_BIN:-/opt/homebrew/bin/wt}"
LOG="$HOME/.claude/hooks/state/worktree-drop.log"
mkdir -p "$(dirname "$LOG")"

say() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }
die() { say "REFUSED $*"; "$CMUX" notify --title "Worktree kept" --body "$*" >/dev/null 2>&1; exit 1; }

root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
gitdir=$(git -C "$root" rev-parse --absolute-git-dir 2>/dev/null) || die "no git dir"
common=$(cd "$root" && cd "$(git rev-parse --git-common-dir)" && pwd) || die "no common git dir"
[ "$gitdir" != "$common" ] || die "$root is a primary checkout, not a worktree"

branch=$(git -C "$root" symbolic-ref --short HEAD 2>/dev/null || echo "")
main_root=$(dirname "$common")
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Snapshot first. A stash here is visible from the main checkout afterwards.
stashed=""
if [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ]; then
  if git -C "$root" stash push -u -m "drop-worktree ${branch:-detached} $stamp" >/dev/null 2>&1; then
    stashed="yes"
    say "stashed uncommitted work from ${branch:-detached} — recover with: git -C $main_root stash list"
  else
    die "could not stash uncommitted work in $root, so nothing was removed"
  fi
fi

cd /tmp

if [ -n "$branch" ] && [ -x "$WT" ]; then
  out=$(cd "$main_root" && "$WT" remove --force --no-delete-branch --foreground "$branch" 2>&1)
  rc=$?
else
  out=$(git -C "$common" worktree remove --force "$root" 2>&1)
  rc=$?
fi

if [ "$rc" -ne 0 ]; then
  say "FAILED to remove $root: $(printf '%s' "$out" | head -2 | tr '\n' ' ')"
  [ -n "$stashed" ] && say "your work is still in the stash: git -C $main_root stash list"
  "$CMUX" notify --title "Worktree kept" --body "removal failed; see worktree-drop.log" >/dev/null 2>&1
  exit 1
fi

recover="branch ${branch:-detached} kept"
[ -n "$stashed" ] && recover="$recover; uncommitted work in stash@{0} of $main_root"
say "DROPPED $root — $recover"

"$CMUX" notify --title "Worktree dropped" --body "${branch:-$(basename "$root")} — $recover" >/dev/null 2>&1

# Closing the workspace ends this script, so it goes last.
if [ -n "${CMUX_WORKSPACE_ID:-}" ]; then
  "$CMUX" close-workspace --workspace "$CMUX_WORKSPACE_ID" >/dev/null 2>&1
else
  say "no CMUX_WORKSPACE_ID — worktree removed, close the workspace yourself"
fi
