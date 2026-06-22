---
name: designing-bounded-loops
description: Use when designing, writing, reviewing, or auditing a recurring or autonomous agent loop — anything fired via /loop, /schedule, a cron, or a long ce-work run that repeats until a goal. Also use when a loop runs unbounded, has no hard stop, repeats unproductively, plateaus, "fixes" the wrong thing, games its own metric, or relies on the agent's own "I'm done" to terminate. Also use when you are already partway through a repetitive, loop-shaped task — repeating the same unit of work toward a goal (fixing tests one by one, migrating files, triaging issues) — and should convert the in-flight work into a bounded loop instead of grinding it manually. Trigger phrases - "designing-bounded-loops", "/designing-bounded-loops", "bound this loop", "loop contract", "audit this loop", "design a loop", "turn this into a loop".
---

# Designing Bounded Loops

## Overview

An agent loop is only as safe as its weakest bound. The single highest-leverage move is making the **verification check that proves the work is done the same thing that ends the loop** — and putting that check, plus the iteration/budget cap, *outside the model*. An LLM asked "are we done yet?" eventually says yes to end the task; a passing test or an unchanged diff cannot lie. (Ground-truth-anchored stops self-correct ~70% of the time; intrinsic self-assessment degrades — Huang et al., ICLR 2024.)

## The Loop Contract — fill in all six before running

Every loop you design or approve must name all six. A blank slot is a bug, not a default.

1. **Trigger** — what fires one iteration (schedule, event, manual). State the cadence; long beats short (volume rarely needs sub-hourly polling).
2. **Action** — the exact prompt/work for one iteration. Scope each iteration to *one coherent unit*, then stop and report. Tangential things it spots are out of scope — park them (see below), never chase them.
3. **Verify = Stop** — one falsifiable, **externally measured** check that doubles as the terminator. A test passes, a coverage tool reports ≥ target, "no qualifying items remain." Not "the agent judges it complete."
4. **Authority bound** — what it may NOT do without a human: merge, push to protected branches, deploy, spend, mutate prod data, resolve/mute alerts, edit outside its worktree. Default to draft PR / ticket; a human commits the irreversible step.
5. **Caps** — a hard **iteration cap** AND a **no-progress / plateau exit** (halt after N iterations that change nothing — unchanged diff, <X% gain). Token/cost budget where the host allows. These terminate even when Verify never trips.
6. **Handoff** — the compact structured report each iteration returns (what it did, evidence, what a human must do next). Idempotency ledger if it runs repeatedly, so it never re-acts on the same item.

## Turning an in-flight task into a loop

If you're already working a task and notice it's loop-shaped — repeating the same unit toward a goal — stop and convert it rather than grinding manually. The half-finished manual run is your baseline: you already know the unit and the check, so the contract nearly writes itself.

1. **Action** = the single unit you've been repeating.
2. **Verify = Stop** = whatever you've been using to know one sub-task is done (a test, a check) + the goal-level "no items remain."
3. **Caps** = read off reality — how many remain, what budget is left, when to call it.
4. **Authority bound + Handoff** = the limits and reporting you've been applying implicitly; make them explicit.

Then hand the contract to `/loop` (supervised) or `ce-work`, or keep driving it yourself as a bounded loop. Don't silently keep doing it by hand once you've noticed the shape — the whole point is the unbounded manual grind is the failure mode.

## Where each bound is actually enforced

Prose in the prompt is a request; these make it binding.

| Contract field | Enforce with |
|---|---|
| Verify = Stop | `tdd` (write the failing check first), `/verify-this`, `dogfood`; an outer harness that re-measures *between* iterations |
| Caps (hard) | A wrapper/hook evaluating the cap **before** each iteration, not the model's discretion |
| Authority bound | `commit-precheck` / bash-safety hooks; draft-PR default; worktree-boundary |
| Escalation on failure | 2 attempts → `ce-debug` → `/codex:rescue` (cross-family) → `self-consistency`/`best-of-n` for high-stakes |
| Recurrence host | `/loop` (supervised, in-session) or `/schedule` (unattended cron) |

The model honors the *letter* of a bound only when it's also enforced *outside* the model. Put the cap and the re-measurement in the harness/hook; keep the judgment in the prompt.

## Park tangential finds — don't chase, don't drop

An iteration that spots something worth changing but outside its one unit must neither act on it (that breaks scope and the authority bound) nor lose it. **If the repo has a backlog tracker (e.g. beads/`bd`): file an issue** capturing the find, linked back to the current work (e.g. `--deps discovered-from:<this work's issue>`), then keep going — the backlog accrues the discovery while the iteration stays single-purpose. Respect the tracker's privacy/sharing rules before pushing. No tracker → route it through the loop's existing ticket/report handoff instead. Either way the rule is the same: capture and move on, don't expand the iteration.

## Auditing an existing loop — five smells

Reject or repair on any of: **weak check** (Verify is self-assessed or games a metric — see Goodhart below), **unsafe authority** (can merge/deploy/spend unattended), **unbounded repetition** (no cap, no plateau exit), **stale state** (no idempotency ledger; re-acts on handled items), **unclear stop** (can't say in one line what ends it).

**Goodhart guard:** when Verify is a number the agent can move (coverage %, lint count), add a quality gate it can't game — mutation score on touched files, a holdout set, a must-pass invariant — and forbid the cheap cheat (e.g. "never edit source to pass a test"). A metric the agent optimizes directly stops measuring what you wanted.

## Worked example (compact)

> **Trigger** daily 9am weekday `/schedule`. **Action** pick the top unhandled Sentry issue, root-cause, draft a fix. **Verify=Stop** regression test red→green, or "no qualifying issue" → stop. **Authority** draft PR only; never merge/mute. **Caps** one issue/run; stop the schedule after 3 consecutive no-op runs. **Handoff** report (issue, root cause, PR url) + append to `seen.jsonl` so it never re-opens the same issue.

## Common mistakes

- **Stop condition is "until good enough."** Replace with a measured threshold + iteration cap + plateau exit.
- **Cap lives in the prompt.** The model will talk itself past it. Move it to the harness/hook.
- **Per-iteration scope but no loop-level cap.** "One item per run" bounds the *step*, not the *loop* — you still need a total cap and a no-progress exit.
- **Verify trusts the agent.** If the check is the agent re-reading its own output, it isn't a check.
