---
name: self-consistency
description: Triangulate a piece of work by generating its implementation, spec, and tests independently, then cross-checking the three for disagreements that localize bugs. Use when you want a high-assurance check on a hard or high-stakes change, or when accepting the self-consistency nudge after a high-stakes diff. Trigger phrases - "self-consistency", "/self-consistency", "cross-check this", "triangulate this".
---

# self-consistency — multi-perspective cross-check

Generate three independent views of the same work and check them against each
other. Because each view is produced without seeing the others, a disagreement
is a strong bug signal: the implementation, the spec, and the tests can't all be
right if they contradict.

| Perspective | Agent | Sees |
|-------------|-------|------|
| Implementation | `implementer` | the task intent |
| Spec (expected behavior) | `spec-deriver` | the task intent only — never the implementation |
| Tests | `test-writer` | the spec / acceptance criteria only — never the implementation |

The isolation is the point. Do not paste the implementation into the spec-deriver
or test-writer dispatch prompts — a fresh-context subagent only knows what its
prompt carries, so prompt discipline IS the isolation mechanism.

## When to run

**Good fits:**
- A hard or high-stakes change where a single-pass implementation isn't enough confidence
- Accepting the self-consistency nudge fired on a high-stakes diff
- A change whose correctness hinges on a specific rule you want independently encoded

**Skip:**
- Trivial changes (renames, typos, config) — triangulation is wasted
- Work still mid-exploration — the spec isn't stable enough to cross-check
- When you only need a maintainability review — use `/sam-review` instead

## Arguments

A description of the work to triangulate, or a reference to it (a task, a unit
from a plan, a diff to re-derive). Pass the same task intent to all three
perspectives; do not pre-bias any of them with the others' outputs.

## Execution

1. **Dispatch all three perspectives in parallel** — in a single message, one
   `Agent` call each, so they generate independently:
   - `implementer` — prompt: the task intent + acceptance criteria.
   - `spec-deriver` — prompt: the task intent, reframed as "describe the expected
     behavior / contract for this task." No implementation.
   - `test-writer` — prompt: the spec / acceptance criteria. No implementation.

   See `superpowers:dispatching-parallel-agents` for batching multiple dispatches.

2. **Collect the three outputs** — the implementation (visible via the working
   tree), the derived behavior spec, and the test suite + any spec-gap notes.

## Cross-check

The orchestrator (not a subagent) compares the three, asking:

- **Implementation vs spec:** does the implementation satisfy every expected
  behavior the spec-deriver listed? Where it doesn't, that's a candidate bug or a
  spec the implementation silently diverged from.
- **Tests vs spec:** do the tests assert behavior the spec actually claims, and
  do they cover the spec's edge/error conditions? Tests asserting something the
  spec doesn't claim, or gaps the tests miss, are findings.
- **Tests vs implementation:** do the tests pass against the implementation? A
  test the spec justifies but the implementation fails is the highest-signal
  finding — three independent views, two against one.

Also fold in the `spec-deriver`'s open questions and the `test-writer`'s
spec-gap notes — these are places the task itself was underspecified, surfaced
from two independent directions.

## Synthesis

Produce one prioritized list of **divergences** (where the three disagree) and a
short note of agreements:

```
## Likely bugs (two views against one)
- [divergence] — implementation says X, spec/tests expect Y

## Spec gaps (surfaced independently)
- [ambiguity] — flagged by: spec-deriver / test-writer

## Agreement
- [behaviors all three encode consistently]
```

## After

Do **not** silently reconcile a disagreement by picking a side — the value is
human bug-localization. Surface the divergences and end with: "These are where
the three views disagree. Which reading is correct?" Let the user adjudicate,
then act on their decision.
