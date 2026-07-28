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

## Where plans live

`docs/plans/` is a **symlink into iCloud** (`.../CloudDocs/claude-plans/<repo>/`), globally ignored
via `~/.config/git/ignore`. Plans are durable — measured, 83 of 122 re-read more than 20 times and
half revised after creation — but they stay out of every repo's history.

A fresh worktree won't have the symlink, because ignored paths aren't checked out. Re-create it with
`~/.claude/scripts/link-plans.sh <path> --apply` (idempotent) before writing a plan there, or the
plan lands in a real directory that syncs nowhere.

## Who pulls each lever

| Stage | Trigger | Automatic? |
|---|---|---|
| Plan | `/plan`, or `ce-plan`/`ce-brainstorm` matching their descriptions | **Partly** — the skills self-invoke, so planning can start without you; `/plan` is how you get the brainstorm decision and cross-review too |
| Build | You type `/build` | **No.** Typing it *is* the opt-in the Workflow tool requires; I cannot self-start a fan-out |
| Review | You type `/council` | **No**, except `pr-guardrail-review.sh` at `gh pr ready` on a guardrail diff |

Only planning can start on its own. Execution and review cannot: after an approved plan I say what
to run rather than running it, which is the Workflow opt-in gate, not caution, and it outranks the
autonomy rule below. Say "ultracode" or "use a workflow" in the same breath to skip the round trip.

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
(exit 5) does not satisfy this**, and neither does an unavailable CLI (exit 3) — report either rather
than finalising. Never recurse into multiple cross-reviews unless asked.

## Autonomy: after plan approval, not before

Run unattended downstream of an approved plan; stay interactive upstream. Don't route to
`lfg`/`looper`.

Capture standing preferences the first time stated, filed by scope: `~/.claude/rules/` for
cross-repo ones (`projects/*/memory/` is **per-project** — filing a cross-repo one there fixes it to
one repo of thirteen); keep machine-specific facts out of synced rules.

## Reducing attention upfront

A question earns attention only if it fails **both**: answerable from the repo, cheap to reverse.
Batch the rest into one round. A picked default must be stated visibly, not guessed.
