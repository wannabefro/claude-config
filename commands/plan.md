---
description: The entry point for planning any work — decides whether it needs brainstorming first, produces the plan with ce-plan, and runs the cross-model Codex review when the stakes earn it
argument-hint: "[what to plan — a vague idea, a specified feature, or a requirements doc. Any size.]"
---

Plan: **$ARGUMENTS**

**Start here for any planning, and don't pre-judge the shape** — same contract as `/build`. Three
stages; each is skipped or run on stated criteria, not on a question back to the user.

## Stage 1 — brainstorm, only if the scope isn't decided

Run `ce-brainstorm` first when **any** of these hold:

- the ask names a goal but not a shape ("make onboarding better", "we need billing")
- more than one reasonable product answer exists and picking wrong is expensive
- you'd otherwise be inventing the requirements yourself inside `ce-plan`

Skip it when the ask already specifies the change, when there's a requirements doc or a design source
of truth to follow, or when it's a bug fix. Say in one line which way you went and why.

Skipping a needed brainstorm is the costlier error: `ce-plan` will produce a confident,
implementation-ready plan for the wrong thing, and it reads as finished.

## Stage 2 — plan

Run `ce-plan`. Hand it the brainstorm output if stage 1 ran; otherwise the task verbatim.

For a deep non-code deliverable, have `ce-plan` plan *how it will produce* the deliverable first.

## Stage 3 — cross-model review, on stakes

**Exactly one pass from the family that didn't author the plan.** Claude authored it, so that's
Codex. Run it when the plan touches a guardrail surface — auth, payments, migrations or schema, data
mutations, public API, permissions — or when it is large enough that a wrong shape is expensive to
discover during the build. Skip it for small, reversible, single-surface plans and say you skipped it
and why, so it can be asked for.

Use the wrapper, which bounds the run and makes the outcome unambiguous:

```
~/.claude/scripts/codex-run.sh -t 600 "Review this plan as an outside engineer from a different
model family. Do NOT implement anything. Inline the plan below. Name: wrong assumptions, missing
edge cases, unit boundaries that will not survive contact with the codebase, and anything the plan
asserts about existing code that is not true. Be specific — cite the unit or section.

<paste the plan file contents inline>"
```

Inline the plan text rather than passing a path: a stalled run is almost always hung on tool use, and
a review that needs no file reads cannot stall that way.

Branch on the exit code, don't read the output shape:

| exit | meaning | what to do |
|---:|---|---|
| 0 | reviewed | fold the findings into the plan, then say what changed |
| 3 | Codex unavailable | report that the cross-model pass **did not happen** — do not retry or hunt processes |
| 4 | stalled, killed | one retry with the plan inlined more tightly; then report it as not done |
| 5 | empty pass | **this does not satisfy the cross-model review** — report it rather than finalising |

Never recurse into multiple cross-reviews, and never let Codex rewrite the plan — it reviews only.

## Finishing

Report the plan path, which stages ran, and which were skipped with the reason. Then hand over the
build step: `/build <plan-path>`. A `PostToolUse` hook already offers this when the plan looks worth
a fan-out; if it fires, don't repeat the offer in different words.

Don't ask whether to proceed to `/build` — say the command and stop. Approval of the plan is the
user's call; queueing it isn't.
