#!/usr/bin/env python3
"""Git path filter for text files that contain the Claude home placeholder.

Usage: path-clean.py [--smudge] CLAUDE_HOME

The clean direction replaces only the configured absolute home path with
``__CLAUDE_HOME__``. The smudge direction reverses that substitution. This is
intentionally content-agnostic: JSON validation and marketplace handling
belong exclusively to settings-clean.py.
"""
import os
import sys


def main():
    smudge = len(sys.argv) > 1 and sys.argv[1] == "--smudge"
    home_index = 2 if smudge else 1
    home = (sys.argv[home_index] if len(sys.argv) > home_index else os.path.expanduser("~/.claude")).rstrip("/")
    replacement = home if smudge else "__CLAUDE_HOME__"
    sys.stdout.write(sys.stdin.read().replace("__CLAUDE_HOME__" if smudge else home, replacement))
    return 0


sys.exit(main())
