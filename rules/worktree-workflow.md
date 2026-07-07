# Worktree Workflow (worktrunk + cmux)

Replaces the old `cwt` tool. Three composable layers:

- **worktrunk (`wt`)** — git-worktree lifecycle (create/list/merge/remove).
- **cmux** — workspace + agent UI. A worktrunk hook opens each new worktree
  in a cmux workspace with a `cmux claude-teams + lazygit` layout.
- **`cmux claude-teams`** (alias `ct`) — the lead launched in every worktree
  (auto teammate mode on); also runnable standalone in an existing pane.

## Everyday loop

```bash
wt switch -c sm/<name>   # new branch + worktree; auto-opens cmux (claude-teams + lazygit)
# …work in the cmux workspace; review the diff in the lazygit pane…
wt merge main            # commit + merge back + remove worktree & branch + cd home
```

Other commands: `wt list`, `wt switch <name>` (existing worktree), `wt remove`.

## Branch prefix

worktrunk has **no branch-prefix setting** (cwt auto-prepended one). Type it:
`wt switch -c <prefix>/<name>`. A prefix (these examples use your initials, e.g.
`sm/`) is convention, not config — substitute your own.

## When to spawn teammates

Every worktree lead already has auto teammate mode on, so there's no `ct` step to
remember — but auto mode self-gates. Spawn teammates into cmux splits only when the
task forks into **2+ genuinely independent workstreams**; most tasks stay single-agent.
Monitor spawned teammates from the Feed (Ctrl-4). For side reasoning whose output
shouldn't persist (search, research, a review lens), prefer `Agent`-tool subagents
(`Explore`/`general-purpose`) over teammates — they're ephemeral and keep raw output out of context.

## Not baked in (use existing skills ad hoc)

- **Review:** `/sam-review` (or `/code-review`). Not wired into the workflow.
- **Linear:** seed a task by pasting a ticket or via the Linear MCP. No auto-fetch.

## Config / mechanics & setup internals

Config paths, the cmux pre-start/EPIPE rationale, worktree pre-trust, the `wt`
shell-function requirement, and the AI-commit-message toggle → `~/.claude/docs/worktree-mechanics.md`
(on-demand; read when setting up or debugging the worktree tooling).
