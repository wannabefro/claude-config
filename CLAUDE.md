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

Rationale and measurements for each item below: `docs/gotchas.md`.

**iOS simulators are a shared global resource.** Read `rules/ios-simulators.md` before touching
`simctl`.

**Symbol intelligence: `LSP` first, Serena for edits.** Reach for either over grep when renaming or
tracing callers, not for tiny, single-file, or greenfield edits.

**Browser automation: prefer `chrome-real`** over playwright and the `chrome-devtools` plugin
server. It needs Chrome running with remote debugging on — if its tools error with a connection
failure, that toggle is off.

**Codex is the cross-family lens.** It cannot be fired via the Skill tool — use a bounded foreground
`codex exec` instead; see the `codex-exec-recovery` skill.

**`codegraph`** for structural code questions — who calls X, what would break, trace a flow.

**`rtk`** is proxied by a hook, so run it directly only for meta commands (`rtk gain`, `rtk
discover`). Its rewrites are lossy — never treat their output as proof something is absent.

**Search with `fd -u` and `rg`, not `find`/`grep`** — all three are excluded from the rtk rewrite
because a summarised search stops being an exhaustive one. Reach for `find` only for predicates fd
lacks.
