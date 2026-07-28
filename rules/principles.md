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

## Name the readings when a request is ambiguous

If a non-trivial prompt admits more than one reasonable reading, say so in a sentence and pick a
default — enough that I can redirect cheaply, not an exhaustive survey. Silent disambiguation is the
failure mode; the cost is discovering 20 minutes in that I meant the other one.
