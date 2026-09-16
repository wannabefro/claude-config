import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/plugin-refresh.sh', import.meta.url))
const hook = fileURLToPath(new URL('../hooks/plugin-refresh-async.sh', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'plugin-refresh-'))
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

// A fake `claude` records every invocation so the test never touches the network.
const home = join(root, 'home')
const binDir = join(root, 'bin')
mkdirSync(home, { recursive: true })
mkdirSync(binDir, { recursive: true })
const calls = join(root, 'calls.txt')
writeFileSync(join(binDir, 'claude'), `#!/bin/sh
echo "$@" >> ${JSON.stringify(calls)}
case "$2" in
  marketplace) echo "Successfully updated 2 marketplaces" ;;
  *) case "$3" in
       needs-cmd@m) echo 'This plugin declares a command; pass --accept-command' ;;
       *) echo "already at the latest version (1.0.0)" ;;
     esac ;;
esac
exit 0
`)
chmodSync(join(binDir, 'claude'), 0o755)

// plugin list output the script must parse: two enabled, one disabled.
writeFileSync(join(binDir, 'claude'), readFileSync(join(binDir, 'claude'), 'utf8').replace(
  'case "$2" in',
  `if [ "$2" = "list" ]; then
  printf '  \\342\\235\\257 keep-me@m\\n    Status: \\342\\234\\224 enabled\\n'
  printf '  \\342\\235\\257 skip-me@m\\n    Status: \\342\\234\\230 disabled\\n'
  printf '  \\342\\235\\257 needs-cmd@m\\n    Status: \\342\\234\\224 enabled\\n'
  exit 0
fi
case "$2" in`))
chmodSync(join(binDir, 'claude'), 0o755)

const run = (args, env = {}) => spawnSync('/bin/bash', [script, ...args], {
  encoding: 'utf8',
  env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home, CLAUDE_HOME: home, ...env },
})

let result = run(['--check'])
check('--check reports never on a fresh state', result.status === 0 && /never/.test(result.stdout),
  JSON.stringify({ status: result.status, out: result.stdout }))

result = run(['--force'])
const logPath = join(home, 'state', 'plugin-refresh.log')
const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
const invoked = existsSync(calls) ? readFileSync(calls, 'utf8') : ''
check('a forced run refreshes marketplaces', /marketplace update/.test(invoked), invoked)
check('only enabled plugins are updated', /keep-me@m/.test(invoked) && !/skip-me@m/.test(invoked), invoked)
// A plugin wanting an install command must be surfaced, never auto-accepted.
check('a plugin declaring a command is flagged, not accepted',
  /NEEDS REVIEW\s+needs-cmd@m/.test(log) && !/--accept-command|-y\b/.test(invoked),
  JSON.stringify({ log, invoked }))
check('the log records the outcome, not the preamble', /already at the latest version/.test(log), log)

// The throttle is what keeps this off the session-start path more than once a day.
const before = readFileSync(calls, 'utf8').length
result = run([])
check('a second run inside the interval does no work',
  result.status === 0 && readFileSync(calls, 'utf8').length === before,
  `calls grew from ${before}`)

result = run(['--check'])
check('--check reports a concrete last-refresh time', result.status === 0 && !/never/.test(result.stdout),
  result.stdout)

result = run(['--bogus'])
check('an unknown flag exits 64', result.status === 64, `status=${result.status}`)

// The hook must return immediately; a network fetch may never block a session start.
const t0 = Date.now()
const hookRun = spawnSync('/bin/bash', [hook], {
  encoding: 'utf8',
  env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home, CLAUDE_HOME: home },
})
const elapsed = Date.now() - t0
check('the SessionStart hook exits 0 in under 2s', hookRun.status === 0 && elapsed < 2000,
  `status=${hookRun.status} elapsed=${elapsed}ms`)

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
