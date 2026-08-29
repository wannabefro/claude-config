import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../workflows/build-parallel.js', import.meta.url), 'utf8')
const start = source.indexOf('const snapshotMatches =')
const end = source.indexOf('\nconst pathCheck', start)
if (start < 0 || end < 0) throw new Error('snapshot matcher was not found')
const snapshotMatches = new Function(`${source.slice(start, end)}; return snapshotMatches`)()
const plan = { working_tree_fingerprint: 'frozen-tree', base_commit: 'frozen-head' }
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

check('unchanged final fingerprint and HEAD release the queue', snapshotMatches(plan, { fingerprint: 'frozen-tree', current_head: 'frozen-head' }))
check('late working-tree drift blocks queue release', !snapshotMatches(plan, { fingerprint: 'changed-tree', current_head: 'frozen-head' }))
check('late HEAD drift blocks queue release', !snapshotMatches(plan, { fingerprint: 'frozen-tree', current_head: 'changed-head' }))
check('missing final snapshot blocks queue release', !snapshotMatches(plan, null))

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
