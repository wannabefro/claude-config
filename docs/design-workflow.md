# Open Design workflow

Open Design is the optional design capability. It does not block coding
readiness. Its release policy is in `manifests/design.json`.

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

## Host-local boundary

The Open Design app, MCP configuration, data, conversations, credentials,
absolute commands, and `.od` runtime state stay on each Mac. Do not sync them
through this repository. Configure the MCP server from the exact snippet that
the signed Open Design app generates. The current Mac's `/usr/bin/od` is the
Apple octal-dump tool; do not assume that bare `od` means Open Design.

The stale clone at `/Users/sam/dev/open-design` is not a source of truth. Do
not change or delete that clone.

## Review-only readiness steps

Do not run these steps as part of bootstrap. Review the pinned artifact for the
machine architecture, verify its SHA-256 against `manifests/design.json`, and
verify the app bundle identifier, version, architecture, Developer ID
signature, and team identifier before any manual copy.

After a signed app is present, configure `open-design` from its app-generated
MCP snippet. Verify it with the read-only Codex command:

```bash
codex mcp get open-design --json
```

Missing app or MCP produces `design_ready: false` and an action item. It does
not make the core coding-ready result fail.
