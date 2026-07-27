---
description: Convene a multi-model review council on a diff — parallel lenses, adversarial cross-examination, Fable breaks deadlocks, judge delivers a verdict
argument-hint: "[what to review — e.g. 'PR 412', 'the auth refactor', or blank for the current branch]"
---

Convene the review council on: **$ARGUMENTS**

Run it by calling the `Workflow` tool with:

```
{ "scriptPath": "~/.claude/workflows/council-review.js",
  "args": { "target": "$ARGUMENTS", "repoPath": "<absolute path, ONLY if outside this session>" } }
```

`args` also accepts a plain string when the target is the current repo. If `$ARGUMENTS` is empty,
omit `args` entirely — the workflow defaults to the current branch diff plus uncommitted changes.

**Always pass `repoPath` when reviewing a repo outside the session directory, and never instruct the
agents to `cd` there.** A `cd` to an external path is a boundary crossing that gates every command
after it, so it turns ~30 free read-only calls into ~30 approval prompts — once per council member.
`repoPath` makes the lenses use `git -C` and absolute paths instead, which stay auto-allowed.

Invoking this command is the explicit opt-in the Workflow tool requires; no further confirmation is
needed. Expect roughly 15–25 agents depending on how many findings survive to cross-examination.

## Reporting the result

The workflow returns `{ verdict, summary, ranked, dismissed, council }`. Report it like this:

- Lead with the **verdict** and the one-line summary.
- Then the **ranked findings** — severity, `file:line`, and the concrete action. Say which lenses
  converged on each, since cross-lens agreement is the strongest signal the council produces.
- Note anything that went to **Fable adjudication** and how it was settled — those were the genuinely
  contested calls and are worth the reader's attention.
- Give **dismissed findings one line total**, not a list, unless something was dismissed for a reason
  the author should know about.
- State the council stats plainly: raised / survived / refuted / escalated. If a lot was raised and
  little survived, say so — that is a signal about the review, not just the diff.

Do not fix anything. This command reports; the author decides what to act on.
