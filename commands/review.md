---
description: Review the change with Opus plus one independent native Codex pass.
argument-hint: "[base branch, commit SHA, or blank for uncommitted changes]"
---

Review: **$ARGUMENTS**

Opus reads the changed files and the diff, then classifies the change as
mechanical or behavior-changing. A mechanical change needs the relevant gates
and that inspection only. A behavior change also gets one independent Codex
pass.

Codex reviews the repository itself. Do not assemble a diff bundle or write a
brief file. Resolve the target from the argument, then run one bounded
foreground pass with the Bash tool's own `timeout` set to `600000`:

```bash
"$(~/.claude/scripts/codex-bin.sh)" exec review --uncommitted \
  -s read-only --ephemeral -c model_reasoning_effort=xhigh < /dev/null
```

`codex-bin.sh` resolves the CLI to an absolute realpath and refuses a copy
inside the checkout or a temp root; a planted `codex` on `PATH` would run with
your credentials. Exit 3 from it means the CLI is unusable, not that the review
found nothing.

Swap `--uncommitted` for `--base <branch>` or `--commit <sha>` when the
argument names one. With no argument, review the uncommitted changes. Never
guess a base branch.

Always redirect stdin; `codex exec` blocks on a TTY waiting for more input. The
model comes from `~/.codex/config.toml`; add `--model gpt-5.6-sol` for the
deeper lens.

Codex reads the working tree directly and nothing scans it first. Do not run
this in a checkout that holds real credentials or customer data.

Read the output, not just the exit code. Codex exits 0 with
`Your workspace is out of credits` in the body, so exit 0 alone is not a
review. An empty body, a capacity refusal, a missing CLI, or a timeout is a
gap: report the exact outcome and do not substitute another model.

Apply clear, in-scope defects in the current authorized task. Report what ran
and what remains uncertain.
