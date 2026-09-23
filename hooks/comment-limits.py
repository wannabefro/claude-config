#!/usr/bin/env python3
"""PostToolUse hook — hold the comments an edit writes to CLAUDE.md's limits.

CLAUDE.md caps a comment or docstring at one sentence of at most 20 words and
never more than two lines, docstrings included. scripts/comment-density.py
measures exactly that; this hook runs it on the file an edit just touched.

It reports only comments the edit created or changed. The first version reported
every violation in the file, so an edit that touched no comment in a teammate's
file repeated the same findings on every edit: 190 reports across 69 files in
eight days, one finding 18 times. Now it runs the checker on the file before and
after the edit and keeps only the new findings. They are keyed by kind plus the
comment's full text, with occurrence counts, rather than by line number, so an edit that shifts lines
does not make old findings look new. The pre-edit text comes from the tool's own
`originalFile`, or failing that from undoing the edit's old/new strings.

The finding travels as additionalContext, not a block. It is guidance about text
just written, and the hook chain's rule is that PostToolUse never blocks. Density
is not enforced: it is a whole-file property, and not one of CLAUDE.md's limits.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

WRITE_TOOLS = {"Edit", "Write", "MultiEdit"}
SUFFIX = {".py", ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".tsx",
          ".swift", ".go", ".rs", ".java", ".kt", ".rb", ".yaml", ".yml"}
VENDOR_RE = re.compile(
    r"/(\.venv|\.direnv|node_modules|vendor|site-packages|dist|build|target|"
    r"coverage|\.git|plugins/cache|plugins/marketplaces)/"
)
CHECKER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "scripts", "comment-density.py")
FINDING_RE = re.compile(
    r"^\s*(block of \d+ comment lines|comment of \d+ words) at .+:(\d+) \(max")


def findings(path):
    """Return (kind, line) per violation; a 100% density cap leaves only the CLAUDE.md limits."""
    proc = subprocess.run(
        [sys.executable, CHECKER, "--max-density", "100", path],
        capture_output=True, text=True, timeout=25)
    if proc.returncode != 1:
        return []
    return [(m.group(1), int(m.group(2)))
            for m in map(FINDING_RE.match, proc.stdout.splitlines()) if m]


COMMENT_RE = re.compile(r"^\s*(#|//|/?\*|\"\"\"|\'\'\')")


def comment_text(lines, n):
    """The stripped comment lines starting at 1-based line n, the finding's identity."""
    out = []
    for line in lines[n - 1:]:
        if out and not COMMENT_RE.match(line):
            break
        out.append(line.strip())
    return tuple(out)


def keyed(path, text):
    """Key findings by kind and full comment text, which survive line shifts."""
    lines = text.splitlines()
    out = {}
    for kind, n in findings(path):
        out.setdefault((kind, comment_text(lines, n)), []).append((kind, n))
    return out


def original_text(data, now):
    """Pre-edit text from the tool's record, else by undoing the edit; None if unknown."""
    resp = data.get("tool_response")
    if isinstance(resp, dict) and isinstance(resp.get("originalFile"), str):
        return resp["originalFile"]
    tool = data.get("tool_name")
    if tool == "Write":
        return ""
    ti = data.get("tool_input") or {}
    edits = ti.get("edits") if tool == "MultiEdit" else [ti]
    text = now
    for e in reversed(edits or []):
        new, old = e.get("new_string", ""), e.get("old_string", "")
        if not new or new not in text:
            return None
        text = text.replace(new, old) if e.get("replace_all") else text.replace(new, old, 1)
    return text


def new_findings(target, now, before):
    """Findings present after the edit and absent before it."""
    after = keyed(target, now)
    if not after or not before:
        return sorted((f for fs in after.values() for f in fs), key=lambda f: f[1])
    with tempfile.TemporaryDirectory() as d:
        prior = os.path.join(d, "before" + os.path.splitext(target)[1])
        with open(prior, "w") as fh:
            fh.write(before)
        old = keyed(prior, before)
    # A key seen k times before hides only its first k occurrences, so a duplicate stays new.
    new = [f for k, fs in after.items() for f in fs[len(old.get(k, [])):]]
    return sorted(new, key=lambda f: f[1])


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name", "") not in WRITE_TOOLS:
        sys.exit(0)

    ti = data.get("tool_input") or {}
    target = ti.get("file_path") or ""
    if not target or not os.path.isabs(target) or VENDOR_RE.search(target):
        sys.exit(0)
    if os.path.splitext(target)[1] not in SUFFIX or not os.path.isfile(target):
        sys.exit(0)
    if not os.path.isfile(CHECKER):
        sys.exit(0)

    try:
        now = open(target, errors="replace").read()
        before = original_text(data, now)
        if before is None:
            sys.exit(0)
        found = new_findings(target, now, before)
    except Exception:
        sys.exit(0)
    if not found:
        sys.exit(0)

    shown = target.replace(os.path.expanduser("~"), "~")
    msg = (
        "This edit wrote comments over CLAUDE.md's limits in %s — one sentence, at most "
        "20 words, never more than two lines, docstrings included:\n\n%s\n\n"
        "Rewrite them before moving on. Keep the non-obvious reason and drop what restates "
        "the code; longer rationale belongs in the module docstring, documentation, or the "
        "PR description. Only comments this edit created or changed are listed."
        % (shown, "\n".join("  - %s at line %d" % f for f in found))
    )
    json.dump({"hookSpecificOutput": {
        "hookEventName": "PostToolUse", "additionalContext": msg}}, sys.stdout)
    sys.exit(0)


main()
