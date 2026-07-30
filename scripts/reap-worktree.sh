#!/usr/bin/env bash
# Remove a git worktree once its last cmux workspace closes.
#
# Design, evidence and the two rule conflicts it creates:
# docs/worktree-reaper.md. Read that before changing a gate.
#
#   reap-worktree.sh <path-that-was-closed> [--dry-run]
#
# Every gate must pass. Any doubt keeps the worktree.
set -uo pipefail

CMUX="${CMUX_BIN:-/Applications/cmux.app/Contents/Resources/bin/cmux}"
WT="${WORKTRUNK_BIN:-/opt/homebrew/bin/wt}"
DEBOUNCE="${REAPER_DEBOUNCE:-90}"
STATE="$HOME/.claude/hooks/state"
LOG="$STATE/worktree-reaper.log"
mkdir -p "$STATE"

closed="${1:?usage: reap-worktree.sh <path> [--dry-run]}"
dry=""
[ "${2:-}" = "--dry-run" ] && dry=1

say() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }
skip() { say "skip   $closed — $1"; exit 0; }
keep() {
  say "KEEP   $root — $1"
  "$CMUX" notify --title "Worktree kept" --body "$(basename "$root"): $1" >/dev/null 2>&1
  exit 0
}

# Gate 0: the path must still resolve inside a git repo.
root=$(git -C "$closed" rev-parse --show-toplevel 2>/dev/null) || skip "not a git repo or already gone"

# Gate 1: a linked worktree has a git dir separate from the common dir.
gitdir=$(git -C "$root" rev-parse --absolute-git-dir 2>/dev/null) || skip "no git dir"
common=$(cd "$root" && cd "$(git rev-parse --git-common-dir 2>/dev/null)" && pwd) || skip "no common dir"
[ "$gitdir" != "$common" ] || skip "primary checkout, never removable"

workspaces_under() {
  local wins refs n=0 total=0
  wins=$("$CMUX" list-windows 2>/dev/null | sed -n 's/^[* ]*\([0-9]*\):.*/\1/p') || return 2
  [ -z "$wins" ] && return 2
  for w in $wins; do
    refs=$(CMUX_QUIET=1 "$CMUX" workspace list --window "$w" --json 2>/dev/null) || return 2
    n=$(printf '%s' "$refs" | python3 -c '
import json,sys,os
root=os.environ["ROOT"].rstrip("/")
try: d=json.load(sys.stdin)
except Exception: sys.exit(3)
hit=[w for w in d.get("workspaces",[])
     if (w.get("current_directory") or "").rstrip("/") == root
     or (w.get("current_directory") or "").startswith(root + "/")]
print(len(hit))
print(len(d.get("workspaces",[])), file=sys.stderr)
' 2>/dev/null) || return 2
    [ -z "$n" ] && return 2
    total=$((total + n))
  done
  printf '%s' "$total"
}

# Gate 2 and 3: nothing left under the root, and cmux is still alive to say so.
export ROOT="$root"
live=$(workspaces_under) || skip "cmux unreachable — cannot confirm, so nothing is removed"
[ "$live" = "0" ] || skip "$live workspace(s) still under the root"

sleep "$DEBOUNCE"

live=$(workspaces_under) || skip "cmux went away during debounce — treated as app quit"
[ "$live" = "0" ] || skip "reopened during debounce"

# Gate 4: a live process or a git lock means the worktree is in use.
if command -v lsof >/dev/null 2>&1; then
  busy=$(lsof -w +D "$root" 2>/dev/null | sed 1d | head -1)
  [ -z "$busy" ] || keep "a process still runs inside it"
fi
git -C "$common" worktree list --porcelain 2>/dev/null |
  awk -v r="$root" '$1=="worktree"{w=$2} /^locked/{if(w==r) print "locked"}' |
  grep -q locked && keep "git-locked"

# Gate 5: content is the only honest signal, so refuse anything unique.
[ -z "$(git -C "$root" status --porcelain 2>/dev/null)" ] || keep "uncommitted or untracked changes"
if ! git -C "$root" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  keep "branch has no upstream, so its commits exist nowhere else"
fi
ahead=$(git -C "$root" log --oneline '@{u}..HEAD' 2>/dev/null | wc -l | tr -d ' ')
[ "$ahead" = "0" ] || keep "$ahead unpushed commit(s)"

branch=$(git -C "$root" symbolic-ref --short HEAD 2>/dev/null) || branch=""
main_root=$(dirname "$common")

if [ -n "$dry" ]; then
  say "WOULD REMOVE $root (branch ${branch:-detached})"
  exit 0
fi

# No --force anywhere: wt and git both refuse a dirty worktree on their own.
if [ -n "$branch" ] && [ -x "$WT" ]; then
  out=$(cd "$main_root" && "$WT" remove --no-delete-branch --foreground "$branch" 2>&1)
  rc=$?
else
  out=$(git -C "$common" worktree remove "$root" 2>&1)
  rc=$?
fi

if [ "$rc" -eq 0 ]; then
  say "REAPED $root (branch ${branch:-detached}), kept the branch"
  "$CMUX" notify --title "Worktree reaped" \
    --body "${branch:-$(basename "$root")} — clean and pushed, branch kept" >/dev/null 2>&1
else
  say "FAIL   $root — removal refused: $(printf '%s' "$out" | head -2 | tr '\n' ' ')"
  "$CMUX" notify --title "Worktree kept" --body "$(basename "$root"): removal refused" >/dev/null 2>&1
fi
