---
description: Execute one frozen implementation unit through exactly one Sonnet writer
argument-hint: "[task, plan path, or one implementation unit]"
---

Implement one coherent, clearly scoped unit: **$ARGUMENTS**

Use this path when the change normally touches one or two files, has no shared
contract, has no dependency on another implementation unit, and does not touch
a guardrail surface. If those conditions do not hold, use `/build`.

## Freeze before dispatch

Opus xhigh must write a short brief that names all five items below before it
dispatches an agent:

- exact working directory;
- exact repo-relative files owned by this unit;
- acceptance criteria;
- one exact verification command;
- any interfaces or guardrail surfaces that make this unit ineligible.

Dispatch exactly one existing `implementer` agent with that brief. The
implementer writes with Sonnet at xhigh effort inside the frozen ownership.
The implementer must run the exact verification command after it writes.

Do not write in the main thread. Do not dispatch a second worker. Do not use a
native main-thread write, Terra, Haiku, Fable, or a direct Codex command as a
substitute. Report any limitation.

Inspect status and the complete diff after the handoff. Confirm that all files
stay inside the frozen ownership. Then run `/review` on the assembled diff.
