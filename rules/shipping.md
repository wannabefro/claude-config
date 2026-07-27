---
description: Proving a change works, then getting it out — verification and dogfooding, commit cadence, PR process, guardrail reviews.
---

# Verification & Shipping

## Verification & dogfooding

Exercise changes in their real runtime before calling them done — UI in a browser, API via a request
plus a side-effect check, CLI on representative input, migration against a local copy, bug via
reproduce-then-verify. `/dogfood` has the matrix. "I ran it and saw X" is the acceptance signal;
tests prove the code does what you told it, running it proves you told it the right thing. Type-only
and doc changes are exempt — the type-check is the verification.

**Config and tooling changes need the same bar, and usually don't get it.** A hook, an agent
definition, a plugin version, a routing table or a workflow flag can be correct in the file and inert
in the runtime — cached at session start, keyed on a version, or matched against a name that never
occurs. Editing it is not evidence. Exercise it: dispatch the agent and read what it actually got,
run the hook against real input, check the log for the decision. Every such change that shipped
unverified here was later found broken.

Invoke a project's own MUST skills (testing, styling, lint) *before* the action they gate. A missing
required-skill invocation is a bug.

## Commits & PRs

- **When a push fails on "correct access rights", don't diagnose ssh — push the https URL through
  `gh`.** `git push https://github.com/<owner>/<repo>.git <branch>` uses gh as the credential helper
  and works even when `gh auth status` reports the protocol as ssh but no usable key is present.
  Stated as a fallback rather than a fact because it depends on the machine, and this config is
  installed on more than one.
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

## Publishing this config

`~/.claude` is a **public** repo. Before pushing, check added lines for employer names, absolute
personal paths, credentials and internal hostnames — a `public-prep` commit already scrubbed a round
of these, and a later branch that predates it can reintroduce them on rebase.
