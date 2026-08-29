import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude-build-worktree-test-'))
const repo = join(root, 'repo')
execFileSync('mkdir', ['-p', repo])
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
git('init', '-q')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'Build Worktree Test')
writeFileSync(join(repo, 'a.txt'), 'base a\n')
writeFileSync(join(repo, 'b.txt'), 'base b\n')
writeFileSync(join(repo, '.gitignore'), 'deps/\n')
git('add', '.')
git('commit', '-qm', 'base')
const base = git('rev-parse', 'HEAD').trim()
const repoCanonical = git('rev-parse', '--show-toplevel').trim()
mkdirSync(join(repo, 'deps'))
writeFileSync(join(repo, 'deps', 'fixture.txt'), 'immutable dependency baseline\n')
writeFileSync(join(repo, 'a.txt'), 'canonical starting state\n')
git('add', 'a.txt')
writeFileSync(join(repo, 'a.txt'), 'canonical starting state plus unstaged\n')
const script = fileURLToPath(new URL('../scripts/build-worktree.sh', import.meta.url))
const invocationNonce = 'a'.repeat(64)
const invocationNonceOther = 'b'.repeat(64)
const planHash = 'c'.repeat(64)
const planHashOther = planHash
const worktreeRoot = realpathSync(execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-build-worktrees.XXXXXXXX')], { encoding: 'utf8' }).trim())
const worktreeRootOther = realpathSync(execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-build-worktrees.XXXXXXXX')], { encoding: 'utf8' }).trim())
const worktreeA = join(worktreeRoot, 'unit-a')
const worktreeB = join(worktreeRoot, 'unit-b')
const token = execFileSync('bash', [script, 'prepare', repo, base, worktreeRoot, invocationNonce, planHash, '--ignored', 'deps', '--units', 'unit-a', 'unit-b'], { encoding: 'utf8' }).trim()
const tokenOther = execFileSync('bash', [script, 'prepare', repo, base, worktreeRootOther, invocationNonceOther, planHashOther, 'unit-a', 'unit-b'], { encoding: 'utf8' }).trim()
const branchA = `codex-build/${token.slice(0, 12)}-unit-a`
const branchB = `codex-build/${token.slice(0, 12)}-unit-b`
const branchOtherA = `codex-build/${tokenOther.slice(0, 12)}-unit-a`
const branchOtherB = `codex-build/${tokenOther.slice(0, 12)}-unit-b`
execFileSync('bash', [script, 'create', repo, base, worktreeA, branchA, invocationNonce, planHash], { encoding: 'utf8' })
execFileSync('bash', [script, 'create', repo, base, worktreeB, branchB, invocationNonce, planHash], { encoding: 'utf8' })
const otherA = join(worktreeRootOther, 'unit-a')
const otherB = join(worktreeRootOther, 'unit-b')
execFileSync('bash', [script, 'create', repo, base, otherA, branchOtherA, invocationNonceOther, planHashOther], { encoding: 'utf8' })
execFileSync('bash', [script, 'create', repo, base, otherB, branchOtherB, invocationNonceOther, planHashOther], { encoding: 'utf8' })
const seedA = execFileSync('bash', [script, 'seed', repo, worktreeA, invocationNonce, planHash, 'deps'], { encoding: 'utf8' }).trim()
const seedB = execFileSync('bash', [script, 'seed', repo, worktreeB, invocationNonce, planHash, 'deps'], { encoding: 'utf8' }).trim()
execFileSync('bash', [script, 'seed', repo, otherA, invocationNonceOther, planHashOther], { encoding: 'utf8' })
execFileSync('bash', [script, 'seed', repo, otherB, invocationNonceOther, planHashOther], { encoding: 'utf8' })

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

check('seeding preserves the final bytes from staged and unstaged tracked changes', readFileSync(join(worktreeA, 'a.txt'), 'utf8') === 'canonical starting state plus unstaged\n')
check('seeding hydrates the exact ignored dependency baseline required by a verify gate', readFileSync(join(worktreeA, 'deps', 'fixture.txt'), 'utf8') === 'immutable dependency baseline\n' && existsSync(join(worktreeA, 'deps', 'fixture.txt')))
let wrongIgnoredSeedCode = 0
try { execFileSync('bash', [script, 'seed', repo, worktreeA, invocationNonce, planHash], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { wrongIgnoredSeedCode = error.status || 1 }
check('worktree identity rejects a seed that omits the approved ignored baseline set', wrongIgnoredSeedCode !== 0)

const rootManifest = readFileSync(join(worktreeRoot, '.run.identity'), 'utf8')
check('each build root receives a distinct cryptographically random run token', /^[0-9a-f]{64}$/.test(token) && /^[0-9a-f]{64}$/.test(tokenOther) && token !== tokenOther)
check('run manifest freezes repository identity, base, units, branches, paths, nonce, plan hash, and ignored baseline digest', rootManifest.includes(`repo_root=${repoCanonical}`) && rootManifest.includes(`base_commit=${base}`) && rootManifest.includes(`invocation_nonce=${invocationNonce}`) && rootManifest.includes(`plan_hash=${planHash}`) && rootManifest.includes('expected_units=unit-a unit-b') && /ignored_digest=[0-9a-f]{64}/.test(rootManifest) && rootManifest.includes(`unit.unit-a.branch=${branchA}`) && rootManifest.includes(`unit.unit-a.path=${worktreeA}`) && rootManifest.includes(`unit.unit-b.branch=${branchB}`) && rootManifest.includes(`unit.unit-b.path=${worktreeB}`))

writeFileSync(join(repo, 'deps', 'fixture.txt'), 'canonical baseline drift\n')
let canonicalDriftCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeA, seedA, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'a.txt', 'new-a.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { canonicalDriftCode = error.status || 1 }
writeFileSync(join(repo, 'deps', 'fixture.txt'), 'immutable dependency baseline\n')
check('canonical dependency drift after approval is rejected before any patch applies', canonicalDriftCode !== 0 && readFileSync(join(repo, 'a.txt'), 'utf8') === 'canonical starting state plus unstaged\n')

writeFileSync(join(worktreeA, 'a.txt'), 'unit a\n')
writeFileSync(join(worktreeA, 'new-a.txt'), 'unit a new file\n')
let integrateCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeA, seedA, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'a.txt', 'new-a.txt'], { encoding: 'utf8' }) } catch (error) { integrateCode = error.status || 1 }
check('first unit integrates while a second private worktree is registered', integrateCode === 0 && readFileSync(join(repo, 'a.txt'), 'utf8') === 'unit a\n' && readFileSync(join(repo, 'new-a.txt'), 'utf8') === 'unit a new file\n')

writeFileSync(join(worktreeB, 'deps', 'fixture.txt'), 'worker mutation must not escape\n')
writeFileSync(join(worktreeB, 'deps', 'worker-artifact.txt'), 'worker artifact\n')
check('worker-created ignored writes never become canonical files', readFileSync(join(repo, 'deps', 'fixture.txt'), 'utf8') === 'immutable dependency baseline\n' && !existsSync(join(repo, 'deps', 'worker-artifact.txt')))
const refreshSeedB = execFileSync('bash', [script, 'refresh', repo, worktreeB, base, token, invocationNonce, planHash, 'deps'], { encoding: 'utf8' }).trim()
check('second unit refreshes from the first unit’s integrated canonical state', readFileSync(join(worktreeB, 'a.txt'), 'utf8') === 'unit a\n' && existsSync(join(worktreeB, 'new-a.txt')) && refreshSeedB.length === 40)
check('refresh restores the immutable ignored baseline and removes worker ignored artifacts', readFileSync(join(worktreeB, 'deps', 'fixture.txt'), 'utf8') === 'immutable dependency baseline\n' && !existsSync(join(worktreeB, 'deps', 'worker-artifact.txt')))

writeFileSync(join(worktreeB, 'b.txt'), 'unit b\n')
writeFileSync(join(worktreeB, 'new-b.txt'), 'unit b new file\n')
writeFileSync(join(worktreeB, 'deps', 'worker-artifact.txt'), 'must stay private\n')
let ignoredTamperCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeB, refreshSeedB, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'b.txt', 'new-b.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { ignoredTamperCode = error.status || 1 }
check('dependency content tamper is rejected before a gate can falsely integrate it', ignoredTamperCode !== 0 && readFileSync(join(repo, 'b.txt'), 'utf8') === 'base b\n' && readFileSync(join(repo, 'deps', 'fixture.txt'), 'utf8') === 'immutable dependency baseline\n', `status=${ignoredTamperCode}`)

const modeCleanSeedB = execFileSync('bash', [script, 'refresh', repo, worktreeB, base, token, invocationNonce, planHash, 'deps'], { encoding: 'utf8' }).trim()
chmodSync(join(worktreeB, 'deps', 'fixture.txt'), 0o600)
let ignoredModeTamperCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeB, modeCleanSeedB, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'b.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { ignoredModeTamperCode = error.status || 1 }
check('dependency mode tamper is rejected before integration', ignoredModeTamperCode !== 0 && readFileSync(join(repo, 'b.txt'), 'utf8') === 'base b\n', `status=${ignoredModeTamperCode}`)

const linkCleanSeedB = execFileSync('bash', [script, 'refresh', repo, worktreeB, base, token, invocationNonce, planHash, 'deps'], { encoding: 'utf8' }).trim()
symlinkSync('fixture.txt', join(worktreeB, 'deps', 'worker-link'))
let ignoredSymlinkTamperCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeB, linkCleanSeedB, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'b.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { ignoredSymlinkTamperCode = error.status || 1 }
check('dependency symlink tamper is rejected before integration', ignoredSymlinkTamperCode !== 0 && readFileSync(join(repo, 'b.txt'), 'utf8') === 'base b\n', `status=${ignoredSymlinkTamperCode}`)

const cleanSeedB = execFileSync('bash', [script, 'refresh', repo, worktreeB, base, token, invocationNonce, planHash, 'deps'], { encoding: 'utf8' }).trim()
writeFileSync(join(worktreeB, 'b.txt'), 'unit b\n')
writeFileSync(join(worktreeB, 'new-b.txt'), 'unit b new file\n')
let integrateBCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeB, cleanSeedB, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'b.txt', 'new-b.txt'], { encoding: 'utf8' }) } catch (error) { integrateBCode = error.status || 1 }
check('second unit integrates after refresh with the first unit preserved', integrateBCode === 0 && readFileSync(join(repo, 'a.txt'), 'utf8') === 'unit a\n' && readFileSync(join(repo, 'b.txt'), 'utf8') === 'unit b\n' && readFileSync(join(repo, 'new-b.txt'), 'utf8') === 'unit b new file\n' && readFileSync(join(repo, 'deps', 'fixture.txt'), 'utf8') === 'immutable dependency baseline\n' && !existsSync(join(repo, 'deps', 'worker-artifact.txt')))

let identityCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeA, seedB, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'a.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { identityCode = error.status || 1 }
check('a mismatched unit seed is rejected without changing canonical files', identityCode !== 0 && readFileSync(join(repo, 'a.txt'), 'utf8') === 'unit a\n' && readFileSync(join(repo, 'b.txt'), 'utf8') === 'unit b\n')

const refreshSeedA = execFileSync('bash', [script, 'refresh', repo, worktreeA, base, token, invocationNonce, planHash, 'deps'], { encoding: 'utf8' }).trim()
check('first unit also refreshes after the second unit integrates', readFileSync(join(worktreeA, 'b.txt'), 'utf8') === 'unit b\n' && refreshSeedA.length === 40)

writeFileSync(join(worktreeA, 'a.txt'), 'unsafe unit a\n')
writeFileSync(join(worktreeA, 'b.txt'), 'out of scope\n')
let escapeCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeA, refreshSeedA, repo, token, invocationNonce, planHash, '--ignored', 'deps', '--files', 'a.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { escapeCode = error.status || 1 }
check('out-of-scope unit writes are rejected before any patch applies', escapeCode !== 0 && readFileSync(join(repo, 'a.txt'), 'utf8') === 'unit a\n' && readFileSync(join(repo, 'b.txt'), 'utf8') === 'unit b\n')

let aliasCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeA, refreshSeedA, repo, token, invocationNonce, planHash, '../escape'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { aliasCode = error.status || 1 }
check('path traversal ownership aliases are rejected', aliasCode !== 0)

let wrongRunRefreshCode = 0
try { execFileSync('bash', [script, 'refresh', repo, worktreeA, base, tokenOther, invocationNonceOther, planHashOther], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { wrongRunRefreshCode = error.status || 1 }
check('a same-repository worktree from another concurrent run cannot be refreshed', wrongRunRefreshCode !== 0 && existsSync(worktreeRoot) && existsSync(worktreeA) && existsSync(worktreeB))
let wrongRunIntegrateCode = 0
try { execFileSync('bash', [script, 'integrate', repo, worktreeA, refreshSeedA, repo, tokenOther, invocationNonceOther, planHashOther, 'a.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { wrongRunIntegrateCode = error.status || 1 }
check('a same-repository worktree from another concurrent run cannot be integrated', wrongRunIntegrateCode !== 0 && readFileSync(join(repo, 'a.txt'), 'utf8') === 'unit a\n')
let wrongRunCleanupCode = 0
try { execFileSync('bash', [script, 'cleanup', repo, worktreeRoot, tokenOther, invocationNonceOther, planHashOther], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { wrongRunCleanupCode = error.status || 1 }
check('a same-repository worktree from another concurrent run cannot be cleaned up', wrongRunCleanupCode !== 0 && existsSync(worktreeRoot) && existsSync(worktreeA) && existsSync(worktreeB))

let replayCode = 0
try { execFileSync('bash', [script, 'cleanup', repo, worktreeRootOther, tokenOther, invocationNonce, planHash], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { replayCode = error.status || 1 }
check('a complete valid root/token/unit set from another identical plan is rejected by this invocation nonce without mutation', replayCode !== 0 && existsSync(worktreeRootOther) && existsSync(otherA) && existsSync(otherB) && readFileSync(join(worktreeRootOther, '.run.identity'), 'utf8').includes(`invocation_nonce=${invocationNonceOther}`))

const invalidChild = join(worktreeRoot, 'unexpected-unit')
mkdirSync(invalidChild)
let invalidSetCleanupCode = 0
try { execFileSync('bash', [script, 'cleanup', repo, worktreeRoot, token, invocationNonce, planHash], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { invalidSetCleanupCode = error.status || 1 }
check('invalid whole-set cleanup performs zero deletions', invalidSetCleanupCode !== 0 && existsSync(worktreeRoot) && existsSync(worktreeA) && existsSync(worktreeB), `status=${invalidSetCleanupCode}`)
rmSync(invalidChild, { recursive: true, force: true })

const cleanupFailureRoot = realpathSync(execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-build-worktrees.XXXXXXXX')], { encoding: 'utf8' }).trim())
const cleanupFailureNonce = 'e'.repeat(64)
const cleanupFailureA = join(cleanupFailureRoot, 'unit-a')
const cleanupFailureB = join(cleanupFailureRoot, 'unit-b')
const cleanupFailureToken = execFileSync('bash', [script, 'prepare', repo, base, cleanupFailureRoot, cleanupFailureNonce, planHash, 'unit-a', 'unit-b'], { encoding: 'utf8' }).trim()
const cleanupFailureBranchA = `codex-build/${cleanupFailureToken.slice(0, 12)}-unit-a`
const cleanupFailureBranchB = `codex-build/${cleanupFailureToken.slice(0, 12)}-unit-b`
execFileSync('bash', [script, 'create', repo, base, cleanupFailureA, cleanupFailureBranchA, cleanupFailureNonce, planHash], { encoding: 'utf8' })
execFileSync('bash', [script, 'create', repo, base, cleanupFailureB, cleanupFailureBranchB, cleanupFailureNonce, planHash], { encoding: 'utf8' })
execFileSync('bash', [script, 'seed', repo, cleanupFailureA, cleanupFailureNonce, planHash], { encoding: 'utf8' })
execFileSync('bash', [script, 'seed', repo, cleanupFailureB, cleanupFailureNonce, planHash], { encoding: 'utf8' })
let injectedCleanupCode = 0
try {
  execFileSync('bash', [script, 'cleanup', repo, cleanupFailureRoot, cleanupFailureToken, cleanupFailureNonce, planHash], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CLAUDE_BUILD_WORKTREE_FAIL_REMOVE_AFTER: '1' } })
} catch (error) { injectedCleanupCode = error.status || 1 }
const cleanupJournal = join(cleanupFailureRoot, '.cleanup.journal')
check('cleanup journals progress before removal and leaves an actionable resumable state after an injected second-remove failure', injectedCleanupCode !== 0 && existsSync(cleanupJournal) && readFileSync(cleanupJournal, 'utf8').includes('phase=blocked') && readFileSync(cleanupJournal, 'utf8').includes('unit.unit-a.state=removed') && readFileSync(cleanupJournal, 'utf8').includes('unit.unit-b.state=pending') && !existsSync(cleanupFailureA) && existsSync(cleanupFailureB))
let resumedCleanupCode = 0
try { execFileSync('bash', [script, 'cleanup', repo, cleanupFailureRoot, cleanupFailureToken, cleanupFailureNonce, planHash], { encoding: 'utf8' }) } catch (error) { resumedCleanupCode = error.status || 1 }
let failureBranchGone = false
try { execFileSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${cleanupFailureBranchA}`], { stdio: 'ignore' }) } catch { failureBranchGone = true }
let failureBranchBGone = false
try { execFileSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${cleanupFailureBranchB}`], { stdio: 'ignore' }) } catch { failureBranchBGone = true }
check('cleanup retry consumes completed tombstones, removes only remaining worktrees, then deletes branches and the root', resumedCleanupCode === 0 && !existsSync(cleanupFailureRoot) && failureBranchGone && failureBranchBGone && readFileSync(join(repo, 'a.txt'), 'utf8') === 'unit a\n')

const foreignRoot = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-build-worktrees.XXXXXXXX')], { encoding: 'utf8' }).trim()
const foreign = join(foreignRoot, 'foreign')
execFileSync('mkdir', ['-p', foreign])
const foreignGit = (...args) => execFileSync('git', ['-C', foreign, ...args], { encoding: 'utf8' })
foreignGit('init', '-q')
foreignGit('config', 'user.email', 'test@example.com')
foreignGit('config', 'user.name', 'Foreign Checkout')
writeFileSync(join(foreign, 'foreign.txt'), 'must remain\n')
foreignGit('add', '.')
foreignGit('commit', '-qm', 'foreign')
foreignGit('checkout', '-qb', 'codex-build/foreign')

let cleanupCode = 0
try { execFileSync('bash', [script, 'cleanup', repo, worktreeRoot, token, invocationNonce, planHash], { encoding: 'utf8' }) } catch (error) { cleanupCode = error.status || 1 }
let branchGone = false
try { execFileSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${branchA}`], { stdio: 'ignore' }) } catch { branchGone = true }
check('shared private-root cleanup removes both units and leaves an unrelated checkout untouched', cleanupCode === 0 && !existsSync(worktreeRoot) && existsSync(foreignRoot) && existsSync(join(foreign, 'foreign.txt')) && branchGone)

let cleanupOtherCode = 0
try { execFileSync('bash', [script, 'cleanup', repo, worktreeRootOther, tokenOther, invocationNonceOther, planHashOther], { encoding: 'utf8' }) } catch (error) { cleanupOtherCode = error.status || 1 }
check('the second concurrent run cleans independently after the first run', cleanupOtherCode === 0 && !existsSync(worktreeRootOther))

let foreignCode = 0
try { execFileSync('bash', [script, 'integrate', repo, foreign, 'HEAD', repo, token, invocationNonce, planHash, 'a.txt'], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { foreignCode = error.status || 1 }
check('unrelated checkout without the identity manifest is refused before integration', foreignCode !== 0 && readFileSync(join(repo, 'a.txt'), 'utf8') === 'unit a\n' && readFileSync(join(foreign, 'foreign.txt'), 'utf8') === 'must remain\n')
let foreignCleanupCode = 0
try { execFileSync('bash', [script, 'cleanup', repo, foreignRoot, token, invocationNonce, planHash], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { foreignCleanupCode = error.status || 1 }
check('cleanup refuses a root containing an unrelated checkout', foreignCleanupCode !== 0 && existsSync(foreignRoot) && existsSync(foreign), `status=${foreignCleanupCode}`)
rmSync(foreignRoot, { recursive: true, force: true })

const head = base
const stream = (records, target, expectedIdentity = '') => {
  const args = ['bash', [script, 'parse-worktrees', target, head]]
  if (expectedIdentity) args[1].push(expectedIdentity)
  return execFileSync(...args, { input: `${records}\n`, encoding: 'utf8' }).trim()
}
const record = (path, identity = 'branch refs/heads/codex-build/unit-a') => `worktree ${path}\nHEAD ${head}\n${identity}`
const bareRecord = (path) => `worktree ${path}\nbare`
const records = [record('/tmp/first', 'branch refs/heads/main'), record('/tmp/target'), record('/tmp/last', 'detached')]
check('registered-worktree parser selects a target in the middle of complete records', stream(records.join('\n\n'), '/tmp/target', 'codex-build/unit-a') === 'codex-build/unit-a')
check('registered-worktree parser accepts a target first', stream([record('/tmp/target'), bareRecord('/tmp/last')].join('\n\n'), '/tmp/target', 'codex-build/unit-a') === 'codex-build/unit-a')
check('registered-worktree parser accepts a target last', stream([record('/tmp/first', 'branch refs/heads/main'), record('/tmp/target')].join('\n\n'), '/tmp/target', 'codex-build/unit-a') === 'codex-build/unit-a')
check('registered-worktree parser accepts detached and bare non-target records', stream([bareRecord('/tmp/first'), record('/tmp/target')].join('\n\n'), '/tmp/target', 'codex-build/unit-a') === 'codex-build/unit-a')
check('registered-worktree parser returns detached and bare target identities', stream(record('/tmp/target', 'detached'), '/tmp/target', 'detached') === 'detached' && stream(bareRecord('/tmp/target'), '/tmp/target', 'bare') === 'bare')
const expectParserFailure = (records, target = '/tmp/target') => {
  try { stream(records, target, 'codex-build/unit-a'); return false } catch { return true }
}
check('registered-worktree parser rejects duplicate target paths', expectParserFailure([record('/tmp/target'), record('/tmp/target')].join('\n\n')))
check('registered-worktree parser rejects duplicate fields', expectParserFailure(`worktree /tmp/target\nHEAD ${head}\nHEAD ${head}\nbranch refs/heads/codex-build/unit-a`))
check('registered-worktree parser rejects incomplete non-target records', expectParserFailure(`worktree /tmp/other\nHEAD ${head}\n\nworktree /tmp/target\nHEAD ${head}\nbranch refs/heads/codex-build/unit-a`, '/tmp/target'))
check('registered-worktree parser rejects malformed record order', expectParserFailure(`HEAD ${head}\nworktree /tmp/target\nbranch refs/heads/codex-build/unit-a`))
const fakeBin = mkdtempSync(join(tmpdir(), 'claude-build-fake-git-'))
const fakeGit = join(fakeBin, 'git')
writeFileSync(fakeGit, `#!/bin/sh
case "$*" in
  *"rev-parse --verify"*) printf '%s\\n' '${head}' ;;
  *"worktree list --porcelain -z"*) printf 'worktree /tmp/target\\0HEAD ${head}\\0branch refs/heads/codex-build/unit-a\\0\\0'; exit 7 ;;
  *) exit 9 ;;
esac
`)
chmodSync(fakeGit, 0o755)
let producerCode = 0
try {
  execFileSync('bash', [script, 'registered-worktree', '/tmp/repo', '/tmp/target', 'codex-build/unit-a'], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } })
} catch (error) { producerCode = error.status || 1 }
check('registered-worktree rejects a nonzero porcelain producer even when its output is valid', producerCode !== 0)
rmSync(fakeBin, { recursive: true, force: true })

// These parser fixtures come from Git itself, including the records that are
// easy to get wrong by hand: detached, bare, locked-with-reason, and
// prunable-with-reason. Keep the binary NUL framing all the way into the
// parser so a newline in a path cannot change record boundaries.
const fixtureRepo = join(root, 'parser-fixture-repo')
mkdirSync(fixtureRepo)
const fixtureGit = (...args) => execFileSync('git', ['-C', fixtureRepo, ...args], { encoding: 'utf8' })
fixtureGit('init', '-q')
fixtureGit('config', 'user.email', 'fixture@example.com')
fixtureGit('config', 'user.name', 'Parser Fixture')
writeFileSync(join(fixtureRepo, 'fixture.txt'), 'fixture\n')
fixtureGit('add', '.')
fixtureGit('commit', '-qm', 'fixture')
const fixtureHead = fixtureGit('rev-parse', 'HEAD').trim()
const fixtureNormal = join(root, 'parser-normal')
const fixtureDetached = join(root, 'parser-detached')
const fixturePrunable = join(root, 'parser-prunable')
fixtureGit('worktree', 'add', '-q', '-b', 'parser-normal', fixtureNormal, fixtureHead)
fixtureGit('worktree', 'add', '--detach', '-q', fixtureDetached, fixtureHead)
fixtureGit('worktree', 'add', '-q', '-b', 'parser-prunable', fixturePrunable, fixtureHead)
fixtureGit('worktree', 'lock', '--reason', 'fixture lock reason', fixtureNormal)
rmSync(fixturePrunable, { recursive: true, force: true })
const fixtureStream = execFileSync('git', ['-C', fixtureRepo, 'worktree', 'list', '--porcelain', '-z'], { encoding: null })
const parseZ = (records, target, expectedHead = '', expectedIdentity = '') => {
  const args = ['bash', [script, 'parse-worktrees-z', target, expectedHead]]
  if (expectedIdentity) args[1].push(expectedIdentity)
  return execFileSync(...args, { input: records, encoding: 'utf8' }).trim()
}
check('real Git NUL fixture accepts a normal locked record with its reason', parseZ(fixtureStream, realpathSync(fixtureNormal), fixtureHead, 'parser-normal') === 'parser-normal')
check('real Git NUL fixture accepts a detached record', parseZ(fixtureStream, realpathSync(fixtureDetached), fixtureHead, 'detached') === 'detached')
check('real Git NUL fixture accepts a prunable record with its reason', parseZ(fixtureStream, join(realpathSync(root), 'parser-prunable'), fixtureHead, 'parser-prunable') === 'parser-prunable')
const bareFixture = join(root, 'parser-fixture-bare.git')
execFileSync('git', ['init', '--bare', '-q', bareFixture])
const bareStream = execFileSync('git', ['-C', bareFixture, 'worktree', 'list', '--porcelain', '-z'], { encoding: null })
check('real Git bare-repository fixture accepts a record without HEAD or branch', parseZ(bareStream, realpathSync(bareFixture), fixtureHead, 'bare') === 'bare')
const duplicateNonTarget = [record('/tmp/other', 'branch refs/heads/main'), record('/tmp/other', 'branch refs/heads/side'), record('/tmp/target')].join('\n\n')
check('registered-worktree parser rejects duplicate non-target paths too', expectParserFailure(duplicateNonTarget))
check('registered-worktree parser rejects a locked reason before an identity', expectParserFailure(`worktree /tmp/target\nlocked fixture reason\nHEAD ${head}\nbranch refs/heads/codex-build/unit-a`))
rmSync(fixturePrunable, { force: true })
fixtureGit('worktree', 'prune')
rmSync(fixtureDetached, { recursive: true, force: true })
fixtureGit('worktree', 'remove', '--force', fixtureDetached)
rmSync(fixtureNormal, { recursive: true, force: true })
fixtureGit('worktree', 'unlock', fixtureNormal)
fixtureGit('worktree', 'remove', '--force', fixtureNormal)
rmSync(fixtureRepo, { recursive: true, force: true })
rmSync(bareFixture, { recursive: true, force: true })
rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
