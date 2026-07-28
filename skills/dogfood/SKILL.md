---
name: dogfood
description: >-
  Exercise a change in its real runtime before claiming it works — UI in a
  browser, APIs hit with curl, CLIs run on representative input, jobs sent real
  messages. Use when you've finished a code change and need to verify it
  actually does what you intended (not just that tests pass). Use proactively
  before claiming a task complete, before committing user-visible behavior
  changes, and before marking a PR ready. Trigger phrases: "dogfood this",
  "/dogfood", "run it for real", "exercise this", "test it like a user".
---

# dogfood — exercise the change in its real runtime

Static checks (type-check, lint, unit tests) verify that code does what you told it to. Dogfooding verifies that **you told it the right thing**. They are not substitutes. A green test suite plus a feature that doesn't actually work is the failure mode this skill exists to prevent.

The acceptance signal is **"I ran it and saw X"** — never "it should work" or "the tests pass, so."

**vs neighbours:** `/verify-this` is for adjudicating a stated claim with baseline-vs-treatment evidence; `/verify` bootstraps a project-specific verification skill. Dogfood is the general "exercise the change in its real runtime" pass — don't stack all three on one change.

## Step 1: Classify the change

Pick the row that best matches. If multiple apply (e.g. an API change that also affects the UI), do both.

| Change type | Dogfood by |
|------|-----|
| Web UI change | Open the page in a browser, exercise the affected flow, take a screenshot |
| API endpoint (new, changed, or fixed) | Call it locally with `curl`/`httpie`; check status, response shape, and side effects |
| CLI tool / command | Run the binary on representative input; check stdout, stderr, exit code |
| Background job / Kafka consumer | Send a representative message; tail logs; verify side effects (DB writes, downstream calls) |
| Database migration | Run the migration locally on a copy of the schema; inspect the result; run a representative query against the new shape |
| Schema change (proto, OpenAPI, GraphQL) | Regenerate clients; compile a consumer against the new schema |
| Library / SDK code (no entry point) | Write a 5-line driver script that exercises the new surface; run it |
| Configuration / appfile change | Boot the affected service locally with the new config; verify the change took effect |
| Performance change | Benchmark before and after on representative input; record both numbers |
| Bug fix | First reproduce the bug to confirm you understand it; then verify the fix removes the bad behavior **and** preserves the good behavior |
| Test-only change | Run the new test; then **mutate** the production code to break the invariant and confirm the test fails. A test that doesn't fail when the invariant is violated is theater. `~/.claude/scripts/mutation-probe.py` automates this — see below. |

## Step 2: Pick the right tool

**Web UI:** prefer in this order based on what's already loaded in your session:
- `mcp__plugin_playwright_playwright__*` — best for scripted multi-step flows, form fills, network capture
- `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` — best for performance traces, console inspection, network panel
- `mcp__claude-in-chrome__*` — best when the user has a specific Chrome session/tab open

Always: navigate → take a snapshot or screenshot → exercise the flow → take another snapshot → diff what changed. Don't skip the post-action capture.

**APIs:**
- Local: `curl -sS -X <METHOD> http://localhost:<port>/<path> -d '<body>' | jq` — pipe through `jq` for structure
- Capture both the response body **and** the side effect (DB row, log line, downstream queue message). Response 200 with the wrong DB state is a failure dressed as success.

**CLIs:**
- Run on the same input shape the user will give it
- Capture stdout AND stderr AND exit code (`echo $?`)
- For long-running: `run_in_background` and `BashOutput` later

**Background jobs / consumers:**
- Produce a representative message into the local Kafka topic / queue
- Tail the consumer logs (`docker compose logs -f <service>` or equivalent)
- Verify the side effect downstream — don't stop at "the consumer processed it"

**Database migrations:**
- Run against a local DB; `\d <table>` (psql) or `DESCRIBE <table>` (mysql) to inspect the new shape
- Run a representative read query to confirm the data is queryable as intended
- For backfills: spot-check 3-5 rows manually

**Performance changes:**
- Benchmark must use the **same input** for before and after; one-off timings are noise
- For a Pants/Bazel monorepo: run the relevant benchmark target if one exists; otherwise write a minimal driver
- Record both numbers in the response, not just "it's faster"

## Step 3: Decide if dogfooding is required

**Exceptions where dogfooding is theater** (skip with explicit note):
- Pure type-only widening (no runtime change)
- Doc-only / comment-only edits
- Variable renames with no observable behavior change
- Config tweaks the user couldn't observe running (e.g. internal flag rename)
- Generated code that's verified by a code-gen test

**Heuristic:** if a user couldn't tell the change happened by interacting with the system, dogfooding doesn't add signal. The type-check or tool invocation is the verification.

## Step 4: When you genuinely can't dogfood

Some changes can't be exercised locally:
- Production-only data flows (e.g. real customer ingest at scale)
- Cross-service prod integration without staging
- External APIs without test credentials
- Infrastructure changes that only manifest in a real cluster

**Say so explicitly.** "I can't exercise this locally because <reason>. The static signals I do have are: <type-check, unit tests, peer review>." Do not silently skip and claim success.

If the change is high-stakes and you can't dogfood, escalate: ask the user whether to (a) deploy to staging and verify there, (b) write a more thorough integration test, or (c) accept the risk explicitly.

## Step 5: Report

End with a concrete observation, not a hand-wave:

- ✅ Good: "Hit `POST /v1/profiles` with `{name: 'test'}` — returned 201 with id `prof_abc123`. Verified row in `profiles` table with matching id and name."
- ✅ Good: "Loaded `/dashboard` in browser, clicked the new 'Export' button, file `export-2026-05-27.csv` downloaded with 142 rows. Screenshot attached."
- ❌ Bad: "Tested the endpoint, works as expected."
- ❌ Bad: "Manually verified the UI."

The good versions are falsifiable — a reviewer can repeat them. The bad versions are claims that you ran something; the reader has no evidence you did.

## Anti-patterns

- **Running only the happy path.** Exercise at least one edge case relevant to the change (empty input, invalid input, the boundary condition the change addresses).
- **Capturing only stdout.** Side effects (DB rows, log lines, downstream messages) are where bugs hide.
- **Skipping the "before" state.** For bug fixes, reproducing the original bug first is what proves the fix works.
- **"Tests pass, so it works."** Tests prove the code matches your intent. Dogfooding proves your intent matched the user's.
- **Trusting a 200 response.** 200 + wrong body, 200 + no side effect, 200 + silent error swallowing — all common.

## Measuring whether tests are worth anything

`rules/principles.md` says a test that still passes after the rule it guards changes is the wrong
test. That is a mutation test. Do not try to judge it by reading the tests — measured 2026-07-28, a
regex classifier called 22% of one suite low-value and **3 of 3** hand-checked flags were wrong. A
`.toBe(true)` on `accessibilityState.disabled` is precise; a `.toBe(true)` on a render result is
vacuous; nothing in the text distinguishes them.

```
R=~/dev/<repo>; W=/tmp/mut-<repo>
git -C $R worktree add --detach $W HEAD
ln -s $R/node_modules $W/node_modules
python3 ~/.claude/scripts/mutation-probe.py $W/src --test-cmd "npx vitest run --root $W" --tested-only
```

The symlink is required. A worktree checks out tracked files only, so without it every run fails for
a reason unrelated to the mutant.

Read the **survivors**, not the score. Each one is a rule nothing guards. A first run on
inflationguessr scored 28/40 killed (70%); the 12 survivors clustered in component render logic and
store guard clauses, and three were real defects — an inverted over/under direction, an inverted
phase guard, and an off-by-one on `roundIndex`. Pure library functions were guarded well.

Two traps, both hit on the first run:

- **Validate the operators before quoting a number.** The first pass mutated JSX brackets (`</p>` →
  `<=/p>`), which is a syntax error rather than a changed rule, in files no test imported. 23 of 40
  mutants were noise.
- **Use `--tested-only`** unless you want uncovered files in the result. Without it a survivor may
  only mean the file has no tests — a real finding, but a different one.
