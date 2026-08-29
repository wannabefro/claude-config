---
name: handoff
description: Compact the current conversation into a structured handoff document for another agent to pick up. Captures repo/branch/PR/Linear context automatically. Companion to /resume-handoff on the receiving side.
argument-hint: "What will the next session be used for?"
---

Write a handoff document so a fresh agent can continue this work — same repo or a different one.

## Step 1 — capture environment

Run this block to auto-fill the metadata. Use the actual output; don't hand-write these fields.

```bash
echo "cwd: $(pwd)"
echo "repo: $(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "(not a git repo)")"
echo "branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")"
echo "last_commit: $(git log -1 --oneline 2>/dev/null || echo "n/a")"
echo "active_pr: $(gh pr view --json url -q .url 2>/dev/null || echo "none")"
echo "linear: $(git rev-parse --abbrev-ref HEAD 2>/dev/null | grep -oE '[A-Z]+-[0-9]+' | head -1 || echo "none")"
echo "modified_files:"; git status --porcelain 2>/dev/null | head -20
echo "recent_commits:"; git log --oneline -5 2>/dev/null
```

## Step 2 — write the handoff

Save to a path produced by `mktemp -t handoff-XXXXXX.md`. Read the path the command prints before writing. The file must follow this structure exactly:

```markdown
# Handoff: <one-line title>

**Date**: <ISO timestamp UTC>
**Repo**: <repo>
**Branch**: <branch>
**Last commit**: <hash + first line of message>
**PR**: <url or "none">
**Linear**: <ticket or "none">
**Next session focus**: <from $ARGUMENTS, or inferred from the conversation>

## Where I left off

2–4 sentences. Concrete: file paths, function names, decisions just made. Not a recap of the whole session — just the current state.

## What to do next

Numbered steps if sequential, bulleted if independent. Each step should be actionable in <30 min. If the next session is in a DIFFERENT repo, the first step is the `cd` command to get there.

## Relevant files

- `<path>` — one-line why it matters
- ...

Cap at 8 entries. If you have more, you're capturing too much — point at a directory instead.

## Open questions

Things the next session needs to decide or ask the user. Write "none" if there are none.

## Skills to invoke

1–3 skills the receiving session should use (for example `/plan`, `/build`, `/codex:rescue`, or `/pr-watch`). Write "none" if there are none.

## References

Links to ADRs, PRDs, Confluence, Linear tickets, prior PRs. Link only — do NOT duplicate their content.
```

## Step 3 — register and announce

Append the handoff to the index so `/resume-handoff` can discover it later. Use `printf` (not `echo -e`) for portability:

```bash
HANDOFF_PATH="<path from mktemp>"
HANDOFF_TITLE="<the title from the doc, single-line>"
HANDOFF_REPO="$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "(no-repo)")"
HANDOFF_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "n/a")"
mkdir -p ~/.claude
printf '{"path":"%s","repo":"%s","branch":"%s","title":"%s","date":"%s"}\n' \
  "$HANDOFF_PATH" "$HANDOFF_REPO" "$HANDOFF_BRANCH" "$HANDOFF_TITLE" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >> ~/.claude/handoffs.jsonl
```

Then print the path on its own line. The receiving session can either:

- Start with `/resume-handoff` (auto-finds the latest for the current repo)
- Or paste the path: `claude --append-system-prompt "$(cat <path>)"`
- Or hand it to Codex: `/codex:rescue --background "$(cat <path>)"`

## Constraints

- Keep the handoff under 2K tokens (~8KB). If you need more, you're capturing too much — link out.
- Don't duplicate content already in PRDs, plans, ADRs, issues, commits, or diffs. Reference them by path/URL.
- If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
