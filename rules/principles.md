---
description: Cross-project engineering principles — conflict resolution, test invariants, ambiguity handling.
---

# Engineering Principles

## Surface conflicts, don't average them

When two patterns in the codebase contradict, pick one — prefer the more recent or more tested — and
say why. Flag the other for cleanup. Don't blend them into a third hybrid that matches neither; a
silent average leaves no anchor for the next reader.

## Tests must encode why, not just what

A test that still passes after the business rule it guards changes is the wrong test. Name the
invariant in the test name or a one-line comment. Behaviour-only assertions (`returns 200`, `dict has
key "id"`) are insufficient when the point of the code is a specific rule.

### The gap is guards and boundaries, not assertions — measured

Mutation-tested three repos on 2026-07-28 with `scripts/mutation-probe.py`: inflationguessr 70%,
tipsy `apps/mobile` 73%, chromaticly 73%. The suites are sound. **Do not go looking for weak
assertions** — a separate regex pass over assertion styles called 22% of one suite low-value and 3
of 3 hand-checked flags were wrong.

The 28 survivors clustered into four shapes, and the same four appeared in all three repos:

| shape | example that survived |
|---|---|
| Null and type guards | `if (typeof a !== 'object' \|\| a === null) return false` |
| Early-return guard clauses | `if (!selected \|\| isLastCategory \|\| busy) return` |
| Empty-input fallbacks | `properties.length > 0 ? properties : BAR_PROPERTIES` |
| Validation boundaries | `handle.length >= 3 && handle.length <= 30` |

The core rule always had a test. The guard protecting it never did, and the boundary was tested one
value inside it rather than at it.

So when you write a test for a function, add two cases beyond the main path:

1. **Each guard clause, taken on its own.** One case per condition in the `||` chain, or the chain is
   only proven as a whole and any single term can be deleted without a failure.
2. **The boundary value itself**, not a value near it. `length === 30` and `length === 31`, never
   `length === 10`.

Run the probe before claiming a suite is thorough. `/dogfood` documents the invocation, including the
`node_modules` symlink a worktree needs.

### The house style is already good — this is the baseline it should stay at

Measured 2026-07-28 across six repos (5,117 tests). Do not "improve" the style away from this; a
change that moves a column far from these numbers needs a reason.

| | tipsy | chromaticly | taivo | inflationguessr | kayen | sidetalk |
|---|---|---|---|---|---|---|
| median lines / test | 11 | 9 | 9 | 7 | 9 | 12 |
| median assertions / test | 2 | 2 | 2 | 2 | 2 | 2 |
| zero-assertion tests | 0% | 0% | 0% | 1% | 0% | 0% |
| module mocks / file | 0.31 | 0.22 | 0.45 | 0.00 | 0.47 | 0.00 |
| setup hooks / file | 0.52 | 0.04 | 0.24 | 0.40 | 0.27 | 1.67 |
| median words in name | 10 | 10 | 9 | 9 | 9 | 9 |

Short tests, two assertions, almost no module mocking, little shared setup, and long descriptive
names. Suites are fast enough to run whole: 2,706 chromaticly tests in 7s, 1,072 tipsy mobile tests
in 17s.

**Never judge a test by its text.** Three separate regex passes tried it on 2026-07-28 and all three
were wrong: assertion shape called 22% low-value (3 of 3 hand-checks wrong), JSX brackets were read
as comparisons (23 of 40 mutants), and a name-shape pattern scored chromaticly at 25% when its names
are among the best written (`an atom naming an unregistered numeral throws`). Structure counts and
mutation scores are measurable. Quality is not, from text.

## Name the readings when a request is ambiguous

If a non-trivial prompt admits more than one reasonable reading, say so in a sentence and pick a
default — enough that I can redirect cheaply, not an exhaustive survey. Silent disambiguation is the
failure mode; the cost is discovering 20 minutes in that I meant the other one.
