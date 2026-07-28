import { readFileSync } from 'node:fs'
const SRC = readFileSync(new URL('../workflows/build-parallel.js', import.meta.url), 'utf8')
const sl = (a,b)=>{const i=SRC.indexOf(a),j=SRC.indexOf(b,i);if(i<0||j<0)throw new Error(a);return SRC.slice(i,j)}
const depthBlk = sl('const depth = new Map()','const startable')
const schedBlk = sl('// Depth limiting applies to WORKTREES ONLY','const results = await Promise.all')

// 8 units: 2 roots, 6 at depth>=2 — the shape from the reported run
const units=[
 {id:'a',depends_on:[],files:['a']},{id:'b',depends_on:[],files:['b']},
 {id:'c',depends_on:['a'],files:['c']},{id:'d',depends_on:['a'],files:['d']},
 {id:'e',depends_on:['b'],files:['e']},{id:'f',depends_on:['c'],files:['f']},
 {id:'g',depends_on:['c','e'],files:['g']},{id:'h',depends_on:['g'],files:['h']},
]

// The scheduler is exercised twice against the SAME graph, because the whole
// point of the change is that workspace choice — not graph shape — decides how
// much of the DAG is reachable in one pass.
const run = async (useWorktrees) => {
  const plan={units}, byId=new Map(units.map(u=>[u.id,u]))
  const depsOf=u=>(u.depends_on||[]).filter(d=>byId.has(d))
  const dispatched=[]
  const agent=async(p,o)=>{dispatched.push({label:o.label,isolation:o.isolation});return{status:'green',summary:'ok'}}
  const body = depthBlk + "\n" + schedBlk + "\nreturn Promise.all(plan.units.map(runUnit))"
  // UNIT is the result schema the real module defines outside this slice. Without
  // it the agent call throws ReferenceError, the try/catch swallows it, and every
  // unit reports `error` while still looking "reached" — which is exactly how the
  // first version of this test passed while dispatching nothing.
  const fn=new Function('plan','byId','depsOf','log','agent','scheduled','useWorktrees','UNIT', body)
  const results=await fn(plan,byId,depsOf,()=>{},agent,new Map(),useWorktrees,{type:'object'})
  return {
    deferred: results.filter(r=>r.status==='deferred').map(r=>r.unit.id).sort().join(),
    reached:  results.filter(r=>r.status!=='deferred').map(r=>r.unit.id).sort().join(),
    green:    results.filter(r=>r.status==='green').map(r=>r.unit.id).sort().join(),
    errored:  results.filter(r=>r.status==='error').map(r=>r.unit.id+':'+r.error).join(' | '),
    dispatched,
  }
}

let pass=0, fail=0
const check=(name,cond,detail)=>{cond?pass++:fail++;console.log(`  ${cond?'ok  ':'FAIL'} ${name}${cond?'':`\n         ${detail}`}`)}

const wt = await run(true)
console.log(`  worktree — reached: ${wt.reached||'(none)'} | deferred: ${wt.deferred||'(none)'}`)
check('worktree: only depth-1 reaches the builder, 6 deeper units deferred',
  wt.reached==='a,b' && wt.deferred==='c,d,e,f,g,h', `got reached=${wt.reached} deferred=${wt.deferred}`)
check('worktree: dispatched units actually run (no swallowed error)', !wt.errored, wt.errored)
check('worktree: every dispatched unit asks for isolation',
  wt.dispatched.length>0 && wt.dispatched.every(d=>d.isolation==='worktree'),
  JSON.stringify(wt.dispatched))

const sh = await run(false)
console.log(`  shared   — reached: ${sh.reached||'(none)'} | deferred: ${sh.deferred||'(none)'}`)
// The deferral existed only because a worktree cannot contain a sibling's work.
// A shared checkout can, so the entire graph must build in one pass.
check('shared: the whole DAG builds in one pass, nothing deferred',
  sh.reached==='a,b,c,d,e,f,g,h' && sh.deferred==='', `got reached=${sh.reached} deferred=${sh.deferred}`)
check('shared: all 8 units go green (no swallowed error)', sh.green==='a,b,c,d,e,f,g,h', sh.errored||sh.green)
check('shared: no unit requests isolation',
  sh.dispatched.length===8 && sh.dispatched.every(d=>d.isolation===undefined),
  JSON.stringify(sh.dispatched))
// Ordering still has to hold: a dependant must not be dispatched before its
// predecessor returned green, or the shared tree buys nothing.
const order = sh.dispatched.map(d=>d.label)
check('shared: dependants dispatch after their predecessors',
  order.indexOf('build:c') > order.indexOf('build:a') &&
  order.indexOf('build:g') > order.indexOf('build:e') &&
  order.indexOf('build:h') > order.indexOf('build:g'), order.join(' '))

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
