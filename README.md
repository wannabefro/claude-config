# Claude Code setup (`~/.claude`)

This repository stores the portable Claude Code configuration. It includes
rules, commands, agents, hooks, workflows, skills, and settings. It does not
store credentials, plugin caches, runtime state, conversations, app data, or
absolute host commands.

## Bootstrap a Mac

```bash
git clone <this-repo> /tmp/claude-setup
/tmp/claude-setup/install.sh --check
/tmp/claude-setup/install.sh
```

The installer is backup-first and idempotent. It preserves the clean/smudge
`__CLAUDE_HOME__` filter, which materializes each Mac's local path in
`settings.json` and the implementer instructions. It never installs tools and
it never syncs credentials. Runtime probes require Node 20–24 LTS (Node 24 is
recommended), a working Codex CLI, and Perl. The wrappers use Perl's portable
alarm timeout, so GNU `timeout` is not required.

The policy is fixed: Claude Opus xhigh performs planning, architecture,
design, diagnosis, review, integration, and final verification. Codex
`gpt-5.6-luna` xhigh is the only automatic implementation writer. Sonnet and
`gpt-5.6-terra` are manual fast lanes. Fable is a manual long-horizon option
after host access is verified. Haiku is limited to deterministic plumbing.
Unavailable models never trigger a silent fallback.

Claude uses exactly one Codex CLI: the first `codex` found on `PATH`, resolved
to one absolute realpath for the run. The installer and both wrappers fail
closed unless that same CLI reports stable version `0.149.1` or newer and
advertises every `codex exec` flag they use. A higher version with a missing
capability is incompatible. This setup never scans for another Codex copy,
honors `CODEX_BIN`, or installs Codex; update the one active CLI through the
installation channel that owns the selected path shown by `install.sh` when
the check fails. The selected executable must also be outside the active
worktree, this checkout, and macOS temporary roots. Immediately before each
final exec, wrappers re-resolve the first PATH winner and compare its
filesystem identity and SHA-256 digest with the preflight snapshot.

`/implement` handles one coherent, clearly scoped unit through exactly one
Luna implementer. `/build` is for structured work: it chooses `serial` or
`parallel`, freezes the split, ownership, contracts, exact working directory,
and verification gates before approval, then starts every ready independent
unit concurrently up to three. Shared parallel execution is guarded by
private per-unit worktrees and canonical physical path checks; shared checkout
fan-out is blocked. Completed patches integrate in worker completion order under
a canonical write lock, while dependency edges still gate dependents.
Approval uses a cryptographic plan identity,
an index/working-tree/untracked fingerprint, and rejects tampering or any
stale checkout. `/review` and `/council` share one
canonical assembled-diff bundle, including staged, unstaged, and full
untracked-file content. Compound Engineering stays installed as an explicit
toolbox for brainstorm, plan, debug, simplify, review, and compound learning.
It is not the scheduler.

## Prerequisites

Install these tools separately. `install.sh` reports missing tools and never
installs them.

| Tool | Purpose |
|---|---|
| `git`, `gh` | repository and GitHub operations |
| Node 20–24 LTS, Perl, `rg`, `jq` | hooks and local checks |
| `codex` | One active CLI for Luna implementation and cross-family review (stable >= 0.149.1) |
| `rtk`, `cmux`, `wt` | local workflow support |
| `bd` | optional dependency-aware backlog |

## Host-local services

MCP authentication remains local to each Mac. Re-authenticate only the
services required by that host. GitHub connector auth is separate from
terminal Git and `gh` auth. Remote Control and macOS permissions also require
local setup.

Open Design is optional and does not block core coding readiness. This
repository records the reviewed signed `0.21.0` app and official distribution
facts in `manifests/design.json`; the installer does not download or install
the GUI app. Install the signed app manually, launch it, and run
`od mcp install claude` using the Open Design CLI. This writes host-local MCP
configuration. There is no Open Design plugin for Claude. The official plugin
distribution targets Codex, while Claude uses the MCP install command. Do not
sync app data, conversations, credentials, absolute commands, or `.od` state.
Bare `/usr/bin/od` is Apple's octal-dump command, not Open Design. See
`docs/design-workflow.md`.

After bootstrap, start a new Claude Code session. Plugins, permissions, model
settings, and MCP discovery are session-scoped. Verify `/plugins`, the MCP
list, `/implement`, `/build`, and `/review` after the restart.

## Currentness

Compound Engineering `3.23.4` and Open Design `0.21.0` are current pins under
review. Check maintained official sources and reproducible evaluations each
quarter. Migrate deliberately, preserve useful knowledge, remove conflicts
only after review, and never migrate because of hype.

See `docs/workflow-migration.md` for the policy.
