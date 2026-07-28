---
description: Skill/agent routing — tie-breaks between overlapping skills, and the delegation table.
---

# Routing

## Tie-breaks between overlapping skills

Skill descriptions do the routing; this table only settles overlaps:

| Overlap | Prefer |
|---|---|
| `ce-debug` / `superpowers:systematic-debugging` | `ce-debug` |
| `/council` / `ce-code-review` | `/council` is the default review path; `ce-code-review` only inside a blank `ce-work` run |
| `ce-plan` / `superpowers:writing-plans` / `Plan` agent | `ce-plan`; `Plan` only for architecture-only design |

## Delegation

Main thread orchestrates; separable work goes to agents. Tiering/dispatch → `rules/orchestration.md`.

| Work | Route |
|---|---|
| Read-heavy gathering, audit, "find out why" | `Explore` (codebase) / `general-purpose` (multi-step) |
| Executing any approved work, any size | `/build` — it routes to parallel/ce-work/inline itself; pre-judging is the mistake |
| Well-specified unit, or work `/build` routed to `inline` | `implementer` — review the returned diff |
| Review — default for a diff you own | `/council` — outranks `coderabbit:code-review` despite its "default review skill" description |
| Review inside a blank `ce-work` run | `ce-code-review` — hardwired there; don't fight it |
| CodeRabbit threads on an open PR | `coderabbit:autofix` — `gh`-only, works on every machine |
| Same bug after 2 failed Claude attempts | `/codex:rescue` |
| Large bounded task that'd eat the main thread | `/codex:rescue --background` |

Review at checkpoints, not per edit.

**Deleted 2026-07-28**, after measuring 0 invocations each across 895 transcripts: `sam-review`,
`self-consistency`, `best-of-n`, `verify-this`, `thermo-nuclear-code-quality-review`, `diagnose`,
`control-cli`, `control-ui`, `improve-codebase-architecture`, plus the `spec-deriver` and
`test-writer` agents and the unregistered `self-consistency-nudge.sh`. Recoverable from git;
evidence and method in `docs/routing-rationale.md`.

**CodeRabbit's CLI is machine-local; its GitHub app is not.** `coderabbit:code-review` needs a
`coderabbit` binary that exists on only some machines — never route to it unhanded. `autofix` needs
only `gh`. Don't offer to install the CLI to unblock a review; use `/council`.
