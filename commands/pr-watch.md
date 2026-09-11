---
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh api:*), Bash(git branch:*), Bash(mkdir:*), Bash(test:*), Bash(rm:*), Bash(date:*), Read, Write, ScheduleWakeup
description: Watch the current task's PR — poll CI to completion and surface unresolved review comments
argument-hint: "[pr-number-or-url]"
---

## Purpose

One-stop check (and optional background loop) for the current task's PR. Handles both CI status polling and unresolved review comment surfacing. Designed to be invoked from `rules/shipping.md` at natural checkpoints, and to re-invoke itself via `ScheduleWakeup` while CI is pending.

## Resolve the PR

- If `$ARGUMENTS` is non-empty, treat it as the PR number or URL.
- Otherwise, run `gh pr view --json number,url,headRefName` to resolve the PR for the current branch.
- If no PR exists for the branch and no argument was given, report "no PR found for current branch" and exit. Do not create one.

## Snapshot

Run once per invocation:

```
gh pr view <pr> --json number,url,state,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,reviewThreads,comments,reviews
```

- `state` — OPEN / CLOSED / MERGED.
- `statusCheckRollup[]` — each check has `name`, `conclusion` (SUCCESS/FAILURE/NEUTRAL/CANCELLED/TIMED_OUT/SKIPPED/null), `status` (QUEUED/IN_PROGRESS/COMPLETED), `detailsUrl`.
- `reviewThreads[]` — inline review comments grouped into threads. Each has `isResolved`, `isOutdated`, `path`, `line`, and `comments[]` with `author`, `body`, `createdAt`.
- `reviews[]` — top-level PR reviews. Each has `author`, `state` (APPROVED/CHANGES_REQUESTED/COMMENTED), `body`, `submittedAt`.
- `comments[]` — top-level issue-style comments on the PR (not tied to lines).

## Read prior state

State file: `~/.claude/state/pr-watch-<pr>.json`. Create `~/.claude/state/` if missing.

Shape:

```json
{
  "started_at": "2026-04-22T10:00:00Z",
  "last_tick_at": "2026-04-22T10:05:00Z",
  "surfaced_thread_ids": ["PRRT_abc", "PRRT_def"],
  "surfaced_review_ids": ["PRR_xyz"],
  "last_ci_summary": "3/5 passing, 2 pending"
}
```

- If the file is missing, this is a fresh watch. Create it with `started_at = now` and empty arrays.
- If `started_at` is more than 24h old, treat the file as stale and reset it. Long-dead watches shouldn't block a new one.

## Decide what to report

**CI state:**
- Summarise `statusCheckRollup` into passing/pending/failing counts.
- If any check has `conclusion` in `FAILURE`/`CANCELLED`/`TIMED_OUT`, it's a failure — surface the check name and `detailsUrl`.
- If the summary differs from `last_ci_summary`, report the change. Otherwise silent on CI.

**Review comments:**
- Filter `reviewThreads` to `isResolved == false && isOutdated == false`. Filter out threads whose ID is in `surfaced_thread_ids`.
- Filter `reviews` to entries with `state == "CHANGES_REQUESTED"` or a non-empty `body`, excluding IDs in `surfaced_review_ids`. Approvals without comments are silent.
- For each new thread, show: reviewer, `path:line`, a brief quote (first ~200 chars of the latest comment in the thread), and the link.
- For each new review, show: reviewer, state, brief quote of the body.
- If nothing new and CI is unchanged: stay silent, just update `last_tick_at` and continue.

## Stop conditions

Evaluate in order. The first match wins — report, delete the state file, and exit:

1. `state` is `CLOSED` or `MERGED` → "PR <state>, stopping watch."
2. Any CI check failed → surface the failure, then stop. Do NOT keep polling a broken PR.
3. All CI checks are terminal AND no unresolved review threads/reviews → "all clear." Then run the
   merge-ready check below.

   **A `NEUTRAL` or `SKIPPED` review bot did not review.** Cursor Bugbot reports `NEUTRAL` when it
   skips, and that is no review, not a pass. Name every such check in the report. Verified on a live
   pull request, where Bugbot and a SAST scanner both sat at `NEUTRAL` beside 14 green checks.
4. `now - started_at > 2h` → "watch ceiling hit after 2h. Last state: <summary>."
5. User explicitly asked to stop in the current turn → exit.

## Merge-ready notification

The repository uses the Trunk merge queue, so "ready" means GitHub will accept the merge, not that
you should merge it. **Never merge.** Send one desktop notification and stop.

Report the pull request as ready only when all five hold:

1. `state` is `OPEN` and `isDraft` is false.
2. `reviewDecision` is `APPROVED`.
3. `mergeStateStatus` is `CLEAN` or `HAS_HOOKS`. `BLOCKED`, `BEHIND`, `DIRTY`, and `UNSTABLE` are not ready.
4. No check has `conclusion` `FAILURE`, `TIMED_OUT`, or `CANCELLED`, and no check is still `QUEUED` or `IN_PROGRESS`.
5. No unresolved review thread remains.

`mergeStateStatus` is often `UNKNOWN` on the first read, because GitHub computes it lazily. Treat
`UNKNOWN` as "not ready yet" and let the next tick settle it; do not report it as a failure.

Then send exactly one notification for each pull request, and record that you sent it in the state
file so a later tick cannot repeat it:

```
bash ~/.claude/scripts/notify.sh "PR ready to merge" "<repo>#<pr> — <title>" "<url>"
```

Name any `NEUTRAL` review bot in the message, because a skipped bot is the one thing a green wall of
checks hides.

## Continue (only if no stop condition matched AND CI is pending)

Update the state file (`last_tick_at`, append new IDs to `surfaced_*`, update `last_ci_summary`). Then call `ScheduleWakeup` with `prompt: "/pr-watch <pr>"` and one of these delays, based on elapsed time since `started_at`:

| Elapsed | Delay |
|---------|-------|
| < 5 min | 120s  |
| 5–20 min | 270s |
| 20–60 min | 900s |
| > 60 min | 1800s |

Reason should be specific, e.g. `"PR 1234 CI still pending (3/5 checks), backing off to 900s"`.

Do NOT schedule a wakeup if CI is already terminal (all checks resolved). A stop condition will handle it.

## Do not act on review comments

When surfacing new review threads or reviews, do not edit code to address them. Pause and let the user direct. If the user decides to act, return through `/plan`, then use `/implement` for one coherent unit or `/build` for structured work so the change receives a frozen contract and a Sonnet implementation.

## On completion

When a stop condition fires, delete `~/.claude/state/pr-watch-<pr>.json`. This keeps the next `/pr-watch` invocation clean.
