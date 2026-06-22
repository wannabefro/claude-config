#!/usr/bin/env python3
"""PreToolUse hook — block tool calls that cross the session's git worktree boundary.

Exit 2 = block (message surfaced to the model via stderr).
Exit 0 = allow.
"""
import json
import os
import re
import subprocess
import sys


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}

    session_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    try:
        root = subprocess.check_output(
            ["git", "-C", session_dir, "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        ).strip()
    except Exception:
        sys.exit(0)

    root = os.path.realpath(root)
    home = os.path.expanduser("~")
    safelist_prefixes = (
        "/tmp/",
        "/var/folders/",
        "/private/tmp/",
        "/private/var/",
        "/dev/",
        "/proc/",
        f"{home}/.claude/",
        f"{home}/.codex/",
        f"{home}/.config/",
        f"{home}/.cache/",
        f"{home}/Library/LaunchAgents/",
        f"{home}/Library/Logs/",
    )

    def is_safe(p: str) -> bool:
        return any(p.startswith(pref) for pref in safelist_prefixes) or p == root

    def resolve(p: str) -> str:
        if not os.path.isabs(p):
            p = os.path.join(session_dir, p)
        try:
            real = os.path.realpath(p)
        except Exception:
            real = os.path.abspath(p)
        return os.path.normpath(real)

    def in_root(p: str) -> bool:
        return p == root or p.startswith(root + os.sep)

    def block(msg: str) -> None:
        sys.stderr.write(f"worktree-boundary: {msg}\n")
        sys.exit(2)

    if tool in ("Edit", "Write", "Read", "NotebookEdit", "MultiEdit"):
        fp = (
            tool_input.get("file_path")
            or tool_input.get("notebook_path")
            or tool_input.get("path")
        )
        if not fp:
            sys.exit(0)
        abs_p = resolve(fp)
        if in_root(abs_p) or is_safe(abs_p):
            sys.exit(0)
        block(
            f"{tool} target is outside session worktree.\n"
            f"  session root: {root}\n"
            f"  target:       {abs_p}\n"
            f"Another Claude session or the user may be editing there. "
            f"Ask the user before crossing worktree boundaries."
        )

    if tool == "Bash":
        cmd = tool_input.get("command", "") or ""
        if re.search(r"\bgit\s+worktree\s+(remove|prune|move)\b", cmd):
            block(
                "git worktree remove/prune/move can destroy another session's state. "
                "Ask the user to run this manually if it's truly needed."
            )
        for m in re.finditer(r"\bgit\s+-C\s+(\S+)", cmd):
            target = m.group(1).strip("'\"")
            abs_p = resolve(target)
            if not in_root(abs_p) and not is_safe(abs_p):
                block(
                    f"git -C targets path outside session worktree.\n"
                    f"  session root: {root}\n"
                    f"  target:       {abs_p}"
                )

    sys.exit(0)


if __name__ == "__main__":
    main()
