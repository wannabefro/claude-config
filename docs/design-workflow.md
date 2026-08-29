# Open Design workflow

Open Design is an optional, host-local design bridge. It does not block core
coding readiness. The reviewed app release and official distribution facts are
in `manifests/design.json`.

## Phase routing

1. Write a short brief and collect references.
2. Use Claude Opus xhigh for design direction. If Open Design uses Codex,
   use Codex `gpt-5.6-sol` xhigh for direction and critique.
3. Freeze `DESIGN.md`, `design-contract.md`, and
   `implementation-handoff.md` before any implementation dispatch.
4. Use Codex `gpt-5.6-luna` xhigh for an optional prototype and for every
   artifact or code write.
5. Use at most three disjoint Luna workers for independent production units.
6. Use Opus xhigh for serialized integration, visual critique, accessibility
   review, and final sign-off.

The reviewer reads the frozen design files. The worker follows them and does
not invent a competing aesthetic. There is no permanent designer agent.

## Host-local setup

The signed Open Design app is a manual prerequisite. This repository does not
download, install, or replace it. Install the reviewed `0.21.0` app on each
Mac, then launch it and complete any Open Design account or Vela login in the
app when required.

With the Open Design CLI available in the shell, install the Claude MCP
configuration locally:

```bash
od mcp install claude
```

Claude uses this official MCP integration. Claude has no Open Design plugin.
The official plugin distribution is for Codex only; its pinned
source, plugin version, and minimum versions are recorded in the manifest.
The command writes host-local MCP configuration. Do not copy that
configuration, app data, conversations, credentials, absolute commands, or
`.od` runtime state through this repository. The current Mac's `/usr/bin/od`
is Apple's octal-dump tool; if the shell resolves that binary, use the Open
Design CLI supplied by the signed app instead.

The stale clone at `/Users/sam/dev/open-design` is not a source of truth. Do
not change or delete that clone.

## Review-only readiness steps

Do not run these steps as part of bootstrap. Before manual installation,
review the pinned artifact for the machine architecture and verify its
SHA-256 against `manifests/design.json`. After installation, verify the app
bundle identifier, version, architecture, Developer ID signature, and team
identifier. Stop on any mismatch.

After the signed app is present, run the official Claude MCP setup command
above. Verify the resulting host-local entry with the Claude MCP list. Do not
copy an absolute command into this repository. For Codex hosts, the equivalent
official command is `od mcp install codex`.

```bash
claude mcp list
```

If the app is missing, or the Claude MCP is not configured, report the design
capability as unavailable and show the manual action. This does not make the
core coding-ready result fail.
