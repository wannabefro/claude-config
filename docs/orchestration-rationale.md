# Orchestration rationale

`rules/orchestration.md` contains the always-on policy. This file records why
the policy uses Opus for judgment and Luna for implementation.

Opus xhigh keeps requirements, interfaces, design direction, diagnosis,
review, integration, and final verification in one accountable context. Luna
xhigh receives a frozen contract and performs only the implementation writes.
This split prevents a cheaper writer from changing architecture while keeping
the main thread free for review.

The maximum of three active Luna units limits merge pressure and cost. A
single coherent unit uses `/implement`, so it does not pay the decomposition
cost of `/build`. The
dependency graph, file ownership, contract checks, invalidated-work checks,
and executable verify commands remain enforced before dispatch.

The former tier router could silently override agent pins. It is removed. The
implementer agent now carries the Opus dispatcher pin and calls the fixed Luna
wrapper. Sonnet, Terra, and Fable remain explicit manual choices. Haiku has no
judgment route.

Foreign Codex calls stay bounded and use MCP-disabled wrappers when the task
does not require tools. A failed or unavailable call is reported and never
turns into a model fallback.
