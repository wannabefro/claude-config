#!/usr/bin/env python3
"""Measure how often a Codex or council review accompanies a push.

Counts only real tool_use invocations. Matching raw line text would hit the rules
files quoted into every prompt, so every session would look reviewed.

The review-before-push rate alone is not a verdict, because the rules gate
cross-family review on guardrail surfaces and code, never on a docs or config
push. So sessions are split by whether they edited code at all.

Usage: python3 ~/.claude/scripts/codex-review-audit.py
"""
import json
import pathlib
from collections import Counter, defaultdict

ROOT = pathlib.Path.home() / ".claude" / "projects"
CODE_SUFFIX = (
    ".py", ".go", ".ts", ".tsx", ".js", ".jsx", ".swift", ".rs", ".java",
    ".kt", ".rb", ".sql", ".sh",
)
DOC_SUFFIX = (".md", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".txt")


def day_of(rec):
    ts = rec.get("timestamp") or ""
    return ts[:10] if len(ts) >= 10 else None


def scan(path):
    codex = council = push = 0
    code_edits = doc_edits = 0
    days = []
    with path.open(errors="replace") as fh:
        for line in fh:
            if '"tool_use"' not in line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            content = (rec.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            d = day_of(rec)
            for b in content:
                if not isinstance(b, dict) or b.get("type") != "tool_use":
                    continue
                name = b.get("name")
                inp = b.get("input") or {}
                if name == "Bash":
                    cmd = inp.get("command") or ""
                    if "git push" in cmd:
                        push += 1
                    if "codex-run.sh" in cmd or "codex exec" in cmd:
                        codex += 1
                        if d:
                            days.append(d)
                elif name == "Agent":
                    st = inp.get("subagent_type") or ""
                    if st == "codex:codex-rescue":
                        codex += 1
                        if d:
                            days.append(d)
                    elif st.startswith("council"):
                        council += 1
                elif name == "Skill":
                    sk = (inp.get("skill") or "").lower()
                    if "codex" in sk:
                        codex += 1
                        if d:
                            days.append(d)
                    if "council" in sk:
                        council += 1
                elif name in ("Edit", "Write", "MultiEdit"):
                    fp = (inp.get("file_path") or "").lower()
                    if fp.endswith(CODE_SUFFIX):
                        code_edits += 1
                    elif fp.endswith(DOC_SUFFIX):
                        doc_edits += 1
    return codex, council, push, code_edits, doc_edits, days


by_day = Counter()
rows = []
for f in sorted(ROOT.rglob("*.jsonl")):
    cx, cl, ps, ce, de, days = scan(f)
    for d in days:
        by_day[d] += 1
    if ps or cx or cl:
        rows.append((f.stat().st_mtime, cx, cl, ps, ce, de))

print("=== codex calls by day ===")
for d in sorted(by_day):
    print(f"  {d}  {'#' * min(by_day[d], 40)} {by_day[d]}")

print()
print("=== sessions that pushed, split by whether they edited code ===")
code_push = code_push_reviewed = doc_push = doc_push_reviewed = 0
for _, cx, cl, ps, ce, de in rows:
    if not ps:
        continue
    reviewed = (cx + cl) > 0
    if ce > 0:
        code_push += 1
        code_push_reviewed += reviewed
    else:
        doc_push += 1
        doc_push_reviewed += reviewed

print(f"  code-editing sessions that pushed: {code_push}")
print(f"    ...with a codex/council review:  {code_push_reviewed}")
if code_push:
    print(f"    rate: {100.0 * code_push_reviewed / code_push:.1f}%")
print(f"  docs/config-only sessions pushed:  {doc_push}")
print(f"    ...with a review (not required): {doc_push_reviewed}")
