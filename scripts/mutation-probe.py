#!/usr/bin/env python3
"""Measure whether a test suite guards its business rules, by breaking them.

`rules/principles.md` says: "A test that still passes after the business rule it
guards changes is the wrong test." That is a mutation test, and it is the only
honest instrument for the question — regexes over assertion names cannot tell a
precise `.toBe(true)` from a vacuous one. Measured 2026-07-28: a regex classifier
flagged 22% of one suite as low-value, and 3 of 3 hand-checked flags were wrong.

Each mutant changes ONE rule in ONE source file, then runs the suite:

  killed   — the suite failed. A test guards that rule.
  SURVIVED — the suite still passed. Nothing guards that rule.

Survivors are the finding. A high survival rate means the tests describe what the
code does rather than what it must do.

Run it in an isolated worktree, never the live checkout:

    R=~/dev/<repo>; W=/tmp/mut-<repo>
    git -C $R worktree add --detach $W HEAD
    ln -s $R/node_modules $W/node_modules      # a worktree has no ignored paths
    python3 ~/.claude/scripts/mutation-probe.py $W --test-cmd "npx vitest run"

The symlink matters: a fresh worktree checks out tracked files only, so without it
every run fails for a reason unrelated to the mutant.
"""
import argparse
import os
import random
import re
import subprocess
import sys

# Each operator changes a decision the code makes, not merely a character. A
# mutant that only reformats proves nothing when it survives.
# Comparison operators require a space on BOTH sides. Without that guard they
# match JSX — `</p>` becomes `<=/p>`, which is a syntax error, not a changed
# rule. Measured 2026-07-28: 23 of 40 mutants in the first run were JSX bracket
# edits in files no test imported, so they "survived" while proving nothing.
OPERATORS = [
    (r'(?<= )>=(?= )', '>',  'loosen  >= to >'),
    (r'(?<= )<=(?= )', '<',  'loosen  <= to <'),
    (r'(?<= )>(?= )',  '>=', 'tighten >  to >='),
    (r'(?<= )<(?= )',  '<=', 'tighten <  to <='),
    (r'===', '!==', 'invert  === to !=='),
    (r'!==', '===', 'invert  !== to ==='),
    (r'(?<= )&&(?= )', '||', 'weaken  && to ||'),
    (r'(?<= )\|\|(?= )', '&&', 'strengthen || to &&'),
    (r'\breturn true\b',  'return false', 'flip return true'),
    (r'\breturn false\b', 'return true',  'flip return false'),
]

# A line holding a JSX tag is markup, and a bracket in it is not a comparison.
JSX_LINE = re.compile(r'</?[A-Za-z][\w.]*[\s/>]|/>')

SKIP_DIR = re.compile(r'node_modules|/dist/|/build/|\.next|/coverage/|/\.git/|/worktrees/')
IS_TEST = re.compile(r'\.(test|spec)\.[jt]sx?$|__tests__|/e2e/')
IS_SRC = re.compile(r'\.[jt]sx?$')
# A line that is only a comment, an import, or a type carries no business rule.
DEAD_LINE = re.compile(r'^\s*(//|/\*|\*|import\b|export type\b|export interface\b|type\s+\w+\s*=)')


def sources(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        if SKIP_DIR.search(dirpath + '/'):
            dirnames[:] = []
            continue
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            if IS_SRC.search(fn) and not IS_TEST.search(p):
                out.append(p)
    return sorted(out)


def candidates(path):
    try:
        lines = open(path, encoding='utf8', errors='ignore').read().split('\n')
    except Exception:
        return []
    found = []
    for i, line in enumerate(lines):
        if DEAD_LINE.match(line) or not line.strip() or JSX_LINE.search(line):
            continue
        for pat, rep, label in OPERATORS:
            for m in re.finditer(pat, line):
                found.append((i, m.start(), m.end(), rep, label))
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('--test-cmd', required=True)
    # The directory to mutate is often not the directory the runner must start
    # from: jest and vitest resolve their config from the package root, while the
    # code worth mutating lives in src/. Conflating the two either mutates the
    # config or breaks the runner.
    ap.add_argument('--cwd', default=None, help='where to run --test-cmd (default: root)')
    ap.add_argument('--n', type=int, default=40, help='number of mutants')
    ap.add_argument('--tested-only', action='store_true',
                    help='mutate only files that have a matching test file. Without this, a '
                         'survivor may just mean the file has no tests at all — a real finding, '
                         'but a different one from a test that fails to guard its rule.')
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--timeout', type=int, default=300)
    a = ap.parse_args()

    random.seed(a.seed)
    all_src = sources(a.root)
    if a.tested_only:
        tested = set()
        for dirpath, dirnames, filenames in os.walk(a.root):
            if SKIP_DIR.search(dirpath + '/'):
                dirnames[:] = []
                continue
            for fn in filenames:
                m = re.match(r'(.+?)\.(test|spec)\.[jt]sx?$', fn)
                if m:
                    tested.add(m.group(1))
        before_n = len(all_src)
        all_src = [f for f in all_src
                   if re.sub(r'\.[jt]sx?$', '', os.path.basename(f)) in tested]
        print(f'{len(all_src)} of {before_n} source files have a matching test file')
    pool = []
    for f in all_src:
        for c in candidates(f):
            pool.append((f, c))
    if not pool:
        print('no mutable source found', file=sys.stderr)
        return 1
    print(f'{len(pool)} mutable sites across {len(set(p[0] for p in pool))} files; sampling {a.n}')

    # Baseline must be green, or every mutant reads as killed and the run is a lie.
    run_dir = a.cwd or a.root
    base = subprocess.run(a.test_cmd, shell=True, cwd=run_dir, capture_output=True,
                          text=True, timeout=a.timeout)
    if base.returncode != 0:
        print('BASELINE IS RED — fix that first; every mutant would look killed.', file=sys.stderr)
        print((base.stdout + base.stderr)[-1500:], file=sys.stderr)
        return 2
    print('baseline green\n')

    survived, killed = [], 0
    for n, (path, (line_i, s, e, rep, label)) in enumerate(random.sample(pool, min(a.n, len(pool))), 1):
        original = open(path, encoding='utf8', errors='ignore').read()
        lines = original.split('\n')
        before = lines[line_i]
        lines[line_i] = before[:s] + rep + before[e:]
        open(path, 'w', encoding='utf8').write('\n'.join(lines))
        try:
            r = subprocess.run(a.test_cmd, shell=True, cwd=run_dir, capture_output=True,
                               text=True, timeout=a.timeout)
            ok = r.returncode == 0
        except subprocess.TimeoutExpired:
            ok = False          # a hang is a kill: the mutant changed behaviour
        finally:
            open(path, 'w', encoding='utf8').write(original)

        rel = os.path.relpath(path, a.root)
        if ok:
            survived.append((rel, line_i + 1, label, before.strip()[:90]))
            print(f'  {n:>3}. SURVIVED  {rel}:{line_i+1}  [{label}]')
        else:
            killed += 1
            print(f'  {n:>3}. killed    {rel}:{line_i+1}  [{label}]')

    tot = killed + len(survived)
    print(f'\n  score: {killed}/{tot} killed ({killed*100//tot}%), {len(survived)} survived')
    if survived:
        print('\n  Survivors — each is a rule the suite does not guard:')
        for rel, ln, label, src in survived:
            print(f'    {rel}:{ln}  [{label}]\n        {src}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
