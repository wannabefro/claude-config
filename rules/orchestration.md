---
description: Opus orchestration, Sonnet implementation, frozen delegation contracts, and bounded parallel execution.
---

# Orchestration and delegation

Claude Opus is the automatic orchestration model. It owns requirements,
architecture, diagnosis, design direction, review, integration, and final
verification. It runs at high effort and escalates to xhigh for planning,
architecture, diagnosis, and review. It must not write implementation files.

Sonnet is the only automatic implementation writer. It owns application code,
tests, scripts, schemas, migrations, build files, and engineering configuration.
The `implementer` agent writes with Sonnet at xhigh effort. Never substitute
Terra, and never write implementation files from the main thread.

**There is no Codex writer lane.** Codex serves one purpose here: the
`gpt-6-astra` cross-family review seat through `scripts/codex-run.sh`. A Sonnet
unit reviewed by Opus is same-family, so that outside review seat is what keeps
the independence. Guard it, and report it honestly when it is unavailable.

Fable is a manual long-horizon escalation only. Verify host access before use.
`gpt-5.6-terra` is a manual fast lane only.

## Haiku is the default for a well-scoped task

A task is well scoped when it states its own success condition. The caller can
then check the answer without repeating the work. Dispatch Haiku for these five
shapes:

| shape | example |
|---|---|
| Read-only search and location | find every caller of a name; list the files that match a pattern |
| Mechanical transformation with a known target | reflow a comment; apply one rename across a listed set of sites |
| One-file plumbing with a failing-then-green verify command | add a missing export; correct one type error |
| Extraction into a stated schema | take the failure lines from one log; list the exports of one file |
| One fact for each worker in a fan-out | count the matches in each of 6 repositories and report the numbers |

Keep Haiku away from four things: design and architecture, diagnosis, review
severity, and final verification. Opus keeps those, and Opus stays the brain of
every route. A Haiku failure means the brief was not scoped. Rewrite the brief;
do not promote the model.

## A worker costs 12 to 20 seconds and about 60,000 tokens before it reads anything

Measured on this machine on 2026-09-10. Two benchmarks, both scored by exact
match against a scripted ground truth:

| task | 3 Haiku in parallel | 1 Sonnet alone | main thread, no worker |
|---|---|---|---|
| List the `check()` names in 3 eval files | 15.0 s, 190k tokens | 15.7 s, 91k tokens | not run |
| Run 3 eval suites, report exit code and counts | 20.4 s, 184k tokens | 16.3 s, 94k tokens | **4 s** |

Every arm returned 36 of 36 items correct. Haiku matched Sonnet on accuracy, at
a lower price for each token. Speed is the surprise: the fan-out won nothing,
because each worker paid a startup larger than the work.

Two rules follow:

1. **Do the work in the main thread when it takes seconds.** One shell command,
   one search, or one file read is faster with no worker.
2. **Fan out when each unit needs more than about 30 seconds of its own work.**
   Dispatch every unit in one message, up to 8. Give each unit to Haiku when it
   fits a shape in the table above.

The `parallelise-work` skill carries the decision procedure and the slicing
patterns. Invoke it before you dispatch anything.

**Dispatch independent work in one message.** Measured over 28 days on this
machine, 416 of 421 dispatch bursts held exactly one agent. Two independent
questions are two dispatches in one message, not two turns. The extra turn is a
full round trip, and the round trip is the latency.

## Frozen delegation contract

Before any implementation dispatch, Opus must freeze:

- the dependency graph and startable units;
- the interfaces, contracts, and names that cross unit boundaries;
- the exact file ownership for each unit;
- the absolute working directory and base commit for the approved payload;
- the acceptance criteria and one executable verify command per unit;
- the workspace choice and the dependency constraints that govern eligibility.

At most three independent implementation units may run at once.
`workflows/build-parallel.js` enforces that ceiling with
`MAX_ACTIVE_IMPLEMENTERS = 3`. The global setting
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` is 8, and it caps every subagent, not
the writers alone. Read-only and mechanical fan-out uses the full 8. Only
writers are capped at 3. Parallel
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
frozen unit, writes the implementation with Sonnet, runs the exact verify
command, inspects status and diff read-only, and returns the structured handoff.
It has no native implementation tools and has no write fallback.

Compound Engineering remains installed as an explicit toolbox for brainstorm,
plan, debug, simplify, review, and compound learning. Any CE path that reaches
implementation returns through `/implement` or `/build` and the Sonnet
implementer. CE does not schedule or replace the frozen delegation contract.

The roster stays exactly four agents: `explorer`, `planner`, `reviewer`, and
`worker`. UI review checks `DESIGN.md`, the design contract, and the handoff.
The worker reads those artifacts and does not invent a competing visual system.
There is no permanent designer agent.

## Parallel and verification safeguards

`/build` gives every parallel unit an exact private git worktree. Advisory file
ownership is not physical isolation: an accidental formatter or generated file
can still collide in a shared checkout. The dispatcher rejects shared plans,
creates and seeds the worktrees, passes each exact path to the implementer, rejects any
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
