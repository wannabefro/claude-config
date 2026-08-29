---
description: Opus orchestration, Luna implementation, frozen delegation contracts, and bounded parallel execution.
---

# Orchestration and delegation

Claude Opus xhigh is the automatic orchestration model. It owns requirements,
architecture, diagnosis, design direction, review, integration, and final
verification. It must not write implementation files.

Codex `gpt-5.6-luna` xhigh is the only automatic implementation writer. It
owns application code, tests, scripts, schemas, migrations, build files, and
engineering configuration. If Opus, Codex, or Luna is unavailable, report the
limitation. Never substitute Sonnet, Terra, Haiku, or a Claude write route.

Fable is a manual long-horizon escalation only. Verify host access before use.
Sonnet and `gpt-5.6-terra` are manual fast lanes only. Haiku is allowed only
for deterministic, non-judgmental plumbing that cannot affect design, code,
review severity, or verification.

**Haiku needs all four conditions, or use the Luna implementer.** Use Haiku only
for one-file deterministic plumbing with a failing-then-green verify command, no
API or contract decision, and a known transformation rather than invention.
Treat a Haiku failure as evidence that the unit needs clearer decomposition; do
not silently upgrade it or substitute another writer.

## Frozen delegation contract

Before any implementation dispatch, Opus must freeze:

- the dependency graph and startable units;
- the interfaces, contracts, and names that cross unit boundaries;
- the exact file ownership for each unit;
- the absolute working directory and base commit for the approved payload;
- the acceptance criteria and one executable verify command per unit;
- the workspace choice and the dependency constraints that govern eligibility.

At most three independent Luna implementation units may run at once. The
global setting and `workflows/build-parallel.js` enforce this ceiling. Parallel
units must have disjoint files and ordered shared contracts. `/implement` uses
one implementer immediately for one coherent unit. `/build` serial work uses
one deterministic private worktree and one implementer for structured coupled
work; the helper integrates only a scope-checked patch. No main-thread
implementation writes occur.

Integration and final verification stay serialized under Opus. `/review` is
the normal assembled-diff review. Guardrail work uses the full `/council`.
No automatic merge occurs. A dependent unit cannot start after a failed
predecessor. A unit that verifies a name a later unit removes must depend on
that remover; otherwise the build refuses the invalidated work.

The frozen contract fixes dependency edges, provider/consumer ordering,
ownership, and eligibility constraints; it does not freeze a total integration
order. When a unit completes and its dependencies are integrated, it is
eligible for integration in completion order under one canonical writer lock.
Independent completed units must not wait behind an unrelated slow unit
(there is no independent head-of-line blocking). A dependent remains ineligible
until every declared predecessor has integrated, even when another unit
completes first.

## Implementer boundary

The `implementer` agent is an Opus dispatcher and verifier. It creates one
private brief, calls `scripts/luna-run.sh` exactly once, runs the exact verify
command, inspects status and diff read-only, and returns the structured handoff.
It has no native implementation tools and has no write fallback.

Compound Engineering remains installed as an explicit toolbox for brainstorm,
plan, debug, simplify, review, and compound learning. Any CE path that reaches
implementation returns through `/implement` or `/build` and the Luna
implementer. CE does not schedule or replace the frozen delegation contract.

The roster stays exactly four agents: `explorer`, `planner`, `reviewer`, and
`worker`. UI review checks `DESIGN.md`, the design contract, and the handoff.
The worker reads those artifacts and does not invent a competing visual system.
There is no permanent designer agent.

## Parallel and verification safeguards

`/build` gives every parallel unit an exact private git worktree. Advisory file
ownership is not physical isolation: an accidental formatter or generated file
can still collide in a shared checkout. The dispatcher rejects shared plans,
creates and seeds the worktrees, passes each exact path to Luna, rejects any
patch outside its canonical owned files, integrates completed eligible patches
in completion order under one canonical writer lock, and cleans up in a
`finally` path. If any capability check fails, no parallel unit starts.

Before dispatch, the workflow freezes a SHA-256 fingerprint over the index,
tracked working tree, and relevant untracked paths. Approval rechecks the same
fingerprint and HEAD. Any drift blocks every unit; it does not downgrade the
plan or continue with a partial snapshot.

Every verify command must exit zero for a green result. Report failed and
skipped units separately. Keep temporary task files private and remove them on
success, failure, cancellation, and signal. Never use reset, clean, stash, or
broad format commands to recover a worker.

Bound foreign CLIs with their approved wrappers. A stalled or unavailable
Codex run is a reported limitation, not permission to change model or effort.
