---
description: Decompose work into independent units and build them concurrently in isolated worktrees, each gated by its own executable verify command
argument-hint: "[what to build — a feature description, or a path to a plan doc]"
---

Build in parallel: **$ARGUMENTS**

This runs in two steps, because the decomposition is the ceiling on everything downstream and is far
cheaper to read than to undo.

**Step 1 — decompose and report.** Call the `Workflow` tool with:

```
{ "scriptPath": "~/.claude/workflows/build-parallel.js",
  "args": { "task": "$ARGUMENTS" } }
```

Pass `args` as a real object, never a JSON-encoded string — a stringified object arrives as one
string and every flag on it is silently dropped.

Show the returned units, their file ownership, and their `verify_command`s, then **stop and let me
read them**. One Opus decomposer runs; no implementer, no worktree.

**Step 2 — build, once I've agreed the split.** Re-invoke with `"build": true` added. Agent count
scales with the decomposition: roughly one implementer per unit.

Invoking this command is the explicit opt-in the Workflow tool requires.

## Why this and not ce-work's own parallel strategy

`ce-work` can parallelize, but the choice lives in prose and the model resolves it — measured across
this machine's transcripts it picked parallel in 2 of 11 sessions, so in practice work runs serial
without anyone deciding it should. Here the split is computed: units are schema-enforced, same-wave
file overlap is checked in code and refused, and `decomposable: false` is a visible typed outcome
rather than a silent fallback to serial.

Use `ce-work` when the work is genuinely coupled, and for the shipping tail.

## Before you run it

If `$ARGUMENTS` is vague, ask what "done" looks like first. The decomposer needs enough to write a
real `verify_command` per unit, and a fan-out built on guessed boundaries produces merge conflicts
that cost more than the parallelism saves.

## Reporting the result

- If it returns `decomposable: false`, **that is a successful outcome, not a failure.** Relay the
  reason and build the work serially instead. Do not re-run trying to force a split.
- If it returns same-wave file `conflicts`, the decomposition was wrong. Report the overlap and offer
  to re-run with those units merged or re-waved.
- On success: report `units_green / units_total`, then the **merge sequence** in wave order. Nothing
  is merged automatically — an unattended N-way merge is where parallel builds go wrong.
- Report `needs_attention` units honestly and prominently. A unit that failed its own verify command
  may have had a later wave built on top of it.

## After it succeeds

Merge in wave order, then review the assembled diff **once** — `ce-code-review` normally, or
`/sam-review` for a guardrail-critical surface. Do not review per unit: the per-unit gate is the
`verify_command`, and putting a review inside the loop is what makes parallel building slower than
serial building.

## Where this sits

`ce-brainstorm` -> `ce-plan` produces the plan; this executes the parts of it that decompose. The
plan's own unit list is input, not gospel — the decomposer reads the codebase and will contradict it
when the plan's file boundaries don't survive contact (on its first real run it found one file
claimed by five separate units).
