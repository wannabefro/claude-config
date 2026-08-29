export const meta = {
  name: 'build-parallel',
  description: 'Route approved work to parallel or serial Luna implementation units behind executable done-criteria',
  whenToUse: 'The entry point for approved structured work: multiple units, dependencies, shared contracts, coupled multi-file work, or genuinely parallel work. One coherent unit uses /implement.',
  phases: [
    { title: 'Decompose', detail: 'Opus splits the work into units with executable done-criteria' },
    { title: 'Build', detail: 'each Luna unit starts as soon as its dependencies are green, in the approved workspace' },
    { title: 'Integrate', detail: 'merge sequence in dependency order — no automatic merging' },
  ],
}

// No Verify phase exists — verification is each unit's own gate, its verify_command exiting 0.

// Reviews belong in the outer loop (/review), run once on the assembled diff, not per unit.

const PLAN = {
  type: 'object',
  required: ['route', 'route_reason', 'workspace', 'workspace_reason', 'working_directory', 'base_commit', 'reason', 'units'],
  properties: {
    route: {
      enum: ['parallel', 'serial'],
      description: 'parallel = two or more independent units with disjoint files and no shared contract. serial = one Luna implementer handles structured coupled work. One coherent, clearly scoped unit belongs in /implement. Compound Engineering remains an explicit planning and review toolbox, not the scheduler.',
    },
    route_reason: { type: 'string', minLength: 1, description: 'Why this route and not the other route — name the deciding property (shared file, shared contract, size, coupling), not a generic phrase' },
    workspace: {
      enum: ['worktree'],
      description: 'Every parallel unit receives a deterministic private git worktree. Shared checkout execution is never an accepted implementation mode.',
    },
    workspace_reason: { type: 'string', minLength: 1, description: 'Name the deciding fact — which ignored path the verify commands need, or the evidence that they need none' },
    working_directory: { type: 'string', minLength: 1, description: 'Absolute path to the exact checkout where every unit must run. Never infer this at dispatch time.' },
    base_commit: { type: 'string', minLength: 1, description: 'HEAD commit of working_directory when this plan was created. Build approval rejects a stale checkout.' },
    working_tree_fingerprint: { type: 'string', description: 'SHA-256 fingerprint frozen by the dispatcher over index, tracked working-tree, and relevant untracked state. The dispatcher fills this before approval.' },
    reason: { type: 'string', minLength: 1, description: 'Why it does or does not decompose — specific, not generic' },
    units: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'depends_on', 'files', 'provides', 'consumes', 'removes', 'definition_of_done', 'verify_command'],
        properties: {
          id: { type: 'string', description: 'short kebab-case slug' },
          title: { type: 'string' },
          depends_on: {
            type: 'array',
            items: { type: 'string' },
            description: 'ids of units that MUST be finished before this one starts. Empty array if none. List only real dependencies — every id here delays this unit, and a dependency added "to be safe" costs parallelism for nothing. Two units that merely touch the same file are NOT dependent; that is caught separately.',
          },
          files: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'Repo-relative files this unit owns. Two units that could run concurrently must not share a file — either add a dependency between them or merge them.' },
          // File overlap alone misses this: two units can collide on a name while touching different files entirely.
          provides: {
            type: 'array',
            minItems: 0,
            items: { type: 'string' },
            description: 'Stable names this unit introduces or changes that anything outside it could depend on — exported symbols, object fields, API routes, config keys, DB columns, event names. Use the exact dotted name (e.g. "item.photo", "config.currency"). Omit purely internal names.',
          },
          consumes: {
            type: 'array',
            minItems: 0,
            items: { type: 'string' },
            description: 'Names from another unit\'s `provides` that this unit reads or depends on. If you list a name here that another unit provides, you MUST also list that unit in depends_on — otherwise you are asserting a contract nobody has built yet.',
          },
          // `provides`/`consumes` catch collisions, not work on a name a later unit is about to delete — `removes` covers that.
          removes: {
            type: 'array',
            minItems: 0,
            items: { type: 'string' },
            description: 'Names this unit DELETES or rewrites wholesale — the same dotted names used in provides/consumes. List a name here when nothing downstream should still be reading it afterwards. Getting this wrong is expensive in one direction only: an unlisted removal lets other units spend real time verifying something you are about to delete.',
          },
          definition_of_done: { type: 'string', minLength: 1, description: 'Observable behaviour that must hold when finished' },
          verify_command: { type: 'string', minLength: 1, description: 'A single shell command that exits 0 exactly when this unit is done. Scoped to this unit — not the whole suite.' },
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

const HEAD_CHECK = {
  type: 'object',
  required: ['current_head'],
  properties: { current_head: { type: 'string' } },
}
const FINGERPRINT_CHECK = {
  type: 'object',
  required: ['fingerprint'],
  properties: {
    fingerprint: { type: 'string' },
    detail: { type: 'string' },
  },
}
const PATH_CHECK = {
  type: 'object',
  required: ['status', 'paths'],
  properties: {
    status: { enum: ['ready', 'failed'] },
    paths: {
      type: 'array',
      items: {
        type: 'object',
        required: ['unit', 'file', 'physical', 'identity'],
        properties: {
          unit: { type: 'string' },
          file: { type: 'string' },
          physical: { type: 'string' },
          identity: { type: 'string' },
        },
      },
    },
    errors: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
  },
}

const WORKTREE_ISOLATION_SUPPORTED = true

const WORKTREE_RESULT = {
  type: 'object',
  required: ['status', 'root', 'token', 'invocation_nonce', 'plan_hash', 'units'],
  properties: {
    status: { enum: ['ready', 'failed'] },
    root: { type: 'string' },
    token: { type: 'string' },
    invocation_nonce: { type: 'string' },
    plan_hash: { type: 'string' },
    units: {
      type: 'array',
      items: { type: 'object', required: ['id', 'path', 'seed'], properties: { id: { type: 'string' }, path: { type: 'string' }, seed: { type: 'string' } } },
    },
    detail: { type: 'string' },
  },
}
const INTEGRATION_RESULT = {
  type: 'object',
  required: ['status'],
  properties: { status: { enum: ['integrated', 'failed'] }, detail: { type: 'string' } },
}

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`
const repoFingerprint = async (workingDirectory, label) => agent(
  `Run exactly this read-only command in the frozen checkout and return the
single lowercase SHA-256 value it prints. Do not inspect or modify files:

  { git -C ${shellQuote(workingDirectory)} status --porcelain=v1 -z --untracked-files=all; git -C ${shellQuote(workingDirectory)} diff --binary HEAD --; git -C ${shellQuote(workingDirectory)} diff --cached --binary; git -C ${shellQuote(workingDirectory)} ls-files --others --exclude-standard -z | while IFS= read -r -d '' path; do printf 'untracked-path=%s\\0' "$path"; if [ -L ${shellQuote(workingDirectory)}/"$path" ]; then printf 'symlink-target=%s\\0' "$(readlink ${shellQuote(workingDirectory)}/"$path")"; elif [ -f ${shellQuote(workingDirectory)}/"$path" ]; then git -C ${shellQuote(workingDirectory)} hash-object --no-filters -- "$path"; else printf 'non-regular\\0'; fi; done; } | shasum -a 256 | awk '{print $1}'

The value must cover the index, tracked working-tree content, and all relevant
(unignored) untracked paths and their bytes. Return fingerprint as the exact hash, or an empty
fingerprint if the command failed.`,
  { label, phase: 'Build', agentType: 'explorer', schema: FINGERPRINT_CHECK }
)
const approvalSnapshot = async (workingDirectory, label) => {
  const [fingerprint, head] = await parallel([
    () => repoFingerprint(workingDirectory, `${label}:fingerprint`),
    () => agent(
      `Run exactly this read-only command in the frozen working directory and return its output:

  git -C "${workingDirectory || ''}" rev-parse HEAD

Return current_head as the exact commit string. Do not inspect or modify files.`,
      { label: `${label}:head`, phase: 'Build', agentType: 'explorer', schema: HEAD_CHECK }),
  ])
  return {
    fingerprint: fingerprint && typeof fingerprint.fingerprint === 'string' ? fingerprint.fingerprint : '',
    current_head: head && typeof head.current_head === 'string' ? head.current_head : '',
  }
}
const snapshotMatches = (plan, snapshot) => Boolean(
  snapshot &&
  snapshot.fingerprint === plan.working_tree_fingerprint &&
  snapshot.current_head === plan.base_commit
)
const pathCheck = async (plan) => {
  const units = plan.units.map((unit) => ({ id: unit.id, files: unit.files }))
  const encodedUnits = shellQuote(JSON.stringify(units))
  const root = shellQuote(plan.working_directory)
  return agent(
    `Run exactly this read-only path ownership check. Do not inspect or modify
files beyond resolving their names. Return the JSON object printed by the
command as the structured result.

  python3 -c 'import json,os,sys
root=os.path.realpath(sys.argv[1]); units=json.loads(sys.argv[2]); paths=[]; errors=[]
for unit in units:
  for rel in unit.get("files",[]):
    valid=isinstance(rel,str) and bool(rel) and not rel.startswith("/") and "\\\\" not in rel and "//" not in rel and not rel.endswith("/") and rel not in (".","..") and "." not in rel.split("/") and ".." not in rel.split("/")
    lexical=os.path.normpath(os.path.join(root,rel)) if valid else ""
    physical=os.path.realpath(lexical) if valid else ""
    inside=bool(valid and os.path.commonpath([root,physical])==root)
    if not valid: errors.append(unit["id"]+": non-canonical repo-relative path: "+str(rel))
    elif not inside: errors.append(unit["id"]+": path escapes repository: "+rel)
    elif physical != lexical: errors.append(unit["id"]+": symlink alias rejected: "+rel)
    elif os.path.lexists(lexical) and (os.path.islink(lexical) or not os.path.isfile(lexical)): errors.append(unit["id"]+": owned path is not a regular file: "+rel)
    else:
      stat=os.stat(lexical) if os.path.lexists(lexical) else None
      identity=("inode:"+str(stat.st_dev)+":"+str(stat.st_ino)) if stat else ("path:"+physical)
      paths.append({"unit":unit["id"],"file":rel,"physical":physical,"identity":identity})
print(json.dumps({"status":"ready" if not errors else "failed","paths":paths,"errors":errors},sort_keys=True))' ${root} ${encodedUnits}

The check must reject absolute paths, backslashes, ./ or ../ aliases,
duplicate separators, paths outside the repository, symlink aliases, and
existing directories or non-regular files. It must resolve missing files under
the real checkout without creating anything.`,
    { label: 'build:path-ownership', phase: 'Build', agentType: 'explorer', schema: PATH_CHECK }
  )
}

// args may arrive as a JSON-encoded string of an object, not just a plain task string — parse defensively.
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

// This nonce belongs to this workflow invocation, not to the plan or helper.
// Generate it before the first Opus call (including decomposition) so a valid
// root/token/unit bundle from an identical concurrent run can never be replayed
// into this invocation.
const invocationNonce = await (async () => {
  try {
    const { randomBytes } = await import('node:crypto')
    return randomBytes(32).toString('hex')
  } catch {
    return null
  }
})()
if (!invocationNonce || !/^[0-9a-f]{64}$/.test(invocationNonce)) {
  return { error: 'Could not generate a cryptographically secure build invocation nonce; no agent or helper was started.' }
}
let frozenPlanHash = ''

// Reporting the plan is the default for a parallel fan-out; structured serial work starts one Luna implementer immediately.
const build = opts.build === true

// Approval is a capability boundary, not a second planning pass. The caller
// must send the exact payload returned by the first pass plus its SHA-256 id.
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const sha256 = async (text) => {
  if (globalThis.crypto && globalThis.crypto.subtle && globalThis.TextEncoder) {
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  try {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(text).digest('hex')
  } catch {
    return null
  }
}
const planHash = async (candidate) => sha256(stableJson(candidate))
const planValidation = (candidate) => {
  const errors = []
  if (!candidate || typeof candidate !== 'object') return ['plan payload is not an object']
  for (const field of ['route', 'route_reason', 'workspace', 'workspace_reason', 'working_directory', 'base_commit', 'reason']) {
    if (typeof candidate[field] !== 'string' || !candidate[field].trim()) errors.push(`missing required plan field: ${field}`)
  }
  if (!['parallel', 'serial'].includes(candidate.route)) errors.push('route must be parallel or serial')
  if (candidate.workspace !== 'worktree') errors.push('workspace must be worktree')
  if (candidate.working_directory && !candidate.working_directory.startsWith('/')) errors.push('working_directory must be an absolute path')
  if (!Array.isArray(candidate.units) || !candidate.units.length) errors.push('units must be a non-empty array')
  const seen = new Set()
  for (const [index, unit] of (candidate.units || []).entries()) {
    if (!unit || typeof unit !== 'object') { errors.push(`unit ${index + 1} is not an object`); continue }
    for (const field of ['id', 'title', 'definition_of_done', 'verify_command']) {
      if (typeof unit[field] !== 'string' || !unit[field].trim()) errors.push(`unit ${index + 1} missing required field: ${field}`)
    }
    if (unit.id && seen.has(unit.id)) errors.push(`duplicate unit id: ${unit.id}`)
    if (unit.id) seen.add(unit.id)
    if (unit.id && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(unit.id)) errors.push(`unit ${unit.id} must use a worktree-safe id slug`)
    if (!Array.isArray(unit.depends_on)) errors.push(`unit ${unit.id || index + 1} requires depends_on array`)
    if (Array.isArray(unit.depends_on) && unit.depends_on.some((dependency) => typeof dependency !== 'string' || !dependency.trim())) errors.push(`unit ${unit.id || index + 1} has invalid depends_on entries`)
    if (!Array.isArray(unit.files) || !unit.files.length) errors.push(`unit ${unit.id || index + 1} requires non-empty files ownership`)
    for (const file of (unit.files || [])) {
      if (typeof file !== 'string' || !file.trim() || file.startsWith('/') || file.split('/').includes('..')) errors.push(`unit ${unit.id || index + 1} has invalid file ownership`)
    }
    for (const field of ['provides', 'consumes', 'removes']) {
      if (!Array.isArray(unit[field])) errors.push(`unit ${unit.id || index + 1} requires ${field} array`)
      else if (unit[field].some((name) => typeof name !== 'string' || !name.trim())) errors.push(`unit ${unit.id || index + 1} has invalid ${field} entries`)
    }
  }
  return errors
}

let plan
if (build) {
  let approved = opts.plan_payload || opts.frozen_plan || opts.plan
  if (typeof approved === 'string') {
    try { approved = JSON.parse(approved) } catch { approved = null }
  }
  if (!approved) return { error: 'build:true requires the exact frozen plan payload; it never replans.' }
  const suppliedHash = String(opts.plan_hash || '').trim()
  const suppliedId = String(opts.plan_id || '').trim()
  const computedHash = await planHash(approved)
  if (!computedHash || suppliedHash !== computedHash || suppliedId !== computedHash.slice(0, 20)) {
    return {
      error: 'Frozen plan integrity check failed; no unit was dispatched.',
      expected_plan_id: computedHash ? computedHash.slice(0, 20) : null,
      expected_plan_hash: computedHash,
    }
  }
  frozenPlanHash = computedHash
  const approvedValidationErrors = planValidation(approved)
  if (approvedValidationErrors.length) {
    return { error: 'Frozen plan validation failed; no unit was dispatched.', validation_errors: approvedValidationErrors }
  }
  if (!WORKTREE_ISOLATION_SUPPORTED || approved.workspace !== 'worktree') {
    return {
      error: 'Parallel implementation requires verified per-unit worktree isolation; no unit was dispatched.',
      recommendation: 'Re-run after the worktree capability probe succeeds. Shared checkout fan-out is never a safe fallback.',
    }
  }
  if (typeof approved.working_tree_fingerprint !== 'string' || !approved.working_tree_fingerprint.trim()) {
    return { error: 'Frozen plan is missing the index and working-tree fingerprint; no unit was dispatched.' }
  }
  const currentSnapshot = await approvalSnapshot(approved.working_directory, 'build:approval-snapshot')
  if (!currentSnapshot || currentSnapshot.fingerprint !== approved.working_tree_fingerprint) {
    return {
      error: 'Frozen plan is stale; index, working tree, or relevant untracked state changed after approval. No unit was dispatched.',
      expected_fingerprint: approved.working_tree_fingerprint,
      current_fingerprint: currentSnapshot && currentSnapshot.fingerprint,
    }
  }
  if (!currentSnapshot || currentSnapshot.current_head !== approved.base_commit) {
    return {
      error: 'Frozen plan is stale; working-directory HEAD changed after approval. No unit was dispatched.',
      expected_base_commit: approved.base_commit,
      current_head: currentSnapshot && currentSnapshot.current_head,
    }
  }
  plan = approved
} else {
  phase('Decompose')
  log('Decomposing — the ceiling on parallel speed is decomposition quality, so this runs on Opus')

plan = await agent(
  `Split this work into units that can be built CONCURRENTLY by separate agents without colliding.

WORK: ${task}

If a plan document is referenced, read it. Read enough of the codebase to know which files each unit
would touch — a decomposition based on guessed file boundaries is worse than no decomposition,
because it produces merge conflicts that cost more than the parallelism saves.

Rules for a unit:
- Return \`working_directory\` as the absolute path of the current checkout. This
  path is frozen into the approval payload and every dispatcher must use it
  exactly; never leave it implicit or ask a worker to guess.
- Return \`base_commit\` as the exact \`git rev-parse HEAD\` output for that
  working directory. Approval rejects the payload if HEAD is stale.
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
- **Each unit runs its own verify_command before anything else sees its work**, so:
    · Use repo-relative paths (\`rules/foo.md\`), never absolute ones.
    · A unit's verify must be satisfiable from THAT UNIT'S changes alone. Never assert a cross-unit
      invariant — a total across files other units own, a count over the whole tree, a link into a
      file another unit creates. Those are true only after the merge, so no unit can pass them. If a
      check like that matters, say so in \`notes\` as a post-merge step; do not dress it up as a unit.
- **Use \`workspace: "worktree"\` for parallel work.** The dispatcher creates one exact private
  worktree per unit and passes that path to the implementer. Shared checkout execution is blocked:
  advisory file ownership cannot prevent a formatter, generated file, or accidental out-of-scope
  write from colliding with a sibling. If worktree creation or cleanup cannot be proven, dispatch
  no unit and report the block; never silently downgrade to shared execution.
- **Name the contracts, not just the files.** Isolation means a unit can invent a field name, a
  route, or a config key, verify green against its own use of it, and disagree with the unit on the
  other side — the mismatch surfaces at merge, when every unit already reported success. Files do not
  catch this: the two units usually touch different files entirely. So for each unit list
  \`provides\` (names it introduces or changes that anything outside could depend on) and
  \`consumes\` (names it reads that another unit provides), using the exact dotted name. Anything you
  put in \`consumes\` that another unit provides REQUIRES that unit in \`depends_on\`; and exactly one
  unit may provide a given name. Both are enforced — violating either is refused, not warned.
- **Name what each unit DESTROYS, in \`removes\`, and schedule demolition first.** This is the one
  failure no other check here can see, because nothing goes red: a unit spends real time on something
  a later unit deletes, passes its gate, and the result is worthless. It happened — a 49-flow sweep
  ran two hours to answer "does the level map still work?" while a later unit in the same plan deleted
  the level map and rewrote all 47 flows that referenced it.
    · List in \`removes\` every name the unit deletes or rewrites wholesale.
    · Then order the plan so removals come EARLY. A unit that touches a removed name must depend on
      the remover, or it is refused.
    · If a unit exists only to verify something another unit removes, **do not order it — delete it.**
      The question it answers has already been answered by the plan.
  Ask this of every unit before you emit it: after the whole plan lands, is this unit's subject still
  there? If not, you are scheduling waste that will report success.
- Every unit needs a \`verify_command\`: one shell command that exits 0 exactly when the unit is done
  and non-zero when it is not. A scoped test, a targeted typecheck — not the whole suite, which would
  fail for reasons unrelated to this unit. **If you cannot write such a command for a unit, that unit
  is not safe to build in parallel** — say so rather than inventing a weak command like \`echo ok\`.
**Choosing the route is the most valuable thing you do here.** Pick one, and say which property
decided it:

- \`parallel\` — two or more units with disjoint files and no shared contract, at least two able to
  start at once. Only this route earns the worktree and dispatch cost.
- \`serial\` — sequential, coupled, or one-unit work handled by one Luna implementer. Compound
  Engineering can provide an explicit plan or review, but it never performs the implementation.

Two failure modes, and the second is the expensive one. Forcing a fan-out on coupled work produces
merge conflicts that cost more than the parallelism saved. But routing genuinely parallel work to
\`serial\` is safe, and an over-parallelised build is wrong.`,
  { label: 'decompose', phase: 'Decompose', model: 'opus', effort: 'xhigh', schema: PLAN }
)
}

if (!plan) return { error: 'Decomposition failed — no plan returned.' }

if (plan.route === 'parallel' && plan.workspace !== 'worktree') {
  return {
    error: 'Parallel implementation requires workspace: "worktree"; shared checkout fan-out is blocked.',
    plan,
  }
}

if (!build) {
  const frozenFingerprint = await repoFingerprint(plan.working_directory, 'build:freeze-fingerprint')
  if (!frozenFingerprint || typeof frozenFingerprint.fingerprint !== 'string' || !frozenFingerprint.fingerprint.trim()) {
    return { error: 'Could not freeze the index and working-tree fingerprint; no plan was offered for approval.' }
  }
  plan.working_tree_fingerprint = frozenFingerprint.fingerprint.trim()
  frozenPlanHash = await planHash(plan)
}
const validationErrors = planValidation(plan)
if (validationErrors.length) {
  return {
    error: 'Plan validation failed; no implementer was dispatched.',
    validation_errors: validationErrors,
    plan,
  }
}

const ownedPathCheck = await pathCheck(plan)
if (!ownedPathCheck || ownedPathCheck.status !== 'ready' || !Array.isArray(ownedPathCheck.paths)) {
  return {
    error: 'Canonical ownership check failed; no unit was dispatched.',
    path_errors: ownedPathCheck && ownedPathCheck.errors,
    detail: ownedPathCheck && ownedPathCheck.detail,
    plan,
  }
}

// Trust only a complete, canonical response from the read-only path check.
// A missing record, duplicate record, or a physical path that is not exactly
// the lexical checkout path is a fail-closed condition.
const rootPath = String(plan.working_directory).replace(/\/+$/, '')
const expectedPathKeys = new Set(plan.units.flatMap((unit) => unit.files.map((file) => `${unit.id}\0${file}`)))
const canonicalPaths = new Map()
const pathErrors = []
for (const record of ownedPathCheck.paths) {
  if (!record || typeof record.unit !== 'string' || typeof record.file !== 'string' || typeof record.physical !== 'string' || typeof record.identity !== 'string') {
    pathErrors.push('path check returned an incomplete record')
    continue
  }
  const key = `${record.unit}\0${record.file}`
  if (!expectedPathKeys.has(key) || canonicalPaths.has(key)) {
    pathErrors.push(`path check returned an unexpected or duplicate record: ${record.unit}/${record.file}`)
    continue
  }
  const physical = record.physical
  const relativePhysical = physical.startsWith(`${rootPath}/`) ? physical.slice(rootPath.length + 1) : null
  if (!relativePhysical || relativePhysical !== record.file || physical.includes('//') || physical.includes('/./') || physical.includes('/../')) {
    pathErrors.push(`path is not canonical or is a symlink alias: ${record.unit}/${record.file}`)
    continue
  }
  if (!record.identity.startsWith('inode:') && !record.identity.startsWith('path:')) {
    pathErrors.push(`path check returned an invalid physical identity: ${record.unit}/${record.file}`)
    continue
  }
  canonicalPaths.set(key, { ...record, physical })
}
for (const key of expectedPathKeys) if (!canonicalPaths.has(key)) pathErrors.push(`path check omitted ${key.replace('\0', '/')}`)
if (pathErrors.length) {
  return { error: 'Canonical ownership check failed; no unit was dispatched.', path_errors: pathErrors, plan }
}

// Naming the concrete fallback route lets the caller act without a round trip.
const planPath = (task.match(/[\w./-]*docs\/plans\/[\w.-]+\.md/) || [])[0] || null
const routeOf = (r) => r === 'parallel'
  ? 'parallel Luna implementers after approval of the frozen split'
  : `one serial Luna implementer${planPath ? ` using the explicit plan path: \`${planPath}\`` : ''}`
// The decomposer's route always wins; the regex is only a fallback when none is returned.
const fallbackRoute = routeOf(plan.route || 'serial')

// One unit isn't a fan-out — it pays worktree and dispatch cost for zero concurrency, so it falls back.
if (plan.route === 'parallel' && plan.units && plan.units.length === 1) plan.route = 'serial'

if (plan.route !== 'parallel' || !plan.units || !plan.units.length) {
  log(`route: ${plan.route || 'serial'} — not fanning out`)
  if (plan.route === 'serial' && plan.units && plan.units.length) {
    phase('Build')
    // Serial is still isolated: it uses one deterministic private worktree and
    // one Luna writer, then applies only the declared owned patch. This keeps
    // coupled work sequential without reopening the main checkout as a write
    // target or trusting a worker's claimed scope.
    const serialId = 'serial'
    const serialFiles = [...new Set(plan.units.flatMap((u) => u.files))]
    const serialBrief = plan.units.map((u, i) => `
UNIT ${i + 1}: ${u.title}
FILES YOU OWN: ${u.files.join(', ')}
DONE WHEN: ${u.definition_of_done}
VERIFY: ${u.verify_command}
${u.notes ? `NOTES: ${u.notes}` : ''}`).join('\n')
    const serialWorktreeCommand = '~/.claude/scripts/build-worktree.sh'
    const serialCleanup = async (root, token) => {
      if (!root || !root.startsWith('/')) return { status: 'failed', detail: 'Serial worktree root was not absolute.' }
      if (!token || !/^[0-9a-f]{64}$/.test(token)) return { status: 'failed', detail: 'Serial worktree run token was missing or invalid.' }
      return agent(
        `Remove exactly this private serial worktree root after integration:
  bash ${serialWorktreeCommand} cleanup '${plan.working_directory}' '${root}' '${token}' '${invocationNonce}' '${frozenPlanHash}'
Return status=cleaned only when the command exits 0. Do not modify repository files.`,
        { label: 'build:serial-cleanup', phase: 'Integrate', agentType: 'explorer', schema: { type: 'object', required: ['status'], properties: { status: { enum: ['cleaned', 'failed'] }, detail: { type: 'string' } } } }
      )
    }
    let serialRoot = ''
    let serialRunToken = ''
    let serialState = null
    let serialCleanupResult = null
    const cleanupSerialOnce = async () => {
      if (serialCleanupResult) return serialCleanupResult
      serialCleanupResult = await serialCleanup(serialRoot, serialRunToken)
      return serialCleanupResult
    }
    try {
      const prepared = await agent(
        `Prepare one private git worktree for the frozen serial unit. Do not use the canonical checkout for writes.
Run exactly:
  root=$(mktemp -d "\${TMPDIR:-/tmp}/claude-build-worktrees.XXXXXXXX")
  token=''
  cleanup() { [ -n "$token" ] && bash ${serialWorktreeCommand} cleanup '${plan.working_directory}' "$root" "$token" '${invocationNonce}' '${frozenPlanHash}' >/dev/null 2>&1 || true; }
  trap cleanup EXIT HUP INT TERM
  path="$root/${serialId}"
  token=$(bash ${serialWorktreeCommand} prepare '${plan.working_directory}' '${plan.base_commit}' "$root" '${invocationNonce}' '${frozenPlanHash}' '${serialId}')
  bash ${serialWorktreeCommand} create '${plan.working_directory}' '${plan.base_commit}' "$path" "codex-build/\${token:0:12}-${serialId}" '${invocationNonce}' '${frozenPlanHash}'
  seed=$(bash ${serialWorktreeCommand} seed '${plan.working_directory}' "$path" '${invocationNonce}' '${frozenPlanHash}')
  trap - EXIT HUP INT TERM
  printf 'status=ready root=%s token=%s invocation_nonce=%s plan_hash=%s path=%s seed=%s\\n' "$root" "$token" '${invocationNonce}' '${frozenPlanHash}' "$path" "$seed"
Return the exact root, token, path, and seed. Do not modify the canonical checkout.`,
        { label: 'build:serial-prepare-worktree', phase: 'Build', agentType: 'explorer', schema: { type: 'object', required: ['status', 'root', 'token', 'invocation_nonce', 'plan_hash', 'path', 'seed'], properties: { status: { enum: ['ready', 'failed'] }, root: { type: 'string' }, token: { type: 'string' }, invocation_nonce: { type: 'string' }, plan_hash: { type: 'string' }, path: { type: 'string' }, seed: { type: 'string' }, detail: { type: 'string' } } } }
      )
      serialRoot = prepared && typeof prepared.root === 'string' ? prepared.root : ''
      serialRunToken = prepared && typeof prepared.token === 'string' ? prepared.token : ''
      const expectedRoot = serialRoot.replace(/\/+$/, '')
      if (!prepared || prepared.status !== 'ready' || prepared.invocation_nonce !== invocationNonce || prepared.plan_hash !== frozenPlanHash || !serialRoot.startsWith('/') || !/^[0-9a-f]{64}$/.test(serialRunToken) || !prepared.path || prepared.path !== `${expectedRoot}/${serialId}` || prepared.path.includes('..') || typeof prepared.seed !== 'string' || !/^[0-9a-f]{40}$/.test(prepared.seed)) {
        const cleanup = await cleanupSerialOnce()
        return { built: true, decomposable: false, route: 'serial', units_total: plan.units.length, units_green: 0, units: plan.units, result: prepared || { status: 'failed' }, cleanup, needs_attention: [{ status: 'failed', detail: 'Serial private worktree preparation returned incomplete or unsafe identity records.' }] }
      }
      serialState = { path: prepared.path, seed: prepared.seed, token: serialRunToken }
      let finalSnapshot = null
      try { finalSnapshot = await approvalSnapshot(plan.working_directory, 'build:serial-final-release-check') } catch (error) {
        const cleanup = await cleanupSerialOnce()
        return { built: true, decomposable: false, route: 'serial', units_total: plan.units.length, units_green: 0, units: plan.units, cleanup, needs_attention: [{ status: 'blocked', detail: String((error && error.message) || error) }] }
      }
      if (!snapshotMatches(plan, finalSnapshot)) {
        const cleanup = await cleanupSerialOnce()
        return { built: true, decomposable: false, route: 'serial', units_total: plan.units.length, units_green: 0, units: plan.units, cleanup, needs_attention: [{ status: 'blocked', detail: 'Frozen plan drifted during serial preflight; final fingerprint and HEAD verification rejected dispatch.' }], expected_fingerprint: plan.working_tree_fingerprint, current_fingerprint: finalSnapshot && finalSnapshot.fingerprint, expected_base_commit: plan.base_commit, current_head: finalSnapshot && finalSnapshot.current_head }
      }

      const r = await agent(
        `Build the frozen task as one serial implementation unit in the exact private worktree below. Do not write in the canonical checkout. The implementer must dispatch exactly one Codex gpt-5.6-luna xhigh run through its fixed wrapper, then run every exact verify command below.

WORK: ${task}
WORKING DIRECTORY (EXACT PRIVATE WORKTREE): ${serialState.path}
CANONICAL CHECKOUT (READ-ONLY REFERENCE): ${plan.working_directory}
FILES YOU OWN: ${serialFiles.join(', ')}
${serialBrief}

Keep all changes inside the listed ownership. The integration helper performs a post-write scope check and rejects every other changed path. Return the structured unit handoff.`,
        { label: 'build:serial', phase: 'Build', agentType: 'implementer', schema: UNIT }
      )
      const status = (r && r.status) || 'no-result'
      let integration = null
      if (status === 'green') {
        const files = serialFiles.map((file) => shellQuote(file)).join(' ')
        integration = await agent(
          `Integrate exactly one completed serial unit into the canonical checkout. Run exactly:
  bash ${serialWorktreeCommand} integrate '${plan.working_directory}' '${serialState.path}' '${serialState.seed}' '${plan.working_directory}' '${serialState.token}' '${invocationNonce}' '${frozenPlanHash}' ${files}
The helper must validate the private worktree identity, reject every changed path outside the unit's exact owned files, and apply the patch only after that check. Do not merge unrelated paths.`,
          { label: 'build:serial-integrate', phase: 'Integrate', agentType: 'explorer', schema: INTEGRATION_RESULT }
        )
      }
      const integrated = status === 'green' && integration && integration.status === 'integrated'
      serialCleanupResult = await cleanupSerialOnce()
      return {
        built: true,
        decomposable: false,
        route: 'serial',
        units_total: plan.units.length,
        units_green: integrated ? plan.units.length : 0,
        units: plan.units,
        result: r,
        integration: integration || undefined,
        cleanup: serialCleanupResult,
        needs_attention: integrated && serialCleanupResult.status === 'cleaned' ? [] : [{ status: integrated ? 'blocked' : status, detail: integrated ? 'Serial implementation integrated, but private worktree cleanup failed.' : (integration && integration.detail) || (r && (r.verify_output || r.summary)) || 'Serial implementation did not complete.' }],
      }
    } finally {
      if (serialRoot && !serialCleanupResult) {
        try { await cleanupSerialOnce() } catch { /* preserve the original failure */ }
      }
    }
  }
  return {
    decomposable: false,
    route: plan.route || 'serial',
    reason: plan.reason,
    route_reason: plan.route_reason,
    // Units still travel on the serial route as a frozen task list for one Luna implementer.
    units: plan.units || [],
    fallback: fallbackRoute,
    recommendation: `Build this serially via ${fallbackRoute}. Fanning it out would cost more in merge conflicts than it saves.`,
  }
}

// Ids must be unique — the scheduler keys a promise per id, so duplicates collapse but still count twice.
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

// A dependency on a nonexistent unit would never resolve, so the scheduler would wait forever.
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

// A cycle would deadlock the scheduler as a silent hang, not an error — refuse it up front.
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

// Units may run concurrently only if neither is an ancestor of the other, and must not then share a file.
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
    const physical = canonicalPaths.get(`${u.id}\0${f}`).physical
    if (!owners.has(physical)) owners.set(physical, [])
    owners.get(physical).push(u.id)
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
    fallback: fallbackRoute,
    recommendation: `Re-run once with the overlapping units merged or a real dependency declared. If it comes back overlapping again, the work is coupled — build it via ${fallbackRoute} instead of forcing a third decomposition.`,
    plan,
  }
}

// Distinct from file overlap: these units touch different files, so drift only appears at merge.
const providers = new Map()
for (const u of plan.units) {
  for (const s of (u.provides || [])) {
    if (!providers.has(s)) providers.set(s, [])
    providers.get(s).push(u.id)
  }
}
const contractIssues = []
for (const [sym, ids] of providers) {
  for (let i = 0; i < ids.length; i++) {
    for (let k = i + 1; k < ids.length; k++) {
      // Two units defining the same name collide even if ordered — the later one silently wins.
      contractIssues.push({ kind: 'duplicate-provider', symbol: sym, units: [ids[i], ids[k]] })
    }
  }
}
for (const u of plan.units) {
  for (const s of (u.consumes || [])) {
    for (const p of (providers.get(s) || [])) {
      if (p === u.id) continue
      if (!ancestorsOf(u.id).has(p)) {
        contractIssues.push({
          kind: 'unordered-contract',
          symbol: s,
          consumer: u.id,
          provider: p,
          detail: `${u.id} consumes "${s}" but does not depend on ${p}, which provides it — both would verify green in isolation and disagree at merge.`,
        })
      }
    }
  }
}
// This isn't a correctness bug — it's spend on a question the plan already answered, invisible because nothing fails.
for (const remover of plan.units) {
  for (const s of (remover.removes || [])) {
    for (const victim of plan.units) {
      if (victim.id === remover.id) continue
      const touches = (victim.consumes || []).includes(s) || (victim.provides || []).includes(s)
      if (!touches) continue
      // Safe only if removal happens first — the victim is then written against the world that ships.
      if (ancestorsOf(victim.id).has(remover.id)) continue
      contractIssues.push({
        kind: 'invalidated-work',
        symbol: s,
        wasted: victim.id,
        remover: remover.id,
        detail: `${victim.id} works on "${s}", which ${remover.id} deletes or rewrites. ${victim.id} does not depend on ${remover.id}, so it is scheduled against a world that will not exist. It will go green and the result will mean nothing.`,
      })
    }
  }
}

if (contractIssues.length) {
  log(`${contractIssues.length} contract issue(s) — refusing to fan out into drift that only shows at merge`)
  return {
    error: 'Units share a contract without an ordering that makes it real.',
    contract_issues: contractIssues,
    fallback: fallbackRoute,
    recommendation: `For unordered-contract, add the provider to the consumer's depends_on. For duplicate-provider, one unit owns the name — merge them, or move the definition into a single unit the others depend on. For invalidated-work, put the remover FIRST — add it to the other unit's depends_on — or delete the other unit outright if it only existed to check something being removed; do not "just run it anyway", which is exactly the spend this catches. If a second decomposition still collides, the contract is genuinely shared: build via ${fallbackRoute}.`,
    plan,
  }
}

// Physical disjointness is checked after dependency ordering. Sequential
// units may intentionally hand off a file; units that can start concurrently
// may not share a file or one path's directory prefix.
const physicalConflicts = []
const physicalEntries = [...canonicalPaths.values()]
for (let i = 0; i < physicalEntries.length; i++) {
  for (let j = i + 1; j < physicalEntries.length; j++) {
    const a = physicalEntries[i]
    const b = physicalEntries[j]
    const prefix = (left, right) => left === right || right.startsWith(`${left}/`)
    const samePhysicalFile = a.identity === b.identity && a.identity.startsWith('inode:')
    if ((samePhysicalFile || prefix(a.physical, b.physical) || prefix(b.physical, a.physical)) && !ordered(a.unit, b.unit)) {
      physicalConflicts.push({ kind: 'physical-path-overlap', paths: [a.file, b.file], physical: [a.physical, b.physical], units: [a.unit, b.unit] })
    }
  }
}
if (physicalConflicts.length) {
  return {
    error: 'Units that can run concurrently overlap physically; no unit was dispatched.',
    conflicts: physicalConflicts,
    fallback: fallbackRoute,
    recommendation: 'Merge overlapping units or declare a real dependency. Shared execution never permits an unsafe fan-out.',
    plan,
  }
}

// Depth is for reporting and merge order only — it never gates execution.
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
  const approvedHash = await planHash(plan)
  return {
    built: false,
    decomposable: true,
    reason: plan.reason,
    units_total: plan.units.length,
    starting_immediately: startable,
    critical_path: criticalPath,
    units: plan.units.map((u) => ({ ...u, depth: depthOf(u.id) })),
    workspace: plan.workspace || 'worktree',
    workspace_reason: plan.workspace_reason || '(private per-unit worktrees are required)',
    working_directory: plan.working_directory,
    base_commit: plan.base_commit,
    plan_payload: plan,
    frozen_plan: plan,
    plan_hash: approvedHash,
    plan_id: approvedHash ? approvedHash.slice(0, 20) : null,
    note: 'No implementer ran and nothing was created. Re-run with build:true to fan out.',
  }
}

const worktreeCommand = '~/.claude/scripts/build-worktree.sh'
const prepareWorktrees = async () => {
  const ids = plan.units.map((unit) => unit.id).join(' ')
  return agent(
    `Prepare one private git worktree for every approved unit. This is a capability
preflight and must fail closed; do not use a shared checkout or guess paths.

REPOSITORY (EXACT): ${plan.working_directory}
BASE COMMIT (EXACT): ${plan.base_commit}
INVOCATION NONCE (EXACT, THIS RUN ONLY): ${invocationNonce}
FROZEN PLAN HASH (EXACT): ${frozenPlanHash}
UNIT IDS (validated slugs): ${ids}

Run exactly:
  root=$(mktemp -d "\${TMPDIR:-/tmp}/claude-build-worktrees.XXXXXXXX")
  token=''
  cleanup() { [ -n "$token" ] && bash ${worktreeCommand} cleanup '${plan.working_directory}' "$root" "$token" '${invocationNonce}' '${frozenPlanHash}' >/dev/null 2>&1 || true; }
  trap cleanup EXIT HUP INT TERM
  token=$(bash ${worktreeCommand} prepare '${plan.working_directory}' '${plan.base_commit}' "$root" '${invocationNonce}' '${frozenPlanHash}' ${ids})
  for id in ${ids}; do
    path="$root/$id"
    bash ${worktreeCommand} create '${plan.working_directory}' '${plan.base_commit}' "$path" "codex-build/\${token:0:12}-$id" '${invocationNonce}' '${frozenPlanHash}'
    seed=$(bash ${worktreeCommand} seed '${plan.working_directory}' "$path" '${invocationNonce}' '${frozenPlanHash}')
    printf 'unit=%s path=%s seed=%s\\n' "$id" "$path" "$seed"
  done
  trap - EXIT HUP INT TERM
  printf 'root=%s token=%s invocation_nonce=%s plan_hash=%s\\n' "$root" "$token" '${invocationNonce}' '${frozenPlanHash}'

Return status=ready only when every create and seed command succeeded, with the
exact root, token, invocation_nonce, plan_hash, and one exact path/seed per unit. Do not modify the canonical checkout.`,
    { label: 'build:prepare-worktrees', phase: 'Build', agentType: 'explorer', schema: WORKTREE_RESULT }
  )
}
const cleanupWorktrees = async (root, token) => {
  if (!root || !root.startsWith('/')) return { status: 'failed', detail: 'Worktree root was not absolute.' }
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return { status: 'failed', detail: 'Worktree run token was missing or invalid.' }
  return agent(
    `Remove exactly this private build-worktree root after all unit integration:
  bash ${worktreeCommand} cleanup '${plan.working_directory}' '${root}' '${token}' '${invocationNonce}' '${frozenPlanHash}'
Return status=cleaned only when the command exits 0. Do not modify repository files.`,
    { label: 'build:cleanup-worktrees', phase: 'Integrate', agentType: 'explorer', schema: { type: 'object', required: ['status'], properties: { status: { enum: ['cleaned', 'failed'] }, detail: { type: 'string' } } } }
  )
}

const prepared = await prepareWorktrees()
if (!prepared || prepared.status !== 'ready' || prepared.invocation_nonce !== invocationNonce || prepared.plan_hash !== frozenPlanHash || !prepared.root || !/^[0-9a-f]{64}$/.test(String(prepared.token || '')) || !Array.isArray(prepared.units)) {
  return { error: 'Per-unit worktree isolation could not be established; no parallel unit was dispatched.', preparation: prepared || { status: 'failed' }, plan }
}
const worktreeRoot = String(prepared.root)
const worktreeRunToken = String(prepared.token || '')
const unitWorktrees = new Map()
const expectedUnits = new Set(plan.units.map((unit) => unit.id))
for (const entry of prepared.units) {
  if (!entry || typeof entry.id !== 'string' || !expectedUnits.has(entry.id) || unitWorktrees.has(entry.id) || typeof entry.path !== 'string' || typeof entry.seed !== 'string' || entry.path !== `${worktreeRoot}/${entry.id}` || entry.path.includes('..')) {
    const cleanup = await cleanupWorktrees(worktreeRoot, worktreeRunToken)
    return { error: 'Worktree preparation returned incomplete or unsafe ownership records; no unit was dispatched.', preparation: prepared, cleanup, plan }
  }
  unitWorktrees.set(entry.id, { path: entry.path, seed: entry.seed })
}
if (unitWorktrees.size !== expectedUnits.size) {
  const cleanup = await cleanupWorktrees(worktreeRoot, worktreeRunToken)
  return { error: 'Worktree preparation omitted a unit; no unit was dispatched.', preparation: prepared, cleanup, plan }
}

// Worktree creation can take time. Recheck after it and immediately before the
// queue opens so a late edit cannot enter a worker snapshot unnoticed.
let finalSnapshot = null
try { finalSnapshot = await approvalSnapshot(plan.working_directory, 'build:final-release-check') } catch (error) {
  const cleanup = await cleanupWorktrees(worktreeRoot, worktreeRunToken)
  return { error: 'Final fingerprint and HEAD verification failed; no unit was dispatched.', detail: String((error && error.message) || error), cleanup, plan }
}
if (!snapshotMatches(plan, finalSnapshot)) {
  const cleanup = await cleanupWorktrees(worktreeRoot, worktreeRunToken)
  return {
    error: 'Frozen plan drifted during preflight; final fingerprint and HEAD verification rejected dispatch.',
    expected_fingerprint: plan.working_tree_fingerprint,
    current_fingerprint: finalSnapshot && finalSnapshot.fingerprint,
    expected_base_commit: plan.base_commit,
    current_head: finalSnapshot && finalSnapshot.current_head,
    cleanup,
    plan,
  }
}

log(`workspace: private worktree per unit${plan.workspace_reason ? ` — ${plan.workspace_reason}` : ''}`)

log(`${plan.units.length} unit(s), ${startable} starting immediately, critical path ${criticalPath} — building`)

// Raw promises, not parallel() — each unit starts the moment its own predecessors go green.
const scheduled = new Map()
const MAX_ACTIVE_IMPLEMENTERS = 3
let activeImplementers = 0
const waitingImplementers = []
const acquireImplementer = () => new Promise((resolve) => {
  if (activeImplementers < MAX_ACTIVE_IMPLEMENTERS) {
    activeImplementers += 1
    resolve()
  } else {
    waitingImplementers.push(resolve)
  }
})
const releaseImplementer = () => {
  const next = waitingImplementers.shift()
  if (next) next()
  else activeImplementers -= 1
}

const serializeIntegration = (() => {
  let tail = Promise.resolve()
  return (operation) => {
    const current = tail.then(operation)
    tail = current.catch(() => {})
    return current
  }
})()

// Worker completion order is deliberately nondeterministic. Keep canonical
// writes deterministic too: topological depth puts true predecessors first,
// while the id tie-breaker makes independent units reproducible. A failed or
// skipped unit still releases its turn so siblings are not stranded behind it.
const integrationTurns = new Map()
let previousIntegrationTurn = Promise.resolve()
for (const unit of plan.units.slice().sort((a, b) => depthOf(a.id) - depthOf(b.id) || a.id.localeCompare(b.id))) {
  let release
  const done = new Promise((resolve) => { release = resolve })
  integrationTurns.set(unit.id, { before: previousIntegrationTurn, release, released: false })
  previousIntegrationTurn = done
}
const runIntegrationTurn = async (u, operation) => {
  const turn = integrationTurns.get(u.id)
  if (!turn) return operation()
  await turn.before
  try {
    return await operation()
  } finally {
    if (!turn.released) {
      turn.released = true
      turn.release()
    }
  }
}
const refreshUnit = (u, state) => serializeIntegration(async () => {
  let refreshed
  try {
    refreshed = await agent(
      `Refresh the exact private worktree for a unit after its dependencies have integrated.
Run exactly:
  seed=$(bash ${worktreeCommand} refresh '${plan.working_directory}' '${state.path}' '${plan.base_commit}' '${worktreeRunToken}' '${invocationNonce}' '${frozenPlanHash}')
  printf 'status=ready seed=%s\\n' "$seed"
The command must return a new seed commit. Do not modify the canonical checkout except
through the helper's source snapshot.`,
    { label: `build:refresh:${u.id}`, phase: 'Build', agentType: 'explorer', schema: { type: 'object', required: ['status', 'seed'], properties: { status: { enum: ['ready', 'failed'] }, seed: { type: 'string' }, detail: { type: 'string' } } } }
    )
  } catch (error) {
    return { status: 'failed', detail: String((error && error.message) || error) }
  }
  if (!refreshed || refreshed.status !== 'ready' || !refreshed.seed) return { status: 'failed', detail: refreshed || 'worktree refresh returned no seed' }
  state.seed = refreshed.seed
  return { status: 'ready' }
})
const integrateUnit = (u, state) => serializeIntegration(async () => {
  const files = u.files.map((file) => shellQuote(file)).join(' ')
  let integrated
  try {
    integrated = await agent(
      `Integrate exactly one completed private unit into the canonical checkout.
Run exactly:
  bash ${worktreeCommand} integrate '${plan.working_directory}' '${state.path}' '${state.seed}' '${plan.working_directory}' '${worktreeRunToken}' '${invocationNonce}' '${frozenPlanHash}' ${files}
The helper must reject every changed path outside the unit's exact owned files and
apply the unit patch only after that check. Do not merge unrelated paths.`,
    { label: `build:integrate:${u.id}`, phase: 'Integrate', agentType: 'explorer', schema: INTEGRATION_RESULT }
    )
  } catch (error) {
    return { status: 'failed', detail: String((error && error.message) || error) }
  }
  return integrated && integrated.status === 'integrated' ? { status: 'integrated' } : { status: 'failed', detail: integrated || 'integration returned no result' }
})

const runUnit = (u) => {
  if (scheduled.has(u.id)) return scheduled.get(u.id)
  const p = (async () => {
    const deps = depsOf(u)
    const depOutcomes = await Promise.all(deps.map((d) => runUnit(byId.get(d))))

    // A dependent must not build atop a unit that never went green — it would rest on nothing.
    const blockedBy = deps.filter((d, i) => !depOutcomes[i] || depOutcomes[i].status !== 'green')
    if (blockedBy.length) {
      log(`skip ${u.id} — dependency not green: ${blockedBy.join(', ')}`)
      await runIntegrationTurn(u, async () => {})
      return { unit: u, status: 'skipped', result: null, blocked_by: blockedBy }
    }

    const state = unitWorktrees.get(u.id)
    if (!state) {
      await runIntegrationTurn(u, async () => {})
      return { unit: u, status: 'error', result: null, error: 'No exact private worktree was prepared for this unit.' }
    }
    const refreshed = await refreshUnit(u, state)
    if (!refreshed || refreshed.status !== 'ready') {
      await runIntegrationTurn(u, async () => {})
      return { unit: u, status: 'error', result: null, error: refreshed && refreshed.detail ? refreshed.detail : 'Private worktree refresh failed.' }
    }

    log(`start ${u.id}`)
    let r = null
    let dispatchError = null
    await acquireImplementer()
    try {
      r = await agent(
      `Build ONE unit of a larger change in the exact private worktree below. Other units may run
concurrently, but no unit shares a writable directory with another.

UNIT: ${u.title}
WORKING DIRECTORY (EXACT PRIVATE WORKTREE): ${state.path}
CANONICAL CHECKOUT (READ-ONLY REFERENCE): ${plan.working_directory}
FILES YOU OWN: ${u.files.join(', ')}
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
commit anything beyond your own unit. The integration helper rejects out-of-scope paths. If your unit turns out to depend on another unit's work,
report \`blocked\` and say which — that is a decomposition error worth knowing about.

YOU ARE IN A PRIVATE WORKTREE. Sibling agents cannot write in this directory. Never run a command
that writes outside your own files: no \`git checkout .\`, no \`git stash\`, no \`git reset\`, no formatter
or codemod over the whole tree. If you must abandon your unit, undo ONLY your own paths
(\`git checkout -- <your files>\`) and report \`failed\`. If your verify_command fails inside a file
you do not own, that is a sibling's in-flight edit, not your bug — report \`blocked\` and name it.`,
        {
          label: `build:${u.id}`,
          phase: 'Build',
          agentType: 'implementer',
          schema: UNIT,
        }
      )
    } catch (e) {
      // One unit throwing must not reject the whole graph — its dependents get skipped, others keep building.
      log(`error ${u.id}: ${e && e.message}`)
      dispatchError = String((e && e.message) || e)
    } finally {
      releaseImplementer()
    }
    if (dispatchError) {
      await runIntegrationTurn(u, async () => {})
      return { unit: u, status: 'error', result: null, error: dispatchError }
    }
    const status = (r && r.status) || 'no-result'
    if (status === 'green') {
      const integrated = await runIntegrationTurn(u, () => integrateUnit(u, state))
      if (!integrated || integrated.status !== 'integrated') {
        log(`integration failed ${u.id}`)
        return { unit: u, status: 'failed', result: r, error: integrated && integrated.detail ? integrated.detail : 'unit patch was not integrated' }
      }
    } else {
      await runIntegrationTurn(u, async () => {})
    }
    log(`${status === 'green' ? 'green' : status} ${u.id}`)
    return { unit: u, status, result: r, worktree: state.path, seed: state.seed }
  })()
  scheduled.set(u.id, p)
  return p
}

let results
let worktreeCleanup = null
try {
  results = await Promise.all(plan.units.map(runUnit))
} finally {
  worktreeCleanup = await cleanupWorktrees(worktreeRoot, worktreeRunToken)
}

phase('Integrate')

const green = results.filter((r) => r.status === 'green')
const deferred = results.filter((r) => r.status === 'deferred')
const failed = results.filter((r) => r.status !== 'green' && r.status !== 'deferred')
const notGreen = results.filter((r) => r.status !== 'green')
const buildable = results.filter((r) => r.status !== 'deferred')
const cleanupReady = worktreeCleanup && worktreeCleanup.status === 'cleaned'

log(deferred.length
  ? `${green.length}/${buildable.length} buildable unit(s) green — ${deferred.length} deferred to the next layer (merge first)`
  : `${green.length}/${results.length} unit(s) green`)

return {
  decomposable: true,
  workspace: 'worktree',
  reason: plan.reason,
  units_total: plan.units.length,
  units_green: green.length,
  critical_path: criticalPath,
  starting_immediately: startable,
  // Merge order follows dependency depth; merging stays manual — an unattended N-way merge is where parallel builds go wrong.
  merge_sequence: green
    // Total order, not just depth — id breaks ties so the merge sequence is reproducible across runs.
    .sort((a, b) => depthOf(a.unit.id) - depthOf(b.unit.id) || a.unit.id.localeCompare(b.unit.id))
    .map((r) => ({
      depth: depthOf(r.unit.id),
      id: r.unit.id,
      title: r.unit.title,
      depends_on: depsOf(r.unit),
      branch: `private worktree: ${r.worktree}`,
      files: r.result.files_changed || r.unit.files,
      verify: r.unit.verify_command,
    })),
  needs_attention: [
    ...notGreen.map((r) => ({
    id: r.unit.id,
    title: r.unit.title,
    status: r.status,
    // A skipped unit was never attempted — the fix is its dependency, not the unit itself.
    blocked_by: r.blocked_by,
    detail: r.status === 'deferred'
      ? r.deferred_because
      : r.status === 'skipped'
        ? `Not built — dependency ${(r.blocked_by || []).join(', ')} did not go green.`
        : (r.result ? (r.result.verify_output || r.result.summary) : (r.error || 'agent returned nothing')),
    remaining: r.result ? r.result.remaining : undefined,
    })),
    ...(!cleanupReady ? [{ status: 'blocked', detail: 'Private worktree cleanup failed; no clean handoff is allowed until the disposable root is removed.' }] : []),
  ],
  worktree_cleanup: worktreeCleanup || { status: 'failed', detail: 'cleanup did not return a result' },
  // Deferred is retained for compatibility with old scheduler results.
  deferred: deferred.map((r) => ({ id: r.unit.id, title: r.unit.title, depth: depthOf(r.unit.id), depends_on: depsOf(r.unit) })),
  cleanup: worktreeCleanup || { status: 'failed', detail: 'cleanup did not return a result' },
  next_step: deferred.length
    ? `Layer complete: ${green.length} of ${buildable.length} buildable unit(s) green. ${deferred.length} unit(s) are deferred; resolve the failed units and re-run /build from the new HEAD.${failed.length ? ' Resolve the failed units first.' : ''}`
    : green.length === results.length
      ? cleanupReady
        ? 'All units green and integrated serially from private worktrees. Review the assembled diff with /review once; guardrail findings require the full /council, then commit.'
        : 'All units green, but private worktree cleanup failed. Resolve cleanup before review or commit.'
      : 'Resolve the units needing attention. Private worktrees were cleaned after integration; re-run the failed unit after fixing its cause. Anything skipped was never built because a dependency failed; fix that dependency first.',
}
