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

## The action field names are undocumented — read them from the binary

The first wiring did not appear in the Command Palette. Three of the four keys were invented, because
**nothing validates them.** `actions` is `additionalProperties: true` in the schema, so a wrong field
name is accepted in silence. `docs/configuration.md` has 11 JSON examples and not one uses `actions`.

The real key list is in the app binary, as the Swift `CodingKeys` table for
`CmuxConfigActionDefinition`:

```
strings /Applications/cmux.app/Contents/MacOS/cmux | grep -n newWorkspaceMenu
```

Print about 30 lines around the hit. The action fields are:

| field | note |
|---|---|
| `title` | The menu label. **Not `label`** — that was the first bug |
| `subtitle`, `keywords` | Palette subtitle and extra search terms |
| `palette` | Command Palette visibility. **Type unknown — do not set it** |
| `shortcut` | The key binding **belongs here**. A String, per its own error message |
| `icon`, `tooltip` | SF Symbol name and hover text |
| `confirm` | Prompts before it runs. **Type unknown — do not set it** |
| `type`, `command`, `builtin`, `agent`, `workspace`, `commandName`, `args`, `restart`, `target` | The runnable half |
| `terminalCommandTarget` | `currentTerminal` or `newTabInCurrentPane` |

`shortcuts.bindings` cannot hold a custom id. Its `propertyNames` is a **closed enum of 140 built-in
action ids**, and `dropWorktree` is not one, so the binding was invalid. Put the key on the action.

**Set only the fields whose type you know.** A Swift decoder ignores an unknown key but fails on a
wrong-typed one, and a failed decode drops the whole entry — which looks identical to the bug it
would be hiding. `title` being required explains the original absence on its own, because `label`
left it nil. So `palette` and `confirm` stay out until cmux writes them itself.

**Make cmux author the entry.** The `+` button's right-click menu has **Save Workspace as Layout**
(`menu.newWorkspace.saveWorkspaceAsLayout`), and `CmuxConfigActionSaver` writes the result into
`actions`. That yields a canonical entry with real field names and real types. It is a menu item
only — no RPC and no `workspace-action` name reaches it, so a person has to click it.

The button itself comes from `ui.surfaceTabBar.buttons`, which the schema calls the preferred form of
the legacy root-level `surfaceTabBarButtons`. An entry needs an `id` and an `action` reference.

## No CLI path validates any of this — measured

`cmux config validate` and `cmux config check` both alias to `cmux config doctor`, which checks JSONC
syntax only. Verified 2026-07-31 by a differential test: `ui.surfaceTabBar.buttons[0].action` was set
to `definitelyNotAnAction`, and `doctor`, `reload-config`, and `log show` all reported success.

**So a clean reload is not evidence.** The binary holds the error strings (`does not match any loaded
action`, `action '%@' ignored because it does not define a runnable action`), but they reach neither
the CLI nor unified logging, and there is no config log under `~/Library/Logs` or `~/.cmuxterm`.
Confirm by eye: the surface tab bar, the Command Palette, or `ctrl+alt+shift+w`.

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
