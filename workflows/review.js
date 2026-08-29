export const meta = {
  name: 'review',
  description: 'Route an assembled diff to a mechanical, normal, or guardrail review tier',
  whenToUse: 'The default review path after implementation. Mechanical changes use gates and one Opus inspection; normal changes use one Opus reviewer and one Codex Sol outsider; guardrail changes hand off to the full /council.',
  phases: [
    { title: 'Classify', detail: 'Opus xhigh identifies the least risky honest tier' },
    { title: 'Review', detail: 'the selected review seats inspect the assembled diff' },
    { title: 'Report', detail: 'the result names coverage and unavailable reviewers' },
  ],
}

const CLASSIFICATION = {
  type: 'object',
  required: ['tier', 'reason'],
  properties: {
    tier: { enum: ['mechanical', 'normal', 'guardrail'] },
    reason: { type: 'string' },
    surfaces: { type: 'array', items: { type: 'string' } },
    gates: { type: 'array', items: { type: 'string' } },
  },
}

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'severity', 'why_it_breaks'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { enum: ['critical', 'major', 'minor'] },
          why_it_breaks: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
    gates: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const CODEX_RESULT = {
  type: 'object',
  required: ['status', 'findings', 'runner_exit_code'],
  properties: {
    status: { enum: ['reviewed', 'unavailable', 'stalled', 'empty', 'refused', 'blocked', 'failed'] },
    findings: { type: 'array', items: { type: 'object' } },
    runner_exit_code: { type: 'integer', description: 'Exact codex-run.sh exit code. Required for a reviewed result and zero only when the wrapper returned an answer.' },
    detail: { type: 'string' },
  },
}

const BUNDLE_RESULT = {
  type: 'object',
  required: ['status', 'bundle_path'],
  properties: {
    status: { enum: ['ready', 'failed'] },
    bundle_path: { type: 'string' },
    detail: { type: 'string' },
  },
}
const CLEANUP_RESULT = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { enum: ['cleaned', 'failed'] },
    detail: { type: 'string' },
  },
}

const argObj = (args && typeof args === 'object') ? args : {}
const target = String((typeof args === 'string' ? args : argObj.target) || '').trim()
  || 'the current branch diff plus uncommitted changes'
const repoPath = String(argObj.repoPath || '').trim()

const cleanupBundle = async (bundlePath, label) => {
  if (!bundlePath || !bundlePath.startsWith('/')) return { status: 'failed', detail: 'Bundle path was not absolute.' }
  return agent(
    `The final review seat has consumed this canonical bundle. Remove exactly
this one private bundle and nothing else:

  bash ~/.claude/scripts/cleanup-review-bundle.sh '${bundlePath.replaceAll("'", "'\\\"'\\\"'")}'

The cleanup script validates the canonical private temp-directory prefix,
manifest, ownership, and symlink status before deleting. Return status=cleaned
only when the command exits 0. Do not inspect or modify any repository files.`,
    { label, phase: 'Report', model: 'opus', effort: 'xhigh', schema: CLEANUP_RESULT, agentType: 'explorer' }
  )
}

let cleanupResult = null
let bundleOwner = 'review'
const cleanupOnce = async () => {
  if (cleanupResult) return cleanupResult
  cleanupResult = await cleanupBundle(bundlePath, 'review:cleanup')
  return cleanupResult
}

// Build one immutable review input before classification or seating. Every
// reviewer then reads the same base-to-working-tree patch, staged/unstaged
// views, and full tracked/untracked file snapshots. A caller can pass the
// existing bundle when /review hands a guardrail diff to /council.
let bundlePath = String(argObj.bundlePath || '').trim()
const bundleResult = !bundlePath ? await agent(
  `Assemble the canonical review input. Do not review or modify the repository.
Use a private unique directory and restrictive permissions:

  umask 077
  bundle_dir=$(mktemp -d "\${TMPDIR:-/tmp}/claude-review-bundle.XXXXXXXX")
  bash ~/.claude/scripts/review-bundle.sh "${repoPath || '.'}" "$bundle_dir" '${target.replaceAll("'", "'\\\"'\\\"'")}'

The script must finish successfully and print the bundle directory. Return
status=ready and that exact absolute bundle_path. The bundle contains one
canonical base-to-working-tree patch, separate staged and unstaged diagnostic
views, and full before/after contents for every changed tracked or untracked
file. Do not concatenate the diagnostic patches or create a second diff.
If any command fails, return status=failed and do not guess a path.`,
  { label: 'review:assemble-input', phase: 'Classify', model: 'opus', effort: 'xhigh', schema: BUNDLE_RESULT, agentType: 'explorer' }
 ) : null
if (!bundlePath) bundlePath = bundleResult && bundleResult.status === 'ready' ? String(bundleResult.bundle_path || '').trim() : ''
if (!bundlePath) {
  return { tier: 'guardrail', status: 'blocked', reason: 'Canonical review input could not be assembled; no review seat may report clean.' }
}

try {

const classificationScope = `
CLASSIFICATION INPUTS (from one canonical bundle):
Glob ${bundlePath}/* and read 00-manifest.txt and 01-the-diff.patch. Verify that
the manifest's target, base, and head match the requested target before classifying.
The canonical patch is the base-to-working-tree view. 02-staged.patch and
03-unstaged.patch are separate diagnostics; do not concatenate them or count
their hunks twice. Full changed-file snapshots are under files/ and
untracked/. Synthetic additions for bounded untracked files are part of the
canonical patch and must affect risk classification.

For classification, inspect the changed paths, diffstat, and diff hunks above.
Read targeted surrounding code only when it is needed to decide the tier. Do
not read the full changed files during classification. If the tier is uncertain,
choose the higher-risk tier.
`

const reviewScope = `
REVIEW TARGET: ${target}
${repoPath ? `REPOSITORY: ${repoPath}\n` : ''}
REVIEW BUNDLE: ${bundlePath}
Start by listing the bundle and read 00-manifest.txt and 01-the-diff.patch.
Read every changed file in full from files/after/ and untracked/after/ and its
files/before/ counterpart where present. The staged and unstaged patches are
diagnostic views only; do not append them to the canonical patch.
Report only defects with a concrete failure scenario.
`

phase('Classify')
const classification = await agent(
  `Classify this assembled diff for the default review route. Do not review it yet.

${classificationScope}

Return tier "mechanical" only when the change cannot alter behavior: formatting,
comments, generated output, a rename, or a version bump with no code behavior
change. Return "guardrail" for authentication or authorization, payments or
money movement, migrations, schema or data mutation, permissions, secrets or
cryptography, public API contracts, destructive actions, or high-impact
concurrency. Return "normal" for other behavior or structure changes. When
uncertain, choose the higher-risk tier. List the exact relevant gates for a
mechanical change. Give one specific reason.
`, { label: 'review:classify', phase: 'Classify', model: 'opus', effort: 'xhigh', schema: CLASSIFICATION })

const classifiedTier = classification && classification.tier
if (!classification || !classifiedTier) {
  const cleanupResult = await cleanupOnce()
  return {
    tier: 'guardrail',
    status: 'blocked',
    bundle_path: cleanupResult && cleanupResult.status === 'cleaned' ? undefined : bundlePath,
    reason: 'Classification failed; route to the full /council.',
    cleanup: cleanupResult || { status: 'failed', detail: 'Cleanup returned no result.' },
  }
}

const exactGates = Array.isArray(classification.gates)
  ? classification.gates.filter((gate) => typeof gate === 'string' && gate.trim()).map((gate) => gate.trim())
  : []
// A mechanical pass is only honest when it names executable gates. An empty
// or malformed gate list promotes the diff to the normal two-seat review;
// it never becomes an approval-shaped no-op.
const tier = classifiedTier === 'mechanical' && exactGates.length === 0 ? 'normal' : classifiedTier
const tierReason = classifiedTier === 'mechanical' && exactGates.length === 0
  ? `${classification.reason || 'Mechanical classification'} supplied no exact non-empty gates; promoted to normal review.`
  : classification.reason

if (tier === 'guardrail') {
  // Ownership transfers exactly once; /council cleans the shared bundle after its judge.
  bundleOwner = 'council'
  return {
    tier,
    status: 'handoff-required',
    bundle_path: bundlePath,
    reason: tierReason,
    surfaces: classification.surfaces || [],
    next_step: 'Run /council on the assembled diff. Explicit council means full seating and adversarial challenge.',
  }
}

const rubric = `
Report ONLY defects you can substantiate. For each finding give a concrete
failure scenario and the repo-relative file and line when known. Do not report
style preferences, unreachable hypotheticals, or pre-existing issues.

For every new or changed test, require an observable behaviour, invariant, or
plausible regression; a realistic narrow boundary; deterministic proportional
setup; and evidence that removing the guarded behaviour makes the test fail.
Reject tautologies, implementation-mirroring assertions, excessive mocks,
semantically empty snapshots, source-regex or call-count claims, and tests that
only observe serialized execution. For concurrency, require real overlap plus
the safety invariant; for merge and cleanup, require injected failure evidence;
for routing, require a drift, alias, or scope-escape case. Keep policy-text
contract tests only when the deployed text itself is the behaviour.
`

if (tier === 'mechanical') {
  phase('Review')
  const mechanical = await agent(
    `Perform the mechanical review for this assembled diff. Run the exact gates
listed by classification, then inspect the complete diff and full changed files with Opus xhigh.
Do not convene a council and do not write files.

${reviewScope}
EXACT GATES:
${exactGates.map((g) => `- ${g}`).join('\n')}
${rubric}`,
    { label: 'review:mechanical:opus', phase: 'Review', model: 'opus', effort: 'xhigh', schema: FINDINGS })
  if (!mechanical || !Array.isArray(mechanical.findings)) {
    const cleanupResult = await cleanupOnce()
    return {
      tier,
      status: 'blocked',
      bundle_path: cleanupResult && cleanupResult.status === 'cleaned' ? undefined : bundlePath,
      reason: tierReason,
      gates: exactGates,
      reviewer: 'opus-xhigh',
      result: mechanical || { findings: [], summary: 'Opus returned no result.' },
      cleanup: cleanupResult || { status: 'failed', detail: 'Cleanup returned no result.' },
      warning: 'The required Opus mechanical review did not complete. This is a review gap, not approval.',
    }
  }
  const cleanupResult = await cleanupOnce()
  return {
    tier,
    status: cleanupResult && cleanupResult.status === 'cleaned' ? 'reviewed' : 'blocked',
    bundle_path: bundlePath,
    reason: tierReason,
    gates: exactGates,
    reviewer: 'opus-xhigh',
    result: mechanical || { findings: [], summary: 'Opus returned no result.' },
    cleanup: cleanupResult || { status: 'failed', detail: 'Cleanup returned no result.' },
    warning: cleanupResult && cleanupResult.status === 'cleaned' ? null : 'Review completed but the private bundle cleanup did not complete; this is not approval.',
  }
}

phase('Review')
const [opusResult, codexResult] = await parallel([
  () => agent(
    `Perform one independent Opus xhigh review of this assembled diff. Do not
write files and do not dispatch another reviewer. ${reviewScope}${rubric}`,
    { label: 'review:normal:opus', phase: 'Review', model: 'opus', effort: 'xhigh', schema: FINDINGS }),
  () => agent(
    `Act only as a Codex review harness. Do not review the code yourself and do
not write files. Read the canonical review bundle at ${bundlePath}. Build one
temporary private brief with 01-the-diff.patch and the full changed-file
snapshots inline exactly once, then run this fixed command exactly:

  umask 077
  brief_dir="$(mktemp -d "\${TMPDIR:-/tmp}/claude-codex-review.XXXXXXXX")"
  trap 'rm -rf "$brief_dir"' EXIT HUP INT TERM

  ~/.claude/scripts/codex-run.sh -t 900 -s 480 -B '${bundlePath.replaceAll("'", "'\\\"'\\\"'")}' -f <brief-file> -N

The wrapper fixes Codex gpt-5.6-sol at xhigh with MCP disabled. It returns 0
when Codex reviewed, 3 when unavailable, 4 when stalled, 5 when empty, 6 when
the provider refused capacity, 7 when Codex failed, and 8 when the secret scan
refused the transfer. Relay the exact exit code as runner_exit_code. Set status
to reviewed only for exit 0 with a real assistant result. Every non-zero exit
is a missing review seat, including runtime failure; never convert it to an
empty or reviewed result. Never use a model, effort, or writer fallback. If the
command is unavailable, report the gap instead of substituting a review.

${reviewScope}`,
    { label: 'review:normal:codex', phase: 'Review', model: 'opus', effort: 'xhigh', schema: CODEX_RESULT }),
])
const cleanupResult = await cleanupOnce()
const seatsReady = opusResult && Array.isArray(opusResult.findings) && codexResult && codexResult.status === 'reviewed' && codexResult.runner_exit_code === 0
const cleanupReady = cleanupResult && cleanupResult.status === 'cleaned'

return {
  tier,
  ...(tier !== classifiedTier ? { promoted_from: classifiedTier } : {}),
  bundle_path: cleanupReady ? undefined : bundlePath,
  status: seatsReady && cleanupReady
    ? 'reviewed'
    : 'blocked',
  coverage: seatsReady && cleanupReady ? 'complete' : 'degraded',
  reviewers: ['opus-xhigh', 'codex-gpt-5.6-sol-xhigh'],
  opus: opusResult || { findings: [], summary: 'Opus returned no result.' },
  codex: codexResult || { status: 'failed', findings: [], detail: 'Codex harness returned no result.' },
  cleanup: cleanupResult || { status: 'failed', detail: 'Cleanup returned no result.' },
  warning: seatsReady && cleanupReady
    ? null
    : !seatsReady
      ? 'At least one required review seat did not complete. This is a review gap, not approval.'
      : 'Review seats completed but the private bundle cleanup did not complete; this is not approval.',
}
} finally {
  if (bundleOwner === 'review' && bundlePath && !cleanupResult) {
    cleanupResult = await cleanupBundle(bundlePath, 'review:exception-cleanup')
  }
}
