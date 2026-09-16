---
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh api:*), Bash(git branch:*), Bash(mkdir:*), Bash(test:*), Bash(rm:*), Bash(date:*), Read, Write, ScheduleWakeup
description: Watch a pull request and report CI or unresolved review feedback.
argument-hint: "[pr-number-or-url]"
---

Watch: **$ARGUMENTS**

Resolve the pull request and take one read-only snapshot of its state, checks,
reviews, and unresolved non-outdated threads. Report failing checks and new
feedback with the relevant path, line, reviewer, and link. A `NEUTRAL` or
`SKIPPED` review bot did not review; name it separately from passing checks.

Keep the small state file under `~/.claude/state/` so later ticks report only
changes. Poll while checks remain pending, backing off over time, and stop when
the pull request closes, a check fails, all checks finish, or the two-hour watch
ceiling is reached. Delete the state file on stop. Send a local notification
only when the user asked for watch notifications.

This command is read-only with respect to GitHub. Never comment, reply, react,
label, approve, merge, change pull-request state, or act on review feedback.
