# `scripts/ste-lint.py` — what it over-reports, measured

The rule is in `rules/simplified-technical-english.md`. This file holds the evidence for it.

`ste-lint.py` is a regex pass, not a grammar parser. It finds no passive voice and it makes no
part-of-speech check. A clean run is evidence, never a compliance verdict.

## It over-reports on markdown

On 2026-07-30 it flagged 13 violations on `rules/simplified-technical-english.md`. Only 3 are real.

| source | count | why it is not a finding |
|---|---|---|
| Table rows | 9 — 5 over-limit, 2 contractions, 1 modal, 1 rotation | A row is not a sentence, and a quoted bad example is not your prose |
| A bullet list | 1 over-limit, at 69 words | Bullets carry no terminal punctuation, so the linter reads the whole list as one sentence |
| Real prose findings | 3 | — |

Two rules follow from that.

1. Read the **per-100-word rate against the same file over time**. Do not read the absolute count.
2. Lint the prose, not the tables.

```
sed '/^|/d' FILE.md | python3 ~/.claude/scripts/ste-lint.py --type descriptive -
```

That drops the same file from 13 to 4. The one artifact left is the 69-word bullet list.

## The self-test

`python3 ~/.claude/scripts/ste-lint.py --self-test` prints `self-test OK: 12 violations in slop
fixture, 0 in clean`. Run it after any edit to the script.
