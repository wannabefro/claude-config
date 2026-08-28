---
description: The main loop — brainstorm, plan, build, work, review — plus where autonomy starts and how much attention each stage earns.
---

# The Main Loop

Rationale, measurements, history: `docs/pipeline-rationale.md`.

## Compound engineering is the default

Prefer `compound-engineering:ce-*` over `superpowers:` equivalents. Point `ce-work`
at an **existing plan path** rather than replanning; for a deep non-code deliverable, have `ce-plan`
plan *how it will produce* the deliverable first.

**Three entry points, and none of them wants you to pre-judge the shape.**

`/plan` for all planning, any size: it decides whether `ce-brainstorm` runs first, produces the plan
with `ce-plan`, and runs the Codex cross-review when the stakes earn it.

`/build` for all execution, any size: its decomposer reads the codebase and returns `route` —
`parallel` (fan out), `ce-work` (sequential but substantial), or `inline` (just do it). Only
`parallel` pauses for approval; the other two proceed in the same turn. Always hand `ce-work` an
**explicit plan path** — blank, it globs for the newest plan (the one `/build` just ran) and
hardwires its own reviewer.

The second call exists **only** on the `parallel` route, and is not a mode switch: it fans out N
worktree agents, which is expensive to start and expensive to undo. Read `critical_path` and
`starting_immediately` before spending it, and keep the `build:true` gate even unattended. On
`ce-work` and `inline` there is no second call — proceed in the same turn.

**Parallel is the default, and sequential is the exception that must earn itself.** This matters most
when you route by hand, which happens whenever managed policy has removed the `Workflow` tool: with no
decomposer to answer, the pull is toward one long `ce-work` run, and that is the wrong instinct. Route
sequential only for a reason you can name:

1. Two units write the same file. Contention is decided by file ownership, not by wishful ordering.
2. A unit needs a previous unit's code, not just its result. `depends_on` sequences agents; it does
   not compose their work, so a depth-2 unit verifies against a tree that never held depth-1's.
3. The whole change is one file, or small enough that a worktree costs more than the work.

"It felt safer sequential" is not one of those. What makes parallel safe is the wave discipline in
`rules/orchestration.md` — build depth-1 only, merge, then re-dispatch from the new HEAD — not the
choice to avoid it. When a plan has independent roots, dispatch them together rather than one at a
time.

## Where plans live

Plans live in `docs/plans/`, ignored globally via `~/.config/git/ignore`, so they stay out of every
repo's history. Plans are durable — measured, 83 of 122 re-read more than 20 times and half revised
after creation.

**Where that directory actually points is machine-specific.** Some machines symlink it into cloud
storage to sync plans across devices; others keep it as a plain local directory. A gitignored
overlay in `rules/` states which, and it wins — **check it before creating or re-creating any
symlink**, because a machine that has opted out of cloud sync must stay opted out.
`~/.claude/scripts/link-plans.sh <path> --apply` creates the cloud symlink, so it is only correct on
a machine whose overlay asks for it. Where no overlay says otherwise, `mkdir -p docs/plans` is all a
fresh worktree needs.

A fresh worktree starts without the directory either way, because ignored paths aren't checked out.
This is one instance of a general rule, and the reason `/build` now defaults to a **shared checkout**
rather than a worktree per unit: a worktree contains tracked files only. No `node_modules`, no
`.venv`, no `Pods`, no build cache, no ignored symlink. `/build`'s decomposer returns `workspace`,
and picks `worktree` only when every `verify_command` can pass without any of them.

## Who pulls each lever

| Stage | Trigger | Automatic? |
|---|---|---|
| Plan | `/plan`, or `ce-plan`/`ce-brainstorm` matching their descriptions | **Partly** — the skills self-invoke, so planning can start without you; `/plan` is how you get the brainstorm decision and cross-review too |
| Build | You type `/build` | **No.** Typing it *is* the opt-in the Workflow tool requires; I cannot self-start a fan-out |
| Review | You type `/council` | **No**, except `pr-guardrail-review.sh` at `gh pr ready` on a guardrail diff |

Only planning can start on its own. Execution and review cannot: after an approved plan I say what
to run rather than running it, which is the Workflow opt-in gate, not caution, and it outranks the
autonomy rule below. Say "ultracode" or "use a workflow" in the same breath to skip the round trip.

**Both levers depend on the `Workflow` tool, and managed policy can remove it outright** — not
registered, not deferred, invisible to `ToolSearch`, so its absence looks like a broken install and
is not one. Each command preflights with `scripts/workflow-available.sh <script>.js` and branches on
the exit code: `0` proceed, `1` take that command's own Degraded route, `2` the script is missing and
that one is fixable locally. Report which branch ran — a decomposition or a council that never
happened must never be reported as one that found nothing.

## Review tail

One path: implement, then `/council` once on the assembled diff — not per unit, not per commit.
`/council` is the review entry point and makes its own calls: it clears open CodeRabbit threads via
`autofix` first, declines on a genuinely mechanical diff, and otherwise sizes its seating by triage.

The only way to double-review is to invoke `ce-work` **blank** — it then runs `ce-code-review`
itself. Don't; always hand it the plan path.

## Cross-model plan review

`/plan` runs this. Exactly one pass from the family that didn't author the plan — Claude-authored →
one Codex pass, review only; Codex-authored → Claude's own review *is* the pass. Gated on stakes:
guardrail surfaces (auth, payments, migrations/schema, data mutations, public API, permissions) or a
plan large enough that a wrong shape is expensive to find mid-build.

Run it through `scripts/codex-run.sh` and branch on the exit code, not the output. An **empty pass
(exit 5) does not satisfy this**, and neither does an unavailable CLI (exit 3) or a refusal for lack
of credits (exit 6) — report any of them rather than finalising. Never recurse into multiple
cross-reviews unless asked.

## Autonomy: after plan approval, not before

Run unattended downstream of an approved plan; stay interactive upstream. Don't route to
`lfg`/`looper`.

Capture standing preferences the first time stated, filed by scope: `~/.claude/rules/` for
cross-repo ones (`projects/*/memory/` is **per-project** — filing a cross-repo one there fixes it to
one repo of thirteen); keep machine-specific facts out of synced rules.

## Reducing attention upfront

A question earns attention only if it fails **both**: answerable from the repo, cheap to reverse.
Batch the rest into one round. A picked default must be stated visibly, not guessed.
