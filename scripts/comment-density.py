#!/usr/bin/env python3
"""Structural comment checks: density, block length, comment word count.

Only structural counts, deliberately. `rules/principles.md` says structure is
measurable and quality is not, so this never judges whether a comment is good.

  python3 comment-density.py hooks/ scripts/
  python3 comment-density.py --staged [REPO]
  python3 comment-density.py --max-density 15 FILE...
  python3 comment-density.py --self-test

Exit 1 if any file breaks a limit, so it can gate a commit.

Known ceiling: it reads lines, it does not parse. A comment inside a string
literal counts as a comment, so a file that holds test fixtures over-reports.
Write `comment-density: ignore-file` in such a file, as this one does, and grep
that marker to audit every exemption.

A leading file header is exempt from the block and word limits, because shell has
no docstring and the header is where usage belongs. Python and JS docstrings never
counted anyway. Linter directives are excluded.

comment-density: ignore-file — this file holds comment fixtures inside strings.
"""
import argparse, pathlib, re, subprocess, sys

SUFFIX = {".py", ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".tsx",
          ".swift", ".go", ".rs", ".java", ".kt", ".rb", ".yaml", ".yml"}
SKIP_PART = {"node_modules", "__pycache__", ".git", "dist", "build", "target",
             "coverage", "vendor", "plugins", ".venv"}
MARKER = re.compile(r"^\s*(#|//|/\*|\*/|\*(?!\w))")
SHEBANG = re.compile(r"^#!")
DIRECTIVE = re.compile(
    r"^\s*(#|//)\s*("
    r"type:\s*ignore|noqa|pylint|pyright|mypy|eslint|prettier|ts-|@ts-|shellcheck|"
    r"ruff|fmt:|nosec|coding[:=]|-\*-|!\[|region|endregion|SPDX|\?xml)")
WORDS = re.compile(r"[A-Za-z][A-Za-z'-]*")
OPT_OUT = re.compile(r"comment-density:\s*ignore-file")

MAX_DENSITY = 15.0
MAX_BLOCK = 2
MAX_WORDS = 20


def strip_marker(line):
    return re.sub(r"^\s*(#+|//+|/\*+|\*/|\*)", "", line).strip()


def header_end(text):
    """Last line of the leading header block, the shell analogue of a docstring."""
    end = 0
    for lineno, line in enumerate(text.split("\n"), 1):
        if not line.strip() or SHEBANG.match(line):
            continue
        if MARKER.match(line):
            end = lineno
            continue
        break
    return end


def scan(text):
    if OPT_OUT.search(text):
        return {"comment_lines": 0, "code_lines": 0, "density": 0.0,
                "blocks": [], "verbose": [], "ignored": True}
    head = header_end(text)
    density_c = density_k = 0
    run = 0
    blocks, verbose = [], []
    pending = []
    for lineno, line in enumerate(text.split("\n"), 1):
        if not line.strip() or SHEBANG.match(line):
            continue
        if MARKER.match(line):
            if DIRECTIVE.match(line):
                continue
            density_c += 1
            run += 1
            pending.append((lineno, strip_marker(line)))
            continue
        density_k += 1
        if run > MAX_BLOCK and pending[0][0] > head:
            blocks.append((pending[0][0], run))
        run, pending = 0, []
    if run > MAX_BLOCK and pending and pending[0][0] > head:
        blocks.append((pending[0][0], run))

    run = 0
    group = []
    for lineno, line in enumerate(text.split("\n"), 1):
        is_c = bool(MARKER.match(line)) and not SHEBANG.match(line) and not DIRECTIVE.match(line)
        if is_c:
            group.append((lineno, strip_marker(line)))
            continue
        if group:
            n = len(WORDS.findall(" ".join(t for _, t in group)))
            if n > MAX_WORDS and group[0][0] > head:
                verbose.append((group[0][0], n))
            group = []
    if group:
        n = len(WORDS.findall(" ".join(t for _, t in group)))
        if n > MAX_WORDS and group[0][0] > head:
            verbose.append((group[0][0], n))

    total = density_c + density_k
    return {
        "comment_lines": density_c,
        "code_lines": density_k,
        "density": round(100.0 * density_c / total, 1) if total else 0.0,
        "blocks": blocks,
        "verbose": verbose,
    }


def files_from(paths):
    # A named file must pass SUFFIX too. Markdown headings match MARKER as `#` comments,
    # which scored CLAUDE.md at 30.6% and flagged three prose files in one day.
    out, skipped = [], []
    for raw in paths:
        p = pathlib.Path(raw)
        if p.is_dir():
            out += [q for q in sorted(p.rglob("*"))
                    if q.is_file() and q.suffix in SUFFIX
                    and not SKIP_PART & set(q.parts)]
        elif p.is_file():
            (out if p.suffix in SUFFIX else skipped).append(p)
    return out, skipped


def staged_added(repo):
    names = subprocess.run(["git", "-C", repo, "diff", "--cached", "--name-only"],
                           capture_output=True, text=True).stdout.split()
    out = {}
    for name in names:
        if pathlib.Path(name).suffix not in SUFFIX:
            continue
        if SKIP_PART & set(pathlib.Path(name).parts):
            continue
        diff = subprocess.run(
            ["git", "-C", repo, "diff", "--cached", "--unified=0", "--", name],
            capture_output=True, text=True).stdout
        added, saw = [], False
        for line in diff.split("\n"):
            if line.startswith("@@"):
                if saw:
                    added.append("__hunk_break__")
                continue
            if line.startswith("+") and not line.startswith("+++"):
                added.append(line[1:])
                saw = True
        if [l for l in added if l != "__hunk_break__"]:
            out[name] = "\n".join(added)
    return out


def report(named, max_density):
    bad = 0
    print(f"{'density':>8} {'cmt':>5} {'code':>5} {'blk':>4} {'long':>5}  file")
    for name, text in named:
        r = scan(text)
        sizeable = r["comment_lines"] + r["code_lines"] >= 10
        flag = ((r["density"] > max_density and sizeable) or r["blocks"] or r["verbose"])
        if not flag and not sizeable:
            continue
        bad += bool(flag)
        print(f"{r['density']:7.1f}% {r['comment_lines']:5d} {r['code_lines']:5d} "
              f"{len(r['blocks']):4d} {len(r['verbose']):5d}  {'! ' if flag else '  '}{name}")
        for line, n in r["blocks"]:
            print(f"{'':24}block of {n} comment lines at {name}:{line} (max {MAX_BLOCK})")
        for line, n in r["verbose"]:
            print(f"{'':24}comment of {n} words at {name}:{line} (max {MAX_WORDS})")
    return bad


DIRTY = '''#!/bin/sh
setup() { :; }
# This helper exists because the upstream API returns a 500 when the payload is
# empty, which we discovered while debugging the incident on Tuesday, and the
# retry wrapper below is the agreed workaround per the discussion in PR 412.
# See also the ticket for the full mechanism explanation.
run() {
  # call the thing
  curl -s "$1"
}
'''

CLEAN = '''#!/bin/sh
run() {
  curl -s "$1"
}
'''


SCATTERED = "\n".join(["# one", "__hunk_break__"] * 4)

HEADERED = '''#!/bin/sh
# tool - one line summary of what this does
#
#   tool --flag FILE
#
# Exit 1 when the check fails, so it can gate a commit.
run() {
  curl -s "$1"
}
'''


def self_test():
    d = scan(DIRTY)
    assert len(d["blocks"]) == 1, d
    assert d["blocks"][0][1] == 4, d
    assert len(d["verbose"]) == 1, d
    assert d["density"] > 50, d
    c = scan(CLEAN)
    assert c["blocks"] == [] and c["verbose"] == [] and c["density"] == 0.0, c
    s = scan(SCATTERED)
    assert s["blocks"] == [], f"hunk breaks must split runs: {s}"
    assert s["comment_lines"] == 4, s
    h = scan(HEADERED)
    assert h["blocks"] == [], f"a file header is exempt, like a docstring: {h}"
    assert h["verbose"] == [], h
    assert h["comment_lines"] == 5, h
    print(f"self-test OK: dirty {d['density']}% with 1 block of 4 and 1 long comment; "
          f"clean 0.0%; 4 scattered comments give {len(s['blocks'])} blocks; "
          f"a 5-line header gives {len(h['blocks'])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--staged", nargs="?", const=".", default=None)
    ap.add_argument("--max-density", type=float, default=MAX_DENSITY)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        self_test()
        return 0
    if a.staged is not None:
        named = sorted(staged_added(a.staged).items())
        if not named:
            print("no staged lines in a checked language")
            return 0
    elif a.paths:
        keep, skipped = files_from(a.paths)
        for p in skipped:
            print(f"skipped {p} — not a checked language ({p.suffix or 'no suffix'})")
        named = [(str(p), p.read_text(errors="ignore")) for p in keep]
        if not named:
            return 0
    else:
        ap.print_help()
        return 2

    bad = report(named, a.max_density)
    print(f"\n{bad} file(s) over a limit "
          f"(density {a.max_density}%, block {MAX_BLOCK} lines, comment {MAX_WORDS} words)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
