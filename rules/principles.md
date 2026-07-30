---
description: Cross-project engineering principles — comment limits, conflict resolution, test invariants, ambiguity handling.
---

# Engineering Principles

## Comment sparingly — a comment is prose, so STE governs it

Default to zero comments. Each comment must earn its place. This is a hard default, and it covers
every file type, including YAML and config.

Three countable limits, taken from `rules/simplified-technical-english.md`:

1. Write one sentence in one comment. Keep it to **20 words or fewer**.
2. Never write a block of **more than 3 comment lines**. A longer block is a rationale block, and it
   belongs in the PR description.
3. Keep a file at **15% comment lines or fewer**. When you edit a file, match or reduce its density.

Add a comment only when it says what the code cannot: why a non-obvious choice was made, a workaround
and its cause, an invariant, or a genuine gotcha. Never restate the line, label an obvious section, or
explain the diff. Delete a stale comment rather than update it.

`scripts/comment-density.py` measures all three. It takes files, directories, or `--staged`, and it
exits 1 on a breach. **A rule alone did not work** — this repo measured 17.8% comment lines on
2026-07-30, with 47 blocks over the limit. The three failure modes that produced it, and the numbers:
`docs/principles-rationale.md`.

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

### The house style is already good — keep it there

Write short tests: two assertions, almost no module mocking, little shared setup, and a long
descriptive name. A change that moves far from that shape needs a reason. The measured baseline across
six repos and 5,117 tests is in `docs/principles-rationale.md`; check a column before you change it.

**Never judge a test by its text.** Three regex passes tried it on 2026-07-28 and all three gave a
wrong answer. Structure counts and mutation scores are measurable. Quality is not measurable from
text, so do not go looking for weak assertions — run `scripts/mutation-probe.py` instead.

## Name the readings when a request is ambiguous

If a non-trivial prompt admits more than one reasonable reading, say so in a sentence and pick a
default — enough that I can redirect cheaply, not an exhaustive survey. Silent disambiguation is the
failure mode; the cost is discovering 20 minutes in that I meant the other one.
