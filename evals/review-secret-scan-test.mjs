import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
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
// spawnSync (not execFileSync) so stderr is captured on a clean exit too, not only on a throw.
const runCaptured = (program, args, extraEnv = {}) => {
  const result = spawnSync(program, args, { encoding: 'utf8', env: { ...process.env, ...extraEnv } })
  return { code: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` }
}
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

// A bare identifier in call-argument position is a reference, not a literal.
// Real source code names parameters `secret=` and `token=` constantly, and
// blocking on those made every Python review payload untransferable.
for (const [name, line] of [
  ['keyword-argument reference', '        auth=HTTPXNotaryAuth(secret=notary_secret),\n'],
  ['trailing-comma reference', '            token=notary_secret,\n'],
  ['dict value reference', '  config = {"api_key": resolved_api_key}\n'],
]) {
  writeFileSync(join(bundle, 'files', 'before', 'deleted.txt'), 'ordinary\n')
  writeFileSync(join(bundle, 'files', 'after', 'a.txt'), line)
  let refCode = 0
  try { run() } catch (error) { refCode = error.status || 1 }
  check(`${name} is not treated as a credential`, refCode === 0, `status=${refCode}`)
}

// The narrowing above must not blunt detection of a bare literal value.
for (const [name, line] of [
  ['unquoted alphabetic value', 'password = correcthorsebatterystaple\n'],
  ['dotenv-style value', 'API_KEY=abc123def456ghi789\n'],
  ['quoted value in call position', '  connect(password="hunter2longenough")\n'],
]) {
  writeFileSync(join(bundle, 'files', 'after', 'a.txt'), line)
  let litCode = 0
  try { run() } catch (error) { litCode = error.status || 1 }
  check(`${name} still blocks transfer`, litCode === 66, `status=${litCode}`)
}

const digest = createHash('sha256').update('public-base-image').digest('hex')
check('sha256 digest fixture is the full 64 hex characters', digest.length === 64, `length=${digest.length}`)

// CHANGE 1: a content address, an interpolated variable, and a path are not secrets.
for (const [name, line] of [
  ['sha256 digest with a token keyword', `token: sha256:${digest}\n`],
  ['sha256 digest on an uppercase env-style key', `IMAGE_TOKEN=sha256:${digest}\n`],
  ['sha256 digest with leading indentation', `  image_secret: sha256:${digest}\n`],
  ['a variable interpolation as the whole value', 'secret: ${VAULT_DB_PASSWORD}\n'],
  ['a bare variable reference as the whole value', 'api_key: $OPENAI_KEY\n'],
  ['a path as the whole value', 'secret: /run/secrets/db-password\n'],
]) {
  writeFileSync(join(bundle, 'files', 'before', 'deleted.txt'), 'ordinary\n')
  writeFileSync(join(bundle, '01-the-diff.patch'), 'ordinary\n')
  writeFileSync(join(bundle, 'files', 'after', 'a.txt'), line)
  let exemptCode = 0
  try { run() } catch (error) { exemptCode = error.status || 1 }
  check(`${name} is exempt and passes the transfer gate`, exemptCode === 0, `status=${exemptCode}`)
}

// The new exemption must not blunt detection of a real literal.
for (const [name, line] of [
  ['snake_case OAuth secret', 'client_secret=Zx9QwErTyUiOpAsDfGh\n'],
  ['camelCase OAuth secret', 'clientSecret: "Zx9QwErTyUiOpAsDfGh"\n'],
  ['weak literal password', 'password: hunter2abcdef\n'],
  ['spaced token assignment', 'auth_token = Zx9QwErTyUiOpAsDfGh\n'],
  ['a bare 64-hex secret with no sha256 prefix', `api_key: ${digest}\n`],
  ['an exempt shape that is not the whole value', 'secret: ${VAULT} realpassword123\n'],
]) {
  writeFileSync(join(bundle, 'files', 'after', 'a.txt'), line)
  let stillCode = 0
  try { run() } catch (error) { stillCode = error.status || 1 }
  check(`${name} still blocks transfer`, stillCode === 66, `status=${stillCode}`)
}

// Every fixed-prefix vendor rule, the private-key rule, and the postgres rule stay covered.
writeFileSync(join(bundle, 'files', 'before', 'deleted.txt'), 'ordinary\n')
for (const [name, line] of [
  ['gitlab personal access token', 'glpat-abcdefghij0123456789\n'],
  ['slack bot token', 'xoxb-1234567890-abcdefghijkl\n'],
  ['npm publish token', 'npm_abcdefghijklmnopqrst0123\n'],
  ['openai-style secret key', 'sk-abcdefghijklmnopqrst0123\n'],
  ['google api key', 'AIzaSyAbcdefghijklmnopqrstuvwxyz0123456\n'],
  ['pem private key header', '-----BEGIN RSA PRIVATE KEY-----\n'],
  ['postgres connection string with embedded credentials', 'postgres://appuser:hunter2pass@db.internal/app\n'],
]) {
  writeFileSync(join(bundle, 'files', 'after', 'a.txt'), line)
  let vendorCode = 0
  try { run() } catch (error) { vendorCode = error.status || 1 }
  check(`${name} is still caught`, vendorCode === 66, `status=${vendorCode}`)
}

// CHANGE 2: a refusal names the file and the line, and never the value.
writeFileSync(join(bundle, 'files', 'before', 'deleted.txt'), 'ordinary\n')
writeFileSync(join(bundle, '01-the-diff.patch'), 'ordinary\n')
const reportFixture = join(bundle, 'files', 'after', 'a.txt')
const reportSecret = 'Zx9QwErTyUiOpAsDfGh'
writeFileSync(reportFixture, `client_secret=${reportSecret}\n`)
const reportResult = runCaptured(script, [bundle])
const reportHasPath = reportResult.output.includes(reportFixture)
const reportHasLine = reportResult.output.includes('lines 1')
const reportHasRule = reportResult.output.includes('keyword-assignment')
const reportHasSecret = reportResult.output.includes(reportSecret)
check(
  'a refusal reports the path, the line number, and the rule name',
  reportResult.code === 66 && reportHasPath && reportHasLine && reportHasRule,
  `code=${reportResult.code} path=${reportHasPath} line=${reportHasLine} rule=${reportHasRule}`,
)
check(
  'a refusal never prints the matched credential value',
  !reportHasSecret,
  `code=${reportResult.code} containsSecret=${reportHasSecret}`,
)

// CHANGE 1: a reviewed allowlist suppresses one exact occurrence, and nothing broader.
const allowRoot = join(root, 'allowlist-fixtures')
mkdirSync(allowRoot, { recursive: true })
let homeCounter = 0
const makeHome = (withClaudeDir = true) => {
  const home = join(allowRoot, `home-${homeCounter++}`)
  mkdirSync(withClaudeDir ? join(home, '.claude') : home, { recursive: true })
  return home
}
const allowlistPath = (home) => join(home, '.claude', 'review-scan-allow.local.txt')
const realAllowlistPath = join(process.env.HOME || '', '.claude', 'review-scan-allow.local.txt')
const realAllowlistExistedBefore = existsSync(realAllowlistPath)

const allowFixture = join(allowRoot, 'allow-fixture.py')
writeFileSync(allowFixture, 'password = "dummy-account-pw"\n')

// 1: no allowlist file, and no allowlist directory, is normal operation.
const home1 = makeHome()
const noFileResult = runCaptured(script, ['--file', allowFixture], { HOME: home1 })
check('no allowlist file: a password-style assignment still refuses', noFileResult.code === 66, `code=${noFileResult.code}`)

const home1b = makeHome(false)
const noDirResult = runCaptured(script, ['--file', allowFixture], { HOME: home1b })
check('an absent allowlist directory behaves like no allowlist', noDirResult.code === 66, `code=${noDirResult.code}`)

// 2: a matching entry exits clean and names what it skipped.
const home2 = makeHome()
writeFileSync(allowlistPath(home2), 'allow-fixture.py:keyword-assignment:1\n')
const matchResult = runCaptured(script, ['--file', allowFixture], { HOME: home2 })
const matchHasPath = matchResult.output.includes(allowFixture)
const matchHasLine = matchResult.output.includes('line 1')
const matchHasRule = matchResult.output.includes('keyword-assignment')
check('a matching allowlist entry exits clean', matchResult.code === 0, `code=${matchResult.code}`)
check(
  'a matching allowlist entry reports the path, line, and rule on stderr',
  matchHasPath && matchHasLine && matchHasRule,
  `code=${matchResult.code} path=${matchHasPath} line=${matchHasLine} rule=${matchHasRule}`,
)

// 3: suppression is specific to the exact file, rule, and line — nothing broader.
const home3a = makeHome()
writeFileSync(allowlistPath(home3a), 'allow-fixture.py:keyword-assignment:2\n')
let r = runCaptured(script, ['--file', allowFixture], { HOME: home3a })
check('a wrong allowlisted line number still refuses the real match', r.code === 66, `code=${r.code}`)

const home3b = makeHome()
writeFileSync(allowlistPath(home3b), 'allow-fixture.py:known-credential:1\n')
r = runCaptured(script, ['--file', allowFixture], { HOME: home3b })
check('a wrong allowlisted rule label still refuses the real match', r.code === 66, `code=${r.code}`)

const home3c = makeHome()
writeFileSync(allowlistPath(home3c), 'unrelated-file.py:keyword-assignment:1\n')
r = runCaptured(script, ['--file', allowFixture], { HOME: home3c })
check('a non-matching path suffix still refuses the real match', r.code === 66, `code=${r.code}`)

const secondFixture = join(allowRoot, 'allow-fixture-second.py')
writeFileSync(secondFixture, 'password = "dummy-account-pw"\ntoken = "dummy-second-secret-val"\n')
const home3d = makeHome()
writeFileSync(allowlistPath(home3d), 'allow-fixture-second.py:keyword-assignment:1\n')
r = runCaptured(script, ['--file', secondFixture], { HOME: home3d })
check('a second unallowlisted credential on another line still refuses', r.code === 66, `code=${r.code}`)

// 4: no wildcards in an allowlist entry, ever.
const home4a = makeHome()
writeFileSync(allowlistPath(home4a), 'allow-fixture.py:keyword-assignment:1*\n')
r = runCaptured(script, ['--file', allowFixture], { HOME: home4a })
check('an asterisk in an allowlist entry refuses the transfer', r.code === 66, `code=${r.code}`)

const home4b = makeHome()
writeFileSync(allowlistPath(home4b), 'allow-fixture?.py:keyword-assignment:1\n')
r = runCaptured(script, ['--file', allowFixture], { HOME: home4b })
check('a question mark in an allowlist entry refuses the transfer', r.code === 66, `code=${r.code}`)

// 5: a malformed entry refuses and names only the allowlist line number.
for (const [name, entry] of [
  ['two fields', 'allow-fixture.py:keyword-assignment'],
  ['four fields', 'extra:allow-fixture.py:keyword-assignment:1'],
  ['non-numeric line', 'allow-fixture.py:keyword-assignment:one'],
  ['unknown rule label', 'allow-fixture.py:bogus-rule:1'],
]) {
  const home = makeHome()
  writeFileSync(allowlistPath(home), `${entry}\n`)
  const result = runCaptured(script, ['--file', allowFixture], { HOME: home })
  const namesLine = result.output.includes('line 1')
  const echoesEntry = result.output.includes(entry)
  check(`malformed allowlist entry (${name}) refuses the transfer`, result.code === 66, `code=${result.code}`)
  check(
    `malformed allowlist entry (${name}) names the allowlist line, not the entry`,
    namesLine && !echoesEntry,
    `code=${result.code} namesLine=${namesLine} echoesEntry=${echoesEntry}`,
  )
}

// 6: comments and blank lines are not entries.
const home6 = makeHome()
writeFileSync(allowlistPath(home6), '# a reviewed dummy fixture\n\nallow-fixture.py:keyword-assignment:1\n')
r = runCaptured(script, ['--file', allowFixture], { HOME: home6 })
check('comments and blank lines in the allowlist are ignored', r.code === 0, `code=${r.code}`)

// 7: a suppressed run never leaks the value it suppressed.
const leakFixture = join(allowRoot, 'allow-fixture-leak.py')
const leakSecret = 'Qz7WvNmTlaKjHfGdSaLp'
writeFileSync(leakFixture, `client_secret=${leakSecret}\n`)
const home7 = makeHome()
writeFileSync(allowlistPath(home7), 'allow-fixture-leak.py:keyword-assignment:1\n')
const leakResult = runCaptured(script, ['--file', leakFixture], { HOME: home7 })
const leakResultHasSecret = leakResult.output.includes(leakSecret)
check('a suppressed run still exits clean', leakResult.code === 0, `code=${leakResult.code}`)
check(
  "a suppressed run's combined output never contains the matched value",
  !leakResultHasSecret,
  `code=${leakResult.code} containsSecret=${leakResultHasSecret}`,
)

// 8: allowlisting one rule's match does not suppress a different rule on the same line.
const bothRulesFixture = join(allowRoot, 'allow-fixture-both.py')
writeFileSync(bothRulesFixture, 'secret_token = "AKIA1234567890ABCDEF"\n')
const home8 = makeHome()
writeFileSync(allowlistPath(home8), 'allow-fixture-both.py:keyword-assignment:1\n')
const bothResult = runCaptured(script, ['--file', bothRulesFixture], { HOME: home8 })
check(
  'allowlisting a keyword-assignment match does not suppress a known-credential match on the same line',
  bothResult.code === 66,
  `code=${bothResult.code}`,
)

check(
  'the real allowlist path stays untouched by every isolated test HOME',
  existsSync(realAllowlistPath) === realAllowlistExistedBefore,
  'unexpected change near the real allowlist path',
)

const credentialFixture = join(bundle, 'files', 'after', 'a.txt')
writeFileSync(credentialFixture, 'token = "credential-shaped-secret-value"\n')
const hijackBin = join(root, 'hijack-bin')
const hijackMarker = join(root, 'hijack-marker')
mkdirSync(hijackBin)
writeFileSync(join(hijackBin, 'rg'), `#!/bin/sh
printf called > "$HIJACK_MARKER"
exit 1
`)
chmodSync(join(hijackBin, 'rg'), 0o755)
const hijacked = runCaptured(script, [bundle], { PATH: `${hijackBin}:${process.env.PATH || ''}`, HIJACK_MARKER: hijackMarker })
check('PATH ripgrep shims cannot bypass the trusted scanner', hijacked.code === 66 && !existsSync(hijackMarker) && !hijacked.output.includes('credential-shaped-secret-value'), `${hijacked.code}: ${hijacked.output}`)

const missingRg = join(root, 'missing-rg')
const scannerSource = readFileSync(script, 'utf8')
const missingScanner = join(root, 'missing-scanner.sh')
writeFileSync(missingScanner, scannerSource.replaceAll('/opt/homebrew/bin/rg', missingRg).replaceAll('/usr/local/bin/rg', missingRg))
chmodSync(missingScanner, 0o755)
const missing = runCaptured(missingScanner, ['--file', credentialFixture])
check('missing trusted ripgrep fails closed without exposing the credential', missing.code === 67 && !missing.output.includes('credential-shaped-secret-value'), `${missing.code}: ${missing.output}`)

const brokenRg = join(root, 'broken-rg')
writeFileSync(brokenRg, '#!/bin/sh\nexit 2\n')
chmodSync(brokenRg, 0o755)
const brokenScanner = join(root, 'broken-scanner.sh')
writeFileSync(brokenScanner, scannerSource.replaceAll('/opt/homebrew/bin/rg', brokenRg).replaceAll('/usr/local/bin/rg', brokenRg))
chmodSync(brokenScanner, 0o755)
const broken = runCaptured(brokenScanner, ['--file', credentialFixture])
check('unexpected ripgrep status fails closed without exposing the credential', broken.code === 67 && !broken.output.includes('credential-shaped-secret-value'), `${broken.code}: ${broken.output}`)

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
