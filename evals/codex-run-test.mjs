import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-codex-run-'))
const fake = join(root, 'codex')
const argsFile = join(root, 'args')
const stdinFile = join(root, 'stdin')
const work = join(root, 'work')
const prompt = join(root, 'brief')
mkdirSync(work)
writeFileSync(fake, `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
: > "$FAKE_ARGS"
last_message=''
for arg in "$@"; do printf '%s\\n' "$arg" >> "$FAKE_ARGS"; done
for i in "$@"; do
  if [ "$i" = '--output-last-message' ]; then
    shift
    last_message="$1"
    break
  fi
  shift
done
cat > "$FAKE_STDIN"
if [ "\${FAKE_HEADER:-0}" = 1 ]; then
  printf '%s\\n' 'codex exec header only'
  exit 0
fi
if [ -n "\${CHILD_PID_FILE:-}" ]; then
  (sleep 30) &
  printf '%s\\n' "$!" > "$CHILD_PID_FILE"
fi
if [ "\${FAKE_SLEEP:-0}" -gt 0 ]; then sleep "$FAKE_SLEEP"; fi
if [ "\${FAKE_REFUSED:-0}" = 1 ]; then
  printf '%s\\n' 'workspace is out of credits'
else
  printf '%s\\n' 'assistant review complete' > "$last_message"
  printf '%s\\n' 'transport header: noisy'
  printf '%s\\n' 'assistant review complete'
fi
exit "\${FAKE_EXIT:-0}"
`)
chmodSync(fake, 0o755)
const promptText = 'Review this exact brief: $value `quoted`\n'
writeFileSync(prompt, promptText)

const wrapper = fileURLToPath(new URL('../scripts/codex-run.sh', import.meta.url))
const env = { ...process.env, PATH: `${root}:${process.env.PATH || ''}`, CODEX_BIN: fake, FAKE_ARGS: argsFile, FAKE_STDIN: stdinFile }
const run = (extraEnv = {}) => execFileSync(wrapper, [
  '-t', '5', '-s', '2', '-f', prompt, '-d', work, '-N',
], { cwd: work, env: { ...env, ...extraEnv }, encoding: 'utf8' })

let output = ''
let code = 0
try { output = run() } catch (error) { code = error.status }
const args = readFileSync(argsFile, 'utf8').trimEnd().split('\n')
const promptArg = args.find((arg) => arg.startsWith(promptText.trimEnd())) || ''
const stdinText = readFileSync(stdinFile, 'utf8')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

check('wrapper completes a stub Sol pass', code === 0 && output === 'assistant review complete\n', `${code}: ${JSON.stringify(output)}`)
check('wrapper returns only the authoritative assistant result', !output.includes('transport header') && output === 'assistant review complete\n', JSON.stringify(output))
check('wrapper requires the explicit assistant-result channel', args.includes('--output-last-message'), args.join(' | '))
check('wrapper pins the Sol model', args.includes('gpt-5.6-sol'), args.join(' | '))
check('wrapper pins xhigh without an effort fallback', args.includes('model_reasoning_effort=xhigh') && !args.some((arg) => /reasoning_effort=(none|low|medium|high)$/.test(arg)), args.join(' | '))
check('wrapper disables MCP by default', args.includes('mcp_servers={}'), args.join(' | '))
check('wrapper sends the prompt through stdin instead of argv', args.includes('-') && !promptArg && stdinText.includes(promptText.trimEnd()), `${args.join(' | ')} | stdin=${stdinText}`)
check('wrapper pins a read-only sandbox', args.includes('--sandbox') && args.includes('read-only'), args.join(' | '))
check('wrapper uses no dangerous bypass flags', !args.some((arg) => arg.startsWith('--dangerously-')), args.join(' | '))

// A large brief must not be passed as an argv element. The fake CLI consumes
// stdin, so this also catches regressions that reintroduce E2BIG risk.
writeFileSync(prompt, 'x'.repeat(256 * 1024))
let largeCode = 0
try { run() } catch (error) { largeCode = error.status }
check('large prompts still complete without E2BIG argv expansion', largeCode === 0, `got ${largeCode}`)

let headerCode = 0
try { run({ FAKE_HEADER: '1' }) } catch (error) { headerCode = error.status }
check('header-only CLI output is not an assistant result', headerCode === 5, `got ${headerCode}`)

const childPidFile = join(root, 'child-pid')
let stallCode = 0
try { run({ FAKE_SLEEP: '9', CHILD_PID_FILE: childPidFile }) } catch (error) { stallCode = error.status }
const childPid = readFileSync(childPidFile, 'utf8').trim()
let childStatus = ''
try { childStatus = execFileSync('ps', ['-o', 'stat=', '-p', childPid], { encoding: 'utf8' }).trim() } catch {}
const childAlive = childStatus !== '' && !childStatus.startsWith('Z')
check('stall kills the complete Codex process group', stallCode === 4 && !childAlive, `wrapper=${stallCode} child_alive=${childAlive}`)

let refusedCode = 0
try { run({ FAKE_REFUSED: '1' }) } catch (error) { refusedCode = error.status }
check('provider refusal remains a distinct result', refusedCode === 6, `got ${refusedCode}`)

let runtimeCode = 0
try { run({ FAKE_EXIT: '7' }) } catch (error) { runtimeCode = error.status }
check('unexpected CLI failure is distinct from an empty answer', runtimeCode === 7, `got ${runtimeCode}`)

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
