import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-luna-run-'))
const repo = fileURLToPath(new URL('../', import.meta.url))
const temporaryRoots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', realpathSync(tmpdir())]
const isUnder = (candidate, rootPath) => candidate === rootPath || candidate.startsWith(`${rootPath}/`)
let fixtureParent = process.env.LUNA_RUN_SAFE_FIXTURE_PARENT || dirname(repo)
while (fixtureParent !== '/' && (existsSync(join(fixtureParent, '.git')) || temporaryRoots.some((rootPath) => isUnder(fixtureParent, rootPath)))) fixtureParent = dirname(fixtureParent)
if (fixtureParent === '/') throw new Error('could not find a safe sibling outside Git and macOS temporary roots')
const fixtureRoot = mkdtempSync(join(fixtureParent, 'claude-luna-run-safe-'))
const fake = join(fixtureRoot, 'codex')
const hostileRoot = mkdtempSync(join(tmpdir(), 'claude-luna-run-hostile-'))
const hostileMarker = join(hostileRoot, 'invoked')
const hostileUtilities = ['mktemp', 'stat', 'id', 'rm', 'cat', 'ps', 'tr', 'wc', 'awk', 'grep', 'pgrep', 'find', 'sleep', 'shasum', 'realpath', 'perl', 'date']
for (const utility of hostileUtilities) {
  const shim = join(hostileRoot, utility)
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' '${utility}' >> \"$HOSTILE_MARKER\"\nexit 99\n`)
  chmodSync(shim, 0o755)
}
const argsFile = join(root, 'args')
const stdinFile = join(root, 'stdin')
const work = join(root, 'work')
const emptyHome = join(root, 'home')
const prompt = join(root, 'brief')
writeFileSync(fake, `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'codex-cli 0.149.1'; exit 0; fi
if [ "$1" = "exec" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' 'Usage: codex exec [OPTIONS] [PROMPT]'
  printf '%s\\n' '  -c, --config <key=value>'
  printf '%s\\n' '  -m, --model <MODEL>'
  printf '%s\\n' '  -s, --sandbox <SANDBOX_MODE>'
  printf '%s\\n' '  [possible values: read-only, workspace-write, danger-full-access]'
  printf '%s\\n' '  --approve-for-me  --ephemeral  --ignore-user-config  --output-last-message <FILE>  -C, --cd <DIR>'
  exit 0
fi
: > "$FAKE_ARGS"
last=''
previous=''
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "$FAKE_ARGS"
  if [ "$previous" = '--output-last-message' ]; then last="$arg"; fi
  previous="$arg"
done
if [ -n "\${GROUP_FILE:-}" ]; then /usr/bin/perl -e 'print "$$ ", getpgrp(), "\\n"' > "$GROUP_FILE"; fi
if [ -n "\${CHILD_PID_FILE:-}" ]; then
  (/bin/sleep "\${CHILD_DELAY:-3}"; printf '%s\\n' descendant-survived > "$CHILD_MARK") &
  printf '%s\\n' "$!" > "$CHILD_PID_FILE"
fi
/bin/cat > "$FAKE_STDIN"
if [ "\${FAKE_REFUSED:-0}" = 1 ]; then
  printf '%s\\n' 'workspace is out of credits'
  exit "\${FAKE_EXIT:-0}"
fi
if [ -n "\${last:-}" ]; then
  case "\${FAKE_LAST_MESSAGE:-nonempty}" in
    missing) ;;
    empty) : > "$last" ;;
    whitespace) printf '  \n' > "$last" ;;
    *) printf '%s\n' 'assistant result' > "$last" ;;
  esac
fi
if [ "\${FAKE_SLEEP:-0}" -gt 0 ]; then /bin/sleep "$FAKE_SLEEP"; fi
exit "\${FAKE_EXIT:-0}"
`)
chmodSync(fake, 0o755)
// A directory created through the test harness makes the working-root check explicit.
mkdirSync(work)
mkdirSync(emptyHome)
const promptBytes = Buffer.from('exact $dollars `quotes`\nline two\n', 'utf8')
writeFileSync(prompt, promptBytes)

const wrapper = fileURLToPath(new URL('../scripts/luna-run.sh', import.meta.url))
const env = {
  ...process.env,
  HOME: emptyHome,
  PATH: `${fixtureRoot}:${process.env.PATH || ''}`,
  TMPDIR: root,
  CODEX_BIN: join(root, 'missing-override'),
  PERL_BIN: join(root, 'missing-perl-override'),
  FAKE_ARGS: argsFile,
  FAKE_STDIN: stdinFile,
}
const run = (extraEnv = {}) => execFileSync(wrapper, [prompt, work], {
  cwd: work,
  env: { ...env, ...extraEnv },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

run()
const args = readFileSync(argsFile, 'utf8').trimEnd().split('\n')
const received = readFileSync(stdinFile)
const resolvedWork = realpathSync(work)
check('wrapper preserves prompt bytes through stdin', received.equals(promptBytes), received.toString())
check('wrapper invokes noninteractive Codex exec', args[0] === 'exec' && args.at(-1) === '-', args.join(' | '))
check('wrapper pins Luna model', args.includes('gpt-5.6-luna'), args.join(' | '))
check('wrapper pins medium effort', args.includes('model_reasoning_effort=medium'), args.join(' | '))
check('wrapper captures the authoritative last message', args.includes('--output-last-message'), args.join(' | '))
// Codex >= 0.152.0 rejects --sandbox beside --approve-for-me, which itself selects workspace-write.
check('wrapper takes workspace-write from --approve-for-me and passes no explicit sandbox', args.includes('--approve-for-me') && !args.includes('--sandbox') && !args.includes('-s'), args.join(' | '))
check('wrapper pins review approval', args.includes('--approve-for-me'), args.join(' | '))
check('wrapper disables inherited MCP config', args.includes('--ignore-user-config') && !args.includes('mcp_servers={}'), args.join(' | '))
check('wrapper has no dangerous bypass flags', !args.some((arg) => arg.startsWith('--dangerously-')), args.join(' | '))
check('wrapper passes the resolved working directory', args.includes(resolvedWork), args.join(' | '))
check('wrapper ignores arbitrary binary overrides', !args.includes(join(root, 'missing-override')),
  args.join(' | '))
check('wrapper cleans its owner-private runtime directory', readdirSync(root).every((name) => !name.startsWith('claude-luna-run.')), readdirSync(root).join(' | '))

const hostileEnv = {
  PATH: `${hostileRoot}:${fixtureRoot}:${process.env.PATH || ''}`,
  HOSTILE_MARKER: hostileMarker,
}
let hostileCode = 0
try { run({ ...hostileEnv }) } catch (error) { hostileCode = error.status }
const hostileInvocations = existsSync(hostileMarker) ? readFileSync(hostileMarker, 'utf8') : ''
check('wrapper ignores PATH shims for control utilities while using the intended Codex', hostileCode === 0 && hostileInvocations === '', `code=${hostileCode} marker=${JSON.stringify(hostileInvocations)}`)

let runtimeCode = 0
try { run({ FAKE_EXIT: '7' }) } catch (error) { runtimeCode = error.status }
check('runtime failure has a distinct exit code', runtimeCode === 70, `got ${runtimeCode}`)

let emptyCode = 0
try { run({ FAKE_LAST_MESSAGE: 'empty' }) } catch (error) { emptyCode = error.status }
check('empty last message is a failed empty pass', emptyCode === 75, `got ${emptyCode}`)

let whitespaceCode = 0
try { run({ FAKE_LAST_MESSAGE: 'whitespace' }) } catch (error) { whitespaceCode = error.status }
check('whitespace-only last message is a failed empty pass', whitespaceCode === 75, `got ${whitespaceCode}`)

let nonemptyCode = 0
try { run({ FAKE_LAST_MESSAGE: 'nonempty' }) } catch (error) { nonemptyCode = error.status }
check('non-empty last message succeeds', nonemptyCode === 0, `got ${nonemptyCode}`)

let stallCode = 0
let stallError = ''
try { run({ FAKE_SLEEP: '3', LUNA_RUN_TIMEOUT_SECONDS: '5', LUNA_RUN_STALL_SECONDS: '1' }) } catch (error) { stallCode = error.status; stallError = error.stderr?.toString() || '' }
check('stall watcher has a distinct exit code', stallCode === 76 && stallError.includes('stalled'), `code=${stallCode} stderr=${stallError}`)

let hardTimeoutCode = 0
let hardTimeoutError = ''
try { run({ FAKE_SLEEP: '120', LUNA_RUN_TIMEOUT_SECONDS: '31', LUNA_RUN_STALL_SECONDS: '31' }) } catch (error) { hardTimeoutCode = error.status; hardTimeoutError = error.stderr?.toString() || '' }
check('hard timeout has a distinct exit code and message', hardTimeoutCode === 124 && hardTimeoutError.includes('hard timeout'), `code=${hardTimeoutCode} stderr=${hardTimeoutError}`)
check('heartbeat reports Luna progress on stderr', hardTimeoutError.includes('luna-run: gpt-5.6-luna medium, 30s elapsed'), hardTimeoutError)

const wrapperSource = readFileSync(wrapper, 'utf8')
check('wrapper source keeps the integer guard on the wc reading', wrapperSource.includes("''|[!0-9]*|[0-9]*[!0-9]*) ;;"), 'missing non-integer wc guard')

const childPidFile = join(root, 'child-pid')
const childMark = join(root, 'child-mark')
const groupFile = join(root, 'group')
let descendantTimeoutCode = 0
let descendantTimeoutError = ''
try { run({ FAKE_SLEEP: '3', LUNA_RUN_TIMEOUT_SECONDS: '1', CHILD_PID_FILE: childPidFile, CHILD_MARK: childMark, GROUP_FILE: groupFile }) } catch (error) { descendantTimeoutCode = error.status; descendantTimeoutError = error.stderr?.toString() || '' }
await new Promise((resolve) => setTimeout(resolve, 4000))
check('hard timeout kills descendants that could write after the wrapper exits', descendantTimeoutCode === 124 && !existsSync(childMark), `wrapper=${descendantTimeoutCode} mark_exists=${existsSync(childMark)} group=${existsSync(groupFile) ? readFileSync(groupFile, 'utf8') : 'missing'} ${descendantTimeoutError}`)

let timeoutCode = 0
try { run({ FAKE_SLEEP: '3', LUNA_RUN_TIMEOUT_SECONDS: '1' }) } catch (error) { timeoutCode = error.status }
check('runtime timeout has a distinct exit code', timeoutCode === 124, `got ${timeoutCode}`)

let missingCode = 0
try {
  execFileSync(wrapper, [prompt, work], { cwd: work, env: { ...env, PATH: '/usr/bin:/bin' } })
} catch (error) { missingCode = error.status }
check('missing CLI has a distinct exit code', missingCode === 69, `got ${missingCode}`)

let inputCode = 0
try { execFileSync(wrapper, [join(root, 'missing-brief'), work], { cwd: work, env }) } catch (error) { inputCode = error.status }
check('invalid prompt input has a distinct exit code', inputCode === 64, `got ${inputCode}`)

// Refusal cache: each case gets its own TMPDIR so its marker cannot leak into another case.
const refusalMarker = (dir) => join(dir, 'claude-codex-refused')
const nowEpoch = () => Math.floor(Date.now() / 1000)

const refusalRoot1 = mkdtempSync(join(root, 'refusal-'))
let refusalWriteCode = 0
try { run({ FAKE_REFUSED: '1', TMPDIR: refusalRoot1 }) } catch (error) { refusalWriteCode = error.status }
check('a refusal writes the marker', refusalWriteCode === 77 && existsSync(refusalMarker(refusalRoot1)), `code=${refusalWriteCode} exists=${existsSync(refusalMarker(refusalRoot1))}`)

const refusalRoot2 = mkdtempSync(join(root, 'refusal-'))
writeFileSync(refusalMarker(refusalRoot2), `${nowEpoch()} writer test\n`)
rmSync(argsFile, { force: true })
let cachedCode = 0
let cachedStderr = ''
try { run({ TMPDIR: refusalRoot2 }) } catch (error) { cachedCode = error.status; cachedStderr = error.stderr?.toString() || '' }
check('a fresh marker exits 77 without invoking the fake CLI', cachedCode === 77 && !existsSync(argsFile), `code=${cachedCode} argsExists=${existsSync(argsFile)}`)
check('the cached-refusal message names the override', cachedStderr.includes('CODEX_IGNORE_REFUSAL=1'), cachedStderr)

const refusalRoot3 = mkdtempSync(join(root, 'refusal-'))
writeFileSync(refusalMarker(refusalRoot3), '1 writer old-test\n')
let expiredCode = 0
try { run({ TMPDIR: refusalRoot3 }) } catch (error) { expiredCode = error.status }
check('an expired marker lets the run proceed', expiredCode === 0, `got ${expiredCode}`)

const refusalRoot4 = mkdtempSync(join(root, 'refusal-'))
writeFileSync(refusalMarker(refusalRoot4), '1 writer old-test\n')
let successCode = 0
try { run({ TMPDIR: refusalRoot4 }) } catch (error) { successCode = error.status }
check('a successful run clears the marker', successCode === 0 && !existsSync(refusalMarker(refusalRoot4)), `code=${successCode}`)

const refusalRoot5 = mkdtempSync(join(root, 'refusal-'))
writeFileSync(refusalMarker(refusalRoot5), `${nowEpoch()} writer test\n`)
let bypassCode = 0
try { run({ TMPDIR: refusalRoot5, CODEX_IGNORE_REFUSAL: '1' }) } catch (error) { bypassCode = error.status }
check('CODEX_IGNORE_REFUSAL=1 runs even with a fresh marker', bypassCode === 0, `got ${bypassCode}`)

rmSync(root, { recursive: true, force: true })
rmSync(fixtureRoot, { recursive: true, force: true })
rmSync(hostileRoot, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
