---
description: Cross-project engineering principles — comment limits, conflict resolution, test invariants, ambiguity handling.
---

# Engineering Principles

## Comment sparingly — a comment is prose, so STE governs it

Default to zero comments. Each comment must earn its place. This is a hard default, and it covers
every file type, including YAML and config.

Three countable limits, taken from `rules/simplified-technical-english.md`:

1. Write one sentence in one comment. Keep it to **20 words or fewer**.
2. Never write a block of **more than 3 comment lines**. A longer block is a rationale block, and it
   belongs in the PR description.
3. Keep a file at **15% comment lines or fewer**. When you edit a file, match or reduce its density.

Add a comment only when it says what the code cannot: why a non-obvious choice was made, a workaround
and its cause, an invariant, or a genuine gotcha. Never restate the line, label an obvious section, or
explain the diff. Delete a stale comment rather than update it.

`scripts/comment-density.py` measures all three. It takes files, directories, or `--staged`, and it
exits 1 on a breach. **A rule alone did not work** — this repo measured 17.8% comment lines on
2026-07-30, with 47 blocks over the limit. The three failure modes that produced it, and the numbers:
`docs/principles-rationale.md`.

## Copy a working config, don't validate a guess

For an undocumented config surface, find a real working example before you write anything. Look in the
tool's own repo: its `skills/`, its `docs/`, and any `dogfood/`, `examples/`, `fixtures/` or test
tree. A shipped config the maintainers keep green beats any inference.

**Never infer a schema from `strings` on a binary.** It gives field *names* and no *types*, and a
wrong type fails the decode where a wrong name is merely ignored. Measured 2026-07-31 on a cmux
action: three rounds of binary inference each produced a still-wrong shape, and one fetch of
`dogfood/directory-actions/.cmux/cmux.json` settled it — `icon` takes an object, not a string.

Check first whether a wrong value is even observable. If no CLI validates it and no log records it,
every guess costs a human round trip, so buy the example instead.

**The same rule covers a library.** Read its documentation and its types before you conclude it cannot
do something, and check what the project already depends on before you add a package or write your own.
"I assumed it lacked that" and "I inferred the field names" are one mistake.

## Build the smallest thing that works, then add to it

Two triggers, both visible in a diff:

1. **A parameter, flag, or config key that nothing currently reads** — delete it. Add it when the
   second caller exists.
2. **A step that leaves the product broken until a later step lands** — reorder so every step ends
   green.

**Delete an obsolete path instead of adding a fallback beside it, where you own every consumer.**
Guardrail surfaces are the carve-out: `rules/shipping.md` sends migrations, schema, public API, and
permissions to cross-family review because the old path is still live. `~/.claude` counts too — it is
public and synced, so a deleted path breaks the machine that has not pulled.

## Surface conflicts, don't average them

When two patterns in the codebase contradict, pick one — prefer the more recent or more tested — and
say why. Flag the other for cleanup. Don't blend them into a third hybrid that matches neither; a
silent average leaves no anchor for the next reader.

## Tests must encode why, not just what

A test that still passes after the business rule it guards changes is the wrong test. Name the
invariant in the test name or a one-line comment. Behaviour-only assertions (`returns 200`, `dict has
key "id"`) are insufficient when the point of the code is a specific rule.

### The gap is guards and boundaries, not assertions — measured

Mutation-tested three repos on 2026-07-28 with `scripts/mutation-probe.py`: inflationguessr 70%,
tipsy `apps/mobile` 73%, chromaticly 73%. The suites are sound. **Do not go looking for weak
assertions** — a separate regex pass over assertion styles called 22% of one suite low-value and 3
of 3 hand-checked flags were wrong.

The 28 survivors clustered into four shapes, and the same four appeared in all three repos:

| shape | example that survived |
|---|---|
| Null and type guards | `if (typeof a !== 'object' \|\| a === null) return false` |
| Early-return guard clauses | `if (!selected \|\| isLastCategory \|\| busy) return` |
| Empty-input fallbacks | `properties.length > 0 ? properties : BAR_PROPERTIES` |
| Validation boundaries | `handle.length >= 3 && handle.length <= 30` |

The core rule always had a test. The guard protecting it never did, and the boundary was tested one
value inside it rather than at it.

So when you write a test for a function, add two cases beyond the main path:

1. **Each guard clause, taken on its own.** One case per condition in the `||` chain, or the chain is
   only proven as a whole and any single term can be deleted without a failure.
2. **The boundary value itself**, not a value near it. `length === 30` and `length === 31`, never
   `length === 10`.

Run the probe before claiming a suite is thorough. `/dogfood` documents the invocation, including the
`node_modules` symlink a worktree needs.

**`mutation-probe.py` is JS and TypeScript only.** Its operators mutate `===` and `!==`, so it cannot
read Go at all. For Go use **gremlins**, at `~/go/bin/gremlins` and already on `PATH`:

```
gremlins unleash --timeout-coefficient 10 .
gremlins unleash --timeout-coefficient 10 --diff main -E '\.pb\.go$' .
```

**Two flags are not optional, and both fail silently.** Verified 2026-07-31 against a planted weak
boundary test:

| trap | what happens |
|---|---|
| `./...` | Prints `No results to report` and exits 0. **Pass `.`** — with `./...` even `--dry-run` finds nothing |
| Default timeout | Every mutant came back `TIMED OUT`, giving `Test efficacy: 0.00%`. That reads as a broken suite and means unmeasured |

With `.` and `--timeout-coefficient 10` the same run reported `Killed: 2, Lived: 2`, efficacy 50%, and
named `LIVED CONDITIONALS_BOUNDARY` twice — the planted gap. The test checked lengths 2 and 10, never
3 or 30, so `<` survived becoming `<=`. That is the boundary cluster above, found automatically.

It mutates only covered lines, and `test_efficacy = killed / (killed + lived)`. Aim for 90% on
guardrail code and 70–80% elsewhere. Chosen over `go-mutesting` on maintenance: gremlins last shipped
2026-06-26, go-mutesting 2024-07-04.

**No skill for this is worth installing.** Every gremlins-based skill ships inside a plugin of 47 or
about 120 skills, and Claude Code cannot enable one skill from a plugin — so the always-on context
cost is 46 or 119 unwanted descriptions. The binary plus these four lines is the whole value.

### The house style is already good — keep it there

Write short tests: two assertions, almost no module mocking, little shared setup, and a long
descriptive name. A change that moves far from that shape needs a reason. The measured baseline across
six repos and 5,117 tests is in `docs/principles-rationale.md`; check a column before you change it.

**Never judge a test by its text.** Three regex passes tried it on 2026-07-28 and all three gave a
wrong answer. Structure counts and mutation scores are measurable. Quality is not measurable from
text, so do not go looking for weak assertions — run `scripts/mutation-probe.py` instead.

## Name the readings when a request is ambiguous

If a non-trivial prompt admits more than one reasonable reading, say so in a sentence and pick a
default — enough that I can redirect cheaply, not an exhaustive survey. Silent disambiguation is the
failure mode; the cost is discovering 20 minutes in that I meant the other one.
