---
description: The entry point for reviewing anything — routes to CodeRabbit autofix when threads are open, declines on mechanical diffs, and otherwise convenes a multi-model council with triage-sized seating and adversarial cross-examination
argument-hint: "[what to review — e.g. 'PR 412', 'the auth refactor', or blank for the current branch]"
---

Convene the review council on: **$ARGUMENTS**

**This is the entry point for reviewing anything — don't pre-judge the shape.** The council sizes
itself (triage seats two lenses on an ordinary diff and all six on a guardrail surface), so the only
decisions left are the two below. Make them yourself; neither is a question for the user.

**If the target is an open PR, check for unresolved CodeRabbit threads first:**

```
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){
  pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}}}}'   -F o=<owner> -F r=<repo> -F n=<pr>   --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
         | select(.isResolved==false)
         | select(.comments.nodes[0].author.login|test("coderabbit";"i"))] | length'
```

Non-zero means machine-readable feedback is already sitting there. Run `coderabbit:autofix` on it
**before** convening — otherwise the council spends 15–25 agents rediscovering what a bot already
wrote down, and you review the same diff twice. `autofix` needs only `gh`, so it works on every
machine; the CodeRabbit CLI does not.

**If the diff is genuinely mechanical** — a rename, a generated-file update, a version bump, a
formatting pass with no logic change — say so in one line and don't convene. The council's floor is
still 15–25 agents, and triage sizes the *seating*, not whether it runs at all. A review that cannot
find anything is not free.

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
- Flag anything marked **`unchallenged: true`** separately and say so plainly: no challenger returned
  a verdict on it, so it is *unverified, not confirmed*. It survives because under-reviewing must
  never be the failure mode, and it carries less weight than a finding two families upheld.
- Give **dismissed findings one line total**, not a list, unless something was dismissed for a reason
  the author should know about.
- State the council stats plainly: raised / survived / refuted / escalated. If a lot was raised and
  little survived, say so — that is a signal about the review, not just the diff.

Do not fix anything. This command reports; the author decides what to act on.
