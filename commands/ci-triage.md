---
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(gh run view:*), Bash(gh run list:*), Bash(gh api:*), Bash(git branch:*), Bash(git log:*), Read
description: Triage a failing CI check on the current task's PR — pull logs, identify the error, point at the file
argument-hint: "[check-name-or-url]"
---

## Purpose

Resolve a failing CI check into a concrete diagnosis: what failed, where, and the most likely cause. Designed as the natural follow-up to `/pr-watch` reporting a failure. Does NOT fix anything — it hands you a clear problem statement so you can act.

## Resolve the failing check(s)

- If `$ARGUMENTS` is a URL (Buildkite job, GitHub Actions run, etc.), fetch that directly and skip PR lookup.
- If `$ARGUMENTS` is a check name (e.g. `typescript`, `test`, `lint`), resolve it against the current branch's PR.
- If `$ARGUMENTS` is empty:
  - Run `gh pr view --json number,url,statusCheckRollup` for the current branch.
  - Identify every check with `conclusion` in `FAILURE`, `CANCELLED`, or `TIMED_OUT`.
  - If none found, report "no failing checks on <pr-url>" and exit. Do not fabricate failures.
  - If multiple failures, triage each one below — concise summary per failure, don't pick arbitrarily.

For each failure, the `statusCheckRollup` entry gives you `name`, `detailsUrl`, `conclusion`, and (for GitHub Actions) `workflowName` + runId.

## Fetch logs

Source depends on the CI system — detect from `detailsUrl`:

**Buildkite** (`buildkite.com/...`):
- If Buildkite MCP tools are available in this session, use them to fetch the failing job's log (prefer `mcp__buildkite__*` read endpoints over raw HTTP).
- Otherwise, the `detailsUrl` points at the Buildkite job. Ask the user to share the log excerpt if there's no other path — do not attempt to scrape Buildkite via `curl`.

**GitHub Actions** (`github.com/.../actions/runs/...`):
- Extract the run ID from the URL.
- `gh run view <run-id> --log-failed` gets only the failing step output. Prefer this over full logs — it's usually enough for diagnosis and saves thousands of tokens.
- If `--log-failed` yields nothing useful (e.g. the failing step swallowed its output), fall back to `gh run view <run-id> --log`.

**Other CI** (Circle, Jenkins, etc.):
- If the `detailsUrl` is accessible and you have a reasonable tool for it, use it. Otherwise, flag the CI system and ask the user to paste the relevant log section.

## Identify the actual error

Logs are noisy. The goal is the **minimum excerpt** that explains the failure. In order of preference:

1. **Compiler/typechecker errors** — first non-zero exit with a stack trace pointing at a file:line. Show the error line plus ~3 lines of context.
2. **Test failures** — assertion text, test name, and the `expected vs received` diff. Skip test setup noise.
3. **Lint/format violations** — rule name, file:line, violation text.
4. **Runtime errors during build/test** — exception message + top 3 frames of the stack that are in project code (filter out `node_modules`, framework internals).
5. **Exit-code-only failures** — if the log doesn't explain the failure, say so explicitly rather than guessing.

Don't paste 100-line stack traces. A reader should be able to understand the failure in 30 seconds.

## Flakiness heuristic

Before concluding, check if this looks like a flake:

- `gh run list --branch <current-branch> --json conclusion,name,createdAt --limit 10` shows recent runs for this branch.
- If the same check has alternated pass/fail without code changes addressing it, mention "possible flake — recommend re-running before investigating."
- Don't declare flakiness on a single run. It's a hint, not a verdict.

## Report

Format per failure:

```
✗ <check-name> (<CI system>)
  <file:line> — <one-line summary of the error>

  <3-8 line excerpt of the actual error>

  Likely cause: <specific diagnosis, e.g. "missing import for X",
                "assertion expected Y got Z", "type narrowing broken by
                recent change to Foo.ts">
  Flake signal: <yes/no/unclear>
  Next action: <one suggestion — e.g. "check Foo.ts:42", "re-run the
                check first", "look at the recent rename in Bar">
```

For multi-failure PRs, repeat the block per check, with a leading summary:

```
3 failing checks on PR #1234:
  ✗ typescript — type error in Foo.tsx
  ✗ test:unit — 2 tests failing in Bar.test.tsx
  ✗ lint — unused import
```

Then the detailed block for each.

## Do not fix

- Stop after reporting. Do not edit files, do not run fixes, do not propose a diff.
- If the user wants to act, that's a separate turn. Let them direct. This keeps triage cheap and avoids compounding a misdiagnosis into a bad edit.
- If the user asks for a fix in the same turn, THEN invoke the appropriate MUST skill for the change category (e.g. `lint-and-format` for a lint violation, `write-tests` for a test fix) before editing.
