---
description: Which tool, skill or agent handles which job — tie-breaks between overlapping skills, and the delegation table.
---

# Routing

## Tie-breaks between overlapping skills

Skill descriptions do the routing. This table only settles cases where several genuinely match:

| Overlap | Prefer | Why |
|---|---|---|
| `ce-debug` / `diagnose` / `superpowers:systematic-debugging` | `ce-debug` | its output feeds `ce-work` |
| `/council` / `ce-code-review` | `/council` | it is the default review path. `ce-code-review` is only correct inside a blank `ce-work` run, where it is hardwired and cannot be overridden from outside — and there you do *not* also run council |
| `ce-plan` / `superpowers:writing-plans` / `Plan` agent | `ce-plan`; `Plan` only for architecture-only design | the plan file is the durable checkpoint |
| `dogfood` / `verify-this` | `dogfood` to exercise a change; `verify-this` to prove one measurable claim | different jobs, similar triggers |

## Delegation

Main thread orchestrates; separable work goes to agents. Tiering, dispatch quality and agent-team
trade-offs are in `rules/orchestration.md`.

| Work | Route |
|---|---|
| Read-heavy gathering, audit, "find out why" | `Explore` (codebase) / `general-purpose` (multi-step) |
| Any approved plan — start here | `/build` — it reports the split first; `build:true` fans out. `decomposable:false` is its real answer for coupled work, not a failure |
| Well-specified unit, or work `/build` called coupled | `implementer` — then review the returned diff |
| Review — the default for any diff you own | `/council` — Haiku triages, then seats only what the diff earned. Needs `ce-work mode:return-to-caller`, or a diff built by `/build` |
| Review inside a blank `ce-work` run | `ce-code-review` — hardwired there; don't fight it, and don't double up with council |
| Same bug after 2 failed Claude attempts | `/codex:rescue`, or `/codex:adversarial-review` |
| Large bounded task that'd eat the main thread | `/codex:rescue --background` |

Review at checkpoints, not per edit.

**Retired 2026-07-27** — do not route to these; they went unused across 43 measured sessions and two
of them were what the hooks pointed at: `sam-review`, `self-consistency`, `best-of-n`, `verify-this`.
The skills remain on disk and can still be invoked by name deliberately; they are simply no longer
part of the decision. Cross-family second opinions go to `/codex:*` or the council's outsider seat.
