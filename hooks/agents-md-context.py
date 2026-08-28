#!/usr/bin/env python3
"""PreToolUse hook — surface the AGENTS.md that governs a file before it is edited.

Non-blocking. Always exits 0; it only adds hookSpecificOutput.additionalContext.

Why this exists: Claude Code auto-loads CLAUDE.md, never AGENTS.md. A repo bridges
that with a CLAUDE.md holding `@AGENTS.md`, but the loader walks from the working
directory upward and never descends, so a bridge below cwd does not fire. Measured
over 56 transcripts: 16 of 21 sessions that edited a governed file never opened the
AGENTS.md, and the misses concentrate in subdirectories, not repo roots.
"""
import json
import os
import re
import sys

MAX_BYTES = 12000
STATE_DIR = os.path.expanduser("~/.claude/hooks/state")
IMPORT_RE = re.compile(r"^\s*@(\./)?AGENTS\.md\s*$", re.M)
VENDOR_RE = re.compile(
    r"/(\.venv|\.direnv|node_modules|vendor|site-packages|dist|build|\.git|"
    r"plugins/cache|plugins/marketplaces)/"
)
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def git_root(path):
    """Walk up for a .git entry. A subprocess here cost 250ms on every edit."""
    d = os.path.realpath(path)
    home = os.path.expanduser("~")
    while d.startswith(home) and d != home and d != "/":
        if os.path.exists(os.path.join(d, ".git")):
            return d
        d = os.path.dirname(d)
    return None


def nearest_agents_md(target, root):
    """Walk up from the target's directory to the repo root; nearest wins."""
    d = os.path.dirname(os.path.realpath(target))
    stop = root or os.path.expanduser("~")
    while d.startswith(stop) and len(d) >= len(stop):
        cand = os.path.join(d, "AGENTS.md")
        if os.path.isfile(cand):
            return cand
        if d == stop:
            break
        d = os.path.dirname(d)
    return None


def already_loaded(agents_md, cwd):
    """True only when a stub imports it AND the CLAUDE.md walk actually reaches that stub.

    The walk climbs from cwd to the filesystem root; it never descends. So a stub
    below cwd is not loaded, which is where the measured misses concentrate.
    """
    d = os.path.dirname(agents_md)
    sibling = os.path.join(d, "CLAUDE.md")
    try:
        if not IMPORT_RE.search(open(sibling, errors="replace").read()):
            return False
    except Exception:
        return False
    cwd = os.path.realpath(cwd or os.getcwd())
    return cwd == d or cwd.startswith(d + os.sep)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name", "") not in WRITE_TOOLS:
        sys.exit(0)

    target = (data.get("tool_input") or {}).get("file_path", "")
    if not target or not os.path.isabs(target) or VENDOR_RE.search(target):
        sys.exit(0)
    if os.path.basename(target) in ("AGENTS.md", "CLAUDE.md"):
        sys.exit(0)

    root = git_root(os.path.dirname(target) or ".")
    agents_md = nearest_agents_md(target, root)
    if not agents_md or already_loaded(agents_md, data.get("cwd", "")):
        sys.exit(0)

    sid = data.get("session_id", "nosession")
    os.makedirs(STATE_DIR, exist_ok=True)
    seen = os.path.join(STATE_DIR, "agents-md-%s.seen" % re.sub(r"[^A-Za-z0-9_-]", "", sid)[:64])
    try:
        if agents_md in open(seen).read().splitlines():
            sys.exit(0)
    except FileNotFoundError:
        pass
    with open(seen, "a") as fh:
        fh.write(agents_md + "\n")

    try:
        body = open(agents_md, errors="replace").read()
    except Exception:
        sys.exit(0)
    truncated = len(body.encode()) > MAX_BYTES
    if truncated:
        body = body.encode()[:MAX_BYTES].decode(errors="ignore")

    shown = agents_md.replace(os.path.expanduser("~"), "~")
    msg = (
        "%s governs the file you are about to edit, and the CLAUDE.md walk does not "
        "reach it — that walk climbs from the working directory and never descends. "
        "Its content follows. Reuse its ubiquitous language and follow its rules. "
        "Where it disagrees with a general habit of yours, it wins, and say so rather "
        "than averaging the two.%s\n\n--- %s ---\n%s"
        % (shown,
           " Content is truncated — Read the file for the rest." if truncated else "",
           shown, body)
    )
    json.dump({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "additionalContext": msg}}, sys.stdout)
    sys.exit(0)


main()
