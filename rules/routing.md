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

**When Codex cannot answer, CodeRabbit is the cross-family lens.** Codex stays first choice, because
it reasons about the diff rather than pattern-matching it. But an unavailable CLI (exit 3) or a
refusal for lack of credits (exit 6) used to be a dead end, and it is not one: both are a different
family from Claude, so either satisfies the cross-family requirement in `rules/shipping.md`.

| `codex-run.sh` exit | what to do |
|---|---|
| 0 | the pass happened; use it |
| 3 unavailable, 6 out of credits | `command -v coderabbit`; if present, run CodeRabbit instead |
| 4 stalled, 5 empty | re-run once per `codex-exec-recovery`, then fall back the same way |

Branch on the exit code, never on the output, and check for the binary the way the next section
says. Say which lens ran and why. "Codex was out of credits, so CodeRabbit reviewed it" is a different
claim from "Codex reviewed it", and a guardrail diff deserves the true one. If neither lens is
available, report that plainly rather than presenting a Claude-only review as cross-family.

**Check for the binary before concluding the skill is gone.** Measured 2026-08-05: `Skill` returned
`Unknown skill: coderabbit:code-review` while the plugin was enabled in `settings.json`
(`coderabbit@sam: true`) and `skills/code-review/SKILL.md` was present in the cache. So an unresolved
skill name proves nothing about the tool. `command -v coderabbit` answered, and the binary worked.
Run it directly rather than reporting the review as unavailable:

```
coderabbit review --agent --committed --base origin/main --dir <service-dir> -c AGENTS.md
```

**`--type committed` was removed.** Verified against 0.7.5 on 2026-08-28: the selector is now the
boolean `--committed`, or `--uncommitted` for staged and tracked edits. The old form fails, and it
fails at the one moment you need the fallback. `--show-prompts` is refused alongside `--agent`, so it
is not a way to dry-run the agent invocation.

`-c/--config` takes extra instruction files, so hand it the project's own `AGENTS.md` or `CLAUDE.md`.
Without it CodeRabbit reviews against its defaults and not against the repo's rules, which is the same
gap `hooks/agents-md-context.py` closes for you.

`--agent` emits one JSON object per line and a final `{"type":"complete","findings":N}`, which is the
only form worth parsing. Without `--base` it reviews the working tree, so on a clean tree after a
commit it finds nothing and that reads as a pass. `--dir` scopes a monorepo review to one service.

**Two review lenses can be silently absent, and both fail in a way that looks like a clean pass:**

| lens | how it fails | what you must do |
|---|---|---|
| Codex | the CLI **exits 0** with `Your workspace is out of credits` in the body | `codex-run.sh` now catches that phrase and exits **6**; branch on the code, do not grep |
| Cursor Bugbot | reports `bucket=skipping`, `state=NEUTRAL` on a push | that is *no review*, not a pass — `gh pr checks` shows it as non-pass |

**`fable` is not dispatchable on this account.** An `Agent` call with `model: "fable"` fails with
"model may not exist or you may not have access". Don't offer it as a reviewer; use a different model
in a fresh context, and say plainly that same-family review is not a cross-family pass.
