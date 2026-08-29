import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
const SRC = readFileSync(new URL('../workflows/build-parallel.js', import.meta.url),'utf8')
const validationStart = SRC.indexOf('const planValidation =')
const validationEnd = SRC.indexOf('\n\nlet plan', validationStart)
const planValidation = new Function(`${SRC.slice(validationStart, validationEnd)}; return planValidation`)()
const semanticStart = SRC.indexOf('function validatePlanSemantics(paths)')
const semanticEnd = SRC.indexOf('\n}\n\nconst semanticPlanError', semanticStart) + 2
const semanticValidator = new Function('plan', 'paths', 'fallbackRoute', 'log', `${SRC.slice(semanticStart, semanticEnd)}; return validatePlanSemantics(paths)`)
let f=0
let passed=0
const check=(name,ok,detail='')=>{console.log(`  ${ok?'ok  ':'FAIL'} ${name}${ok?'':`\n         ${detail}`}`);if(ok)passed++;else f++}
const validUnit={id:'one',title:'one',depends_on:[],files:['one.ts'],provides:[],consumes:[],removes:[],definition_of_done:'observable result',verify_command:'true'}
const validPlan={route:'parallel',route_reason:'independent files',workspace:'worktree',workspace_reason:'private roots',working_directory:'/tmp/repo',base_commit:'a'.repeat(40),reason:'two independent units',ignored_dependencies:[],units:[validUnit,{...validUnit,id:'two',files:['two.ts']}]}
check('valid private-worktree plan passes validation', planValidation(validPlan).length===0, JSON.stringify(planValidation(validPlan)))
check('shared-workspace plan is rejected rather than downgraded', planValidation({...validPlan,workspace:'shared'}).some((e)=>e.includes('workspace must be worktree')), JSON.stringify(planValidation({...validPlan,workspace:'shared'})))
check('worktree-safe unit ids reject path traversal', planValidation({...validPlan,units:[{...validUnit,id:'../escape'}]}).some((e)=>e.includes('worktree-safe')), JSON.stringify(planValidation({...validPlan,units:[{...validUnit,id:'../escape'}]})))
check('approved plans reject non-canonical working-directory aliases', planValidation({...validPlan,working_directory:'/tmp/repo/../repo'}).some((e)=>e.includes('canonical absolute')) && planValidation({...validPlan,working_directory:'/tmp/repo/'}).some((e)=>e.includes('canonical absolute')), JSON.stringify(planValidation({...validPlan,working_directory:'/tmp/repo/../repo'})))
check('approved plans reject symbolic or truncated base commits', planValidation({...validPlan,base_commit:'abc'}).some((e)=>e.includes('exact Git commit')) && planValidation({...validPlan,base_commit:` ${validPlan.base_commit}`}).some((e)=>e.includes('exact Git commit')), JSON.stringify(planValidation({...validPlan,base_commit:'abc'})))
check('approved plans reject aliased owned files', planValidation({...validPlan,units:[{...validUnit,files:['./one.ts']}]}).some((e)=>e.includes('invalid file ownership')), JSON.stringify(planValidation({...validPlan,units:[{...validUnit,files:['./one.ts']}]})))
check('approved plans reject duplicate ownership and self-dependencies', planValidation({...validPlan,units:[{...validUnit,depends_on:['one'],files:['one.ts','one.ts']}]}).filter((e)=>e.includes('self') || e.includes('repeats owned file')).length === 2, JSON.stringify(planValidation({...validPlan,units:[{...validUnit,depends_on:['one'],files:['one.ts','one.ts']}]})))
check('approved plans fail closed on a malformed units payload', planValidation({...validPlan,units:{}}).some((e)=>e.includes('non-empty array')), JSON.stringify(planValidation({...validPlan,units:{}})))

const routeSchema = SRC.slice(SRC.indexOf('route: {'), SRC.indexOf('route_reason:', SRC.indexOf('route: {')))
const decomposerPrompt = SRC.slice(SRC.indexOf('Split this work into units'), SRC.indexOf("  { label: 'decompose'"))
check('schema names the validator frontier rule and allows ordered contracts', routeSchema.includes('maximum reachable DAG frontier') && routeSchema.includes('concurrently-ready units have disjoint canonical ownership') && routeSchema.includes('ordered provider/consumer contracts are allowed') && !routeSchema.includes('no shared contract'), routeSchema)
check('decomposer prompt matches the frontier rule without a serial fallback contradiction', decomposerPrompt.includes('maximum reachable frontier width >= 2') && decomposerPrompt.includes('concurrently ready') && decomposerPrompt.includes('Ordered provider/consumer contracts are valid') && decomposerPrompt.includes('maximum frontier width one') && decomposerPrompt.includes('genuine ownership/contract') && !decomposerPrompt.includes('is safe, and an over-parallelised'), 'decomposer guidance drifted from the validator')

const routeStart = SRC.indexOf('const frontierLayers =')
const routeEnd = SRC.indexOf("if (plan.route !== 'parallel' || !plan.units || !plan.units.length)", routeStart)
const routeGate = SRC.slice(routeStart, routeEnd)
const measureRoute = async (plan) => {
  const result = await new Function('plan', 'canonicalPaths', `return (async () => {${routeGate}; return { width: planFrontierWidth, coupling: hasDeclaredCoupling }})()`).call(null, plan, new Map())
  return { ...result, width: result?.frontier_width ?? result?.width }
}
const independentUnits = [
  { id: 'a', files: ['a'], depends_on: [] },
  { id: 'b', files: ['b'], depends_on: [] },
  { id: 'c', files: ['c'], depends_on: ['b'] },
]
const chainUnits = [
  { id: 'a', files: ['a'], depends_on: [] },
  { id: 'b', files: ['b'], depends_on: ['a'] },
  { id: 'c', files: ['c'], depends_on: ['b'] },
]
const routeParallel = await measureRoute({ route: 'parallel', units: independentUnits })
const routeChain = await measureRoute({ route: 'parallel', units: chainUnits })
const routeSerial = await measureRoute({ route: 'serial', units: independentUnits })
const orderedEdgeUnits = [
  { id: 'a', files: ['a'], depends_on: [], provides: ['api.v1'] },
  { id: 'c', files: ['c'], depends_on: ['a'], consumes: ['api.v1'] },
  { id: 'b', files: ['b'], depends_on: [] },
]
const orderedEdgeParallel = await measureRoute({ route: 'parallel', units: orderedEdgeUnits })
check('parallel routing measures the widest reachable DAG frontier, not only initial roots', routeParallel.width === 2 && !routeParallel.error && routeParallel.coupling === false, JSON.stringify(routeParallel))
check('a width-one dependency chain is rejected for parallel fan-out', routeChain.width === 1 && routeChain.error?.includes('frontier width'), JSON.stringify(routeChain))
check('serial routing rejects independent frontier work', routeSerial.error?.includes('discard independent'), JSON.stringify(routeSerial))
check('serial routing remains allowed for coupled ownership', (await measureRoute({ route: 'serial', units: independentUnits.map((u) => ({ ...u, files: ['shared'] })) })).coupling === true, 'coupled route was rejected')
check('ordered provider and consumer work is serial only when it is the sole frontier', (await measureRoute({ route: 'serial', units: [{ id: 'provider', files: ['provider'], depends_on: [], provides: ['api.v1'] }, { id: 'consumer', files: ['consumer'], depends_on: ['provider'], consumes: ['api.v1'] }] })).error === undefined, 'single frontier chain was rejected')
check('a provider-consumer edge does not suppress an independent frontier unit', (await measureRoute({ route: 'serial', units: [{ id: 'a', files: ['a'], depends_on: [], provides: ['api.v1'] }, { id: 'c', files: ['c'], depends_on: ['a'], consumes: ['api.v1'] }, { id: 'b', files: ['b'], depends_on: [] }] })).error?.includes('discard independent'), 'independent B was not kept parallel with A')
check('parallel output permits an ordered provider-consumer edge beside an independent unit', orderedEdgeParallel.width === 2 && !orderedEdgeParallel.error && orderedEdgeParallel.coupling === false, JSON.stringify(orderedEdgeParallel))

const semanticPaths = (units) => new Map(units.flatMap((unit) => unit.files.map((file) => [`${unit.id}\0${file}`, { unit: unit.id, file, physical: `/tmp/repo/${file}`, identity: `path:/tmp/repo/${file}` }])))
const serialSemanticPlan = (units) => ({ route: 'serial', units, working_directory: '/tmp/repo', base_commit: 'a'.repeat(40) })
const semanticCases = [
  { name: 'dangling dependency', units: [{ id: 'a', files: ['a'], depends_on: ['missing'] }], expected: 'dependency ids' },
  { name: 'dependency cycle', units: [{ id: 'a', files: ['a'], depends_on: ['b'] }, { id: 'b', files: ['b'], depends_on: ['a'] }], expected: 'Dependency cycle' },
  { name: 'duplicate provider', units: [{ id: 'a', files: ['a'], depends_on: [], provides: ['api.v1'] }, { id: 'b', files: ['b'], depends_on: [], provides: ['api.v1'] }], expected: 'contract' },
  { name: 'invalid contract', units: [{ id: 'consumer', files: ['consumer'], depends_on: [], consumes: ['api.missing'] }], expected: 'contract' },
]
const semanticCall = SRC.indexOf('const semanticPlanError = validatePlanSemantics(canonicalPaths)')
const serialDispatch = SRC.indexOf("if (plan.route !== 'parallel' || !plan.units || !plan.units.length)")
const earlySemanticCall = SRC.indexOf('const earlySemanticPlanError = validatePlanSemantics(lexicalPaths)')
const pathOwnershipGate = SRC.indexOf('const ownedPathCheck = await pathCheck(plan)')
check('semantic preflight executes before path gates and either route dispatch branch', earlySemanticCall >= 0 && earlySemanticCall < pathOwnershipGate && semanticCall >= 0 && semanticCall < serialDispatch, `early=${earlySemanticCall} path_gate=${pathOwnershipGate} late=${semanticCall} serial_dispatch=${serialDispatch}`)
const preRouteGuard = SRC.slice(SRC.indexOf('const lexicalPaths ='), pathOwnershipGate)
const runPreRouteGuard = new Function('plan', 'validatePlanSemantics', 'pathCheck', `return (async () => {${preRouteGuard}; const ownedPathCheck = await pathCheck(plan); return { path_gate_reached: true, ownedPathCheck }})()`)
for (const testCase of semanticCases) {
  const plan = serialSemanticPlan(testCase.units)
  let pathGateCalls = 0
  let canonicalMutations = 0
  const result = await runPreRouteGuard(plan, (paths) => semanticValidator(plan, paths, 'serial fallback', () => {}), async () => {
    pathGateCalls++
    canonicalMutations++
    return { status: 'ready', paths: [] }
  })
  // Execute the same pre-route guard used by the workflow: malformed serial
  // plans must return before even the ownership gate, which is the first
  // possible side effect before worktree/Luna dispatch or canonical mutation.
  const blocked = Boolean(result && result.error && result.error.toLowerCase().includes(testCase.expected.toLowerCase())) && pathGateCalls === 0 && canonicalMutations === 0
  check(`malformed serial ${testCase.name} blocks dispatch and mutation`, blocked, JSON.stringify(result))
}
const coupledSerialUnits = [{ id: 'a', files: ['shared'], depends_on: [] }, { id: 'b', files: ['shared'], depends_on: [] }]
check('legitimate serial ownership coupling survives semantic preflight', semanticValidator(serialSemanticPlan(coupledSerialUnits), semanticPaths(coupledSerialUnits), 'serial fallback', () => {}) === null)

const branchStart = SRC.indexOf("if (plan.route !== 'parallel' || !plan.units || !plan.units.length)")
const branchEnd = SRC.indexOf('// Scheduler graph setup follows route dispatch', branchStart)
const serialBranch = SRC.slice(branchStart, branchEnd)
const fakeUnits = [
  { id: 'one', title: 'one', files: ['shared'], definition_of_done: 'done one', verify_command: 'test -f one.done' },
  { id: 'two', title: 'two', files: ['shared'], definition_of_done: 'done two', verify_command: 'test -f two.done' },
]
const testInvocationNonce = 'a'.repeat(64)
const testPlanHash = 'b'.repeat(64)
const testToken = 'c'.repeat(64)
const frozenHead = 'a'.repeat(40)
const frozenTree = 'b'.repeat(64)
const runSerial = async (snapshot = { fingerprint: frozenTree, current_head: frozenHead }, resultStatus = 'green') => {
  const plan = { route: 'serial', units: fakeUnits, ignored_dependencies: [], reason: 'coupled', working_directory: '/tmp/repo', base_commit: frozenHead, working_tree_fingerprint: frozenTree }
  const calls = []
  const agent = async (prompt, options) => {
    calls.push({ ...options, prompt })
    if (options.label === 'build:serial-prepare-worktree') return { status: 'ready', root: '/tmp/claude-build-worktrees.test', token: testToken, invocation_nonce: testInvocationNonce, plan_hash: testPlanHash, path: '/tmp/claude-build-worktrees.test/serial', seed: '0123456789012345678901234567890123456789' }
    if (options.label === 'build:serial-integrate') return { status: 'integrated' }
    if (options.label === 'build:serial-cleanup') return { status: 'cleaned' }
    return { status: resultStatus, summary: resultStatus === 'green' ? 'ok' : 'gate failed', verify_output: resultStatus === 'green' ? undefined : 'aggregate gate exited 1' }
  }
  const approvalSnapshot = async () => snapshot
  const snapshotMatches = (p, s) => Boolean(s && s.fingerprint === p.working_tree_fingerprint && s.current_head === p.base_commit)
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`
  const wrapped = new Function('plan', 'task', 'build', 'log', 'phase', 'agent', 'UNIT', 'approvalSnapshot', 'snapshotMatches', 'shellQuote', 'INTEGRATION_RESULT', 'invocationNonce', 'frozenPlanHash', `return (async () => {${serialBranch}})()`)
  const out = await wrapped(plan, 'serial test', false, () => {}, () => {}, agent, { type: 'object' }, approvalSnapshot, snapshotMatches, shellQuote, { type: 'object' }, testInvocationNonce, testPlanHash)
  return { out, calls }
}
const serial = await runSerial()
  const serialPrompt = serial.calls.find((c) => c.label === 'build:serial')?.prompt || ''
  const serialOk = serial.out?.route === 'serial' && serial.out?.built === true && serial.out?.units_green === 2 && serial.out?.cleanup?.status === 'cleaned' && serial.calls.filter((c) => c.label === 'build:serial').length === 1 && serial.calls.find((c) => c.label === 'build:serial')?.agentType === 'implementer' && serialPrompt.includes("set -e\n(cd '/tmp/claude-build-worktrees.test/serial' && test -f one.done)\n(cd '/tmp/claude-build-worktrees.test/serial' && test -f two.done)")
console.log(`  ${serialOk ? 'ok  ' : 'FAIL'} serial build uses one isolated Luna implementer and integrates only after cleanup${serialOk ? '' : `\n         ${JSON.stringify(serial)}`}`)
if (serialOk) passed++; else f++
const failedSerial = await runSerial(undefined, 'failed')
const failedSerialOk = failedSerial.out?.units_green === 0 && failedSerial.out?.integration === undefined && failedSerial.out?.cleanup?.status === 'cleaned'
console.log(`  ${failedSerialOk ? 'ok  ' : 'FAIL'} serial aggregate gate failure prevents integration while still cleaning its worktree${failedSerialOk ? '' : `\n         ${JSON.stringify(failedSerial)}`}`)
if (failedSerialOk) passed++; else f++
const drifted = await runSerial({ fingerprint: 'changed-tree', current_head: frozenHead })
const driftOk = drifted.out?.units_green === 0 && !drifted.calls.some((c) => c.label === 'build:serial') && drifted.out?.needs_attention?.[0]?.status === 'blocked'
console.log(`  ${driftOk ? 'ok  ' : 'FAIL'} serial final snapshot drift blocks the Luna dispatch${driftOk ? '' : `\n         ${JSON.stringify(drifted)}`}`)
if (driftOk) passed++; else f++

const serialRoot = '/tmp/claude-build-worktrees.test/serial'
mkdirSync(serialRoot, { recursive: true })
const isolatedGate = `set -e\n(cd ${serialRoot} && cd / && :)\n(cd ${serialRoot} && test "$PWD" = '${serialRoot}')`
let isolatedGateCode = 0
try { execFileSync('bash', ['-c', isolatedGate], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { isolatedGateCode = error.status || 1 }
check('serial gate commands each start from the exact private root despite cwd changes', isolatedGateCode === 0, `status=${isolatedGateCode}`)
const earlyExitGate = `set -e\n(cd ${serialRoot} && exit 17)\n(cd ${serialRoot} && touch should-not-run)`
let earlyExitCode = 0
try { execFileSync('bash', ['-c', earlyExitGate], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { earlyExitCode = error.status || 1 }
check('serial gate stops immediately when one exact subshell exits nonzero', earlyExitCode === 17, `status=${earlyExitCode}`)
rmSync(serialRoot, { recursive: true, force: true })
console.log(`  ---- ${passed} passed, ${f} failed`)
process.exit(f?1:0)
