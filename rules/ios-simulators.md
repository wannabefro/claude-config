---
description: iOS simulator invariant for parallel multi-app work — one sim per app, resolve by name, never global resets.
---

# iOS Simulators (one sim per app)

Several iOS apps are worked on concurrently in parallel sessions. Simulators are a **shared global
resource**, so booting, reusing, or shutting down another app's sim breaks its run.

**Invariant: each app owns exactly one simulator named `claude-<app>`, targeted by UDID, and a
session only ever touches its own app's sim.**

Per-app settings live in `~/.claude/ios-simulators.local.json` (untracked, machine-specific) — add
nothing to the app's own repo. Missing entry → default `iPhone 17 Pro` on the newest installed
runtime and add it. `device` must match `xcrun simctl list devicetypes`.

```json
{ "myapp": { "device": "iPhone 17 Pro" },
  "otherapp": { "device": "iPad Pro 13-inch (M4)", "runtime": "iOS 26.0" } }
```

Never cache a UDID — they change whenever a sim is recreated. Resolve by name each time:

```bash
NAME="claude-<app>"
UDID=$(xcrun simctl list devices -j | jq -r \
  --arg n "$NAME" '.devices[][] | select(.name==$n) | .udid' | head -1)
[ -n "$UDID" ] || UDID=$(xcrun simctl create "$NAME" "<device from config>")

xcrun simctl boot "$UDID" 2>/dev/null || true   # already-booted is fine
open -a Simulator                                # only when a visible UI is needed
xcodebuild -scheme <Scheme> -destination "id=$UDID" build
xcrun simctl install "$UDID" <path/to/App.app>
xcrun simctl launch "$UDID" <bundle.id>
xcrun simctl shutdown "$UDID"                    # when the task is done
```

Shut the sim down when the task finishes — booted sims slow every other app's build. Shutdown, don't
delete; it's reused next session. Delete only when I ask, or to clean an orphaned `claude-*` sim.

## Never — these clobber other apps' sessions

- `xcrun simctl shutdown all` / `erase all` / `delete all`, or `killall Simulator`
- Booting or building against a sim whose name isn't this app's
- `-destination 'platform=iOS Simulator,name=iPhone 17 Pro'` — resolves to whatever generic sim Xcode
  picks, possibly another app's. **Always `id=$UDID`.**

A busy or wedged sim gets fixed specifically (`shutdown` + `boot`, or `erase` that one) — never a
global reset.
