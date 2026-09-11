---
name: parallelise-work
description: Decide whether to split a task across concurrent workers, and how to slice it so the units are independent. Use when a task has more than one part — several files to change, several questions to answer, several findings to fix, several repositories to check — and before dispatching any agent. Also use when a task feels slow and you suspect it should have been split.
---

# Parallelise work

## The rule

**Split when the units are independent AND each unit needs more than about 30 seconds
of its own work. Otherwise do it in the main thread.**

Both halves matter. Independence alone is not enough, because a worker is not free.

## A worker is not free

Measured on this machine on 2026-09-10, exact-match scored against a scripted
ground truth:

| task | 3 Haiku in parallel | 1 Sonnet alone | main thread, no worker |
|---|---|---|---|
| List the `check()` names in 3 files | 15.0 s · 190k tokens | 15.7 s · 91k tokens | not run |
| Run 3 test suites, report the counts | 20.4 s · 184k tokens | 16.3 s · 94k tokens | **4 s** |

Every arm scored 36 of 36 correct, so Haiku matched Sonnet on accuracy. The
fan-out still won nothing: each worker pays 12 to 20 seconds and about 60,000
tokens before it reads anything. On the second task the main thread was five
times faster than any agent.

So "parallelise wherever possible" is the wrong instruction. "Parallelise
wherever it pays" is the right one, and the bar is the startup cost above.

## The habit runs the other way

Measured over 28 days and 421 dispatch bursts: **416 held exactly one agent.**
Only 5 held two or more. So when a task clears the size bar, the error you are
most likely to make is still splitting too little. Bias toward splitting once
the units are big enough, not before.

## Procedure

1. **Try one command first.** One search, one script, one test run. If the whole
   task fits, stop here — this is the case the benchmark above punishes hardest.
2. **List the units.** Two units are independent when they write disjoint files
   and neither reads the other's output.
3. **Size each unit.** Under about 30 seconds of its own work, merge it into the
   main thread or into a sibling unit.
4. **Dispatch every eligible unit in one message.** Two dispatches in two turns
   run serially and cost an extra round trip.
5. **Respect the ceilings:** 8 concurrent subagents, and at most 3 that write.
   `rules/orchestration.md` holds both.

## How to slice so the units are actually disjoint

| slice by | works because |
|---|---|
| production file plus its own test file | the natural write boundary; one writer owns both |
| repository or service | separate checkouts, no shared index |
| independent question, read-only | no writes at all, so no contention |
| review finding, after you confirm it | each confirmed finding names its own files |

**Do not slice by step.** "Step 1, then step 2" is a dependency chain, not a
fan-out. Keep it serial, or make step 2 depend on step 1 integrating first.

## Two traps

**Use a subagent, not a teammate, when you need the answer back.** A subagent
returns its report to you. A teammate signals idle and you must ask it for the
report. Measured over 306 dispatches: 190 were teammates, and the subagents
returned a report 113 of 114 times. `rules/worktree-workflow.md` has the detail.

**Diagnosis comes before dispatch.** Deciding whether a finding is real is your
work, not a worker's. A worker handed an unconfirmed claim re-derives context
you already hold, and a wrong claim costs it a whole investigation that ends in
no change.

## Give every unit an output contract

Name the exact fields to return. A brief that only describes the work lets a
worker finish and stop silently, which reaches you as an empty notification.

## When not to split at all

- Two units would write the same file. Ownership decides this, not optimism.
- The dependency graph has width one, so nothing can overlap.
- The change is coupled prose or one interface, where wording must agree
  across the units. Serial keeps it consistent.
- The whole change is one file.
