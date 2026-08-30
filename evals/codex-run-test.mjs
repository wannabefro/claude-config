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
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-codex-run-'))
const repo = fileURLToPath(new URL('../', import.meta.url))
const temporaryRoots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', realpathSync(tmpdir())]
const isUnder = (candidate, rootPath) => candidate === rootPath || candidate.startsWith(`${rootPath}/`)
let fixtureParent = dirname(repo)
while (fixtureParent !== '/' && (existsSync(join(fixtureParent, '.git')) || temporaryRoots.some((rootPath) => isUnder(fixtureParent, rootPath)))) fixtureParent = dirname(fixtureParent)
if (fixtureParent === '/') throw new Error('could not find a safe sibling outside Git and macOS temporary roots')
const fixtureRoot = mkdtempSync(join(fixtureParent, 'claude-codex-run-safe-'))
const fake = join(fixtureRoot, 'codex')
const argsFile = join(root, 'args')
const stdinFile = join(root, 'stdin')
const work = join(root, 'work')
const prompt = join(root, 'brief')
mkdirSync(work)
writeFileSync(fake, `#!/bin/sh
if [ "$1" = "--version" ]; then printf '%s\\n' 'codex-cli 0.149.1'; exit 0; fi
if [ "$1" = "exec" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' 'Usage: codex exec [OPTIONS] [PROMPT]'
  printf '%s\\n' '  -c, --config <key=value>'
  printf '%s\\n' '  -m, --model <MODEL>'
  printf '%s\\n' '  -s, --sandbox <SANDBOX_MODE>'
  printf '%s\\n' '  [possible values: read-only, workspace-write, danger-full-access]'
  printf '%s\\n' '  --skip-git-repo-check  --output-last-message <FILE>'
  exit 0
fi
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
// The fake is injected through PATH, while CODEX_BIN points at an invalid path.
// This proves callers cannot replace the approved runtime through the
// environment, while tests retain a deterministic executable seam.
const env = { ...process.env, PATH: `${fixtureRoot}:${process.env.PATH || ''}`, TMPDIR: root, CODEX_BIN: join(root, 'missing-override'), FAKE_ARGS: argsFile, FAKE_STDIN: stdinFile }
const runWithArgs = (args, extraEnv = {}) => execFileSync(wrapper, args, { cwd: work, env: { ...env, ...extraEnv }, encoding: 'utf8' })
const run = (extraEnv = {}) => runWithArgs(['-t', '5', '-s', '2', '-f', prompt, '-d', work, '-N'], extraEnv)

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
check('wrapper cleans its owner-private runtime directory', readdirSync(root).every((name) => !name.startsWith('claude-codex-run.')), readdirSync(root).join(' | '))

const exactPrompt = 'byte-preserving brief with a trailing newline\n'
writeFileSync(prompt, exactPrompt)
let exactCode = 0
try { runWithArgs(['-t', '5', '-s', '2', '-f', prompt, '-d', work]) } catch (error) { exactCode = error.status }
check('file prompts reach Codex byte-for-byte, including trailing newlines', exactCode === 0 && readFileSync(stdinFile, 'utf8') === exactPrompt, `code=${exactCode} stdin=${JSON.stringify(readFileSync(stdinFile, 'utf8'))}`)

// The bundle is clean, but the separately supplied brief is not. The final
// exact-payload scan must catch this mismatch even when the bundle scan passes.
const cleanBundle = join(root, 'clean-bundle')
mkdirSync(join(cleanBundle, 'files', 'after'), { recursive: true })
mkdirSync(join(cleanBundle, 'files', 'before'), { recursive: true })
mkdirSync(join(cleanBundle, 'untracked', 'after'), { recursive: true })
writeFileSync(join(cleanBundle, 'files', 'after', 'clean.txt'), 'no credentials here\n')
writeFileSync(prompt, 'secret=super-secret-value-123\n')
let mismatchCode = 0
try { runWithArgs(['-t', '5', '-s', '2', '-B', cleanBundle, '-f', prompt, '-d', work]) } catch (error) { mismatchCode = error.status }
check('clean bundle plus secret brief is blocked by the exact prompt-input scan', mismatchCode === 8, `got ${mismatchCode}`)

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
rmSync(fixtureRoot, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
