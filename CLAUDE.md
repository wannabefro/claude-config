@RTK.md

# Setup Context

## Hooks

Deterministic guardrails fire automatically on Bash/Write/Edit and worktree events — they enforce regardless of these notes, so don't re-implement their checks in prose; just heed the failures they surface. Active: `bash-safety` (blocks `rm -rf /`, piped curl, `git reset`), `commit-precheck` (pre-commit gate, blocks `--no-verify`), `rtk-rewrite` (token-saving command rewrites), worktree fetch/rebase on EnterWorktree, and async `verify-on-edit` syntax validation.

## Permissions

- `allow`: safe read/build/test (git, node, cargo, python, etc.)
- `ask`: filesystem mutations (mkdir, cp, mv), docker, git push/reset
- `deny`: curl, wget, .env reads, Serena dashboard

## MCP tool selection

Tool schemas are deferred (loaded on demand via ToolSearch), so idle servers cost ~nothing — pick by fit, not scarcity. Reach for the lightest tool that works; escalate only when it's genuinely insufficient.

- Byte-heavy command/script output you'll process (filter, count, parse, aggregate), or a web page/doc read once → **context-mode** (`ctx_batch_execute`/`ctx_execute`/`ctx_execute_file`/`ctx_fetch_and_index`); only what you print enters context.
- Library/SDK/API/framework docs, even well-known ones → **context7** over WebSearch. Not for refactoring or business-logic debugging.
- Structural code questions (who calls X, what would break, trace flow, where defined) → **codegraph** (injects its own usage guidance when active).
- Symbol-precise navigation/edits/rename/find-refs in an LSP-indexed project → **serena** (see below).
- Multi-step reasoning whose intermediate steps shouldn't stay in context → **subagent** (`Explore`, `general-purpose`).
- Browser automation / live UI verification → **`chrome-real`** (user-scoped MCP server: `chrome-devtools-mcp --autoConnect`, drives my real logged-in Chrome via the `chrome://inspect` remote-debugging toggle). Prefer it over **playwright** and over the plugin's `chrome-devtools` server (those launch fresh, unauthenticated, extension-less browsers that fail on session/dev-proxy-gated pages). Requires Chrome running with remote debugging enabled on its port; if `chrome-real` tools error with a connection failure, re-enable the toggle and confirm the debug port is listening.

## Memory

- **File-based auto-memory** (`~/.claude/projects/<project>/memory/`, indexed by `MEMORY.md`) auto-loads every session — stable cross-session project facts. Cross-project user facts → `~/.claude/CLAUDE.md` / `~/.claude/rules/`.
- **context-mode session memory** is auto-captured; use `ctx_search(sort: "timeline")` for mid-session recall after `/compact`. Session-scoped, not a substitute for file-based memory.
- Treat saved memory as a hint, not authoritative: if it names a file/function/flag, verify the artifact still exists; if it conflicts with observation, trust the observation and update the memory. Save when the user corrects you or confirms a surprising choice worth keeping; don't inline-save trivia already in code or git.

## Serena

Soft invariant: onboarding is one-time per project. On the first session in an activated project, call `mcp__serena__check_onboarding_performed`; if not performed, run `mcp__serena__onboarding` and populate `.serena/memories/` (project overview, commands, conventions, task-completion checklist, structure, critical CLAUDE.md/AGENTS.md rules). Later sessions read those memories — skip onboarding. Prefer symbolic tools over raw scans; don't reach for Serena on tiny, single-file, or greenfield edits. (The `task-recall` plugin's `.claude/task-*.md` are task-scoped — separate from this.)

## Codex (cross-family escalation)

OpenAI's Codex CLI via the `codex-companion` runtime — its output stays out of Claude's context; the different model family is the point. `/codex:rescue [task]` (write-capable; `--background`, `--resume`, `--effort high`, `--model spark`), `/codex:review` / `/codex:adversarial-review`, `/codex:setup`, `/codex:status|result|cancel`. Bills separately — don't auto-fire on trivial tasks. Selection rules in `rules/workflows.md`.

Plan-review invariant: when Claude reviews a Claude-authored plan, get exactly one Codex pass before finalizing (run it via direct `codex exec` — see Invocation routing); when Claude reviews a Codex-authored plan, Claude is already the cross-model reviewer and should not bounce it back to Codex.

Invocation routing (verified 2026-06-16): Claude **cannot** fire the codex skills (`/codex:review`, `/codex:rescue`, …) via the **Skill tool** — they're gated by `disable-model-invocation` (a *user* typing the slash command still works). And the async `codex:codex-rescue` Agent in **background/polling mode can stall** — it rests repeatedly reporting "still running" and never surfaces the result (no rollout file is written). So when Claude needs a Codex pass programmatically (e.g. the mandatory cross-model plan review), prefer a **direct, bounded foreground `codex exec`** (run it foreground, NOT `run_in_background` — backgrounding is what leaves the pass hung mid-session): `cd <repo>` then `timeout <N> codex exec -c model_reasoning_effort=medium "<task>"`, and read stdout. **Always pass `-c model_reasoning_effort=medium` (or higher)** — the *root cause* of the "exited 0 but wrote only the prompt echo" flake (observed 2026-06-16) is the default `reasoning effort: none` on gpt-5.5, which lets Codex consume the prompt and exit 0 with no assistant turn; an explicit effort fixes it. Detect the flake deterministically: the run is empty iff stdout ends at the echoed `user`/`<task>` block with no model output after it. On an empty result, retry **once** at `-c model_reasoning_effort=high`; if the retry is also empty, report the empty pass rather than treating the plan as reviewed (an empty Codex pass does NOT satisfy the cross-model invariant). Verified working from a worktree where the rescue wrapper stalled (model auth fine, daemon alive, completes in seconds). Codex's bundled MCP servers log recurring `rmcp … worker quit with fatal: Auth(AuthorizationRequired)` lines — **non-fatal noise** (a turn still completes), not a run blocker; fix only if the MCP server is actually needed.
