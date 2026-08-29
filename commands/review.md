---
description: Review an assembled diff with the smallest risk-appropriate review tier
argument-hint: "[what to review, or blank for the current assembled diff]"
---

Review the assembled diff: **$ARGUMENTS**

The target must resolve to the exact checkout head and comparison base. Use
`base..head` (or `base...head`), `pr:<number>`, or the checked-out branch with
an upstream. Detached or mismatched checkouts fail closed; the workflow never
guesses `main`, `origin/main`, or `HEAD` as a missing comparison.

This is the default review entry point. Classify the diff before dispatch:

1. **Mechanical** — formatting, comments, generated output, a rename, or a
   version bump with no behavior change. Run the exact relevant gates and one
   Opus xhigh diff inspection. Do not convene `/council`.
2. **Normal** — any behavior or structure change without a guardrail surface.
   Run one independent Opus xhigh reviewer and one Codex `gpt-5.6-sol` xhigh
   outsider through `scripts/codex-run.sh`. The Codex pass is review-only,
   MCP-disabled by default, and must receive the diff inline. If it is
   unavailable, stalled, empty, or refused, report the gap. Do not substitute.
3. **Guardrail** — authentication or authorization, payments or money movement,
   migrations, schema or data mutation, permissions, secrets or cryptography,
   public API contracts, destructive actions, or high-impact concurrency. Run
   the full `/council` on the assembled diff. Do not reduce the council to a
   normal pass.

State the selected tier and the evidence for it. The normal tier is not a
15–25-agent council. It is exactly one Opus reviewer plus one Codex outsider.
The mechanical tier is not a council. An explicit `/council` request always
means the full existing council, even for a mechanical diff.

When reviewing tests, apply the repository's valuable-tests rule: each changed
test must prove an observable invariant or plausible regression, fail if that
behaviour is removed, use a realistic narrow boundary, and stay deterministic.
Reject tautologies, implementation mirrors, excessive mocks, empty snapshots,
source-regex or call-count claims, and serialized-only concurrency checks.

For an open PR with unresolved CodeRabbit threads, use the narrow CodeRabbit
autofix path first. Do not duplicate those threads as a universal pre-review.

Run the selected path through the Workflow tool when available:

```json
{
  "scriptPath": "~/.claude/workflows/review.js",
  "args": { "target": "$ARGUMENTS", "repoPath": "<absolute path, only if outside this session>" }
}
```

If the result has `tier: "guardrail"`, invoke `/council` on the same
`bundle_path` returned by the workflow so classification and council inspect
identical bytes. That is an explicit ownership transfer; `/council` cleans the
bundle after its lenses and judge, including failure paths. The bundle is
secret-scanned before any cross-provider Codex transfer and blocks on a match.
If Workflow is disabled, perform the same classification and report
which review passes ran. Never change the model, effort, or writer family.
Reviewers do not write code.
