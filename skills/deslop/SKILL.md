---
name: deslop
description: Use when a branch diff contains AI-generated slop — redundant comments, defensive try/catch on trusted paths, `any` casts, deep nesting, bespoke helpers duplicating existing utilities, or code dumped into an already-large file. Trigger phrases - "deslop", "/deslop", "clean up the slop", "remove AI slop".
---

# Remove AI code slop

Check the diff against main and remove AI-generated slop introduced in the branch.

## Focus Areas

- Extra comments that are unnecessary or inconsistent with local style
- Defensive checks or try/catch blocks that are abnormal for trusted code paths
- Casts to `any` used only to bypass type issues
- Deeply nested code that should be simplified with early returns
- Bespoke helpers that duplicate an existing utility in the codebase or an already-installed library — consolidate onto the canonical one
- New code appended to an already-large or unrelated file when it belongs in its own module — move it (god files grow one "convenient" addition at a time)
- Other patterns inconsistent with the file and surrounding codebase

## Guardrails

- Keep behavior unchanged unless fixing a clear bug.
- Prefer minimal, focused edits over broad rewrites.
- Keep the final summary concise (1-3 sentences).

For deeper reuse/simplification passes use `/simplify`; for a strict maintainability review use `/thermo-nuclear-code-quality-review` — this skill is the quick slop sweep on the current branch diff.
