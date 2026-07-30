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
| A real cmux workspace, closed, listener started by hand | REAPED, branch kept |
| A real cmux workspace, closed, listener started by the `SessionStart` hook | **REAPED after about 100s, branch kept** |
| The same, while a shell held the worktree as its cwd | **KEEP — a process still runs inside it** |

The last two are the cases that matter. The first proves the whole path works from the hook that now
starts it. The second proves gate 4 stops a real live process, and it was found by accident: the test
harness had `cd`-ed into the worktree and stayed there.

Budget the debounce plus roughly 10 seconds. Measured 100s end to end at `REAPER_DEBOUNCE=90`.

## The launchd agent cannot reach cmux — read this first

`cmux.json` sets `socketControlMode: "cmuxOnly"`, and `capabilities` reports
`"access_mode": "cmuxOnly"`. Only a process started **inside** cmux may connect.
A launchd agent is not, so every call returns:

```
Error: ERROR: Access denied - only processes started inside cmux can connect
```

The CLI then reports it as a Foundation JSON parse error, which hides the cause. The listener now
probes `list-windows` first and exits 0 on access denial, so `KeepAlive` stops retrying instead of
looping every 30 seconds.

This is why testing by hand proved nothing: a session running in a cmux workspace is inside cmux and
connects fine. **Only the launchd path was broken, and only launchd exposes it.**

**Chosen 2026-07-30: start it inside cmux.** The rejected alternative was
`socketControlMode: "password"` plus `CMUX_SOCKET_PASSWORD`, which keeps the launchd design but makes
the control socket reachable by any local process holding the password. `socketControlMode` accepts
`off`, `cmuxOnly`, `automation`, `password`, `allowAll`, `openAccess`, `fullOpenAccess`,
`notifications`, and `full`; `password` is the narrowest one that would work.

So the launchd agent is gone and `hooks/start-worktree-reaper.sh` runs at `SessionStart` instead. It
exits immediately unless `CMUX_WORKSPACE_ID` is set, so it only ever starts from inside cmux, where the
process inherits `CMUX_SOCKET_CAPABILITY`. A detached child keeps that access — verified, a
`nohup`-detached process listed windows successfully.

The hook fires on every session rather than only on worktree creation, which is why it lives here
instead of in `~/.config/worktrunk/open-cmux.sh`. That file is also untracked, so it would not sync.

**Single-flight uses a pid file, never `pgrep`.** A `pgrep -f "cmux events …"` pattern also matches the
command line of the process doing the check, so the listener reported a phantom pid and refused to
start. `hooks/state/worktree-reaper.pid` plus `kill -0` is deterministic.

The listener refuses to start when another subscriber is already running, because two subscribers race
on the cursor file. An orphaned subscriber caused exactly that confusion during development.

## Operating it

It starts itself at `SessionStart` inside cmux. To drive it by hand:

```
bash ~/.claude/hooks/start-worktree-reaper.sh     # start if not already running
kill $(cat ~/.claude/hooks/state/worktree-reaper.pid)
tail -f ~/.claude/hooks/state/worktree-reaper.log
```

`REAPER_DEBOUNCE` defaults to 90 seconds. The cursor file
`hooks/state/worktree-reaper.cursor` makes a restart resume from the last event, so a close that
happened while the listener was down is still processed.

To check a path by hand without removing anything:

```
REAPER_DEBOUNCE=1 bash ~/.claude/scripts/reap-worktree.sh <path> --dry-run
```
