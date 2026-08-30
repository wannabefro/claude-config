import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const repo = fileURLToPath(new URL('..', import.meta.url))
const helper = join(repo, 'scripts', 'codex-preflight.sh')
const luna = join(repo, 'scripts', 'luna-run.sh')
const review = join(repo, 'scripts', 'codex-run.sh')
const root = mkdtempSync(join(tmpdir(), 'claude-codex-preflight-'))
const temporaryRoots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', realpathSync(tmpdir())]
const isUnder = (candidate, rootPath) => candidate === rootPath || candidate.startsWith(`${rootPath}/`)
let fixtureParent = dirname(repo)
while (fixtureParent !== '/' && (existsSync(join(fixtureParent, '.git')) || temporaryRoots.some((rootPath) => isUnder(fixtureParent, rootPath)))) fixtureParent = dirname(fixtureParent)
if (fixtureParent === '/') throw new Error('could not find a safe sibling outside Git and macOS temporary roots')
const fixtureRoot = mkdtempSync(join(fixtureParent, 'claude-codex-preflight-safe-'))
const fakeBin = join(fixtureRoot, 'bin')
const fakeReal = join(fakeBin, 'codex-real')
const fakeCodex = join(fakeBin, 'codex')
const fakeHelp = join(root, 'help')
const fakeInvocations = join(root, 'invocations')
const fakeCalls = join(root, 'calls')
const probe = join(root, 'probe.sh')
const work = join(root, 'work')
const prompt = join(root, 'brief')
const npmMarker = join(root, 'npm-called')
const brewMarker = join(root, 'brew-called')
const hijackBin = join(root, 'hijack-bin')
const hijackMarker = join(root, 'realpath-hijacked')
const dirnameMarker = join(root, 'dirname-hijacked')
const repoWinnerBin = join(repo, '.codex-preflight-test-winner')
const tempWinnerBin = join(root, 'temp-winner-bin')
const tempTarget = join(root, 'temp-target-codex')
const safeWinnerBin = join(fixtureRoot, 'safe-winner-bin')
const resolvedTmpLink = join(root, 'resolved-tmp-link')
mkdirSync(fakeBin)
mkdirSync(work)
mkdirSync(hijackBin)
mkdirSync(repoWinnerBin)
mkdirSync(tempWinnerBin)
mkdirSync(safeWinnerBin)
writeFileSync(prompt, 'Return a short confirmation.\n')
writeFileSync(fakeReal, `#!/bin/sh
printf '%s\\n' "\${1:-}" >> "\$FAKE_CALLS"
if [ "\${1:-}" = "--version" ]; then
  printf '%s\\n' "\$FAKE_VERSION"
  exit "\${FAKE_VERSION_EXIT:-0}"
fi
if [ "\${1:-}" = "exec" ] && [ "\${2:-}" = "--help" ]; then
  cat "\$FAKE_HELP"
  if [ "\${REPLACE_AFTER_HELP:-0}" = 1 ]; then
    rm -f "\$FAKE_LINK"
    ln -s "\$FAKE_REPLACEMENT" "\$FAKE_LINK"
  fi
  if [ "\${REPLACE_IN_PLACE:-0}" = 1 ]; then
    cp "\$FAKE_REPLACEMENT" "\$FAKE_TARGET"
  fi
  exit "\${FAKE_HELP_EXIT:-0}"
fi
if [ "\${1:-}" = "exec" ]; then
  printf '%s\\n' "$0" >> "$FAKE_INVOCATIONS"
  : > "\$FAKE_ARGS"
  last=''
  previous=''
  for arg in "$@"; do
    printf '%s\\n' "\$arg" >> "\$FAKE_ARGS"
    if [ "$previous" = '--output-last-message' ]; then last="$arg"; fi
    previous="$arg"
  done
  if [ -n "$last" ]; then printf '%s\\n' 'assistant result' > "$last"; else printf '%s\\n' 'assistant result'; fi
  exit "\${FAKE_EXEC_EXIT:-0}"
fi
exit 64
`)
chmodSync(fakeReal, 0o755)
const originalFake = readFileSync(fakeReal)
symlinkSync(fakeReal, fakeCodex)
const replacement = join(fixtureRoot, 'codex-replacement')
const replacementMarker = join(root, 'replacement-invoked')
writeFileSync(replacement, `#!/bin/sh
if [ "\$1" = "exec" ]; then printf called > "\$REPLACEMENT_MARKER"; fi
exit 0
`)
chmodSync(replacement, 0o755)
writeFileSync(join(fakeBin, 'npm'), `#!/bin/sh
printf called > "$NPM_MARKER"
exit 99
`)
writeFileSync(join(fakeBin, 'brew'), `#!/bin/sh
printf called > "$BREW_MARKER"
exit 99
`)
chmodSync(join(fakeBin, 'npm'), 0o755)
chmodSync(join(fakeBin, 'brew'), 0o755)
writeFileSync(join(hijackBin, 'realpath'), `#!/bin/sh
printf hijacked > "$HIJACK_MARKER"
printf '%s\\n' /definitely/not/the/codex
exit 0
`)
chmodSync(join(hijackBin, 'realpath'), 0o755)
writeFileSync(join(hijackBin, 'dirname'), `#!/bin/sh
printf hijacked > "\$DIRNAME_MARKER"
printf '%s\\n' /definitely/not/the/wrapper
exit 0
`)
chmodSync(join(hijackBin, 'dirname'), 0o755)
writeFileSync(probe, `#!/bin/bash
set -u
source "$1"
codex_preflight "$2"
status=$?
[ "$status" -eq 0 ] || exit "$status"
printf '%s|%s\\n' "$CODEX_BIN" "$CODEX_VERSION"
`)
chmodSync(probe, 0o755)

const fullHelp = `Usage: codex exec [OPTIONS] [PROMPT]
  -c, --config <key=value>
  -m, --model <MODEL>
  -s, --sandbox <SANDBOX_MODE>
  [possible values: read-only, workspace-write, danger-full-access]
  --skip-git-repo-check
  --output-last-message <FILE>
  --approve-for-me
  --ephemeral
  -C, --cd <DIR>
`
const reviewOnlyHelp = fullHelp.replace('  --approve-for-me\n', '').replace('  --ephemeral\n', '').replace('  -C, --cd <DIR>\n', '')
const env = {
  ...process.env,
  PATH: `${fakeBin}:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin`,
  FAKE_HELP: fakeHelp,
  FAKE_CALLS: fakeCalls,
  FAKE_INVOCATIONS: fakeInvocations,
  NPM_MARKER: npmMarker,
  BREW_MARKER: brewMarker,
  CODEX_BIN: join(root, 'ignored-override'),
}
const runPreflight = (lane, version, help = fullHelp, extra = {}) => {
  writeFileSync(fakeHelp, help)
  const result = spawnSync('/bin/bash', [probe, helper, lane], {
    cwd: repo,
    env: { ...env, FAKE_VERSION: version, ...extra },
    encoding: 'utf8',
  })
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

for (const version of ['codex-cli 0.149.1', 'codex-cli 99.4.2']) {
  const result = runPreflight('all', version)
  check(`stable ${version.replace('codex-cli ', '')} with the full exec surface passes`, result.status === 0 && result.stdout.includes(`${fakeReal}|${version.replace('codex-cli ', '')}`), result.output)
}
for (const version of [
  'codex-cli 0.149.0',
  'codex-cli 0.149.1-beta.1',
  'codex-cli 0.149.1+build.1',
  'codex-cli 0.149',
  'codex-cli 0.149.1.2',
  'codex-cli nope',
]) {
  const result = runPreflight('all', version)
  check(`rejects unsupported version output ${version}`, result.status !== 0 && result.output.includes(fakeReal), result.output)
}
const missingWriter = runPreflight('all', 'codex-cli 99.4.2', reviewOnlyHelp)
check('a high stable version missing one writer flag fails closed', missingWriter.status !== 0 && missingWriter.output.includes('required writer surface'), missingWriter.output)
const reviewPass = runPreflight('review', 'codex-cli 99.4.2', reviewOnlyHelp)
check('a review lane checks only its required review surface', reviewPass.status === 0, reviewPass.output)
const missingReview = runPreflight('review', 'codex-cli 99.4.2', fullHelp.replace('  --output-last-message <FILE>\n', ''))
check('a high stable version missing one review flag fails closed', missingReview.status !== 0 && missingReview.output.includes('required review surface'), missingReview.output)
const missingExec = runPreflight('review', 'codex-cli 99.4.2', fullHelp.replace('Usage: codex exec', 'Usage: codex run'))
check('a high stable version missing the exec command fails closed', missingExec.status !== 0 && missingExec.output.includes('required common exec flag'), missingExec.output)

symlinkSync(fakeReal, join(repoWinnerBin, 'codex'))
symlinkSync(fakeReal, join(tempWinnerBin, 'codex'))
writeFileSync(tempTarget, readFileSync(fakeReal))
chmodSync(tempTarget, 0o755)
symlinkSync(tempTarget, join(safeWinnerBin, 'codex'))
symlinkSync(fixtureRoot, resolvedTmpLink)
const repoWinner = runPreflight('review', 'codex-cli 99.4.2', fullHelp, { PATH: `${repoWinnerBin}:${env.PATH}` })
check('rejects a Codex winner inside the current checkout', repoWinner.status !== 0 && repoWinner.output.includes('repository'), repoWinner.output)
const tempWinner = runPreflight('review', 'codex-cli 99.4.2', fullHelp, { PATH: `${tempWinnerBin}:${env.PATH}` })
check('rejects a Codex winner inside a macOS temporary root', tempWinner.status !== 0 && tempWinner.output.includes('temporary root'), tempWinner.output)
const tempTargetResult = runPreflight('review', 'codex-cli 99.4.2', fullHelp, { PATH: `${safeWinnerBin}:${env.PATH}` })
check('rejects a resolved Codex target inside a macOS temporary root', tempTargetResult.status !== 0 && tempTargetResult.output.includes('temporary root'), tempTargetResult.output)
const resolvedTmpResult = runPreflight('review', 'codex-cli 99.4.2', fullHelp, { PATH: `${fakeBin}:${env.PATH}`, TMPDIR: resolvedTmpLink })
check('rejects a Codex path under the resolved TMPDIR', resolvedTmpResult.status !== 0 && resolvedTmpResult.output.includes('temporary root'), resolvedTmpResult.output)
const trustedResolver = runPreflight('review', 'codex-cli 99.4.2', fullHelp, { PATH: `${hijackBin}:${fakeBin}:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin`, HIJACK_MARKER: hijackMarker })
check('uses trusted realpath even when PATH contains a redirecting fake', trustedResolver.status === 0 && !existsSync(hijackMarker), trustedResolver.output)

const wrapperEnv = {
  ...env,
  PATH: `${hijackBin}:${env.PATH}`,
  FAKE_VERSION: 'codex-cli 0.149.1',
  FAKE_ARGS: join(root, 'args'),
  FAKE_STDIN: join(root, 'stdin'),
  DIRNAME_MARKER: dirnameMarker,
  TMPDIR: root,
}
writeFileSync(fakeHelp, fullHelp)
let lunaCode = 0
try {
  execFileSync(luna, [prompt, work], { cwd: work, env: wrapperEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) { lunaCode = error.status ?? 1 }
let reviewCode = 0
try {
  execFileSync(review, ['-t', '5', '-s', '2', '-f', prompt, '-d', work, '-N'], { cwd: work, env: wrapperEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) { reviewCode = error.status ?? 1 }
const resolvedCalls = existsSync(fakeInvocations) ? readFileSync(fakeInvocations, 'utf8').trim().split('\n').filter(Boolean) : []
check('both wrappers execute the one resolved realpath', lunaCode === 0 && reviewCode === 0 && resolvedCalls.length === 2 && resolvedCalls.every((path) => path === realpathSync(fakeReal)), JSON.stringify({ lunaCode, reviewCode, resolvedCalls, expected: realpathSync(fakeReal) }))
check('wrappers use the trusted dirname for their script root', !existsSync(dirnameMarker), JSON.stringify({ lunaCode, reviewCode, dirnameHijacked: existsSync(dirnameMarker) }))
check('callers cannot replace the selected binary through CODEX_BIN', !readFileSync(fakeCalls, 'utf8').includes('ignored-override'), readFileSync(fakeCalls, 'utf8'))

rmSync(fakeCodex, { force: true })
symlinkSync(fakeReal, fakeCodex)
let replacementLunaCode = 0
try {
  execFileSync(luna, [prompt, work], { cwd: work, env: { ...wrapperEnv, REPLACE_AFTER_HELP: '1', FAKE_LINK: fakeCodex, FAKE_REPLACEMENT: replacement, REPLACEMENT_MARKER: replacementMarker }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) { replacementLunaCode = error.status ?? 1 }
check('Luna refuses a Codex symlink replacement before workspace-write exec', replacementLunaCode === 69 && !existsSync(replacementMarker), JSON.stringify({ replacementLunaCode, invoked: existsSync(replacementMarker) }))
rmSync(fakeCodex, { force: true })
symlinkSync(fakeReal, fakeCodex)
let replacementReviewCode = 0
try {
  execFileSync(review, ['-t', '5', '-s', '2', '-f', prompt, '-d', work, '-N'], { cwd: work, env: { ...wrapperEnv, REPLACE_AFTER_HELP: '1', FAKE_LINK: fakeCodex, FAKE_REPLACEMENT: replacement, REPLACEMENT_MARKER: replacementMarker }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) { replacementReviewCode = error.status ?? 1 }
check('Sol review refuses a Codex symlink replacement before review exec', replacementReviewCode === 3 && !existsSync(replacementMarker), JSON.stringify({ replacementReviewCode, invoked: existsSync(replacementMarker) }))

rmSync(fakeCodex, { force: true })
symlinkSync(fakeReal, fakeCodex)
writeFileSync(fakeReal, originalFake)
chmodSync(fakeReal, 0o755)
rmSync(replacementMarker, { force: true })
let inPlaceLunaCode = 0
try {
  execFileSync(luna, [prompt, work], { cwd: work, env: { ...wrapperEnv, REPLACE_IN_PLACE: '1', FAKE_TARGET: fakeReal, FAKE_REPLACEMENT: replacement, REPLACEMENT_MARKER: replacementMarker }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) { inPlaceLunaCode = error.status ?? 1 }
check('Luna refuses an in-place Codex replacement before workspace-write exec', inPlaceLunaCode === 69 && !existsSync(replacementMarker), JSON.stringify({ inPlaceLunaCode, invoked: existsSync(replacementMarker) }))
writeFileSync(fakeReal, originalFake)
chmodSync(fakeReal, 0o755)
rmSync(replacementMarker, { force: true })
writeFileSync(fakeHelp, fullHelp)
const install = spawnSync('/bin/bash', [join(repo, 'install.sh'), '--check'], {
  cwd: repo,
  env: { ...wrapperEnv, FAKE_HELP: fakeHelp, FAKE_VERSION: 'codex-cli 0.149.1' },
  encoding: 'utf8',
})
check('installer never invokes npm or brew while reporting prerequisites', install.status === 0 && !existsSync(npmMarker) && !existsSync(brewMarker), `${install.status}: ${install.stdout}${install.stderr}`)
check('installer uses the trusted dirname for target resolution', !existsSync(dirnameMarker), `${install.status}: dirnameHijacked=${existsSync(dirnameMarker)}`)
check('installer reports the selected CLI path and version', install.stdout.includes(fakeReal) && install.stdout.includes('codex 0.149.1'), install.stdout)
check('installer does not suggest an exact-version Codex install', !install.stdout.includes('@openai/codex@'), install.stdout)

const settings = JSON.parse(readFileSync(join(repo, 'settings.json'), 'utf8'))
check('Codex plugin route is explicitly disabled', settings.enabledPlugins['codex@openai-codex'] === false && !('openai-codex' in settings.extraKnownMarketplaces))
check('direct Codex exec permission is absent', !settings.permissions.allow.some((permission) => permission.startsWith('Bash(codex exec ')), JSON.stringify(settings.permissions.allow.filter((permission) => permission.includes('codex'))))
check('Codex preflight is shared by installer and both wrappers', readFileSync(join(repo, 'install.sh'), 'utf8').includes('codex_preflight all') && readFileSync(luna, 'utf8').includes('codex_preflight writer') && readFileSync(review, 'utf8').includes('codex_preflight review'))

rmSync(root, { recursive: true, force: true })
rmSync(fixtureRoot, { recursive: true, force: true })
rmSync(repoWinnerBin, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
