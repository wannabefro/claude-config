# Orchestration & Delegation

The main thread (Opus) is an **orchestrator** — it plans, decides, reviews, and
holds coupled reasoning. It pushes **separable** work to cheaper / isolated
agents. Nothing in the platform forces delegation (it is always a model
decision), so deterministic hooks nudge it and the decision rule below governs
routing. This doc owns the conceptual model; `workflows.md` holds the
operational hard-trigger table and points here.

## Three orthogonal levers

Keep these distinct — conflating them is the usual mistake.

| Need | Mechanism | Cost |
|---|---|---|
| **Cheaper writes (model tiering)** | subagent pinned `model: sonnet` — the `implementer` agent | ~40% cheaper than Opus |
| **Context isolation of separable work** | any subagent (`Explore` / `general-purpose` / `implementer`), or `ce-work`'s subagent dispatch | cheap |
| **Parallelism of independent workstreams** | agent teams (`cmux claude-teams`) | ~7× — only when genuinely parallel |

Agent teams are **not** a tiering tool: per-teammate model selection is
unsupported (CC issue #24316), teammates share one model, and a team costs ~7×
tokens. Use teams only for genuinely independent parallel workstreams; the
documented "Opus orchestrates, cheaper model writes" path is a `model: sonnet`
subagent, not a teammate.

**Pick the implementer's tier per dispatch — `model: sonnet` is only the
default.** The Agent tool takes a `model` override, so one generic `implementer`
spans tiers:

- **Haiku** — mechanical, single-file, pattern-is-obvious units (rename,
  boilerplate, rote refactor). Cheaper, no quality loss on rote work.
- **Sonnet (default)** — well-specified multi-file units.
- **Never promote the implementer to Opus.** If writing a unit needs
  Opus-level reasoning, it isn't well-specified enough to hand off — plan it
  harder so Sonnet can write it, or keep it in the main thread. Opus-writes →
  Opus-reviews also collapses the independent-lens benefit. For genuinely hard
  units, route to a **different family** (Codex via `best-of-n`), not a bigger
  same-family implementer.

The implementer is only as good as its dispatch: hand it an **executable
definition of done** (a failing test or exact verify command) as the acceptance
criterion, not a prose paragraph — that turns its self-verification into a
pass/fail gate. Escalate the review *topology* (SDD 2-stage, `best-of-n`,
`self-consistency`) for hard/high-stakes units rather than reaching for a bigger
implementer model.

## Decision rule (routing)

When a unit of work arrives, route by its shape:

- **Coupled / iterative / architectural judgment** → stay in main (Opus).
  Delegating coupled work costs more than it saves (Amdahl: the sequential
  synthesis bounds the win).
- **Read-heavy gathering** (explore, audit, research, doc lookup) → `Explore`
  (codebase) / `general-purpose` (multi-step) / `ce-web-researcher` (external) /
  context7 (library docs). Isolated, cheap.
- **Well-specified implementation of a unit** → `implementer` (sonnet); Opus
  reviews the returned diff. Tiering + isolation.
- **Full feature → ship** (multi-unit, needs plan + gates + PR) → `ce-work`
  (default executor). For tiered execution within it, dispatch `implementer` or
  use the SDD loop (below).
- **2+ genuinely independent workstreams** (no shared write surface) → agent
  team, accepting ~7×. Rare.
- **Hard bug** → `ce-debug` (+ `Explore`/`general-purpose` for investigation).

## Executor layer (dual-track)

- **`ce-work`** — default for features → ship: plan.md, quality gates,
  worktree-isolated subagents, review loop. Its subagents inherit Opus, which is
  fine for orchestrated feature work the orchestrator reviews.
- **`superpowers:subagent-driven-development` (SDD)** — the isolated multi-task
  implementation loop when you want explicit **model tiering** across units: it
  dispatches a fresh implementer + 2-stage review per task. Use `implementer`
  (sonnet) as the dispatched writer — SDD pins no model on its own, so the
  `implementer` agent is what supplies the cheaper tier. Not demoted; it serves a
  different purpose than ce-work.
- **Review loop** — never hand-roll it. Reuse SDD's 2-stage (spec-compliance →
  code-quality) or `ce-code-review` / `/sam-review`. The `implementer`'s report
  format feeds these.

## Enforcement layer (deterministic nudges)

Delegation is a model decision with no platform enforcement, so two hooks nudge
the orchestrator (both non-blocking, main-thread only — CC #34692 means hooks
don't fire for subagent tool calls, which is intended here):

- `hooks/delegate-nudge.sh` (PostToolUse) — 4 consecutive Read/Grep/Glob →
  reminder to dispatch a subagent; resets on Edit/Write/MultiEdit/Task.
- `hooks/delegate-prompt-nudge.sh` (UserPromptSubmit) — investigation-shaped
  prompt → reminder to delegate the gathering phase; skips system/task
  notifications.

Heed the nudges; they encode the "3rd consecutive read → Explore" rule as an
interrupt. Ignore one only when the work is genuinely coupled to the
conversation (the nudge text says as much).

## Roster (settled)

- **Custom agent:** `implementer` (sonnet) only — the tiering writer. The old
  `planner` / `researcher` / `reviewer` customs are disabled; built-ins +
  CE skills + `/sam-review` cover them.
- **Built-ins:** `Explore`, `Plan`, `general-purpose`.
- **Reviewers may be language-specialized** (CE ships `ce-swift-ios-reviewer`,
  `ce-dhh-rails-style`, `ce-julik-frontend-races-reviewer`); **implementers stay
  generic** — push language toolchain into project CLAUDE.md, not per-language
  implementer agents. Revisit only for non-prompt-injectable semantics (Rust
  borrow checker, Swift actor isolation) in a near-monolingual repo.
