---
description: The main loop — brainstorm, plan, build, work, review — plus where autonomy starts and how much attention each stage earns.
---

# The Main Loop

## Compound engineering is the default methodology

CE skills (`compound-engineering:ce-*`) compound — each stage feeds the next, so prefer them over the
`superpowers:` equivalent where both exist. The plan file is the point of `ce-plan`: it survives
context loss, so on a fresh session point `ce-work` at the existing plan rather than replanning. For
deep non-code deliverables, have `ce-plan` plan *how it will produce* the deliverable first — asking
for it directly cuts corners.

**Execution splits from planning.** `ce-plan` writes the plan; `/build` executes the parts of it that
decompose, and `ce-work` takes coupled work. `ce-work` *can* parallelize, but that choice lives in
prose and the model almost always resolves it to serial — measured here, 2 of 11 sessions. `/build`
computes the split instead: schema-enforced units, concurrent file overlap refused in code,
`decomposable: false` as a visible outcome rather than a silent fallback. It reports the decomposition
first and only fans out when told to, because the split is the ceiling on everything downstream and is
cheap to read before agents commit to it.

Units declare `depends_on` and each starts when *its own* dependencies go green, so read
`critical_path` and `starting_immediately` on that first report — a critical path near the unit count
means the decomposer emitted a chain and the fan-out will not buy much, which is worth catching
before any agent runs.

After `/build`, always pass `ce-work` an **explicit plan path**. A blank invocation globs
`docs/plans/` for the newest `implementation-ready` plan — which is the one `/build` just executed —
so it will happily rebuild work that already exists.

## Who owns the review tail decides which reviewer runs

Two honest modes, and mixing them is what produces a double review:

- *Default — you own the tail, `/council` reviews.* Invoke `ce-work mode:return-to-caller
  <plan-path>`; it implements and locally verifies, then returns a structured envelope instead of
  running its own review. Then run `/council` once on the assembled diff. Work built by `/build`
  already arrives in this shape. Haiku triage sizes the seating, so an ordinary diff pays for two
  lenses and only guardrail surfaces seat all six — which is what makes this affordable as the
  default rather than the exception.
- *Hardwired tail — `ce-work` owns it.* A blank `ce-work` runs `ce-code-review` itself on every
  non-mechanical diff, and that is not a preference the runtime lets you override from outside. Fine
  for a small or mechanical diff where invoking nothing is the point; just don't then also run
  `/council`, or you have reviewed the same diff twice.

The default flipped on 2026-07-27. It used to be the second mode, back when council was the expensive
exception; the triage gate is what changed the economics.

## Cross-model plan review

A plan gets exactly one review pass from the family that didn't author it. Claude-authored → one
Codex pass ("review this plan only; do not implement"). Codex-authored → Claude's own review *is* the
cross-model pass; don't bounce it back. An empty Codex pass doesn't satisfy this — report it rather
than finalising. Never recurse into multiple cross-reviews unless asked.

## The autonomy boundary sits after plan approval, not before

Measured over 31 sessions, corrections per invocation: `ce-plan` 1.12, `ce-brainstorm` 1.07,
`ce-work` 1.00, dispatched `implementer` **0.05** (229 dispatches, 12 corrections). Planning draws
roughly one redirect every single time; delegated implementation is twenty times more reliable.

So run unattended *downstream* of an approved plan and stay interactive upstream of it. Once the plan
is agreed, the stretch from decomposition → build → per-unit verify → one review on the assembled
diff can run without check-ins, because that is the stretch that historically doesn't need them.
`/build` already places the one useful checkpoint: it reports the split and waits for `build:true`.
Keep that gate even when running hands-off — the decomposition inherits any error in the plan and is
the last cheap moment to catch one.

`lfg` and `looper` are **not** the route — Sam is moving away from both, and the data agrees: they
automate *through* brainstorm and plan, the two highest correction-rate stages, multiplying a wrong
premise across everything downstream. Bare approvals are 3% of messages, so autonomy here is not
about removing approval prompts; it is about not stopping mid-flight in the stretch that never needed
a human.

**The bigger win is not stopping at all.** Corrections in this loop are overwhelmingly *standing
preferences being restated*, not planning failures — "use gh instead (and remember)", "build locally
not cloud". Those recur across many distinct sessions each. Every one that gets written down is a
correction that stops happening, which lowers the correction rate that governs how far the loop can
run unattended in the first place. Capture the preference the first time it is stated, and file it by
scope: `~/.claude/rules/` for anything that holds across repos (`projects/*/memory/` is
**per-project**, so a cross-repo preference filed there is fixed in one repo out of thirteen), and
keep machine-specific facts out of the synced rules entirely — this config is installed on more than
one machine.

## Reducing attention upfront, where it's safe

Brainstorm and plan are attention-heavy by design (one-question-at-a-time dialogue, scoping
confirmation gates). Most of that is worth it; some is not. A question is worth Sam's attention only
if it fails **both** of these:

- **Answerable from the repo.** If the codebase, an existing plan, `CONCEPTS.md`, git history or the
  rules already settle it, read it — don't ask. The grounding scout exists for exactly this.
- **Cheap to reverse.** For a decision that is one edit to undo, pick the obvious default, state the
  pick in one line, and continue. Ask only when being wrong is expensive: schema and migrations,
  public API shape, auth, money, anything that writes to committed artifacts or third parties.

Then batch what genuinely remains into a single round rather than a serial interrogation — the cost
of an unanswered question is one round-trip, but the cost of ten serial ones is ten. Irreversible and
un-inferable decisions still get asked, individually and clearly. Reducing attention is not the same
as guessing quietly: a default that was picked rather than asked about must be *visible* in the
output, so a wrong one is cheap to catch.
