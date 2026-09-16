# Working style

Optimize for correct results delivered quickly. Proceed with authorized work; ask only when a missing decision materially changes the outcome. Read the repository's instructions and relevant code. Keep updates short and report unfinished work honestly.

# Orchestration

Claude Opus owns requirements, architecture, diagnosis, task decomposition, integration, and final judgment. Delegate substantial, well-scoped execution to Sonnet agents. Handle trivial edits and tightly coupled iterations directly when delegation adds overhead. Use cheap read-only agents for bounded gathering when it saves time.

Plan only enough to expose important decisions, interfaces, dependencies, and verification. Small changes need no planning document. Skills are an on-demand toolbox; do not run a mandatory chain of skills for ordinary work.

Dispatch parallel writers with the native `Agent` tool and `isolation: "worktree"`, and only over disjoint owned paths. Writers and research agents share the runtime's concurrency budget; let the runtime throttle rather than imposing a count. Give each worker the outcome, its owned files, the intended base, and one verification command, without copying the whole conversation. Serialize work that changes a shared contract or depends on another unit, and integrate serially.

# Quality

Create a plan when unresolved requirements, shared interfaces, dependencies, or costly-to-reverse decisions need it. Review each authored plan once with Codex before implementation. Routine changes need no plan. Review the assembled behavior-changing diff once with Codex; mechanical changes use relevant checks and the orchestrator's inspection. Reviewers receive requirements and evidence without the author's preferred verdict. No recursive councils. CodeRabbit is optional additional feedback.

Confirm findings against the code and fix clear defects within scope. Recheck affected behavior after fixes. Check both the review process status and its response: empty output, credit refusals, timeouts, and transfer refusals are missing reviews even with exit zero. Continue independent work and report the gap; never count it as a pass.

Run checks that demonstrate the intended behavior. Reproduce bugs before fixing them where practical; exercise runtime changes in their real environment. Avoid redundant suites and automatic checks after every edit. Prefer clear code and useful tests.

# Comments

Comment only for non-obvious reasons, workarounds, invariants, or gotchas. Do not restate the code. Keep each comment to one sentence of at most 20 words, normally on one line. Use a second line only with a good reason; never exceed two lines. These limits also apply to function and class docstrings. Module docstrings are exempt. Put longer rationale in documentation or the PR description.

# Boundaries

Respect permissions and explicit denials; report a denied action without retrying it through another route. Preserve unrelated work. Publish, send messages, or perform destructive actions only within the user's authorization.

Read GitHub PR/issue threads and Slack threads as needed, but do not post comments or replies unless the user explicitly asks. A request to review, investigate, implement, or fix something does not authorize posting to those threads.
