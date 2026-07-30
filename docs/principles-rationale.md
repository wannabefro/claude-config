# Engineering Principles — Rationale (reference)

On-demand reference for `rules/principles.md`, which keeps the always-on directives. Read this when
you want the numbers behind a rule, not on every session.

## Comment growth: the three failure modes, and the measurement

The rule in `rules/principles.md` states the limits. These are the shapes that break them. All three
were observed in practice, and a rule that only said "comment sparingly" did not stop any of them.

| failure mode | what it looks like | why the limit catches it |
|---|---|---|
| **Rationale blocks** | A multi-line comment that justifies the change: mechanism explanations, "why this is correct", cross-references to tickets or PRs beyond a single ID | The 3-line block cap. That content belongs in the PR description or the ticket, not the file |
| **Sibling duplication** | You copy a block inside a file — a new target, env, or handler — and the copy inherits every comment from its sibling | The 15% density cap. The original a few lines up already explains it, so strip the inherited comments |
| **Reviewer-directed comments** | Anything that explains the *diff* rather than the *code* | It reads as noise the moment it merges, and the 20-word limit makes it too small to write |

### Measured 2026-07-30

Across the 22 code files this repo owns (`hooks/`, `scripts/`, `workflows/`): **17.8% comment lines
pooled, 22.4% in the median file, and 47 comment blocks of 4 or more lines.** 20 of the 22 files break
at least one limit.

The worst cases, and they are all rationale blocks:

| file | density | worst block |
|---|---|---|
| `hooks/delegate-prompt-nudge.sh` | 48.1% | — |
| `hooks/worktree-codegraph.sh` | 47.6% | — |
| `hooks/bash-safety.sh` | 43.9% | 4 lines |
| `workflows/council-review.js` | 19.5% | **23 lines, 239 words** at line 162 |
| `workflows/build-parallel.js` | 22.4% | 14 blocks, 33 long comments |

A per-commit trend was attempted and it does not support a claim. Only three commits predate
2026-07-27, and two of those are bulk vendoring with almost no comments, so the older baseline is not
comparable. The standing density above is the number to act on.

## The house style is already good — this is the baseline it should stay at

Measured 2026-07-28 across six repos (5,117 tests). Do not "improve" the style away from this. A
change that moves a column far from these numbers needs a reason.

| | tipsy | chromaticly | taivo | inflationguessr | kayen | sidetalk |
|---|---|---|---|---|---|---|
| median lines / test | 11 | 9 | 9 | 7 | 9 | 12 |
| median assertions / test | 2 | 2 | 2 | 2 | 2 | 2 |
| zero-assertion tests | 0% | 0% | 0% | 1% | 0% | 0% |
| module mocks / file | 0.31 | 0.22 | 0.45 | 0.00 | 0.47 | 0.00 |
| setup hooks / file | 0.52 | 0.04 | 0.24 | 0.40 | 0.27 | 1.67 |
| median words in name | 10 | 10 | 9 | 9 | 9 | 9 |

The pattern is short tests, two assertions, almost no module mocking, little shared setup, and long
descriptive names. The suites are fast enough to run whole: 2,706 chromaticly tests in 7s, and 1,072
tipsy mobile tests in 17s.

## Never judge a test by its text — three passes, three wrong answers

Tried on 2026-07-28. All three regex passes failed.

| pass | claim | why it was wrong |
|---|---|---|
| Assertion shape | 22% of one suite is low-value | 3 of 3 hand-checked flags were wrong |
| Bracket counting | 23 of 40 mutants survived | It read JSX brackets as comparisons |
| Name shape | chromaticly scores 25% | Its names are among the best written: `an atom naming an unregistered numeral throws` |

Structure counts and mutation scores are measurable. Quality is not measurable from text.

## Mutation scores behind the guards-and-boundaries rule

Mutation-tested three repos on 2026-07-28 with `scripts/mutation-probe.py`: inflationguessr 70%,
tipsy `apps/mobile` 73%, chromaticly 73%. The suites are sound, so the 28 survivors are the signal.
The four survivor shapes, and the two test cases they imply, stay in `rules/principles.md` — they
change what you write, so they are not reference material.
