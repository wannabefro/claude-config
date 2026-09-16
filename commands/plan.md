---
description: Create only the plan needed for a non-trivial change, then run one Codex review.
argument-hint: "[what to plan — a specified feature, open question, or requirements doc]"
---

Plan: **$ARGUMENTS**

Use a plan when requirements, interfaces, dependencies, or a costly decision
need to be made explicit. Routine, reversible work needs no plan. Opus writes
the plan and records only the necessary decisions, owned paths, acceptance
criteria, and verification commands. Route implementation through `/implement`
or `/build` after the plan.

Review each authored plan once with Codex. Put the plan and the review request
inline in a private brief file, then run the existing wrapper. Use separate
tool calls:

1. Run `umask 077; mktemp -d "${TMPDIR:-/tmp}/claude-plan-review.XXXXXXXX"`
   and retain the absolute path printed by Bash.
2. Use the `Write` tool on that observed path plus `/plan-review.txt`. Write
   the plan and review-only request to the file.
3. Run the wrapper with the same observed absolute path. Substitute the path
   literally; do not execute the placeholder in this document.
4. Remove that exact private directory after the wrapper returns.

```bash
umask 077
# After the Write tool call, replace the path below with its observed absolute path.
test -s /tmp/claude-plan-review.XXXXXXXX/plan-review.txt
~/.claude/scripts/codex-run.sh -f /tmp/claude-plan-review.XXXXXXXX/plan-review.txt -N
```

The wrapper performs its existing secret scan and failure detection. An empty,
stalled, refused, unavailable, or failed run is a missing review. Do not call a
second model or describe the plan as approved. Record the Codex result or gap,
then hand off the plan path.
