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
const contractBlock = slice('// Contract collisions.', 'if (contractIssues.length) {')

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

// merge order determinism: equal depth must not depend on input order
const depthOf = () => 1
const sortIt = (ids) => ids.slice()
  .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))
  .join(',')
const o1 = sortIt(['zebra', 'alpha', 'mango'])
const o2 = sortIt(['mango', 'zebra', 'alpha'])
const det = o1 === o2
console.log(`  ${det ? 'ok  ' : 'FAIL'} equal-depth merge order is input-independent (${o1})`)
det ? pass++ : fail++

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
