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

**`/build`'s `depends_on` sequences agents; it does not compose their code.** Every worktree branches
from the *base* commit, and a dependency's result reaches its dependent as prose. So a depth-2 unit
verifies green against a tree that never contained depth-1's work — and where both touch the same
contract, they ship contradictory designs, not a merge conflict. Two consequences, both load-bearing:
**commit anything the units must see before dispatching** (an isolated worktree cannot see untracked
files — a plan, a fixture, a prior unit's output), and **treat only depth-1 as buildable per wave**.
Merge each wave, then re-dispatch the next from the new HEAD. Measured 2026-07-28: an 8-unit run
reported 4 green, of which only the 2 roots were mergeable.

Depth-1-only is now enforced in `build-parallel.js` — deeper units come back `deferred` rather than
being built blind — so it is no longer discipline you have to remember. The untracked-file half
still is, and it bites harder since plans moved: `docs/plans/` is a globally-ignored symlink, so a
worktree does **not** contain it. A unit whose `notes` say "see the plan" is telling an agent to read
a file it cannot see. Put what the unit needs in the unit.

Roster: `implementer` is the only writer agent; built-ins: `Explore`, `Plan`, `general-purpose`.
Reviewers may be language-specialised; implementers stay generic — language toolchain belongs in the
project's own CLAUDE.md.
