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
without anyone deciding it should. Here the split is computed: units are schema-enforced, units that
could run concurrently are refused in code if they share a file, and `decomposable: false` is a
visible typed outcome rather than a silent fallback to serial.

Each unit declares `depends_on` and starts the moment *its own* dependencies are green — not when a
whole cohort finishes. That distinction is most of the parallelism: on a real 12-unit decomposition
the previous wave-barrier scheduler ran 6 sequential stages at peak concurrency 4 of 12, while only
3 of 52 files were actually contested.

Use `ce-work` when the work is genuinely coupled, and for the shipping tail.

## Before you run it

If `$ARGUMENTS` is vague, ask what "done" looks like first. The decomposer needs enough to write a
real `verify_command` per unit, and a fan-out built on guessed boundaries produces merge conflicts
that cost more than the parallelism saves.

## Reporting the result

- If it returns `decomposable: false`, **that is a successful outcome, not a failure.** Relay the
  reason and build the work serially instead. Do not re-run trying to force a split.
- **On the step-1 report, lead with `critical_path` and `starting_immediately`, not the unit count.**
  Those two numbers are how parallel the build will actually be. Twelve units with a critical path of
  10 is a chain wearing a fan-out's clothing — say so and offer to re-decompose, because the fix is
  cheap now and expensive after the agents run.
- If it returns `conflicts`, two units that could run at the same time claim the same file. Report the
  overlap and offer to re-run with them merged or with a real dependency declared between them.
- If it returns `contract_issues`, units disagree about a shared name while touching different files.
  This is the one worth explaining rather than just relaying: `unordered-contract` means a unit reads
  a name another unit defines with no dependency between them, so both verify green in isolation and
  only disagree once merged. `duplicate-provider` means two units define the same name and the later
  merge silently wins. Neither is visible in the file lists. Offer to re-decompose with the
  dependency declared, or with the name owned by exactly one unit.
- If it returns `cycles`, `dangling`, or `duplicates`, the dependency graph is malformed — relay it
  and re-run. `duplicates` is the one most likely to look like a tool malfunction rather than a
  decomposer slip; it is not, and the decomposition is cheap to redo.
- If it returns `deferred`, that is **not** a failure: only depth-1 units are buildable in one pass,
  because every worktree branches from the same base and nothing merges mid-run — a deeper unit would
  be written against a tree that never contained its dependency's work. Report it as "layer complete",
  give the merge sequence, and say the next layer needs a re-run from the new HEAD.
- On success: report `units_green / units_total`, then the **merge sequence**, which is in dependency
  order so a unit always merges after whatever it was built on. Nothing is merged automatically — an
  unattended N-way merge is where parallel builds go wrong.
- Report `needs_attention` honestly and prominently, and distinguish the two kinds: a unit that
  **failed** its own verify command, versus one that was **skipped** because a dependency never went
  green. A skipped unit is untouched work, not broken work — fix its blocker and it still needs
  building.

## After it succeeds

Merge in `merge_sequence` order, then run `/council` **once** on the assembled diff. Its triage sizes the seating,
so an ordinary build pays for two lenses and a guardrail surface seats all six. Do not review per
unit: the per-unit gate is the `verify_command`, and putting a review inside the loop is what makes
parallel building slower than serial building.

## Where this sits

`ce-brainstorm` -> `ce-plan` produces the plan; this executes the parts of it that decompose. The
plan's own unit list is input, not gospel — the decomposer reads the codebase and will contradict it
when the plan's file boundaries don't survive contact (on its first real run it found one file
claimed by five separate units).
