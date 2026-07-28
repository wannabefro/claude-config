---
description: The entry point for executing any approved work — routes to parallel fan-out, ce-work, or inline, and when it fans out builds the units concurrently in isolated worktrees behind executable verify commands
argument-hint: "[what to build — a feature description, or a path to a plan doc. Any size.]"
---

Build in parallel: **$ARGUMENTS**

**This is the entry point for executing any approved work — always start here.** Don't decide the
shape first: the decomposer reads the codebase and returns a `route`, and only one of the three
routes costs anything to be wrong about.

**Step 1 — always.** Call the `Workflow` tool with:

```
{ "scriptPath": "~/.claude/workflows/build-parallel.js",
  "args": { "task": "$ARGUMENTS" } }
```

Pass `args` as a real object, never a JSON-encoded string — a stringified object arrives as one
string and every flag on it is silently dropped. One Opus decomposer runs; no implementer, no
worktree.

**Step 2 — depends on the route, and only `parallel` waits.**

- `inline` → **just build it, this turn.** No second invocation, no asking. The decomposition already
  cost a round trip; making the user confirm a serial build wastes another.
- `ce-work` → **invoke `ce-work` now, this turn**, with the plan path if there is one, otherwise the
  task plus the returned `units` as its task list.
- `parallel` → **stop and show me the split**: units, file ownership, `verify_command`s, and lead
  with `critical_path` / `starting_immediately`. Then re-invoke with `"build": true` once I agree.
  This is the only route that waits, because it is the only one that spawns N implementers into N
  worktrees — expensive to start and expensive to undo.

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

- **It returns a `route`, and that is the answer — act on it, don't re-litigate it.** The decomposer
  has read the codebase, so it is better placed to make this call than a guess from the task string:

  | route | meaning | what you do |
  |---|---|---|
  | `parallel` | ≥2 units, disjoint files, no shared contract | re-invoke with `"build": true` |
  | `ce-work` | sequential or coupled but substantial | hand `ce-work` the plan path, or the task plus the returned `units` as its task list |
  | `inline` | one coherent change, or coupled reasoning, or too small to dispatch | just build it |

  Relay `route_reason` in one line and get on with it — no stopping to ask, no re-running to force a
  split. On `ce-work` and `inline` the `units` still come back in dependency order; that ordering is
  most of what the decomposition bought, so use it rather than re-deriving it. A one-unit result
  reports `inline` for the same reason: one unit pays worktree and dispatch cost for zero concurrency.
- Structural refusals (`conflicts`, `contract_issues`) get **one** re-decomposition, not a
  negotiation. If the second attempt collides the same way, the work is genuinely coupled — take the
  `fallback` route and say so. Two failed decompositions cost more than the parallelism was worth.
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

Then clean up: `~/.claude/scripts/clean-build-worktrees.sh <repo> --apply`. Worktrees are **not**
removed automatically, and must not be — agents leave their work uncommitted, so the branch sits at
the base commit and `git branch -d` will call an entire unmerged unit "already merged". The script
compares file content against the main tree instead, removes only what is byte-identical or empty,
and keeps anything that still differs. Run it after merging, not before.

## Where this sits

`ce-brainstorm` -> `ce-plan` produces the plan; this executes the parts of it that decompose. The
plan's own unit list is input, not gospel — the decomposer reads the codebase and will contradict it
when the plan's file boundaries don't survive contact (on its first real run it found one file
claimed by five separate units).
