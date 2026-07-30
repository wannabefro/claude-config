---
name: codex-exec-recovery
description: Use when a `codex exec` run produces no usable output — it hangs at zero bytes for minutes (stalled, not slow), or exits 0 having printed only the prompt/task echo. Also when an async Codex background/rescue pass reports "still running" forever.
---

# Codex exec recovery

## Overview

`codex exec` has three no-output failure modes. All look like "Codex did nothing," but each has a different cause and fix. Don't keep waiting or re-run blindly — identify which one and apply its fix.

## READ FIRST — "zero bytes" from the wrapper proves nothing

`codex-run.sh` **buffers**: it writes to a temp file and only `cat`s at the end. A caller watching its stdout sees nothing until the run finishes, whether the run is healthy or hung. Measured 2026-07-30: two healthy passes were killed on this misreading, and the second was producing 298 KB of trace at the time.

**Only the wrapper's own watcher can see a stall, and it says so — exit 4 plus a `STALLED` message.** No exit 4 means no stall. Judge by the exit code and by the heartbeat it now prints to stderr every 30 s, never by the absence of stdout. The "zero bytes for 2 minutes" rule applies **only** to a bare `codex exec` you are watching directly.

## Failure mode 0 — slow because MCP is enabled (the common one)

**Symptom:** the run takes many minutes and the trace fills with repo reads. The heartbeat shows bytes climbing steadily, so it is working, just not converging.

**Cause:** two compounding problems, both in `~/.codex/config.toml`.

1. **`codex exec` is non-interactive, and 14 tools carry `approval_mode = "approve"`** (plus `context-mode`'s `default_tools_approval_mode`). Nothing can approve them.
2. **`codegraph` and `serena` index the whole repo.** On a large monorepo a plan review with them enabled was still crawling at 600s; the same question with both disabled answered in well under 200s.

**Fix:** the wrapper now passes `-c mcp_servers={}` by default. Shell is built in, not MCP, so the run keeps `rg`/`sed`/`nl` and loses nothing it needs. Pass `-M` only for a run that genuinely needs a remote MCP server.

**Also constrain the prompt.** Disabling MCP does not stop Codex reading the repo by shell. A review prompt asking it to check "anything the plan asserts about existing code that is not true" is an invitation to grep the whole tree, and it will take it. When you have already inlined everything, say so:

> HARD CONSTRAINT: Do NOT read any files. Do NOT run any shell commands. Do NOT search the repo. Everything you need is stated above. A run that explores the repo is a failed run.

`codex-run.sh -N` appends exactly that paragraph, so you no longer paste it by hand. Omit `-N` for a rescue that must read the repo.

### Use a file to CARRY the prompt, never to REFER to one

These two look similar and behave oppositely:

| | what Codex does | verdict |
|---|---|---|
| `codex-run.sh "review the plan at docs/plans/x.md"` | Opens the file, then keeps exploring | **The measured failure mode.** Tool use is what stalls |
| `codex-run.sh -f brief.md -N` | Nothing. The wrapper inlined the bytes already | Correct |

`-f FILE` (or `-f -` for stdin) reads the file and inlines it, so a file is only ever the transport. That also removes a real corruption hazard: a brief embedded as a shell argument passes through argv quoting, and briefs contain backticks, `$VAR`, and `$(...)`. Verified 2026-07-30 with a stub `codex` on `PATH` — a brief carrying backticks, `$DOLLARS`, both quote styles and `$(command substitution)` arrived byte-identical through `-f`.

Measured: the same 6.9 KB brief went from two killed multi-minute runs to a complete 13-finding review in under 300s once MCP was off and the prompt forbade exploration.

## Failure mode 0b — blocked on stdin (the one that looks most like a hang)

**Symptom:** zero output forever from a backgrounded or piped run, while the same command works when you type it. The giveaway line is `Reading additional input from stdin...`.

**Cause:** `codex exec` reads stdin whenever stdin is not a TTY, even with a prompt argument. A background task, a pipe, and a subshell all qualify, so it waits for input that never comes.

**Fix:** redirect stdin: `codex exec ... < /dev/null`. `codex-run.sh` does this since 2026-07-30. Measured that day: a trivial probe hung at 0 bytes with inherited stdin and answered in 24s with `< /dev/null`.

## Failure mode 1 — genuinely stalled (bare `codex exec`, zero bytes, process alive)

**Symptom:** you are watching a bare `codex exec` directly and it has printed nothing for several minutes while still running.

**Cause:** hung on tool use — an MCP server or a file/tool call wedged.

**Fix:** kill it, then rerun with MCP off (`-c mcp_servers={}`) **and** everything it needs pasted inline so the run requires no tool use. Inlining alone is not enough while MCP is still enabled.

**Quiet is not stalled on a large brief.** The wrapper's 120s default stall window is calibrated for a small prompt. A 31 KB review brief emits its preamble in about 20s, then goes silent while it reasons — measured 2026-07-30 at roughly 150s of silence before the answer, so the default killed three healthy runs in a row. Past about 10 KB of brief, pass `-s 420 -t 900`. Raise the window before you conclude the run is hung.

## Failure mode 2 — prompt-echo only (exits 0 fast, output is just the echo)

**Symptom:** stdout ends at the echoed `user`/`<task>` block with no assistant turn after it; the process exited 0 quickly.

**Cause:** default reasoning effort `none` on gpt-5.5 — Codex consumes the prompt and exits 0 with no turn.

**Fix:** always pass `-c model_reasoning_effort=medium` (or higher). On empty output, retry **once** at `high`. Still empty → report the empty pass; do **not** treat it as a completed review/plan.

## Just use the wrapper

`~/.claude/scripts/codex-run.sh [-t SECS] [-s STALL_SECS] [-d DIR] "<prompt>"` encodes everything
below and branches on exit code, so a caller never has to infer failure from output shape:

| exit | meaning | what to do |
|---:|---|---|
| 0 | answered | use it |
| 3 | CLI unavailable (preflight) | report unavailable — do **not** retry or hunt processes |
| 4 | stalled, killed | re-run with context **inlined**; waiting longer never helps |
| 5 | empty at medium *and* high | report an empty pass — it does not satisfy a cross-model review |

It preflights with `codex --version` (10s), always passes `model_reasoning_effort=medium`, retries
once at `high` on an empty turn, and kills a run that emits nothing for the stall window. Sampled
2026-07-28: 8 healthy runs at 5-8s, so multi-minute silence is a hang, not thinking.

The manual invocation below is what the wrapper does; reach for it only when you need to vary
something the wrapper does not expose.

## How to run it (foreground, bounded)

```bash
cd <repo>
timeout <N> codex exec -c model_reasoning_effort=medium "<task — inline any code it needs>"
```

- **Foreground, never `run_in_background`.** Backgrounding is what leaves the async `codex:codex-rescue` wrapper hung reporting "still running" (no rollout file written). If a background pass is stuck, switch to a foreground `codex exec`.
- Detect a stall deterministically: no new stdout for ~2 min → kill the process, then rerun with context inlined.

## Quick reference

| Symptom | Cause | Fix |
|---|---|---|
| 0 bytes, many minutes, still running | hung on tool use | kill; rerun with code/context **inline** (no tool use) |
| exits 0, output is only the prompt echo | reasoning effort `none` | add `-c model_reasoning_effort=medium`; retry once at `high` |
| async rescue "still running" forever | backgrounded run stalled | use a foreground `codex exec` instead |

## Notes

- `rmcp … worker quit with fatal: Auth(AuthorizationRequired)` in the logs is **non-fatal noise**, not the stall cause — don't chase it.
- An empty Codex pass does **not** satisfy a cross-model review/plan invariant. See the Codex section in `~/.claude/CLAUDE.md` and `rules/pipeline.md`.
