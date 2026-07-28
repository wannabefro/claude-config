---
description: The main loop — brainstorm, plan, build, work, review — plus where autonomy starts and how much attention each stage earns.
---

# The Main Loop

Rationale, measurements, history: `docs/pipeline-rationale.md`.

## Compound engineering is the default

Prefer `compound-engineering:ce-*` over `superpowers:` equivalents. Point `ce-work`
at an **existing plan path** rather than replanning; for a deep non-code deliverable, have `ce-plan`
plan *how it will produce* the deliverable first.

`/build` executes a plan's decomposable parts; `ce-work` takes the coupled rest. Always hand
`ce-work` an **explicit plan path** — blank, it globs for the newest plan (the one `/build` just
ran) and hardwires its own reviewer.

`/build`'s two calls are not a mode switch and don't collapse: the first returns the decomposition
only, the second fans out N parallel worktree agents. Read `critical_path` and
`starting_immediately` before spending that, and keep the `build:true` gate even unattended.

## Who pulls each lever

| Stage | Trigger | Automatic? |
|---|---|---|
| Plan | `ce-plan` / `ce-brainstorm` match their descriptions | **Yes** — I invoke them |
| Build | You type `/build` | **No.** Typing it *is* the opt-in the Workflow tool requires; I cannot self-start a fan-out |
| Review | You type `/council` | **No**, except `pr-guardrail-review.sh` at `gh pr ready` on a guardrail diff |

Only planning is self-starting. After an approved plan I'll say what to run rather than run it —
that's the Workflow opt-in gate, not caution, and it outranks the autonomy rule below. Say
"ultracode" or "use a workflow" in the same breath to skip the round trip.

## Review tail

One path: implement, then `/council` once on the assembled diff. Not per unit, not per commit.

The only way to double-review is to invoke `ce-work` **blank** — it then runs `ce-code-review`
itself. Don't; always hand it the plan path.

## Cross-model plan review

Exactly one review pass from the family that didn't author the plan. Claude-authored → one Codex
pass (review only). Codex-authored → Claude's own review *is* the cross-model pass. An **empty Codex
pass doesn't satisfy this** — report it rather than finalising. Never recurse into multiple
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
