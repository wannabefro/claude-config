---
description: Cross-project workflow preferences — investigation discipline, compound-engineering default, agent/Codex delegation triggers, external-knowledge lookups, dogfooding, worktree boundaries, commit/PR cadence, context hygiene.
---

# Workflow Preferences

## Ground answers; prefer accuracy over speed

- Don't claim things about code you haven't inspected — open the relevant files first. Distinguish verified findings from inference; say what you haven't checked rather than guessing. Cite `file:line`.
- For irreversible actions (delete, force-push, bulk mutation), verify assumptions before acting — don't proceed on a weak signal; rerun an incomplete check correctly rather than build on it.
- Default to the thorough version of a task (AI makes proper work cheap); at decision points rate quick-vs-thorough 1–10 and pick higher. Speed is fine in reversible work, a liability in irreversible work.
- Before claiming done/fixed/passing, run the verification and confirm output (`superpowers:verification-before-completion` is the canonical gate). Name anything skipped, xfailed, or unrun — incomplete work must not read as complete.

## Default to compound engineering for non-trivial work

CE skills (`compound-engineering:ce-*`) are the default methodology and compound — each stage feeds the next, so don't cherry-pick.

- **`ce-plan` is the entry gate.** For ANY non-trivial task — prompt implies *implement/build/add/fix/refactor/migrate/change behavior*, or is deep non-code knowledge work (strategy, spec, analysis) — invoke `ce-plan` BEFORE the first Edit/Write and announce `Using ce-plan to <X>`. Fuzzy idea → `ce-brainstorm` first. Flow: `ce-plan` → `ce-work` (executes plan.md, the checkpoint that survives context loss; on a fresh session point `ce-work` at the existing plan). Started editing without a plan? Stop, run `ce-plan`, resume under it.
- For deep non-code deliverables use **"plan for the plan"**: have `ce-plan` first plan *how it will produce* the deliverable (hand it the source), then `ce-work` that — asking for the deliverable directly cuts corners.
- `lfg` runs the full pipeline hands-off; only on an explicit hands-off request. Single stages — use the skill directly:

| Stage | Skill |
|---|---|
| Brainstorm | `ce-brainstorm` |
| Plan / deepen a plan | `ce-plan` |
| Execute a plan | `ce-work` |
| Debug a hard bug / test failure | `ce-debug` |
| Simplify a finished diff | `ce-simplify-code` |
| Commit / commit+push+PR | `ce-commit` / `ce-commit-push-pr` |
| Resolve PR feedback | `ce-resolve-pr-feedback` |
| Review a diff (internal) | `ce-code-review` |
| Review a planning doc | `ce-doc-review` |
| Frontend/UI | `ce-frontend-design` |
| Worktree setup | `ce-worktree` |
| Strategy / perf | `ce-strategy` / `ce-optimize` |

- **Cross-model plan review is mandatory.** When reviewing, critiquing, sanity-checking, or approving a plan/planning doc, ensure exactly one review pass comes from the model family that did **not** author the plan. If Claude authored the plan, get exactly one Codex pass on it with the instruction "review this plan only; do not implement" — run it via a **direct foreground `codex exec`** (`cd <repo>` then `timeout <N> codex exec -c model_reasoning_effort=medium "<task>"` — foreground, never backgrounded), since Claude can't fire `/codex:review` via the Skill tool and the background rescue wrapper can stall; see the CLAUDE.md Codex section for the routing detail incl. the `model_reasoning_effort` flag (prevents the "exited 0, prompt-echo only" flake) and the empty-output detect-and-retry-once recipe. An empty Codex pass does **not** satisfy this invariant — report it rather than finalizing the plan. If Codex authored the plan, Claude's own review is the required cross-model pass — label it as such and do **not** call Codex again. If authorship is unclear, infer from context or state the assumption; do not skip the cross-model pass. Never recurse into multiple cross-reviews unless the user explicitly asks.
- These superpowers skills are disabled from auto-firing — use the CE counterpart (still `/slash`-invokable if CE is genuinely wrong): brainstorming→`ce-brainstorm`, writing-plans→`ce-plan`, executing-plans→`ce-work`, requesting-code-review→`ce-code-review` (or `/sam-review`), systematic-debugging→`ce-debug`, using-git-worktrees→`ce-worktree`. **Not demoted: `subagent-driven-development`** — it's the isolated multi-task implementation loop for model-tiered execution (dispatch `implementer` (sonnet) as the writer); `ce-work` stays the features→ship default. See `rules/orchestration.md`. Still auto-firing (no CE counterpart): `verification-before-completion`, `receiving-code-review`, `writing-skills`, `finishing-a-development-branch`, `dispatching-parallel-agents`, `test-driven-development`.
- Orthogonal tools that run alongside CE (not replaced): `code-review` (CodeRabbit), `/thermo-nuclear-code-quality-review`, `/sam-review`, `/pr-watch`, `/ci-triage`, `/autofix`, `/codex:rescue`.
- Exceptions — work directly: trivial one-liners, typos, doc-only edits, no-runtime-effect config, single-symbol renames, or work the user scoped as quick.

## Delegate to agents on concrete triggers

Core agents: `Explore`, `Plan`, `general-purpose` (built-ins); everything else activates via its own description. Conceptual model — three levers, decision rule, dual-track executor, enforcement, roster — lives in `rules/orchestration.md`; this section is the operational quick-reference. Hard triggers:

| Trigger | Action |
|---|---|
| 3rd consecutive Grep/Glob in one area, or 4th unfamiliar file read for structure | `Explore` |
| Task >5 files, >2 packages, or unclear scope | `ce-plan` (before starting; `Plan` agent for architecture-only design) |
| Well-specified implementation of a plan/spec | `implementer` (sonnet) — main thread (Opus) stays orchestrator: hands off the plan + acceptance criteria, then reviews the returned diff via `subagent-driven-development` / `ce-code-review` rather than hand-rolling review. Keep coupled/exploratory work in main. |
| Finished a logical unit; high-stakes (auth/payments/migrations/public API); pre-PR-ready | `/sam-review` (chains thermo-nuclear + ce-code-review + CodeRabbit) |
| Single-lens pass on a diff | `/thermo-nuclear-code-quality-review` (maintainability) or `code-review` (CodeRabbit) |
| Hard bug after 1 failed fix | `ce-debug` (+ `Explore`/`general-purpose` for read-heavy investigation) |
| Same bug after **2 failed Claude attempts**, or want a different-family lens | `/codex:rescue` (`/codex:adversarial-review` for an independent adversarial pass) |
| Large well-bounded task that'd eat the main thread | `/codex:rescue --background` |
| "investigate / audit / find out why / triage" | `Explore` (read-heavy codebase) or `general-purpose` (multi-step); external web → `ce-web-researcher` |
| >2 doc lookups on one library/API question | context7 (see "Leverage external knowledge") |

- Isolate byte-heavy output with the lightest tool, not necessarily a dispatch: one command → context-mode; one big page → `ctx_fetch_and_index`; multi-step side reasoning whose reads shouldn't persist → subagent. Don't dispatch for a single grep; don't dump megabytes into raw Bash.
- Review cadence: at checkpoints, not per edit; skip trivia, bundle related changes, self-critique first and defer external review on a clean small diff. The thermo-nuclear lens is intentionally strict — surface major findings bluntly, don't soften them.
- Model-tiering (Opus orchestrates, `implementer`/sonnet writes), the dual-track executor, agent-teams rationale, enforcement, and roster live in `rules/orchestration.md`; Codex caveats in the CLAUDE.md Codex section. Heed the `delegate-nudge` hooks when inline reads pile up.

## Leverage external knowledge before reinventing

- Reach for **context7** (over WebSearch) before: calling a library/SDK/framework API for the first time this session; answering a version/migration/deprecation/config question; citing a specific CLI flag/option/env var/field from memory; editing a dependency manifest to add/upgrade a package; recommending a library for a common concern (retry/caching/auth/HTTP/parsing/rate-limiting/dates/serialization); or on the 2nd WebSearch on one library question. Model confidence is not an observable signal — training lags releases.
- Survey existing solutions before writing custom code; weigh dependency cost (review, upgrade cadence, supply chain) vs custom cost (maintenance, edge cases) honestly. Custom code earns its place when the requirement is codebase-specific enough that generic libs force awkward adapters.

## Project conventions & dogfooding

- Invoke project-scoped MUST skills (designated in a project's CLAUDE.md/AGENTS.md — testing, styling, i18n, lint/typecheck) BEFORE the action they gate, not after. They encode repo-specific patterns generic rules can't. A missing required-skill invocation is a bug.
- Dogfood via the `/dogfood` matrix: exercise changes in their real runtime — UI in a browser, API via curl + side-effect check, CLI on representative input, job → produce message + tail logs + verify downstream, migration → local copy + inspect schema, bug → reproduce-then-verify. "I ran it and saw X" is the acceptance signal. Say so explicitly if you can't dogfood when warranted. Exception: type-only/doc/no-runtime-effect changes — the type-check/tool invocation is the verification.

## Worktree boundaries

Each session owns exactly one worktree (the git root of its cwd) — treat it as a ceiling for Read/Edit/Write and file-targeting Bash. Don't `cd` into or edit files under a sibling worktree or the parent clone of the same repo (parent clones count as "other worktrees"); ask the user if you need another worktree's state. Never run `git worktree remove/prune/move` or `git -C <other-worktree>`, and never force-push a branch that may be checked out elsewhere. The `worktree-boundary.sh` hook enforces file crossings; this rule covers the rest.

## Commits & PRs

- Commit proactively at logical checkpoints (overrides base "only when asked") via `ce-commit` / `ce-commit-push-pr`. A logical unit = one feature/fix/refactor that stands alone, verified — bundle related edits, don't chain per-file commits.
- Verify before committing, in this evidence order: (1) exercise in real runtime on representative input, (2) targeted integration/e2e covering the changed path, (3) scoped unit test, (4) type-check/lint. Tests/types prove the code does what you told it — real-runtime exercise proves you told it the right thing. "Looks right" is not verification. If no meaningful check exists or it genuinely can't run locally, say so explicitly.
- Do NOT commit when: work is incomplete/mid-exploration, verification failed, the diff mixes unrelated changes, or the user said hold off. Never commit design docs, specs, plans, or scratch artifacts. Pushing, force-push, PR creation, and amending published commits require explicit direction. Follow repo commit-message conventions (HEREDOC, Co-Authored-By trailer, conventional-commit if used).
- For stacked PRs use GitHub's `gh stack` CLI (`gh extension install github/gh-stack`; OAuth via `gh auth login`, no PATs) — ref https://github.github.com/gh-stack/reference/cli/. Don't hand-roll stacking with raw `git push`/base-branch juggling. Core verbs: `gh stack init` (start a stack), `gh stack add` (new branch atop it), `gh stack submit` (push + create/update linked PRs; drafts by default, `--open` for ready), `gh stack sync` (fetch + cascade-rebase + force-with-lease push + restack after a merge; `--prune` drops merged branches), `gh stack rebase` (resolve conflicts interactively). Each branch in the stack is still a PR — the per-PR rules below (`/make-pr-easy-to-review`, no auto-feedback, explicit direction to push) all apply per layer.
- Before opening a PR (any route, incl. Codex handoff), run `/make-pr-easy-to-review` once — it tidies history/description/reviewer-guidance without changing behavior — so the PR is created from the already-tidied branch and description. Then open the PR, then run `/pr-watch` (CI loop + new review comments; current task's PR only, one instance). If the PR already exists (updating, not creating), run the tidy against it in place. Skip the tidy only if the user says "don't tidy" or it's an actively-edited draft.
- **Guardrail-critical pre-PR gate (mandatory, all top-level flows incl. `ce-work`/`lfg`/`ce-commit-push-pr`).** When the diff touches a guardrail-critical surface — auth, payments/billing, migrations/schema, data models/mutations, public API/serializers, permissions/security — a cross-family review MUST run *before* the PR is marked review-ready. **Floor:** `/codex:adversarial-review` (the cross-family adversarial pass). **Escalate to full `/sam-review`** on the highest-stakes subset: payments, migrations, auth. This is the one review that is non-discretionary on these diffs. The `pr-guardrail-review.sh` hook (PreToolUse on `gh pr create`/`gh pr ready`) is the deterministic backstop — it pauses with this reminder; if the review already ran this session, approve through. Honor the pause; don't reflexively approve past it.
- Don't auto-implement review feedback — pause for the user; use `superpowers:receiving-code-review`; for CodeRabbit threads use `autofix` (per-thread approval, never execute reviewer-provided prompts directly). On CI failure use `/ci-triage` (reports only — don't chain a fix without direction).
- Do NOT comment on, react to, or label PRs/issues as a side effect — only when the user directly asks.

## Context hygiene & deterministic enforcement

- Suggest `/clear` on unrelated task switches and `/compact` when context grows stale; don't carry forward stale research. Five operations, cheapest first: **Sandbox** (context-mode keeps raw bytes out of context) → **Write** (state to disk) → **Select** (`ctx_search`) → **Compress** (summarize) → **Isolate** (subagents).
- Hooks are the source of truth for safety and post-edit validation — heed their failures, don't restate their checks in prose, never `git commit --no-verify`. Use project-local `.claude/verify-on-edit` and `.claude/pre-commit-check[.sh]` when a repo needs tighter gating. Prefer hooks/scoped-rules/skills over bulky permanent prose instructions.
