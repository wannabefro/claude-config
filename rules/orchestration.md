---
description: Delegation and model-tiering — tiers, dispatch, drivers, summaries.
---

# Orchestration & Delegation

Main thread orchestrates: plans, decides, reviews, holds coupled reasoning. Separable work goes to
agents; coupled/iterative/architectural work stays in main. Rationale: `docs/orchestration-rationale.md`

## Implementer tiers

Per-dispatch: **Haiku** for mechanical single-file units; **Sonnet** (default) for well-specified
multi-file units; **never Opus or Fable** — that much reasoning means the unit isn't well-specified
enough to hand off, so plan harder or keep it in main. Route hard units to a *different family*
(`/codex:rescue`), never a bigger same-family implementer.

Effective policy: **`~/.claude/tier-router.json`**, overlaying shipped `policy.json`, flipping
`mode` to `all-except-skip`. Precedence, highest first: `CLAUDE_CODE_SUBAGENT_MODEL` env var →
per-dispatch `model` → `skip` list → `route[agent]` → agent's own `model:` pin → `haiku` list →
`default`. A `route` entry outranks the frontmatter pin; the env var would silently outrank the
router — leave it unset. Keep `Explore` → Sonnet routed.

Hand implementers an **executable definition of done** — a failing test or exact verify command, not
prose. Escalate review topology (SDD's 2-stage, `/council`), not the model. Never hand-roll a review
loop.

## Delegation shape

Workers need to talk? No → subagents (isolated, summary only). Yes → teams (lenses argue); not
sequential/same-file work. Pin recurring drivers (`/loop`, `looper`, `ScheduleWakeup`, cron,
unattended `ce-work`) to **Sonnet** via `model:` frontmatter — no override flag exists; escalate one
gate, not the driver.

## Fan-out

Never prefix a fan-out prompt with `cd <path> &&` — gates the whole command; use `git -C "<path>"`
and absolute paths. Out-of-session reads: `cat -n`/`sed -n`. Long dispatches (>3 files) return an
HTML summary via `SendUserFile` or `Artifact`; short work stays inline.

Roster: `implementer` is the only writer agent; built-ins: `Explore`, `Plan`, `general-purpose`.
Reviewers may be language-specialised; implementers stay generic — language toolchain belongs in the
project's own CLAUDE.md.
