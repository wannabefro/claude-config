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
    print(f"self-test OK: clean 0, heading {len(heading)}, multi {len(multi)} across "
          f"{sorted(groups)}; without code-skip fence gives {len(raw_fence)}, "
          f"inline gives {len(raw_inline)} (both 0 with skip on)")


REMINDER = (
    "Two things can justify keeping a note: a reviewer commented on the larger "
    "version, or the churn is visible in the pushed commits. Otherwise cut it "
    "and fix the history instead."
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
    print(f"\n{len(hits)} hit(s)")
    if hits:
        print(REMINDER)
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
