# Drop a worktree on purpose — the button, and why the automatic reaper is gone

`scripts/drop-worktree.sh` closes the current cmux workspace and removes its worktree, merged or not.
It is wired as the `dropWorktree` action in `~/.config/cmux/cmux.json`.

## What it does, and what it refuses

Ungated by design. No merge check, no unpushed check, no debounce. One refusal remains: a **primary
checkout**, because that is never what you meant.

**Nothing is destroyed.**

| what you had | where it goes |
|---|---|
| Uncommitted or untracked files | A stash, made before removal |
| Commits, pushed or not | The branch, which is always kept |
| The worktree directory | Gone. That is the point |

The stash is the load-bearing part, and it works because **`refs/stash` is shared, not per-worktree**.
Verified 2026-07-31: a stash created inside a worktree is still listed, and still applies, from the
main checkout after `git worktree remove --force`.

`wt remove` runs with `--force` so a dirty worktree goes, and with `--no-delete-branch` so the branch
stays. Recovery is printed and logged to `hooks/state/worktree-drop.log`:

```
git -C <main-checkout> stash list
git -C <main-checkout> stash show -p
git switch <branch>
```

## Verified 2026-07-31

Four cases, each a real repo with a real remote:

| case | result |
|---|---|
| A primary checkout | REFUSED, directory untouched |
| Dirty **and** unpushed **and** unmerged | DROPPED, branch kept, stash created and content recoverable |
| Clean | DROPPED, and no stash created |
| Untracked files only | DROPPED, files stashed |

The script needs no cmux wiring. It only reads `CMUX_WORKSPACE_ID` to close the tab afterwards, and it
says so in the log when that variable is absent.

**Not verified: that the button appears in the cmux UI.** `cmux config doctor` reports the JSONC valid
and the `actions` key recognised, and `cmux reload-config` accepts it. But `actions` is free-form in the
schema, `cmux workspace-action --action dropWorktree` answers `Unknown workspace action` because that
command only takes built-in ids, and `cmux shortcuts` prints only `OK`. No CLI path confirms the
surface. Look in the Command Palette, or press `ctrl+alt+shift+w`.

## Why the automatic reaper was removed

It watched `workspace.closed` and reaped a worktree when its last workspace closed. It worked — the log
recorded real reaps — but it cost six gates, a debounce, quit-burst detection, single-flight, and a
socket-access workaround, all to guess an intention. An explicit button is deterministic. Removed
2026-07-31 by the user's decision: "I can be explicit instead."

Three findings from building it are worth keeping, because they will bite again:

- **`socketControlMode` defaults to `cmuxOnly`**, so only a process started inside cmux may reach the
  socket. A launchd agent cannot, and the CLI reports the denial as a Foundation JSON parse error,
  which hides the cause completely. The setting accepts `off`, `cmuxOnly`, `automation`, `password`,
  `allowAll`, `openAccess`, `fullOpenAccess`, `notifications`, and `full`.
- **Never single-flight with `pgrep -f`.** The pattern also matches the command line of the process
  running the check, so the guard reports a phantom pid and refuses to start. Use a pid file plus
  `kill -0`.
- **Killing a listener's parent orphans its `cmux events` child.** `pkill` by script name leaves the
  subscription alive, and two subscribers then race on the cursor file.

`scripts/clean-build-worktrees.sh` is untouched and still handles the other half of the problem: `wf_*`
and `agent-*` worktrees left behind by `/build`, removed only when their content matches the main tree.
It still refuses to touch a human worktree. This button is how a human worktree goes.
