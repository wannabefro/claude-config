#!/usr/bin/env bash
# Pre-worktree hook: fetch and fast-forward default branch before creating a worktree
# Ensures new branches are based on the latest remote state

set -euo pipefail

toplevel=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$toplevel"

# Detect default branch from remote HEAD
default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$default_branch" ]; then
  # Fallback: check for main or master
  if git show-ref --verify --quiet refs/remotes/origin/main 2>/dev/null; then
    default_branch="main"
  elif git show-ref --verify --quiet refs/remotes/origin/master 2>/dev/null; then
    default_branch="master"
  else
    exit 0
  fi
fi

# Fetch latest from origin
git fetch origin "$default_branch" --quiet 2>/dev/null || exit 0

# Fast-forward local branch only if it's a direct ancestor (safe fast-forward)
if git show-ref --verify --quiet "refs/heads/$default_branch" 2>/dev/null; then
  if git merge-base --is-ancestor "$default_branch" "origin/$default_branch" 2>/dev/null; then
    git update-ref "refs/heads/$default_branch" "origin/$default_branch"
  fi
fi
