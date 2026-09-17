#!/usr/bin/env python3
"""PostToolUse hook — hold every edited file to CLAUDE.md's comment limits.

CLAUDE.md caps a comment or docstring at one sentence of at most 20 words and
never more than two lines, docstrings included. That rule lived as prose only:
scripts/comment-density.py measured it exactly but nothing ever invoked it, so
c99b7da deleted it as an unreferenced script and the limit stopped biting. This
wires the check to the edit that creates the violation, while the author is
still in the file.

Density is deliberately not enforced here. It is a whole-file property, so an
edit touching no comment would still be flagged on a legitimately comment-heavy
file, and CLAUDE.md states only the per-comment word and line limits. Run the
script directly for the density view.

PostToolUse cannot block, and stderr from a hook that exits 0 never reaches
Claude, so the finding has to travel as stdout JSON.
"""
import json
import os
import re
import subprocess
import sys

WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SUFFIX = {".py", ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".tsx",
          ".swift", ".go", ".rs", ".java", ".kt", ".rb", ".yaml", ".yml"}
VENDOR_RE = re.compile(
    r"/(\.venv|\.direnv|node_modules|vendor|site-packages|dist|build|target|"
    r"coverage|\.git|plugins/cache|plugins/marketplaces)/"
)
CHECKER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "scripts", "comment-density.py")
FINDING_RE = re.compile(r"^\s*(block of \d+ comment lines|comment of \d+ words) ")


def findings(path):
    """Return the per-comment violations, with density neutralised by a 100% cap."""
    proc = subprocess.run(
        [sys.executable, CHECKER, "--max-density", "100", path],
        capture_output=True, text=True, timeout=25)
    if proc.returncode != 1:
        return []
    return [ln.strip() for ln in proc.stdout.splitlines() if FINDING_RE.match(ln)]


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
    if os.path.splitext(target)[1] not in SUFFIX or not os.path.isfile(target):
        sys.exit(0)
    if not os.path.isfile(CHECKER):
        sys.exit(0)

    try:
        found = findings(target)
    except Exception:
        sys.exit(0)
    if not found:
        sys.exit(0)

    shown = target.replace(os.path.expanduser("~"), "~")
    reason = (
        "%s breaks CLAUDE.md's comment limits — one sentence, at most 20 words, "
        "never more than two lines, docstrings included:\n\n%s\n\n"
        "Rewrite these now, before moving on. Keep the non-obvious reason and drop "
        "everything that restates the code; move longer rationale to the module "
        "docstring, documentation, or the PR description. Module docstrings are "
        "exempt from the limits."
        % (shown, "\n".join("  - " + f for f in found))
    )
    json.dump({"decision": "block", "reason": reason,
               "hookSpecificOutput": {"hookEventName": "PostToolUse"}}, sys.stdout)
    sys.exit(0)


main()
