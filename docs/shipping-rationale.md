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

## The ssh push fallback

Stated as a fallback rather than a fact because the actual cause is machine-specific: whether
`gh auth status` reports ssh as the protocol while no usable key is present depends on how that
particular machine's git credentials are configured. The https-through-gh command sidesteps the
question entirely rather than diagnosing it, which is why it's the first move rather than a last
resort.

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
