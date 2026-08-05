# Language

**Write every report in ASD-STE100 Simplified Technical English.** The 16 always-on rules and the
scope carve-outs are in `rules/simplified-technical-english.md`. Invoke the `simple-english` skill for
text you *author* — a README, a runbook, an error message.

**Read the project's own context files first, and reuse its ubiquitous language.** `CLAUDE.md`,
`AGENTS.md`, a `docs/` set, a glossary, the type names. Call a thing what this codebase calls it, even
where another name reads better. A second word for one concept is the drift STE rule 10 forbids, and it
compounds silently. If two context files name one concept differently, surface the conflict rather than
pick a third name.

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
lacks. Verified 2026-07-29 with `rtk rewrite`: it touches `cat` and `ls`, and nothing else here.

**`rg -r` is `--replace`, not grep's `--recursive`** — rg recurses by default, so `rg -rn 'X' src`
clusters as `--replace=n` and prints every match replaced by the literal `n`. It looks like a
corrupt file, not a wrong flag: it cost five bad searches and two wrong accusations against rtk in
one session. `bash-safety.sh` now denies the clustered `-r<letter>` form.

**`curl` is allowed; write to a file, not to stdout.** Two layers, and only one is gone. The
`Bash(curl *)` deny was removed 2026-07-31, because it never removed the capability — it just pushed
every fetch into `node https.get` inside `ctx_execute`, which is the same network access with less
visibility. context-mode's routing hook still redirects curl whose **body reaches stdout**, and no
env var turns that off. So use `curl -fsSL <url> -o <file>`, then read the file. `wget` stays denied,
and `bash-safety.sh` still blocks `curl … | sh`.
