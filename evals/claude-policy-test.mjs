import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const configRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]+$/, '') || '/'
const settings = JSON.parse(read('settings.json'))
const marketplace = JSON.parse(read('marketplace/.claude-plugin/marketplace.json'))
const design = JSON.parse(read('manifests/design.json'))
const implementationAgent = read('agents/implementer.md')
const build = read('workflows/build-parallel.js')
const council = read('workflows/council-review.js')
const direct = read('commands/implement.md')
const review = read('commands/review.md')
const reviewWorkflow = read('workflows/review.js')
const wrapper = read('scripts/luna-run.sh')
const codexRun = read('scripts/codex-run.sh')
const preflight = read('scripts/codex-preflight.sh')
const secretScanner = read('scripts/review-secret-scan.sh')
const worktree = read('scripts/build-worktree.sh')
const pathFilter = read('scripts/path-clean.py')
const claude = read('CLAUDE.md')
const plan = read('commands/plan.md')
const recovery = read('skills/codex-exec-recovery/SKILL.md')
const routing = read('rules/routing.md')
const pipeline = read('rules/pipeline.md')
const orchestration = read('rules/orchestration.md')
const guardrailHook = read('hooks/pr-guardrail-review.sh')
const attributes = read('.gitattributes')
const installer = read('install.sh')
const readme = read('README.md')
const principles = read('rules/principles.md')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

check('default model remains Opus one-million context', settings.model === 'opus[1m]')
check('persisted effort uses xhigh', settings.effortLevel === 'xhigh')
check('global worker ceiling is three', settings.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS === '3')
check('experimental agent teams are absent', !('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS' in settings.env))
check('disabled automatic feature-dev', settings.enabledPlugins['feature-dev@claude-plugins-official'] === false)
check('disabled automatic looper', settings.enabledPlugins['looper@sam'] === false)
check('Superpowers remains explicitly disabled', settings.enabledPlugins['superpowers@claude-plugins-official'] === false)
check('OpenAI Codex plugin route is explicitly disabled and unregistered', settings.enabledPlugins['codex@openai-codex'] === false && !('openai-codex' in settings.extraKnownMarketplaces))
check('direct Codex exec permission is removed', !settings.permissions.allow.some((permission) => permission.startsWith('Bash(codex exec ')))
check('standalone Impeccable is not desired', !Object.keys(settings.enabledPlugins).some((k) => k.startsWith('impeccable@')))
check('tier-router marketplace is absent', !('claude-tier-router' in settings.extraKnownMarketplaces) && !('tier-router@claude-tier-router' in settings.enabledPlugins))
check('old Claude design permissions are absent', !settings.permissions.allow.some((x) => x.includes('claude-design')))
const placeholderWrapperPermission = 'Bash(bash __CLAUDE_HOME__/scripts/luna-run.sh *)'
const materializedWrapperPermission = `Bash(bash ${configRoot}/scripts/luna-run.sh *)`
const fixedWrapperPermissions = new Set([placeholderWrapperPermission, materializedWrapperPermission])
const isFixedWrapperPermission = (permission) => fixedWrapperPermissions.has(permission)
const onlyFixedLunaPermissions = (permissions) => {
  const lunaRunPermissions = permissions.filter((permission) => permission.includes('luna-run.sh'))
  return lunaRunPermissions.length > 0 && lunaRunPermissions.every(isFixedWrapperPermission)
}
check('settings allow only the fixed wrapper command', onlyFixedLunaPermissions(settings.permissions.allow))
check('wrapper permission predicate rejects an arbitrary Luna-run path', onlyFixedLunaPermissions([placeholderWrapperPermission]) && !onlyFixedLunaPermissions([placeholderWrapperPermission, 'Bash(bash /tmp/other/luna-run.sh *)']))
check('CodeRabbit marketplace uses strict validation', marketplace.plugins.find((p) => p.name === 'coderabbit')?.strict === true)
check('tier-router file is removed', !existsSync(new URL('../tier-router.json', import.meta.url)))

const frontmatter = implementationAgent.split('---')[1] || ''
check('implementer is pinned to Opus xhigh', /model:\s*opus/.test(frontmatter) && /effort:\s*xhigh/.test(frontmatter))
check('implementer has no native writer capabilities', !/(^|\n)\s*-\s*(Write|Edit|NotebookEdit|Skill|Agent)\s*$/m.test(frontmatter), frontmatter)
check('implementer calls the fixed Luna wrapper', implementationAgent.includes('scripts/luna-run.sh') && implementationAgent.includes('exactly once'))
check('settings and implementer use explicit content-bound filters', attributes.includes('settings.json filter=claudesettings') && attributes.includes('agents/implementer.md filter=claudehome') && pathFilter.includes('content-agnostic') && installer.includes('filter.claudesettings.required true') && installer.includes('filter.claudehome.required true'))
check('implementer home path is materialized at install time', attributes.includes('agents/implementer.md filter=claudehome') && installer.includes('checkout -- settings.json agents/implementer.md') && installer.includes('path-clean.py'))
check('deep reasoner is Opus xhigh', /model:\s*opus/.test(read('agents/deep-reasoner.md')) && /effort:\s*xhigh/.test(read('agents/deep-reasoner.md')))
check('no permanent designer agent exists', !existsSync(new URL('../agents/designer.md', import.meta.url)) && read('rules/orchestration.md').includes('no permanent designer agent'))
check('four-role roster is documented', ['explorer', 'planner', 'reviewer', 'worker'].every((name) => read('rules/orchestration.md').includes(`\`${name}\``)))

check('build schema has only parallel and serial routes', /enum: \['parallel', 'serial'\]/.test(build) && !/enum: \['parallel', 'ce-work', 'inline'\]/.test(build))
check('build is reserved for structured work', !/Use `\/build` for every implementation request/.test(read('commands/build.md')) && /structured work/.test(read('commands/build.md')))
check('CE preserves the Luna writer boundary and returns by scope', /never replaces the Luna writer\s+boundary/.test(read('commands/build.md')) && /returns through\s+`\/implement` or `\/build`, according to scope/.test(read('commands/build.md')) && !read('commands/build.md').includes('never replaces `/build` for code'))
check('build has a hard three-worker ceiling', /MAX_ACTIVE_IMPLEMENTERS = 3/.test(build) && /acquireImplementer/.test(build))
check('build freezes and rechecks the full index and working-tree fingerprint before queue release', /working_tree_fingerprint/.test(build) && /build:freeze-fingerprint/.test(build) && /build:approval-snapshot/.test(build) && /build:final-release-check/.test(build) && /hash-object --no-filters/.test(build) && /relevant untracked state changed/.test(build))
check('build freezes ignored dependency baselines and routes by maximum DAG frontier', build.includes('ignored_dependencies') && build.includes('frontier_width') && build.includes('maximum DAG frontier width >= 2'))
check('build integrates in completion order behind a canonical read/write lock while preserving dependency gates', build.includes('completion order') && build.includes('canonicalLock') && build.includes('canonicalLock.read') && build.includes('canonicalLock.write') && !build.includes('integrationTurns'))
check('orchestration freezes dependency constraints and completion-order integration', /does not freeze a total integration\s+order/.test(orchestration) && /eligible for integration in completion order under one canonical writer lock/.test(orchestration) && orchestration.includes('head-of-line blocking') && !/integrates patches serially in dependency order/.test(orchestration))
check('parallel build uses private worktrees and canonical ownership checks', /WORKTREE_ISOLATION_SUPPORTED = true/.test(build) && /build:path-ownership/.test(build) && /physical-path-overlap/.test(build) && /build:prepare-worktrees/.test(build) && /build-worktree\.sh/.test(build))
check('parallel build creates a cryptographic invocation nonce before any agent and binds helper identity to the frozen plan', build.includes('randomBytes(32).toString(\'hex\')') && build.indexOf('const invocationNonce') < build.indexOf('let plan') && build.includes('invocation_nonce') && build.includes('frozenPlanHash'))
check('worktree cleanup is journaled and resumable', worktree.includes('cleanup recovery required') && worktree.includes('.cleanup.journal') && worktree.includes('unit.$unit.state=') && worktree.includes('worktree_unregistered_path'))
check('Git registry validation uses NUL framing and validates bare, locked, and prunable records', worktree.includes('worktree list --porcelain -z') && worktree.includes('parse-worktrees-z') && worktree.includes('locked\\ *') && worktree.includes('prunable\\ *') && worktree.includes('"$block_kind" = bare'))
check('build delegates through the implementer', build.includes("agentType: 'implementer'") && !/model: u\.mechanical/.test(build))
check('direct path freezes scope and dispatches exactly one implementer', /exact working directory/.test(direct) && /exact repo-relative files/.test(direct) && /Dispatch exactly one existing `implementer`/.test(direct) && /luna-run\.sh` exactly once/.test(direct))
check('direct path forbids native Claude writes and fallback', /Do not write in the main thread/.test(direct) && direct.includes('native Claude write') && /when Luna is unavailable/.test(direct))
check('council avoids automatic Sonnet and Haiku routes', !/model:\s*'(sonnet|haiku)'/.test(council))
check('council uses Opus xhigh for every phase', (council.match(/effort: 'xhigh'/g) || []).length >= 4)
check('council always seats all six lenses', council.includes('const SEATED = COUNCIL') && council.includes('all six lenses') && !council.includes('const TRIAGE'))
check('council uses one Opus challenger without dead escalation scaffolding', /const CHALLENGERS = \['opus'\]/.test(council) && !/ADJUDICATION|ESCALATION_MODEL|MAX_ESCALATIONS|contestedCritical|escalations\s*\+=/.test(council))
check('council blocks incomplete member or challenge seats', council.includes('members_available: membersAvailable') && council.includes('challenge_failures: challengeFailures') && /if \(!allRequiredSeatsReady \|\| challengeFailures > 0\)/.test(council))
check('council challenge batches require an exact unique index set', council.includes('exactIndexSet') && council.includes('new Set(indexes).size') && council.includes('Array(batch.length).keys'))
check('review classification uses bounded diff scope while review reads full files', /const classificationScope/.test(reviewWorkflow) && /changed paths, diffstat, and diff hunks/.test(reviewWorkflow) && /const reviewScope/.test(reviewWorkflow) && /Read every changed file in full/.test(reviewWorkflow) && /review-bundle\.sh/.test(reviewWorkflow))
check('review command defines all risk tiers', ['mechanical', 'normal', 'guardrail'].every((tier) => review.includes(`**${tier[0].toUpperCase()}${tier.slice(1)}**`)))
check('normal review uses one Opus and one fixed Sol outsider', /one independent Opus xhigh reviewer/.test(review) && review.includes('gpt-5.6-sol') && /15–25-agent council/.test(review) && /one Codex outsider/.test(review))
check('review workflow has no normal council fan-out', /if \(tier === 'guardrail'\)/.test(reviewWorkflow) && /review:normal:opus/.test(reviewWorkflow) && /review:normal:codex/.test(reviewWorkflow) && !/council-review/.test(reviewWorkflow))
check('review workflow blocks when any required seat or cleanup is unavailable', /status: seatsReady && cleanupReady[\s\S]*blocked/.test(reviewWorkflow) && /required review seat/.test(reviewWorkflow))
check('mechanical review requires exact gates or promotes to normal', /exactGates/.test(reviewWorkflow) && /promoted to normal review/.test(reviewWorkflow))
check('review bundles clean up after their final consumer', /cleanup-review-bundle\.sh/.test(reviewWorkflow) && /cleanup-review-bundle\.sh/.test(council))
check('review bundles resolve exact targets and synthetic untracked additions', read('scripts/review-bundle.sh').includes('base_ref=') && read('scripts/review-bundle.sh').includes('head_ref=') && read('scripts/review-bundle.sh').includes('append_untracked_diff'))
check('cross-provider review scans secrets before transfer', read('scripts/review-secret-scan.sh').includes('refusing cross-provider transfer') && codexRun.includes('SECRET_SCANNER') && reviewWorkflow.includes(' -B '))
check('Codex review scans the exact prompt input immediately before every exec', codexRun.includes('SECRET_SCANNER" --file "$prompt_input"') && codexRun.includes('immediately before every'))
check('worktree hydration is one-way and resets ignored worker writes', worktree.includes('hydrate_ignored') && worktree.includes('clean -fdx') && worktree.includes('ignored_hash') && worktree.includes('ignored_digest') && worktree.includes('worker mutated an approved ignored dependency baseline'))
check('bundle cleanup is exception-safe and council owns guardrail handoff', reviewWorkflow.includes('finally') && council.includes('finally') && reviewWorkflow.includes("bundleOwner = 'council'"))
check('valuable-tests rule is authoritative and actionable', principles.includes('Valuable tests are the default') && principles.includes('stated rule is removed') && principles.includes('real overlap'))
check('review and council share one canonical full-content bundle', reviewWorkflow.includes('review-bundle.sh') && reviewWorkflow.includes('bundlePath') && council.includes('review-bundle.sh') && council.includes('members_available: membersAvailable'))
check('guardrail review hands off to full council', reviewWorkflow.includes("tier === 'guardrail'") && /Run \/council/.test(reviewWorkflow) && review.includes('full `/council`'))
check('CodeRabbit autofix precedes the selected review path', routing.includes('`coderabbit:autofix`') && routing.includes('selected review path') && routing.includes('must not force a full `/council` for a normal PR'))
check('dependent units refresh after predecessor integration while independent work stays parallel', pipeline.includes('private worktree refreshes from') && pipeline.includes('Independent frontier units remain parallel') && /Use serial\s+only for true shared ownership/.test(pipeline) && !pipeline.includes('does not compose their work') && !pipeline.includes('build depth-1 only') && !pipeline.includes('re-dispatch from the new HEAD'))
check('CodeRabbit never replaces the required Sol review seat', routing.includes('optional additional lens') && routing.includes('never satisfies or replaces') && routing.includes('blocks the required Sol seat') && !routing.includes('either satisfies the cross-family requirement'))
check('guardrail hook leaves classification to review and enforces council', guardrailHook.includes('/review owns classification') && guardrailHook.includes('both tiers still require /council') && !guardrailHook.includes('It already classifies risk itself'))

check('Luna wrapper pins model and effort', wrapper.includes('--model gpt-5.6-luna') && wrapper.includes('model_reasoning_effort=xhigh'))
check('Luna wrapper pins safe approval and sandbox', wrapper.includes('--sandbox workspace-write') && wrapper.includes('--approve-for-me'))
check('Luna wrapper disables MCP', wrapper.includes("mcp_servers={}"))
check('Luna wrapper rejects dangerous bypass flags', !wrapper.includes('dangerously-bypass'))
check('Luna wrapper rejects arbitrary binary overrides', !wrapper.includes('CODEX_BIN=${') && !wrapper.includes('PERL_BIN=${'))
check('all Codex routes share the one fail-closed preflight', existsSync(new URL('../scripts/codex-preflight.sh', import.meta.url)) && installer.includes('codex_preflight all') && wrapper.includes('codex_preflight writer') && codexRun.includes('codex_preflight review') && preflight.includes('codex-cli') && preflight.includes('exec --help'))
check('Codex wrappers use fixed absolute control utilities', [
  'CODEX_PREFLIGHT_MKTEMP=/usr/bin/mktemp',
  'CODEX_PREFLIGHT_STAT=/usr/bin/stat',
  'CODEX_PREFLIGHT_ID=/usr/bin/id',
  'CODEX_PREFLIGHT_RM=/bin/rm',
  'CODEX_PREFLIGHT_CAT=/bin/cat',
  'CODEX_PREFLIGHT_PS=/bin/ps',
  'CODEX_PREFLIGHT_TR=/usr/bin/tr',
  'CODEX_PREFLIGHT_WC=/usr/bin/wc',
  'CODEX_PREFLIGHT_AWK=/usr/bin/awk',
  'CODEX_PREFLIGHT_PGREP=/usr/bin/pgrep',
  'CODEX_PREFLIGHT_FIND=/usr/bin/find',
  'CODEX_PREFLIGHT_SLEEP=/bin/sleep',
].every((path) => preflight.includes(path)) && wrapper.includes('CODEX_PREFLIGHT_MKTEMP') && codexRun.includes('CODEX_PREFLIGHT_PS'))
check('secret scanner uses fixed Homebrew ripgrep and find', secretScanner.includes('for candidate in /opt/homebrew/bin/rg /usr/local/bin/rg') && secretScanner.includes('FIND_BIN=/usr/bin/find') && secretScanner.includes('case "$rg_status"'))
check('installer separates required, recommended, and optional prerequisites', installer.includes('REQUIRED_PREREQS="git gh node perl rg jq codex"') && installer.includes('RECOMMENDED_PREREQS="rtk cmux wt"') && installer.includes('OPTIONAL_PREREQS="bd"') && readme.includes('| `rtk`, `cmux`, `wt` | Recommended |') && readme.includes('| `bd` | Optional |'))

check('Codex review wrapper pins Sol xhigh and read-only sandbox', codexRun.includes('--model gpt-5.6-sol') && codexRun.includes("model_reasoning_effort=xhigh") && codexRun.includes('--sandbox read-only') && codexRun.includes('\n      -'))
check('Codex review wrapper disables MCP by default', codexRun.includes("MCP_ARGS=(-c 'mcp_servers={}')") && codexRun.includes('MCP=0'))
check('Codex review wrapper has no dangerous bypass flags', !codexRun.includes('dangerously-bypass'))
check('Codex review wrapper rejects unexpected CLI failures before answer detection', codexRun.includes('RUNTIME FAILURE') && codexRun.indexOf('RUNTIME FAILURE') < codexRun.indexOf('if ! answered'))
check('install probes supported runtimes and requires the public settings clean filter', installer.includes('Node 20–24 LTS') && installer.includes("process.exit(0)") && installer.includes('codex --version') && installer.includes('PYTHON3_RUNTIME') && installer.includes('filter.claudehome.required true') && installer.includes('hash-object --path=settings.json') && installer.includes('hash-object --no-filters') && !installer.includes('timeout 10'))
check('installer quotes Git filters and protects routing materialization transactionally', installer.includes("printf '%q'") && installer.indexOf('hash-object --path=settings.json') < installer.indexOf('rm -f "$TARGET/settings.json"') && installer.includes('materialization_restore') && installer.includes('status --porcelain -- settings.json agents/implementer.md'))
check('review bundle utility is present and private', existsSync(new URL('../scripts/review-bundle.sh', import.meta.url)) && read('scripts/review-bundle.sh').includes('umask 077') && read('scripts/review-bundle.sh').includes('mktemp -d'))
check('private build worktree utility is present', existsSync(new URL('../scripts/build-worktree.sh', import.meta.url)) && read('scripts/build-worktree.sh').includes('unit patch escapes owned canonical paths') && read('scripts/build-worktree.sh').includes('worktree add'))
check('authoritative routing contract is near the top', claude.indexOf('Authoritative routing contract') < 1800 && claude.includes('Luna xhigh is the only writer') && claude.includes('serial integration'))
check('authoritative contract names direct and tiered review paths', claude.includes('Use `/implement`') && claude.includes('Use `/build` for structured') && claude.includes('use `/review`') && claude.includes('full `/council`'))
check('planning is native Opus with explicit CE only', plan.includes('native planner') && plan.includes('only when the user explicitly requests') && !/Run `ce-(brainstorm|plan)`/.test(plan))
check('recovery docs match fixed Sol xhigh behavior', recovery.includes('gpt-5.6-sol') && recovery.includes('xhigh') && recovery.includes('runtime failure') && recovery.includes('secret scan refused') && recovery.includes('scripts/codex-run.sh') && !recovery.includes('timeout 600 codex exec') && !recovery.includes('model_reasoning_effort=medium') && !recovery.includes('retry once at'))

check('Open Design manifest has the approved release', design.schema_version === 2 && design.stable_version === '0.21.0' && design.stable_tag === 'open-design-v0.21.0' && design.source_commit === 'dbbd3b42eab9609065637452b347f903d7125ecd')
check('Open Design manifest pins both Mac architectures', design.releases.arm64.sha256 === 'b553f49c1fbdc7dcca4ca225d682ad5d672e0a1363653ce953eceecd76e53326' && design.releases.x86_64.sha256 === 'f73241ee3f0c8eb6ae7c63089cf0c3037fa0d39d9d40ba427fc2322ac95fbd03')
check('Open Design manifest pins signing identity', design.bundle_id === 'io.open-design.desktop' && design.signing_identity === 'Developer ID Application: Wei Huang (236R69AWW2)' && design.team_id === '236R69AWW2')
const designWorkflow = read('docs/design-workflow.md')
const migration = read('docs/workflow-migration.md')
const designDocs = `${designWorkflow}\n${migration}\n${readme}`
check('Open Design manifest pins the official distribution', design.distribution.source === 'https://github.com/nexu-io/open-design-agent-plugins.git' && design.distribution.source_commit === 'c0710761302c69bded82e205362effcce6fde49e' && design.distribution.marketplace === 'open-design' && design.distribution.plugin === 'open-design@open-design' && design.distribution.plugin_version === '0.5.3' && design.distribution.minimum_codex_version === '0.144.6' && design.distribution.minimum_open_design_version === '0.17.0')
check('Claude uses official host-local MCP setup without a Claude plugin', design.distribution.plugin_hosts.length === 1 && design.distribution.plugin_hosts[0] === 'codex' && design.distribution.mcp_install_targets.includes('claude') && design.mcp.install_commands.claude === 'od mcp install claude' && design.mcp.install_commands.codex === 'od mcp install codex' && designWorkflow.includes('od mcp install claude') && designWorkflow.includes('Claude uses this official MCP integration') && designWorkflow.includes('Claude has no Open Design plugin'))
check('Open Design remains optional and manually installed', designWorkflow.includes('optional, host-local design bridge') && designWorkflow.includes('does not block core') && designWorkflow.includes('does not\ndownload, install, or replace') && migration.includes('host-local optional integration') && readme.includes('installer does not download or install'))
check('Claude policy contains no legacy enrollment protocol', !/(?:host enrollment|enrollment receipt|HMAC|Ed25519|detached signature)/i.test(designDocs))
check('installer reports missing Open Design as an optional action', installer.includes('Open Design app not found (optional)') && installer.includes('od mcp install claude') && !/missing Open Design[^\n]*required/i.test(installer))

const readTree = (directory) => {
  const walk = (relativeDirectory) => readdirSync(new URL(`../${relativeDirectory}/`, import.meta.url), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`
      return entry.isDirectory() ? walk(relativePath) : [read(relativePath)]
    })
  return walk(directory).join('\u0000')
}
const integrationSurfaces = [
  readme,
  read('CLAUDE.md'),
  installer,
  read('settings.json'),
  ...['agents', 'commands', 'workflows', 'scripts', 'hooks', 'skills', 'docs', 'rules', 'manifests', 'marketplace'].map(readTree),
].join('\u0000')
const configuredOpenDesignPlugins = Object.keys(settings.enabledPlugins).filter((name) => /open[- ]design/i.test(name))
const configuredOpenDesignMarketplaces = Object.keys(settings.extraKnownMarketplaces).filter((name) => /open[- ]design/i.test(name))
const hasPositiveClaudeOpenDesignPluginClaim = (text) => {
  const explicitNoPlugin = /^(?:claude has no open[- ]design (?:plugin|marketplace)|there is no open[- ]design (?:plugin|marketplace) for claude|claude uses mcp, not (?:an )?(?:open[- ]design )?(?:plugin|marketplace))$/i
  return text.split('\u0000').some((surface) => {
    const normalized = surface.replace(/\s+/g, ' ')
    const claims = normalized.split(/[.!?]+/).filter((sentence) => /\bclaude\b/i.test(sentence) && /open[- ]design/i.test(sentence) && /\b(?:plugin|marketplace)\b/i.test(sentence))
    return claims.some((claim) => !explicitNoPlugin.test(claim.trim()))
  })
}
const positiveClaudeOpenDesignPluginClaim = hasPositiveClaudeOpenDesignPluginClaim(integrationSurfaces)
check('multiline positive Claude plugin claims are detected', hasPositiveClaudeOpenDesignPluginClaim('There is no Claude plugin. Claude uses Open Design\nClaude plugin.'))
check('generic not does not negate a Claude plugin claim', hasPositiveClaudeOpenDesignPluginClaim('Claude uses the Open Design plugin, not Codex.'))
check('generic without does not negate a multiline Claude plugin claim', hasPositiveClaudeOpenDesignPluginClaim('Claude uses the Open Design plugin\nwithout Codex.'))
check('explicit no-Claude-plugin policy is not treated as a positive claim', ['Claude has no Open Design plugin.', 'There is no Open Design plugin for Claude.', 'Claude uses MCP, not a plugin.'].every((fixture) => !hasPositiveClaudeOpenDesignPluginClaim(fixture)))
check('Codex-only Open Design plugin declaration is not treated as a Claude claim', !hasPositiveClaudeOpenDesignPluginClaim('The official Open Design plugin distribution targets Codex only.'))
check('Claude settings do not enable the Open Design marketplace or plugin', configuredOpenDesignPlugins.length === 0 && configuredOpenDesignMarketplaces.length === 0)
check('Claude integration surfaces contain no legacy enrollment or positive Claude plugin policy', !/(?:receipt|enrollment|HMAC|Ed25519|detached signature)/i.test(integrationSurfaces) && !positiveClaudeOpenDesignPluginClaim && /There is no Open Design plugin for Claude|Claude has no Open Design plugin/i.test(integrationSurfaces))
check('installer validates the MCP command and rejects Apple od', installer.includes('real command') && installer.includes('command? | type') && installer.includes('command == "/usr/bin/od"') && installer.includes('command == "od"') && installer.includes('>/dev/null 2>&1') && installer.includes('never calls `od`'))

const designCheckHome = mkdtempSync(join(tmpdir(), 'claude-open-design-check-'))
const designCheckBin = join(designCheckHome, 'bin')
const designCheckOd = join(designCheckBin, 'od')
const designCheckClaude = join(designCheckBin, 'claude')
const designCheckMarker = join(designCheckHome, 'od-invoked')
const designCheckClaudeMarker = join(designCheckHome, 'claude-invoked')
const designCheckConfig = join(designCheckHome, '.claude.json')
mkdirSync(designCheckBin, { recursive: true })
mkdirSync(join(designCheckHome, 'Applications', 'Open Design.app'), { recursive: true })
writeFileSync(designCheckOd, '#!/bin/sh\nprintf called > "$OD_MARKER"\nexit 99\n')
chmodSync(designCheckOd, 0o755)
writeFileSync(designCheckClaude, '#!/bin/sh\nprintf called > "$CLAUDE_MARKER"\nexit 99\n')
chmodSync(designCheckClaude, 0o755)
const designCheckConfigText = '{"mcpServers":{"another-server":{"command":"true"}}}\n'
writeFileSync(designCheckConfig, designCheckConfigText)
const designCheckEnv = {
  ...process.env,
  HOME: designCheckHome,
  OD_MARKER: designCheckMarker,
  CLAUDE_MARKER: designCheckClaudeMarker,
  PATH: `${designCheckBin}:/opt/homebrew/opt/node@24/bin:${process.env.PATH || ''}`,
}
const runDesignCheck = (env = designCheckEnv) => {
  try {
    return {
      code: 0,
      output: execFileSync('/bin/bash', ['install.sh', '--check'], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' }),
    }
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}
let designCheck = runDesignCheck()
check('app-present and MCP-absent check remains optional and names the official action', designCheck.code === 0 && designCheck.output.includes('Open Design app present (optional)') && designCheck.output.includes('Claude Open Design MCP not configured (optional)') && designCheck.output.includes('od mcp install claude'))
check('app-present MCP probe does not invoke host CLIs or mutate Claude config', !existsSync(designCheckMarker) && !existsSync(designCheckClaudeMarker) && readFileSync(designCheckConfig, 'utf8') === designCheckConfigText)

const invalidMcpFixtures = [
  ['null', null],
  ['scalar', 'not-an-object'],
  ['empty object', {}],
  ['null command', { command: null }],
  ['empty command', { command: '' }],
  ['blank command', { command: '   ' }],
  ['Apple od', { command: '/usr/bin/od' }],
  ['bare od', { command: 'od' }],
]
for (const [label, value] of invalidMcpFixtures) {
  const fixtureText = `${JSON.stringify({ mcpServers: { 'open-design': value } })}\n`
  writeFileSync(designCheckConfig, fixtureText)
  designCheck = runDesignCheck()
  check(`${label} Open Design MCP entry stays optional`, designCheck.code === 0 && designCheck.output.includes('Claude Open Design MCP not configured (optional)') && designCheck.output.includes('od mcp install claude') && readFileSync(designCheckConfig, 'utf8') === fixtureText)
}
check('invalid MCP fixtures do not invoke host CLIs', !existsSync(designCheckMarker) && !existsSync(designCheckClaudeMarker))

const configuredMcpText = '{"projects":{"/tmp/example":{"mcpServers":{"open-design":{"command":"/private/host/open-design"}}}}}\n'
writeFileSync(designCheckConfig, configuredMcpText)
designCheck = runDesignCheck()
check('configured Open Design MCP is detected without exposing its command', designCheck.code === 0 && designCheck.output.includes('Claude Open Design MCP present (optional)') && !designCheck.output.includes('/private/host/open-design') && readFileSync(designCheckConfig, 'utf8') === configuredMcpText)

const malformedConfigText = 'credential=do-not-print-this-value\n'
writeFileSync(designCheckConfig, malformedConfigText)
designCheck = runDesignCheck()
check('malformed MCP config stays optional, quiet, and non-mutating', designCheck.code === 0 && designCheck.output.includes('Claude Open Design MCP not confirmed (optional)') && !designCheck.output.includes('do-not-print-this-value') && readFileSync(designCheckConfig, 'utf8') === malformedConfigText)

const missingCliEnv = { ...designCheckEnv, PATH: '/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin' }
designCheck = runDesignCheck(missingCliEnv)
check('missing Claude CLI keeps the app-present design action optional', designCheck.code === 0 && designCheck.output.includes('Claude CLI not found (optional)') && designCheck.output.includes('od mcp install claude') && readFileSync(designCheckConfig, 'utf8') === malformedConfigText)
rmSync(designCheckHome, { recursive: true, force: true })
check('currentness policy records the reviewed CE pin', read('docs/workflow-migration.md').includes('3.23.4') && read('docs/workflow-migration.md').includes('33d9bd92689d60580e732890f94466e5793385b1'))

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
