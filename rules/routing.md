---
description: Skill and agent routing for the Opus planning, Luna implementation, and review loop.
---

# Routing

## Skill tie-breaks

Skill descriptions decide routing. Use the narrowest matching skill.

| Need | Route |
|---|---|
| Requirements, architecture, or a plan | `/plan` with native Opus xhigh; CE only when explicitly requested |
| One coherent implementation unit | `/implement`, exactly one Luna implementer |
| Structured implementation | `/build`, then `parallel` or `serial` Luna dispatch |
| Diagnosis | `compound-engineering:ce-debug`, then `/implement` or `/build` by scope |
| Simplification or durable learning | `compound-engineering:ce-simplify-code` or `ce-compound` |
| Review | `/review` once on the assembled diff; guardrail tier routes to full `/council` |
| Cross-family review or rescue | bounded Codex wrapper, review-only unless explicitly dispatched as Luna implementation |

Compound Engineering is on-demand. It is not a scheduler. Any CE execution
that reaches code changes returns through `/implement` or `/build`, by scope.

## Delegation

| Work | Route |
|---|---|
| Read-heavy gathering | `Explore` or a read-only research route |
| Planning and design direction | Opus xhigh in the main thread |
| One approved implementation unit | `/implement`: `implementer` dispatcher -> Codex `gpt-5.6-luna` xhigh |
| Independent approved units | `/build` parallel route, maximum three active Luna units |
| Integration and final verification | Opus xhigh in serialized order |
| CodeRabbit review threads | Existing unresolved PR threads use `coderabbit:autofix` before the selected review path; this must not force a full `/council` for a normal PR |

Never route implementation to the main thread. Never add a permanent designer
agent. UI reviewers read the frozen design contract and handoff.

Fable is a manual long-horizon option only. Verify host access before use.
Sonnet and `gpt-5.6-terra` are manual fast lanes only. Haiku is limited to
deterministic plumbing that cannot affect design, implementation, review, or
verification.
