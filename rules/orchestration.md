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

## When an agent seems stuck

**Bound it at dispatch; do not try to detect it afterwards.** Investigated 2026-07-29 across 1,030
agent transcripts and found no reliable way to tell a stuck agent from a finished one after the fact.
Four signatures were tried and all four failed: workflow agents recorded 378 results with **0** null
and no silent gap over 435s; of 12 main-thread agents that went quiet for over 10 minutes, **9 ended
cleanly** with `end_turn`; a transcript ending on an unanswered tool result covers **40%** of all
agents, so it means nothing; and "the session kept working during the gap" proves nothing either,
because a session transcript spans days and the later activity may be a resumption. Do not build a
detector on any of these, and do not report an agent as hung on this evidence.

What is certain is narrower, and it is a property of the tool: **an `Agent` dispatch has no timeout.**
Nothing ends it. So the control has to be in the prompt.

- **Give every dispatch a self-bound.** Say what to do when the work does not converge: "if you do not
  have the answer after roughly 20 tool calls, return what you have and name what is missing." A
  partial answer with a stated gap is useful; an agent still running after an hour is not.
- **Never idle waiting on a background agent.** The harness re-invokes you when one finishes, so
  polling is waste. If nothing is left to do and no notification has arrived, say that to the user
  rather than sitting.
- **Bound the foreign CLI, always.** `codex exec` is the one component measured to stall often —
  `codex-exec-recovery` gives the rule: zero output for about 2 minutes means stalled, not slow. Kill
  it, then re-run with the context pasted inline so the run needs no tool use. Run it through
  `scripts/codex-run.sh`, which enforces a timeout and returns an exit code you can branch on.
- **A long agent is not a stuck agent.** Median main-thread dispatch is 246s and p90 is 963s, so 15
  minutes is ordinary for `implementer`. Re-dispatching on suspicion costs more than waiting.

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
