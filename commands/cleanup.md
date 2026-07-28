---
description: Remove build worktrees and branches that hold nothing you'd miss — content-compared against the main tree, never by branch ancestry
argument-hint: "[repo path, or blank for every repo under ~/dev]"
---

Clean up build debris in: **$ARGUMENTS**

Worktrees and branches from `/build` and from `Agent` isolation accumulate silently. They cost disk,
they clutter `git worktree list`, and a stale one is easy to mistake for live work. Left alone they
build up fast — 37 worktrees and 33 orphan branches across four repos before anyone counted.

## Run it

One repo:

```
~/.claude/scripts/clean-build-worktrees.sh <repo> --apply
```

Every repo (dry run first — this is the form worth seeing before it acts):

```
for d in ~/dev/*/; do
  [ -d "$d/.git" ] || continue
  n=$(git -C "$d" worktree list 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] || continue
  echo "=== $(basename $d)"; ~/.claude/scripts/clean-build-worktrees.sh "$d"
done
```

Drop `--apply` for a dry run anywhere. Default is dry run, so an accidental invocation is inert.

## Why it compares content, and why that matters

**`/build`'s agents leave their work uncommitted.** The branch stays at the base commit, so every
ancestry check lies: `git branch -d` will happily report "already merged" for a worktree holding an
entire unbuilt-elsewhere unit. Content is the only honest signal, so the script diffs each changed
path against the main checkout and removes only what is byte-identical or empty.

Branches are handled separately and more conservatively still, because `agent-*` worktrees — unlike
`/build`'s — **do** commit: 9 of 12 orphan branches in one repo carried real commits. So branch
removal uses `git branch -d`, the safe delete that refuses anything unmerged, never `-D`, and skips
any branch still checked out.

Locked worktrees are never touched. A lock means something is using it.

## Reporting

Give the three counts — removed, kept, locked — and then the part that actually needs a human:
**anything kept is unmerged work.** Name those worktrees and say what they came from if you can tell.
They are not garbage the script failed to collect; they are the reason it declined.

If a kept worktree traces to a run from before the depth-1 layering fix, say so — those units were
built against a base that never contained their dependency's work, so they are stale by construction
and rebuilding beats salvaging.

Never force-remove a worktree the script kept. If it should go, the answer is to merge it or delete
the directory deliberately, not to override the check that noticed.
