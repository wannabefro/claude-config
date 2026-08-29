---
description: Plan work with native Opus reasoning, then use one bounded Codex Sol review when risk justifies a second model family
argument-hint: "[what to plan — a vague idea, a specified feature, or a requirements doc. Any size.]"
---

Plan: **$ARGUMENTS**

## Default planning pass

Claude Opus at xhigh is the native planner. It reads the request and the relevant project context,
separates requirements from decisions, freezes the dependency graph and interfaces, assigns file
ownership, defines acceptance criteria and exact verify commands, and writes the plan. Do not invoke
Compound Engineering automatically.

For build plans, also declare the exact repo-relative `ignored_dependencies` needed by verify gates;
an empty array is the explicit proof that no ignored baseline is required.

Use `ce-brainstorm` or `ce-plan` only when the user explicitly requests that toolbox or when a
separate, named CE artifact is required. CE remains useful for optional brainstorm, plan, debug,
simplify, review, and compound-learning passes. A CE pass does not authorize implementation; route
implementation through `/implement` or `/build`, which delegate writes to Luna.

For UI work, freeze `DESIGN.md`, `design-contract.md`, and `implementation-handoff.md` before
dispatch. The plan must route application writes to Codex `gpt-5.6-luna` at xhigh. Opus performs
integration, review, and final verification. There is no silent model fallback.

## One cross-family review when warranted

Run exactly one Codex pass when the plan touches auth, payments, migrations or schema, data
mutations, public APIs, permissions, or a change large enough that a wrong shape is expensive to
discover during build. Skip it for small, reversible, single-surface work and state that it was
skipped.

Codex planning/review is fixed to `gpt-5.6-sol` at xhigh by `codex-run.sh`; it never inherits the
default model and never falls back to another effort. Use the wrapper with the plan text carried by
a file, not a path that asks Codex to explore:

```
umask 077
brief_dir="$(mktemp -d "${TMPDIR:-/tmp}/claude-plan-review.XXXXXXXX")"
trap 'rm -rf "$brief_dir"' EXIT HUP INT TERM
~/.claude/scripts/codex-run.sh -t 600 -s 420 -S "$brief_dir/plan-review.txt" -f "$brief_dir/plan-review.txt" -N
```

The brief must ask for review only and contain the plan inline. The wrapper disables MCP by default,
keeps the run in the foreground, and reports stable exit codes:

| exit | meaning | action |
|---:|---|---|
| 0 | review returned | fold valid findings into the plan and record what changed |
| 3 | Codex unavailable | report that the cross-family pass did not happen |
| 4 | stalled and killed | optionally repeat the same Sol/xhigh invocation once with a tighter brief, then report if still not done |
| 5 | empty pass | report that no review happened; do not treat it as approval |
| 6 | provider refused | report the capacity gap; do not substitute another model |
| 7 | Codex runtime failure | report the failed cross-family pass with the exact code; do not treat it as approval |
| 8 | secret scan refused | report that the brief was not transferred; do not bypass the scan |

Never let Codex rewrite the plan. It reviews only. A retry, if used for a stall, repeats the same
fixed model and xhigh effort. It is not an effort fallback.

## Finish

Report the plan path, native planning result, any explicit CE pass, and the cross-family review
result. Then hand over the implementation step:

```
/implement <plan-path>   # one coherent unit
/build <plan-path>       # structured or parallel work
```

Do not ask whether to proceed. Plan approval remains the user's decision.
