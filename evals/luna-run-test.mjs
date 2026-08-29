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
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-luna-run-'))
const fake = join(root, 'codex')
const argsFile = join(root, 'args')
const stdinFile = join(root, 'stdin')
const work = join(root, 'work')
const prompt = join(root, 'brief')
writeFileSync(fake, `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
: > "$FAKE_ARGS"
for arg in "$@"; do printf '%s\\n' "$arg" >> "$FAKE_ARGS"; done
if [ -n "\${GROUP_FILE:-}" ]; then /usr/bin/perl -e 'print "$$ ", getpgrp(), "\\n"' > "$GROUP_FILE"; fi
if [ -n "\${CHILD_PID_FILE:-}" ]; then
  (sleep "\${CHILD_DELAY:-3}"; printf '%s\\n' descendant-survived > "$CHILD_MARK") &
  printf '%s\\n' "$!" > "$CHILD_PID_FILE"
fi
cat > "$FAKE_STDIN"
if [ "\${FAKE_SLEEP:-0}" -gt 0 ]; then sleep "$FAKE_SLEEP"; fi
exit "\${FAKE_EXIT:-0}"
`)
chmodSync(fake, 0o755)
// A directory created through the test harness makes the working-root check explicit.
mkdirSync(work)
const promptBytes = Buffer.from('exact $dollars `quotes`\nline two\n', 'utf8')
writeFileSync(prompt, promptBytes)

const wrapper = fileURLToPath(new URL('../scripts/luna-run.sh', import.meta.url))
const env = {
  ...process.env,
  PATH: `${root}:${process.env.PATH || ''}`,
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
check('wrapper pins xhigh effort', args.includes('model_reasoning_effort=xhigh'), args.join(' | '))
check('wrapper pins workspace-write sandbox', args.includes('workspace-write'), args.join(' | '))
check('wrapper pins review approval', args.includes('--approve-for-me'), args.join(' | '))
check('wrapper disables MCP', args.includes('mcp_servers={}'), args.join(' | '))
check('wrapper has no dangerous bypass flags', !args.some((arg) => arg.startsWith('--dangerously-')), args.join(' | '))
check('wrapper passes the resolved working directory', args.includes(resolvedWork), args.join(' | '))
check('wrapper ignores arbitrary binary overrides', !args.includes(join(root, 'missing-override')),
  args.join(' | '))
check('wrapper cleans its owner-private runtime directory', readdirSync(root).every((name) => !name.startsWith('claude-luna-run.')), readdirSync(root).join(' | '))

let runtimeCode = 0
try { run({ FAKE_EXIT: '7' }) } catch (error) { runtimeCode = error.status } 
check('runtime failure has a distinct exit code', runtimeCode === 70, `got ${runtimeCode}`)

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

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
