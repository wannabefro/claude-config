import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/codex-bin.sh', import.meta.url))
const configRoot = fileURLToPath(new URL('../', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'codex-bin-'))
let pass = 0
let fail = 0
let skip = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

// PATH holds only the planted dir, so `command -v codex` sees exactly each case.
const run = (pathDir, cwd) => spawnSync('/bin/bash', [script], {
  cwd,
  encoding: 'utf8',
  env: { PATH: pathDir, HOME: root },
})

const stub = (dir) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'codex'), '#!/bin/sh\necho stub\n')
  chmodSync(join(dir, 'codex'), 0o755)
  return dir
}

const empty = join(root, 'empty')
mkdirSync(empty, { recursive: true })
let result = run(empty, root)
check('missing codex exits 3', result.status === 3, JSON.stringify({ status: result.status, stderr: result.stderr }))

const notExec = join(root, 'not-exec')
mkdirSync(notExec, { recursive: true })
writeFileSync(join(notExec, 'codex'), 'not a program\n')
chmodSync(join(notExec, 'codex'), 0o644)
result = run(notExec, root)
check('a non-executable codex on PATH exits 3', result.status === 3, JSON.stringify({ status: result.status, stderr: result.stderr }))

// A planted copy inside the working checkout is the attack this guard exists for.
const checkout = join(root, 'checkout')
const planted = stub(join(checkout, 'node_modules', '.bin'))
result = run(planted, checkout)
check('a codex inside the current checkout is refused',
  result.status === 3 && /refusing/.test(result.stderr),
  JSON.stringify({ status: result.status, stderr: result.stderr }))

// A temp root is refused even from an unrelated cwd, which is why the fixtures above cannot be the happy path.
result = run(stub(join(root, 'loose-bin')), configRoot)
check('a codex under a temp root is refused from any directory',
  result.status === 3 && /refusing/.test(result.stderr),
  JSON.stringify({ status: result.status, stderr: result.stderr }))

// Happy path needs a real install outside every refused location, so use the host's own.
const hostPath = spawnSync('/usr/bin/which', ['codex'], { encoding: 'utf8' })
if (hostPath.status === 0 && hostPath.stdout.trim()) {
  result = spawnSync('/bin/bash', [script], { cwd: configRoot, encoding: 'utf8' })
  check('the installed codex resolves to an absolute realpath',
    result.status === 0 && result.stdout.trim().startsWith('/') && !result.stdout.includes('..'),
    JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr }))
} else {
  skip++
  console.log('  skip codex is not installed on this host; happy path not exercised')
}

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`)
process.exit(fail ? 1 : 0)
