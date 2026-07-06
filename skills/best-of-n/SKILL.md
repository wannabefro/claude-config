---
name: best-of-n
description: Use manually on a hard or high-stakes task where one model family's first attempt isn't enough confidence — races two model families on the same spec and picks the better candidate. Trigger phrases - "best-of-n", "/best-of-n", "race this", "try both models".
---

# best-of-n — race two model families, pick the winner

Generate the same work twice — once with the `implementer` (Sonnet), once with
Codex (GPT) — in isolated worktrees, then compare. Two independent families on
one spec surfaces a better solution than either alone, and the diff between them
is itself informative.

This is **manual-only**: invoke it deliberately on hard or high-stakes work. It
costs an extra Codex run (bills separately), so it is not something to fire on
routine tasks.

## CRITICAL: never use `wt` for the worktrees

Create the candidate worktrees with **raw `git worktree add`** and remove them
with `git worktree remove`. Do **not** use `wt switch`/`wt` — that wrapper
auto-opens a cmux workspace (claude-teams + lazygit) for every worktree, which
this skill must never do. Raw `git worktree` creates the checkout silently.

## When to run

**Good fits:** a hard algorithm, a tricky refactor, a high-stakes change where a
second independent attempt is worth the cost.

**Skip:** trivial or routine work; anything where one model is obviously enough;
a directory that isn't a git repo (the worktree mechanism can't run there).

**vs `/self-consistency`:** best-of-n generates the *same work twice* and picks a
winner; self-consistency generates *three different views* (impl, spec, tests) of
one piece of work to localize bugs. Racing buys a better candidate; triangulating
buys higher confidence in one candidate.

## Arguments

The spec to implement — the same brief handed to both candidates. Pass it
unchanged to each so the comparison is fair.

## Execution

1. **Guard.** Confirm the working directory is inside a git repo
   (`git rev-parse --is-inside-work-tree`). If not, stop and say so — best-of-N
   needs worktrees.

2. **Create two throwaway worktrees from the current base — raw `git worktree`:**
   ```bash
   base=$(git branch --show-current)
   git worktree add -b bon/a ../.bon-a "$base"
   git worktree add -b bon/b ../.bon-b "$base"
   ```
   (Adjust the sibling paths as needed; keep them outside the repo's tracked
   tree. Never `wt`.)

3. **Dispatch both candidates against the same spec, each pinned to its worktree:**
   - **Candidate A — `implementer` (Sonnet):** dispatch via the `Agent` tool. In
     the prompt, give the absolute path to `../.bon-a` and instruct it to make
     all edits within that directory.
   - **Candidate B — Codex (GPT):** call the companion directly, pointing it at
     worktree B with `--cwd` (the companion accepts `--cwd` and requires a git
     repo there):
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task --write --cwd "$(cd ../.bon-b && pwd)" "<spec>"
     ```
     Call the companion directly rather than through the `codex-rescue` subagent —
     that wrapper doesn't take a working directory and is scoped to not do
     follow-up work.

4. **Compare.** Diff the two candidates:
   ```bash
   git -C ../.bon-a add -A && git -C ../.bon-b add -A
   git --no-pager -C ../.bon-a diff --cached > /tmp/bon-a.patch
   git --no-pager -C ../.bon-b diff --cached > /tmp/bon-b.patch
   diff /tmp/bon-a.patch /tmp/bon-b.patch
   ```
   Present the two solutions and a recommendation. Optionally run the
   `self-consistency` skill against each candidate to inform the recommendation —
   the more internally consistent candidate is the safer pick.

5. **User picks the winner.** Present the trade-offs; the user chooses. Do not
   auto-merge. If one candidate failed its own verification, surface that
   alongside the diff — a failing candidate may still carry the better idea worth
   salvaging.

6. **Apply and clean up.** Apply the chosen candidate's changes to the real
   working tree (apply its patch, or merge its branch), then remove both
   throwaways:
   ```bash
   git worktree remove ../.bon-a --force
   git worktree remove ../.bon-b --force
   git branch -D bon/a bon/b
   ```
   Confirm `git worktree list` is clean afterward.

## Picking the winner

The user decides. Frame the comparison around: correctness against the spec,
simplicity, how each handles edge/error cases, and (if run) each candidate's
self-consistency result. Cross-check is an **assist**, never an automated judge.
