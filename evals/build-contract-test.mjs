// Lifts the real check + sort out of build-parallel.js so a source fix is what
// gets tested, not a retyped copy of it.
import { readFileSync } from 'node:fs'
const SRC = readFileSync(new URL('../workflows/build-parallel.js', import.meta.url), 'utf8')

function slice(startMark, endMark) {
  const i = SRC.indexOf(startMark)
  const j = SRC.indexOf(endMark, i)
  if (i < 0 || j < 0) throw new Error(`cannot locate ${startMark}`)
  return SRC.slice(i, j)
}

const depsBlock = slice('const ancestors = new Map()', 'const owners = new Map()')
const contractBlock = slice('const providers = new Map()', 'if (contractIssues.length) {')

function run(units) {
  const plan = { units }
  const byId = new Map(units.map((u) => [u.id, u]))
  const depsOf = (u) => (u.depends_on || []).filter((d) => byId.has(d))
  const log = () => {}
  const fn = new Function('plan', 'byId', 'depsOf', 'log', `
    ${depsBlock}
    ${contractBlock}
    return { contractIssues, depthOf: null }
  `)
  return fn(plan, byId, depsOf, log).contractIssues
}

const cases = [
  {
    name: 'tipsy shape: consumer has no edge to provider',
    units: [
      { id: 'menu-contract', depends_on: [], provides: ['item.photo', 'config.currency'], consumes: [], files: ['a.ts'] },
      { id: 'menu-render',   depends_on: [], provides: [], consumes: ['item.photo'],      files: ['b.ts'] },
    ],
    expect: (i) => i.some((x) => x.kind === 'unordered-contract' && x.symbol === 'item.photo'),
  },
  {
    name: 'same pair, dependency declared -> allowed',
    units: [
      { id: 'menu-contract', depends_on: [], provides: ['item.photo'], consumes: [], files: ['a.ts'] },
      { id: 'menu-render',   depends_on: ['menu-contract'], provides: [], consumes: ['item.photo'], files: ['b.ts'] },
    ],
    expect: (i) => i.length === 0,
  },
  {
    name: 'a consumer without a provider is refused before dispatch',
    units: [
      { id: 'menu-render', depends_on: [], provides: [], consumes: ['item.photo'], files: ['b.ts'] },
    ],
    expect: (i) => i.some((x) => x.kind === 'missing-provider' && x.symbol === 'item.photo'),
  },
  {
    name: 'transitive dependency counts',
    units: [
      { id: 'a', depends_on: [], provides: ['x.y'], consumes: [], files: ['a.ts'] },
      { id: 'b', depends_on: ['a'], provides: [], consumes: [], files: ['b.ts'] },
      { id: 'c', depends_on: ['b'], provides: [], consumes: ['x.y'], files: ['c.ts'] },
    ],
    expect: (i) => i.length === 0,
  },
  {
    name: 'two units define the same name -> duplicate-provider',
    units: [
      { id: 'a', depends_on: [], provides: ['config.currency'], consumes: [], files: ['a.ts'] },
      { id: 'b', depends_on: ['a'], provides: ['config.currency'], consumes: [], files: ['b.ts'] },
    ],
    expect: (i) => i.some((x) => x.kind === 'duplicate-provider'),
  },
  {
    name: 'no provides/consumes at all -> unchanged behaviour',
    units: [
      { id: 'a', depends_on: [], files: ['a.ts'] },
      { id: 'b', depends_on: [], files: ['b.ts'] },
    ],
    expect: (i) => i.length === 0,
  },
]

let pass = 0, fail = 0
for (const c of cases) {
  const issues = run(c.units)
  const ok = c.expect(issues)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.name}${ok ? '' : ' -> ' + JSON.stringify(issues)}`)
  ok ? pass++ : fail++
}

const check = (name, cond, detail) => {
  cond ? pass++ : fail++
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '\n         ' + detail}`)
}

// invalidated-work: a unit spending time on something a later unit deletes. The
// case this came from ran 2 hours, went green, and answered a dead question.
const invBlk = slice('for (const remover of plan.units)', 'if (contractIssues.length)')
const runInv = (units) => {
  const plan = { units }
  const byId = new Map(units.map((u) => [u.id, u]))
  const depsOf = (u) => (u.depends_on || []).filter((d) => byId.has(d))
  const anc = new Map()
  const ancestorsOf = (id) => {
    if (anc.has(id)) return anc.get(id)
    const seen = new Set()
    const walk = (x) => { for (const d of depsOf(byId.get(x) || {})) if (!seen.has(d)) { seen.add(d); walk(d) } }
    walk(id); anc.set(id, seen); return seen
  }
  const contractIssues = []
  new Function('plan', 'ancestorsOf', 'contractIssues', invBlk)(plan, ancestorsOf, contractIssues)
  return contractIssues
}

const sweep = [
  { id: 'sweep', depends_on: [], consumes: ['level.map'], files: ['a'] },
  { id: 'u7', depends_on: [], removes: ['level.map'], provides: ['flow.registry'], files: ['b'] },
]
check('a sweep over something a later unit deletes is refused',
  runInv(sweep).some((i) => i.kind === 'invalidated-work' && i.wasted === 'sweep' && i.remover === 'u7'),
  JSON.stringify(runInv(sweep)))

// Ordering the demolition first is the fix, and must be accepted.
const ordered = [
  { id: 'sweep', depends_on: ['u7'], consumes: ['level.map'], files: ['a'] },
  { id: 'u7', depends_on: [], removes: ['level.map'], files: ['b'] },
]
check('the same pair is allowed once the remover runs first',
  runInv(ordered).length === 0, JSON.stringify(runInv(ordered)))

check('a transitive dependency on the remover also counts',
  runInv([
    { id: 'sweep', depends_on: ['mid'], consumes: ['level.map'], files: ['a'] },
    { id: 'mid', depends_on: ['u7'], files: ['c'] },
    { id: 'u7', depends_on: [], removes: ['level.map'], files: ['b'] },
  ]).length === 0, 'transitive ordering should satisfy it')

check('a unit that PROVIDES a name someone else removes is caught too',
  runInv([
    { id: 'builder', depends_on: [], provides: ['level.map'], files: ['a'] },
    { id: 'u7', depends_on: [], removes: ['level.map'], files: ['b'] },
  ]).some((i) => i.kind === 'invalidated-work'), 'building what another unit deletes is also waste')

check('removes with no other unit touching the name is silent',
  runInv([
    { id: 'u7', depends_on: [], removes: ['level.map'], files: ['b'] },
    { id: 'other', depends_on: [], consumes: ['thing.else'], files: ['a'] },
  ]).length === 0, 'unrelated removal must not warn')

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
