# Orchestration & Delegation — Rationale (reference)

On-demand reference for `rules/orchestration.md` (which keeps the always-on directives). Read this
only when you want the "why" behind a rule, not on every session.

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
