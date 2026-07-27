# Routing rationale

Background for the tie-breaks and delegation table in `rules/routing.md`. That file stays
directive-only; this doc holds the "why" trimmed out of it.

## Tie-break reasoning

- `ce-debug` / `diagnose` / `superpowers:systematic-debugging` → `ce-debug`: its output feeds
  `ce-work` directly, so a diagnosis produced by either alternative still has to be re-shaped before
  `ce-work` can consume it.
- `/council` / `ce-code-review` → `/council` is the default review path. `ce-code-review` is only
  correct inside a blank `ce-work` run, where it is hardwired and cannot be overridden from outside
  — and there you do *not* also run council (that would double-review the same diff).
- `ce-plan` / `superpowers:writing-plans` / `Plan` agent → `ce-plan`, because the plan file is the
  durable checkpoint that survives context loss; `Plan` is reserved for architecture-only design
  with no execution plan to write.
- `dogfood` / `verify-this` → resolved by retirement rather than tie-break: `verify-this` is retired
  (below), so `dogfood` takes both jobs. Until 2026-07-27 the table split them — `dogfood` exercises
  a change in its real runtime, `verify-this` proves one specific measurable claim — but the split
  never got used, and leaving the row in while the skill was retired made the file contradict itself.

## Delegation reasoning

- Read-heavy gathering routes to `Explore` for codebase questions and `general-purpose` for
  multi-step audits — both keep verbose intermediate work out of the main thread's context.
- Every approved plan starts at `/build` because it computes the decomposition instead of assuming
  it: `decomposable:false` is a legitimate, real answer for coupled work, not a fallback failure —
  coupled units still get built, just serially instead of fanned out.
- Well-specified units (or units `/build` marked coupled) go to `implementer`; the dispatcher reviews
  the returned diff rather than trusting it uninspected.
- `/council` is the default review for any diff you own because Haiku triage sizes the seating
  automatically — an ordinary diff pays for two lenses, a guardrail diff (auth, payments,
  migrations, data mutation, public API) seats the full six including the Codex outsider.
- `ce-code-review` only applies inside a blank `ce-work` run, where it is already hardwired; fighting
  that wiring from outside just produces a second, redundant review pass.
- `/codex:rescue` is for the same bug after two failed Claude attempts — a same-family third attempt
  rarely finds what two already missed, so the cross-family lens goes in instead.
- `/codex:rescue --background` is for large bounded tasks that would otherwise eat the main thread's
  context for an extended run.

## Retired skills — evidence

**Retired 2026-07-27:** `sam-review`, `self-consistency`, `best-of-n`, `verify-this` went unused
across 43 measured sessions, and two of them (`sam-review` and `best-of-n`) were the skills the repo's
own hooks pointed at — so the non-use wasn't for lack of a wired-up trigger, it reflects that the
routing table's other entries covered the same ground more often. The skills remain on disk and can
still be invoked by name deliberately; they are simply no longer part of the default routing
decision. Cross-family second opinions go to `/codex:*` or the council's outsider seat instead.
