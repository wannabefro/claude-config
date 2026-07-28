#!/usr/bin/env bash
# Move a repo's docs/plans into iCloud and symlink it back.
#
# Why: plans are durable working documents — measured, 83 of 122 are re-read
# more than 20 times and half get revised after creation — but they were
# untracked AND un-ignored, so they synced nowhere and sat in `git status` as
# `?? docs/plans/` forever. Committing them was rejected; this keeps them out
# of the repo entirely while making them portable across machines.
#
# Idempotent. Run per repo:  link-plans.sh <repo-path> [--apply]
# Without --apply it prints what it would do and changes nothing.
set -uo pipefail

STORE="$HOME/Library/Mobile Documents/com~apple~CloudDocs/claude-plans"
repo="${1:?usage: link-plans.sh <repo-path> [--apply]}"
apply=""; [ "${2:-}" = "--apply" ] && apply=1

repo="${repo%/}"
name=$(basename "$repo")
src="$repo/docs/plans"
dst="$STORE/$name"

say() { printf '  %s\n' "$*"; }
is_git=1; [ -d "$repo/.git" ] || is_git=""

if [ -L "$src" ]; then
  say "OK   $name — already a symlink -> $(readlink "$src")"
  exit 0
fi

n=0; [ -d "$src" ] && n=$(find "$src" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')

# Only touch repos that actually hold plans. Symlinking ~60 empty repos would be
# churn in trees this change has no business entering; they get linked if and
# when they first produce a plan.
[ "$n" -eq 0 ] && { say "SKIP $name — no plans"; exit 0; }

if [ -z "$apply" ]; then
  say "PLAN $name — move $n plan(s) to iCloud, symlink back, gitignore docs/plans"
  exit 0
fi

mkdir -p "$dst" || { say "FAIL $name — cannot create $dst"; exit 1; }

if [ -d "$src" ]; then
  # Copy first, verify, then remove — never move-then-hope.
  cp -Rn "$src/." "$dst/" 2>/dev/null || true
  moved=$(find "$dst" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
  if [ "$n" -gt 0 ] && [ "$moved" -lt "$n" ]; then
    say "FAIL $name — copied $moved of $n, leaving original in place"
    exit 1
  fi
  rm -rf "$src"
fi

mkdir -p "$repo/docs"
ln -s "$dst" "$src" || { say "FAIL $name — symlink failed"; exit 1; }

# No per-repo .gitignore entry: ~/.config/git/ignore carries docs/plans/ globally.

say "DONE $name — $n plan(s) -> $dst"
