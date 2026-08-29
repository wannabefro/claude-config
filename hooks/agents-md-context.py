#!/usr/bin/env python3
"""PreToolUse hook — surface the AGENTS.md that governs a file before it is edited.

Non-blocking. Always exits 0; it only adds hookSpecificOutput.additionalContext.

Why this exists: Claude Code auto-loads CLAUDE.md, never AGENTS.md. A repo bridges
that with a CLAUDE.md holding `@AGENTS.md`, which arrives as a nested_memory
attachment — but not reliably, and not always before the edit it should inform.
Measured over 56 transcripts: 16 of 21 sessions that edited a governed file never
opened the AGENTS.md. A probe of 9 of them found the attachment absent entirely in
one case whose cwd sat exactly on the file, and late in two others. So this asks
the transcript what arrived rather than inferring it from directory structure.
"""
import glob
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


def transcript(data):
    path = data.get("transcript_path") or ""
    if path and os.path.isfile(path):
        return path
    sid = data.get("session_id") or ""
    if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", sid):
        return None
    for cand in glob.glob(os.path.expanduser("~/.claude/projects/*/%s.jsonl" % sid)):
        return cand
    return None


def already_delivered(agents_md, data):
    """True when a nested_memory attachment for this exact path already landed.

    Claude Code attaches AGENTS.md as a `nested_memory` event, not a Read call, and
    it does so per edited subtree. Filesystem structure does not predict it: a
    repo-root file can never arrive while cwd sits exactly on it, and a file well
    outside the cwd chain can arrive anyway. Only the transcript is authoritative.
    """
    path = transcript(data)
    if not path:
        return False
    try:
        if os.path.getsize(path) > 64 * 1024 * 1024:
            return False
        text = open(path, errors="replace").read()
    except Exception:
        return False
    if "nested_memory" not in text:
        return False
    needle = '"path":"%s"' % agents_md
    return any("nested_memory" in ln and needle in ln for ln in text.splitlines())


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name", "") not in WRITE_TOOLS:
        sys.exit(0)

    ti = data.get("tool_input") or {}
    target = ti.get("file_path") or ti.get("notebook_path") or ""
    if not target or not os.path.isabs(target) or VENDOR_RE.search(target):
        sys.exit(0)
    if os.path.basename(target) in ("AGENTS.md", "CLAUDE.md"):
        sys.exit(0)

    root = git_root(os.path.dirname(target) or ".")
    agents_md = nearest_agents_md(target, root)
    if not agents_md or already_delivered(agents_md, data):
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
        "%s governs the file you are about to edit, and this session has not been "
        "given it — no nested_memory attachment for that path appears in the transcript. "
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
