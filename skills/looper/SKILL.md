---
name: looper
description: >
  Use when the user wants to design, build, or scaffold an agent loop,
  iterative agent workflow, self-review loop, LLM-as-judge loop, multi-model
  council, reviewer/judge gate, or /goal-style looping process.
disable-model-invocation: true
argument-hint: "[target-dir]"
allowed-tools: Write Bash(python3 *)
---

# Looper

`designing-bounded-loops` holds the loop-contract principles; Looper is the
scaffolder that turns a design into runnable files. Audit there, scaffold here.

Use Looper as a loop design coach and scaffolder. During design, interview,
critique, validate, and write files. After emission, offer to run the loop in
the current session using `RUN_IN_SESSION.md`; keep `run-loop.py` as the
advanced external runner.

## Workflow

1. Resolve the target path from the `/looper` argument. If no target is given,
   use `./looper-output`. If the target contains an existing `loop.yaml`, treat
   the task as an edit/resume instead of a fresh scaffold.
2. Load the relevant rubric only when entering that stage:
   - Goal stage: `references/goal-rubric.md`.
   - Verification stage: `references/verification-rubric.md`.
   - Council stage: `references/council-rubric.md`.
   - Control stage: `references/control-rubric.md`.
   - Model detection or privacy details: `references/model-detection.md`.
3. Interview in seven stages: goal, verification, host model, council,
   gates/control, confirmation flow preview, emit/run option. In the control
   stage, cover execution boundary, isolation, no-progress signals, state, and
   run logging. In the host-model stage, apply the **Host Model Default** below.
4. Critique each stage before accepting it. Prefer concrete alternatives over
   vague warnings. Push weak goals toward outcome, scope, context, and done
   state. Push weak verification toward programmatic checks first, then judge
   rubrics, then human signoff.
5. Keep reviewer and judge roles distinct. A reviewer writes notes. A judge
   returns a structured verdict. `revise_until_clean` must name a judge member
   or `human` as `verdict_source`.
6. Require multiple termination guards: `max_iterations`, a revision cap on
   each gate, a no-progress stop, and either a budget cap or an explicit human
   stop point.
7. Before any cross-vendor council member is selected, state what context will
   leave the user's machine, which CLI receives it, which redaction globs apply,
   and that both execution paths require first-send consent.
8. Show an ASCII flow preview of the planned loop and ask for confirmation
   before final emission. Optimize for Claude Code CLI readability.
9. Emit these files into the target:
   - `loop.yaml`
   - `loop.resolved.json`
   - `LOOP.md`
   - `RUN_IN_SESSION.md`
   - `run-loop.py`
   - `loop-workspace/`
   - `README.md`
10. After writing `loop.yaml`, run:
   `python3 ${CLAUDE_SKILL_DIR}/scripts/looper.py compile <target>/loop.yaml --out <target>/loop.resolved.json --render <target>/LOOP.md --session-prompt <target>/RUN_IN_SESSION.md`
   If `python3` is not available, try `python`.
11. Ask whether the user wants to run the loop now in this session. If yes,
   follow `RUN_IN_SESSION.md` directly as the active task. If no, explain that
   the same file is the easy restart path and `run-loop.py` is available for
   advanced external execution.

## Host Model Default

The host model **drives** the loop — it does not orchestrate a session, so it
is subject to the same tiering as any dispatched writer (`rules/orchestration.md`).
Default the driver to the cheapest tier that can do the *per-iteration* work,
not the hardest step the loop ever reaches:

- **Default the driver to Sonnet.** Most loop iterations are dispatch +
  gate-checking + logging — separable, well-specified work Sonnet handles. An
  Opus driver re-reads full loop context every iteration and multiplies cost
  across `max_iterations`; that is the worst case for plan-limit consumption.
- **Do not pick Opus as the driver to cover a hard sub-step.** If a single
  iteration needs Opus-level judgment, escalate *that unit* — a council/judge
  member or a `best-of-n`-style cross-family pass — rather than promoting the
  whole driver. Same rule as "never promote the implementer to Opus".
- **Reserve Opus (or a cross-family judge) for guardrail-critical gates only** —
  auth, payments, migrations, public API, security. Name those gates explicitly
  as the escalation points instead of blanket-running the loop on Opus.
- Surface this tradeoff in the host-model stage: state the driver tier, the
  per-iteration work it must do, and which gates (if any) escalate.

## File Rules

- Write argv arrays, never shell command strings, for all model and check
  invocations.
- Do not write API keys, access tokens, passwords, or CLI auth material into
  `loop.yaml`, `loop.resolved.json`, or model registries.
- Default redaction globs are `.env`, `.env.*`, `secrets/**`, and `**/*.key`.
- Keep `loop.yaml` human-readable and commented where useful. The emitted
  runner reads only `loop.resolved.json`.
- Keep `RUN_IN_SESSION.md` as the default/easy execution handoff. It is meant
  for the current LLM session or a future pasted prompt.
- Copy `templates/run-loop.py` exactly unless the user explicitly asks to edit
  the external runner contract.

## Helper Scripts

- Detect model CLIs:
  `python3 ${CLAUDE_SKILL_DIR}/scripts/looper.py detect-models --write`
- Register a custom CLI:
  `python3 ${CLAUDE_SKILL_DIR}/scripts/looper.py register-model <id> --invoke <cmd> [args...]`
- Compile and render:
  `python3 ${CLAUDE_SKILL_DIR}/scripts/looper.py compile <target>/loop.yaml --out <target>/loop.resolved.json --render <target>/LOOP.md --session-prompt <target>/RUN_IN_SESSION.md`
- Render only the in-session handoff:
  `python3 ${CLAUDE_SKILL_DIR}/scripts/looper.py session-prompt <target>/loop.resolved.json --out <target>/RUN_IN_SESSION.md`

## Confirmation Flow Preview

Use this shape and customize labels:

```text
+--------------------------------+
| 1. Goal + context              |
| read sources                   |
+--------------------------------+
               |
               v
+--------------------------------+
| 2. Draft plan.md               |
| state -> state.json            |
+--------------------------------+
               |
               v
+--------------------------------+
| 3. Plan gate                   |
| verdict: reviewer-1            |
+--------------------------------+
               | needs work -> revise <= 3 -> step 2
               | pass
               v
+--------------------------------+
| 4. Write delivery-N.md         |
| log -> run-log.md              |
+--------------------------------+
               |
               v
+--------------------------------+
| 5. Delivery gate               |
| verdict: reviewer-1            |
+--------------------------------+
               | needs work -> revise <= 3 -> step 4
               | pass
               v
+--------------------------------+
| 6. Final output                |
| all gates clean                |
+--------------------------------+

Stops: pass gates | max 12 iterations | no progress x2 | budget 30m, $5.0
```

## Emit Checklist

- The goal has a clear outcome, scope boundary, context sources, and done state.
- Verification criteria are typed as `programmatic`, `judge`, or `human`.
- At least one criterion is not purely vibe-based unless the user explicitly
  accepts that risk.
- Each `revise_until_clean` gate has a valid `verdict_source`.
- Every external invocation is an argv array with a timeout.
- Cross-vendor egress is scoped, redacted, and consent-gated.
- `loop_control` has iteration, revision, no-progress, and wall-clock or budget
  caps.
- Execution boundary and isolation are explicit, even when the choice is the
  current workspace.
- Observability names a `run-log.md` and `state.json` path.
- The host/driver model defaults to Sonnet; any Opus/cross-family use is scoped
  to a named guardrail-critical gate, not the whole driver (see Host Model Default).
- `loop.resolved.json`, `LOOP.md`, and `RUN_IN_SESSION.md` compile
  successfully before handoff.
