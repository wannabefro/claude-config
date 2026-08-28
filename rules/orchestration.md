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

**Haiku needs all four, or use Sonnet.** One file, and you already know which. A verify command that
fails now and passes when done. No API or contract decision left open. An edit that transforms rather
than invents — a rename, a mechanical refactor, a known pattern applied.

Pass `model: "haiku"` per dispatch. It outranks `route` and the frontmatter pin, so this needs no
change to `tier-router.json`, and the `deny` list blocks only Opus and Fable.

**A Haiku failure is evidence about the unit, not the model.** The Opus rule says too much reasoning
means the unit was not well specified. The same holds downward: decompose further, do not upgrade.
Speed is also the wrong reason. Median dispatch is 246s, and tool round trips dominate that. A
smaller model does not reduce them. Measure first-pass review success over 15-20 dispatches before you
move anything into the `haiku` list.

## Before spending: is the question still worth answering?

**The most expensive failure is not a stuck agent or a wrong answer. It is a correct, bounded,
green result that nobody needed.** Nothing goes red, so nothing catches it.

The case that named this: a 49-flow sweep ran about two hours to answer "does the level map still
work?", while a later unit in the same plan deleted the level map and rewrote all 47 flows that
referenced it. The sweep was well-formed and it passed. The plan already contained the fact that
made it pointless.

Ask this before any dispatch you expect to run long, and again before any broad sweep:

1. **After the whole plan lands, does this thing still exist?** If a later unit deletes or rewrites
   the subject, the answer is already known and the work is waste.
2. **Would a different answer change what I do next?** If both outcomes lead to the same action,
   do not buy the answer.
3. **Can the cheap invalidating work go first?** Demolition before verification, always. Then you
   verify once, against what actually survives, instead of twice against two different worlds.

`/build` enforces the first one: a unit declares what it destroys in `removes`, and a unit that
touches a removed name without depending on the remover is refused as `invalidated-work`. The fix is
to order the remover first — or to delete the verifying unit, because the plan has already answered
its question. Outside `/build` there is no enforcement, so ask the three questions yourself.

## When an agent seems stuck

**Bound it at dispatch; do not try to detect it afterwards.** Four detection signatures were tried
across 1,030 agent transcripts on 2026-07-29, and all four failed. **Do not build a detector, and do
not report an agent as hung.** The four signatures and why each one fails:
`docs/orchestration-rationale.md`.

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
