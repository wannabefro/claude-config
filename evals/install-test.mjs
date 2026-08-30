import { execFileSync as runFile, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
const env = { ...process.env, HOME: testHome, PATH: `/opt/homebrew/opt/node@24/bin:${process.env.PATH || ''}` }
const git = (cwd, args) => runFile('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' })
const cloneMain = (source, destination) => {
  runFile('git', ['clone', '-q', '-b', 'main', source, destination], { encoding: 'utf8', stdio: 'pipe' })
}
const snapshotWorkingInstaller = (source) => {
  for (const relative of ['install.sh', '.gitattributes', 'settings.json', 'rules/routing.md', 'scripts/path-clean.py', 'scripts/settings-clean.py', 'scripts/codex-preflight.sh', 'scripts/luna-run.sh', 'scripts/codex-run.sh', 'evals/claude-policy-test.mjs']) {
    writeFileSync(join(source, relative), readFileSync(join(repo, relative)))
  }
  git(source, ['add', 'install.sh', '.gitattributes', 'settings.json', 'rules/routing.md', 'scripts/path-clean.py', 'scripts/settings-clean.py', 'scripts/codex-preflight.sh', 'scripts/luna-run.sh', 'scripts/codex-run.sh', 'evals/claude-policy-test.mjs'])
  const staged = spawnSync('git', ['-C', source, 'diff', '--cached', '--quiet'], { encoding: 'utf8' })
  if (staged.status === 1) git(source, ['commit', '-qm', 'snapshot installer under test'])
  else if (staged.status !== 0) throw new Error(`could not inspect installer snapshot index: ${staged.status}`)
}
const runInstall = (source, target) => spawnSync('/bin/bash', [join(source, 'install.sh'), '--target', target, '--force'], {
  cwd: source,
  env,
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
check('installed materialized policy accepts only the exact current-root wrapper permission', installedPolicy.status === 0 && /---- \d+ passed, 0 failed/.test(installedPolicy.stdout), `${installedPolicy.status}: ${installedPolicy.stderr}`)

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

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
