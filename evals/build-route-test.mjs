import { readFileSync } from 'node:fs'
const SRC = readFileSync(new URL('../workflows/build-parallel.js', import.meta.url),'utf8')
const validationStart = SRC.indexOf('const planValidation =')
const validationEnd = SRC.indexOf('\n\nlet plan', validationStart)
const planValidation = new Function(`${SRC.slice(validationStart, validationEnd)}; return planValidation`)()
let f=0
const check=(name,ok,detail='')=>{console.log(`  ${ok?'ok  ':'FAIL'} ${name}${ok?'':`\n         ${detail}`}`);if(!ok)f++}
const validUnit={id:'one',title:'one',depends_on:[],files:['one.ts'],provides:[],consumes:[],removes:[],definition_of_done:'observable result',verify_command:'true'}
const validPlan={route:'parallel',route_reason:'independent files',workspace:'worktree',workspace_reason:'private roots',working_directory:'/tmp/repo',base_commit:'abc',reason:'two independent units',units:[validUnit]}
check('valid private-worktree plan passes validation', planValidation(validPlan).length===0, JSON.stringify(planValidation(validPlan)))
check('shared-workspace plan is rejected rather than downgraded', planValidation({...validPlan,workspace:'shared'}).some((e)=>e.includes('workspace must be worktree')), JSON.stringify(planValidation({...validPlan,workspace:'shared'})))
check('worktree-safe unit ids reject path traversal', planValidation({...validPlan,units:[{...validUnit,id:'../escape'}]}).some((e)=>e.includes('worktree-safe')), JSON.stringify(planValidation({...validPlan,units:[{...validUnit,id:'../escape'}]})))

const branchStart = SRC.indexOf("if (plan.route === 'parallel' && plan.units")
const branchEnd = SRC.indexOf('// Ids must be unique', branchStart)
const serialBranch = SRC.slice(branchStart, branchEnd)
const fakeUnits = [{ id: 'one', title: 'one', files: ['one'], definition_of_done: 'done', verify_command: 'true' }]
const testInvocationNonce = 'a'.repeat(64)
const testPlanHash = 'b'.repeat(64)
const runSerial = async (snapshot = { fingerprint: 'frozen-tree', current_head: 'frozen-head' }) => {
  const plan = { route: 'serial', units: fakeUnits, reason: 'coupled', working_directory: '/tmp/repo', base_commit: 'frozen-head', working_tree_fingerprint: 'frozen-tree' }
  const calls = []
  const agent = async (_prompt, options) => {
    calls.push(options)
    if (options.label === 'build:serial-prepare-worktree') return { status: 'ready', root: '/tmp/claude-build-worktrees.test', token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', invocation_nonce: testInvocationNonce, plan_hash: testPlanHash, path: '/tmp/claude-build-worktrees.test/serial', seed: '0123456789012345678901234567890123456789' }
    if (options.label === 'build:serial-integrate') return { status: 'integrated' }
    if (options.label === 'build:serial-cleanup') return { status: 'cleaned' }
    return { status: 'green', summary: 'ok' }
  }
  const approvalSnapshot = async () => snapshot
  const snapshotMatches = (p, s) => Boolean(s && s.fingerprint === p.working_tree_fingerprint && s.current_head === p.base_commit)
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`
  const wrapped = new Function('plan', 'task', 'build', 'log', 'phase', 'agent', 'UNIT', 'approvalSnapshot', 'snapshotMatches', 'shellQuote', 'INTEGRATION_RESULT', 'invocationNonce', 'frozenPlanHash', `return (async () => {${serialBranch}})()`)
  const out = await wrapped(plan, 'serial test', false, () => {}, () => {}, agent, { type: 'object' }, approvalSnapshot, snapshotMatches, shellQuote, { type: 'object' }, testInvocationNonce, testPlanHash)
  return { out, calls }
}
const serial = await runSerial()
const serialOk = serial.out?.route === 'serial' && serial.out?.built === true && serial.out?.units_green === 1 && serial.out?.cleanup?.status === 'cleaned' && serial.calls.filter((c) => c.label === 'build:serial').length === 1 && serial.calls.find((c) => c.label === 'build:serial')?.agentType === 'implementer'
console.log(`  ${serialOk ? 'ok  ' : 'FAIL'} serial build uses one isolated Luna implementer and integrates only after cleanup${serialOk ? '' : `\n         ${JSON.stringify(serial)}`}`)
if (!serialOk) f++
const drifted = await runSerial({ fingerprint: 'changed-tree', current_head: 'frozen-head' })
const driftOk = drifted.out?.units_green === 0 && !drifted.calls.some((c) => c.label === 'build:serial') && drifted.out?.needs_attention?.[0]?.status === 'blocked'
console.log(`  ${driftOk ? 'ok  ' : 'FAIL'} serial final snapshot drift blocks the Luna dispatch${driftOk ? '' : `\n         ${JSON.stringify(drifted)}`}`)
if (!driftOk) f++
console.log(`  ---- ${4 + 1 - f} passed, ${f} failed`)
process.exit(f?1:0)
