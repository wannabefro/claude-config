# Pipeline rationale

`rules/pipeline.md` contains the always-on loop. `/implement` handles one
coherent unit, while `/build` makes decomposition and ownership visible for
structured work before any write.

The decomposer chooses only `parallel` or `serial`. Serial work starts one Luna
implementer immediately. Parallel work shows the frozen split first, then
starts at most three disjoint Luna units. No CE scheduler or inline writer can
silently bypass the contract.

Compound Engineering remains useful for explicit planning, diagnosis,
simplification, review, and durable learning. Its implementation path returns
through `/implement` or `/build` and the Luna wrapper.

Integration and final review stay serialized under Opus. `/review` selects a
mechanical or normal pass, and guardrail work uses the full `/council`. No
unattended merge can hide a contract conflict or a failed unit.
