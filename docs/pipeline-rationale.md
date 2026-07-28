# Pipeline rationale

Measurement narratives, rejected-alternative arguments, and history behind the directives in
`rules/pipeline.md`.

## Why `/build` computes the split instead of leaving it to prose

`ce-plan` writes the plan; `/build` executes the parts of it that decompose, and `ce-work` takes
coupled work. `ce-work` *can* parallelize, but that choice lives in prose and the model almost always
resolves it to serial — measured here, 2 of 11 sessions. `/build` computes the split instead:
schema-enforced units, concurrent file overlap refused in code, `decomposable: false` as a visible
outcome rather than a silent fallback. It reports the decomposition first and only fans out when told,
because the split is the ceiling on everything downstream and is cheap to read before agents commit
to it.

Units declare `depends_on` and each starts when *its own* dependencies go green, so read
`critical_path` and `starting_immediately` on that first report — a critical path near the unit count
means the decomposer emitted a chain and the fan-out will not buy much, which is worth catching before
any agent runs.

## Review tail: one path, collapsed 2026-07-28

This documented two modes — `ce-work mode:return-to-caller <plan-path>` with `/council` after, versus
a blank `ce-work` that runs `ce-code-review` itself — and warned against mixing them.

Measured across every `ce-work` invocation in 895 transcripts: **36 of 36** passed a plan path plus
freeform instructions ("execute in dependency order"). Zero used `mode:return-to-caller`. Zero were
blank. Neither documented mode had ever been used. The dichotomy described a hypothetical, and the
"pick one" framing implied a decision that was never actually faced.

Collapsed to the single real path: hand `ce-work` the plan path, then `/council` once on the
assembled diff. Haiku triage sizes the seating, so an ordinary diff pays for two lenses and only
guardrail surfaces seat all six — that economics is what made council affordable as the default when
it flipped on 2026-07-27, back when it had been the expensive exception.

The double-review hazard is real but narrow, so it survives as one line rather than a mode: a blank
`ce-work` runs `ce-code-review` itself and that isn't overridable from outside, so passing the plan
path is what keeps the tail single.

`/build`'s two calls are a separate thing and are *not* a mode switch: the first returns the
decomposition only, the second fans out N parallel worktree agents. They don't collapse because the
gate between them is the point — seeing `critical_path` and `starting_immediately` before spending
on a fan-out.

## The autonomy-boundary measurement

Measured over 31 sessions, corrections per invocation: `ce-plan` 1.12, `ce-brainstorm` 1.07,
`ce-work` 1.00, dispatched `implementer` **0.05** (229 dispatches, 12 corrections). Planning draws
roughly one redirect every single time; delegated implementation is twenty times more reliable.

So run unattended *downstream* of an approved plan and stay interactive upstream of it. Once the plan
is agreed, the stretch from decomposition → build → per-unit verify → one review on the assembled
diff can run without check-ins, because that is the stretch that historically doesn't need them.
`/build` already places the one useful checkpoint: it reports the split and waits for `build:true`.
Keep that gate even when running hands-off — the decomposition inherits any error in the plan and is
the last cheap moment to catch one.

## Why `lfg` and `looper` are rejected as the route

`lfg` and `looper` are **not** the route — Sam is moving away from both, and the data agrees: they
automate *through* brainstorm and plan, the two highest correction-rate stages, multiplying a wrong
premise across everything downstream. Bare approvals are 3% of messages, so autonomy here is not
about removing approval prompts; it is about not stopping mid-flight in the stretch that never needed
a human.

**The bigger win is not stopping at all.** Corrections in this loop are overwhelmingly *standing
preferences being restated*, not planning failures — "use gh instead (and remember)", "build locally
not cloud". Those recur across many distinct sessions each. Every one that gets written down is a
correction that stops happening, which lowers the correction rate that governs how far the loop can
run unattended in the first place.
