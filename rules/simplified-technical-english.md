---
description: Report to the user in ASD-STE100 Simplified Technical English — the writing rules, what they apply to, and what they do not.
---

# Report in Simplified Technical English (ASD-STE100)

**Write every report to the user in Simplified Technical English.** This applies to the main thread
and to all agents. Apply it to the prose you write, not to the material you quote.

## What this covers, and what it does not

STE has two halves. The **writing rules** are given in full below, and they are mandatory. The
**approved dictionary** — about 900 words, each with one approved meaning and one approved part of
speech — is not available here, so treat it as a target: prefer the plainest common word, and use one
word for one meaning. Do not claim a report is dictionary-checked. It is not.

Never rewrite these into STE, because changing them makes them wrong:

- Code, identifiers, file paths, commands, flags, and error text
- Anything you quote from a tool, a log, a test run, or another person
- Commit messages and PR bodies, which follow the repository's own conventions
- Structured data an agent returns to a caller — schema fields are not prose

Technical names (`build-parallel.js`, `depends_on`, `worktree`) and technical verbs (`commit`,
`merge`, `compile`) are permitted. STE allows them, and a paraphrase would be less clear.

## The rules

**Sentences**

1. Write one instruction in one sentence.
2. Keep an instruction to 20 words or fewer. Keep a description to 25 words or fewer.
3. Keep a paragraph to 6 sentences or fewer.
4. Use the active voice. Name who does the action.
5. Use the simple present, the simple past, or the simple future. Do not use the perfect tenses or
   the progressive tenses.
6. Do not use an `-ing` form as a verb. Change "the test is failing" to "the test fails".
7. Do not remove the articles. Write "the file", not "file".
8. Write a positive statement. Do not write "it is not impossible".
9. Do not use more than three nouns together. Break up "build worktree cleanup script failure".

**Words**

10. Use one word for one meaning, every time. Do not use a synonym for variety.
11. Do not use slang, idiom, metaphor, or humour.
12. Do not use an abbreviation before you write it in full once.
13. Do not use a word that only sounds precise. Give the number or the name.

**Structure**

14. Put the conclusion first. Put the reasoning after it.
15. Use a list or a table when the content has parts. Do not hide steps inside a paragraph.
16. Give each warning before the step it applies to, never after.

## Worked examples

| Do not write | Write |
|---|---|
| "I've gone ahead and refactored the scheduler, which should hopefully make things a fair bit snappier." | "I changed the scheduler. It now dispatches 8 units in one pass, not 2." |
| "There were a couple of issues that were being caused by the worktree not having node_modules installed." | "The worktree has no `node_modules`. Every verify command failed for that reason." |
| "This isn't unlikely to break." | "This can break." |
| "Tests are passing." | "The tests pass. 7 of 7." |
| "I'm now going to be looking at the build ordering problem." | "I look at the build ordering problem next." |

## Why

Reports are read on a phone at 80 columns, and often between other tasks. A missed instruction costs
hours. STE removes the two things that cause a missed instruction: a sentence that carries more than
one action, and a word that has more than one meaning.

This rule sets the **language** of a report. It does not change the **shape** of one — the closing
block and the length limits stay as the output style defines them.
