---
description: Inspect explicitly named build worktrees without broad automatic removal.
argument-hint: "[one exact worktree path, or blank to report worktrees]"
---

Clean up: **$ARGUMENTS**

With no argument, list the current repository's worktrees and report locked,
dirty, and unmerged entries. Make no changes. Do not scan every repository.

With an argument, resolve and inspect that exact worktree path. Remove it only
when the user explicitly supplied the path, it is unlocked, and its state is
safe to remove. Never remove another worktree, delete branches, or invoke a
build cleanup scheduler. If the path is locked, dirty, unmerged, or ambiguous,
stop and report the state.
