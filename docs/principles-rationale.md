# Engineering Principles — Rationale (reference)

On-demand reference for `rules/principles.md`, which keeps the always-on directives. Read this when
you want the numbers behind a rule, not on every session.

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
