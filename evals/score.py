"""Mechanical scoring against the style contract. Deterministic, no LLM judge --
every check is something you can re-run and get the same answer."""
import json, pathlib, re

D = pathlib.Path(__file__).parent
cases = {c["id"]: c for c in (json.loads(l) for l in (D/"cases.jsonl").read_text().splitlines() if l.strip())}

OPENERS = re.compile(r'^\s*(Great question|Let me\b|I\'ll now|Sure[!,]|Looking at your|To answer)', re.I)
CLOSERS = re.compile(r'(hope (this|that) helps|let me know if|feel free to|anything else\?|happy to (clarify|help))', re.I)
BLOCK   = re.compile(r'^\s*DONE\b', re.M)

def slots(t):
    out = {}
    for k in ("DONE", "NEXT", "YOU"):
        m = re.search(rf'^\s*{k}\s+(.+)$', t, re.M)
        out[k] = m.group(1).strip() if m else None
    return out

def paras_before_block(t):
    m = BLOCK.search(t)
    head = t[:m.start()] if m else t
    head = re.sub(r'```.*?```', '', head, flags=re.S)
    return len([p for p in head.split("\n\n") if p.strip()])

rows = []
for cid, c in cases.items():
    for cond in ("baseline", "candidate"):
        t = (D/"out"/f"{cid}.{cond}.txt").read_text()
        s = slots(t)
        has_block = bool(s["DONE"])
        you = (s["YOU"] or "").lower()
        you_empty = you in ("", "nothing", "nothing.", "none", "—", "-")
        # contract expectation per case
        exp = c["expect_you"]
        if cid == "explain":
            you_ok = True   # break-glass rule 1: explain runs long, block optional
        elif exp == "empty":
            you_ok = (not has_block) or you_empty
        else:
            you_ok = has_block and bool(you) and not you_empty
        rows.append(dict(case=cid, cond=cond, words=len(t.split()),
                         block=has_block, you=s["YOU"], you_ok=you_ok,
                         paras=paras_before_block(t),
                         opener=bool(OPENERS.search(t)), closer=bool(CLOSERS.search(t))))

w = "{:<9} {:<10} {:>5} {:>6} {:>6} {:>7} {:>7} {:>7}"
print(w.format("case","cond","words","block","paras","YOU ok","opener","closer"))
print("-"*62)
for r in rows:
    print(w.format(r["case"], r["cond"], r["words"],
                   "yes" if r["block"] else "no",
                   r["paras"], "ok" if r["you_ok"] else "FAIL",
                   "BAD" if r["opener"] else "-", "BAD" if r["closer"] else "-"))

print("\nYOU slot contents (the thing that was 0/12 before):")
for r in rows:
    if r["cond"] == "candidate":
        print(f"  {r['case']:<9} {r['you']!r}")

# Split reports from explanations: 'explain' is ~80% of all words and is SUPPOSED to
# run long, so a pooled word count hides whether reports actually got terser.
print("\nwords, report-shaped cases only (explain excluded — it should stay long):")
tb = tc = 0
for cid in [k for k in cases if k != "explain"]:
    bw = len((D/"out"/f"{cid}.baseline.txt").read_text().split())
    cw = len((D/"out"/f"{cid}.candidate.txt").read_text().split())
    tb += bw; tc += cw
    print(f"  {cid:<10}{bw:>6}{cw:>7}{(cw-bw)/bw*100:>7.0f}%")
print(f"  {'TOTAL':<10}{tb:>6}{tc:>7}{(tc-tb)/tb*100:>7.0f}%")

b = [r for r in rows if r["cond"]=="baseline"]
c = [r for r in rows if r["cond"]=="candidate"]
rep = lambda rs: (sum(x["words"] for x in rs), sum(x["block"] for x in rs),
                  sum(x["you_ok"] for x in rs), sum(x["opener"] or x["closer"] for x in rs))
print(f"\n{'':<12}{'words':>7}{'blocks':>8}{'YOU ok':>8}{'banned':>8}")
print(f"{'baseline':<12}{rep(b)[0]:>7}{rep(b)[1]:>8}{rep(b)[2]:>8}{rep(b)[3]:>8}")
print(f"{'candidate':<12}{rep(c)[0]:>7}{rep(c)[1]:>8}{rep(c)[2]:>8}{rep(c)[3]:>8}")
