# Design fidelity

When a project has a design source of truth (Figma, a `design/` doc set, a spec mockup), follow it
exactly — structure, layout, copy, states, navigation. Don't silently "improve" or average against
it; a drift that reads as complete is worse than an obvious gap. If following it is impossible or
you believe it's wrong, surface the conflict and get permission before diverging.

When *you* make a design decision with no source of truth to follow, **show me a visual, not prose**
— a rendered mockup (`SendUserFile` with `display: render`), an `Artifact` when I should be able to
review it from my phone, or a screenshot of the running UI. Even a single-screen choice. For a
non-visual architecture decision, a diagram is the equivalent.

# Gotchas

**iOS simulators are a shared global resource.** Several apps are in flight in parallel sessions, so
a global reset breaks someone else's run. Read `rules/ios-simulators.md` before touching `simctl`.

**Serena onboarding is one-time per project.** First session in an activated project: check
`mcp__serena__check_onboarding_performed`, run `mcp__serena__onboarding` if not. Later sessions read
`.serena/memories/` instead. Use it for symbol-precise navigation and renames in an LSP-indexed
project — not for tiny, single-file, or greenfield edits.

**Browser automation: prefer `chrome-real`** over playwright and the `chrome-devtools` plugin server.
Those launch fresh unauthenticated browsers that fail on session- and dev-proxy-gated pages;
`chrome-real` drives my actual logged-in Chrome. It needs Chrome running with remote debugging on —
if its tools error with a connection failure, that toggle is off.

**Codex is the cross-family lens** (`codex-companion` runtime; bills separately, so not for trivia).
Claude cannot fire the `/codex:*` skills via the Skill tool, and the async rescue agent stalls in
background mode — use a bounded foreground `codex exec` instead. Its two no-output failure modes and
the exact invocation live in the `codex-exec-recovery` skill.

**`codegraph`** for structural code questions — who calls X, what would break, trace a flow.

**`rtk`** proxies dev commands for token savings and a hook rewrites them transparently. Run it
directly only for meta commands (`rtk gain`, `rtk discover`). If `rtk gain` errors, a different tool
named rtk is on PATH.
