#!/usr/bin/env python3
"""Git clean filter for settings.json — strip machine specifics on the way into git.

Usage: settings-clean.py [CLAUDE_HOME]   (stdin -> stdout; default ~/.claude)

Two rewrites. The absolute ~/.claude prefix becomes __CLAUDE_HOME__, which the
smudge filter reverses. Any extraKnownMarketplaces entry that settings.local.json
also defines is dropped, because the local file already supplies it at runtime and
the tracked copy is duplication — the CLI keeps re-adding private marketplaces to
settings.json, and this repo is public.

Output is canonical json.dumps(indent=2), which matches the CLI's own formatting
byte-for-byte, so a cleaned working file compares equal to HEAD.
Invalid tracked JSON or local settings fails closed; a filter must never stage
unvalidated machine-specific content.
"""
import json
import os
import sys


def main():
    raw = sys.stdin.read()
    home = (sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.claude")).rstrip("/")
    try:
        obj = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        print("settings-clean: tracked settings.json is not valid JSON", file=sys.stderr)
        return 2
    if not isinstance(obj, dict):
        print("settings-clean: tracked settings.json must contain an object", file=sys.stderr)
        return 2
    markets = obj.get("extraKnownMarketplaces", {})
    if not isinstance(markets, dict):
        print("settings-clean: tracked marketplaces must be an object", file=sys.stderr)
        return 2

    local = os.path.join(home, "settings.local.json")
    try:
        with open(local) as fh:
            local_obj = json.load(fh)
    except FileNotFoundError:
        local_obj = {}
    except (OSError, json.JSONDecodeError):
        print("settings-clean: local settings could not be read safely", file=sys.stderr)
        return 3
    if not isinstance(local_obj, dict):
        print("settings-clean: local settings must contain an object", file=sys.stderr)
        return 3
    private_markets = local_obj.get("extraKnownMarketplaces", {})
    if not isinstance(private_markets, dict):
        print("settings-clean: local marketplaces must be an object", file=sys.stderr)
        return 3
    private = set(private_markets)

    if isinstance(markets, dict) and private:
        for name in private & set(markets):
            del markets[name]

    sys.stdout.write(json.dumps(obj, indent=2).replace(home, "__CLAUDE_HOME__") + "\n")
    return 0


sys.exit(main())
