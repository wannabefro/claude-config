---
description: Cross-project engineering principles — conflict resolution, test invariants, ambiguity handling.
---

# Engineering Principles

## Surface conflicts, don't average them

When two patterns in the codebase contradict, pick one — prefer the more recent or more tested — and
say why. Flag the other for cleanup. Don't blend them into a third hybrid that matches neither; a
silent average leaves no anchor for the next reader.

## Tests must encode why, not just what

A test that still passes after the business rule it guards changes is the wrong test. Name the
invariant in the test name or a one-line comment. Behaviour-only assertions (`returns 200`, `dict has
key "id"`) are insufficient when the point of the code is a specific rule.

## Name the readings when a request is ambiguous

If a non-trivial prompt admits more than one reasonable reading, say so in a sentence and pick a
default — enough that I can redirect cheaply, not an exhaustive survey. Silent disambiguation is the
failure mode; the cost is discovering 20 minutes in that I meant the other one.
