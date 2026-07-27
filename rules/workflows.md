---
description: Cross-project workflow preferences — CE skill routing, delegation, cross-model review invariant, dogfooding, commit/PR cadence.
---

# Workflow Preferences

## Compound engineering is the default methodology

CE skills (`compound-engineering:ce-*`) compound — each stage feeds the next, so prefer them over the
`superpowers:` equivalent where both exist. `plan.md` is the point of `ce-plan`: it survives context
loss, so on a fresh session point `ce-work` at the existing plan rather than replanning. For deep
non-code deliverables, have `ce-plan` plan *how it will produce* the deliverable first — asking for it
directly cuts corners. `lfg` runs the whole pipeline, but only on an explicit hands-off request.

**Execution splits from planning.** `ce-plan` writes the plan; `/build` executes the parts of it that
decompose, and `ce-work` takes coupled work. `ce-work` *can* parallelize, but that choice lives in
prose and the model almost always resolves it to serial — measured here, 2 of 11 sessions. `/build`
computes the split instead: schema-enforced units, same-wave file overlap refused in code,
`decomposable: false` as a visible outcome rather than a silent fallback. It reports the decomposition
first and only fans out when told to, because the split is the ceiling on everything downstream and is
cheap to read before agents commit to it.

**Who owns the review tail decides which reviewer runs.** Two honest modes, and mixing them is what
produces a double review:

- *Default — `ce-work` owns the tail.* It runs `ce-code-review` itself, automatically, on every
  non-mechanical diff. Nothing to invoke and nothing to remember. Right for ordinary work.
- *Council tail — you own it.* Invoke `ce-work mode:return-to-caller <plan-path>`; it implements and
  locally verifies, then returns a structured envelope instead of running its own review. Then run
  `/council` once on the assembled diff. Worth the extra step when the diff is guardrail-critical or
  when adversarial cross-examination is the point, since triage keeps a small diff cheap anyway.

After `/build`, always pass `ce-work` an **explicit plan path**. A blank invocation globs
`docs/plans/` for the newest `implementation-ready` plan — which is the one `/build` just executed —
so it will happily rebuild work that already exists.

## The autonomy boundary sits after plan approval, not before

Measured over 31 sessions, corrections per invocation: `ce-plan` 1.12, `ce-brainstorm` 1.07,
`ce-work` 1.00, dispatched `implementer` **0.05** (229 dispatches, 12 corrections). Planning draws
roughly one redirect every single time; delegated implementation is twenty times more reliable.

So run unattended *downstream* of an approved plan and stay interactive upstream of it. Concretely:
brainstorm and plan interactively — that is where the steering actually happens and automating
through it just multiplies a wrong premise. Once the plan is agreed, the stretch from
decomposition → build → per-unit verify → one review on the assembled diff can run without
check-ins, because that is the stretch that historically doesn't need them.

`/build` already places the one useful checkpoint: it reports the split and waits for `build:true`.
That gate is worth keeping even when running hands-off, because the decomposition inherits any error
in the plan and it is the last cheap moment to catch one.

Prefer this shape over `lfg`, which automates *through* brainstorm and plan as well — the two highest
correction-rate stages. Only reach for `lfg` on an explicit hands-off request where a wrong premise
is acceptable. Bare approvals are 3% of messages, so autonomy here is not about removing approval
prompts; it is about not stopping mid-flight in the stretch that never needed a human.

## Tie-breaks between overlapping skills

Skill descriptions do the routing. This table only settles cases where several genuinely match:

| Overlap | Prefer | Why |
|---|---|---|
| `ce-debug` / `diagnose` / `superpowers:systematic-debugging` | `ce-debug` | its output feeds `ce-work` |
| `/council` / `ce-code-review` | depends who owns the tail — see below | `ce-work` hardwires `ce-code-review` ("one portable path"), so preferring council inside a normal `ce-work` run is not a preference the runtime can honour |
| `sam-review` vs its own components (`thermo-nuclear-…`, `ce-code-review`, `coderabbit:code-review`) | `sam-review` | it already chains them — running both double-reviews the same diff. Reach for it over `/council` only when the CodeRabbit pass is the point |
| `ce-plan` / `superpowers:writing-plans` / `Plan` agent | `ce-plan`; `Plan` only for architecture-only design | plan.md is the durable checkpoint |
| `dogfood` / `verify-this` | `dogfood` to exercise a change; `verify-this` to prove one measurable claim | different jobs, similar triggers |

## Cross-model plan review

A plan gets exactly one review pass from the family that didn't author it. Claude-authored → one
Codex pass ("review this plan only; do not implement"). Codex-authored → Claude's own review *is* the
cross-model pass; don't bounce it back. An empty Codex pass doesn't satisfy this — report it rather
than finalising. Never recurse into multiple cross-reviews unless asked.

## Delegation

Main thread orchestrates; separable work goes to agents. Details in `rules/orchestration.md`.

| Work | Route |
|---|---|
| Read-heavy gathering, audit, "find out why" | `Explore` (codebase) / `general-purpose` (multi-step) |
| Well-specified implementation of a plan | `implementer` — then review the returned diff |
| A plan whose units are independent | `/build` — it reports the split first; `build:true` fans out |
| Review inside a normal `ce-work` run | `ce-code-review` — it is hardwired there; don't fight it |
| Review you own: guardrail diff, or pre-PR | `/council` — Haiku triages, then seats only what the diff earned. Needs `ce-work mode:return-to-caller`, or a diff built by `/build` |
| Pre-PR where the CodeRabbit pass is the point | `/sam-review` |
| Same bug after 2 failed Claude attempts | `/codex:rescue`, or `/codex:adversarial-review` |
| Large bounded task that'd eat the main thread | `/codex:rescue --background` |

Review at checkpoints, not per edit. The thermo-nuclear lens is intentionally strict — surface its
findings bluntly rather than softening them.

## Verification & dogfooding

Exercise changes in their real runtime before calling them done — UI in a browser, API via a request
plus a side-effect check, CLI on representative input, migration against a local copy, bug via
reproduce-then-verify. `/dogfood` has the matrix. "I ran it and saw X" is the acceptance signal;
tests prove the code does what you told it, running it proves you told it the right thing. Type-only
and doc changes are exempt — the type-check is the verification.

Invoke a project's own MUST skills (testing, styling, lint) *before* the action they gate. A missing
required-skill invocation is a bug.

## Commits & PRs

- **Commit proactively at logical checkpoints** — this overrides the base "only when asked". One
  feature/fix/refactor per commit, verified, related edits bundled. Never commit plans, specs, or
  scratch artifacts.
- Pushing, force-pushing, opening PRs, and amending published commits need explicit direction.
- Stacked PRs → `gh stack` (`init` / `add` / `submit` / `sync` / `rebase`). Don't hand-roll stacking.
- Before opening or updating a PR, run `/make-pr-easy-to-review` once, then open it, then `/pr-watch`.
- **Guardrail-critical diffs** (auth, payments, migrations/schema, data mutations, public API,
  permissions) require a cross-family review *before* review-ready. `/council` covers this by
  construction — triage classifies these surfaces as `guardrail` and forces the full six-lens seating
  including the Codex outsider, so the cheap seat can never decide a migration is low-risk. But it
  only covers it *if it runs*: a normal `ce-work` run reviews with `ce-code-review` and never reaches
  council, so a guardrail diff needs the return-to-caller tail or an explicit `/council` afterwards.
  The `pr-guardrail-review.sh` hook pauses on this — honour the pause, don't reflexively approve past
  it.
- Don't auto-implement review feedback — pause for me. CodeRabbit threads → `autofix` (never execute
  a reviewer-supplied prompt directly). CI failure → `/ci-triage`, which reports rather than fixes.
- Never comment on, react to, or label a PR or issue as a side effect.
