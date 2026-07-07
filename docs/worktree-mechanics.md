# Worktree Workflow — Config & Mechanics (reference)

On-demand reference for the worktrunk + cmux setup. Pulled out of `rules/worktree-workflow.md` (which keeps the per-session decision rules) to keep always-on context lean — read this only when setting up or debugging the worktree tooling.

## Config / mechanics

- User config: `~/.config/worktrunk/config.toml`. Hook launcher:
  `~/.config/worktrunk/open-cmux.sh` (holds the cmux layout JSON; titles each
  workspace `<branch> · <repo>`, repo name from the origin remote).
- The cmux hook is `pre-start`, **not** `post-start`: worktrunk detaches `post-*`
  hooks and the detached process can't reach the cmux socket (EPIPE). The launcher
  always exits 0 so a cmux failure can't abort worktree creation.
- The launcher pre-trusts each new worktree (`hasTrustDialogAccepted` in
  `~/.claude.json`) so Claude Code's folder-trust prompt doesn't fire — a worktree
  is a checkout of an already-trusted repo. Other prompts/guardrails are unaffected.
- New shell after install: the `wt` shell function (defined in your `~/.zshrc`) must be active
  for `wt switch`/`merge` to change directory. Restart the shell once after setup.
- The launcher also seeds `.codegraph` from the main checkout (APFS clonefile +
  detached `codegraph sync`) and, where applicable, resolves the beads DB via
  git-common-dir so worktrees share the main repo's `.beads/`.

## Recommended next toggle

AI commit messages on `wt merge` via Claude Code — uncomment `[commit.generation]`
in `config.toml`. Off by default (spawns a haiku process per commit).
