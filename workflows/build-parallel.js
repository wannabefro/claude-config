export const meta = {
  name: 'build-parallel',
  description: 'Decompose work into independently-verifiable units, build them concurrently in isolated worktrees behind executable done-criteria, and report a merge plan',
  whenToUse: 'Feature work that genuinely splits into independent units. NOT for coupled changes, same-file edits, or broad refactors — those are correctly serial and fanning them out costs more in merge pain than it saves.',
  phases: [
    { title: 'Decompose', detail: 'Opus splits the work into units with executable done-criteria' },
    { title: 'Build', detail: 'implementers run concurrently in isolated worktrees, by wave' },
    { title: 'Verify', detail: 'each unit must go green on its own command; one repair attempt' },
    { title: 'Integrate', detail: 'overlap check and merge sequence — no automatic merging' },
  ],
}

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
        required: ['id', 'title', 'wave', 'mechanical', 'files', 'definition_of_done', 'verify_command'],
        properties: {
          id: { type: 'string', description: 'short kebab-case slug' },
          title: { type: 'string' },
          wave: { type: 'number', description: '1-indexed. Units in the same wave MUST be independent of each other; later waves may depend on earlier ones.' },
          mechanical: { type: 'boolean', description: 'true if the change is rote — rename, boilerplate, pattern already obvious. Routed to a cheaper tier.' },
          files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative files this unit owns. Two units in the same wave must not share any file.' },
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
- Two units in the SAME WAVE must not touch the same file. If they must, either merge them into one
  unit or put them in different waves.
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

// Overlap is a decomposition bug, and cheap to catch here rather than at merge.
const waves = [...new Set(plan.units.map((u) => u.wave))].sort((a, b) => a - b)
const conflicts = []
for (const w of waves) {
  const inWave = plan.units.filter((u) => u.wave === w)
  const seen = new Map()
  for (const u of inWave) {
    for (const f of (u.files || [])) {
      if (seen.has(f)) conflicts.push({ wave: w, file: f, units: [seen.get(f), u.id] })
      else seen.set(f, u.id)
    }
  }
}
if (conflicts.length) {
  log(`${conflicts.length} same-wave file overlap(s) — refusing to fan out into a guaranteed conflict`)
  return {
    error: 'Decomposition put units that share files in the same wave.',
    conflicts,
    recommendation: 'Re-run with the overlapping units merged, or move one to a later wave.',
    plan,
  }
}

if (!build) {
  log(`${plan.units.length} unit(s) across ${waves.length} wave(s) — reporting the plan, not building`)
  return {
    built: false,
    decomposable: true,
    reason: plan.reason,
    wave_count: waves.length,
    units: plan.units,
    note: 'No implementer ran and no worktree was created. Re-run with build:true to fan out.',
  }
}

log(`${plan.units.length} unit(s) across ${waves.length} wave(s) — building`)

const results = []
for (const w of waves) {
  const inWave = plan.units.filter((u) => u.wave === w)
  log(`wave ${w}: ${inWave.length} unit(s) concurrently — ${inWave.map((u) => u.id).join(', ')}`)

  // Barrier between waves is required: later waves may depend on earlier ones.
  // Within a wave everything runs at once — that is where the speed comes from.
  const built = await parallel(inWave.map((u) => () =>
    agent(
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
claim that does not hold, because the next wave may build on your work.

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
    ).then((r) => ({ unit: u, result: r }))
  ))

  results.push(...built.filter(Boolean))

  const failed = built.filter(Boolean).filter((b) => b.result && b.result.status !== 'green')
  if (failed.length) {
    log(`wave ${w}: ${failed.length} unit(s) not green — later waves may build on these`)
  }
}

phase('Integrate')

const green = results.filter((r) => r.result && r.result.status === 'green')
const notGreen = results.filter((r) => !r.result || r.result.status !== 'green')

log(`${green.length}/${results.length} unit(s) green`)

return {
  decomposable: true,
  reason: plan.reason,
  waves: waves.length,
  units_total: plan.units.length,
  units_green: green.length,
  // Merge order follows wave order; deliberately NOT merged automatically —
  // an unattended N-way merge is exactly where parallel builds go wrong.
  merge_sequence: green
    .sort((a, b) => a.unit.wave - b.unit.wave)
    .map((r) => ({
      wave: r.unit.wave,
      id: r.unit.id,
      title: r.unit.title,
      branch: r.result.branch || '(worktree branch — see task output)',
      files: r.result.files_changed || r.unit.files,
      verify: r.unit.verify_command,
    })),
  needs_attention: notGreen.map((r) => ({
    id: r.unit.id,
    title: r.unit.title,
    status: r.result ? r.result.status : 'no-result',
    detail: r.result ? (r.result.verify_output || r.result.summary) : 'agent returned nothing',
    remaining: r.result ? r.result.remaining : undefined,
  })),
  next_step: green.length === results.length
    ? 'All units green. Merge in wave order, then run /council once on the assembled diff — not per unit.'
    : 'Resolve the units needing attention before merging; a later wave may have built on an unverified unit.',
}
