# Orchestration & Delegation — Rationale (reference)

On-demand reference for `rules/orchestration.md` (which keeps the always-on directives). Read this
only when you want the "why" behind a rule, not on every session.

## Why there is no stuck-agent detector: four signatures, all failed

Investigated 2026-07-29 across 1,030 agent transcripts. No signal separates a stuck agent from a
finished one after the fact.

| signature | what the data says |
|---|---|
| A null or missing result | Workflow agents recorded 378 results with **0** null, and no silent gap over 435s |
| A long silence | Of 12 main-thread agents quiet for over 10 minutes, **9 ended cleanly** with `end_turn` |
| A transcript ending on an unanswered tool result | Covers **40%** of all agents, so it means nothing |
| "The session kept working during the gap" | A session transcript spans days; the later activity may be a resumption |

So the control belongs in the dispatch prompt, not in a monitor. Do not build a detector on any of
these four, and do not report an agent as hung on this evidence.

## Agent teams: the tax behind "subagents by default"

Teammates *can* carry different models — spawn them from subagent definitions and each honours its
own `model:` frontmatter (fixed at spawn; `/model` afterwards only retargets the lead). So avoiding
teams for tiering isn't about impossibility, it's the tax: every teammate is a full independent
session that reloads CLAUDE.md, MCP servers, and skills from scratch, and cost scales linearly per
teammate. The widely-quoted ~7× is specifically teammates *in plan mode*, not a constant — it's the
number that makes "do the workers need to talk to each other?" the right gate rather than a vibe
call.

## Why `Explore` is routed to Sonnet instead of left at default

`Explore` no longer defaults to Haiku — since Claude Code 2.1.198 it inherits the main model, capped
at Opus. Gathering work stays cheap only because `tier-router.json` routes it to Sonnet explicitly;
drop that route and the 120+ dispatches a typical week of `Explore` usage generates land on Opus
instead, silently multiplying the cost of every read-heavy "find out why" delegation.

## Why loop drivers get pinned, not left to inherit

An Opus driver re-reads full loop context every iteration and multiplies that read across
`max_iterations` — a 20-iteration loop pays the Opus context cost 20 times over for work that's
mostly dispatch + gate-checking + logging, not reasoning. Pinning the driver to Sonnet keeps that
repeated overhead cheap; escalating a single gate inside the loop (rather than the driver itself)
keeps the expensive model scoped to the one step that actually needs it.
