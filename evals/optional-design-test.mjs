import { accessSync, chmodSync, constants as fsConstants, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir, tmpdir, userInfo } from 'node:os'
import { fileURLToPath } from 'node:url'

const configRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]+$/, '') || '/'
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

let designCheckHome = ''
let codexIsolationBin = ''
let primaryFixtureError = null
try {
designCheckHome = mkdtempSync(join(tmpdir(), 'claude-open-design-check-'))
const designCheckBin = join(designCheckHome, 'bin')
const temporaryRoots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', realpathSync(tmpdir())]
const isUnder = (candidate, rootPath) => candidate === rootPath || candidate.startsWith(`${rootPath}/`)
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
const hostPathEntries = (process.env.PATH || '').split(':').filter((entry) => entry.length > 0 && entry.startsWith('/'))
if (hostPathEntries.length === 0) throw new Error('the host PATH has no absolute entries')
const isExecutableFile = (candidate) => {
  try {
    accessSync(candidate, fsConstants.X_OK)
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}
// A cmux shim under TMPDIR often wins PATH, and the preflight rejects it.
// Mirror the preflight's order.
const authorizedCodex = [join(homedir(), '.local', 'bin', 'codex'), ...hostPathEntries.map((entry) => join(entry, 'codex'))]
  .find((candidate) => isExecutableFile(candidate))
if (!authorizedCodex) throw new Error('the host has no executable Codex CLI')
const authorizedCodexRealpath = realpathSync(authorizedCodex)
// Keep Codex bound to the original PATH winner. The eval Node directory is
// added only afterward so the installer can find the Node runtime used here.
const testNodeBin = dirname(process.execPath)
if (!testNodeBin.startsWith('/')) throw new Error('the eval Node runtime is not absolute')
const testPathEntries = [testNodeBin, ...hostPathEntries.filter((entry) => entry !== testNodeBin)]
const currentRoot = realpathSync(process.cwd())
const fixtureParent = [dirname(configRoot), dirname(process.env.PWD || ''), dirname(authorizedCodex), userInfo().homedir, homedir()]
  .map((candidate) => {
    try { return realpathSync(candidate) } catch { return '' }
  })
  .find((candidate) => candidate && candidate !== '/' && !existsSync(join(candidate, '.git')) && !temporaryRoots.some((rootPath) => isUnder(candidate, rootPath)) && !isUnder(candidate, configRoot) && !isUnder(candidate, currentRoot) && (() => {
    try { accessSync(candidate, fsConstants.W_OK); return true } catch { return false }
  })())
if (!fixtureParent) throw new Error('could not find a writable safe Codex fixture sibling')
codexIsolationBin = mkdtempSync(join(fixtureParent, 'claude-policy-codex-safe-'))
const codexIsolationLink = join(codexIsolationBin, 'codex')
symlinkSync(authorizedCodex, codexIsolationLink)
if (realpathSync(codexIsolationLink) !== authorizedCodexRealpath) throw new Error('Codex isolation link does not resolve to the existing CLI')
check('the pinned Codex resolves outside every temporary root', !temporaryRoots.some((rootPath) => isUnder(authorizedCodexRealpath, rootPath)), authorizedCodexRealpath)
const claudeFreePathEntries = testPathEntries.filter((entry) => !isExecutableFile(join(entry, 'claude')))
const requiredPathTools = ['git', 'gh', 'node', 'perl', 'rg', 'jq', 'python3']
for (const tool of requiredPathTools) {
  const source = testPathEntries.map((entry) => join(entry, tool)).find((candidate) => isExecutableFile(candidate))
  if (source && !claudeFreePathEntries.some((entry) => isExecutableFile(join(entry, tool)))) symlinkSync(source, join(codexIsolationBin, tool))
}
const claudeFreePath = [codexIsolationBin, ...claudeFreePathEntries].join(':')
if (claudeFreePath.split(':').some((entry) => entry.length === 0 || !entry.startsWith('/'))) throw new Error('Claude-free test PATH is not absolute and nonempty')
const designCheckEnv = {
  ...process.env,
  HOME: designCheckHome,
  OD_MARKER: designCheckMarker,
  CLAUDE_MARKER: designCheckClaudeMarker,
  PATH: `${designCheckBin}:${codexIsolationBin}:${testPathEntries.join(':')}`,
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

const missingCliEnv = { ...designCheckEnv, PATH: claudeFreePath }
let isolatedCodexCommand = ''
try { isolatedCodexCommand = execFileSync('/bin/bash', ['-c', 'command -v codex'], { env: missingCliEnv, encoding: 'utf8' }).trim() } catch {}
check('missing-Claude fixture selects an isolated Codex link to the existing CLI', isolatedCodexCommand === codexIsolationLink && realpathSync(isolatedCodexCommand) === authorizedCodexRealpath, JSON.stringify({ isolatedCodexCommand, codexIsolationLink, authorizedCodexRealpath }))
designCheck = runDesignCheck(missingCliEnv)
check('missing Claude CLI keeps the app-present design action optional', designCheck.code === 0 && designCheck.output.includes('Claude CLI not found (optional)') && designCheck.output.includes('od mcp install claude') && readFileSync(designCheckConfig, 'utf8') === malformedConfigText)
} catch (error) {
  primaryFixtureError = error
} finally {
  const cleanupFailures = []
  for (const fixture of [codexIsolationBin, designCheckHome]) {
    if (!fixture) continue
    try { rmSync(fixture, { recursive: true, force: true }) } catch (error) { cleanupFailures.push({ fixture, error }) }
  }
  if (cleanupFailures.length > 0) {
    const describe = (error) => error instanceof Error ? error.message : String(error)
    const details = cleanupFailures.map(({ fixture, error }) => `${fixture}: ${describe(error)}`).join('; ')
    const cleanupErrors = cleanupFailures.map(({ fixture, error }) => new Error(`cleanup failed for ${fixture}: ${describe(error)}`, { cause: error }))
    if (primaryFixtureError) throw new AggregateError([primaryFixtureError, ...cleanupErrors], `fixture execution failed and cleanup failed: ${details}`)
    throw new Error(`fixture cleanup failed: ${details}`, { cause: cleanupErrors[0] })
  }
  if (primaryFixtureError) throw primaryFixtureError
}

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
