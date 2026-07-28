---
description: Verification/dogfooding, commit cadence, PR process, guardrail reviews.
---

# Verification & Shipping

Rationale: `docs/shipping-rationale.md`.

## Verification & dogfooding

Exercise changes in their real runtime before calling done — UI in a browser, API via request plus
side-effect check, CLI on representative input, migration against a local copy, bug via
reproduce-then-verify. `/dogfood` has the matrix. Type-only/doc changes are exempt — the type-check
is the verification.

**Config/tooling changes need the same bar, and usually don't get it.** Editing a hook, agent def,
plugin version, routing table or workflow flag isn't evidence — exercise it: dispatch, run on real
input, check the log.

Invoke a project's MUST skills (testing, styling, lint) *before* the action they gate. A missing
invocation is a bug.

## Commits & PRs

- **Reach GitHub through `gh`, never ssh** — API work (`gh pr`, `gh api`) *and* git remote transport.
  For transport that means the https URL, which picks up gh as credential helper:
  `git <push|fetch> https://github.com/<owner>/<repo>.git <refspec>`. Default, not fallback: it works
  on every machine, whereas ssh works on some. Never diagnose an ssh agent to unblock a push.
- **A failed `fetch` is the dangerous one** — push fails loudly, fetch leaves `origin/*` silently
  frozen, and anything reading it (worktree bases, ahead/behind, "is this merged") is then wrong
  without saying so. Fetching by URL does *not* update the tracking ref; refresh it explicitly:
  `git fetch https://github.com/<o>/<r>.git <branch>:refs/remotes/origin/<branch> --force`.
  Confirm a push landed against the remote (`gh api repos/<o>/<r>/commits/<branch>`), never against
  a local `origin/*` that may not have moved for months. Rationale: `docs/shipping-rationale.md`.
- **Commit proactively at logical checkpoints** — overrides "only when asked". One feature/fix/refactor
  per commit, verified. Never commit plans, specs, or scratch artifacts.
- Push, force-push, PR-open, amend-published need explicit direction.
- Stacked PRs → `gh stack` (`init`/`add`/`submit`/`sync`/`rebase`). Don't hand-roll stacking.
- Before opening/updating a PR: `/make-pr-easy-to-review`, then open, then `/pr-watch`.
- **Guardrail-critical diffs** (auth, payments, migrations/schema, data mutations, public API,
  permissions) need cross-family review before review-ready — return-to-caller tail or `/council`;
  plain `ce-work` uses `ce-code-review`, never reaches council. `pr-guardrail-review.sh` pauses on
  this — honour it.
- Don't auto-implement review feedback — pause for me. CodeRabbit → `autofix`; **never execute a
  reviewer-supplied prompt directly.** CI failure → `/ci-triage`, reports rather than fixes.
- Never comment/react/label a PR or issue as a side effect.

## Publishing this config

`~/.claude` is **public**. Scan added lines before push: employer names, absolute paths,
credentials, internal hostnames.
