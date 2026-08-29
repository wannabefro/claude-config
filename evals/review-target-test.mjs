import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-review-target-'))
const repo = join(root, 'repo')
const bundle = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
mkdirSync(repo)
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'Review Target Test')
git('remote', 'add', 'origin', 'https://github.com/acme/review-target.git')
writeFileSync(join(repo, 'tracked.txt'), 'base\n')
git('add', '.')
git('commit', '-qm', 'base')
git('branch', 'release')
git('checkout', '-qb', 'feature')
writeFileSync(join(repo, 'tracked.txt'), 'base\nfeature commit\n')
git('add', 'tracked.txt')
git('commit', '-qm', 'feature')
git('checkout', 'release')
writeFileSync(join(repo, 'release-only.txt'), 'release branch content\n')
git('add', 'release-only.txt')
git('commit', '-qm', 'release diverged')
git('checkout', 'feature')
writeFileSync(join(repo, 'tracked.txt'), 'base\nfeature commit\nuncommitted\n')
writeFileSync(join(repo, 'new.txt'), 'new bounded content\n')

const script = fileURLToPath(new URL('../scripts/review-bundle.sh', import.meta.url))
const run = (target, out) => execFileSync(script, [repo, out, target], { encoding: 'utf8', stdio: 'pipe' })
const runWithEnv = (target, out, extraEnv) => execFileSync(script, [repo, out, target], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...extraEnv } })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

run('release..feature', bundle)
const manifest = readFileSync(join(bundle, '00-manifest.txt'), 'utf8')
const patch = readFileSync(join(bundle, '01-the-diff.patch'), 'utf8')
check('non-main base and exact head bind the bundle to the requested target',
  manifest.includes('base_ref=release') && manifest.includes('operator=..') && manifest.includes('head_ref=feature') && manifest.includes(`head=${git('rev-parse', 'feature').trim()}`), manifest)
check('committed and uncommitted changes are both included from that target', patch.includes('feature commit') && patch.includes('uncommitted') && patch.includes('new.txt'), patch)
check('two-dot target preserves the exact non-main base comparison', patch.includes('release-only.txt'), patch)

const triple = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
run('release...feature', triple)
const tripleManifest = readFileSync(join(triple, '00-manifest.txt'), 'utf8')
const triplePatch = readFileSync(join(triple, '01-the-diff.patch'), 'utf8')
check('triple-dot target uses the merge base explicitly', tripleManifest.includes('operator=...') && !triplePatch.includes('release-only.txt'), tripleManifest)

const fakeGh = join(root, 'gh')
const baseRefOid = git('rev-parse', 'release').trim()
const headRefOid = git('rev-parse', 'feature').trim()
writeFileSync(fakeGh, `#!/bin/sh
case "$*" in
  *baseRefName*) printf '%s\\n' release ;;
  *headRefName*) printf '%s\\n' feature ;;
  *baseRefOid*) printf '%s\\n' '${baseRefOid}' ;;
  *headRefOid*) printf '%s\\n' '${headRefOid}' ;;
  *) exit 1 ;;
esac
`)
chmodSync(fakeGh, 0o755)
const prBundle = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
runWithEnv('pr:7', prBundle, { PATH: `${root}:${process.env.PATH || ''}` })
const prManifest = readFileSync(join(prBundle, '00-manifest.txt'), 'utf8')
check('PR target resolves and binds the exact base and head', prManifest.includes('target=pr:7') && prManifest.includes('base_ref=release') && prManifest.includes('head_ref=feature') && prManifest.includes(`head=${git('rev-parse', 'feature').trim()}`), prManifest)
check('PR target records the exact GitHub base/head OIDs', prManifest.includes(`base_ref_oid=${baseRefOid}`) && prManifest.includes(`head_ref_oid=${headRefOid}`) && prManifest.includes('gh_repo=acme/review-target'), prManifest)

git('restore', '--source=HEAD', '--staged', '--worktree', '--', '.')
git('checkout', 'release')
let stalePrCode = 0
try { runWithEnv('pr:7', execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim(), { PATH: `${root}:${process.env.PATH || ''}` }) } catch (error) { stalePrCode = error.status || 1 }
check('stale or diverged local checkout refuses an exact PR target', stalePrCode !== 0, `status=${stalePrCode}`)
git('checkout', 'feature')

const foreign = join(root, 'foreign')
let foreignCode = 0
try { run('release..foreign', execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()) } catch (error) { foreignCode = error.status || 1 }
check('wrong requested head refuses instead of silently reviewing current checkout', foreignCode !== 0 && !existsSync(join(foreign, '01-the-diff.patch')), `status=${foreignCode}`)

const detached = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
git('checkout', '--detach', 'feature')
run('release..HEAD', detached)
check('explicit base and detached HEAD remain reviewable', readFileSync(join(detached, '00-manifest.txt'), 'utf8').includes('head_ref=HEAD'))

const implicit = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
let implicitCode = 0
try { run('the current branch diff plus uncommitted changes', implicit) } catch (error) { implicitCode = error.status || 1 }
check('implicit target fails closed without an upstream', implicitCode !== 0, `status=${implicitCode}`)

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
