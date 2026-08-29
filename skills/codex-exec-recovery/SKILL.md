---
name: codex-exec-recovery
description: Recover a bounded Codex planning or review pass that is unavailable, stalled, empty, or refused without changing model family or effort.
---

# Codex exec recovery

## Use the wrapper

`~/.claude/scripts/codex-run.sh` is the only supported route for a cross-family planning,
diagnosis, or review pass. It carries a prompt file, runs in the foreground, disables MCP by
default, and watches a buffered output file for a stall. The wrapper always sends:

```
codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh
```

It never inherits the user's default model and never changes effort as a fallback. It accepts
`-f FILE` (or `-f -`) to carry prompt bytes, `-S FILE` to scan a standalone brief before transfer,
and `-N` to append a no-exploration constraint. Do not
put a path to the brief in the prompt: that causes unnecessary file exploration. Use `-M` only
when a review has a documented need for an MCP server.

The wrapper returns stable codes:

| exit | meaning | response |
|---:|---|---|
| 0 | answered | use the review or planning result |
| 3 | Codex CLI unavailable or preflight failed | report unavailable; do not hunt processes |
| 4 | stalled and killed | optionally repeat the same Sol/xhigh request once with a tighter inline brief |
| 5 | empty assistant pass | report that no result exists; do not call it a review |
| 6 | provider refused capacity | report the capacity gap; do not substitute another model |
| 7 | Codex runtime failure | report the failed cross-family seat with the exact code |
| 8 | secret scan refused transfer | report the blocked cross-family seat; do not bypass the scan |

An empty pass is not approval. A same-model retry after a stall is a bounded operational retry,
not an effort fallback. Do not retry an unavailable CLI or provider refusal.

## Why a run can appear silent

The wrapper buffers output until the run ends. A caller must use its heartbeat and exit code, not
stdout silence, to decide if the run is stalled. It redirects Codex stdin from `/dev/null`, so a
non-interactive run does not wait for extra input.

MCP is off by default because non-interactive approval requests cannot be answered and some
servers index a whole repository. If a run needs code context, include the required context in the
brief or allow the fixed read-only shell tools; do not enable MCP as a blind recovery step.

## Stalled pass

Exit 4 means the wrapper saw no output for the configured stall window and killed its bounded
foreground child. Repeat once only if the brief can be made self-contained and smaller. Keep
`gpt-5.6-sol` and `xhigh`. If the second fixed pass stalls, report the cross-family review as not
done. Never background the command, poll a background process, or hunt stray Codex processes.

## Empty, unavailable, or refused pass

Exit 5 means the fixed run ended without a usable assistant turn. Do not invoke another model or
effort to manufacture a result. Exit 3 means the CLI preflight failed. Exit 6 means the provider
returned no capacity. In all three cases, report the missing evidence plainly and let the caller
decide whether to continue with the documented degraded path.

## Manual invocation

Use the wrapper instead of hand-running Codex. It uses the macOS/POSIX runtime
tools and a Perl alarm. It does not require GNU `timeout` or a Homebrew
coreutils shadow. For a diagnostic pass, put the required context in a file and
preserve the same fixed arguments and foreground behavior:

```bash
bash ~/.claude/scripts/codex-run.sh -t 600 -f /path/to/brief.md -N
```

Do not add dangerous bypass flags. Do not silently change the model, effort, approval mode, or
MCP policy. An empty Codex pass does not satisfy a cross-family review or plan invariant.
