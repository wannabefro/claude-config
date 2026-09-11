import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/notify.sh', import.meta.url))
let pass = 0
let fail = 0

const run = (args, env = {}) =>
  spawnSync('/bin/bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

const missing = run(['only-a-title'])
check('a missing message is a usage error', missing.status === 64 && /usage: notify.sh/.test(missing.stderr), JSON.stringify(missing.status))

const dry = run(['Ready', 'repo#1 is ready', 'https://example.invalid/p/1'], { CLAUDE_NOTIFY_DRY_RUN: '1' })
check('dry run reports every field it was given', dry.status === 0 && dry.stdout.includes('title=Ready') && dry.stdout.includes('message=repo#1 is ready') && dry.stdout.includes('url=https://example.invalid/p/1'), dry.stdout)

const noUrl = run(['Ready', 'no link'], { CLAUDE_NOTIFY_DRY_RUN: '1' })
check('the url is optional', noUrl.status === 0 && noUrl.stdout.includes('url=\n'), JSON.stringify(noUrl.stdout))

// A caller must never fail because the host has no notifier, so an empty PATH still exits zero.
const bare = run(['Ready', 'no notifier here'], { PATH: '/nonexistent-bin' })
check('no notifier on PATH still exits zero', bare.status === 0, `${bare.status}: ${bare.stderr}`)

// The message is PR-derived text, so a quote or a backtick in it must not reach a shell.
const hostile = run(['Ti"tle', 'back`tick` and $(echo pwned) and \'quote\''], { CLAUDE_NOTIFY_DRY_RUN: '1' })
check('quotes and substitutions survive as literal text', hostile.status === 0 && hostile.stdout.includes('$(echo pwned)') && !hostile.stdout.includes('pwned\n'), hostile.stdout)

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
