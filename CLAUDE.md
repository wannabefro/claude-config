# Language

**Write every report in ASD-STE100 Simplified Technical English.** The 16 always-on rules and the
scope carve-outs are in `rules/simplified-technical-english.md`. Invoke the `simple-english` skill for
text you *author* — a README, a runbook, an error message.

**Read the project's own context files first, and reuse its ubiquitous language.** `CLAUDE.md`,
`AGENTS.md`, a `docs/` set, a glossary, the type names. Call a thing what this codebase calls it, even
where another name reads better. A second word for one concept is the drift STE rule 10 forbids, and it
compounds silently. If two context files name one concept differently, surface the conflict rather than
pick a third name.

**`AGENTS.md` is the one the platform does not load for you.** Claude Code auto-loads `CLAUDE.md`.
A repo usually bridges that by making `CLAUDE.md` an 11-byte `@AGENTS.md` import stub, and measured
2026-08-28 across the work repos, 887 of 928 are bridged that way. The other 41 have no stub, so
nothing opens them unless you do. `hooks/agents-md-context.py` injects exactly those at the moment of
the edit, once per file per session. A silent hook means a stub already covered the file. It does not
mean no `AGENTS.md` governs it.

`scripts/agents-md-coverage.py` regenerates the list and exits 1 on any gap. Run it rather than trust
the number above, because repos change. Where an `AGENTS.md` and a habit of yours disagree, the repo
file wins — and say so, rather than averaging the two.

**Write a comment or a docstring on one line.** Only a very good reason earns a second line: a
workaround whose cause needs naming, or an invariant the reader cannot infer. The countable limits
and the checker are in `rules/principles.md`.

# Design fidelity

When a project has a design source of truth (Figma, a `design/` doc set, a spec mockup), follow it
exactly — structure, layout, copy, states, navigation. Don't silently "improve" or average against
it; a drift that reads as complete is worse than an obvious gap. If following it is impossible or
you believe it's wrong, surface the conflict and get permission before diverging.

When *you* make a design decision with no source of truth to follow, **show me a visual, not prose**
— a rendered mockup (`SendUserFile` with `display: render`), an `Artifact` when I should be able to
review it from my phone, or a screenshot of the running UI. Even a single-screen choice. For a
non-visual architecture decision, a diagram is the equivalent.

# After a review, fix the obvious things

When a review I asked for comes back — `/council`, `ce-code-review`, a reviewer agent — implement the
clear-cut findings in the same turn. Do not hand me a list to approve first.

Obvious means all three: the finding names a real defect, the fix is contained, and no design or
product decision is in question. Everything else waits — an interface change, a disagreement between
reviewers, or a fix larger than the finding.

Report what you fixed and what you left, and say why you left it.

Incoming feedback on an open PR is a different path. `rules/shipping.md` governs that one.

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
