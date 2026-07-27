---
description: The main loop — brainstorm, plan, build, work, review — plus where autonomy starts and how much attention each stage earns.
---

# The Main Loop

Rationale, measurements, history: `docs/pipeline-rationale.md`.

## Compound engineering is the default

Prefer `compound-engineering:ce-*` over `superpowers:` equivalents. Point `ce-work`
at an **existing plan path** rather than replanning; for a deep non-code deliverable, have `ce-plan`
plan *how it will produce* the deliverable first.

`/build` executes a plan's decomposable parts; `ce-work` takes the coupled rest. `/build` reports the
split first, fans out only on `build:true` — keep that gate even unattended. Read `critical_path` and
`starting_immediately` on that first report before any agent runs. Always pass `ce-work` an
**explicit plan path** after `/build` — a blank invocation globs for the newest plan, which is the
one `/build` just executed.

## Review tail: pick one, don't double-review

- *Default*, you own the tail: `ce-work mode:return-to-caller <plan-path>` implements and verifies,
  then run `/council` once on the assembled diff.
- *Hardwired*, `ce-work` owns it: a blank `ce-work` runs `ce-code-review` on every non-mechanical
  diff — don't also run `/council` on that diff.

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
