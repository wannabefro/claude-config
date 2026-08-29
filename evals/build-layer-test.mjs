import { readFileSync } from 'node:fs'
const SRC = readFileSync(new URL('../workflows/build-parallel.js', import.meta.url), 'utf8')
const sl = (a,b)=>{const i=SRC.indexOf(a),j=SRC.indexOf(b,i);if(i<0||j<0)throw new Error(a);return SRC.slice(i,j)}
const depthBlk = sl('const depth = new Map()','const startable')
const rawSchedBlk = sl('const scheduled = new Map()','let results')
const lockStart = rawSchedBlk.indexOf('const canonicalLock')
const refreshStart = rawSchedBlk.indexOf('const ignoredDependencyArgs')
const runStart = rawSchedBlk.indexOf('const runUnit')
const schedBlk = rawSchedBlk.slice(0, lockStart) + rawSchedBlk.slice(lockStart, refreshStart) + rawSchedBlk.slice(runStart)

// 12 units across a dependency graph — this exercises the hard worker ceiling
// while proving independent worker calls overlap in separate private roots.
const units=[
 {id:'a',depends_on:[],files:['a']},{id:'b',depends_on:[],files:['b']},
 {id:'c',depends_on:['b'],files:['c']},{id:'d',depends_on:['a'],files:['d']},
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
  const workerStarts = new Map(), workerFinishes = new Map()
  let active=0, maxActive=0, integrationActive=0, maxIntegrationActive=0
  let refreshActive=0, maxRefreshActive=0, writerActive=0, canonicalVersion=0, refreshObservedWriter=false
  const refreshSnapshots=[]
  const agent=async(p,o)=>{
    if (o.label.startsWith('build:')) {
      const id=o.label.slice('build:'.length)
      workerStarts.set(id, Date.now())
      active++; maxActive=Math.max(maxActive,active)
      await new Promise(r=>setTimeout(r,id==='a'?120:12))
      workerFinishes.set(id, Date.now())
      active--; dispatched.push({label:o.label,prompt:p}); return {status:'green',summary:'ok'}
    }
    return {status:'green',summary:'ok'}
  }
  const unitWorktrees=new Map(units.map(u=>[u.id,{path:`/tmp/private/${u.id}`,seed:`seed-${u.id}`}]))
  const hooks={
    refresh:async(u)=>{
      refreshActive++; maxRefreshActive=Math.max(maxRefreshActive,refreshActive)
      const start=canonicalVersion
      await new Promise(r=>setTimeout(r,20))
      const end=canonicalVersion
      if(writerActive>0) refreshObservedWriter=true
      refreshSnapshots.push({id:u.id,start,end})
      refreshActive--
      return {status:'ready'}
    },
    integrate:async(u)=>{
      if(refreshActive>0) refreshObservedWriter=true
      writerActive++; integrationActive++; maxIntegrationActive=Math.max(maxIntegrationActive,integrationActive)
      canonicalVersion++
      await new Promise(r=>setTimeout(r,8))
      integrated.push(u.id)
      integrationActive--; writerActive--
      return {status:'integrated'}
    },
  }
  const body = depthBlk + "\n" + schedBlk + `\nconst refreshUnit=(u,_state)=>canonicalLock.read(async()=>hooks.refresh(u))
const integrateUnit=(u,_state)=>canonicalLock.write(async()=>hooks.integrate(u))` + "\nreturn Promise.all(plan.units.map(runUnit))"
  // UNIT is the result schema the real module defines outside this slice. Without
  // it the agent call throws ReferenceError, the try/catch swallows it, and every
  // unit reports `error` while still looking "reached" — which is exactly how the
  // first version of this test passed while dispatching nothing.
  const fn=new Function('plan','byId','depsOf','log','agent','UNIT','unitWorktrees','hooks', body)
  const results=await fn(plan,byId,depsOf,()=>{},agent,{type:'object'},unitWorktrees,hooks)
  return {
    deferred: results.filter(r=>r.status==='deferred').map(r=>r.unit.id).sort().join(),
    reached:  results.filter(r=>r.status!=='deferred').map(r=>r.unit.id).sort().join(),
    green:    results.filter(r=>r.status==='green').map(r=>r.unit.id).sort().join(),
    errored:  results.filter(r=>r.status==='error').map(r=>r.unit.id+':'+r.error).join(' | '),
    dispatched,
    integrated,
    maxActive,
    workerStarts: Object.fromEntries(workerStarts),
    workerFinishes: Object.fromEntries(workerFinishes),
    maxIntegrationActive,
    maxRefreshActive,
    refreshSnapshots,
    refreshObservedWriter,
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
check('dependent work begins after its own predecessors integrate, not after unrelated work',
  Object.entries(units.reduce((edges,u)=>{edges[u.id]=u.depends_on;return edges},{})).every(([id,deps])=>deps.every(dep=>result.integrated.indexOf(dep) >= 0 && result.workerStarts[id] >= result.workerFinishes[dep])), JSON.stringify(result))
check('a dependent starts before an unrelated slow unit finishes',
  result.workerStarts.c < result.workerFinishes.a && result.workerStarts.c > result.workerFinishes.b, JSON.stringify(result))
check('integration follows completion order rather than deterministic head-of-line order',
  result.integrated.indexOf('b') < result.integrated.indexOf('a'), JSON.stringify(result.integrated))
check('canonical integration never overlaps', result.maxIntegrationActive === 1, `max integration active=${result.maxIntegrationActive}`)
check('independent refresh snapshots overlap while integrations remain exclusive', result.maxRefreshActive >= 2 && !result.refreshObservedWriter, JSON.stringify(result))
check('every refresh observes one stable canonical version', result.refreshSnapshots.length === units.length && result.refreshSnapshots.every((snapshot)=>snapshot.start===snapshot.end), JSON.stringify(result.refreshSnapshots))

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
