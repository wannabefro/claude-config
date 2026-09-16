---
description: Review the assembled diff with Opus and one independent Codex pass when behavior changes.
argument-hint: "[what to review, or blank for the current assembled diff]"
---

Review the assembled diff: **$ARGUMENTS**

Resolve and record the actual target. An explicit `base..head`, `base...head`,
`pr:<number>`, or detached comparison is valid when every named ref resolves to
the requested checkout. With no target, review the current staged, unstaged,
and new-file changes; an upstream is not required. Refuse only an unresolved or
mismatched explicit target. Never guess a base branch.

Opus inspects the diff and classifies it as mechanical or behavior-changing.
For a mechanical change, run the relevant gates and complete the Opus
inspection. For a behavior change, read every changed file in full, inspect the
diff, and run one independent Codex review. Do not create a council or add a
second review tier automatically.

Create a private brief that contains the exact diff, relevant file context, the
recorded target, and a review-only request. Include a full changed-file snapshot
when the diff does not provide enough context. Use separate tool calls:

1. Run `umask 077; mktemp -d "${TMPDIR:-/tmp}/claude-review.XXXXXXXX"` and
   retain the absolute path printed by Bash.
2. Use the `Write` tool on that observed path plus `/review.txt`. Write the
   diff, context, target, and review request to the file.
3. Run the wrapper with the same observed absolute path. Substitute the path
   literally; do not execute the placeholder in this document.
4. Remove that exact private directory after the wrapper returns.

```bash
umask 077
# After the Write tool call, replace the path below with its observed absolute path.
test -s /tmp/claude-review.XXXXXXXX/review.txt
~/.claude/scripts/codex-run.sh -f /tmp/claude-review.XXXXXXXX/review.txt -N
```

The wrapper performs its existing secret scan and failure detection. Exit 0
with an assistant result is a review. Empty, stalled, refused, unavailable,
failed, or secret-scan-blocked runs are gaps; report the exact status and do not
substitute another model.

Apply clear, in-scope defects in the current authorized task. Keep review
feedback separate from implementation ownership, and report what ran and what
remains uncertain.
