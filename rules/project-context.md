---
description: Pointers to repository-specific setup and on-demand references.
---

# Project context

Use this file as a map. Read a reference only when the task needs its details.

- Repository stacks, build commands, and worktree environments: `docs/local/klaviyo-repos.md`.
- Internal connectors and machine-local rules: `docs/local/klaviyo-internal.md`.
- Worktree and cmux setup: `docs/worktree-mechanics.md` and `docs/worktree-button.md`.
- iOS simulator commands: `docs/ios-simulator-recipes.md`; the path-scoped invariant stays in `rules/ios-simulators.md`.
- Open Design setup: `docs/design-workflow.md`.
- Measured tool gotchas (rtk lossiness, fd vs find, LSP vs Serena): `docs/gotchas.md`.

The two `docs/local/` files contain machine-local content. Keep them ignored through the machine's local Git exclude. They do not load as rules from `docs/`; consult them when the repository or host context requires them.

Use repository instructions and the relevant project skills before running project checks. Keep this file as a pointer map, not a mandatory workflow.
