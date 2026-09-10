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

Every worktree lead has auto teammate mode on, but it self-gates. Prefer `Agent`-tool subagents over
teammates for two reasons, and the second is the load-bearing one.

1. A subagent is ephemeral, so its raw output stays out of context.
2. **A subagent returns its report to the caller. A teammate does not.** A teammate signals idle, and
   since CLI 2.1.251 its final answer rides in that idle notification. When the teammate ends its turn
   with no final message, the notification is empty and the lead must ask for the report by hand.

Measured over 306 dispatches on this machine: 190 were `in_process_teammate` and 116 were `Agent`-tool
subagents. The subagents returned a report 113 of 114 times; the single miss was a stall. So "the agent
went idle without delivering its report" is teammate semantics, not a broken agent.

**Give every dispatch an explicit output contract.** Name the exact fields to return. A brief that only
describes work lets a worker end its turn on a tool call, which is what produces an empty notification.

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
