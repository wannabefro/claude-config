# Workflow currentness and migration

The automatic workflow uses Opus xhigh for thinking and Codex Luna xhigh for
implementation. One coherent unit uses `/implement`; structured work uses
`/build`; `/review` selects the risk-appropriate assembled-diff review.
Compound Engineering remains installed as an on-demand toolbox, not as the
scheduler.

Current evidence pins are:

- Compound Engineering `3.23.4`, commit
  `33d9bd92689d60580e732890f94466e5793385b1`.
- Open Design app `0.21.0`, tag `open-design-v0.21.0`, source commit
  `dbbd3b42eab9609065637452b347f903d7125ecd`.
- Open Design agent distribution `open-design@open-design` `0.5.3`, source
  commit `c0710761302c69bded82e205362effcce6fde49e`.

Review currentness quarterly from maintained official sources, release notes,
and reproducible evaluations. Keep useful accumulated knowledge. Do not
migrate because of hype. A migration requires a reviewed plan, explicit
replacement evidence, removal of conflicting routes, and an end-to-end
verification pass. Do not run an automatic migration.

Open Design supersedes the standalone Impeccable entry because it bundles the
relevant polish capability. Superpowers remains excluded. Figma remains an
optional bridge and does not replace the frozen design contract.

Open Design is a host-local optional integration. Install its signed app
manually. Claude uses `od mcp install claude`; Codex uses
`od mcp install codex` and may use the pinned Codex plugin. Keep app data,
conversations, API keys, credentials, caches, absolute MCP commands, and `.od`
runtime state on the host. Use the local Codex CLI in Open Design when privacy
matters. There is no Open Design plugin for Claude.

Fable is a manual long-horizon escalation after host access is verified. It is
never an automatic route or a silent fallback.
