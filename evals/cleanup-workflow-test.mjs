import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cleanupScript = fileURLToPath(new URL('../scripts/cleanup-review-bundle.sh', import.meta.url))
const makeBundle = () => {
  const bundle = execFileSync('mktemp', ['-d', join(tmpdir(), 'claude-review-bundle.XXXXXXXX')], { encoding: 'utf8' }).trim()
  writeFileSync(join(bundle, '00-manifest.txt'), 'repository=/private/tmp/repo\n')
  writeFileSync(join(bundle, '01-the-diff.patch'), '')
  mkdirSync(join(bundle, 'files', 'after'), { recursive: true })
  mkdirSync(join(bundle, 'untracked', 'after'), { recursive: true })
  return bundle
}

const evaluate = (file, args, agent, pipeline = null) => {
  const source = readFileSync(file, 'utf8').replace(/^export const meta/m, 'const meta')
  const runPipeline = pipeline || (async (members, producer, consumer) => {
    const reviews = await Promise.all(members.map((member) => producer(member)))
    return Promise.all(reviews.map((review, i) => consumer(review, members[i])))
  })
  const fn = new Function('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', `return (async () => {${source}\n})()`)
  return fn(agent, (calls) => Promise.all(calls.map((call) => call())), runPipeline, () => {}, () => {}, args, {}, {})
}

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n         ${detail}`}`)
}

const reviewBundle = makeBundle()
const reviewAgent = async (_prompt, options) => {
  if (options.label === 'review:classify') return { tier: 'normal', reason: 'behaviour change' }
  if (options.label === 'review:normal:opus') throw new Error('injected reviewer failure')
  if (options.label === 'review:normal:codex') return { status: 'reviewed', findings: [] }
  if (options.label === 'review:cleanup' || options.label === 'review:exception-cleanup') {
    execFileSync(cleanupScript, [reviewBundle])
    return { status: 'cleaned' }
  }
  throw new Error(`unexpected review call: ${options.label}`)
}
let reviewRejected = false
try { await evaluate(fileURLToPath(new URL('../workflows/review.js', import.meta.url)), { bundlePath: reviewBundle, target: 'HEAD..HEAD' }, reviewAgent) } catch { reviewRejected = true }
check('reviewer failure rejects the workflow', reviewRejected)
check('review finally cleans a bundle after reviewer failure', !existsSync(reviewBundle))

const councilBundle = makeBundle()
const councilAgent = async (_prompt, options) => {
  if (options.label === 'lens:correctness') return { findings: [{ title: 'real defect', file: 'a.js', severity: 'major', why_it_breaks: 'input causes wrong result' }] }
  if (options.label.startsWith('lens:')) return { findings: [] }
  if (options.label.startsWith('challenge:')) return { verdicts: [{ index: 0, refuted: false, reasoning: 'reachable failure' }] }
  if (options.label === 'judge') throw new Error('injected judge failure')
  if (options.label === 'council:cleanup-bundle') {
    execFileSync(cleanupScript, [councilBundle])
    return { status: 'cleaned' }
  }
  throw new Error(`unexpected council call: ${options.label}`)
}
let judgeRejected = false
try { await evaluate(fileURLToPath(new URL('../workflows/council-review.js', import.meta.url)), { bundlePath: councilBundle, target: 'HEAD..HEAD' }, councilAgent) } catch { judgeRejected = true }
check('judge failure rejects the council workflow', judgeRejected)
check('council finally cleans a bundle after judge failure', !existsSync(councilBundle))

console.log(`  ---- ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
