---
description: Skill/agent routing — tie-breaks between overlapping skills, and the delegation table.
---

# Routing

## Tie-breaks between overlapping skills

Skill descriptions do the routing; this table only settles overlaps:

| Overlap | Prefer |
|---|---|
| `ce-debug` / `superpowers:systematic-debugging` | `ce-debug` |
| `/council` / `ce-code-review` | `/council` is the default review path; `ce-code-review` only inside a blank `ce-work` run |
| `/plan` / `ce-plan` / `ce-brainstorm` / `superpowers:writing-plans` | `/plan` — it invokes brainstorm/plan/codex-review itself; `Plan` agent only for architecture-only design |

## Delegation

Main thread orchestrates; separable work goes to agents. Tiering/dispatch → `rules/orchestration.md`.

| Work | Route |
|---|---|
| Read-heavy gathering, audit, "find out why" | `Explore` (codebase) / `general-purpose` (multi-step) |
| Planning anything, any size | `/plan` — it decides brainstorm-first and cross-review itself |
| Executing any approved work, any size | `/build` — it routes to parallel/ce-work/inline itself; pre-judging is the mistake |
| Well-specified unit, or work `/build` routed to `inline` | `implementer` — review the returned diff |
| Reviewing anything, any size | `/council` — the review entry point; it sizes its own seating, sends you to `autofix` first if CodeRabbit threads are open, and declines outright on a mechanical diff |
| Review inside a blank `ce-work` run | `ce-code-review` — hardwired there; don't fight it |
| CodeRabbit threads on an open PR | `coderabbit:autofix` — `gh`-only; `/council` routes here itself when threads are unresolved |
| Same bug after 2 failed Claude attempts | `/codex:rescue` |
| Large bounded task that'd eat the main thread | `/codex:rescue --background` |

Review at checkpoints, not per edit.

**Deleted 2026-07-28**, after measuring 0 invocations each across 895 transcripts: `sam-review`,
`self-consistency`, `best-of-n`, `verify-this`, `thermo-nuclear-code-quality-review`, `diagnose`,
`control-cli`, `control-ui`, `improve-codebase-architecture`, plus the `spec-deriver` and
`test-writer` agents and the unregistered `self-consistency-nudge.sh`. Recoverable from git;
evidence and method in `docs/routing-rationale.md`.

**CodeRabbit's CLI is machine-local; its GitHub app is not.** `coderabbit:code-review` needs a
`coderabbit` binary that exists on only some machines — never route to it unhanded. `autofix` needs
only `gh`. Don't offer to install the CLI to unblock a review; use `/council`.

**Check for the binary before concluding the skill is gone.** Measured 2026-08-05: `Skill` returned
`Unknown skill: coderabbit:code-review` while the plugin was enabled in `settings.json`
(`coderabbit@sam: true`) and `skills/code-review/SKILL.md` was present in the cache. So an unresolved
skill name proves nothing about the tool. `command -v coderabbit` answered, and the binary worked.
Run it directly rather than reporting the review as unavailable:

```
coderabbit review --agent --type committed --base origin/main --dir <service-dir>
```

`--agent` emits one JSON object per line and a final `{"type":"complete","findings":N}`, which is the
only form worth parsing. Without `--base` it reviews the working tree, so on a clean tree after a
commit it finds nothing and that reads as a pass. `--dir` scopes a monorepo review to one service.

**Two review lenses can be silently absent, and both fail in a way that looks like a clean pass:**

| lens | how it fails | what you must do |
|---|---|---|
| Codex (`codex-run.sh`) | **exits 0** with `Your workspace is out of credits` in the body | grep the body; never read exit 0 alone as a completed pass |
| Cursor Bugbot | reports `bucket=skipping`, `state=NEUTRAL` on a push | that is *no review*, not a pass — `gh pr checks` shows it as non-pass |

**`fable` is not dispatchable on this account.** An `Agent` call with `model: "fable"` fails with
"model may not exist or you may not have access". Don't offer it as a reviewer; use a different model
in a fresh context, and say plainly that same-family review is not a cross-family pass.
