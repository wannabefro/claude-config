#!/usr/bin/env python3
"""Flags path narration in a PR body: comparisons to a revision the reader never saw.

A regex pass, not a parser. A clean run is evidence a body describes the diff,
not proof no narration survives — a phrasing this list misses reads as clean.

Usage:
  python3 pr-body-lint.py FILE.md
  cat body.md | python3 pr-body-lint.py -
  python3 pr-body-lint.py --pr 1234
  python3 pr-body-lint.py --self-test
"""
import re
import subprocess
import sys

FENCE = re.compile(r"^\s*```")
INLINE_CODE = re.compile(r"`[^`\n]*`")
WIDTH = 80

GROUPS = [
    ("comparison to an unseen revision", [
        "why this pr is smaller", "why this pr is larger", "what changed since",
        "the previous version", "an earlier version", "originally this",
        "this used to",
    ]),
    ("temporal self-reference", [
        "my first attempt", "my first approach", "i first tried", "i originally",
        "to begin with", "initially", "originally", "at first",
    ]),
    ("abandoned work", [
        "did not work out", "went nowhere", "reverted the", "dead end",
        "abandoned", "backed out", "scrapped", "discarded",
    ]),
    ("discovery narration", [
        "after some investigation", "discovered while", "noticed while",
        "it turns out", "as it happens", "after digging", "while debugging",
        "found while", "in the end", "turned out",
    ]),
    ("process sequence", ["first i", "then i", "i then", "i next"]),
]


def build_pattern(phrases):
    alts = sorted((re.escape(p).replace(r"\ ", r"\s+") for p in phrases),
                  key=len, reverse=True)
    return re.compile(r"\b(?:" + "|".join(alts) + r")\b", re.I)


COMPILED = [(name, build_pattern(phrases)) for name, phrases in GROUPS]

MERMAID_OPEN = re.compile(r"^\s*```\s*mermaid\b", re.I)
NODE_LABEL = re.compile(r'[\[\{\(]+"([^"]+)"[\]\}\)]+')
# A label naming a type or a symbol instead of a behaviour: CamelCase, snake_case, or dotted.
CODEY_LABEL = re.compile(
    r"^[A-Za-z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+$"
    r"|^[a-z0-9]+(?:_[a-z0-9]+)+$"
    r"|^\w+(?:\.\w+)+$"
)
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
JARGON_PER_SENTENCE = 3


def diagram_hits(text):
    """Mermaid node labels that name a symbol rather than say what happens."""
    hits = []
    in_mermaid = False
    for lineno, line in enumerate(text.split("\n"), 1):
        if MERMAID_OPEN.match(line):
            in_mermaid = True
            continue
        if in_mermaid and FENCE.match(line):
            in_mermaid = False
            continue
        if not in_mermaid:
            continue
        for m in NODE_LABEL.finditer(line):
            head = m.group(1).split("<br")[0].strip()
            if head and CODEY_LABEL.match(head):
                hits.append((lineno, "diagram label names a symbol, not a behaviour",
                             head, trim(line)))
    return hits


def opening_section(text):
    """The body down to the first sub-heading — what a reviewer reads before deciding."""
    out = []
    in_fence = False
    for line in text.split("\n"):
        if FENCE.match(line):
            in_fence = not in_fence
        if not in_fence and line.startswith("###"):
            break
        out.append(line)
    return "\n".join(out)


def jargon_hits(text):
    """Opening sentences that carry enough identifiers to stop reading as English."""
    hits = []
    opening = opening_section(text)
    in_fence = False
    for lineno, line in enumerate(opening.split("\n"), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or line.lstrip().startswith("|"):
            continue
        for sentence in SENTENCE_SPLIT.split(line):
            count = len(INLINE_CODE.findall(sentence))
            if count >= JARGON_PER_SENTENCE:
                hits.append((lineno, f"{count} identifiers in one opening sentence",
                             f"{count} spans", trim(sentence)))
    return hits


def readability(text):
    return diagram_hits(text) + jargon_hits(text)


def trim(line, width=WIDTH):
    line = line.strip()
    return line if len(line) <= width else line[: width - 1] + "…"


def lint(text, skip_code=True):
    """Return (lineno, group, phrase, trimmed_line) for each narration hit."""
    hits = []
    in_fence = False
    for lineno, line in enumerate(text.split("\n"), 1):
        if skip_code and FENCE.match(line):
            in_fence = not in_fence
            continue
        if skip_code and in_fence:
            continue
        scanned = INLINE_CODE.sub(lambda m: " " * len(m.group(0)), line) if skip_code else line
        for name, rx in COMPILED:
            for m in rx.finditer(scanned):
                hits.append((lineno, name, m.group(0), trim(line)))
    return hits


CLEAN_BODY = "Adds a parallel eval runner. Exits non-zero if any suite fails.\n"
HEADING_HIT = "## Why this PR is smaller than it was\n"
MULTI_HIT = "I originally tried a decorator, but it turned out to be slower.\n"
FENCE_HIT = "```\noriginally\n```\n"
INLINE_HIT = "Note: `turned out` is a variable name here.\n"


CODEY_DIAGRAM = (
    "```mermaid\nflowchart LR\n"
    '  A["app"] -->|x| L["l10n_service"]\n'
    '  L --> R{"route"}\n'
    '  R -->|POST_EDIT| PE["PostEditContext"]\n'
    "```\n"
)
PLAIN_DIAGRAM = (
    "```mermaid\nflowchart LR\n"
    '  A["the app sends a style guide"] --> L["the service clamps it"]\n'
    '  L --> R{"which route?"}\n'
    '  R -->|post-edit| PE["the guide outranks the inferred brief"]\n'
    "```\n"
)
JARGON_OPENING = "It threads `a.B` through `c.D` and clears `e.F` on the way.\n"
DEEP_JARGON = "## Description\n\nPlain opening.\n\n### Files\n\nUse `a.B`, `c.D` and `e.F` here.\n"


def readability_self_test():
    codey = diagram_hits(CODEY_DIAGRAM)
    assert len(codey) == 2, codey
    assert {h[2] for h in codey} == {"l10n_service", "PostEditContext"}, codey
    assert diagram_hits(PLAIN_DIAGRAM) == [], diagram_hits(PLAIN_DIAGRAM)
    # "app" and "route" are plain words, so a short lowercase label must never bite.
    assert all(h[2] not in {"app", "route"} for h in codey), codey
    jargon = jargon_hits(JARGON_OPENING)
    assert len(jargon) == 1, jargon
    assert jargon_hits(DEEP_JARGON) == [], jargon_hits(DEEP_JARGON)
    assert jargon_hits(CLEAN_BODY) == [], jargon_hits(CLEAN_BODY)
    assert readability(CODEY_DIAGRAM + JARGON_OPENING), "both checks must combine"
    print(f"readability self-test OK: codey diagram {len(codey)}, plain diagram 0, "
          f"opening jargon {len(jargon)}, jargon below a sub-heading 0")


def self_test():
    assert lint(CLEAN_BODY) == [], lint(CLEAN_BODY)
    heading = lint(HEADING_HIT)
    assert len(heading) >= 1 and heading[0][1] == "comparison to an unseen revision", heading
    multi = lint(MULTI_HIT)
    assert len(multi) >= 2, multi
    groups = {g for _, g, _, _ in multi}
    assert {"temporal self-reference", "discovery narration"} <= groups, groups
    assert lint(FENCE_HIT) == [], lint(FENCE_HIT)
    assert lint(INLINE_HIT) == [], lint(INLINE_HIT)
    raw_fence = lint(FENCE_HIT, skip_code=False)
    raw_inline = lint(INLINE_HIT, skip_code=False)
    assert len(raw_fence) >= 1, "fence fixture must bite once skipping is off"
    assert len(raw_inline) >= 1, "inline fixture must bite once skipping is off"
    readability_self_test()
    print(f"self-test OK: clean 0, heading {len(heading)}, multi {len(multi)} across "
          f"{sorted(groups)}; without code-skip fence gives {len(raw_fence)}, "
          f"inline gives {len(raw_inline)} (both 0 with skip on)")


REMINDER = (
    "Two things can justify keeping a note: a reviewer commented on the larger "
    "version, or the churn is visible in the pushed commits. Otherwise cut it "
    "and fix the history instead."
)


PLAIN_ENGLISH = (
    "Write the body for someone meeting the branch for the first time. Say what "
    "changes for a user and what could go wrong, in sentences. Label a diagram "
    "node with what happens there, not with the type it is; if the diagram only "
    "traces which function calls which, delete it and keep the prose."
)


def usage_error(msg):
    print(f"usage: pr-body-lint.py [--self-test | --pr N | FILE | -]\n{msg}", file=sys.stderr)
    sys.exit(64)


def fetch_pr_body(number):
    result = subprocess.run(
        ["gh", "pr", "view", str(number), "--json", "body", "--jq", ".body"],
        capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)
    return result.stdout


def read_input(argv):
    self_test_flag = "--self-test" in argv
    pr_flag = "--pr" in argv
    pr_num = None
    rest = list(argv)
    if pr_flag:
        idx = rest.index("--pr")
        if idx + 1 >= len(rest):
            usage_error("--pr needs a PR number")
        pr_num = rest[idx + 1]
        del rest[idx:idx + 2]
    if self_test_flag:
        rest.remove("--self-test")
    modes = sum([self_test_flag, pr_flag, bool(rest)])
    if modes != 1:
        usage_error("pass exactly one of --self-test, --pr N, FILE, or -")
    if self_test_flag:
        return "self-test", None
    if pr_flag:
        return "text", fetch_pr_body(pr_num)
    src = rest[0]
    text = sys.stdin.read() if src == "-" else open(src).read()
    return "text", text


def main():
    mode, text = read_input(sys.argv[1:])
    if mode == "self-test":
        self_test()
        return 0
    hits = lint(text)
    for lineno, group, phrase, line in hits:
        print(f"{lineno}: [{group}] \"{phrase}\" — {line}")
    print(f"\n{len(hits)} narration hit(s)")
    if hits:
        print(REMINDER)
    reads = readability(text)
    for lineno, group, phrase, line in reads:
        print(f"{lineno}: [{group}] \"{phrase}\" — {line}")
    print(f"\n{len(reads)} readability hit(s)")
    if reads:
        print(PLAIN_ENGLISH)
    return 1 if hits or reads else 0


if __name__ == "__main__":
    sys.exit(main())
