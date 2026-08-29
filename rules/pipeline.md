---
description: The main loop for planning, frozen Luna implementation, review, and serialized integration.
---

# The main loop

Compound Engineering is installed as an on-demand toolbox. Use its brainstorm,
plan, debug, simplify, review, and compound skills when their descriptions
match. CE does not schedule implementation.

## Plan, build, review

`/plan` produces the requirements and freezes the dependency graph, interfaces,
file ownership, acceptance criteria, and verify commands. Opus xhigh owns the
planning and architecture. Cross-family Codex review remains a review-only
pass when the stakes require it.

`/implement` is the direct path for one coherent, clearly scoped unit. Opus
xhigh freezes the working directory, owned files, acceptance criteria, and one
exact verify command, then dispatches exactly one existing `implementer`. The
implementer calls the fixed Luna wrapper exactly once.

`/build` is the structured implementation entry point. Its Opus xhigh
decomposer returns `parallel` or `serial`:

- `serial` prepares one deterministic private worktree, rechecks the frozen
  fingerprint and HEAD, then dispatches one `implementer`, which calls Codex
  `gpt-5.6-luna` xhigh through `scripts/luna-run.sh`; only a scope-checked
  patch integrates into the canonical checkout.
- `parallel` reports the frozen split first. After approval, it dispatches
  disjoint Luna units with a hard maximum of three active workers.

No main-thread implementation occurs. No CE scheduler, inline writer, model
override, or silent fallback is allowed. Integration and final verification
remain serialized under Opus xhigh. No automatic merge occurs.

`/review` reviews the assembled diff once. Mechanical changes use exact gates
and one Opus diff inspection. Normal changes use one independent Opus xhigh
review and one Codex `gpt-5.6-sol` xhigh outsider through the fixed wrapper.
Guardrail changes route to the full `/council`. The explicit `/council` command
always seats the full council and retains adversarial cross-examination.
The Codex outsider is required for the normal tier; if it is unavailable,
report the gap and do not substitute. Fable is a manual long-horizon
escalation after host access is verified.

## Explicit approval and degraded paths

Execution needs an approved `/implement` or `/build` invocation. If the
Workflow tool is disabled, report the degraded state and use the implementer
directly only for one coherent unit. Do not fan out parallel writes from a
shared checkout: parallel execution is blocked unless exact private worktrees
have been established and can be integrated serially. Preserve the file
ownership, contract, invalidated-work, and verify-command checks by hand.

If the Luna CLI, model, or runtime is unavailable, report the limitation. Do
not use Opus, Sonnet, Terra, Haiku, or a direct Claude write as a substitute.

## Design handoff

UI work follows `docs/design-workflow.md`. Freeze `DESIGN.md`,
`design-contract.md`, and `implementation-handoff.md` before Luna writes.
Review checks those artifacts and the worker must follow them.
