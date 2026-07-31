---
description: Worktree workflow via worktrunk (wt) + cmux — everyday commands, branch prefix, session boundaries.
---

# Worktree Workflow (worktrunk + cmux)

```bash
wt switch -c <prefix>/<name>   # new branch + worktree; auto-opens cmux (claude-teams + lazygit)
wt merge main            # commit + merge back + remove worktree & branch + cd home
```

Also `wt list`, `wt switch <name>` (existing), `wt remove`. worktrunk has **no branch-prefix setting**
— type the prefix yourself (these examples use initials); it's convention, not config.

Every worktree lead has auto teammate mode on, but it self-gates. For side reasoning whose output
shouldn't persist, prefer `Agent`-tool subagents over teammates — ephemeral, and raw output stays out
of context.

## Session boundaries

A session owns exactly one worktree (the git root of its cwd) — that's the ceiling for edits and
file-targeting Bash. Don't edit or `cd` into a sibling worktree or the parent clone of the same repo;
ask me if you need another worktree's state. Never `git worktree remove/prune/move`, never
`git -C <other-worktree>`, and never force-push a branch that may be checked out elsewhere.

**One exception, and only you trigger it.** The cmux **Drop worktree** button removes the current
worktree merged or not, via `scripts/drop-worktree.sh`. It refuses a primary checkout, stashes
uncommitted work first, and always keeps the branch, so nothing is destroyed. Design and verified
cases: `docs/worktree-button.md`. This grants a session nothing — do not run it on my behalf unless I
ask for that worktree to go.

Setup internals — config paths, cmux pre-start/EPIPE rationale, worktree pre-trust, the `wt`
shell-function requirement, AI-commit-message toggle → `~/.claude/docs/worktree-mechanics.md`.
