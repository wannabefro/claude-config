---
description: Skill/agent routing — tie-breaks between overlapping skills, and the delegation table.
---

# Routing

## Tie-breaks between overlapping skills

Skill descriptions do the routing; this table only settles overlaps:

| Overlap | Prefer |
|---|---|
| `ce-debug` / `diagnose` / `superpowers:systematic-debugging` | `ce-debug` |
| `/council` / `ce-code-review` | `/council` is the default review path; `ce-code-review` only inside a blank `ce-work` run |
| `ce-plan` / `superpowers:writing-plans` / `Plan` agent | `ce-plan`; `Plan` only for architecture-only design |

## Delegation

Main thread orchestrates; separable work goes to agents. Tiering/dispatch → `rules/orchestration.md`.

| Work | Route |
|---|---|
| Read-heavy gathering, audit, "find out why" | `Explore` (codebase) / `general-purpose` (multi-step) |
| Any approved plan | `/build`; `decomposable:false` is a real answer for coupled work |
| Well-specified unit, or work `/build` called coupled | `implementer` — review the returned diff |
| Review — default for a diff you own | `/council` |
| Review inside a blank `ce-work` run | `ce-code-review` — hardwired there; don't fight it |
| Same bug after 2 failed Claude attempts | `/codex:rescue` |
| Large bounded task that'd eat the main thread | `/codex:rescue --background` |

Review at checkpoints, not per edit.

**Retired** — do not route to `sam-review`, `self-consistency`, `best-of-n`, `verify-this`; evidence
in `docs/routing-rationale.md`.
