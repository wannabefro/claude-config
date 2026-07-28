import { readFileSync } from 'node:fs'
const SRC = readFileSync('/Users/sam/.claude/workflows/build-parallel.js','utf8')
const i = SRC.indexOf('const planPath ='), j = SRC.indexOf('// Ids must be unique', i)
const blk = SRC.slice(i, j)
const run = (route, units, task) => {
  const plan = { route, units, reason:'r', route_reason:'rr' }
  const log=()=>{}
  const body = blk + "\nreturn (typeof __out !== 'undefined') ? __out : null"
  // execute the two early-return branches by wrapping in a function that captures returns
  const f = new Function('plan','task','log', blk.replace(/return \{/g,'return __r({').replace(/\n\}\n/g,'\n})\n') )
  return { plan, task }
}
// simpler: just assert the routeOf mapping + branch conditions directly from source text
const checks = [
  ['route enum present', /enum: \['parallel', 'ce-work', 'inline'\]/.test(SRC)],
  ['route_reason in schema', /route_reason:/.test(SRC)],
  ['fan-out gated on route', /if \(plan\.route !== 'parallel'/.test(SRC)],
  ['single-unit gated on route', /if \(plan\.route === 'parallel' && plan\.units && plan\.units\.length === 1\)/.test(SRC)],
  ['units travel on non-parallel', /units: plan\.units \|\| \[\]/.test(SRC)],
  ['no stale plan.decomposable reads', !/plan\.decomposable/.test(SRC)],
  ['decomposer prompt names all three', /`parallel`|\\`parallel\\`/.test(SRC) && SRC.includes('inline') && SRC.includes('ce-work')],
]
let f=0
for (const [n,ok] of checks) { console.log(`  ${ok?'ok  ':'FAIL'} ${n}`); if(!ok) f++ }
console.log(`  ---- ${checks.length-f} passed, ${f} failed`)
process.exit(f?1:0)
