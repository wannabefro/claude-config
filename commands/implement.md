---
description: Implement one scoped unit with a direct Sonnet writer.
argument-hint: "[task, plan path, or one implementation unit]"
---

Implement one coherent unit: **$ARGUMENTS**

Use the main thread for a trivial edit or a tightly coupled change. Otherwise
freeze the owned files, acceptance criteria, intended base SHA, and one exact
verification command, then dispatch one native `Agent` with
`subagent_type: "implementer"`, `model: "sonnet"`, and
`isolation: "worktree"`. The implementer's frontmatter sets high effort; choose
xhigh when the unit is complex. Do not use a named team or an approval handoff
for authorized work.

`agents/implementer.md` holds the writer-side contract: base-SHA verification,
the non-destructive repair path, dependency-patch handling, and the return
block. Do not restate it in the brief.

After the handoff, inspect status and the complete diff. Reject paths outside
the frozen ownership, integrate the scoped result, and run the exact
verification command. Report the changed paths, command result, and any gap.
