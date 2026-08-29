import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-review-bundle-'))
const repo = join(root, 'repo')
const out = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
mkdirSync(repo)
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'Review Bundle Test')
writeFileSync(join(repo, 'tracked.txt'), 'before\n')
writeFileSync(join(repo, 'deleted.txt'), 'remove me\n')
git('add', '.')
git('commit', '-qm', 'base')
writeFileSync(join(repo, 'tracked.txt'), 'before\nstaged\n')
git('add', 'tracked.txt')
writeFileSync(join(repo, 'tracked.txt'), 'before\nstaged\nunstaged\n')
writeFileSync(join(repo, 'untracked.txt'), 'untracked full bytes $dollars\n')
mkdirSync(join(repo, 'nested'))
writeFileSync(join(repo, 'nested', 'regular.txt'), 'nested regular content\n')
writeFileSync(join(repo, 'nested', '.env.production'), 'TOP_SECRET=do-not-copy\n')
writeFileSync(join(repo, '.env.local'), 'DATABASE_URL=postgres://secret\n')
writeFileSync(join(repo, '.npmrc'), '//registry.example/:_authToken=secret\n')
writeFileSync(join(repo, '.netrc'), 'machine example login user password secret\n')
mkdirSync(join(repo, '.aws'))
writeFileSync(join(repo, '.aws', 'credentials'), '[default]\naws_access_key_id=secret\n')
mkdirSync(join(repo, '.ssh'))
writeFileSync(join(repo, '.ssh', 'config'), 'Host *\n')
mkdirSync(join(repo, '.gnupg'))
writeFileSync(join(repo, '.gnupg', 'trustdb.gpg'), 'private\n')
mkdirSync(join(repo, 'secrets'))
writeFileSync(join(repo, 'secrets', 'license.dat'), 'license-token=do-not-copy\n')
writeFileSync(join(repo, 'id_ecdsa_work'), 'private key material\n')
rmSync(join(repo, 'deleted.txt'))

// Represent a submodule/gitlink in the index without cloning or recursively
// reading its checkout. The bundle must emit metadata, never copy a directory.
const submodule = join(root, 'submodule')
mkdirSync(submodule)
execFileSync('git', ['-C', submodule, 'init', '-q'])
execFileSync('git', ['-C', submodule, 'config', 'user.email', 'test@example.com'])
execFileSync('git', ['-C', submodule, 'config', 'user.name', 'Submodule Test'])
writeFileSync(join(submodule, 'content.txt'), 'submodule content\n')
execFileSync('git', ['-C', submodule, 'add', 'content.txt'])
execFileSync('git', ['-C', submodule, 'commit', '-qm', 'submodule base'])
const submoduleCommit = execFileSync('git', ['-C', submodule, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
git('update-index', '--add', '--cacheinfo', `160000,${submoduleCommit},submodule`)

const script = fileURLToPath(new URL('../scripts/review-bundle.sh', import.meta.url))
chmodSync(script, 0o755)
execFileSync(script, [repo, out, 'HEAD..HEAD'], { encoding: 'utf8' })

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}
const after = (name) => join(out, 'files', 'after', name)
const before = (name) => join(out, 'files', 'before', name)

check('canonical base-to-working-tree patch exists', readFileSync(join(out, '01-the-diff.patch'), 'utf8').includes('unstaged'))
check('untracked additions receive synthetic diff hunks for risk classification',
  readFileSync(join(out, '01-the-diff.patch'), 'utf8').includes('untracked.txt') && readFileSync(join(out, '01-the-diff.patch'), 'utf8').includes('untracked full bytes'))
check('staged and unstaged diagnostic views stay separate', readFileSync(join(out, '02-staged.patch'), 'utf8').includes('staged') && readFileSync(join(out, '03-unstaged.patch'), 'utf8').includes('unstaged'))
check('tracked after snapshot is complete', readFileSync(after('tracked.txt'), 'utf8').includes('unstaged'))
check('tracked before snapshot is complete', readFileSync(before('tracked.txt'), 'utf8') === 'before\n')
check('deleted file has a full after marker and before content', readFileSync(after('deleted.txt'), 'utf8').includes('deleted') && readFileSync(before('deleted.txt'), 'utf8') === 'remove me\n')
check('untracked file contents are included in full', readFileSync(join(out, 'untracked', 'after', 'untracked.txt'), 'utf8') === 'untracked full bytes $dollars\n')
check('manifest records tracked and untracked paths', readFileSync(join(out, '00-manifest.txt'), 'utf8').includes('tracked.txt') && readFileSync(join(out, '00-manifest.txt'), 'utf8').includes('untracked.txt'))
check('denylisted .env variants are redacted before patch and snapshot creation',
  readFileSync(join(out, '00-manifest.txt'), 'utf8').includes('redacted=.env.local') &&
  readFileSync(join(out, '00-manifest.txt'), 'utf8').includes('redacted=nested/.env.production') &&
  !readFileSync(join(out, '01-the-diff.patch'), 'utf8').includes('DATABASE_URL=postgres') &&
  !readFileSync(join(out, '01-the-diff.patch'), 'utf8').includes('TOP_SECRET=do-not-copy') &&
  !existsSync(join(out, 'untracked', 'after', '.env.local')) &&
  !existsSync(join(out, 'untracked', 'after', 'nested', '.env.production')) &&
  !existsSync(join(out, 'untracked', 'after', '.npmrc')) &&
  !existsSync(join(out, 'untracked', 'after', '.netrc')) &&
  !existsSync(join(out, 'untracked', 'after', '.aws', 'credentials')) &&
  !existsSync(join(out, 'untracked', 'after', '.ssh', 'config')) &&
  !existsSync(join(out, 'untracked', 'after', '.gnupg', 'trustdb.gpg')))
check('secret directories, license files, and every id_* key are redacted',
  readFileSync(join(out, '00-manifest.txt'), 'utf8').includes('redacted=secrets/license.dat') &&
  readFileSync(join(out, '00-manifest.txt'), 'utf8').includes('redacted=id_ecdsa_work') &&
  !existsSync(join(out, 'untracked', 'after', 'secrets', 'license.dat')) &&
  !existsSync(join(out, 'untracked', 'after', 'id_ecdsa_work')))
check('untracked directories are enumerated as regular files, not recursively copied as a directory',
  readFileSync(join(out, 'untracked', 'after', 'nested', 'regular.txt'), 'utf8') === 'nested regular content\n' &&
  !existsSync(join(out, 'untracked', 'after', 'nested', '.env.production')))
check('gitlinks are represented by metadata rather than recursively copied',
  readFileSync(join(out, 'files', 'after', 'submodule.gitlink'), 'utf8').includes('gitlink') &&
  readFileSync(join(out, 'files', 'after', 'submodule.gitlink'), 'utf8').includes(submoduleCommit) &&
  !existsSync(join(out, 'files', 'after', 'submodule', 'content.txt')))

const persistentOut = join(root, 'persistent-bundle')
mkdirSync(persistentOut)
let persistentCode = 0
try { execFileSync(script, [repo, persistentOut, 'HEAD..HEAD'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { persistentCode = error.status || 1 }
check('review assembly rejects a persistent caller directory', persistentCode !== 0 && existsSync(persistentOut), `status=${persistentCode}`)

const insecureOut = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
chmodSync(insecureOut, 0o755)
let insecureCode = 0
try { execFileSync(script, [repo, insecureOut, 'HEAD..HEAD'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { insecureCode = error.status || 1 }
check('review assembly rejects a non-private caller directory', insecureCode !== 0 && existsSync(insecureOut), `status=${insecureCode}`)

const boundedRepo = join(root, 'bounded-repo')
const boundedOut = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
mkdirSync(boundedRepo)
const boundedGit = (...args) => execFileSync('git', ['-C', boundedRepo, ...args], { encoding: 'utf8' })
boundedGit('init', '-q')
boundedGit('config', 'user.email', 'test@example.com')
boundedGit('config', 'user.name', 'Review Bundle Test')
writeFileSync(join(boundedRepo, 'base.txt'), 'base\n')
boundedGit('add', '.')
boundedGit('commit', '-qm', 'base')
writeFileSync(join(boundedRepo, 'too-large.txt'), '12345\n')
let boundedCode = 0
try {
  execFileSync(script, [boundedRepo, boundedOut, 'HEAD..HEAD'], { encoding: 'utf8', env: { ...process.env, MAX_UNTRACKED_BYTES: '4' } })
} catch (error) { boundedCode = error.status || 1 }
check('untracked content is bounded before bundle creation', boundedCode !== 0, `status=${boundedCode}`)

// A caller-created private bundle must be removed if assembly fails after the
// output directory exists. An untracked symlink is a deterministic injected
// assembly failure and proves cleanup is not success-path-only.
const failedOut = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
const failedRepo = join(root, 'failed-repo')
mkdirSync(failedRepo)
const failedGit = (...args) => execFileSync('git', ['-C', failedRepo, ...args], { encoding: 'utf8' })
failedGit('init', '-q')
failedGit('config', 'user.email', 'test@example.com')
failedGit('config', 'user.name', 'Review Bundle Test')
writeFileSync(join(failedRepo, 'base.txt'), 'base\n')
failedGit('add', '.')
failedGit('commit', '-qm', 'base')
symlinkSync('/tmp/not-a-review-file', join(failedRepo, 'untracked-link'))
let failedAssemblyCode = 0
try { execFileSync(script, [failedRepo, failedOut, 'HEAD..HEAD'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { failedAssemblyCode = error.status || 1 }
check('assembly failure cleans its private output directory', failedAssemblyCode !== 0 && !existsSync(failedOut), `status=${failedAssemblyCode} exists=${existsSync(failedOut)}`)

rmSync(out, { recursive: true, force: true })
rmSync(insecureOut, { recursive: true, force: true })
rmSync(boundedOut, { recursive: true, force: true })
rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
