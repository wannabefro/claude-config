#!/usr/bin/env python3
"""PreToolUse hook — surface the AGENTS.md that governs a file before it is edited.

Non-blocking. Always exits 0; it only adds hookSpecificOutput.additionalContext.

Why this exists: Claude Code auto-loads CLAUDE.md, not AGENTS.md. A repo usually
bridges that by making CLAUDE.md an `@AGENTS.md` import stub, and most do. The
rest are invisible unless something opens them, and a rule alone does not survive
a long session. This fires at the edit, the last moment the content changes
anything. scripts/agents-md-coverage.py lists the unbridged ones.
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


def covered_by_stub(agents_md):
    """True when a sibling CLAUDE.md imports it, so Claude Code already has it."""
    sibling = os.path.join(os.path.dirname(agents_md), "CLAUDE.md")
    try:
        return bool(IMPORT_RE.search(open(sibling, errors="replace").read()))
    except Exception:
        return False


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
    if not agents_md or covered_by_stub(agents_md):
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
        "%s governs the file you are about to edit, and no sibling CLAUDE.md "
        "imports it, so Claude Code did not load it. Its content follows. Reuse its "
        "ubiquitous language and follow its rules; where it conflicts with a "
        "general habit of yours, it wins.%s\n\n--- %s ---\n%s"
        % (shown,
           " Content is truncated — Read the file for the rest." if truncated else "",
           shown, body)
    )
    json.dump({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "additionalContext": msg}}, sys.stdout)
    sys.exit(0)


main()
