#!/usr/bin/env python3
"""Structural facts about how tests are written — counts and ratios only.

Run it to check the house style has not drifted. The baseline it produced on
2026-07-28 across six repos is recorded in rules/principles.md; a column that
moves far from those numbers needs a reason.

    python3 ~/.claude/scripts/test-style-baseline.py ~/dev/repo-a ~/dev/repo-b

NO METRIC HERE IS A QUALITY VERDICT, and that is deliberate. Three regex passes
tried to judge test quality from text on 2026-07-28 and all three were wrong.
`named_rule_pct` is retained only as a demonstration of the trap: it scored the
repo with the best-written names lowest, because it matched a vocabulary rather
than a meaning. Read it as "which verbs this repo favours", never as a score.
Use scripts/mutation-probe.py for anything evaluative."""
import os, re, sys, statistics, collections

EX = re.compile(r'node_modules|/dist/|/build/|\.next|/coverage/|/\.git/|worktrees')
IS_TEST = re.compile(r'\.(test|spec)\.[jt]sx?$')
TESTCASE = re.compile(r'^(\s*)(?:it|test)(?:\.\w+)?\s*\(\s*[`\'"]([^`\'"]*)', re.M)
ASSERT = re.compile(r'\bexpect\(|\bassert\w*\(')
MODMOCK = re.compile(r'^\s*(?:vi|jest)\.mock\(', re.M)
SPY = re.compile(r'\b(?:vi|jest)\.(?:fn|spyOn)\(')
HOOK = re.compile(r'^\s*(before|after)(Each|All)\s*\(', re.M)
TIMERS = re.compile(r'useFakeTimers|advanceTimersBy')
# A name that states a condition and an outcome, vs a bare label.
NAMED_RULE = re.compile(r'\b(when|if|unless|after|before|given|on|never|always|only|'
                        r'returns|throws|rejects|refuses|rejects|keeps|leaves|does not|'
                        r'must|should not|falls back|clamps|preserves|ignores)\b', re.I)

def walk(root):
    for dp, dn, fn in os.walk(root):
        if EX.search(dp + '/'):
            dn[:] = []
            continue
        for f in fn:
            if IS_TEST.search(f):
                yield os.path.join(dp, f)

def analyse(root):
    files = list(walk(root))
    if not files: return None
    per_file_tests, test_lens, asserts, names = [], [], [], []
    modmocks = spies = hooks = timers = 0
    nfiles = 0
    for p in files:
        try: src = open(p, encoding='utf8', errors='ignore').read()
        except Exception: continue
        nfiles += 1
        ms = list(TESTCASE.finditer(src))
        per_file_tests.append(len(ms))
        modmocks += len(MODMOCK.findall(src))
        spies += len(SPY.findall(src))
        hooks += len(HOOK.findall(src))
        timers += 1 if TIMERS.search(src) else 0
        for i, m in enumerate(ms):
            end = ms[i+1].start() if i+1 < len(ms) else len(src)
            body = src[m.end():end]
            test_lens.append(body.count('\n'))
            asserts.append(len(ASSERT.findall(body)))
            names.append(m.group(2))
    tests = sum(per_file_tests)
    if not tests: return None
    med = statistics.median
    return dict(
        files=nfiles, tests=tests,
        tests_per_file=round(tests/nfiles, 1),
        median_lines=int(med(test_lens)) if test_lens else 0,
        p90_lines=int(sorted(test_lens)[int(len(test_lens)*.9)]) if test_lens else 0,
        median_asserts=int(med(asserts)) if asserts else 0,
        zero_assert_pct=round(100*sum(1 for a in asserts if a == 0)/len(asserts)) if asserts else 0,
        modmocks_per_file=round(modmocks/nfiles, 2),
        spies_per_test=round(spies/tests, 2),
        hooks_per_file=round(hooks/nfiles, 2),
        faketimer_file_pct=round(100*timers/nfiles),
        named_rule_pct=round(100*sum(1 for n in names if NAMED_RULE.search(n))/len(names)),
        median_name_words=int(med([len(n.split()) for n in names])),
    )

rows = []
for root in sys.argv[1:]:
    r = analyse(root)
    if r: rows.append((os.path.basename(root.rstrip('/')), r))

cols = ['files','tests','tests_per_file','median_lines','p90_lines','median_asserts',
        'zero_assert_pct','modmocks_per_file','spies_per_test','hooks_per_file',
        'faketimer_file_pct','named_rule_pct','median_name_words']
w = max(len(c) for c in cols) + 1
print(f"{'metric':<{w}}" + ''.join(f'{n[:13]:>15}' for n, _ in rows))
for c in cols:
    print(f'{c:<{w}}' + ''.join(f'{r[c]:>15}' for _, r in rows))
