import { execFileSync as runFile, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

const repo = dirname(fileURLToPath(new URL('../install.sh', import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'claude installer regression-'))
const cleanSource = join(root, 'source clone')
const successfulTarget = join(root, "claude home's config")
const rollbackSource = join(root, 'rollback source')
const rollbackTarget = join(root, "claude home's rollback")
const malformedTarget = join(root, "claude home's malformed")
const cleanFilterFailSource = join(root, 'clean filter fail source')
const cleanFilterFailTarget = join(root, "claude home's clean filter fail")
const testHome = join(root, 'test home')
const temporaryRoots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', realpathSync(tmpdir())]
const isUnder = (candidate, rootPath) => candidate === rootPath || candidate.startsWith(`${rootPath}/`)
let fixtureParent = process.env.INSTALL_SAFE_FIXTURE_PARENT || dirname(repo)
while (fixtureParent !== '/' && (existsSync(join(fixtureParent, '.git')) || temporaryRoots.some((rootPath) => isUnder(fixtureParent, rootPath)))) fixtureParent = dirname(fixtureParent)
if (fixtureParent === '/') throw new Error('could not find a safe sibling outside Git and macOS temporary roots')
const cliFixtureRoot = mkdtempSync(join(fixtureParent, 'claude-install-cli-safe-'))
const cliFixture = join(cliFixtureRoot, 'codex')
// A cmux shim under TMPDIR often wins PATH; pin a durable Codex on the
// fixture PATH so the bounded `codex --version` probe finds a real binary.
const durableCliRoot = mkdtempSync(join(fixtureParent, 'claude-install-durable-'))
const durableCodex = [join(homedir(), '.local', 'bin', 'codex'), ...(process.env.PATH || '').split(':').filter((entry) => entry.startsWith('/')).map((entry) => join(entry, 'codex'))]
  .find((candidate) => {
    try { return !temporaryRoots.some((rootPath) => isUnder(realpathSync(candidate), rootPath)) } catch { return false }
  })
if (!durableCodex) throw new Error('the host has no Codex CLI outside a temporary root')
symlinkSync(durableCodex, join(durableCliRoot, 'codex'))
const node25FixtureRoot = join(cliFixtureRoot, 'node25-bin')
const node25Fixture = join(node25FixtureRoot, 'node')
const missingTarget = join(root, "claude home's missing")
const checkTarget = join(testHome, '.claude')
const env = { ...process.env, HOME: testHome, PATH: `/opt/homebrew/opt/node@24/bin:${durableCliRoot}:${process.env.PATH || ''}` }
const git = (cwd, args) => runFile('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' })
const cloneMain = (source, destination) => {
  runFile('git', ['clone', '-q', '-b', 'main', source, destination], { encoding: 'utf8', stdio: 'pipe' })
}
const FILTERED = new Map([['settings.json', 'settings-clean.py']])
const snapshotFiles = [
  'README.md',
  'install.sh',
  '.gitattributes',
  'settings.json',
  'CLAUDE.md',
  'rules/project-context.md',
  'scripts/path-clean.py',
  'scripts/settings-clean.py',
  'evals/config-load-test.mjs',
  'hooks/bash-safety.sh',
  'hooks/rm-guard.py',
  'hooks/rtk-rewrite.sh',
  'hooks/agents-md-context.py',
  'hooks/context-mode-cache-heal.mjs',
]
const cleanForCommit = (relative, working) => {
  const workingText = working.toString('utf8')
  const configuredHome = relative === 'settings.json'
    ? workingText.match(/(\/[^"'\\\n]*?)\/hooks\/[A-Za-z0-9._-]+/)?.[1] || repo
    : repo
  return runFile(process.env.PYTHON3_RUNTIME || '/usr/bin/python3', [join(repo, 'scripts', FILTERED.get(relative)), configuredHome], { input: working, maxBuffer: 32 * 1024 * 1024 })
}
const reconcileCandidateDeletions = (source) => {
  const tracked = runFile('git', ['-C', source, 'ls-files', '-z'], { encoding: 'buffer' }).toString('utf8').split('\0').filter(Boolean)
  for (const relative of tracked) {
    try { lstatSync(join(repo, relative)) } catch { rmSync(join(source, relative), { recursive: true, force: true }) }
  }
}
const snapshotWorkingInstaller = (source) => {
  reconcileCandidateDeletions(source)
  for (const relative of snapshotFiles) {
    // The clone has no clean filter, so a smudged working file would commit a host path.
    const working = readFileSync(join(repo, relative))
    writeFileSync(join(source, relative), FILTERED.has(relative) ? cleanForCommit(relative, working) : working)
  }
  git(source, ['add', '-A'])
  const staged = spawnSync('git', ['-C', source, 'diff', '--cached', '--quiet'], { encoding: 'utf8' })
  if (staged.status === 1) git(source, ['commit', '-qm', 'snapshot installer under test'])
  else if (staged.status !== 0) throw new Error(`could not inspect installer snapshot index: ${staged.status}`)
}
const runInstall = (source, target, extraEnv = {}) => spawnSync('/bin/bash', [join(source, 'install.sh'), '--target', target, '--force'], {
  cwd: source,
  env: { ...env, ...extraEnv },
  encoding: 'utf8',
})
const runCheck = (source, extraEnv = {}) => spawnSync('/bin/bash', [join(source, 'install.sh'), '--check'], {
  cwd: source,
  env: { ...env, ...extraEnv },
  encoding: 'utf8',
})
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

mkdirSync(testHome, { recursive: true })
runFile('git', ['clone', '-q', repo, cleanSource], { encoding: 'utf8', stdio: 'pipe' })
if (git(cleanSource, ['symbolic-ref', '--short', 'HEAD']).trim() !== 'main') git(cleanSource, ['branch', '-m', 'main'])
git(cleanSource, ['config', 'user.email', 'test@example.com'])
git(cleanSource, ['config', 'user.name', 'Installer Regression Test'])
snapshotWorkingInstaller(cleanSource)
git(cleanSource, ['config', 'remote.origin.url', cleanSource])

let result = runInstall(cleanSource, successfulTarget)
const successfulSettings = readFileSync(join(successfulTarget, 'settings.json'), 'utf8')
const successfulStatus = git(successfulTarget, ['status', '--porcelain'])
const settingsClean = git(successfulTarget, ['config', '--get', 'filter.claudesettings.clean'])
check('installer succeeds for a target containing spaces and an apostrophe', result.status === 0, `${result.status}: ${result.stderr}`)
check('quoted Git filter materializes settings.json and leaves the target clean', result.status === 0 && successfulSettings.includes(successfulTarget) && !successfulSettings.includes('__CLAUDE_HOME__') && JSON.parse(successfulSettings) && typeof JSON.parse(successfulSettings) === 'object' && successfulStatus === '' && settingsClean.includes('settings-clean.py'), JSON.stringify({ status: result.status, successfulStatus, settingsClean }))
check('installed filter remains required', git(successfulTarget, ['config', '--get', 'filter.claudesettings.required']) === 'true\n')
const installedConfig = spawnSync(process.execPath, [join(successfulTarget, 'evals', 'config-load-test.mjs')], { cwd: successfulTarget, env, encoding: 'utf8' })
check('installed materialized config loads and validates local hooks', installedConfig.status === 0 && /---- \d+ passed, 0 failed/.test(installedConfig.stdout), `${installedConfig.status}: ${installedConfig.stderr}\n${installedConfig.stdout}`)

cloneMain(cleanSource, rollbackSource)
git(rollbackSource, ['config', 'user.email', 'test@example.com'])
git(rollbackSource, ['config', 'user.name', 'Installer Regression Test'])
writeFileSync(join(rollbackSource, 'scripts', 'path-clean.py'), '#!/usr/bin/env python3\nimport sys\nsys.exit(97)\n')
git(rollbackSource, ['add', 'scripts/path-clean.py'])
git(rollbackSource, ['commit', '-qm', 'inject materialization failure'])
git(rollbackSource, ['config', 'remote.origin.url', rollbackSource])
cloneMain(rollbackSource, rollbackTarget)
const priorSettings = JSON.stringify({ sentinel: 'settings-before-materialization', hooks: { probe: `${rollbackTarget}/keep` } }, null, 2) + '\n'
writeFileSync(join(rollbackTarget, 'settings.json'), priorSettings)
chmodSync(join(rollbackTarget, 'settings.json'), 0o640)
const priorSettingsMode = statSync(join(rollbackTarget, 'settings.json')).mode & 0o777
result = runInstall(rollbackSource, rollbackTarget)
check('injected checkout filter failure returns nonzero', result.status !== 0, `${result.status}: ${result.stderr}`)
check('transactional materialization restores prior settings.json byte-for-byte with its mode', readFileSync(join(rollbackTarget, 'settings.json'), 'utf8') === priorSettings && (statSync(join(rollbackTarget, 'settings.json')).mode & 0o777) === priorSettingsMode, JSON.stringify({ status: result.status, priorSettingsMode }))

cloneMain(cleanSource, malformedTarget)
const malformedSettings = JSON.stringify({ sentinel: 'settings-before-malformed-check', hooks: { probe: `${malformedTarget}/keep` } }, null, 2) + '\n'
writeFileSync(join(malformedTarget, 'settings.json'), malformedSettings)
writeFileSync(join(malformedTarget, 'settings.local.json'), '{not-json\n')
result = runInstall(cleanSource, malformedTarget)
check('malformed local settings fail before materialization', result.status !== 0, `${result.status}: ${result.stderr}`)
check('malformed local settings failure leaves prior settings.json byte-for-byte intact', readFileSync(join(malformedTarget, 'settings.json'), 'utf8') === malformedSettings, JSON.stringify({ status: result.status }))

cloneMain(cleanSource, cleanFilterFailSource)
git(cleanFilterFailSource, ['config', 'user.email', 'test@example.com'])
git(cleanFilterFailSource, ['config', 'user.name', 'Installer Regression Test'])
writeFileSync(join(cleanFilterFailSource, 'scripts', 'settings-clean.py'), '#!/usr/bin/env python3\nimport sys\nsys.exit(97)\n')
git(cleanFilterFailSource, ['add', 'scripts/settings-clean.py'])
git(cleanFilterFailSource, ['commit', '-qm', 'inject clean filter failure'])
git(cleanFilterFailSource, ['config', 'remote.origin.url', cleanFilterFailSource])
cloneMain(cleanFilterFailSource, cleanFilterFailTarget)
const priorCleanFailSettings = JSON.stringify({ sentinel: 'settings-before-clean-filter', hooks: { probe: `${cleanFilterFailTarget}/keep` } }, null, 2) + '\n'
writeFileSync(join(cleanFilterFailTarget, 'settings.json'), priorCleanFailSettings)
result = runInstall(cleanFilterFailSource, cleanFilterFailTarget)
check('corrupted settings clean filter blocks install', result.status !== 0, `${result.status}: ${result.stderr}`)
check('clean filter failure leaves prior settings.json byte-for-byte intact', readFileSync(join(cleanFilterFailTarget, 'settings.json'), 'utf8') === priorCleanFailSettings, JSON.stringify({ status: result.status }))

writeFileSync(cliFixture, `#!/bin/sh
if [ "\$1" = "--version" ]; then printf '%s\\n' "\$FAKE_CODEX_VERSION"; exit 0; fi
exit 64
`)
chmodSync(cliFixture, 0o755)
mkdirSync(node25FixtureRoot)
writeFileSync(node25Fixture, `#!/bin/sh
if [ "\$1" = "--version" ]; then printf '%s\\n' 'v25.0.0'; exit 0; fi
exit 0
`)
chmodSync(node25Fixture, 0o755)
const checkTargetSentinel = 'required prerequisite must preserve the default --check target\n'
mkdirSync(checkTarget)
writeFileSync(join(checkTarget, 'sentinel.txt'), checkTargetSentinel)
const missingResult = runInstall(cleanSource, missingTarget, {
  PATH: '/opt/homebrew/opt/node@24/bin:/usr/bin:/bin',
})
check('missing Codex blocks install before creating its target', missingResult.status !== 0 && !existsSync(missingTarget), `${missingResult.status}: ${missingResult.stdout}${missingResult.stderr}`)
const missingCheck = runCheck(cleanSource, {
  PATH: '/opt/homebrew/opt/node@24/bin:/usr/bin:/bin',
})
check('missing Codex also makes --check fail closed', missingCheck.status !== 0, `${missingCheck.status}: ${missingCheck.stdout}${missingCheck.stderr}`)

const blockedSentinel = 'required prerequisite must preserve this target\n'
const checkSentinel = join(checkTarget, 'sentinel.txt')
const blockedCase = (name, source, extraEnv = {}, evidence = '') => {
  const target = join(root, `claude home's blocked-${name}`)
  mkdirSync(target)
  const targetFile = join(target, 'sentinel.txt')
  writeFileSync(targetFile, blockedSentinel)
  const installResult = runInstall(source, target, extraEnv)
  const checkResult = runCheck(source, extraEnv)
  const installOutput = `${installResult.stdout}${installResult.stderr}`
  check(`${name} blocks install before backup or target mutation`, installResult.status !== 0 && readFileSync(targetFile, 'utf8') === blockedSentinel && !readdirSync(root).some((entry) => entry.startsWith(`claude home's blocked-${name}.bak-`)) && (!evidence || installOutput.includes(evidence)), `${installResult.status}: ${installOutput}`)
  check(`${name} blocks --check before touching its existing target`, checkResult.status !== 0 && readFileSync(checkSentinel, 'utf8') === checkTargetSentinel, `${checkResult.status}: ${checkResult.stdout}${checkResult.stderr}`)
}
const fakeCliPath = `${cliFixtureRoot}:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin`
blockedCase('Node 25', cleanSource, { PATH: `${node25FixtureRoot}:${fakeCliPath}`, FAKE_CODEX_VERSION: 'codex-cli 0.149.1' }, 'unsupported or failed runtime')

rmSync(root, { recursive: true, force: true })
rmSync(cliFixtureRoot, { recursive: true, force: true })
rmSync(durableCliRoot, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
