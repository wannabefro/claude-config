---
name: request-refactor-plan
description: Interview the user to produce a refactor plan with tiny atomic commits, written to local docs (docs/refactors/<slug>.md). Use when the user wants to plan — not yet execute — a refactor, especially one large enough to benefit from explicit scope, test strategy, and commit-by-commit sequencing.
user-invocable: true
---

# request-refactor-plan

Produce a refactor plan grounded in the codebase, captured as a local
markdown doc the user can hand to a future session (or another engineer)
for execution. **Plan only.** Do not modify code in this skill.

Adapted from mattpocock/skills/request-refactor-plan. Originally filed
plans as GitHub issues; this version writes to local docs.

## Output

Default path: `docs/refactors/<kebab-slug>.md` from the repo root.
Fallback: if `docs/` doesn't exist, ask the user before creating it. If
they decline, use `.claude/refactors/<slug>.md`.

The slug comes from a 3–6 word summary of the refactor.

## Process

Run these in order. Don't skip ahead — each step's output feeds the next.

1. **Problem discovery.** Ask the user to describe the friction in their
   own words: what hurts today, what triggered the request. Capture
   their initial solution sketch if they have one. Don't critique yet.

2. **Codebase exploration.** Verify the user's framing against the code.
   Read the relevant modules. If the project has Serena active, use
   symbolic tools (`find_symbol`, `find_referencing_symbols`,
   `get_symbols_overview`) before raw file scans. Note any mismatch
   between the user's mental model and the actual structure — surface
   it before continuing.

3. **Alternatives.** Propose 2–3 plausible approaches with one-line
   tradeoffs. Don't pick one yet; let the user react.

4. **Implementation interview.** Once an approach is chosen, drive into
   detail: data flow, types, error modes, performance, migration of
   in-flight callers, feature flags, deprecation path. Ask one focused
   question at a time. Use existing code to ground each answer where
   possible.

5. **Scope definition.** Write down what changes and what doesn't. Out-
   of-scope items become explicit non-goals so a later reader doesn't
   re-litigate them.

6. **Test coverage analysis.** Inventory what tests exist for the area.
   For each behavioral guarantee, decide: existing test suffices,
   existing test must be rewritten at the new interface, or new test
   needed. Tests at the new module boundary are preferred over tests
   pinned to internals.

7. **Commit plan.** Break the work into the smallest commits that each
   leave the program working. The principle: "make each refactoring
   step as small as possible, so that you can always see the program
   working." Each entry: one-line title + 1–3 sentence body describing
   the change and why it stands alone. Aim for 5–15 commits; if you're
   producing 30+, the refactor is probably two refactors.

8. **Write the doc.** Render the plan to `docs/refactors/<slug>.md`
   using the template below. Read it back to the user as a final check
   before saving.

## Doc template

```markdown
# Refactor: <title>

## Problem statement
<user's framing, in their words where possible>

## Solution
<chosen approach in 1–2 paragraphs>

## Commits
1. <one-line title>
   <why this commit, in 1–3 sentences>
2. ...

## Decision document
- Modules affected: <list>
- New interfaces / types: <list or "none">
- Architectural changes: <list or "none">
- Schema / API changes: <list or "none">
- Migration strategy for existing callers: <description>

## Testing decisions
<approach + per-area notes>

## Out of scope
- <non-goal>
- <non-goal>

## Further notes
<optional: open questions, follow-ups, links to related plans>
```

## Constraints

- Don't write code in this skill. The output is a doc, not a diff.
- Don't compress steps. The interview is the value; skipping to the
  template produces a plan that hasn't been pressure-tested.
- Don't promise commits you haven't traced through the code. If a step
  is "and then update all callers," the plan owes the user a count of
  callers and any non-obvious ones.
- If during exploration the refactor turns out to be smaller or larger
  than the user thought, surface that before continuing — don't
  silently rescope.
