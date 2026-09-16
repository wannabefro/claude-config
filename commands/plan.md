---
description: Create only the plan a non-trivial change needs, then run one Codex review.
argument-hint: "[what to plan — a feature, open question, or requirements doc]"
---

Plan: **$ARGUMENTS**

Use a plan when requirements, interfaces, dependencies, or a costly decision
need to be made explicit. Routine, reversible work needs no plan. Record only
the necessary decisions, owned paths, acceptance criteria, and verification
commands.

Review each authored plan once with Codex. A plan is not a diff, so carry it on
stdin rather than naming its path in the prompt — a named path makes Codex go
exploring instead of reviewing. Write the plan and a review-only request to a
file, then run one bounded foreground pass with the Bash tool's `timeout` set
to `600000`:

```bash
codex exec -s read-only --ephemeral -c model_reasoning_effort=xhigh - < PLAN_FILE
```

An empty, refused, unavailable, or timed-out run is a missing review. Do not
call a second model or describe the plan as approved. Record the Codex result
or the gap, then hand off the plan path.
