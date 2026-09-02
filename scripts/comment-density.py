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
DOCSTRING = re.compile(r"""^(\s*)(?:[rubfRUBF]{0,2})(\"\"\"|''')""")
SECTION = re.compile(
    r"^(Args|Arguments|Attributes|Example|Examples|Note|Notes|Parameters|Raises|"
    r"Returns|See Also|Todo|Warning|Warnings|Warns|Yields)\s*:$")

MAX_DENSITY = 15.0
MAX_BLOCK = 2
MAX_WORDS = 20


def strip_marker(line):
    return re.sub(r"^\s*(#+|//+|/\*+|\*/|\*)", "", line).strip()


def expand_docstrings(text):
    """Rewrite docstring lines as comment lines so one rule governs both forms."""
    lines = text.split("\n")
    out = list(lines)

    def emit(indent, content):
        return f"{indent}# {content.strip()}" if content.strip() else ""

    i = 0
    while i < len(lines):
        m = DOCSTRING.match(lines[i])
        if not m:
            i += 1
            continue
        indent, quote = m.group(1), m.group(2)
        rest = lines[i][m.end():]
        if quote in rest:
            out[i] = emit(indent, rest[:rest.index(quote)])
            i += 1
            continue
        end = next((j for j in range(i + 1, len(lines)) if quote in lines[j]), None)
        if end is None:
            i += 1
            continue
        out[i] = emit(indent, rest)
        for j in range(i + 1, end):
            out[j] = emit(indent, lines[j])
        out[end] = emit(indent, lines[end][:lines[end].index(quote)])
        i = end + 1
    return "\n".join(out)


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


def section_lines(text):
    """Lines inside a Google-style docstring section, exempt from block and word limits."""
    out, in_section = set(), False
    for lineno, line in enumerate(text.split("\n"), 1):
        if not line.strip() or not MARKER.match(line):
            in_section = False
            continue
        if SECTION.match(strip_marker(line)):
            in_section = True
        if in_section:
            out.add(lineno)
    return out


def scan(text):
    if OPT_OUT.search(text):
        return {"comment_lines": 0, "code_lines": 0, "density": 0.0,
                "blocks": [], "verbose": [], "ignored": True}
    text = expand_docstrings(text)
    head = header_end(text)
    sect = section_lines(text)
    density_c = density_k = 0
    run = 0
    blocks, verbose = [], []
    pending = []
    for lineno, line in enumerate(text.split("\n"), 1):
        if SHEBANG.match(line):
            continue
        if MARKER.match(line):
            if DIRECTIVE.match(line):
                continue
            if lineno not in sect:
                density_c += 1
                run += 1
                pending.append((lineno, strip_marker(line)))
                continue
        elif line.strip():
            density_k += 1
        # A blank line, a code line, and a section line all end the run.
        if run > MAX_BLOCK and pending[0][0] > head:
            blocks.append((pending[0][0], run))
        run, pending = 0, []
    if run > MAX_BLOCK and pending and pending[0][0] > head:
        blocks.append((pending[0][0], run))

    run = 0
    group = []
    for lineno, line in enumerate(text.split("\n"), 1):
        is_c = (bool(MARKER.match(line)) and not SHEBANG.match(line)
                and not DIRECTIVE.match(line) and lineno not in sect)
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
        # The marker sits in the whole file, so a diff fragment never carries it.
        staged = subprocess.run(["git", "-C", repo, "show", f":{name}"],
                                capture_output=True, text=True).stdout
        if OPT_OUT.search(staged):
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


DOCSTRINGED = '''#!/usr/bin/env python3
"""tool - one line summary.

A module docstring is the file header, so it is exempt like a header comment.
"""
import os


def widget(a):
    """Summary line.
    This rationale runs past two lines, which rule 2 calls a hard breach, and it
    is indented, so it belongs to a function rather than to the file header.
    """
    return os.path.join(a)
'''

SECTIONED = '''def widget(a, b, c):
    """Summary line.
    Second line.

    Args:
        a: the first thing that this function accepts and then uses later on
        b: the second thing that it also accepts and uses in the same manner
        c: the third thing which is likewise accepted and used identically

    Returns:
        The combined thing that the caller receives once the work has finished.
    """
    return a
'''

AFTER_SECTION = '''def widget(a):
    """Summary.

    Args:
        a: a thing

    This trailing rationale runs to three contiguous lines and must still be
    reported, because the section ended at the blank line above it, and an
    exemption that never ends would hide exactly this kind of breach.
    """
    return a
'''

ASSIGNED = '''x = """
not a docstring, just a literal
"""
'''


def self_test():
    g = scan(DOCSTRINGED)
    assert len(g["blocks"]) == 1, f"only the function docstring is a block: {g}"
    assert g["blocks"][0][0] > 5, f"the module docstring must stay exempt: {g}"
    assert g["comment_lines"] > 0, f"docstrings count as comments: {g}"
    s = scan(SECTIONED)
    assert s["blocks"] == [], f"a Google-style section is exempt like the header: {s}"
    assert s["verbose"] == [], f"a section is exempt from the word limit too: {s}"
    assert s["comment_lines"] == 2, f"section lines count as neither comment nor code: {s}"
    a = scan(AFTER_SECTION)
    assert len(a["blocks"]) == 1, f"a blank line ends the section, so prose after it is gated: {a}"
    split = scan('def f():\n    """A.\n    B.\n\n    C.\n    D.\n    """\n    return 1\n')
    assert split["blocks"] == [], f"a blank line ends a block, so these are two runs: {split}"
    joined = scan('def f():\n    """A.\n    B.\n    C.\n    """\n    return 1\n')
    assert len(joined["blocks"]) == 1, f"three contiguous lines are still a breach: {joined}"
    one = scan('def f():\n    """Summary."""\n    return 1\n')
    assert one["comment_lines"] == 1, f"a one-line docstring is one comment: {one}"
    assert one["code_lines"] == 2, f"it must not swallow the code below it: {one}"
    blank = scan('def f():\n    """A.\n\n    B.\n    """\n    return 1\n')
    assert blank["comment_lines"] == 2, f"a blank line and a bare closer are not comments: {blank}"
    tail = scan('def f():\n    """A.\n\n    Trailing text."""\n    return 1\n')
    assert tail["comment_lines"] == 2, f"text on the closing line still counts: {tail}"
    a = scan(ASSIGNED)
    assert a["comment_lines"] == 0, f"an assigned literal is not a docstring: {a}"
    u = scan('def f():\n    """unterminated in a diff fragment\n')
    assert u["comment_lines"] == 0, f"an unterminated docstring is left alone: {u}"
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
