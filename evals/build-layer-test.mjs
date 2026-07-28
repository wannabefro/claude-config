import { readFileSync } from 'node:fs'
const SRC = readFileSync('/Users/sam/.claude/workflows/build-parallel.js', 'utf8')
const sl = (a,b)=>{const i=SRC.indexOf(a),j=SRC.indexOf(b,i);if(i<0||j<0)throw new Error(a);return SRC.slice(i,j)}
const depthBlk = sl('const depth = new Map()','const startable')
const schedBlk = sl('// Only depth-1 is actually buildable.','const results = await Promise.all')

// 8 units: 2 roots, 6 at depth>=2 — the shape from the reported run
const units=[
 {id:'a',depends_on:[],files:['a']},{id:'b',depends_on:[],files:['b']},
 {id:'c',depends_on:['a'],files:['c']},{id:'d',depends_on:['a'],files:['d']},
 {id:'e',depends_on:['b'],files:['e']},{id:'f',depends_on:['c'],files:['f']},
 {id:'g',depends_on:['c','e'],files:['g']},{id:'h',depends_on:['g'],files:['h']},
]
const plan={units}, byId=new Map(units.map(u=>[u.id,u]))
const depsOf=u=>(u.depends_on||[]).filter(d=>byId.has(d))
const log=()=>{}
let dispatched=[]
const agent=async(p,o)=>{dispatched.push(o.label);return{status:'green',summary:'ok'}}
const body = depthBlk + "\n" + schedBlk + "\nreturn Promise.all(plan.units.map(runUnit))"
const fn=new Function('plan','byId','depsOf','log','agent','scheduled', body)
const results=await fn(plan,byId,depsOf,log,agent,new Map())
const deferredIds=results.filter(r=>r.status==='deferred').map(r=>r.unit.id).sort()
const reached =results.filter(r=>r.status!=='deferred').map(r=>r.unit.id).sort()
console.log(`  reached the builder : ${reached.join(',')}`)
console.log(`  deferred            : ${deferredIds.join(',')}`)
const ok = reached.join()==='a,b' && deferredIds.join()==='c,d,e,f,g,h'
console.log(`  ${ok?'ok  ':'FAIL'} only depth-1 reaches the builder; all 6 deeper units deferred`)
process.exit(ok?0:1)
