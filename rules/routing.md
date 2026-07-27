---
description: Which tool, skill or agent handles which job — tie-breaks between overlapping skills, and the delegation table.
---

# Routing

## Tie-breaks between overlapping skills

Skill descriptions do the routing. This table only settles cases where several genuinely match:

| Overlap | Prefer | Why |
|---|---|---|
| `ce-debug` / `diagnose` / `superpowers:systematic-debugging` | `ce-debug` | its output feeds `ce-work` |
| `/council` / `ce-code-review` | depends who owns the tail — see `rules/pipeline.md` | `ce-work` hardwires `ce-code-review` ("one portable path"), so preferring council inside a normal `ce-work` run is not a preference the runtime can honour |
| `sam-review` vs its own components (`thermo-nuclear-…`, `ce-code-review`, `coderabbit:code-review`) | `sam-review` | it already chains them — running both double-reviews the same diff. Reach for it over `/council` only when the CodeRabbit pass is the point |
| `ce-plan` / `superpowers:writing-plans` / `Plan` agent | `ce-plan`; `Plan` only for architecture-only design | the plan file is the durable checkpoint |
| `dogfood` / `verify-this` | `dogfood` to exercise a change; `verify-this` to prove one measurable claim | different jobs, similar triggers |

## Delegation

Main thread orchestrates; separable work goes to agents. Tiering, dispatch quality and agent-team
trade-offs are in `rules/orchestration.md`.

| Work | Route |
|---|---|
| Read-heavy gathering, audit, "find out why" | `Explore` (codebase) / `general-purpose` (multi-step) |
| Well-specified implementation of a plan | `implementer` — then review the returned diff |
| A plan whose units are independent | `/build` — it reports the split first; `build:true` fans out |
| Review inside a normal `ce-work` run | `ce-code-review` — it is hardwired there; don't fight it |
| Review you own: guardrail diff, or pre-PR | `/council` — Haiku triages, then seats only what the diff earned. Needs `ce-work mode:return-to-caller`, or a diff built by `/build` |
| Pre-PR where the CodeRabbit pass is the point | `/sam-review` |
| Same bug after 2 failed Claude attempts | `/codex:rescue`, or `/codex:adversarial-review` |
| Large bounded task that'd eat the main thread | `/codex:rescue --background` |

Review at checkpoints, not per edit. The thermo-nuclear lens is intentionally strict — surface its
findings bluntly rather than softening them.
