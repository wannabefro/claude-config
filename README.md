# Claude Code setup (`~/.claude`)

Version-controlled personal Claude Code configuration: skills, hooks, rules,
agents, commands, output styles, and `settings.json`. **This repo is the source
of truth** — it supersedes the old GoogleDrive skill-sync (GDrive is now just a
cold backup). Designed to **rehydrate a working setup on a fresh machine**.

> Public-safe: employer-internal config and machine-specific paths are kept out
> of tracked files (local-only `settings.local.json`, `.git/info/exclude`
> overlays, and a `__CLAUDE_HOME__` placeholder via a git clean/smudge filter).

## Bootstrap a new machine

```bash
git clone <this-repo> /tmp/claude-setup
/tmp/claude-setup/install.sh          # backup-first, idempotent
# or:  /tmp/claude-setup/install.sh --check   # just report missing prereqs
```

`install.sh` backs up any existing `~/.claude`, adopts the repo in place
(overwrites tracked config only — your transcripts and the `plugins/` cache are
left untouched), and configures a git clean/smudge filter that materializes the
committed `__CLAUDE_HOME__` placeholder in `settings.json` to the new machine's
real `~/.claude` paths. macOS-first.

## Prerequisites (install separately — `install.sh` reports, never installs)

| Tool | Purpose |
|---|---|
| `git`, `gh` (authed) | repo + GitHub |
| `node` / `fnm` | MCP servers, JS hooks |
| `rg`, `jq` | hooks, search |
| `codex` | cross-family review/rescue |
| `rtk` | token-saving command proxy |
| `cmux`, `wt` (worktrunk) | worktree workflow |
| `bd` (beads) | dependency-aware backlog/issue tracker (optional) |

## What rehydrates automatically vs. manually

- **Automatic:** plugins re-fetch from `enabledPlugins` + `extraKnownMarketplaces`
  in `settings.json` on first launch (the 1.7G `plugins/` cache is intentionally
  not committed). Skills are real files in `skills/` and travel with the clone.
- **Manual:** MCP server **auth** — none is committed. Re-authenticate:
  context-mode, codegraph, serena, context7, github, linear, slack, sentry,
  chrome-real, playwright (plus any CI/observability or employer-internal
  servers configured in your local settings overlay).
- **Verify after launch:** `/plugins` and the live MCP list should match
  `settings.json`. If a plugin is missing, check its marketplace entry.

## Notes

- **Not tracked:** `projects/` (transcripts + auto-memory), `plugins/`,
  `settings.local.json`, `remote-settings.json`, caches, `*.jsonl`, and nested
  runtime state (`hooks/state/`, `__pycache__/`). See `.gitignore` (allowlist).
- **Skills migrated off GoogleDrive** into `skills/` as real files. The 3
  cross-runtime skills (`autofix`, `code-review`, `find-skills`) were copied
  from `~/.agents/skills`; that original still exists for Codex/Gemini, so the
  two copies can **diverge** — edit one source deliberately.
- **Plan/design docs** under `docs/plans/` are intentionally untracked.
