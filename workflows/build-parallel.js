export const meta = {
  name: 'build-parallel',
  description: 'Decompose work into independently-verifiable units, build them concurrently in isolated worktrees behind executable done-criteria, and report a merge plan',
  whenToUse: 'The default execution path once a plan is approved. Send work here first and let the decomposer decide: it returns decomposable:false for coupled changes, same-file edits and broad refactors, which is a real answer, not a failure — build those serially instead. Only skip it when you already know the work is coupled.',
  phases: [
    { title: 'Decompose', detail: 'Opus splits the work into units with executable done-criteria' },
    { title: 'Build', detail: 'each unit starts as soon as its own dependencies are green, in an isolated worktree' },
    { title: 'Integrate', detail: 'merge sequence in dependency order — no automatic merging' },
  ],
}

// There is deliberately no Verify phase. Verification is the implementer's own
// gate — it must see its verify_command exit 0 before reporting green — so a
// separate phase would either duplicate that or lie about it. `meta` used to
// declare one ("one repair attempt") that no code implemented: the progress UI
// showed an empty group and the metadata promised a retry that never existed.

// The inner-loop gate is an EXECUTABLE done-criterion per unit, not a review.
// Reviews belong in the outer loop (council-review), run once on the assembled
// diff. Running a review per unit is what makes parallel building slower than
// serial building, so it is deliberately absent here.

const PLAN = {
  type: 'object',
  required: ['decomposable', 'reason', 'units'],
  properties: {
    decomposable: { type: 'boolean', description: 'false if the work is genuinely coupled and should be built serially instead' },
    reason: { type: 'string', description: 'Why it does or does not decompose — specific, not generic' },
    units: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'depends_on', 'mechanical', 'files', 'definition_of_done', 'verify_command'],
        properties: {
          id: { type: 'string', description: 'short kebab-case slug' },
          title: { type: 'string' },
          // Replaced `wave` (a single integer) on 2026-07-27. One number was doing
          // three jobs — file-conflict grouping, logical ordering, and execution
          // barrier — and the executor read it as a GLOBAL barrier, so every unit
          // waited on every unit of the previous wave rather than on its own
          // predecessors. Measured on a real 12-unit decomposition: 6 waves, peak
          // concurrency 4 of 12, three waves holding a single unit, while only 3 of
          // 52 files were actually contested.
          depends_on: {
            type: 'array',
            items: { type: 'string' },
            description: 'ids of units that MUST be finished before this one starts. Empty array if none. List only real dependencies — every id here delays this unit, and a dependency added "to be safe" costs parallelism for nothing. Two units that merely touch the same file are NOT dependent; that is caught separately.',
          },
          mechanical: { type: 'boolean', description: 'true if the change is rote — rename, boilerplate, pattern already obvious. Routed to a cheaper tier.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative files this unit owns. Two units that could run concurrently must not share a file — either add a dependency between them or merge them.' },
          definition_of_done: { type: 'string', description: 'Observable behaviour that must hold when finished' },
          verify_command: { type: 'string', description: 'A single shell command that exits 0 exactly when this unit is done. Scoped to this unit — not the whole suite.' },
          notes: { type: 'string' },
        },
      },
    },
  },
}

const UNIT = {
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { enum: ['green', 'failed', 'blocked'] },
    summary: { type: 'string', description: 'What was actually changed' },
    files_changed: { type: 'array', items: { type: 'string' } },
    verify_output: { type: 'string', description: 'The tail of the verify command output, and its exit code' },
    branch: { type: 'string', description: 'Branch the work is on, if a worktree was used' },
    remaining: { type: 'string', description: 'Anything deliberately not done, and why' },
  },
}

// args arrives either as an object or as a JSON-encoded string depending on the
// call shape. Taking `typeof args === 'string'` to mean "this is the task" made
// a stringified object become the task text AND silently drop every flag on it —
// which once turned an intended dry run into a real fan-out. Parse defensively.
let opts = args
if (typeof opts === 'string') {
  const trimmed = opts.trim()
  if (trimmed.startsWith('{')) {
    try {
      opts = JSON.parse(trimmed)
    } catch {
      return { error: 'args looked like JSON but did not parse. Pass an object, or a plain task string.' }
    }
  } else {
    opts = { task: opts }
  }
}
opts = opts || {}

const task = String(opts.task || '').trim()
if (!task) {
  return { error: 'build-parallel needs a task, plan path, or feature description as args.' }
}

// Decomposition is the ceiling on everything downstream, is cheap to inspect,
// and is expensive to discover was wrong after N agents have written code — so
// reporting the plan is the DEFAULT and fanning out is the opt-in. The reverse
// default commits writers to a decomposition nobody has read.
const build = opts.build === true

phase('Decompose')
log('Decomposing — the ceiling on parallel speed is decomposition quality, so this runs on Opus')

const plan = await agent(
  `Split this work into units that can be built CONCURRENTLY by separate agents without colliding.

WORK: ${task}

If a plan document is referenced, read it. Read enough of the codebase to know which files each unit
would touch — a decomposition based on guessed file boundaries is worse than no decomposition,
because it produces merge conflicts that cost more than the parallelism saves.

Rules for a unit:
- \`depends_on\` lists ONLY the units that must genuinely finish first — because this unit reads code
  the other one creates, or edits a file the other one owns. **Every id you add delays this unit and
  everything downstream of it.** A dependency added "to keep things tidy" or "to be safe" costs real
  parallelism and buys nothing. Units with no true predecessor get \`depends_on: []\` and all start at
  once, which is the point.
- Do NOT encode a preferred reading order or a sense of logical sequence as a dependency. If unit B
  could compile, run and pass its own verify_command with unit A absent, B does not depend on A.
- Two units that could run CONCURRENTLY (neither reachable from the other through depends_on) must
  not share a file. If they must share one, either add a real dependency between them or merge them
  into a single unit.
- **Each unit is built in its own isolated git worktree, and its verify_command runs THERE, before
  anything is merged.** Two consequences, and getting either wrong makes a unit fail its own gate for
  reasons that have nothing to do with its work:
    · Use repo-relative paths (\`rules/foo.md\`), never absolute ones. An absolute path escapes the
      worktree and tests the untouched original checkout instead of the unit's edits.
    · A unit's verify must be satisfiable from THAT UNIT'S changes alone. Never assert a cross-unit
      invariant — a total across files other units own, a count over the whole tree, a link into a
      file another unit creates. Those are true only after the merge, so they cannot pass in any
      single worktree. If a check like that matters, say so in \`notes\` as a post-merge step; do not
      dress it up as a unit.
- Every unit needs a \`verify_command\`: one shell command that exits 0 exactly when the unit is done
  and non-zero when it is not. A scoped test, a targeted typecheck — not the whole suite, which would
  fail for reasons unrelated to this unit. **If you cannot write such a command for a unit, that unit
  is not safe to build in parallel** — say so rather than inventing a weak command like \`echo ok\`.
- Mark \`mechanical: true\` only when the change is genuinely rote and the pattern is already obvious.

**Returning decomposable:false is a valid and valuable answer.** Tightly coupled changes, same-file
edits, and refactors that touch everything do NOT decompose. Say so plainly and explain why; forcing
a fan-out on coupled work is strictly worse than building it serially.`,
  { label: 'decompose', phase: 'Decompose', model: 'opus', effort: 'high', schema: PLAN }
)

if (!plan) return { error: 'Decomposition failed — no plan returned.' }
if (!plan.decomposable || !plan.units || !plan.units.length) {
  log('Not decomposable — recommending serial build')
  return {
    decomposable: false,
    reason: plan.reason,
    recommendation: 'Build this serially: a single implementer, or the main thread if the reasoning is coupled. Fanning it out would cost more in merge conflicts than it saves.',
  }
}

// Ids must be unique BEFORE anything is keyed by them. The scheduler memoises a
// promise per id, so two units sharing an id collapse into a single build while
// still being counted twice — the run reports units_green including a unit that
// never ran, and hands back a merge_sequence naming a branch that does not
// exist. The wave loop mapped over unit objects and so tolerated duplicates;
// keying by id is what made this reachable, so it is checked here.
const idCounts = new Map()
for (const u of plan.units) idCounts.set(u.id, (idCounts.get(u.id) || 0) + 1)
const duplicates = [...idCounts].filter(([, n]) => n > 1).map(([id, n]) => ({ id, count: n }))
if (duplicates.length) {
  return {
    error: 'Decomposition emitted duplicate unit ids.',
    duplicates,
    recommendation: 'Re-run; ids must be unique because dependencies and scheduling are keyed on them.',
    plan,
  }
}

const byId = new Map(plan.units.map((u) => [u.id, u]))
const depsOf = (u) => (u.depends_on || []).filter((d) => d !== u.id)

// A dependency on a unit that does not exist would silently never resolve, so
// the scheduler would wait on it forever. Catch it before anything is built.
const dangling = []
for (const u of plan.units) {
  for (const d of depsOf(u)) if (!byId.has(d)) dangling.push({ unit: u.id, missing: d })
}
if (dangling.length) {
  return {
    error: 'Decomposition references dependency ids that are not units.',
    dangling,
    recommendation: 'Re-run; the decomposer named a dependency it did not emit as a unit.',
    plan,
  }
}

// A cycle would deadlock the scheduler — each unit waiting on the other — which
// presents as a hang rather than an error. Refuse up front.
const CYCLE_MARK = { visiting: 1, done: 2 }
const mark = new Map()
const cycles = []
const walk = (id, trail) => {
  if (mark.get(id) === CYCLE_MARK.done) return
  if (mark.get(id) === CYCLE_MARK.visiting) {
    cycles.push([...trail.slice(trail.indexOf(id)), id].join(' -> '))
    return
  }
  mark.set(id, CYCLE_MARK.visiting)
  for (const d of depsOf(byId.get(id))) walk(d, [...trail, id])
  mark.set(id, CYCLE_MARK.done)
}
for (const u of plan.units) walk(u.id, [])
if (cycles.length) {
  return {
    error: 'Dependency cycle — the units cannot be ordered.',
    cycles: [...new Set(cycles)],
    recommendation: 'Re-run with the cycle merged into one unit, or the false dependency removed.',
    plan,
  }
}

// Transitive closure: ancestors[id] is everything that must land before id.
// Two units may run at the same time iff neither is an ancestor of the other,
// and it is exactly those pairs that must not share a file. The old check asked
// "same wave?", which both missed concurrent units in different waves and
// flagged ordered units that were never actually concurrent.
const ancestors = new Map()
const ancestorsOf = (id) => {
  if (ancestors.has(id)) return ancestors.get(id)
  const acc = new Set()
  ancestors.set(id, acc) // set before recursing; the graph is already acyclic
  for (const d of depsOf(byId.get(id))) {
    acc.add(d)
    for (const a of ancestorsOf(d)) acc.add(a)
  }
  return acc
}
for (const u of plan.units) ancestorsOf(u.id)
const ordered = (a, b) => ancestorsOf(a).has(b) || ancestorsOf(b).has(a)

const owners = new Map()
for (const u of plan.units) {
  for (const f of (u.files || [])) {
    if (!owners.has(f)) owners.set(f, [])
    owners.get(f).push(u.id)
  }
}
const conflicts = []
for (const [file, ids] of owners) {
  for (let i = 0; i < ids.length; i++) {
    for (let k = i + 1; k < ids.length; k++) {
      if (!ordered(ids[i], ids[k])) conflicts.push({ file, units: [ids[i], ids[k]] })
    }
  }
}
if (conflicts.length) {
  log(`${conflicts.length} concurrent file overlap(s) — refusing to fan out into a guaranteed conflict`)
  return {
    error: 'Units that can run concurrently share files.',
    conflicts,
    recommendation: 'Re-run with the overlapping units merged, or a real dependency declared between them.',
    plan,
  }
}

// Depth is derived from the graph, for reporting and merge order only — it never
// gates execution. This is the number to watch: if it tracks the unit count, the
// decomposer is still emitting a chain rather than a graph.
const depth = new Map()
const depthOf = (id) => {
  if (depth.has(id)) return depth.get(id)
  const ds = depsOf(byId.get(id))
  const v = ds.length ? 1 + Math.max(...ds.map(depthOf)) : 1
  depth.set(id, v)
  return v
}
for (const u of plan.units) depthOf(u.id)
const criticalPath = Math.max(...plan.units.map((u) => depthOf(u.id)))
const startable = plan.units.filter((u) => depsOf(u).length === 0).length

if (!build) {
  log(`${plan.units.length} unit(s), ${startable} starting immediately, critical path ${criticalPath} — reporting the plan, not building`)
  return {
    built: false,
    decomposable: true,
    reason: plan.reason,
    units_total: plan.units.length,
    // The three numbers that predict how parallel this will actually be. Read
    // them before agreeing the split: critical_path near units_total means the
    // decomposer produced a chain, and the fan-out will not buy much.
    starting_immediately: startable,
    critical_path: criticalPath,
    units: plan.units.map((u) => ({ ...u, depth: depthOf(u.id) })),
    note: 'No implementer ran and no worktree was created. Re-run with build:true to fan out.',
  }
}

log(`${plan.units.length} unit(s), ${startable} starting immediately, critical path ${criticalPath} — building`)

// Dependency-gated dispatch. Each unit is a promise that awaits only its OWN
// predecessors, so it starts the moment they are green rather than when a whole
// cohort finishes. Replaces a `for (wave) { await parallel(...) }` loop whose
// global barrier was the main thing capping concurrency.
//
// Raw promises rather than parallel(): parallel() is a barrier by construction,
// which is the thing being removed. The runtime's concurrency cap lives on
// agent() itself, so excess units queue for a slot exactly as before — nothing
// here can oversubscribe the machine.
const scheduled = new Map()

const runUnit = (u) => {
  if (scheduled.has(u.id)) return scheduled.get(u.id)
  const p = (async () => {
    const deps = depsOf(u)
    const depOutcomes = await Promise.all(deps.map((d) => runUnit(byId.get(d))))

    // A dependent must not build on top of a unit that never went green — it
    // would produce work that looks finished and is founded on nothing. The
    // wave loop only logged this and carried on into the next wave.
    const blockedBy = deps.filter((d, i) => !depOutcomes[i] || depOutcomes[i].status !== 'green')
    if (blockedBy.length) {
      log(`skip ${u.id} — dependency not green: ${blockedBy.join(', ')}`)
      return { unit: u, status: 'skipped', result: null, blocked_by: blockedBy }
    }

    log(`start ${u.id}`)
    let r = null
    try {
      r = await agent(
      `Build ONE unit of a larger change. Other agents are building sibling units concurrently, so
stay strictly inside your own scope.

UNIT: ${u.title}
FILES YOU OWN: ${(u.files || []).join(', ') || '(infer, but stay narrow)'}
DONE WHEN: ${u.definition_of_done}
${u.notes ? `NOTES: ${u.notes}\n` : ''}
YOUR GATE — this command must exit 0 before you report green:

    ${u.verify_command}

Run it. If it fails, fix your code and run it again. Do not report \`green\` unless you have seen it
exit 0 — include the tail of its output and the exit code in verify_output. If you cannot get it
green, report \`failed\` with what you tried; a truthful failure is far more useful than a green
claim that does not hold: units that depend on yours are gated on it, and a false green means they
build on work that was never there.

Do not touch files outside your unit, do not "helpfully" fix unrelated things you notice, and do not
commit anything beyond your own unit. If your unit turns out to depend on another unit's work,
report \`blocked\` and say which — that is a decomposition error worth knowing about.`,
        {
          label: `build:${u.id}`,
          phase: 'Build',
          agentType: 'implementer',
          // Tier per unit: rote work does not need Sonnet. This is the lever that
          // has been sitting unused.
          model: u.mechanical ? 'haiku' : 'sonnet',
          // Isolation is what makes concurrent writers safe. It costs ~200-500ms
          // and a little disk per unit; a merge conflict costs far more.
          isolation: 'worktree',
          schema: UNIT,
        }
      )
    } catch (e) {
      // One unit throwing must not reject the whole graph — its dependents get
      // skipped by the not-green check above, and everything off that branch
      // keeps building.
      log(`error ${u.id}: ${e && e.message}`)
      return { unit: u, status: 'error', result: null, error: String((e && e.message) || e) }
    }
    const status = (r && r.status) || 'no-result'
    log(`${status === 'green' ? 'green' : status} ${u.id}`)
    return { unit: u, status, result: r }
  })()
  scheduled.set(u.id, p)
  return p
}

const results = await Promise.all(plan.units.map(runUnit))

phase('Integrate')

const green = results.filter((r) => r.status === 'green')
const notGreen = results.filter((r) => r.status !== 'green')

log(`${green.length}/${results.length} unit(s) green`)

return {
  decomposable: true,
  reason: plan.reason,
  units_total: plan.units.length,
  units_green: green.length,
  critical_path: criticalPath,
  starting_immediately: startable,
  // Merge order follows dependency depth, so a unit always merges after
  // everything it was built on. Deliberately NOT merged automatically — an
  // unattended N-way merge is exactly where parallel builds go wrong.
  merge_sequence: green
    .sort((a, b) => depthOf(a.unit.id) - depthOf(b.unit.id))
    .map((r) => ({
      depth: depthOf(r.unit.id),
      id: r.unit.id,
      title: r.unit.title,
      depends_on: depsOf(r.unit),
      branch: r.result.branch || '(worktree branch — see task output)',
      files: r.result.files_changed || r.unit.files,
      verify: r.unit.verify_command,
    })),
  needs_attention: notGreen.map((r) => ({
    id: r.unit.id,
    title: r.unit.title,
    status: r.status,
    // A skipped unit was never attempted, and saying why matters more than any
    // verify output: the thing to fix is its dependency, not the unit itself.
    blocked_by: r.blocked_by,
    detail: r.status === 'skipped'
      ? `Not built — dependency ${(r.blocked_by || []).join(', ')} did not go green.`
      : (r.result ? (r.result.verify_output || r.result.summary) : (r.error || 'agent returned nothing')),
    remaining: r.result ? r.result.remaining : undefined,
  })),
  next_step: green.length === results.length
    ? 'All units green. Merge in dependency order (merge_sequence), then run /council once on the assembled diff — not per unit.'
    : 'Resolve the units needing attention before merging. Anything listed as skipped was never built because a dependency failed — fix that dependency first, and the units downstream of it are still outstanding work.',
}
