#!/usr/bin/env python3
"""How has /build actually performed?

Reads workflow journals (the recorded return value of each agent() call) rather
than transcripts, so this measures what the runs produced, not what was said
about them. The number that matters most is the depth distribution: until
2026-07-28 every worktree branched from the same base, so anything at depth > 1
was written against a tree that never contained its dependency's work. Those
units could report green and still be unmergeable.
"""
import json, pathlib, collections, re

ROOT = pathlib.Path.home() / ".claude" / "projects"
runs = []

for j in ROOT.rglob("subagents/workflows/wf_*/journal.jsonl"):
    blob = ""
    try:
        blob = j.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    if "decomposable" not in blob and "merge_sequence" not in blob:
        continue
    repo = "?"
    for part in j.parts:
        if part.startswith("-Users-sam-dev-"):
            repo = part.replace("-Users-sam-dev-", "")
            break
    plan = None
    for line in blob.splitlines():
        try:
            d = json.loads(line)
        except Exception:
            continue
        s = json.dumps(d)
        if '"units"' in s and '"decomposable"' in s:
            # find the deepest dict carrying units
            def find(o):
                if isinstance(o, dict):
                    if "decomposable" in o and "units" in o and isinstance(o.get("units"), list):
                        return o
                    for v in o.values():
                        r = find(v)
                        if r: return r
                elif isinstance(o, list):
                    for v in o:
                        r = find(v)
                        if r: return r
                return None
            plan = find(d) or plan
    if plan:
        runs.append((j.parent.name, repo, plan, blob))

print(f"  build runs with a recorded decomposition: {len(runs)}\n")

if not runs:
    raise SystemExit(0)

hdr = "  {:<18} {:<14} {:>5} {:>5} {:>6} {:>7} {:>9}"
print(hdr.format("run", "repo", "units", "roots", "deeper", "cpath", "green"))
print("  " + "-" * 68)

tot_u = tot_root = tot_deep = 0
for run, repo, plan, blob in runs:
    units = plan.get("units") or []
    if not units:
        continue
    by = {u.get("id"): u for u in units}
    def deps(u):
        return [d for d in (u.get("depends_on") or []) if d in by]
    memo = {}
    def depth(i, seen=()):
        if i in memo: return memo[i]
        if i in seen: return 1
        ds = deps(by[i])
        v = 1 + max([depth(d, seen + (i,)) for d in ds]) if ds else 1
        memo[i] = v
        return v
    depths = [depth(u["id"]) for u in units if u.get("id")]
    roots = sum(1 for d in depths if d == 1)
    deeper = len(depths) - roots
    cpath = max(depths) if depths else 0
    m = re.search(r'"units_green"\s*:\s*(\d+)', blob)
    green = m.group(1) if m else "-"
    tot_u += len(units); tot_root += roots; tot_deep += deeper
    print(hdr.format(run[:18], repo[:14], len(units), roots, deeper, cpath, green))

print("  " + "-" * 68)
print(f"  {tot_u} units total — {tot_root} at depth 1, {tot_deep} deeper")
if tot_u:
    print(f"  {tot_deep * 100 // tot_u}% of all units were built against a tree missing their dependency's work")
