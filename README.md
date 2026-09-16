# Claude Code setup (`~/.claude`)

This repository stores the portable Claude Code configuration: rules, commands,
agents, hooks, skills, and settings. It excludes credentials,
runtime state, conversations, plugin caches, and host-specific commands.

## Bootstrap

```bash
git clone <this-repo> /tmp/claude-setup
/tmp/claude-setup/install.sh --check
/tmp/claude-setup/install.sh
```

The installer backs up the current configuration before it changes anything.
It is idempotent and does not install tools or copy credentials. Start a new
Claude Code session after installation so the configuration and plugins reload.

## Work routes

Claude owns requirements, architecture, diagnosis, task decomposition,
integration, and final judgment. Use direct execution for trivial edits and
tightly coupled work. Use Sonnet implementers for substantial, well-scoped
units. Use bounded research workers when read-only delegation saves time.

`/implement` sends one coherent unit to one implementer. `/build` uses native
isolated worktrees for independent units, with at most three concurrent
writers, then integrates the results serially. Shared contracts and dependent
units run in order. `/review` performs one independent Codex check for the
assembled behavior-changing diff. An authored plan also gets one Codex check;
routine work needs no plan. Compound Engineering remains an on-demand toolbox
for planning, debugging, review, simplification, and durable learning.

Run the relevant repository tests, lint, type checks, and direct runtime checks
for the change. Do not add a mandatory skill chain or repeat checks that add no
evidence. Preserve unrelated work and report any skipped or failed check.

## Prerequisites

Install these tools separately. `install.sh --check` reports missing tools and
does not install them.

| Tool | Use |
|---|---|
| `git`, `gh` | Repository and GitHub operations |
| Node 20–24 LTS, Perl, `rg`, `jq`, Python 3 | Hooks and local checks |
| `codex` | One independent review check |
| `rtk`, `cmux`, `wt` | Optional local workflow support |
| `bd` | Optional backlog tracking |

Use `docs/design-workflow.md` for the optional Open Design integration and
`rules/project-context.md` to find repository-specific and machine-local
references. Keep `docs/local/` ignored through the machine's local Git exclude.

## Publishing

Do not push, open or update a pull request, send messages, or publish changes
unless the user explicitly authorizes that action. Review and verification can
continue without publishing.

## Local checks

Run `scripts/run-evals.sh` to run the available configuration checks. It reports
the suite results and exits non-zero when a suite fails.
