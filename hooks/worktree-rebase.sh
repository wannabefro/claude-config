#!/usr/bin/env bash
# Post-worktree hook: rebase the new worktree branch onto origin's default branch
# Safe because the branch was just created with no unique commits

set -euo pipefail

# Detect default branch from remote HEAD
default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$default_branch" ]; then
  if git show-ref --verify --quiet refs/remotes/origin/main 2>/dev/null; then
    default_branch="main"
  elif git show-ref --verify --quiet refs/remotes/origin/master 2>/dev/null; then
    default_branch="master"
  else
    exit 0
  fi
fi

# Safety: refuse to reset if the current branch has commits that aren't on any
# remote. The hook's comment ("safe because the branch was just created with no
# unique commits") doesn't hold when the hook fires in an already-working
# parent directory — nested-worktree cases or misrouted EnterWorktree events
# can land here with user commits in flight. A hard reset would silently drop
# them; better to bail out and let the user handle it.
current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ -n "$current_branch" ] && [ "$current_branch" != "$default_branch" ]; then
  # Commits on HEAD not reachable from any remote ref. Handles the
  # no-upstream case (freshly created branches) that @{u}..HEAD cannot.
  unpushed=$(git log --oneline HEAD --not --remotes 2>/dev/null | head -n 1)
  if [ -n "$unpushed" ]; then
    echo "[worktree-rebase] refusing: $current_branch has unpushed commits. Push first, or reset manually." >&2
    exit 0
  fi
fi

# Reset the new branch to origin's default branch
git reset --hard "origin/$default_branch" --quiet 2>/dev/null || exit 0
