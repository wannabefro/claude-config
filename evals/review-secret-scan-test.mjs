import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-secret-scan-'))
const bundle = join(root, 'bundle')
mkdirSync(join(bundle, 'files', 'after'), { recursive: true })
mkdirSync(join(bundle, 'files', 'before'), { recursive: true })
mkdirSync(join(bundle, 'untracked', 'after'), { recursive: true })
writeFileSync(join(bundle, '01-the-diff.patch'), 'diff --git a/src/a b/src/a\n+safe\n')
writeFileSync(join(bundle, 'files', 'after', 'a.txt'), 'ordinary deterministic fixture\n')
const script = fileURLToPath(new URL('../scripts/review-secret-scan.sh', import.meta.url))
chmodSync(script, 0o755)
const run = () => execFileSync(script, [bundle], { encoding: 'utf8', stdio: 'pipe' })
const runFile = () => execFileSync(script, ['--file', join(bundle, 'files', 'after', 'a.txt')], { encoding: 'utf8', stdio: 'pipe' })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

let cleanCode = 0
try { run() } catch (error) { cleanCode = error.status || 1 }
check('ordinary review content passes the transfer gate', cleanCode === 0, `status=${cleanCode}`)

writeFileSync(join(bundle, 'files', 'after', 'a.txt'), 'token = "long-secret-value"\n')
let tokenCode = 0
try { run() } catch (error) { tokenCode = error.status || 1 }
check('credential-shaped content blocks cross-provider transfer', tokenCode === 66, `status=${tokenCode}`)
let tokenFileCode = 0
try { runFile() } catch (error) { tokenFileCode = error.status || 1 }
check('standalone planning briefs use the same transfer gate', tokenFileCode === 66, `status=${tokenFileCode}`)

writeFileSync(join(bundle, 'files', 'after', 'a.txt'), 'ordinary\n')
writeFileSync(join(bundle, '01-the-diff.patch'), '+AKIA1234567890ABCDEF\n')
let keyCode = 0
try { run() } catch (error) { keyCode = error.status || 1 }
check('credential-shaped patch bytes also block transfer', keyCode === 66, `status=${keyCode}`)

writeFileSync(join(bundle, '01-the-diff.patch'), 'ordinary\n')
writeFileSync(join(bundle, 'files', 'before', 'deleted.txt'), 'password=old-deleted-secret\n')
let beforeCode = 0
try { run() } catch (error) { beforeCode = error.status || 1 }
check('deleted-file before snapshots are covered by the transfer gate', beforeCode === 66, `status=${beforeCode}`)

for (const credential of [
  ['ghp', '123456789012345678901234567890123456'].join('_'),
  ['github', 'pat', '12345678901234567890123456789012345678901234567890'].join('_'),
]) {
  writeFileSync(join(bundle, 'files', 'before', 'deleted.txt'), 'ordinary\n')
  writeFileSync(join(bundle, 'files', 'after', 'a.txt'), `credential=${credential}\n`)
  let githubCode = 0
  try { run() } catch (error) { githubCode = error.status || 1 }
  check(`${credential.split('_')[0]} credential shape is blocked`, githubCode === 66, `status=${githubCode}`)
}

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
