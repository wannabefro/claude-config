#!/usr/bin/env python3
"""Which skills actually get invoked?

Counts real invocations, not name mentions -- a skill named in prose or in
another skill's routing table is not a use. Two signals count:

  * Skill tool calls        -> tool_use block, name == "Skill", input.skill
  * slash-command expansion -> <command-name>/foo</command-name> in user text

Both are recorded regardless of who invoked them (main thread or subagent).
Also reports each skill's age, because a skill added last week with 0 uses is
untested, not unused -- those are the two things a raw count conflates.
"""
import json, pathlib, re, subprocess, sys, collections, datetime

ROOT = pathlib.Path.home() / ".claude"
CMD_RE = re.compile(r"<command-name>/?([a-zA-Z0-9:_-]+)</command-name>")

def installed():
    """name -> (kind, path). User skills and commands; plugin skills separately."""
    out = {}
    for p in (ROOT / "skills").glob("*/SKILL.md"):
        out[p.parent.name] = ("skill", p)
    for p in (ROOT / "commands").glob("*.md"):
        out.setdefault(p.stem, ("command", p))
    return out

def first_commit(path):
    try:
        r = subprocess.run(["git", "-C", str(ROOT), "log", "--diff-filter=A",
                            "--format=%at", "--", str(path.relative_to(ROOT))],
                           capture_output=True, text=True, timeout=20)
        ts = [int(x) for x in r.stdout.split()]
        return min(ts) if ts else None
    except Exception:
        return None

def scan():
    counts = collections.Counter()
    for f in (ROOT / "projects").rglob("*.jsonl"):
        try:
            with f.open(encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if "Skill" not in line and "command-name" not in line:
                        continue
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    msg = d.get("message") or {}
                    for b in (msg.get("content") or []) if isinstance(msg.get("content"), list) else []:
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") == "tool_use" and b.get("name") == "Skill":
                            s = (b.get("input") or {}).get("skill")
                            if s:
                                counts[s.split(":")[-1]] += 1
                        elif b.get("type") == "text":
                            for m in CMD_RE.findall(b.get("text") or ""):
                                counts[m.split(":")[-1]] += 1
        except Exception:
            continue
    return counts

counts = scan()
inst = installed()
now = datetime.datetime.now().timestamp()

rows = []
for name, (kind, path) in sorted(inst.items()):
    ts = first_commit(path)
    age = int((now - ts) / 86400) if ts else None
    rows.append((counts.get(name, 0), name, kind, age))
rows.sort()

print(f"{'uses':>5}  {'age/d':>5}  {'kind':<8} name")
print("-" * 46)
for n, name, kind, age in rows:
    flag = ""
    if n == 0 and age is not None and age < 14:
        flag = "  <- new, untested not unused"
    elif n == 0:
        flag = "  <- candidate"
    print(f"{n:>5}  {('?' if age is None else age):>5}  {kind:<8} {name}{flag}")

used_not_installed = {k: v for k, v in counts.items() if k not in inst and v >= 3}
if used_not_installed:
    print("\ninvoked but not a local skill/command (plugin or builtin):")
    for k, v in sorted(used_not_installed.items(), key=lambda x: -x[1])[:15]:
        print(f"{v:>5}  {k}")
