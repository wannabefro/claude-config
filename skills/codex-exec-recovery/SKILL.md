---
name: codex-exec-recovery
description: Use when a `codex exec` run produces no usable output — it hangs at zero bytes for minutes (stalled, not slow), or exits 0 having printed only the prompt/task echo. Also when an async Codex background/rescue pass reports "still running" forever.
---

# Codex exec recovery

## Overview

`codex exec` has two distinct no-output failure modes. Both look like "Codex did nothing," but each has a different cause and fix. Don't keep waiting or re-run blindly — identify which one and apply its fix.

## Failure mode 1 — stalled (zero bytes for minutes, process still alive)

**Symptom:** the run has printed nothing for several minutes and the process is still running. A real run streams output within seconds; **zero bytes for ~2+ minutes means stalled, not slow.**

**Cause:** Codex is hung on tool use — its bundled MCP servers or a file/tool call wedged.

**Fix:** kill it, then **rerun with everything it needs pasted inline in the prompt so the run requires no tool use** (no file reads, no MCP). Inlining the code/context is what unsticks it — verified: a run stalled at 0 bytes for ~30 min returned findings immediately once re-run with the code inline.

## Failure mode 2 — prompt-echo only (exits 0 fast, output is just the echo)

**Symptom:** stdout ends at the echoed `user`/`<task>` block with no assistant turn after it; the process exited 0 quickly.

**Cause:** default reasoning effort `none` on gpt-5.5 — Codex consumes the prompt and exits 0 with no turn.

**Fix:** always pass `-c model_reasoning_effort=medium` (or higher). On empty output, retry **once** at `high`. Still empty → report the empty pass; do **not** treat it as a completed review/plan.

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
- An empty Codex pass does **not** satisfy a cross-model review/plan invariant. See the Codex section in `~/.claude/CLAUDE.md` and `rules/workflows.md`.
