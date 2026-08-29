import { readFileSync } from 'node:fs'
const SRC = readFileSync(new URL('../workflows/build-parallel.js', import.meta.url), 'utf8')
const sl = (a,b)=>{const i=SRC.indexOf(a),j=SRC.indexOf(b,i);if(i<0||j<0)throw new Error(a);return SRC.slice(i,j)}
const depthBlk = sl('const depth = new Map()','const startable')
const rawSchedBlk = sl('const scheduled = new Map()','let results')
const helperStart = rawSchedBlk.indexOf('const serializeIntegration')
const integrationStart = rawSchedBlk.indexOf('const integrationTurns')
const refreshStart = rawSchedBlk.indexOf('const refreshUnit')
const runStart = rawSchedBlk.indexOf('const runUnit')
const schedBlk = rawSchedBlk.slice(0, helperStart) + rawSchedBlk.slice(integrationStart, refreshStart) + rawSchedBlk.slice(runStart)

// 12 units across a dependency graph — this exercises the hard worker ceiling
// while proving independent worker calls overlap in separate private roots.
const units=[
 {id:'a',depends_on:[],files:['a']},{id:'b',depends_on:[],files:['b']},
 {id:'c',depends_on:['a'],files:['c']},{id:'d',depends_on:['a'],files:['d']},
 {id:'e',depends_on:['b'],files:['e']},{id:'f',depends_on:['c'],files:['f']},
 {id:'g',depends_on:['c','e'],files:['g']},{id:'h',depends_on:['g'],files:['h']},
 {id:'i',depends_on:[],files:['i']},{id:'j',depends_on:[],files:['j']},
 {id:'k',depends_on:[],files:['k']},{id:'l',depends_on:[],files:['l']},
]

const run = async () => {
  const plan={units}, byId=new Map(units.map(u=>[u.id,u]))
  const depsOf=u=>(u.depends_on||[]).filter(d=>byId.has(d))
  const dispatched=[]
  const integrated=[]
  let active=0, maxActive=0
  const agent=async(p,o)=>{active++; maxActive=Math.max(maxActive,active); await new Promise(r=>setTimeout(r,20)); active--; dispatched.push({label:o.label,prompt:p});return{status:'green',summary:'ok'}}
  const unitWorktrees=new Map(units.map(u=>[u.id,{path:`/tmp/private/${u.id}`,seed:`seed-${u.id}`}]))
  const refreshUnit=async (_u,_state)=>({status:'ready'})
  const integrateUnit=async (u,_state)=>{integrated.push(u.id); return {status:'integrated'}}
  const body = depthBlk + "\n" + schedBlk + "\nreturn Promise.all(plan.units.map(runUnit))"
  // UNIT is the result schema the real module defines outside this slice. Without
  // it the agent call throws ReferenceError, the try/catch swallows it, and every
  // unit reports `error` while still looking "reached" — which is exactly how the
  // first version of this test passed while dispatching nothing.
  const fn=new Function('plan','byId','depsOf','log','agent','UNIT','unitWorktrees','refreshUnit','integrateUnit', body)
  const results=await fn(plan,byId,depsOf,()=>{},agent,{type:'object'},unitWorktrees,refreshUnit,integrateUnit)
  return {
    deferred: results.filter(r=>r.status==='deferred').map(r=>r.unit.id).sort().join(),
    reached:  results.filter(r=>r.status!=='deferred').map(r=>r.unit.id).sort().join(),
    green:    results.filter(r=>r.status==='green').map(r=>r.unit.id).sort().join(),
    errored:  results.filter(r=>r.status==='error').map(r=>r.unit.id+':'+r.error).join(' | '),
    dispatched,
    integrated,
    maxActive,
  }
}

let pass=0, fail=0
const check=(name,cond,detail)=>{cond?pass++:fail++;console.log(`  ${cond?'ok  ':'FAIL'} ${name}${cond?'':`\n         ${detail}`}`)}

const result = await run()
console.log(`  private worktree scheduler — reached: ${result.reached||'(none)'}`)
check('every unit runs or is dependency-gated without swallowed errors',
  result.reached==='a,b,c,d,e,f,g,h,i,j,k,l' && result.deferred==='' && !result.errored, JSON.stringify(result))
check('at least two independent worker calls overlap physically',
  result.maxActive >= 2 && result.dispatched.filter(d=>d.label.startsWith('build:')).length===12,
  `max active=${result.maxActive}`)
check('scheduler never exceeds three active Luna workers', result.maxActive <= 3, `max active=${result.maxActive}`)
check('worker prompts carry distinct exact private worktree roots',
  new Set(result.dispatched.filter(d=>d.label.startsWith('build:')).map(d=>d.prompt.match(/EXACT PRIVATE WORKTREE\): ([^\n]+)/)?.[1])).size===12,
  JSON.stringify(result.dispatched))
const order = result.dispatched.map(d=>d.label)
check('dependency workers begin only after predecessors integrate',
  order.indexOf('build:c') > order.indexOf('build:a') && order.indexOf('build:g') > order.indexOf('build:e') && order.indexOf('build:h') > order.indexOf('build:g'), order.join(' '))
check('canonical integration is serial and reproducible after worker overlap',
  result.integrated.join(',')==='a,b,i,j,k,l,c,d,e,f,g,h', JSON.stringify(result.integrated))

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
