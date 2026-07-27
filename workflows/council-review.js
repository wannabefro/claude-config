export const meta = {
  name: 'council-review',
  description: 'Multi-model council: diverse lenses review a diff, cross-examine each other\'s findings, deadlocks escalate to Fable, then a judge synthesises a verdict',
  whenToUse: 'The default review path for a diff you own — routine or guardrail-critical. Haiku triage sizes the seating, so an ordinary diff pays for two lenses and only auth/payments/migrations/data-mutation/public-API diffs seat the full six. Reach for ce-code-review instead only inside a normal ce-work run, where it is already hardwired.',
  phases: [
    { title: 'Convene', detail: 'five lenses review in parallel on Opus and Sonnet' },
    { title: 'Cross-examine', detail: 'every finding challenged from both tiers' },
    { title: 'Escalate', detail: 'Fable breaks deadlocks and contested criticals only' },
    { title: 'Verdict', detail: 'judge dedupes, ranks, and decides ship / fix-first' },
  ],
}

// Diversity comes from the LENS first and the tier second. Two seats are special:
//   · Codex (OpenAI) is the only member NOT from the Anthropic family, so it is
//     the only one whose blind spots are uncorrelated with the rest. That is
//     worth a standing seat — a unanimous Claude council can be unanimously wrong.
//   · Fable is same-family and is deliberately NOT standing: it is the escalation
//     seat, spent only where the council cannot resolve a finding on its own.
const COUNCIL = [
  { key: 'correctness',     model: 'opus',   brief:
    'Logic errors, off-by-one, null/undefined paths, race conditions, incorrect state transitions, error handling that swallows failures. Trace the actual control flow rather than reading for plausibility.' },
  { key: 'security',        model: 'opus',   brief:
    'Injection, authz/authn gaps, secrets in code or logs, unsafe deserialisation, SSRF, path traversal, TOCTOU, and silent-failure paths where an error is caught and discarded. Assume hostile input everywhere.' },
  { key: 'spec',            model: 'opus',   brief:
    'Does the change actually do what it claims? Derive the intended behaviour from commit messages, PR body, tests and surrounding code, then check the implementation against THAT — not against itself. Flag scope creep and silent behaviour changes.' },
  { key: 'maintainability', model: 'sonnet', brief:
    'Abstraction quality, duplicated logic, growing conditionals, files doing too much, names that mislead, comments that contradict code. Judge against the surrounding codebase style, not an abstract ideal.' },
  { key: 'tests',           model: 'sonnet', brief:
    'Coverage of the changed paths, and whether tests encode the INVARIANT or merely restate the implementation. A test that still passes when the business rule changes is the wrong test. Flag missing edge cases and absent failure-path coverage.' },
  { key: 'outsider', via: 'codex', model: 'sonnet', brief:
    'Whatever a Claude-family reviewer would miss. You have no assigned lens — you are here because you reason differently. Prioritise defects the other members are structurally unlikely to see: unstated assumptions, the problem being solved wrongly, interactions between the diff and code it does not touch.' },
]

// Every finding is challenged from both tiers regardless of who raised it —
// a different lens on the same tier is still an independent read.
const CHALLENGERS = ['opus', 'sonnet']
const ESCALATION_MODEL = 'fable'
// Hard ceiling on the expensive seat: cost must not scale with finding count.
const MAX_ESCALATIONS = 2

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
  },
}

const CHALLENGE = {
  type: 'object',
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does NOT hold' },
    reasoning: { type: 'string' },
    severity_should_be: { enum: ['critical', 'major', 'minor', 'not-a-finding'] },
  },
}

const ADJUDICATION = {
  type: 'object',
  required: ['holds', 'reasoning'],
  properties: {
    holds: { type: 'boolean', description: 'true if the finding is real and should stand' },
    reasoning: { type: 'string', description: 'What the disagreeing challengers each got right and wrong' },
    severity_should_be: { enum: ['critical', 'major', 'minor', 'not-a-finding'] },
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

// args accepts either a plain string (the target) or { target, codexModel }.
const argObj = (args && typeof args === 'object') ? args : {}
const rawTarget = (typeof args === 'string' ? args : argObj.target) || ''
const target = rawTarget.trim()
  || 'the current branch: committed diff against the default branch, plus any uncommitted changes'

// The installed CLI has no model-list subcommand, so this is passed through
// unvalidated; omit it to use whatever ~/.codex/config.toml pins.
const CODEX_MODEL = String(argObj.codexModel || '').trim()
const CODEX_MODEL_FLAG = CODEX_MODEL ? ` -m ${CODEX_MODEL}` : ''

// Repo path matters for approval cost, not just correctness: `cd /some/path &&`
// is a boundary crossing that gates the WHOLE compound command, so a review of
// an out-of-session repo turns ~30 free read-only calls into ~30 approval
// prompts — once per agent, multiplied by the fan-out. `git -C` and absolute
// paths never change directory and stay auto-allowed.
const repoPath = String(argObj.repoPath || '').trim()
const bundlePath = String(argObj.bundlePath || '').trim()
const G = repoPath ? `git -C "${repoPath}"` : 'git'

// Bundle mode exists because instructing agents not to `cd` does not work — they
// do it anyway, and each one costs an approval prompt. With a pre-built bundle
// the members need no shell at all, and are dispatched as `council-reader`,
// which has no Bash tool. Enforcement, not instruction.
const READER = bundlePath ? 'council-reader' : undefined

// Optional: seat only some lenses, e.g. when one has already reported and you
// want the rest without paying for it again.
const wanted = Array.isArray(argObj.lenses) ? argObj.lenses : null
const SEATED = wanted ? COUNCIL.filter((m) => wanted.includes(m.key)) : COUNCIL

const scope = bundlePath ? `
REVIEW TARGET: ${target}

Everything you need has been assembled for you. You have no shell and do not
need one.

**Start by listing the bundle** — Glob \`${bundlePath}/*\` — and read what is
actually there. Do not assume a manifest; bundles differ per review. The naming
convention is a numeric prefix in reading order:

  00-*  a diffstat or summary of what changed
  01-*  the diff itself
  then, per review: each changed file AFTER (line-numbered), its BEFORE
  counterpart where one exists, the relevant tests, config, fixtures, and docs.

Read each changed file in FULL, not just the diff hunks — a hunk read without
its surrounding code is how false findings get made. Where a BEFORE and AFTER
pair exists, compare them rather than trusting the hunk. Cite line numbers from
the line-numbered files. If something you need is genuinely absent from the
bundle, say so rather than guessing.
` : `
REVIEW TARGET: ${target}
${repoPath ? `REPOSITORY: ${repoPath}\n` : ''}
Establish the diff yourself before reviewing. Useful starting points:
  ${G} status --short
  ${G} diff $(${G} merge-base HEAD origin/main 2>/dev/null || ${G} merge-base HEAD main)...HEAD
  ${G} diff                      # uncommitted
${repoPath ? `
IMPORTANT — do NOT \`cd\` into the repository. Use \`git -C "${repoPath}" ...\` for git and
absolute paths under ${repoPath} for file reads. A \`cd\` out of the session
directory requires manual approval for every command that follows it, once per
council member; \`git -C\` and absolute paths do not.

The Read tool may be refused for paths outside the session directory. If it is,
read via Bash with an absolute path instead — \`cat -n "${repoPath}/<file>"\` or
\`sed -n '1,200p' "${repoPath}/<file>"\`.
` : ''}
Read the full content of changed files, not just the hunks — a hunk read in
isolation is how false findings get made.
`

const rubric = `
Report ONLY defects you can substantiate. For each, give a concrete failure
scenario: specific inputs or state leading to a specific wrong outcome. If you
cannot construct one, it is not a finding — omit it.

Do not report: style preferences, hypotheticals with no reachable path,
pre-existing issues the diff does not touch, or speculation about code you did
not read. An empty findings list is a valid and useful result.
`

let escalations = 0

// ---- Triage -----------------------------------------------------------------
// Seating all six lenses at effort:high on every diff is what made this the most
// expensive review path available. One cheap read decides how much council the
// diff has earned. Three properties make that safe to do on Haiku:
//
//   1. It can only ever REMOVE optional lenses. FLOOR is seated unconditionally.
//   2. Any guardrail surface re-seats the full council — the cheap seat is not
//      allowed to decide that auth or a migration is low-risk.
//   3. It fails OPEN. A triage that errors, returns nothing, or returns junk
//      seats everyone. Under-reviewing must never be the failure mode.
//
// An explicit `lenses` arg still wins: naming them is a deliberate choice.
const FLOOR = ['correctness', 'security']

const TRIAGE = {
  type: 'object',
  required: ['risk', 'lenses', 'reason'],
  properties: {
    risk: { enum: ['guardrail', 'normal', 'trivial'] },
    lenses: {
      type: 'array',
      items: { enum: COUNCIL.map((m) => m.key) },
      description: 'Lenses this diff has earned, beyond the mandatory floor.',
    },
    surfaces: { type: 'array', items: { type: 'string' }, description: 'Sensitive surfaces touched, if any' },
    reason: { type: 'string', description: 'One sentence, specific to this diff' },
  },
}

let seated = SEATED
if (!wanted) {
  phase('Triage')
  // try/catch, not just a null check: agent() returns null on a terminal error
  // but can still throw, and an exception here would kill the whole review —
  // the loudest possible way to fail closed on the one seat that must fail open.
  let triage = null
  try {
    triage = await agent(
    `Decide how much review this change has earned. You are the cheapest seat in the
process — your job is sizing, NOT reviewing. Do not report defects.

${scope}

Read the diffstat and the changed file paths. Skim the diff only as far as you
need to classify it.

Return:
- risk: "guardrail" if the diff touches authentication, authorization, payments,
  money movement, database migrations or schema, data deletion, cryptography,
  permissions, or a public API contract. "trivial" only for changes that cannot
  alter behaviour — formatting, comments, docs, dependency version bumps with no
  code change. "normal" for everything else. When torn, pick the higher risk.
- lenses: which of [${COUNCIL.map((m) => m.key).join(', ')}] this diff has earned.
  correctness and security are seated automatically — you do not need to ask for
  them. Add "spec" when the change claims to implement something specific,
  "tests" when it changes behaviour that tests should pin, "maintainability" for
  non-trivial structural change, "outsider" when the change is architectural or
  makes assumptions worth an uncorrelated second opinion.
- reason: one sentence naming what you actually saw in this diff.

Being wrong toward MORE review is cheap. Being wrong toward less is not.`,
      { label: 'triage', phase: 'Triage', model: 'haiku', effort: 'low', schema: TRIAGE, agentType: READER }
    )
  } catch (e) {
    log(`Triage failed (${e && e.message}) — seating the full council (fail-open)`)
    triage = null
  }

  if (!triage || !Array.isArray(triage.lenses)) {
    log('Triage returned nothing usable — seating the full council (fail-open)')
  } else if (triage.risk === 'guardrail') {
    log(`Triage: guardrail surface (${(triage.surfaces || []).join(', ') || 'unspecified'}) — full council regardless`)
  } else {
    const keep = new Set([...FLOOR, ...triage.lenses])
    const picked = COUNCIL.filter((m) => keep.has(m.key))
    // A degenerate pick still gets the floor; it can never seat nobody.
    if (picked.length) {
      seated = picked
      const dropped = COUNCIL.filter((m) => !keep.has(m.key)).map((m) => m.key)
      log(`Triage: ${triage.risk} — ${triage.reason}`)
      if (dropped.length) log(`  seating ${picked.length}/${COUNCIL.length}, standing down: ${dropped.join(', ')}`)
    }
  }
}

phase('Convene')
log(`Convening ${seated.length} of ${COUNCIL.length} lenses on Opus + Sonnet; Fable held in reserve for deadlocks`)

// Pipeline, not barrier: a lens's findings enter cross-examination the moment
// that lens returns, so slow lenses never gate fast ones.
const perLens = await pipeline(
  seated,

  (member) => member.via === 'codex'
    ? agent(
      `You are a HARNESS, not a reviewer. Your only job is to run OpenAI's Codex CLI over this diff
and relay what IT found. You must not review the code yourself.

${scope}

STEP 1 — obtain the diff. If a bundle path appears above, the diff is already at
${bundlePath ? bundlePath + '/01-the-diff.patch' : '(build it yourself)'} — use it directly and run no git commands. Otherwise capture it:
  git diff $(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)...HEAD > /tmp/council-diff.txt
  git diff >> /tmp/council-diff.txt
If the diff is enormous, narrow it to the most consequential files and say which you dropped.

STEP 2 — run Codex in the FOREGROUND with the diff INLINED in the prompt. Codex hangs when a run
needs tool use, so it must not have to read files itself:

  codex exec --sandbox read-only${CODEX_MODEL_FLAG} -c model_reasoning_effort=high "Review this diff and list only
  defects you can substantiate with a concrete failure scenario. For each: title, repo-relative
  file, line if known, severity (critical|major|minor), and the specific inputs or state that
  produce the wrong outcome. Ignore style. Reply as JSON: {\\"findings\\":[...]}.

  <paste the full contents of /tmp/council-diff.txt here>"

Never use run_in_background — a backgrounded Codex run hangs reporting "still running".

STEP 3 — check for the empty-output flake. The run is empty if stdout ends at the echoed prompt with
no model output after it. If so, retry ONCE. If the retry is also empty, return an empty findings
list and say Codex produced no output — do NOT substitute your own review.

CRITICAL: this seat exists because Codex is the only non-Anthropic member of the council. If you
write findings yourself, the council silently loses its one uncorrelated voice and everyone is worse
off. Relay Codex's findings faithfully, including ones you disagree with. Returning nothing is a fine
outcome; fabricating a review is not.`,
      { label: 'lens:outsider(codex)', phase: 'Convene', model: member.model, effort: 'high', schema: FINDINGS }
    )
    : agent(
      `You are the ${member.key.toUpperCase()} member of a review council.\n\n${scope}\n
YOUR LENS — report only through it; other members cover the rest:
${member.brief}
${rubric}`,
      { label: `lens:${member.key}`, phase: 'Convene', model: member.model, effort: 'high', schema: FINDINGS, agentType: READER }
    ),

  (review, member) => {
    const found = (review && review.findings) || []
    if (!found.length) {
      log(`${member.key}: no findings`)
      return []
    }
    log(`${member.key}: ${found.length} finding(s) -> cross-examination`)

    return parallel(found.map((f) => () => {
      const brief = `CLAIM (${f.severity}): ${f.title}
FILE: ${f.file}${f.line ? ':' + f.line : ''}
ASSERTED FAILURE: ${f.why_it_breaks}
CITED EVIDENCE: ${f.evidence || '(none given)'}`

      // Challengers are prompted to REFUTE: a reviewer asked "is this right?"
      // agrees far too readily.
      return parallel(CHALLENGERS.map((fam) => () =>
        agent(
          `You are cross-examining a claim made by another council member. Your job is to REFUTE it.\n\n${scope}\n${brief}

Read the actual code. The claim fails if: the path is unreachable, a guard
elsewhere already prevents it, it misreads the code, it describes pre-existing
behaviour the diff did not introduce, or no concrete input produces the asserted
outcome. Default to refuted=true when genuinely uncertain — an unsubstantiated
finding wastes more of the author's time than a missed minor one.`,
          { label: `challenge:${f.file}@${fam}`, phase: 'Cross-examine', model: fam, effort: 'high', schema: CHALLENGE, agentType: READER }
        )
      )).then(async (votes) => {
        const cast = votes.filter(Boolean)
        const refuted = cast.filter((v) => v.refuted).length
        const unanimousKill = cast.length > 0 && refuted === cast.length
        const unanimousHold = cast.length > 0 && refuted === 0
        const split = cast.length > 1 && !unanimousKill && !unanimousHold

        // A split used to escalate, which fired Fable on ~40% of findings — with
        // only two voters a tie is common, not exceptional. Ties now resolve as
        // refuted, matching the rubric the challengers are given ("default to
        // refuted when uncertain"). Fable is reserved for a contested CRITICAL
        // and hard-capped, so its cost cannot scale with finding count.
        const contestedCritical = f.severity === 'critical' && refuted > 0 && refuted < cast.length
        const stuck = contestedCritical && escalations < MAX_ESCALATIONS
        if (!stuck) {
          if (split) log(`split verdict on "${f.title}" -> refuted (doubt kills; no Fable spend)`)
          return { ...f, lens: member.key, survives: unanimousHold, escalated: false,
                   votes: cast.length, refuted, challenges: cast.map((v) => v.reasoning) }
        }

        escalations += 1
        log(`deadlock on "${f.title}" (${refuted}/${cast.length} refuted) -> escalating to Fable`)
        const ruling = await agent(
          `The council is deadlocked and you are the deciding vote. Two reviewers examined the
same claim and disagreed; one of them is wrong.\n\n${scope}\n${brief}

CHALLENGER POSITIONS:
${cast.map((v, i) => `${i + 1}. ${v.refuted ? 'REFUTES' : 'UPHOLDS'} — ${v.reasoning}`).join('\n')}

Go to the code and settle it. Do not split the difference or restate the
disagreement — decide whether the finding is real, and say specifically what
each side got right and wrong. If it is real but mis-rated, correct the severity.`,
          { label: `escalate:${f.file}`, phase: 'Escalate', model: ESCALATION_MODEL, effort: 'high', schema: ADJUDICATION, agentType: READER }
        )
        const holds = ruling ? ruling.holds : unanimousHold
        return {
          ...f,
          severity: (ruling && ruling.severity_should_be && ruling.severity_should_be !== 'not-a-finding')
            ? ruling.severity_should_be : f.severity,
          lens: member.key, survives: holds, escalated: true,
          votes: cast.length, refuted,
          challenges: cast.map((v) => v.reasoning),
          adjudication: ruling ? ruling.reasoning : '(escalation failed; fell back to challenger majority)',
        }
      })
    }))
  }
)

// The one place a barrier is correct: the judge needs every surviving finding at
// once to dedupe across lenses and rank globally.
const all = perLens.flat().filter(Boolean)
const survivors = all.filter((f) => f.survives)
const killed = all.filter((f) => !f.survives)
log(`${all.length} raised · ${survivors.length} survived · ${killed.length} refuted · ${escalations} escalated to Fable`)

phase('Verdict')

const council = {
  members: seated.length,
  members_available: COUNCIL.length,
  lenses: seated.map((m) => m.key),
  tiers: CHALLENGERS,
  escalation_model: ESCALATION_MODEL,
  raised: all.length,
  survived: survivors.length,
  refuted: killed.length,
  escalated: escalations,
}

if (!survivors.length) {
  return {
    verdict: 'ship',
    summary: `All ${all.length} raised finding(s) were refuted under cross-examination; the council found nothing substantiated.`,
    ranked: [],
    dismissed: killed.map((f) => ({ title: f.title, why_dismissed: f.adjudication || f.challenges[0] || 'refuted by challengers' })),
    council,
  }
}

const verdict = await agent(
  `You are the presiding judge of a review council. ${survivors.length} finding(s) survived
adversarial cross-examination.

${scope}

SURVIVING FINDINGS:
${survivors.map((f, i) => `
${i + 1}. [${f.severity}] ${f.title}
   lens: ${f.lens} — survived ${f.votes - f.refuted}/${f.votes} challenges${f.escalated ? ' (escalated to Fable)' : ''}
   file: ${f.file}${f.line ? ':' + f.line : ''}
   failure: ${f.why_it_breaks}
   challenger objections: ${f.challenges.join(' | ') || '(none)'}${f.adjudication ? `
   Fable ruling: ${f.adjudication}` : ''}`).join('\n')}

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
  { label: 'judge', phase: 'Verdict', model: 'opus', effort: 'high', schema: VERDICT, agentType: READER }
)

return { ...verdict, council }
