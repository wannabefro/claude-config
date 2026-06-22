---
name: linear-ticket-triage
description: Triage a Linear ticket or issue and decide whether it needs work, should be deferred, closed as no-op, treated as duplicate, or sent back for clarification. Use when the user gives a Linear issue key, URL, title, or ticket text and asks to triage, evaluate, prioritize, sanity-check, accept/reject, or decide "do we need to work on this?"
---

# Linear Ticket Triage

Produce a defensible recommendation for whether a Linear ticket needs work.
Default to read-only investigation: fetch evidence and report a decision, but do
not change Linear state, assign, label, close, or comment unless the user
explicitly asks for that mutation.

## Output

Start with exactly one decision:

- `WORK`: The ticket should be worked.
- `DO NOT WORK`: No implementation or investigation work is currently warranted.
- `CLARIFY`: The ticket may be valid, but a decision needs specific missing info.
- `DUPLICATE / ALREADY DONE`: Track under another ticket, PR, or shipped change.
- `DEFER`: Valid work, but not now because of priority, sequencing, or blockers.

Then include:

- `Recommendation`: one sentence.
- `Why`: 2-5 bullets tied to observed evidence.
- `Evidence checked`: Linear fields, comments, links, code/docs/logs searched,
  Chronosphere/logging checks when relevant, and anything important that was
  unavailable.
- `Suggested next action`: the concrete next step, such as close, comment,
  ask a named question, link a duplicate, claim, or leave untouched.
- `Confidence`: high, medium, or low, with the reason if not high.

If the user asked for an update comment, draft the comment separately after the
decision. Keep it concise and avoid exposing private logs or secrets.

## Workflow

1. Resolve the ticket.
   - Use the available Linear connector, MCP, CLI, or pasted ticket text.
   - If using Codex and Linear tools are not loaded, use tool discovery for
     Linear before falling back to asking the user for ticket contents.
   - Fetch the title, description, status, team, project, cycle, priority,
     labels, assignee, reporter, created/updated dates, comments, attachments,
     linked documents, linked PRs, parent/child issues, duplicates, and blockers.

2. Restate the request.
   - Identify the actual problem, proposed work, affected user/system, expected
     behavior, current behavior, urgency, and owner if known.
   - Separate facts from interpretation. Do not decide from the title alone.

3. Check whether the ticket is actionable.
   - Look for a current impact, reproduction path, acceptance criteria, target
     surface area, and success condition.
   - For bugs, require enough signal to reproduce or a credible source such as
     logs, Sentry, customer reports, screenshots, support context, or a clear
     regression window.
   - For feature or tech-debt work, require a stated user/business value,
     product commitment, dependency, or owning project.

4. Check Chronosphere/logs when relevant.
   - For production bugs, regressions, customer-impact reports, background jobs,
     async workflows, service behavior, or tickets with concrete identifiers,
     use Chronosphere/logging/observability sources when available before
     deciding.
   - Build queries from ticket evidence: company/account/org IDs, campaign or
     message IDs, job/task IDs, request/trace IDs, service names, screenshots,
     linked support tickets, and reported timestamps.
   - Prefer a narrow window around the reported action or an ID-derived
     timestamp. If no precise window exists, use the ticket created/updated or
     support-report window and say that it was broad.
   - Start with a small service/severity histogram or focused query. When there
     are hits, inspect a representative sample instead of dumping raw logs. For
     bugs, also run an error-focused query for WARN/ERROR/FATAL, error,
     exception, failed, or equivalent terms.
   - Report no matches, unavailable tools/access, malformed queries, or broad
     time windows explicitly. Do not claim "no errors" beyond the identifiers
     and window that were actually queried.

5. Check whether work is still needed.
   - Search linked PRs, related tickets, comments, release notes, and current
     code/docs when relevant.
   - Treat stale tickets skeptically: compare the ticket's last meaningful
     update date to current product behavior and recent changes.
   - If the ticket references an internal source of truth, use the available
     connector for that source rather than relying on memory.

6. Decide using the rules below.
   - Prefer `WORK` when there is current user/business impact, committed project
     scope, legal/security/SLA pressure, a regression with credible evidence, or
     a dependency that blocks active work.
   - Prefer `DO NOT WORK` when the behavior is expected, obsolete, unsupported,
     already intentionally rejected, lacks current impact after investigation, or
     would create work without a clear owner/value.
   - Prefer `CLARIFY` when one missing answer would change the decision, such as
     expected behavior, affected customer, reproduction, owner, priority, or
     acceptance criteria.
   - Prefer `DUPLICATE / ALREADY DONE` when another issue, PR, or shipped change
     already covers the work. Name the canonical place to track it.
   - Prefer `DEFER` when the work is valid but blocked, superseded by sequencing,
     below current priority, or dependent on another decision.

## Evidence Guidance

- Ground the answer in inspected artifacts. Cite ticket fields, comments, links,
  PRs, files, or docs by name, and include dates when freshness matters.
- Use codebase exploration only as far as needed to validate the triage decision;
  do not drift into implementation planning unless the user asks.
- If the relevant repository is unclear, use workspace or repo-discovery guidance
  before searching broadly.
- For production-error tickets, check Sentry, Chronosphere, logging, or other
  observability sources when available and report if access is missing.
- Summarize private logs; do not paste sensitive payloads, secrets, customer
  data, or more raw log text than needed to support the triage decision.
- For customer-impact tickets, distinguish one-off reports from repeated/current
  impact.
- If evidence conflicts, surface the conflict directly instead of averaging it
  into a vague recommendation.

## Mutation Rules

- Do not mutate Linear by default.
- If the user explicitly asks to update Linear, make the smallest matching
  change and report exactly what changed.
- Ask before closing, reassigning, reprioritizing, or changing status when the
  user's request was only to "triage" or "decide."
- Do not claim a ticket unless the user asks to work it.
- Do not implement the ticket as part of this skill unless the user explicitly
  asks for implementation after triage.
