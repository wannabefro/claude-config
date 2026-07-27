# iOS Simulator Recipes

Executable reference for `rules/ios-simulators.md`. Pull this up when you're actually driving
`simctl` — resolving a sim by name, booting, building, installing, launching, shutting down.

## Per-app config (`~/.claude/ios-simulators.local.json`)

```json
{ "myapp": { "device": "iPhone 17 Pro" },
  "otherapp": { "device": "iPad Pro 13-inch (M4)", "runtime": "iOS 26.0" } }
```

## Resolve → boot → build → install → launch → shutdown

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
