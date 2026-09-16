import { accessSync, constants as fsConstants, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const configRootPath = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]+$/, '') || '/'
const configRoot = realpathSync(configRootPath)
const settingsPath = join(configRoot, 'settings.json')
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

const parseObject = (text) => {
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('settings must be a JSON object')
  return value
}

const raw = readFileSync(settingsPath, 'utf8')
let settings = null
let settingsError = ''
try {
  settings = parseObject(raw)
} catch (error) {
  settingsError = error instanceof Error ? error.message : String(error)
}
check('settings.json loads as a valid JSON object', settings !== null, settingsError)

const commandEntries = []
const visit = (value, path) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`
    if (key === 'command' && typeof item === 'string') commandEntries.push({ path: itemPath, command: item })
    else visit(item, itemPath)
  }
}
if (settings?.hooks) visit(settings.hooks, 'settings.hooks')

const hookReferences = new Map()
const addHook = (configured, resolved) => hookReferences.set(`${configured}\0${resolved}`, { configured, resolved })
const collectHooks = (command) => {
  for (const marker of ['__CLAUDE_HOME__/hooks/', '$HOME/.claude/hooks/']) {
    let from = 0
    while (true) {
      const start = command.indexOf(marker, from)
      if (start < 0) break
      const rest = command.slice(start + marker.length)
      const match = rest.match(/^([A-Za-z0-9._-]+)/)
      if (match) addHook(`${marker}${match[1]}`, join(configRoot, 'hooks', match[1]))
      from = start + marker.length
    }
  }
  const suffix = '/hooks/'
  let from = 0
  while (true) {
    const start = command.indexOf(suffix, from)
    if (start < 0) break
    const rest = command.slice(start + suffix.length)
    const match = rest.match(/^([A-Za-z0-9._-]+)/)
    if (match) {
      const end = start + suffix.length + match[1].length
      for (let pathStart = start - 1; pathStart >= 0; pathStart--) {
        if (command[pathStart] !== '/') continue
        if (pathStart > 0 && !/[\s"'`=([;&|]/.test(command[pathStart - 1])) continue
        const configured = command.slice(pathStart, end)
        addHook(configured, configured)
      }
      from = end
    } else {
      from = start + suffix.length
    }
  }
}
for (const { command } of commandEntries) collectHooks(command)

const failures = []
for (const { configured, resolved } of hookReferences.values()) {
  let valid = false
  let detail = resolved
  try {
    const canonical = realpathSync(resolved)
    valid = (canonical === configRoot || canonical.startsWith(`${configRoot}/`)) && statSync(canonical).isFile() && (() => {
      accessSync(canonical, fsConstants.X_OK)
      return true
    })()
    detail = `${configured} -> ${canonical}`
  } catch (error) {
    detail = `${configured}: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!valid) failures.push(detail)
}
check('every configured local hook resolves to an executable file in the install root', failures.length === 0, failures.join('; '))
check('at least one local hook is validated from the loaded settings', hookReferences.size > 0, 'settings.hooks contained no local install-root hook path')

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
