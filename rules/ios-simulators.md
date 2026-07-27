---
description: iOS simulator invariant — one sim per app, resolve by name, never global resets.
---

# iOS Simulators (one sim per app)

iOS apps run concurrently in parallel sessions. Simulators are a **shared global resource** — a
global reset breaks someone else's run.

**Invariant: each app owns exactly one simulator named `claude-<app>`, targeted by UDID, and a
session only touches its own app's sim.**

Per-app settings live in `~/.claude/ios-simulators.local.json` (untracked, machine-specific) —
nothing in the app repo. Missing entry → default `iPhone 17 Pro`, and add one; `device` must match
`xcrun simctl list devicetypes`.

Never cache a UDID — resolve by name each time. Shut the sim down when done; shutdown, not delete.

## Never — these clobber other apps' sessions

- `xcrun simctl shutdown all` / `erase all` / `delete all`, or `killall Simulator`
- Booting or building against a sim whose name isn't this app's
- A `name=` destination — resolves to whatever sim Xcode picks. **Always `id=$UDID`.**

A wedged sim gets fixed specifically — never a global reset.

Recipes: `docs/ios-simulator-recipes.md`.
