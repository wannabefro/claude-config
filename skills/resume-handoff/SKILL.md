---
name: resume-handoff
description: List and load a recent handoff document for the current repo (or all repos). Companion to /handoff — use at the start of a fresh session to pick up where a previous one left off.
argument-hint: "[--all] [--prune] [substring-filter]"
---

Resume work from a prior `/handoff` document.

## Step 1 — list candidates

Read `~/.claude/handoffs.jsonl` (newline-delimited JSON, one entry per handoff). If the file doesn't exist, say so and exit cleanly — there are no handoffs to resume.

For each entry, check that `path` still exists on disk; mark missing files as **expired** (don't show them by default).

Filter:

- Default: only handoffs whose `repo` matches `basename $(git rev-parse --show-toplevel)`. If not in a git repo, show all.
- `--all`: show handoffs from every repo, grouped by repo.
- A substring arg: case-insensitive match against the `title` field.

Sort by `date` descending. Cap at the 10 most recent.

## Step 2 — pick one

- If exactly one candidate: load it directly without asking.
- If multiple: use `AskUserQuestion` with each option labeled as `<title> — <repo>/<branch> (<relative-date>)`. Include a numeric index in the label.
- If none after filtering: say so and stop. If `--all` would have surfaced one, suggest it.

## Step 3 — load and orient

`cat` the selected handoff. Read it into your working context. Then surface to the user, in 3–5 lines:

1. What the prior session was doing (one line, from "Where I left off").
2. The first concrete next step (from "What to do next").
3. Any skills the handoff said to invoke (from "Skills to invoke").
4. If the handoff names a different cwd: tell the user the `cd` command before doing anything else.

**Do NOT auto-execute the next step.** Wait for the user to direct.

## Optional cleanup

If `--prune` is passed: rewrite `~/.claude/handoffs.jsonl` to drop entries whose `path` no longer exists. Use a tempfile + `mv` to make the rewrite atomic. Report how many entries were removed.

```bash
TMP=$(mktemp)
while IFS= read -r line; do
  p=$(echo "$line" | jq -r .path)
  [ -f "$p" ] && echo "$line" >> "$TMP"
done < ~/.claude/handoffs.jsonl
mv "$TMP" ~/.claude/handoffs.jsonl
```

## Edge cases

- **Empty index**: tell the user no handoffs exist; suggest running `/handoff` at the end of work sessions going forward.
- **Tempfile expired**: macOS cleans `/var/folders/.../T/` periodically. If the path is gone but the index entry is recent (<7 days), warn the user and offer `--prune`.
- **Cross-repo resume**: if the loaded handoff names a different repo in its metadata, surface the `cd` command but don't run it — the user may want to open a fresh session in the other repo instead of switching cwd mid-conversation.
