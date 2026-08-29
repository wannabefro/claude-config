import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const expected = [
  'cdcaba64468c8abfd53393059d5bba651e843474:evals/build-route-test.mjs:generic-api-key:25',
  'cdcaba64468c8abfd53393059d5bba651e843474:evals/review-secret-scan-test.mjs:github-pat:51',
]
const ignorePath = new URL('../.gitleaksignore', import.meta.url)
const entries = readFileSync(ignorePath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
const fingerprint = /^[0-9a-f]{40}:evals\/[A-Za-z0-9._/-]+\.mjs:[a-z0-9-]+:\d+$/
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

const ignoreStatus = spawnSync('git', ['check-ignore', '-q', '--no-index', '.gitleaksignore'], { encoding: 'utf8' }).status
check('ignore file is explicitly allowed by the repository denylist', ignoreStatus !== 0, `status=${ignoreStatus}`)
check('ignore file contains only the two approved fingerprints', entries.length === expected.length && expected.every((entry) => entries.includes(entry)), JSON.stringify(entries))
check('ignore entries are full fingerprints, not broad path or rule patterns', entries.every((entry) => fingerprint.test(entry)), JSON.stringify(entries))

const root = mkdtempSync(join(tmpdir(), 'claude-gitleaks-ignore-'))
const repo = join(root, 'repo')
mkdirSync(join(repo, 'evals'), { recursive: true })
const fixture = join(repo, 'evals', 'review-secret-scan-test.mjs')
writeFileSync(fixture, execFileSync('git', ['show', 'cdcaba6:evals/review-secret-scan-test.mjs']))
execFileSync('git', ['-C', repo, 'init', '-q'])
execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
execFileSync('git', ['-C', repo, 'config', 'user.name', 'Gitleaks Test'])
execFileSync('git', ['-C', repo, 'add', 'evals/review-secret-scan-test.mjs'])
execFileSync('git', ['-C', repo, 'commit', '-qm', 'synthetic fixture'])
writeFileSync(join(repo, '.gitleaksignore'), readFileSync(ignorePath))
const result = spawnSync('gitleaks', ['git', repo, '--redact', '--no-banner', '--report-format', 'json', '--report-path', '-', '--gitleaks-ignore-path', join(repo, '.gitleaksignore')], { encoding: 'utf8' })
let findings = []
try { findings = JSON.parse(result.stdout || '[]') } catch {}
check('a different commit fingerprint for the same rule remains detectable', result.status === 1 && findings.length === 1 && findings[0].RuleID === 'github-pat' && !expected.includes(findings[0].Fingerprint), JSON.stringify({ status: result.status, findings: findings.map((finding) => finding.Fingerprint) }))
rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${failures === 0 ? 4 : 'some'} checks passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
