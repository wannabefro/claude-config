import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const script = fileURLToPath(new URL('../scripts/cleanup-review-bundle.sh', import.meta.url))
chmodSync(script, 0o755)
const bundle = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
writeFileSync(join(bundle, '00-manifest.txt'), 'repository=/private/tmp/repo\n')
writeFileSync(join(bundle, '01-the-diff.patch'), '')
const check = (name, ok, detail = '') => console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)

let code = 0
try { execFileSync(script, [bundle], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { code = error.status || 1 }
check('canonical bundle is removed after the final consumer', code === 0 && !existsSync(bundle), `status=${code} exists=${existsSync(bundle)}`)

const foreign = mkdtempSync(join(tmpdir(), 'not-a-review-bundle-'))
writeFileSync(join(foreign, '00-manifest.txt'), 'foreign\n')
writeFileSync(join(foreign, '01-the-diff.patch'), '')
let foreignCode = 0
try { execFileSync(script, [foreign], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { foreignCode = error.status || 1 }
check('foreign temporary directories are never deleted', foreignCode !== 0 && existsSync(foreign), `status=${foreignCode} exists=${existsSync(foreign)}`)

rmSync(foreign, { recursive: true, force: true })
console.log('  ---- cleanup bundle checks complete')
