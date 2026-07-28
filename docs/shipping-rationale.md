# Shipping rationale

Why the directives in `rules/shipping.md` are shaped the way they are.

## Verification & dogfooding

"I ran it and saw X" is the acceptance signal because tests and running prove different things:
tests prove the code does what you told it, running it proves you told it the right thing. A test
suite can be green while the feature is still wrong in the way that only shows up when a real
request, a real UI, or a real input hits it.

Config and tooling changes get waved through more often than code changes because they *look* like
they can't be wrong — a hook, an agent definition, a plugin version, a routing table, a workflow flag
can all be correct in the file and inert in the runtime: cached at session start, keyed on a version,
or matched against a name that never occurs. Editing it is not evidence it works. Every such change
that shipped unverified here was later found broken — that track record is why this bar is stated as
equal to, not lesser than, the bar for application code.

## Why gh/https is the default transport, not a fallback

This was a *push* fallback until 2026-07-28, framed as machine-specific. Both halves were wrong, and
the narrow framing is what let a real bug through — the rule was followed correctly and the failure
happened anyway.

The ssh agent stopped signing (`sign_and_send_pubkey: ... communication with agent failed`). Push
failed loudly and the documented fallback handled it. But the same broken agent had been failing
`git fetch` silently, so `origin/main` sat frozen 26 commits behind at `82ac57c` while `main` moved
on. Nothing surfaced it: `git status` compares against the stale ref, so it reported a clean,
up-to-date branch.

The cost was concrete. Agent worktrees branch from `origin/<default-branch>`, so a `/build` fan-out
branched all six units from `82ac57c` — a day's work missing. Every unit returned green, because
each verified only its own change. It was caught by luck: one unit mentioned reconstructing
`rules/shipping.md` from a file that no longer existed in that shape. Merging would have silently
reverted the day.

`worktree.baseRef: "head"` was set in response and is still correct — it makes worktree bases
independent of ref freshness. But it treated the symptom. The stale ref was the cause, and it could
as easily have produced a wrong ahead/behind count or a wrong "already merged" verdict.

Hence the two-part rule. https-through-`gh` covers *all* remote transport, not just push: it works
on any machine where `gh` is authed, so there was never a reason to keep it conditional, and
diagnosing the agent was never the cheaper path. And a local `origin/*` is not evidence — confirm
against the remote. Fetching by explicit URL does not update the tracking ref by itself, which is
why the rule spells out the refspec form.

A zero-discipline alternative is deliberately not adopted:
`git config --global url."https://github.com/".insteadOf git@github.com:` rewrites every ssh remote
transparently, needing no per-command care. It is a global change affecting every repo on the
machine, and machine-local config rather than something this synced repo can carry — recorded as an
option, not applied. Repairing the agent (`ssh-add`, keychain unlock) is the other option and is
orthogonal: it fixes today's outage, whereas the rule survives the next one.

## Guardrail reviews

The triage step exists so that ordinary diffs don't pay for six-lens review — most diffs get seated
cheaply. But triage only earns that discount because it forces auth, payments, migrations/schema,
data mutations, public API, and permissions diffs into the full six-lens seating including the Codex
outsider unconditionally. That's the economic argument for the rule: the cheap seat is only safe to
default to because the expensive surfaces are carved out and never allowed to self-classify as
low-risk. A normal `ce-work` run reviews with `ce-code-review` and never reaches council on its own,
which is why a guardrail diff specifically needs the return-to-caller tail or an explicit `/council`
afterwards — otherwise the carve-out silently doesn't apply.

## Publishing this config

`~/.claude` is a public repo, and it has already leaked scrubbable content once: a `public-prep`
commit scrubbed a round of employer names, absolute personal paths, credentials, and internal
hostnames out of the tracked history. The risk that motivates scanning *every* push, not just the
first one, is that a branch created before that scrub can reintroduce the same content on rebase —
the scrub cleaned the tree at a point in time, not the branches that already diverged from it.
