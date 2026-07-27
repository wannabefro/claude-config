---
description: Decompose work into independent units and build them concurrently in isolated worktrees, each gated by its own executable verify command
argument-hint: "[what to build — a feature description, or a path to a plan doc]"
---

Build in parallel: **$ARGUMENTS**

Call the `Workflow` tool with:

```
{ "scriptPath": "~/.claude/workflows/build-parallel.js", "args": "$ARGUMENTS" }
```

Invoking this command is the explicit opt-in the Workflow tool requires. Agent count scales with the
decomposition — roughly one implementer per unit, plus one Opus decomposer.

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

Merge in wave order, then run `/council` **once** on the assembled diff. Do not run a review per
unit — the per-unit gate is the `verify_command`, and adding a review inside the loop is what makes
parallel building slower than serial building.
