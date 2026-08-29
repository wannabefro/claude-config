---
description: Convene the explicit full review council with adversarial cross-examination
argument-hint: "[what to review — e.g. 'PR 412', 'the auth refactor', or blank for the current branch]"
---

Convene the full review council on: **$ARGUMENTS**

**This is the explicit full-review mode.** It always seats every existing
council lens and preserves adversarial cross-examination. Do not classify the
diff here, skip a mechanical diff, or reduce seating. Use `/review` for the
default risk-tiered path.

**If the target is an open PR, check for unresolved CodeRabbit threads first:**

```
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){
  pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}}}}'   -F o=<owner> -F r=<repo> -F n=<pr>   --jq '[.data.repository.pullRequest.reviewThreads.nodes[]
         | select(.isResolved==false)
         | select(.comments.nodes[0].author.login|test("coderabbit";"i"))] | length'
```

Non-zero means machine-readable feedback is already sitting there. Run
`coderabbit:autofix` on it **before** convening — otherwise the council spends
15–25 agents rediscovering what a bot already wrote down, and you review the
same diff twice. `autofix` needs only `gh`, so it works on every machine; the
CodeRabbit CLI does not.

**Preflight, one command.** The `Workflow` tool can be removed from the tool set entirely by managed
policy — not registered, not deferred, invisible to `ToolSearch`. Check first:

```
~/.claude/scripts/workflow-available.sh council-review.js
```

Branch on the exit code: `0` continue below; `1` take the Degraded route at the end of this file and
do **not** hunt for the tool or edit `policy-limits.json`; `2` report the missing script and stop.
Say which branch you took, so a review that never convened is never reported as one that found
nothing.

Run it by calling the `Workflow` tool with:

```
{ "scriptPath": "~/.claude/workflows/council-review.js",
  "args": { "target": "$ARGUMENTS", "repoPath": "<absolute path, ONLY if outside this session>" } }
```

`args` also accepts a plain string when the target is the current repo. If `$ARGUMENTS` is empty,
omit `args` entirely — the workflow resolves the checked-out branch's configured upstream and fails
closed when none exists.

**Always pass `repoPath` when reviewing a repo outside the session directory, and never instruct the
agents to `cd` there.** A `cd` to an external path is a boundary crossing that gates every command
after it, so it turns ~30 free read-only calls into ~30 approval prompts — once per council member.
`repoPath` makes the lenses use `git -C` and absolute paths instead, which stay auto-allowed.

Invoking this command is the explicit opt-in the Workflow tool requires; no further confirmation is
needed. Expect the full council and its adversarial challenge pass.

## Reporting the result

The workflow returns `{ verdict, summary, ranked, dismissed, council }`. Report it like this:

- Lead with the **verdict** and the one-line summary.
- Then the **ranked findings** — severity, `file:line`, and the concrete action. Say which lenses
  converged on each, since cross-lens agreement is the strongest signal the council produces.
- Include the challenger's objections for any finding that survives. A missing challenge is
  unverified, not confirmed.
- Flag anything marked **`unchallenged: true`** separately and say so plainly: no challenger returned
  a verdict on it, so it is *unverified, not confirmed*. It survives because under-reviewing must
  never be the failure mode.
- Give **dismissed findings one line total**, not a list, unless something was dismissed for a reason
  the author should know about.
- State the council stats plainly: raised / survived / refuted. The compatibility `escalated` count
  should be 0 because the council has one challenger seat.

Do not fix anything. This command reports; the author decides what to act on.

## Degraded route — Workflow disabled by policy (exit 1)

There is no substitute for the council's shape: full seating, adversarial
cross-examination. Do not pretend a smaller pass is one.
**Say plainly that the council did not convene**,
then get the best coverage still available:

**The cross-family pass in step 2 is the floor, not an optional extra.** Step 1 alone is a
same-family review, and a second family is the whole reason the council exists. Run step 2 on every
degraded review. If it returns 3, 4, 5, 6, 7, or 8, name that in the verdict — a review missing its only
non-Claude lens is never reported as complete.

1. **`ce-code-review`** on the same diff. It is the closest same-family stand-in and it carries the
   persona tiers, so it recovers most of the seating — but none of the cross-family lens.
2. **One cross-family pass** — the lens the council exists for, and the one `ce-code-review` cannot
   supply on its own:

   ```
   umask 077
   brief_dir="$(mktemp -d "${TMPDIR:-/tmp}/claude-council-review.XXXXXXXX")"
   trap 'rm -rf "$brief_dir"' EXIT HUP INT TERM
   ~/.claude/scripts/codex-run.sh -t 900 -s 480 -S "$brief_dir/codex-brief.txt" -f "$brief_dir/codex-brief.txt" -N
   ```

   Assemble one canonical review bundle first with `~/.claude/scripts/review-bundle.sh`.
   Put `01-the-diff.patch` plus every full changed-file snapshot from that bundle in the unique
   private brief file, inline each exactly once, and forbid exploration. Keep `02-staged.patch` and
   `03-unstaged.patch` as diagnostics; do not append them to the canonical patch.
   Keep the canonical bundle until every lens, challenge, and the judge has
   consumed it. Then run `~/.claude/scripts/cleanup-review-bundle.sh` on that
   exact bundle path. The cleanup helper accepts only a private canonical
   bundle and refuses arbitrary directories. The wrapper always uses Codex
   `gpt-5.6-sol` at xhigh, with MCP disabled by default; it
   never inherits the default model or changes effort:

   > HARD CONSTRAINT: Do NOT read files, run shell commands, or search the repo. Everything you need
   > is below. A run that explores the repo is a failed run.

   Branch on its exit code — `3` unavailable, `4` stalled, `5` empty, `6` refused (out of credits),
   `7` Codex runtime failure, or `8` secret scan refusal.
   **None of those is a review**; report the gap rather than counting it as one. A stall retry, if
   used, repeats the same Sol/xhigh invocation. It is not a model or effort fallback.
3. **On a guardrail surface** — auth, payments, migrations or schema, data mutations, public API,
   permissions — say explicitly that the diff did not get the review the shipping rules require, and
   let the user decide whether to ship on the reduced pass. That call is theirs, not yours.

Report it as `verdict: degraded`, list what actually ran, and name what was skipped.
The target must resolve to the exact checkout head and base (`base..head`,
`base...head`, `pr:<number>`, or the checked-out branch with an upstream).
Detached or mismatched checkouts fail closed; never infer `main`,
`origin/main`, or a partial `HEAD` comparison. The canonical bundle is
secret-scanned before the Codex outsider receives any bytes.
