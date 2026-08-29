import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync as runFile, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'claude settings filter-'))
const repo = join(root, 'repo')
const home = join(repo, 'claude home')
const settingsSource = readFileSync(new URL('../scripts/settings-clean.py', import.meta.url), 'utf8')
const pathSource = readFileSync(new URL('../scripts/path-clean.py', import.meta.url), 'utf8')
const python = '/usr/bin/python3'
const settingsScript = join(root, 'settings-clean.py')
const pathScript = join(root, 'path-clean.py')
const brokenScript = join(root, 'broken-filter.py')
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`
const git = (args) => runFile('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' })
const checkAdd = (path) => spawnSync('git', ['-C', repo, 'add', '--', path], { encoding: 'utf8' })
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

mkdirSync(repo, { recursive: true })
mkdirSync(home, { recursive: true })
git(['init', '-q'])
git(['config', 'user.email', 'test@example.com'])
git(['config', 'user.name', 'Settings Filter Test'])
writeFileSync(join(repo, '.gitattributes'), 'settings.json filter=claudesettings\nagents/implementer.md filter=claudehome\n')
writeFileSync(join(repo, 'settings.json'), '{"baseline":true}\n')
git(['add', '.gitattributes', 'settings.json'])
git(['commit', '-qm', 'baseline'])
mkdirSync(join(repo, 'agents'), { recursive: true })
writeFileSync(settingsScript, settingsSource)
writeFileSync(pathScript, pathSource)
writeFileSync(brokenScript, '#!/usr/bin/env python3\nimport sys\nsys.exit(91)\n')
chmodSync(brokenScript, 0o755)
git(['config', 'filter.claudesettings.required', 'true'])
git(['config', 'filter.claudehome.required', 'true'])

git(['config', 'filter.claudesettings.clean', shellQuote(join(root, 'missing-filter'))])
let result = checkAdd('settings.json')
check('required clean filter rejects a missing executable', result.status !== 0, `status=${result.status}`)

git(['config', 'filter.claudesettings.clean', shellQuote(brokenScript)])
result = checkAdd('settings.json')
check('required clean filter rejects a broken executable', result.status !== 0, `status=${result.status}`)

git(['config', 'filter.claudehome.clean', shellQuote(join(root, 'missing-path-filter'))])
writeFileSync(join(repo, 'agents', 'implementer.md'), 'Run bash ' + home + '/scripts/luna-run.sh\n')
result = checkAdd('agents/implementer.md')
check('required path filter rejects a missing executable', result.status !== 0, `status=${result.status}`)

writeFileSync(join(home, 'settings.local.json'), JSON.stringify({ extraKnownMarketplaces: { 'private-market': { source: 'directory', path: '/private/market' } } }))
const validSettings = JSON.stringify({
  hooks: { probe: `${home}/hooks/verify` },
  extraKnownMarketplaces: {
    'private-market': { source: 'directory', path: '/private/market' },
    'public-market': { source: 'github', repo: 'example/public' },
  },
}, null, 2) + '\n'
writeFileSync(join(repo, 'settings.json'), validSettings)
git(['config', 'filter.claudesettings.clean', `${shellQuote(python)} ${shellQuote(settingsScript)} ${shellQuote(home)}`])
git(['config', 'filter.claudesettings.smudge', `${shellQuote(python)} ${shellQuote(pathScript)} --smudge ${shellQuote(home)}`])
git(['config', 'filter.claudehome.clean', `${shellQuote(python)} ${shellQuote(pathScript)} ${shellQuote(home)}`])
git(['config', 'filter.claudehome.smudge', `${shellQuote(python)} ${shellQuote(pathScript)} --smudge ${shellQuote(home)}`])
result = checkAdd('settings.json')
let cleaned = ''
try { cleaned = git(['show', ':settings.json']) } catch {}
check('valid filter stages settings with path and private marketplace removed', result.status === 0 && cleaned.includes('__CLAUDE_HOME__') && !cleaned.includes(home) && !cleaned.includes('private-market') && cleaned.includes('public-market'), JSON.stringify({ status: result.status, cleaned }))
const directCleaned = runFile(python, [settingsScript, home], { input: validSettings, encoding: 'utf8', stdio: 'pipe' })
const actualOid = runFile('git', ['-C', repo, 'hash-object', '--path=settings.json', '--stdin'], { input: validSettings, encoding: 'utf8', stdio: 'pipe' }).trim()
const expectedOid = runFile('git', ['-C', repo, 'hash-object', '--no-filters', '--stdin'], { input: directCleaned, encoding: 'utf8', stdio: 'pipe' }).trim()
check('Git clean output matches direct validated settings output', actualOid === expectedOid, JSON.stringify({ actualOid, expectedOid }))

writeFileSync(join(repo, 'agents', 'implementer.md'), `Run bash ${home}/scripts/luna-run.sh\n`)
result = checkAdd('agents/implementer.md')
let cleanedBrief = ''
try { cleanedBrief = git(['show', ':agents/implementer.md']) } catch {}
check('path-only filter stages and materializes implementer instructions', result.status === 0 && cleanedBrief.includes('__CLAUDE_HOME__') && !cleanedBrief.includes(home), JSON.stringify({ status: result.status, cleanedBrief }))
git(['commit', '-qm', 'filtered files'])
rmSync(join(repo, 'agents', 'implementer.md'))
git(['checkout', '--', 'agents/implementer.md'])
const materializedBrief = readFileSync(join(repo, 'agents', 'implementer.md'), 'utf8')
check('path-only smudge restores the machine path for implementer instructions', materializedBrief.includes(home) && !materializedBrief.includes('__CLAUDE_HOME__'), materializedBrief)

writeFileSync(join(home, 'settings.local.json'), '{not-json\n')
writeFileSync(join(repo, 'settings.json'), validSettings + '\n')
result = checkAdd('settings.json')
check('malformed local settings fail closed', result.status !== 0, `status=${result.status}`)

writeFileSync(join(home, 'settings.local.json'), JSON.stringify([]))
writeFileSync(join(repo, 'settings.json'), validSettings + '\n')
result = checkAdd('settings.json')
check('wrong-shaped local settings fail closed', result.status !== 0, `status=${result.status}`)

writeFileSync(join(home, 'settings.local.json'), JSON.stringify({ extraKnownMarketplaces: {} }))
writeFileSync(join(repo, 'settings.json'), '{not-json\n')
result = checkAdd('settings.json')
check('malformed tracked settings fail closed', result.status !== 0, `status=${result.status}`)

rmSync(root, { recursive: true, force: true })
console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
