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

## Read the docs, not the binary — the sources that answer this

Three rounds of guessing cost this. The answers were in two places the whole time:

| source | what it gives |
|---|---|
| `skills/cmux-customization/SKILL.md` in the cmux repo | The `actions` contract in prose, plus a worked Command Palette example |
| `dogfood/directory-actions/**/cmux.json` in the cmux repo | Working configs the cmux team maintains — real field names, real types |

`cmux docs settings` points at neither. It offers `configuration.md`, which has 11 JSON examples and
**not one uses `actions`**. The skills directory is where the action documentation lives.

Nothing catches a wrong field either: `actions` is `additionalProperties: true` in the schema, so a
bad name passes, and a bad *type* fails the decode and drops the whole entry in silence.

## The action shape, from the dogfood configs

```jsonc
"actions": {
  "dropWorktree": {
    "type": "command",
    "title": "Drop worktree",              // NOT "label"
    "subtitle": "…",
    "icon": { "type": "symbol", "name": "trash" },   // an OBJECT, not a string
    "command": "bash \"$HOME/.claude/scripts/drop-worktree.sh\"",
    "target": "newTabInCurrentPane",       // NOT "terminalCommandTarget"
    "shortcut": "ctrl+alt+shift+w",        // NOT shortcuts.bindings
    "palette": true                        // a Bool; entries show unless false
  }
}
```

`icon` takes three forms: `{ type: "symbol", name: … }`, `{ type: "emoji", value: … }`, and
`{ type: "image", path: … }`. **A bare string is the bug that cost the most** — it type-mismatches, so
the entry never decodes and the action never appears anywhere.

`shortcuts.bindings` cannot hold a custom id. Its `propertyNames` is a **closed enum of 140 built-in
action ids**. The key belongs on the action, as `shortcut`.

## `ui.surfaceTabBar.buttons` replaces the default tab bar

It is an array of **action-id strings**, not objects. It replaces the defaults rather than adding to
them, so list the built-ins you want to keep: `cmux.newTerminal`, `cmux.newBrowser`,
`cmux.splitRight`, `cmux.splitDown`.

## No CLI path validates any of this — measured

`cmux config validate` and `cmux config check` both alias to `cmux config doctor`, which checks JSONC
syntax only. Verified 2026-07-31 by a differential test: a button's action was set to
`definitelyNotAnAction`, and `doctor`, `reload-config`, and `log show` all reported success.

`cmux capabilities` lists 255 RPC methods, and **none enumerates the action registry or the palette**.
So there is no way to ask the app what it loaded.

**A clean reload is therefore not evidence.** The binary holds the error strings (`does not match any
loaded action`, `action '%@' ignored because it does not define a runnable action`), but they reach
neither the CLI nor unified logging, and no config log exists under `~/Library/Logs` or `~/.cmuxterm`.

**The lesson is upstream of all that: copy a working config instead of validating a guess.** The
dogfood tree is the oracle, and it costs one fetch.

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
