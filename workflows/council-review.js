export const meta = {
  name: 'council-review',
  description: 'Opus review council: diverse lenses review a diff, cross-examine findings, and produce a verified verdict',
  whenToUse: 'The explicit full review path for a diff you own. Opus xhigh performs review, cross-examination, and final verification; Codex provides the outsider lens.',
  phases: [
    { title: 'Convene', detail: 'all six lenses review in parallel on Opus xhigh' },
    { title: 'Cross-examine', detail: 'every finding receives an independent Opus challenge' },
    { title: 'Verdict', detail: 'judge dedupes, ranks, and decides ship / fix-first' },
  ],
}

// Codex is the only non-Anthropic seat, so it stands permanently.
const COUNCIL = [
  { key: 'correctness',     model: 'opus',   brief:
    'Logic errors, off-by-one, null/undefined paths, race conditions, incorrect state transitions, error handling that swallows failures. Trace the actual control flow rather than reading for plausibility.' },
  { key: 'security',        model: 'opus',   brief:
    'Injection, authz/authn gaps, secrets in code or logs, unsafe deserialisation, SSRF, path traversal, TOCTOU, and silent-failure paths where an error is caught and discarded. Assume hostile input everywhere.' },
  { key: 'spec',            model: 'opus',   brief:
    'Does the change actually do what it claims? Derive the intended behaviour from commit messages, PR body, tests and surrounding code, then check the implementation against THAT — not against itself. Flag scope creep and silent behaviour changes.' },
  { key: 'maintainability', model: 'opus', brief:
    'Abstraction quality, duplicated logic, growing conditionals, files doing too much, names that mislead, comments that contradict code. Judge against the surrounding codebase style, not an abstract ideal.' },
  { key: 'tests',           model: 'opus', brief:
    'Coverage of the changed paths, and whether tests encode the INVARIANT or merely restate the implementation. A test that still passes when the business rule changes is the wrong test. Flag missing edge cases and absent failure-path coverage.' },
  { key: 'outsider', via: 'codex', model: 'opus', brief:
    'Whatever a Claude-family reviewer would miss. You have no assigned lens — you are here because you reason differently. Prioritise defects the other members are structurally unlikely to see: unstated assumptions, the problem being solved wrongly, interactions between the diff and code it does not touch.' },
]

// Every finding receives one independent Opus challenge, regardless of who raised it.
const CHALLENGERS = ['opus']

// Batch size 4 keeps one Opus challenge agent per four findings; 12 findings need 3 agents.
const CHALLENGE_BATCH = 4

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
          title: { type: 'string', description: 'One-line claim' },
          file: { type: 'string', description: 'Repo-relative path' },
          line: { type: 'number' },
          severity: { enum: ['critical', 'major', 'minor'] },
          why_it_breaks: { type: 'string', description: 'Concrete failure scenario: inputs/state -> wrong outcome' },
          evidence: { type: 'string', description: 'The code that supports the claim' },
        },
      },
    },
    // Only the Codex seat sets this — it distinguishes a dead CLI from an empty honest review.
    tool_unavailable: {
      type: 'boolean',
      description: 'Codex seat only: true if the Codex CLI could not be run at all (failed preflight, hung, or produced no output on every attempt). Leave false/absent when Codex ran and simply had nothing to report.',
    },
  },
}

// `index` maps a verdict back to its finding; an unindexed verdict is dropped.
const CHALLENGE_BATCH_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'refuted', 'reasoning'],
        properties: {
          index: { type: 'integer', description: 'The [n] index of the claim this verdict is for' },
          refuted: { type: 'boolean', description: 'true if the finding does NOT hold' },
          reasoning: { type: 'string' },
          severity_should_be: { enum: ['critical', 'major', 'minor', 'not-a-finding'] },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['verdict', 'summary', 'ranked'],
  properties: {
    verdict: { enum: ['ship', 'fix-first', 'needs-discussion'] },
    summary: { type: 'string', description: 'Two sentences: the state of this diff and the single most important thing to do' },
    ranked: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'file', 'severity', 'action'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { enum: ['critical', 'major', 'minor'] },
          action: { type: 'string', description: 'What to actually change' },
          council_support: { type: 'string', description: 'Which lenses raised it and how the challenge round went' },
        },
      },
    },
    dismissed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'why_dismissed'],
        properties: { title: { type: 'string' }, why_dismissed: { type: 'string' } },
      },
    },
  },
}

// args accepts either a plain string (the target) or { target, bundlePath }.
const argObj = (args && typeof args === 'object') ? args : {}
const rawTarget = (typeof args === 'string' ? args : argObj.target) || ''
const target = rawTarget.trim()
  || 'the current branch: committed diff against the default branch, plus any uncommitted changes'

// Use setTimeout, not Date.now/performance — only setTimeout exists in this sandbox; set above the 610s retry cap.
const OUTSIDER_DEADLINE_MS = Number(argObj.outsiderDeadlineMs) > 0
  ? Number(argObj.outsiderDeadlineMs)
  : 15 * 60 * 1000

const OUTSIDER_TIMED_OUT = { __outsiderTimedOut: true }

// Resolves to OUTSIDER_TIMED_OUT on overrun; the agent keeps its slot since cancellation isn't offered.
const withDeadline = (p, ms) => {
  let timer
  return Promise.race([
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); return v },
      (e) => { clearTimeout(timer); throw e },
    ),
    new Promise((resolve) => { timer = setTimeout(() => resolve(OUTSIDER_TIMED_OUT), ms) }),
  ])
}

// Distinguishes Codex finding nothing from Codex never reporting — only the latter must be flagged, per rules/pipeline.md.
let outsiderStatus = 'not-seated'
let challengeFailures = 0

const repoPath = String(argObj.repoPath || '').trim()
let bundlePath = String(argObj.bundlePath || '').trim()

const cleanupBundle = async (path) => {
  if (!path || !path.startsWith('/')) return { status: 'failed', detail: 'Bundle path was not absolute.' }
  return agent(
    `All council lenses, challenges, and the judge have consumed this canonical
bundle. Remove exactly this one private bundle and nothing else:

  bash ~/.claude/scripts/cleanup-review-bundle.sh '${path.replaceAll("'", "'\\\"'\\\"'")}'

Return status=cleaned only when the command exits 0. The cleanup script validates
the canonical private temp-directory prefix, manifest, ownership, and symlink
status before deleting. Do not inspect or modify repository files.`,
    { label: 'council:cleanup-bundle', phase: 'Verdict', model: 'opus', effort: 'xhigh', schema: { type: 'object', required: ['status'], properties: { status: { enum: ['cleaned', 'failed'] }, detail: { type: 'string' } } }, agentType: 'explorer' }
  )
}

let cleanupResult = null
const cleanupOnce = async () => {
  if (cleanupResult) return cleanupResult
  cleanupResult = await cleanupBundle(bundlePath)
  return cleanupResult
}

// Build one immutable snapshot for all six lenses. This keeps parallel seats
// on identical committed/staged/unstaged/untracked input and avoids each seat
// creating a subtly different patch.
if (!bundlePath) {
  const bundleResult = await agent(
    `Assemble the canonical review input. Do not review or modify the repository.
Use a private unique directory and restrictive permissions:

  umask 077
  bundle_dir=$(mktemp -d "\${TMPDIR:-/tmp}/claude-review-bundle.XXXXXXXX")
  bash ~/.claude/scripts/review-bundle.sh "${repoPath || '.'}" "$bundle_dir" '${target.replaceAll("'", "'\\\"'\\\"'")}'

Return the exact absolute bundle directory printed by the script as bundle_path.
It must contain one canonical base-to-working-tree patch, separate staged and
unstaged diagnostic views, and full before/after contents for every changed
tracked and untracked file. Do not concatenate patches or create a second diff.
Return status=failed if any command fails; never guess a path.`,
    { label: 'council:assemble-input', phase: 'Convene', model: 'opus', effort: 'xhigh', schema: { type: 'object', required: ['status', 'bundle_path'], properties: { status: { enum: ['ready', 'failed'] }, bundle_path: { type: 'string' } } }, agentType: 'explorer' }
  )
  bundlePath = bundleResult && bundleResult.status === 'ready' ? String(bundleResult.bundle_path || '').trim() : ''
}
if (!bundlePath) return { verdict: 'needs-discussion', status: 'blocked', summary: 'The canonical review input could not be assembled; no council seat may report clean.', ranked: [], dismissed: [], council: { members: COUNCIL.length, members_available: 0, unavailable_members: COUNCIL.map((m) => m.key) } }

try {

// Bundle mode removes the need for a shell entirely — members dispatch as `council-reader`, which has no Bash tool.
const READER = bundlePath ? 'council-reader' : undefined

// Explicit /council always seats the complete roster. Risk classification belongs to /review.
const SEATED = COUNCIL
const lensAvailability = new Map(SEATED.map((member) => [member.key, 'pending']))

const scope = `
REVIEW TARGET: ${target}

Everything you need has been assembled for you. You have no shell and do not
need one.

**Start by listing the bundle** — Glob \`${bundlePath}/*\` — and read what is
actually there. Do not assume a manifest; bundles differ per review. The naming
convention is a numeric prefix in reading order:

 00-*  a diffstat or summary of what changed
  01-*  the canonical base-to-working-tree diff
  02-*  the staged diagnostic view (never concatenate with 01)
  03-*  the unstaged diagnostic view (never concatenate with 01)
  files/after/ and untracked/after/: full changed-file contents
  files/before/: full base counterparts where they exist

Read each changed file in FULL, not just the diff hunks — a hunk read without
its surrounding code is how false findings get made. Where a BEFORE and AFTER
pair exists, compare them rather than trusting the hunk. Cite line numbers from
the line-numbered files. If something you need is genuinely absent from the
bundle, say so rather than guessing.
`

const rubric = `
Report ONLY defects you can substantiate. For each, give a concrete failure
scenario: specific inputs or state leading to a specific wrong outcome. If you
cannot construct one, it is not a finding — omit it.

Do not report: style preferences, hypotheticals with no reachable path,
pre-existing issues the diff does not touch, or speculation about code you did
not read. An empty findings list is a valid and useful result.

For every new or changed test, require one observable behaviour, invariant, or
plausible regression, a realistic narrow boundary, deterministic proportional
setup, and evidence that removing the guarded behaviour makes it fail. Reject
tautologies, implementation-mirroring assertions, excessive mocks, empty
snapshots, source-regex or call-count claims, and tests that merely observe
serialized execution. Concurrency needs real overlap plus its safety invariant;
merge and cleanup need injected failures; routing needs drift, alias, or scope
escape cases. Keep policy-text contract tests only when deployed text itself is
the behaviour.
`

phase('Convene')
log(`Convening all ${SEATED.length} council lenses on Opus xhigh; Codex remains the outsider lens`)

// Pipeline, not barrier — a lens enters cross-examination the moment it returns, so slow lenses don't gate fast ones.
const perLens = await pipeline(
  SEATED,

  (member) => member.via === 'codex'
    ? withDeadline(Promise.resolve(agent(
      `You are a HARNESS, not a reviewer. Your only job is to run OpenAI's Codex CLI over this diff
and relay what IT found. You must not review the code yourself.

${scope}

STEP 0 — PREFLIGHT, and treat it as a hard gate. Run exactly:

  /usr/bin/perl -e 'alarm shift; exec @ARGV' 10 codex --version; echo "EXIT:$?"

\`--version\` needs no network, no auth and no model, so it is the cheapest possible
proof the binary starts at all. If it prints EXIT:124, prints nothing, or errors,
the CLI is wedged — **return \`{"findings": [], "tool_unavailable": true}\` immediately**.
Set \`tool_unavailable\` on ANY path where Codex never produced a review: failed preflight,
both attempts hung, or empty output every time. Leave it false ONLY when Codex actually ran
and had nothing to report — the council reports those two outcomes differently, and marking a
dead CLI as "reviewed, no findings" is worse than reporting nothing at all.
Do NOT load codex-exec-recovery, do NOT retry, do NOT hunt or kill
processes, do NOT poll a backgrounded run. That recovery path is for a flaky
single run against a working CLI; against a dead one it is a 19-minute walk to
the same empty result, and this seat is what the judge waits for. A fast honest
"Codex unavailable" is worth far more to the council than a slow one.

STEP 1 — obtain the diff. The canonical diff is already at
${bundlePath}/01-the-diff.patch. Read it directly and run no git commands.
The full changed-file snapshots in ${bundlePath}/files/ and
${bundlePath}/untracked/ are part of the input. Do not append 02-staged.patch
or 03-unstaged.patch; they are diagnostics and would duplicate hunks.
If the diff is enormous, narrow it to the most consequential files and say which you dropped.

STEP 2 — run Codex through the wrapper, with the diff INLINED and exploration FORBIDDEN.

Two things kill this seat, and both are in your control:

  (a) Codex explores the repo instead of reviewing. Measured 2026-08-03: with the diff already
      inlined, it still ran \`sed -n '1,220p' package.json\` and friends until the timeout killed
      it — twice, burning the whole budget for zero output. The prompt MUST forbid it outright.
  (b) The run is killed before it speaks. At xhigh reasoning effort it can think for 4-5 minutes
      before emitting a byte. A 300s cap is not enough; silence is not a hang.

Use the wrapper, which enforces the timeout and the quiet threshold and gives you an exit code to
branch on. Do NOT hand-roll \`timeout … codex exec\`:

  umask 077
  brief_dir="$(mktemp -d "\${TMPDIR:-/tmp}/claude-codex-brief.XXXXXXXX")"
  trap 'rm -rf "$brief_dir"' EXIT HUP INT TERM
  cat > "$brief_dir/codex-brief.txt" <<'EOF'
  Review this diff and list only defects you can substantiate with a concrete failure scenario.
  For each: title, repo-relative file, line if known, severity (critical|major|minor), and the
  specific inputs or state that produce the wrong outcome. Ignore style.
  Reply as JSON: {"findings":[...]}.

  HARD CONSTRAINT: Do NOT read files, run shell commands, or search the repo. Everything you need
  is below. A run that explores the repo is a failed run.

  <paste the full contents of ${bundlePath}/01-the-diff.patch and the full changed-file snapshots here>
  EOF
  ~/.claude/scripts/codex-run.sh -t 900 -s 480 -B '${bundlePath.replaceAll("'", "'\\\"'\\\"'")}' -f "$brief_dir/codex-brief.txt" -N > "$brief_dir/codex-out.txt" 2>"$brief_dir/codex-err.txt"
  echo "EXIT:$?"

Branch on the exit code, never on how the output looks:
  0 — Codex reviewed. Parse the JSON after the echoed prompt and relay its findings.
  3 — CLI unavailable → \`{"findings": [], "tool_unavailable": true}\`.
  4 — stalled and killed → retry ONCE, then \`tool_unavailable: true\` if it stalls again.
  5 — empty pass → \`{"findings": [], "tool_unavailable": true}\`. Codex produced no review.

Never use run_in_background, and never poll a backgrounded run with a \`while kill -0\` loop or a
Monitor — a backgrounded Codex run hangs reporting "still running", and the polling is what turns a
hang into a twenty-minute one.

STEP 3 — the wrapper already detects the empty-output flake and the stall for you; that is what
exit 5 and exit 4 mean. Retry ONCE on either, then report \`tool_unavailable: true\` — do NOT
substitute your own review.

BUDGET — you have at most TWO wrapper invocations plus the preflight.
That is the whole allowance. When it is spent, return what you have. Never kill stray processes and
start again: if Codex is leaving processes behind, that is a machine problem to report, not one to
work around inside a review.

CRITICAL: this seat exists because Codex is the only non-Anthropic member of the council. If you
write findings yourself, the council silently loses its one uncorrelated voice and everyone is worse
off. Relay Codex's findings faithfully, including ones you disagree with. Returning nothing is a fine
outcome; fabricating a review is not.`,
      { label: 'lens:outsider(codex)', phase: 'Convene', model: member.model, effort: 'xhigh', schema: FINDINGS }
    )).catch(() => null), OUTSIDER_DEADLINE_MS).then((r) => {
      if (r === OUTSIDER_TIMED_OUT) {
        outsiderStatus = 'timed-out'
        lensAvailability.set(member.key, 'unavailable')
        log(`outsider (codex) overran ${Math.round(OUTSIDER_DEADLINE_MS / 60000)}min — proceeding without the cross-family lens`)
        return { findings: [] }
      }
      const valid = r && Array.isArray(r.findings)
      const n = valid ? r.findings.length : 0
      outsiderStatus = !valid ? 'failed'
        : r.tool_unavailable ? 'unavailable'
        : n ? 'reported' : 'empty'
      lensAvailability.set(member.key, outsiderStatus === 'reported' || outsiderStatus === 'empty' ? 'available' : 'unavailable')
      // Normalises agent()'s null-on-error into one shape — timeout, failure, empty, or reported — for every caller.
      return r || { findings: [] }
    })
    : Promise.resolve(agent(
      `You are the ${member.key.toUpperCase()} member of a review council.\n\n${scope}\n
YOUR LENS — report only through it; other members cover the rest:
${member.brief}
${rubric}`,
      { label: `lens:${member.key}`, phase: 'Convene', model: member.model, effort: 'xhigh', schema: FINDINGS, agentType: READER }
    )).catch(() => null).then((r) => {
      const valid = r && Array.isArray(r.findings)
      lensAvailability.set(member.key, valid ? 'available' : 'unavailable')
      return r
    }),

  async (review, member) => {
    const found = (review && review.findings) || []
    if (!found.length) {
      log(`${member.key}: no findings`)
      return []
    }
    log(`${member.key}: ${found.length} finding(s) -> cross-examination`)

    // Batches challengers instead of one agent per finding per family — unbatched, this was 84% of workflow cost.
    const batches = []
    for (let i = 0; i < found.length; i += CHALLENGE_BATCH) batches.push(found.slice(i, i + CHALLENGE_BATCH))
    if (found.length > CHALLENGE_BATCH) {
      log(`${member.key}: ${found.length} findings -> ${batches.length} batch(es) x ${CHALLENGERS.length} Opus challenger = ${batches.length * CHALLENGERS.length} agents`)
    }

    const batchVotes = await parallel(batches.flatMap((batch, bi) => CHALLENGERS.map((fam) => () => {
      const claims = batch.map((f, i) => `[${i}] CLAIM (${f.severity}): ${f.title}
    FILE: ${f.file}${f.line ? ':' + f.line : ''}
    ASSERTED FAILURE: ${f.why_it_breaks}
    CITED EVIDENCE: ${f.evidence || '(none given)'}`).join('\n\n')
      return Promise.resolve(agent(
        `You are cross-examining ${batch.length} claim(s) made by another council member. Your job is
to REFUTE them. Judge each claim ON ITS OWN — a weak claim next to a strong one
is still weak, and a strong one next to a weak one is still strong.\n\n${scope}\n${claims}

Read the actual code for each. A claim fails if: the path is unreachable, a guard
elsewhere already prevents it, it misreads the code, it describes pre-existing
behaviour the diff did not introduce, or no concrete input produces the asserted
outcome. Default to refuted=true when genuinely uncertain — an unsubstantiated
finding wastes more of the author's time than a missed minor one.

Return one verdict per claim, using the [index] shown above.`,
        { label: `challenge:${member.key}#${bi}@${fam}`, phase: 'Cross-examine', model: fam, effort: 'xhigh', schema: CHALLENGE_BATCH_SCHEMA, agentType: READER }
      )).then((r) => ({
        bi,
        verdicts: (r && Array.isArray(r.verdicts)) ? r.verdicts : [],
        valid: !!(r && Array.isArray(r.verdicts) && r.verdicts.length === batch.length),
      })).catch(() => ({ bi, verdicts: [], valid: false }))
    })))

    // Regroup batch verdicts onto individual findings; a missing verdict reads as weaker evidence, not agreement.
    const votesFor = new Map()
    for (const bv of batchVotes.filter(Boolean)) {
      if (bv.valid === false) challengeFailures += 1
      for (const v of bv.verdicts) {
        const f = batches[bv.bi] && batches[bv.bi][v.index]
        if (!f) continue
        if (!votesFor.has(f)) votesFor.set(f, [])
        votesFor.get(f).push(v)
      }
    }

    return parallel(found.map((f) => () => {
      return Promise.resolve(votesFor.get(f) || []).then(async (votes) => {
        const cast = votes.filter(Boolean)

        // An unchallenged finding must surface, not vanish as refuted — mark it unverified for the judge.
        if (!cast.length) {
          log(`no challenger verdict for "${f.title}" — surfacing it unchallenged`)
          return { ...f, lens: member.key, survives: true, escalated: false,
                   votes: 0, refuted: 0, unchallenged: true,
                   challenges: ['no challenger returned a verdict; finding is unverified, not confirmed'] }
        }
        const refuted = cast.filter((v) => v.refuted).length
        // CHALLENGERS has one Opus seat, so one upheld verdict is enough to keep a finding.
        const holds = refuted === 0
        return {
          ...f,
          lens: member.key, survives: holds, escalated: false,
          votes: cast.length, refuted,
          challenges: cast.map((v) => v.reasoning),
        }
      })
    }))
  }
)

// The judge needs every surviving finding at once, so a barrier is correct here.
const all = perLens.flat().filter(Boolean)
const survivors = all.filter((f) => f.survives)
const killed = all.filter((f) => !f.survives)
const unavailableMembers = SEATED.filter((member) => lensAvailability.get(member.key) !== 'available').map((member) => member.key)
const membersAvailable = SEATED.length - unavailableMembers.length
const allRequiredSeatsReady = unavailableMembers.length === 0
log(`${all.length} raised · ${survivors.length} survived · ${killed.length} refuted · 0 escalated (single Opus challenger)`)

phase('Verdict')

// 'reported'/'empty' mean Codex ran; 'timed-out'/'failed' mean the council was effectively all-Anthropic — state it, don't infer it.
const crossFamily = outsiderStatus === 'reported' || outsiderStatus === 'empty'

const council = {
  members: SEATED.length,
  members_available: membersAvailable,
  unavailable_members: unavailableMembers,
  challenge_failures: challengeFailures,
  status: allRequiredSeatsReady ? 'complete' : 'blocked',
  lenses: SEATED.map((m) => m.key),
  tiers: CHALLENGERS,
  raised: all.length,
  survived: survivors.length,
  refuted: killed.length,
  // Retained as a result-shape compatibility field; the single challenger makes escalation unreachable.
  escalated: 0,
  outsider: outsiderStatus,
  cross_family_review: crossFamily,
}

// A missing lens is a coverage failure, not an empty review. Never let a
// partial council produce a clean or shippable verdict.
if (!allRequiredSeatsReady || challengeFailures > 0) {
  const cleanup = await cleanupOnce()
  return {
    verdict: 'needs-discussion',
    status: 'blocked',
    summary: `Council blocked: ${unavailableMembers.length ? `required seat(s) did not return a valid review (${unavailableMembers.join(', ')}).` : ''}${challengeFailures ? ` ${challengeFailures} challenge seat(s) did not return a complete verdict.` : ''} No clean or ship verdict is allowed until every required seat is available.`,
    ranked: survivors.map((f) => ({ ...f, action: 'Resolve the blocked council seat and re-run the full council.' })),
    dismissed: [],
    council,
    cleanup,
  }
}

const OUTSIDER_REASON = {
  'timed-out': `overran its ${Math.round(OUTSIDER_DEADLINE_MS / 60000)}min deadline`,
  unavailable: 'could not run the Codex CLI at all',
  failed: 'failed to report',
  'not-seated': 'was not seated',
}
const outsiderReason = OUTSIDER_REASON[outsiderStatus] || 'did not report'

const outsiderCaveat = crossFamily ? '' :
  ` NOTE: the Codex outsider seat ${outsiderReason},` +
  ' so every finding here comes from one model family and correlated blind spots are not ruled out.'

if (!survivors.length) {
  const cleanup = await cleanupOnce()
  if (!cleanup || cleanup.status !== 'cleaned') {
    return {
      verdict: 'needs-discussion',
      status: 'blocked',
      summary: 'Council completed without surviving findings, but the private review bundle could not be cleaned up; no ship verdict is allowed.',
      ranked: [],
      dismissed: [],
      council,
      cleanup: cleanup || { status: 'failed', detail: 'Cleanup returned no result.' },
    }
  }
  return {
    verdict: 'ship',
    summary: `All ${all.length} raised finding(s) were refuted under cross-examination; the council found nothing substantiated.${outsiderCaveat}`,
    ranked: [],
    dismissed: killed.map((f) => ({ title: f.title, why_dismissed: f.challenges[0] || 'refuted by challenger' })),
    council,
    cleanup,
  }
}

const verdict = await agent(
  `You are the presiding judge of a review council. ${survivors.length} finding(s) survived
adversarial cross-examination.
${crossFamily ? '' : `
IMPORTANT — the Codex outsider seat ${outsiderReason}, so this council was
effectively single-family. Say so in your summary. It does not weaken any finding
that DID survive — those stand on their own evidence — but it does mean the review
cannot claim to have ruled out blind spots common to one model family, and a
guardrail-critical diff may deserve an explicit cross-family pass before shipping.
`}
${scope}

SURVIVING FINDINGS:
${survivors.map((f, i) => `
${i + 1}. [${f.severity}] ${f.title}
   lens: ${f.lens} — survived ${f.votes - f.refuted}/${f.votes} challenges
   file: ${f.file}${f.line ? ':' + f.line : ''}
   failure: ${f.why_it_breaks}
   challenger objections: ${f.challenges.join(' | ') || '(none)'}`).join('\n')}

REFUTED (context only — do not resurrect without new evidence):
${killed.map((f) => `- ${f.title} (${f.lens})`).join('\n') || '(none)'}

Merge findings that are the same underlying defect seen through different lenses —
report the defect once, noting which lenses converged on it. Convergence across
lenses is strong signal; weight it. Rank by real blast radius, not by the label
the finder chose; downgrade anything whose challenger objections were partly
right. Verify each surviving finding against the code yourself before ranking it —
you are the last gate, not a formatter.

verdict: "fix-first" if anything critical or genuinely major survives, "ship" if
only minor items remain, "needs-discussion" if the right fix is a judgement call
for the author.`,
  { label: 'judge', phase: 'Verdict', model: 'opus', effort: 'xhigh', schema: VERDICT, agentType: READER }
)
const cleanup = await cleanupOnce()
if (!cleanup || cleanup.status !== 'cleaned') {
  return {
    verdict: 'needs-discussion',
    status: 'blocked',
    summary: 'Council completed, but the private review bundle could not be cleaned up; no verdict is allowed until the cleanup is complete.',
    ranked: [],
    dismissed: [],
    council,
    cleanup: cleanup || { status: 'failed', detail: 'Cleanup returned no result.' },
  }
}

return { ...verdict, council, cleanup }
} finally {
  if (bundlePath && !cleanupResult) cleanupResult = await cleanupBundle(bundlePath)
}
