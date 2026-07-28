import { readFileSync } from 'node:fs'
const SRC = readFileSync(new URL('../workflows/council-review.js', import.meta.url), 'utf8')
const sl = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); if (i < 0 || j < 0) throw new Error(a); return SRC.slice(i, j) }

// The batching + regroup block, lifted verbatim so the test tracks the real code.
const blk = sl('    const batches = []', '    return parallel(found.map((f) => () => {')

let pass = 0, fail = 0
const check = (name, cond, detail) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : `\n         ${detail}`}`) }

const mkFindings = (n) => Array.from({ length: n }, (_, i) => ({
  severity: i === 0 ? 'critical' : 'minor', title: `f${i}`, file: `src/a${i}.ts`,
  why_it_breaks: 'x', evidence: 'y',
}))

// Every challenger refutes the odd-indexed claims and upholds the even ones, so
// the regroup is checked against a verdict pattern that cannot match by accident.
const run = async (nFindings, { dropBatch = -1, dropIndex = -1 } = {}) => {
  const dispatched = []
  const agent = async (prompt, opts) => {
    dispatched.push(opts.label)
    const m = opts.label.match(/#(\d+)@/)
    const bi = Number(m[1])
    if (bi === dropBatch) return null
    const size = Math.min(4, nFindings - bi * 4)
    const verdicts = []
    for (let i = 0; i < size; i++) {
      if (bi * 4 + i === dropIndex) continue
      verdicts.push({ index: i, refuted: (bi * 4 + i) % 2 === 1, reasoning: `r${bi}.${i}` })
    }
    return { verdicts }
  }
  const found = mkFindings(nFindings)
  const body = blk + '\nreturn { votesFor, found, batches }'
  const fn = new Function('found', 'CHALLENGE_BATCH', 'CHALLENGERS', 'log', 'parallel',
    'agent', 'scope', 'member', 'CHALLENGE_BATCH_SCHEMA', 'READER',
    `return (async () => {${body}})()`)
  const out = await fn(found, 4, ['opus', 'sonnet'], () => {},
    (thunks) => Promise.all(thunks.map((t) => t())), agent, 'SCOPE',
    { key: 'correctness' }, {}, 'council-reader')
  return { ...out, dispatched }
}

// 12 findings: the shape that made one real run 48 challenge agents.
const r = await run(12)
console.log(`  12 findings -> ${r.dispatched.length} challenge agents`)
check('batching replaces the per-finding fan-out (24 agents -> 6)',
  r.dispatched.length === 6, `got ${r.dispatched.length}: ${r.dispatched.join(' ')}`)
check('every finding still receives a verdict from BOTH families',
  r.found.every((f) => (r.votesFor.get(f) || []).length === 2),
  r.found.map((f) => (r.votesFor.get(f) || []).length).join(','))
// Regrouping is the part that can silently mis-attribute: a verdict landing on
// the wrong finding would flip a real bug to refuted, or resurrect a dead one.
check('verdicts map back to the right finding, not merely the right count',
  r.found.every((f, i) => (r.votesFor.get(f) || []).every((v) => v.refuted === (i % 2 === 1))),
  r.found.map((f, i) => `${i}:${(r.votesFor.get(f) || []).map((v) => v.refuted).join('/')}`).join(' '))

// Fewer findings than a batch must not create empty batches.
const r3 = await run(3)
check('3 findings -> one batch per family, no empty batch',
  r3.dispatched.length === 2 && r3.found.every((f) => (r3.votesFor.get(f) || []).length === 2),
  `${r3.dispatched.length} agents`)

// Both challengers for a batch dying takes CHALLENGE_BATCH findings with it —
// the blast radius batching introduced. The findings in OTHER batches must be
// untouched, and the orphaned ones must reach the fail-open path below.
const rd = await run(8, { dropBatch: 0 })
check('a dead batch orphans only its own findings',
  [0, 1, 2, 3].every((i) => (rd.votesFor.get(rd.found[i]) || []).length === 0) &&
  [4, 5, 6, 7].every((i) => (rd.votesFor.get(rd.found[i]) || []).length === 2),
  rd.found.map((f) => (rd.votesFor.get(f) || []).length).join(','))

// A verdict omitted from an otherwise-good batch must not shift the others.
const ri = await run(8, { dropIndex: 5 })
check('an omitted verdict costs only its own finding its votes',
  (ri.votesFor.get(ri.found[5]) || []).length === 0 &&
  ri.found.filter((_, i) => i !== 5).every((f) => (ri.votesFor.get(f) || []).length === 2),
  ri.found.map((f) => (ri.votesFor.get(f) || []).length).join(','))

// The fail-open path itself: zero votes must surface the finding, not bury it.
// Before this, `survives` came from unanimousHold, which is false at zero votes.
const failOpen = sl('        if (!cast.length) {', '        const unanimousKill')
const fo = new Function('cast', 'f', 'member', 'log',
  `${failOpen} return null`)(
  [], { title: 't', severity: 'critical' }, { key: 'correctness' }, () => {})
check('a finding with no verdict survives, flagged unchallenged',
  fo && fo.survives === true && fo.unchallenged === true && fo.votes === 0,
  JSON.stringify(fo))

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
