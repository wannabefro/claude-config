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
Invalid JSON passes through untouched; a filter must never corrupt the file.
"""
import json
import os
import sys


def main():
    raw = sys.stdin.read()
    home = (sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.claude")).rstrip("/")
    try:
        obj = json.loads(raw)
    except Exception:
        sys.stdout.write(raw.replace(home, "__CLAUDE_HOME__"))
        return

    local = os.path.join(home, "settings.local.json")
    try:
        with open(local) as fh:
            private = set(json.load(fh).get("extraKnownMarketplaces", {}))
    except Exception:
        private = set()

    markets = obj.get("extraKnownMarketplaces")
    if isinstance(markets, dict) and private:
        for name in private & set(markets):
            del markets[name]

    sys.stdout.write(json.dumps(obj, indent=2).replace(home, "__CLAUDE_HOME__") + "\n")


main()
