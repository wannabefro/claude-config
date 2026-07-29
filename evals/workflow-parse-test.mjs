import { readFileSync, readdirSync } from 'node:fs'

// `node --check` is NOT a valid gate for a workflow script, and trusting it
// shipped a broken council-review.js on 2026-07-29. Two reasons:
//   · a workflow script uses a top-level `return`, which is illegal in a plain
//     module, so a straight parse fails for a reason that is not a defect;
//   · because of that, --check on these files gave a false PASS on a real
//     defect — `await` inside a non-async arrow, which throws at runtime.
//
// The harness runs the script as the body of an async function. Parsing it the
// same way is the only check that matches reality: `new Function` compiles
// without executing, so top-level return and top-level await are both legal,
// and a misplaced `await` is caught exactly as the runtime would catch it.
const DIR = new URL('../workflows/', import.meta.url)

let pass = 0, fail = 0
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.js')).sort()) {
  const src = readFileSync(new URL(f, DIR), 'utf8')
  // The harness supplies these; naming them keeps the parse honest about scope.
  const globals = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow']
  try {
    // eslint-disable-next-line no-new-func
    new Function(...globals, `return (async () => {\n${src.replace(/^export const meta/m, 'const meta')}\n})()`)
    pass++
    console.log(`  ok   ${f} parses as an async workflow body`)
  } catch (e) {
    fail++
    console.log(`  FAIL ${f}\n         ${e.constructor.name}: ${e.message}`)
  }
}
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
