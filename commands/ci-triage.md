---
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh run view:*), Bash(gh run list:*), Bash(gh api:*), Bash(git branch:*), Bash(git log:*), Read
description: Diagnose a failing pull-request check and identify the likely cause.
argument-hint: "[check-name-or-url]"
---

Triage: **$ARGUMENTS**

Resolve the named check or list every failed, cancelled, and timed-out check on
the current pull request. Fetch only the relevant logs. Report the first real
compiler error, test assertion, lint violation, or project stack frame with its
file and line. If logs contain no cause, say so.

Check recent runs for a possible flake, but call it a signal rather than a
conclusion. Report one concise block per failure with the likely cause, flake
signal, and one next action. Do not edit files, fix checks, post messages, or
run a review council. If the user asks for a fix, route the separate change
through `/implement` or `/build`.
