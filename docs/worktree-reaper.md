# Worktree reaper — design and evidence (reference)

`scripts/reap-worktree.sh` removes a git worktree after its last cmux workspace closes.
`scripts/cmux-worktree-reaper.sh` subscribes to the events and calls it. Read this before you change
a gate: every gate exists because of a specific way the naive version loses work.

## Why each gate exists

| gate | check | the failure it prevents |
|---|---|---|
| 0 | The path still resolves in a git repo | The directory is already gone, or was never a repo |
| 1 | `--absolute-git-dir` differs from `--git-common-dir` | **Deleting a primary checkout.** `~/Dev/chromaticly` really does emit `workspace.closed` |
| 2 | No workspace cwd under the root, and cmux answered | A worktree open in another window gets removed under it |
| 3 | Re-check gate 2 after a debounce | **Quitting cmux closes every workspace at once.** Measured: 4 closes in 8 seconds on 2026-07-14 |
| 4 | `lsof +D` is empty and the worktree is not git-locked | Deleting under a live dev server, build, or agent session |
| 5 | Clean tree, an upstream exists, nothing unpushed | **Losing work.** Ancestry lies, so content and the remote are the only honest signals |

Gate 2 doubles as the quit guard. When cmux is unreachable, or answers with no windows, the reaper
cannot confirm anything and removes nothing. A shut-down app therefore reaps nothing at all.

Two independent locks protect gate 5. The reaper refuses a dirty worktree, and `wt remove` is called
**without** `--force`, so worktrunk refuses it again.

## Decisions taken 2026-07-30

- **Armed, not log-only.** The user chose to skip the observation week.
- **An unpushed commit keeps the worktree.** A branch with no upstream also keeps it, because those
  commits exist in exactly one place.
- **Branches are never deleted.** `wt remove --no-delete-branch` always.

## Two conflicts with the rules, and how they are settled

`scripts/clean-build-worktrees.sh:35` matches only `wf_*` and `agent-*`, and says "never touch a human
worktree". The reaper is a separate script for that reason. Do not merge the two: that script's promise
is worth keeping.

`rules/worktree-workflow.md` bans `git worktree remove` from a session. The reaper is a launchd agent
rather than a session, and the rule now names it as the one exception.

## Verified 2026-07-30

Every verdict below is from a real run, recorded in `hooks/state/worktree-reaper.log`.

| case | verdict |
|---|---|
| `~/.claude`, a primary checkout | skip — never removable |
| A path that does not exist | skip |
| A worktree with a workspace still open | skip — 1 workspace under the root |
| Synthetic worktree, untracked file | KEEP |
| Synthetic worktree, 1 unpushed commit | KEEP |
| Synthetic worktree, no upstream | KEEP |
| Synthetic worktree, clean and pushed | REAPED, branch kept |
| **A real cmux workspace, opened then closed** | **REAPED about 20s later, branch kept** |

The end-to-end case is the one that matters: a real `workspace.closed` event reached the listener and
the worktree went away. Allow roughly 20 seconds beyond the debounce, because `lsof +D` is slow.

## Operating it

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.local.cmux-worktree-reaper.plist
launchctl bootout   gui/$(id -u)/dev.local.cmux-worktree-reaper
tail -f ~/.claude/hooks/state/worktree-reaper.log
```

The plist lives outside this repo because it is machine-specific, and it sets `REAPER_DEBOUNCE=90`.
The cursor file `hooks/state/worktree-reaper.cursor` makes a restart resume from the last event, so a
close that happened while the agent was down is still processed.

To check a path by hand without removing anything:

```
REAPER_DEBOUNCE=1 bash ~/.claude/scripts/reap-worktree.sh <path> --dry-run
```
