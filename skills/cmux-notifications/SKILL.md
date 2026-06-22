---
name: cmux-notifications
description: >-
  Use cmux sidebar APIs to keep the user informed of task progress in the cmux
  workspace — set-status, set-progress, log, and notify. Use when working inside
  a cmux terminal (CMUX_WORKSPACE_ID set): on task start, progress, completion,
  errors, blockers, or when input/review is needed.
---

# cmux Sidebar Notifications

**MANDATORY: You MUST use cmux notifications for every task. This is not optional.**

- **Before starting any work**: set status to "working" and log what you're doing.
- **After completing any task**: notify the user, update status to "done", and clear progress.
- **On errors or blockers**: notify immediately and set error status.
- **When you need user input**: notify and set blocked status.

Failure to use cmux notifications is treated the same as failing to complete the task. Every task begins and ends with a cmux call.

---

Use the cmux CLI to keep the user informed of task progress directly in the cmux workspace sidebar. The environment variables `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID` are auto-set in cmux terminals — no need to pass `--workspace`.

## When to Notify (User Action Required)

Send a **notification** (toast) whenever the user needs to look at the agent's output or take action:

- Task list fully completed
- Blocked and need user input, decision, or clarification
- Encountered an error that requires user intervention
- Asking the user a question
- PR or commit ready for user review
- Long-running task finished (build, test suite, deploy)

## When to Update Status/Progress (No User Action Required)

Use **status** and **progress bar** silently for ambient awareness:

- Starting/working on a task
- Progress through multi-step work
- Switching between tasks

## Available Commands

### Status (persistent sidebar key-value)
```bash
cmux set-status "<key>" "<value>" --icon "<icon>" --color "<#hex>"
cmux clear-status "<key>"
```

### Progress Bar
```bash
cmux set-progress <0.0-1.0> --label "<text>"
cmux clear-progress
```

### Log (sidebar activity feed)
```bash
cmux log --level <info|warn|error> --source "cwt" -- "<message>"
```

### Notifications (toast/banner — user should look now)
```bash
cmux notify --title "<title>" --body "<body>"
```

## Standard Workflow

1. **Task start**: Set status and log it
   ```bash
   cmux set-status "cwt" "working" --icon "hammer" --color "#f59e0b"
   cmux log --level info --source "cwt" -- "Starting: <task description>"
   ```

2. **Progress updates** (for multi-step tasks): Update progress as fraction complete
   ```bash
   cmux set-progress 0.33 --label "Step 1/3: building"
   ```

3. **Task complete**: Notify user, update status, clear progress
   ```bash
   cmux set-status "cwt" "done" --icon "check" --color "#22c55e"
   cmux clear-progress
   cmux notify --title "cwt" --body "All tasks complete"
   cmux log --level info --source "cwt" -- "Done: <summary>"
   ```

4. **Need user input**: Notify and set blocked status
   ```bash
   cmux set-status "cwt" "needs input" --icon "chat-circle" --color "#3b82f6"
   cmux notify --title "cwt" --body "Need your input: <brief reason>"
   cmux log --level warn --source "cwt" -- "Waiting: <details>"
   ```

5. **Error/blocker**: Notify and set error status
   ```bash
   cmux set-status "cwt" "error" --icon "warning" --color "#ef4444"
   cmux notify --title "cwt" --body "Hit an error — need your help"
   cmux log --level error --source "cwt" -- "<error details>"
   ```

6. **Ready for review** (PR, commit, code changes):
   ```bash
   cmux set-status "cwt" "review" --icon "eye" --color "#8b5cf6"
   cmux notify --title "cwt" --body "Ready for your review"
   cmux log --level info --source "cwt" -- "Ready for review: <what>"
   ```

7. **Cleanup** (after user acknowledges or conversation ends):
   ```bash
   cmux clear-status "cwt"
   cmux clear-progress
   ```

## Icons Reference (common)
`sparkle`, `hammer`, `check`, `warning`, `chat-circle`, `eye`, `magnifying-glass`, `code`, `gear`, `rocket`, `bug`, `lightning`

## Rules
- Always use `--source "cwt"` for log entries
- Keep status values short (1-2 words)
- Keep notification bodies under one sentence
- Clear progress when done — don't leave stale bars
- Don't spam notifications — one per logical task completion, not per file edit
- **Always notify** when the user needs to act (task done, input needed, error, review ready)
- **Never notify** for routine progress — use status/progress bar instead
