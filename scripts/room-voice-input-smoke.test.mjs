import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../', import.meta.url))
const workflow = parse(readFileSync(join(root, '.github/workflows/room-voice-input-smoke.yml'), 'utf8'))

// Exercise the real script's mode selection, transform and evidence writing
// without launching Electron or touching physical audio/provider services.
function runSmoke(t, { args = [], voiceCount = 0, baseline = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kun-voice-contract-'))
  t.after(() => rmSync(directory, { force: true, recursive: true }))
  const composer = join(directory, 'before.tsx')
  writeFileSync(composer, 'original composer fixture')
  writeFileSync(join(directory, 'mock.mjs'), `
import { appendFileSync, writeFileSync } from 'node:fs'
const trace = value => appendFileSync(process.env.KUN_TEST_TRACE, JSON.stringify(value) + '\\n')
const page = {
  on() {}, async goto() {}, async waitForTimeout() {},
  locator() { return { async waitFor() {}, async count() { return ${voiceCount} } } },
  getByRole(role, options) { return { async waitFor() {
    trace({ role, name: options.name })
    throw new Error('CURRENT_SOURCE_VOICE_GATE_REACHED')
  } } },
  async screenshot({ path }) { writeFileSync(path, 'screenshot fixture') },
  isClosed() { return false }, async content() { return '<html>fixture</html>' }
}
export const _electron = { async launch() {
  return { async firstWindow() { return page }, async close() {} }
} }
export async function createServer(options) {
  const source = await options.plugins[0].transform('current composer fixture', '/rooms/RoomComposer.tsx')
  trace({ source: source ?? 'current composer fixture' })
  return { async listen() {}, async close() {}, resolvedUrls: { local: ['http://127.0.0.1/'] } }
}
`)
  writeFileSync(join(directory, 'register.mjs'), `
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright-core' || specifier === 'vite') {
    return { url: new URL('./mock.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
} })
`)
  const env = { ...process.env, KUN_VOICE_EVIDENCE: join(directory, 'evidence'),
    KUN_TEST_TRACE: join(directory, 'trace.jsonl'), ELECTRON_OVERRIDE_DIST_PATH: directory }
  delete env.KUN_VOICE_BASELINE_COMPOSER
  if (baseline) env.KUN_VOICE_BASELINE_COMPOSER = composer
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(join(directory, 'register.mjs')).href,
    'scripts/smoke-room-voice-input.mjs', ...args], { cwd: root, env, encoding: 'utf8' })
  return { ...result, directory, evidence: env.KUN_VOICE_EVIDENCE,
    report: () => JSON.parse(readFileSync(join(env.KUN_VOICE_EVIDENCE, 'report.json'), 'utf8')),
    trace: () => readFileSync(env.KUN_TEST_TRACE, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}

test('PR workflow captures the base honestly and keeps the current-source native gate mandatory', () => {
  const steps = workflow.jobs['windows-voice'].steps
  const before = steps.find(step => step.name === 'Capture original composer voice control')
  assert.equal(before.if, "github.event_name == 'pull_request'")
  assert.equal(before.run, 'node scripts/smoke-room-voice-input.mjs --capture-baseline')
  assert.ok(before.env.KUN_VOICE_BASELINE_COMPOSER)
  assert.equal(before['continue-on-error'], undefined)
  const current = steps.find(step => step.name === 'Verify offline native voice workflow')
  assert.equal(current.run, 'node scripts/smoke-room-voice-input.mjs')
  assert.equal(current.if, undefined)
  assert.equal(current.env.KUN_VOICE_BASELINE_COMPOSER, undefined)
  assert.equal(current['continue-on-error'], undefined)
  assert.ok(steps.indexOf(current) > steps.indexOf(before))
  assert.ok(steps.some(step => step.run === 'node --test scripts/room-voice-input-smoke.test.mjs'))
  assert.ok(workflow.on.pull_request.paths.includes('scripts/room-voice-input-smoke.test.mjs'))
})

for (const voiceCount of [0, 1]) {
  test(`baseline capture records ${voiceCount} voice controls without requiring absence`, t => {
    const result = runSmoke(t, { args: ['--capture-baseline'], voiceCount })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.trace(), [{ source: 'original composer fixture' }])
    assert.equal(result.report().baseline, true)
    assert.equal(result.report().baselineVoiceControlCount, voiceCount)
    assert.deepEqual(result.report().errors, [])
    const screenshot = voiceCount ? 'before-with-voice.png' : 'before-missing-voice.png'
    assert.equal(readFileSync(join(result.evidence, screenshot), 'utf8'), 'screenshot fixture')
  })
}

test('historical missing-voice reproduction stays strict', t => {
  const missing = runSmoke(t, { args: ['--expect-missing'] })
  assert.equal(missing.status, 0, missing.stderr)
  const present = runSmoke(t, { args: ['--expect-missing'], voiceCount: 1 })
  assert.notEqual(present.status, 0)
  assert.match(present.stderr, /AssertionError/)
})

test('current-source run never bypasses its voice assertion when the control is missing', t => {
  const result = runSmoke(t, { baseline: false })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CURRENT_SOURCE_VOICE_GATE_REACHED/)
  assert.deepEqual(result.trace(), [{ source: 'current composer fixture' }, { role: 'button', name: 'Voice input' }])
  assert.equal(result.report().baseline, false)
  assert.equal(result.report().baselineVoiceControlCount, null)
})

test('baseline capture cannot silently run against current source or leak into the final gate', t => {
  for (const args of [['--capture-baseline'], ['--expect-missing']]) {
    const result = runSmoke(t, { args, baseline: false })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /baseline requires the original RoomComposer source/)
  }
  const leaked = runSmoke(t)
  assert.notEqual(leaked.status, 0)
  assert.match(leaked.stderr, /current-source verification must not receive a baseline composer/)
  const conflicting = runSmoke(t, { args: ['--capture-baseline', '--expect-missing'] })
  assert.notEqual(conflicting.status, 0)
  assert.match(conflicting.stderr, /choose baseline capture or strict missing-voice reproduction/)
})
