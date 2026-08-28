#!/usr/bin/env python3
"""Report which AGENTS.md files nothing loads, so the agents-md-context hook must.

Claude Code auto-loads CLAUDE.md, never AGENTS.md. A repo bridges that by making
CLAUDE.md an `@AGENTS.md` import stub. This finds the ones with no such bridge.

Usage: agents-md-coverage.py [DIR ...]   (default: $AGENTS_MD_ROOTS, else the cwd)
Exits 1 when any gap is found, so it can gate.
"""
import os
import re
import subprocess
import sys

VENDOR = re.compile(r"/(\.venv|\.direnv|node_modules|vendor|site-packages|dist|build|\.git|"
                    r"plugins/cache|plugins/marketplaces)/")
FIXTURE = re.compile(r"/(fixtures?|testdata|__fixtures__)/")
IMPORT = re.compile(r"^\s*@(\./)?AGENTS\.md\s*$", re.M)
HOME = os.path.expanduser("~")


def find(roots):
    try:
        out = subprocess.run(["fd", "-u", "-t", "f", "-t", "l", r"^AGENTS\.md$"] + roots,
                             capture_output=True, text=True, timeout=120).stdout.split()
    except FileNotFoundError:
        sys.exit("agents-md-coverage: fd is not installed")
    return [p for p in out if not VENDOR.search(p) and not FIXTURE.search(p)]


def _default_roots():
    """$AGENTS_MD_ROOTS is a colon list of parents; each child directory is scanned."""
    env = os.environ.get("AGENTS_MD_ROOTS", "").strip()
    if not env:
        return [os.getcwd()]
    out = []
    for parent in env.split(":"):
        parent = os.path.expanduser(parent.strip())
        if os.path.isdir(parent):
            out += [os.path.join(parent, d) for d in sorted(os.listdir(parent))]
    return out


def main():
    roots = sys.argv[1:] or _default_roots()
    roots = [r for r in roots if os.path.isdir(r)]
    if not roots:
        sys.exit("agents-md-coverage: no readable directory to scan")
    covered, gaps = 0, []
    for a in find(roots):
        sibling = os.path.join(os.path.dirname(a), "CLAUDE.md")
        if not os.path.exists(sibling):
            gaps.append(("orphan", a))
        elif IMPORT.search(open(sibling, errors="replace").read()):
            covered += 1
        else:
            gaps.append(("divergent", a))
    total = covered + len(gaps)
    print(f"AGENTS.md examined: {total}")
    print(f"  covered by an @AGENTS.md stub: {covered}")
    print(f"  GAP, loaded only by the hook : {len(gaps)}")
    for kind, path in sorted(gaps, key=lambda x: x[1]):
        print(f"    {kind:10s} {path.replace(HOME, '~')}")
    sys.exit(1 if gaps else 0)


main()
