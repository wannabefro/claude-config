---
description: Delegation and model-tiering decisions — implementer tiers, dispatch quality, loop drivers, chunky-deliverable summaries.
---

# Orchestration & Delegation

The main thread orchestrates: it plans, decides, reviews, and holds coupled reasoning. Separable work
goes to agents. Coupled, iterative, or architectural work stays in main — delegating it costs more
than it saves.

## Implementer tiers

`implementer` is the writer agent, and its tier is per-dispatch:

- **Haiku** — mechanical single-file units: renames, boilerplate, rote refactors.
- **Sonnet** (default) — well-specified multi-file units.
- **Never Opus or Fable.** If writing a unit needs that much reasoning it isn't well-specified enough
  to hand off — plan it harder, or keep it in main. For genuinely hard units route to a *different
  family* (`/codex:rescue`), not a bigger same-family implementer. The `tier-router` hook enforces
  this with a `deny` rule, so a dispatch that tries it is blocked rather than quietly downgraded.

The effective routing policy is **`~/.claude/tier-router.json`**, which overlays the plugin's shipped
`policy.json` — and it flips `mode` to `all-except-skip`, so reading the shipped policy alone gives
the wrong answer. Precedence, highest first: `CLAUDE_CODE_SUBAGENT_MODEL` env var → per-dispatch
`model` → `skip` list → `route[agent]` → the definition's own `model:` pin → `haiku` list →
`default`. Two consequences worth holding: a `route` entry **outranks** an agent's own frontmatter
pin, and the env var would silently outrank the router — leave it unset. Agents that must keep an
expensive tier are kept in `skip` rather than routed.

`Explore` no longer defaults to Haiku (since 2.1.198 it inherits the main model, capped at Opus), so
gathering stays cheap only because the router sends it to Sonnet. Drop that route and 120+ dispatches
land on Opus.

Dispatch quality is the whole game: hand the implementer an **executable definition of done** — a
failing test or the exact verify command — not a prose paragraph. That turns its self-verification
into a pass/fail gate. For hard or high-stakes units escalate the *review topology* —
`subagent-driven-development`'s 2-stage, or `/council`, whose cross-examination pass is the same idea
with more lenses — not the writer's model.

Never hand-roll a review loop; reuse SDD's 2-stage, `/council`, or `ce-code-review`.

## Agent teams: parallelism with discussion, not tiering

Teammates *can* carry different models — spawn them from subagent definitions and each honours its
own `model:` frontmatter (fixed at spawn; `/model` afterwards only retargets the lead). So avoiding
teams for tiering isn't about impossibility, it's the tax: every teammate is a full independent
session that reloads CLAUDE.md, MCP servers and skills from scratch, and cost scales linearly per
teammate. The widely-quoted ~7× is specifically teammates *in plan mode*, not a constant.

Decision rule: **do the workers need to talk to each other?** If only the result matters, use
subagents — their verbose work stays isolated and only a summary returns. Teams earn the tax when
lenses must argue: multi-lens review of one diff, competing debugging hypotheses, teammates each
owning a slice of a new module. Not for sequential work, same-file edits, or dependency-heavy work.

## Loop drivers are dispatched writers

A recurring or autonomous driver (`/loop`, `looper`, `ScheduleWakeup`, cron, long unattended
`ce-work`) does dispatch + gate-checking + logging, so **pin it to Sonnet**. An Opus driver re-reads
full loop context every iteration and multiplies that across `max_iterations`. Escalate individual
gates when one is genuinely guardrail-critical; never promote the whole driver to cover one hard step.
Neither `/loop` nor `ScheduleWakeup` takes a model override — pin it in the driving agent's `model:`
frontmatter.

## Approval cost scales with fan-out

A command shape that needs one approval when you run it needs N when N agents each run it. Before
fanning out, check that everything the agents will run is already auto-allowed — and in particular
**never put a `cd /some/path &&` prefix in a fan-out prompt.** A `cd` outside the session directory
gates the whole compound command, so ~30 free read-only calls become ~30 prompts per member. Use
`git -C "<path>"` and absolute paths; both stay auto-allowed. Same failure shape as any env-var or
`unset` prefix. The `Read` tool is also refused outside the session root, so out-of-session reads
need `cat -n`/`sed -n` with an absolute path.

## Chunky deliverables get an HTML summary

When a dispatched agent finishes work a prose reply would bury — a multi-file implementation, a
research sweep, a plan, a migration, roughly >3 files or more than a few minutes — have it write an
HTML summary and return the path. Surface it with `SendUserFile` (`display: render`), or publish an
`Artifact` when I'd want to read it from my phone. Lead with the outcome, then what changed and why,
then residual risk. Below that threshold, stay inline.

## Roster

`implementer` is the only custom writer agent. Built-ins: `Explore`, `Plan`, `general-purpose`.
Reviewers may be language-specialised (CE ships several); implementers stay generic — language
toolchain belongs in the project's own CLAUDE.md.
