---
name: sam-review
description: Run a multi-lens review of the current diff or a target PR — invokes /thermo-nuclear-code-quality-review (strict maintainability), /compound-engineering:ce-code-review (CE internal methodology), and /code-review (CodeRabbit external AI), plus a conditional cross-family Codex adversarial pass on high-stakes diffs, then synthesizes findings into one prioritized list. Use when the user says "sam-review", "/sam-review", "run my review", or asks for a full multi-lens review. Use proactively at major checkpoint moments (finished feature, before PR ready-for-review) when a single review lens isn't enough.
---

# sam-review — multi-lens code review

This skill runs three independent review lenses on the same target — plus a conditional fourth — and synthesizes the findings. Each lens catches things the others miss:

| Lens | Catches | When |
|------|---------|------|
| `/thermo-nuclear-code-quality-review` | Abstraction quality, file growth, spaghetti branching, maintainability debt — strict and ambitious | Always |
| `/compound-engineering:ce-code-review` | CE internal methodology — pattern compliance, correctness, project standards | Always |
| `/code-review` (CodeRabbit) | External AI lens — bugs, security, common pitfalls, language idioms | Always |
| Codex adversarial pass (GPT family) | Cross-family blind spots — uncorrelated bugs/edge-cases the three Claude/CodeRabbit lenses miss | High-stakes only (see below) |

The first three lenses are not truly model-diverse — thermo-nuclear and ce-code-review are both Claude reasoning, and CodeRabbit is a separate service but not a frontier general-reasoning model, so their blind spots correlate. The Codex pass is the only lens that buys uncorrelated error detection, which is why it's reserved for diffs where that's worth the separate billing and added latency.

## When to run

**Good fits:**
- Finished a logical unit (feature, layer, refactor) and want defense-in-depth before opening / marking PR ready
- Diff is high-stakes (auth, payments, data migrations, public API)
- Want a final pass before declaring work complete

**Skip:**
- Trivial diffs (renames, typo fixes, single-line bug fixes, doc-only edits) — one lens is plenty, often none is needed
- Mid-exploration / work in progress — review noise before the diff is stable wastes effort
- The user has explicitly said they only want one specific lens

### Codex lens gating

Run the Codex pass **only when the diff is high-stakes**:
- Touches auth, payments, data migrations, or a public API/contract, **or**
- Is a non-trivial diff being marked PR-ready (defense-in-depth on something that's about to ship).

**Skip Codex** on small or reversible diffs even when the other three run — three lenses over-cover there, and Codex bills separately. If the user explicitly asks for "all lenses" or "include Codex", run it regardless of stakes. If unsure whether a diff clears the bar, run the three Claude/CodeRabbit lenses, and note that you skipped Codex and why (so the user can ask for it).

## Arguments

Optional argument is passed through to each underlying skill. Common forms:
- *(no argument)* — review the current branch's diff vs. main
- `<PR#>` — review a specific GitHub PR
- `<commit-range>` — review a specific range

Pass whatever the user provided unchanged to each delegate.

## Execution

Run the reviews **sequentially in this conversation**, not in parallel subagents — each lens benefits from seeing the diff fresh, and synthesizing in the main thread is cleaner than herding subagent results.

Order matters for cognitive load, not correctness:

1. **`/code-review`** first — fastest, surfaces concrete bugs and common pitfalls. Establishes a baseline of "objective" findings.
2. **`/compound-engineering:ce-code-review`** second — methodology lens. Reads the diff against project conventions and CE standards.
3. **`/thermo-nuclear-code-quality-review`** third — strict maintainability lens. Most ambitious; benefits from already knowing the diff after the prior two passes.
4. **Codex adversarial pass** (only if the diff cleared the gating bar above) — last, so the cross-family lens runs against a diff the prior lenses have already characterized.

Between each lens, briefly note what it surfaced. Do not auto-implement fixes mid-run — review first, act after synthesis.

### Running the Codex pass

Claude **cannot** fire `/codex:adversarial-review` via the Skill tool, and the background rescue wrapper can stall. Run a **direct, bounded foreground `codex exec`** against the diff instead. From the repo root:

```bash
cd <repo-root>
git diff main...HEAD > /tmp/sam-review-codex.diff   # or the PR/range under review
timeout 600 codex exec "Adversarially review the diff below for bugs, security \
issues, edge cases, race conditions, and incorrect error handling. Construct \
failure scenarios — do not just check style. Review ONLY; do NOT implement or \
modify any files. Report findings by severity. Diff:

$(cat /tmp/sam-review-codex.diff)"
```

For a PR target, materialize the PR's diff (`gh pr diff <PR#>`) into the file instead of `git diff`. Read stdout for the findings. Codex's bundled MCP servers may log `Auth(AuthorizationRequired)` noise — non-fatal; the run still completes. If `codex exec` errors on auth or isn't installed, note that the Codex lens was skipped and continue with the three-lens synthesis rather than blocking.

## Synthesis

After all lenses complete (three, or four when Codex ran), produce **one prioritized list** organized by severity, not by lens:

```
## Critical (block merge)
- [finding] — flagged by: [lens(es)]

## High (fix before ready-for-review)
- [finding] — flagged by: [lens(es)]

## Medium (worth addressing)
- [finding] — flagged by: [lens(es)]

## Low / nits
- [finding] — flagged by: [lens(es)]

## Cross-lens agreement
- [things 2+ lenses independently flagged — these are the highest-signal findings]

## Lens-specific (only one lens flagged, judgment call)
- thermo-nuclear: [...]
- ce-code-review: [...]
- code-review: [...]
- codex: [...]   # only if the Codex pass ran
```

Cross-lens agreement is the strongest signal — when multiple lenses independently flag the same issue, treat it as load-bearing. A finding raised by **Codex and at least one Claude/CodeRabbit lens** is especially high-signal: cross-family agreement means it isn't a shared-model artifact. Conversely, a Codex-only finding deserves real weight precisely because it's the lens most likely to see what the others structurally can't — don't dismiss it as a lone flag the way you might a single Claude-lens nit.

If the Codex pass was skipped (diff below the gating bar, or `codex exec` unavailable), say so in the synthesis so the user knows the cross-family lens didn't run.

When lenses disagree (one flags a pattern as a problem, another doesn't), surface the disagreement explicitly rather than picking a side silently. The user decides.

## After synthesis

Do **not** auto-implement fixes. End with: "Findings above. Want me to apply any of these, or just the criticals?" Let the user direct.

If the user requests fixes, scope to the criticals + high by default; ask before touching medium/low.
