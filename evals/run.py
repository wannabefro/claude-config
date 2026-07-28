"""Baseline (no style) vs candidate (style appended) on identical cases.

--setting-sources "" keeps CLAUDE.md and rules/ out of both arms, so this
isolates the style file rather than the whole config.
"""
import json, os, pathlib, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

D = pathlib.Path(__file__).parent
STYLE = (D.parent / "output-styles" / "lean-engineer.md").read_text()
MODEL = os.environ.get("MODEL", "opus")
(D / "out").mkdir(exist_ok=True)

cases = [json.loads(l) for l in (D / "cases.jsonl").read_text().splitlines() if l.strip()]

def run(job):
    cid, cond, prompt = job
    out = D / "out" / f"{cid}.{cond}.txt"
    if out.exists() and out.stat().st_size > 0:
        return f"cached {cid}.{cond}"
    cmd = ["claude", "--print", "--setting-sources", "", "--no-session-persistence",
           "--disallowed-tools", "*", "--model", MODEL]
    if cond == "candidate":
        cmd += ["--append-system-prompt", STYLE]
    cmd.append(prompt)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        out.write_text(r.stdout if r.stdout.strip() else f"[EMPTY rc={r.returncode}] {r.stderr[:400]}")
    except subprocess.TimeoutExpired:
        out.write_text("[TIMEOUT]")
    return f"done  {cid}.{cond} ({len(out.read_text())}b)"

jobs = [(c["id"], cond, c["prompt"]) for c in cases for cond in ("baseline", "candidate")]
with ThreadPoolExecutor(max_workers=8) as ex:
    for msg in ex.map(run, jobs):
        print(" ", msg, flush=True)
