---
description: Execute structured multi-unit work through the Opus decomposer and Codex Luna implementation route.
argument-hint: "[feature description or plan path]"
---

Build the approved work: **$ARGUMENTS**

Use `/build` for structured work: multiple units, dependencies, shared
contracts, coupled multi-file work, or genuinely parallel work. For one
coherent unit with no shared contract or guardrail surface, use `/implement`.
Opus xhigh must freeze the dependency graph, interfaces, file ownership,
acceptance criteria, private worktree workspace, and exact verify commands before
any worker starts. The index, tracked working tree, relevant untracked state,
and every declared ignored dependency baseline is fingerprinted with its exact
content, mode, and symlink topology at approval and checked again before
dispatch. Ignored dependencies are hydrated one-way into private worktrees;
any worker mutation under an approved baseline fails closed and never becomes a
canonical change.

## Step 0 — Workflow preflight

Run:

```bash
~/.claude/scripts/workflow-available.sh build-parallel.js
```

If the exit code is `0`, call `build-parallel.js`. If the exit code is `1`,
report that Workflow is disabled and apply the degraded checks below. If the
exit code is `2`, report the missing script and stop.

## Step 1 — Decompose with Opus

Call the Workflow tool with:

```json
{
  "scriptPath": "~/.claude/workflows/build-parallel.js",
  "args": { "task": "$ARGUMENTS" }
}
```

Pass `args` as an object. The result must use `route: "parallel"` or
`route: "serial"`.

`serial` means one `implementer` starts immediately in one deterministic private
worktree. The implementer is an Opus dispatcher and verifier; Codex
`gpt-5.6-luna` xhigh performs the writes. A final fingerprint/HEAD check runs
before that dispatch, and the helper rejects any post-write path outside the
declared ownership before integration. The serial brief contains one frozen
aggregate `set -e` verification command; every exact unit gate runs in its own
fail-fast subshell rooted at the private worktree, and the first failure blocks
integration.
`parallel` means the split needs approval before dispatch and has maximum DAG
frontier width of at least two. Show the returned
`plan_payload`, `plan_id`, `plan_hash`, frozen `base_commit`, and working-tree
fingerprint, then show each unit's exact files,
contracts, dependencies, acceptance criteria, absolute working directory,
workspace, ignored dependency baselines, and verify command. After approval, re-run with the exact frozen
payload and integrity fields:

```json
{
  "task": "$ARGUMENTS",
  "build": true,
  "plan_payload": "<the exact returned payload>",
  "plan_id": "<the exact returned plan_id>",
  "plan_hash": "<the exact returned plan_hash>"
}
```

Do not call the decomposer again, edit the payload, or reconstruct it from the
display. The workflow rejects missing, stale, or tampered payloads before any
unit starts. The scheduler allows no more than three active Luna units, starts
every currently-ready independent unit concurrently, creates one exact private
git worktree per unit, and integrates completed patches in worker completion
order behind a canonical read/write lock. Refresh snapshots may overlap each
other but never overlap a canonical integration; dependencies still wait for
their predecessors' completed integration, but an unrelated slow unit cannot
block a ready dependent. A
worktree preparation or ownership check failure blocks the fan-out;
shared-checkout execution is never a fallback.

## Degraded route

When Workflow is disabled, perform the same file ownership and contract checks
manually. Freeze and recheck the index, tracked working tree, and relevant
untracked fingerprint before dispatch. Canonicalize each owned path, reject
symlink aliases, create exact private worktrees, and reject any patch that
escapes its unit's owned paths.
Preserve the approved absolute working directory and start every currently
ready independent unit concurrently, up to three. Do not write in the main
thread. Report missing verify commands and unavailable Luna runtime.

## After implementation

Inspect `git status --short` and the complete diff. Integrate under the
canonical write lock; dependency edges, not unrelated unit IDs, determine when
a unit is eligible. Do not merge automatically. Run `/review` once on the
assembled diff. If it classifies the diff as guardrail, run the full `/council`
before final verification under Opus.

Compound Engineering remains available for explicit brainstorm, plan, debug,
simplify, review, and compound learning. It never replaces the Luna writer
boundary. Any CE execution that reaches code changes returns through
`/implement` or `/build`, according to scope.
