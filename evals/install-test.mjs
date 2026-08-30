import { execFileSync as runFile, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const repo = dirname(fileURLToPath(new URL('../install.sh', import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'claude installer regression-'))
const cleanSource = join(root, 'source clone')
const successfulTarget = join(root, "claude home's config")
const rollbackSource = join(root, 'rollback source')
const rollbackTarget = join(root, "claude home's rollback")
const malformedTarget = join(root, "claude home's malformed")
const testHome = join(root, 'test home')
const temporaryRoots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', realpathSync(tmpdir())]
const isUnder = (candidate, rootPath) => candidate === rootPath || candidate.startsWith(`${rootPath}/`)
let fixtureParent = dirname(repo)
while (fixtureParent !== '/' && (existsSync(join(fixtureParent, '.git')) || temporaryRoots.some((rootPath) => isUnder(fixtureParent, rootPath)))) fixtureParent = dirname(fixtureParent)
if (fixtureParent === '/') throw new Error('could not find a safe sibling outside Git and macOS temporary roots')
const cliFixtureRoot = mkdtempSync(join(fixtureParent, 'claude-install-cli-safe-'))
const cliFixture = join(cliFixtureRoot, 'codex')
const node25FixtureRoot = join(cliFixtureRoot, 'node25-bin')
const node25Fixture = join(node25FixtureRoot, 'node')
const incompatibleTarget = join(root, "claude home's incompatible")
const missingTarget = join(root, "claude home's missing")
const checkTarget = join(testHome, '.claude')
const env = { ...process.env, HOME: testHome, PATH: `/opt/homebrew/opt/node@24/bin:${process.env.PATH || ''}` }
const git = (cwd, args) => runFile('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' })
const cloneMain = (source, destination) => {
  runFile('git', ['clone', '-q', '-b', 'main', source, destination], { encoding: 'utf8', stdio: 'pipe' })
}
const snapshotWorkingInstaller = (source) => {
  for (const relative of ['README.md', 'install.sh', '.gitattributes', 'settings.json', 'rules/routing.md', 'scripts/path-clean.py', 'scripts/settings-clean.py', 'scripts/codex-preflight.sh', 'scripts/review-secret-scan.sh', 'scripts/luna-run.sh', 'scripts/codex-run.sh', 'evals/claude-policy-test.mjs']) {
    writeFileSync(join(source, relative), readFileSync(join(repo, relative)))
  }
  git(source, ['add', 'README.md', 'install.sh', '.gitattributes', 'settings.json', 'rules/routing.md', 'scripts/path-clean.py', 'scripts/settings-clean.py', 'scripts/codex-preflight.sh', 'scripts/review-secret-scan.sh', 'scripts/luna-run.sh', 'scripts/codex-run.sh', 'evals/claude-policy-test.mjs'])
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
const successfulBrief = readFileSync(join(successfulTarget, 'agents', 'implementer.md'), 'utf8')
const successfulStatus = git(successfulTarget, ['status', '--porcelain'])
const settingsClean = git(successfulTarget, ['config', '--get', 'filter.claudesettings.clean'])
const pathClean = git(successfulTarget, ['config', '--get', 'filter.claudehome.clean'])
check('installer succeeds for a target containing spaces and an apostrophe', result.status === 0, `${result.status}: ${result.stderr}`)
check('quoted Git filters materialize both files and leave the target clean', result.status === 0 && successfulSettings.includes(successfulTarget) && successfulBrief.includes(successfulTarget) && !successfulSettings.includes('__CLAUDE_HOME__') && !successfulBrief.includes('__CLAUDE_HOME__') && successfulStatus === '' && settingsClean.includes('settings-clean.py') && pathClean.includes('path-clean.py'), JSON.stringify({ status: result.status, successfulStatus, settingsClean, pathClean }))
check('both installed filters remain required', git(successfulTarget, ['config', '--get', 'filter.claudesettings.required']) === 'true\n' && git(successfulTarget, ['config', '--get', 'filter.claudehome.required']) === 'true\n')
const installedPolicy = spawnSync(process.execPath, [join(successfulTarget, 'evals', 'claude-policy-test.mjs')], { cwd: successfulTarget, env, encoding: 'utf8' })
check('installed materialized policy accepts only the exact current-root wrapper permission', installedPolicy.status === 0 && /---- \d+ passed, 0 failed/.test(installedPolicy.stdout), `${installedPolicy.status}: ${installedPolicy.stderr}\n${installedPolicy.stdout}`)

cloneMain(cleanSource, rollbackSource)
git(rollbackSource, ['config', 'user.email', 'test@example.com'])
git(rollbackSource, ['config', 'user.name', 'Installer Regression Test'])
writeFileSync(join(rollbackSource, 'scripts', 'path-clean.py'), '#!/usr/bin/env python3\nimport sys\nsys.exit(97)\n')
git(rollbackSource, ['add', 'scripts/path-clean.py'])
git(rollbackSource, ['commit', '-qm', 'inject materialization failure'])
git(rollbackSource, ['config', 'remote.origin.url', rollbackSource])
cloneMain(rollbackSource, rollbackTarget)
const priorSettings = JSON.stringify({ sentinel: 'settings-before-materialization', hooks: { probe: `${rollbackTarget}/keep` } }, null, 2) + '\n'
const priorBrief = `sentinel implementer-before-materialization ${rollbackTarget}/keep\n`
writeFileSync(join(rollbackTarget, 'settings.json'), priorSettings)
writeFileSync(join(rollbackTarget, 'agents', 'implementer.md'), priorBrief)
chmodSync(join(rollbackTarget, 'settings.json'), 0o640)
chmodSync(join(rollbackTarget, 'agents', 'implementer.md'), 0o600)
const priorSettingsMode = statSync(join(rollbackTarget, 'settings.json')).mode & 0o777
const priorBriefMode = statSync(join(rollbackTarget, 'agents', 'implementer.md')).mode & 0o777
result = runInstall(rollbackSource, rollbackTarget)
check('injected checkout filter failure returns nonzero', result.status !== 0, `${result.status}: ${result.stderr}`)
check('transactional materialization restores both prior files byte-for-byte with modes', readFileSync(join(rollbackTarget, 'settings.json'), 'utf8') === priorSettings && readFileSync(join(rollbackTarget, 'agents', 'implementer.md'), 'utf8') === priorBrief && (statSync(join(rollbackTarget, 'settings.json')).mode & 0o777) === priorSettingsMode && (statSync(join(rollbackTarget, 'agents', 'implementer.md')).mode & 0o777) === priorBriefMode, JSON.stringify({ status: result.status, priorSettingsMode, priorBriefMode }))

cloneMain(cleanSource, malformedTarget)
const malformedSettings = JSON.stringify({ sentinel: 'settings-before-preflight', hooks: { probe: `${malformedTarget}/keep` } }, null, 2) + '\n'
const malformedBrief = `sentinel implementer-before-preflight ${malformedTarget}/keep\n`
writeFileSync(join(malformedTarget, 'settings.json'), malformedSettings)
writeFileSync(join(malformedTarget, 'agents', 'implementer.md'), malformedBrief)
writeFileSync(join(malformedTarget, 'settings.local.json'), '{not-json\n')
result = runInstall(cleanSource, malformedTarget)
check('malformed local settings fail before materialization', result.status !== 0, `${result.status}: ${result.stderr}`)
check('preflight failure leaves both prior files byte-for-byte intact', readFileSync(join(malformedTarget, 'settings.json'), 'utf8') === malformedSettings && readFileSync(join(malformedTarget, 'agents', 'implementer.md'), 'utf8') === malformedBrief, JSON.stringify({ status: result.status }))

writeFileSync(cliFixture, `#!/bin/sh
if [ "\$1" = "--version" ]; then printf '%s\\n' "\$FAKE_CODEX_VERSION"; exit 0; fi
if [ "\$1" = "exec" ] && [ "\$2" = "--help" ]; then
  printf '%s\\n' 'Usage: codex exec [OPTIONS] [PROMPT]'
  printf '%s\\n' '  -c, --config <key=value>  -m, --model <MODEL>  -s, --sandbox <SANDBOX_MODE>'
  printf '%s\\n' '  [possible values: read-only, workspace-write]'
  printf '%s\\n' '  --skip-git-repo-check  --output-last-message <FILE>  --approve-for-me  --ephemeral  -C, --cd <DIR>'
  exit 0
fi
exit 64
`)
chmodSync(cliFixture, 0o755)
mkdirSync(node25FixtureRoot)
writeFileSync(node25Fixture, `#!/bin/sh
if [ "\$1" = "--version" ]; then printf '%s\\n' 'v25.0.0'; exit 0; fi
exit 0
`)
chmodSync(node25Fixture, 0o755)
mkdirSync(incompatibleTarget)
const incompatibleSentinel = 'installer must not backup or mutate this target\n'
writeFileSync(join(incompatibleTarget, 'sentinel.txt'), incompatibleSentinel)
const incompatiblePath = join(incompatibleTarget, 'sentinel.txt')
mkdirSync(checkTarget)
writeFileSync(join(checkTarget, 'sentinel.txt'), incompatibleSentinel)
const incompatibleResult = runInstall(cleanSource, incompatibleTarget, {
  PATH: `${cliFixtureRoot}:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin`,
  FAKE_CODEX_VERSION: 'codex-cli 0.149.0',
})
check('incompatible Codex blocks install before backup or adoption', incompatibleResult.status !== 0 && readFileSync(incompatiblePath, 'utf8') === incompatibleSentinel && !readdirSync(root).some((name) => name.startsWith("claude home's incompatible.bak-")), `${incompatibleResult.status}: ${incompatibleResult.stdout}${incompatibleResult.stderr}`)
const incompatibleCheck = runCheck(cleanSource, {
  PATH: `${cliFixtureRoot}:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin`,
  FAKE_CODEX_VERSION: 'codex-cli 0.149.0',
})
check('incompatible Codex also makes --check fail closed before touching its target', incompatibleCheck.status !== 0 && readFileSync(join(checkTarget, 'sentinel.txt'), 'utf8') === incompatibleSentinel, `${incompatibleCheck.status}: ${incompatibleCheck.stdout}${incompatibleCheck.stderr}`)
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
  check(`${name} blocks --check before touching its existing target`, checkResult.status !== 0 && readFileSync(checkSentinel, 'utf8') === incompatibleSentinel, `${checkResult.status}: ${checkResult.stdout}${checkResult.stderr}`)
}
const fakeCliPath = `${cliFixtureRoot}:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin`
blockedCase('Node 25', cleanSource, { PATH: `${node25FixtureRoot}:${fakeCliPath}`, FAKE_CODEX_VERSION: 'codex-cli 0.149.1' }, 'unsupported or failed runtime')

const variantSource = (name, replacements) => {
  const source = join(root, `${name} source`)
  cloneMain(cleanSource, source)
  let helperSource = readFileSync(join(source, 'scripts', 'codex-preflight.sh'), 'utf8')
  for (const [from, to] of replacements) helperSource = helperSource.replaceAll(from, to)
  writeFileSync(join(source, 'scripts', 'codex-preflight.sh'), helperSource)
  return source
}
blockedCase('missing Perl', variantSource('missing Perl', [
  ['/usr/bin/perl', '/definitely/missing/perl'],
  ['/opt/homebrew/bin/perl', '/definitely/missing/perl'],
  ['/usr/local/bin/perl', '/definitely/missing/perl'],
]), { PATH: fakeCliPath, FAKE_CODEX_VERSION: 'codex-cli 0.149.1' })
blockedCase('missing trusted rg', variantSource('missing rg', [
  ['/opt/homebrew/bin/rg', '/definitely/missing/rg'],
  ['/usr/local/bin/rg', '/definitely/missing/rg'],
]), { PATH: fakeCliPath, FAKE_CODEX_VERSION: 'codex-cli 0.149.1' })
blockedCase('missing trusted mktemp', variantSource('missing mktemp', [
  ['CODEX_PREFLIGHT_MKTEMP=/usr/bin/mktemp', 'CODEX_PREFLIGHT_MKTEMP=/definitely/missing/mktemp'],
]), { PATH: fakeCliPath, FAKE_CODEX_VERSION: 'codex-cli 0.149.1' })

rmSync(root, { recursive: true, force: true })
rmSync(cliFixtureRoot, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
