import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/pr-body-lint.py', import.meta.url))
const python = process.env.PYTHON3_RUNTIME || '/usr/bin/python3'
let pass = 0
let fail = 0

const run = (body) => spawnSync(python, [script, '-'], { input: body, encoding: 'utf8' })

const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

const selfTest = spawnSync(python, [script, '--self-test'], { encoding: 'utf8' })
check('the linter self-test passes', selfTest.status === 0, `${selfTest.status}: ${selfTest.stderr}`)
check('the self-test covers readability, not only narration', /readability self-test OK/.test(selfTest.stdout), selfTest.stdout)

const plain = run('Adds a parallel eval runner. Exits non-zero if any suite fails.\n')
check('a plain body passes', plain.status === 0, plain.stdout)

const codeyDiagram = run('## Description\n\nWires a field through.\n\n```mermaid\nflowchart LR\n  A["l10n_service"] --> B["PostEditContext"]\n```\n')
check('a diagram labelled with type names fails', codeyDiagram.status === 1 && /names a symbol/.test(codeyDiagram.stdout), codeyDiagram.stdout)

const plainDiagram = run('## Description\n\nWires a field through.\n\n```mermaid\nflowchart LR\n  A["the app sends a guide"] --> B["the guide outranks the draft"]\n```\n')
check('a diagram labelled with behaviour passes', plainDiagram.status === 0, plainDiagram.stdout)

const jargon = run('## Description\n\nIt threads `a.B` through `c.D` and clears `e.F`.\n')
check('an opening sentence of three identifiers fails', jargon.status === 1 && /identifiers in one opening sentence/.test(jargon.stdout), jargon.stdout)

// The "read this first" table is where identifiers belong, so a later section must stay clean.
const table = run('## Description\n\nPlain opening sentence.\n\n### Read first\n\n| `a.B` | `c.D` and `e.F` |\n')
check('identifiers below a sub-heading are allowed', table.status === 0, table.stdout)

// Narration and readability are separate faults; the old check must still bite on its own.
const narration = run('## Why this PR is smaller than it was\n\nPlain sentence here.\n')
check('narration still fails on its own', narration.status === 1 && /unseen revision/.test(narration.stdout), narration.stdout)

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
