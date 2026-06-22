---
description: Cross-project engineering principles — conflict resolution, test invariants, ambiguity handling, partial-success honesty. Framing rules that complement operational guidance in workflows.md.
---

# Engineering Principles

These are framing rules that complement the operational guidance in
`workflows.md`. Apply them on non-trivial work; use judgment on trivial tasks.

## Surface conflicts, don't average them

When two patterns in the codebase contradict, pick one — prefer the more
recent or more tested — and explain why. Flag the other for cleanup. Do not
blend conflicting patterns into a third hybrid that matches neither. A
silent average is worse than either original, because it leaves no anchor
for the next reader to follow.

## Tests must encode why, not just what

A test that still passes after the business rule it guards changes is the
wrong test. The point of a test is to fail when the invariant is violated —
not to assert that the code does what the code does. Name the invariant in
the test name or a one-line comment. Behavior-only assertions (`returns
200`, `dict has key "id"`) are insufficient when the point of the code is a
specific rule.

## Present interpretations when ambiguous

On non-trivial requests, if the prompt admits more than one reasonable
reading, list the interpretations before acting. Pick a default and say
why, but make the alternatives visible so the user can redirect cheaply.
Silent disambiguation is the failure mode — discovering after 20 minutes
of work that the other reading was intended is the cost.

## Fail loud on partial success

"Done" is wrong if any step was skipped. "Tests pass" is wrong if any were
skipped, xfailed, or never ran. "Verified" is wrong if the verification
command errored and you moved on. Name what was skipped and why; do not
let incomplete work read as complete. The end-of-turn summary is the place
this most often slips — be specific about what was *not* done.

## Comment sparingly — code should explain itself

Default to fewer comments. Make the code self-documenting through clear names
and small functions instead of narrating it. Add a comment only when it
captures something the code cannot: *why* a non-obvious choice was made, a
workaround and its cause, an invariant that must hold, or a genuine gotcha.
Never write a comment that restates what the line already says, labels an
obvious section, or narrates steps. When editing existing code, match or
reduce the surrounding comment density — do not introduce comments the
original author wouldn't have. Skip docstrings/headers on trivial or
self-evident functions. Prefer deleting a stale comment to updating it.
