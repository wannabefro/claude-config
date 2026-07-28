#!/usr/bin/env bash
# Remove build worktrees that hold nothing you'd miss.
#
# The hazard this is built around: /build's agents leave their work
# UNCOMMITTED in the worktree. The branch stays at the base commit, so
# ancestry tells you nothing — `git branch -d` would report "already merged"
# for a worktree containing an entire unmerged unit. Content is the only
# honest signal, so each changed file is compared against the main checkout.
#
#   clean-build-worktrees.sh <repo> [--apply] [--force]
#
# Default is a dry run. Without --force, any worktree whose content differs
# from the main tree is KEPT and reported — that is unmerged work.
set -uo pipefail

repo="${1:?usage: clean-build-worktrees.sh <repo> [--apply] [--force]}"
apply=""; force=""
for a in "${@:2}"; do
  [ "$a" = "--apply" ] && apply=1
  [ "$a" = "--force" ] && force=1
done
repo="${repo%/}"
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { echo "  not a git repo: $repo"; exit 1; }

main_root=$(git -C "$repo" rev-parse --show-toplevel)
removed=0; kept=0; skipped=0

# --porcelain so paths with spaces survive. Read with a while loop rather than
# mapfile: macOS ships bash 3.2, where mapfile does not exist.
wt=""; locked=""
flush() {
  [ -z "$wt" ] && return
  case "$(basename "$wt")" in
    wf_*|agent-*) ;;
    *) wt=""; locked=""; return ;;          # never touch a human worktree
  esac
  if [ -n "$locked" ]; then
    echo "  skip   $(basename "$wt") — locked (in use)"; skipped=$((skipped+1)); wt=""; locked=""; return
  fi

  local dirty unique verdict diffs
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  unique=$(git -C "$wt" log --oneline HEAD --not "$(git -C "$main_root" rev-parse HEAD)" 2>/dev/null | wc -l | tr -d ' ')

  if [ "$dirty" -eq 0 ] && [ "$unique" -eq 0 ]; then
    verdict="empty"
  else
    # Every changed path must already match the main tree, or it is unmerged.
    diffs=0
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      if ! diff -q "$wt/$f" "$main_root/$f" >/dev/null 2>&1; then diffs=$((diffs+1)); fi
    done < <(git -C "$wt" status --porcelain 2>/dev/null | sed 's/^...//')
    if [ "$unique" -gt 0 ]; then verdict="unmerged ($unique unpushed commit(s))"
    elif [ "$diffs" -gt 0 ]; then verdict="unmerged ($diffs file(s) differ from main)"
    else verdict="merged"; fi
  fi

  case "$verdict" in
    empty|merged)
      if [ -n "$apply" ]; then
        git -C "$repo" worktree remove --force "$wt" >/dev/null 2>&1 \
          && { echo "  remove $(basename "$wt") — $verdict"; removed=$((removed+1)); } \
          || { echo "  FAIL   $(basename "$wt") — remove failed"; kept=$((kept+1)); }
      else
        echo "  would remove $(basename "$wt") — $verdict"; removed=$((removed+1))
      fi ;;
    *)
      echo "  KEEP   $(basename "$wt") — $verdict"; kept=$((kept+1)) ;;
  esac
  wt=""; locked=""
}
while IFS= read -r l; do
  case "$l" in
    "worktree "*) flush; wt="${l#worktree }" ;;
    locked*)      locked=1 ;;
  esac
done < <(git -C "$repo" worktree list --porcelain 2>/dev/null)
flush

# Branches outlive their worktrees. Prune only those with no worktree attached,
# and only via `git branch -d` — the safe delete, which REFUSES anything not
# already merged. Never -D: agent-* worktrees (unlike /build's) do commit, so
# most of these branches carry real work. Measured: 9 of 12 in one repo.
attached=$(git -C "$repo" worktree list --porcelain 2>/dev/null | sed -n 's/^branch refs\/heads\///p')
bdel=0; bkept=0
while IFS= read -r b; do
  [ -z "$b" ] && continue
  printf '%s\n' "$attached" | grep -qxF "$b" && continue     # still checked out
  if [ -n "$apply" ]; then
    if git -C "$repo" branch -d "$b" >/dev/null 2>&1; then bdel=$((bdel+1)); else bkept=$((bkept+1)); fi
  else
    if git -C "$repo" merge-base --is-ancestor "$b" HEAD 2>/dev/null; then bdel=$((bdel+1)); else bkept=$((bkept+1)); fi
  fi
done < <(git -C "$repo" branch --list 'worktree-*' 2>/dev/null | tr -d ' *')
[ $((bdel+bkept)) -gt 0 ] && echo "  branches: $bdel merged (removable), $bkept still carry unmerged commits (kept)"

if [ -n "$force" ] && [ "$kept" -gt 0 ]; then
  echo "  --force given: nothing was force-removed. Unmerged work is not garbage; merge it or delete the directory yourself."
fi
[ -n "$apply" ] && git -C "$repo" worktree prune 2>/dev/null
echo "  ---- $removed removable, $kept kept (unmerged), $skipped locked"
