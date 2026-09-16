---
description: Run structured or genuinely parallel implementation work with isolated Sonnet writers.
argument-hint: "[feature description or plan path]"
---

Build the approved work: **$ARGUMENTS**

Use `/build` when the work has multiple independent units, dependencies, or
shared contracts. Use `/implement` for one coherent unit. Opus owns the split,
contracts, integration, and final verification. Main-thread edits are allowed
for trivial work or tightly coupled changes.

For each writer, freeze the exact files, acceptance criteria, verification
command, intended base SHA, and dependency edges. Dispatch native `Agent` calls
with `subagent_type: "implementer"`, `model: "sonnet"`, and
`isolation: "worktree"`, never a named team. The implementer's frontmatter sets
high effort; choose xhigh only when the unit needs it. Run at most three writers
in parallel, and only when their owned files are disjoint and each unit needs
substantial work.

`agents/implementer.md` holds the writer-side contract: base-SHA verification,
the non-destructive repair path, dependency-patch handling, and the return
block. Do not restate it in the brief.

Integrate completed units serially. Before each integration, inspect the diff
and reject every output path outside the declared ownership. Baseline dependency
paths may remain read-only inputs. Start dependent units from the integrated
parent's new `HEAD`; independent units may continue from their verified base.
Run the assembled verification after integration and report failed or skipped
units separately.
