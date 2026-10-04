import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { geometryProblems, measureSettings, newGeometryProblems, worsenedTargetSizes, requiredPolishProblems } from './settings-ui-smoke-geometry.mjs'
import { annotateSettingsControls, annotateSettingsTabs, scrollSettingsDetail } from './settings-ui-smoke-dom.mjs'
import { captureReadySettingsDetail, SETTINGS_DETAIL_SETTLE_MS } from './settings-ui-smoke-detail.mjs'
import { JSDOM } from 'jsdom'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

const control = (overrides = {}) => ({
  id: '1', semanticKey: 'appearance|Font scale|input|number||occurrence:1',
  tag: 'input', type: 'number', name: '', reached: { height: 36 },
  inside: true, hittable: true, focused: true, focusVisible: true, focusIndicator: true,
  ...overrides
})
const measurement = controls => ({ horizontalOverflow: false, scrollerOverflow: false, overlaps: [], controls })

test('problem identity survives numeric DOM ID changes and unrelated insertion', () => {
  const baseline = geometryProblems(measurement([control()]))
  const current = geometryProblems(measurement([
    control({ id: '0', semanticKey: 'navigation|select', name: 'Settings' }),
    control({ id: '2' })
  ]))
  assert.deepEqual(current, baseline)
  assert.match(current[0], /Font scale/)
})

test('baseline multiset rejects extra duplicates and genuinely new problems', () => {
  const old = { key: 'light-wide-125-general-landing', problem: 'same semantic control: clipped' }
  const added = { ...old, problem: 'new semantic control: missing accessible name' }
  assert.deepEqual(newGeometryProblems([old], [old, { ...old }, added]), [old, added])
  assert.deepEqual(newGeometryProblems([old, old], [old]), [])
  assert.deepEqual(newGeometryProblems([old], [{ ...old, key: 'dark-small-200-general-landing' }]),
    [{ ...old, key: 'dark-small-200-general-landing' }])
})

test('24px targets pass and smaller controls remain explicit findings', () => {
  const valid = { name: 'Toggle', tag: 'button', reached: { height: 24 } }
  assert.deepEqual(geometryProblems(measurement([control({ ...valid, role: 'switch' })])), [])
  assert.deepEqual(geometryProblems(measurement([control({ ...valid, settingsSize: 'inline-icon' })])), [])
  assert.deepEqual(geometryProblems(measurement([control(valid)])), [])
  assert.match(geometryProblems(measurement([control({ ...valid, reached: { height: 19.68 }, role: 'switch' })]))[0], /below 24/)
  assert.deepEqual(geometryProblems(measurement([control({ ...valid, reached: { height: 26.24 },
    normalizedHeight: 32, declaredTargetHeight: 32 })])), [])
})

test('improving an existing small target is not a new defect; worsening is', () => {
  const layout = height => ({ key: 'same-layout', ...measurement([control({ name: 'Small', tag: 'button', reached: { height } })]) })
  const before = layout(20), better = layout(23), worse = layout(18)
  const problems = x => geometryProblems(x).map(problem => ({ key: x.key, problem }))
  assert.deepEqual(newGeometryProblems(problems(before), problems(better)), [])
  assert.deepEqual(worsenedTargetSizes([before], [better]), [])
  assert.equal(worsenedTargetSizes([before], [worse]).length, 1)
})

test('new tab tokens cannot collide with retained hidden panels', () => {
  const document = new JSDOM('<div hidden><button role="tab" data-settings-smoke-tab="0">Old</button></div><div role="tablist" aria-label="New"><button role="tab">Current</button></div>').window.document
  const next = document.querySelector('div[role="tablist"] button')
  const result = annotateSettingsTabs([next])
  assert.equal(document.querySelectorAll('[data-settings-smoke-tab="0"]').length, 1)
  assert.equal(result[0].key, 'New::Current::1')
})

test('closed disclosure controls are excluded despite positive layout boxes', () => {
  const document = new JSDOM('<details><summary>More</summary><button>Hidden control</button></details>').window.document
  const elements = [...document.querySelectorAll('summary,button')]
  for (const element of elements) {
    element.getClientRects = () => [{}]
    element.getBoundingClientRect = () => ({ width: 32 })
  }
  annotateSettingsControls(elements)
  assert.equal(elements[0].getAttribute('data-settings-smoke-rendered'), 'true')
  assert.equal(elements[1].getAttribute('data-settings-smoke-rendered'), 'false')
  document.querySelector('details').open = true
  annotateSettingsControls(elements)
  assert.equal(elements[1].getAttribute('data-settings-smoke-rendered'), 'true')
})

test('scrolled detail targets the real switch and visible nested route tabs with bounds', t => {
  const window = new JSDOM('<div class="ds-settings-scroller"><button data-settings-smoke-control="7" role="switch" aria-label="Interactive effects"></button><div hidden role="tablist"><button role="tab" id="model-routes-settings-tab-old">Old</button></div><div role="tablist" aria-label="Model routing"><button role="tab" id="model-routes-settings-tab-models" aria-selected="true">Models</button></div></div>').window
  const { document } = window
  const globals = { document, innerWidth: 900, innerHeight: 645 }
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key])
  }
  t.after(() => window.close())
  let lastTarget, lastOptions, scrollCount = 0, targetY = 200
  window.HTMLElement.prototype.scrollIntoView = function (options) { lastTarget = this; lastOptions = options; scrollCount++ }
  window.HTMLElement.prototype.getClientRects = () => [{}]
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains('ds-settings-scroller')
      ? { x: 0, y: 100, right: 900, bottom: 645, width: 900, height: 545 }
      : { x: 50, y: targetY, right: 350, bottom: targetY + 32, width: 300, height: 32 }
  }
  const toggle = scrollSettingsDetail({ kind: 'general-switch', controlId: '7' })
  assert.equal(lastTarget.getAttribute('role'), 'switch')
  assert.deepEqual(lastOptions, { block: 'center', inline: 'nearest', behavior: 'instant' })
  assert.equal(toggle.name, 'Interactive effects')
  assert.equal(toggle.fullyVisible, true)
  assert.equal(toggle.clip.y, 100)
  const routes = scrollSettingsDetail({ kind: 'model-route-tabs' })
  assert.equal(lastTarget.getAttribute('aria-label'), 'Model routing')
  assert.equal(routes.targetRole, 'tablist')
  assert.deepEqual(routes.tabs.map(tab => tab.id), ['model-routes-settings-tab-models'])
  assert.equal(routes.tabs[0].selected, true)
  const html = document.documentElement.outerHTML
  const scrolls = scrollCount
  targetY = 250
  const refreshed = scrollSettingsDetail({ kind: 'model-route-tabs', readOnly: true })
  assert.equal(refreshed.bounds.y, 250, 'Fresh sampling observes the current target position')
  assert.equal(refreshed.tabs[0].bounds.y, 250)
  const refreshedSwitch = scrollSettingsDetail({ kind: 'general-switch', controlId: '7', readOnly: true })
  assert.equal(refreshedSwitch.bounds.y, 250)
  assert.equal(scrollCount, scrolls, 'A readiness read must not scroll again')
  assert.equal(document.documentElement.outerHTML, html, 'A readiness read must not change DOM or styles')
  assert.equal(scrollSettingsDetail({ kind: 'general-switch', controlId: 'missing' }), null)
})

test('detail capture positions once, waits, takes a fresh read, then preserves native pixels', async () => {
  let clock = 0, currentBounds = 'old'
  const order = [], pixels = { file: 'unchanged-native.png' }
  const result = await captureReadySettingsDetail({
    now: () => clock,
    position: async () => { order.push('position'); clock += 3; return { bounds: currentBounds } },
    paintFrames: async () => { order.push('frames'); clock += 32 },
    wait: async delay => { order.push(`wait:${delay}`); clock += delay + 7; currentBounds = 'fresh' },
    read: async () => { order.push('read-only'); clock += 5; return { bounds: currentBounds, fullyVisible: true } },
    capture: async () => { order.push('native-png'); clock += 10; return pixels }
  })
  assert.deepEqual(order, ['position', 'frames', `wait:${SETTINGS_DETAIL_SETTLE_MS}`, 'read-only', 'native-png'])
  assert.equal(SETTINGS_DETAIL_SETTLE_MS, 400)
  assert.equal(result.detail.bounds, 'fresh')
  assert.equal(result.positionedDetail.bounds, 'old')
  assert.equal(result.pixels, pixels)
  assert.equal(result.timing.actualWaitMs, 407)
  assert.equal(result.timing.sampleCompletedOffsetMs, result.timing.captureStartedOffsetMs)
  assert.equal(result.timing.captureCompletedOffsetMs, 457)
})

test('gateway detail captures named visible selects and detects oversized native geometry', t => {
  const window = new JSDOM(`<div class="ds-settings-scroller">
    <div hidden><div data-gateway-connection-controls><select aria-label="Hidden"></select></div></div>
    <div id="gateway-controls" data-gateway-connection-controls>
      <select aria-label="Coding client"><option>Codex</option></select>
      <select aria-label="Stable public route alias" disabled><option>No eligible alias</option></select>
    </div></div>`).window
  const { document } = window
  const globals = { document, innerWidth: 450, innerHeight: 322 }
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key])
  }
  t.after(() => window.close())
  let scrolled, width = 350, scrollCount = 0
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled = this; scrollCount++ }
  window.HTMLElement.prototype.getClientRects = () => [{}]
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('ds-settings-scroller')) {
      return { x: 13, y: 84, right: 429, bottom: 322, width: 416, height: 238 }
    }
    const y = this.disabled ? 210 : 150
    const height = this.tagName === 'SELECT' ? 30 : 90
    return { x: 40, y, width, height, right: 40 + width, bottom: y + height }
  }
  const detail = scrollSettingsDetail({ kind: 'gateway-connection-controls' })
  assert.equal(scrolled.id, 'gateway-controls', 'Retained hidden panels are not capture targets')
  assert.equal(detail.fullyVisible, true)
  assert.deepEqual(detail.controls.map(control => [control.name, control.disabled, control.fullyVisible]),
    [['Coding client', false, true], ['Stable public route alias', true, true]])
  width = 458
  const clipped = scrollSettingsDetail({ kind: 'gateway-connection-controls', readOnly: true })
  assert.equal(scrollCount, 1, 'Fresh evidence must not scroll a second time')
  assert.equal(clipped.fullyVisible, false)
  assert.ok(clipped.controls.every(control => !control.fullyVisible))
  document.querySelector('#gateway-controls').setAttribute('hidden', '')
  assert.equal(scrollSettingsDetail({ kind: 'gateway-connection-controls' }), null)
})

test('a missing or clipped fresh detail does not discard the diagnostic native PNG', async () => {
  for (const detail of [null, { fullyVisible: false }]) {
    let captures = 0
    const result = await captureReadySettingsDetail({ now: () => 0,
      position: async () => ({}), paintFrames: async () => {}, wait: async () => {},
      read: async () => detail, capture: async () => { captures++; return 'native bytes retained' }
    })
    assert.equal(captures, 1)
    assert.equal(result.detail, detail)
    assert.equal(result.pixels, 'native bytes retained')
  }
})

test('overlap uses visible scrollport intersections and still detects painted overlaps', async t => {
  const window = new JSDOM('<div id="root"><div class="ds-settings-surface"><nav><button id="nav">Navigation</button></nav><div class="ds-settings-scroller" style="overflow-x:hidden;overflow-y:hidden"><button id="clipped">Scrolled control</button></div></div></div>').window
  const { document } = window
  let navigationY = 0, scrolledY = 0
  const bounds = (x, y, width, height) => ({ x, y, width, height, right: x + width, bottom: y + height })
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id === 'nav') return bounds(0, navigationY, 40, 40)
    if (this.id === 'clipped') return bounds(0, scrolledY, 40, 40)
    if (this.id === 'fixed-host') return bounds(0, 0, 20, 20)
    if (this.id === 'fixed-control') return bounds(50, 50, 32, 32)
    if (this.classList.contains('ds-settings-scroller')) return bounds(0, 40, 100, 60)
    return bounds(0, 0, 100, 100)
  }
  window.HTMLElement.prototype.getClientRects = function () { return [this.getBoundingClientRect()] }
  window.HTMLElement.prototype.scrollIntoView = function () { if (this.id === 'clipped') scrolledY = 50 }
  document.elementFromPoint = (x, y) => [...document.querySelectorAll('button')].find(element => {
    const box = element.getBoundingClientRect()
    return x >= box.x && x <= box.right && y >= box.y && y <= box.bottom
  }) ?? null
  const globals = { document, getComputedStyle: window.getComputedStyle.bind(window),
    innerWidth: 100, innerHeight: 100, devicePixelRatio: 1 }
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key])
  }
  t.after(() => window.close())
  const page = { keyboard: { press: async () => undefined },
    locator: selector => ({ evaluateAll: async callback => callback([...document.querySelectorAll(selector)]) }),
    evaluate: async (callback, args) => callback(args) }
  const cdp = { send: async method => method === 'DOM.getDocument' ? { root: {} } : { nodes: [] } }
  const clipped = await measureSettings(page, cdp)
  assert.deepEqual(clipped.overlaps, [])
  assert.equal(clipped.controls.find(control => control.id === '1').originalVisible.y, 40)
  navigationY = 50
  scrolledY = 50
  const painted = await measureSettings(page, cdp)
  assert.equal(painted.overlaps.length, 1)
  const host = document.createElement('div')
  host.id = 'fixed-host'
  host.style.cssText = 'overflow-x:hidden;overflow-y:hidden'
  host.innerHTML = '<div style="position:fixed"><button id="fixed-control">Floating</button></div>'
  document.querySelector('.ds-settings-surface').append(host)
  const escaped = await measureSettings(page, cdp)
  assert.equal(escaped.controls.find(control => control.text === 'Floating').inside, true)
  host.style.transform = 'translateX(0)'
  const contained = await measureSettings(page, cdp)
  assert.equal(contained.controls.find(control => control.text === 'Floating').inside, false)
})

test('workflow keeps both native OSes, source baseline and failure evidence', () => {
  const workflow = readFileSync(new URL('../.github/workflows/settings-ui-smoke.yml', import.meta.url), 'utf8')
  assert.match(workflow, /os: \[windows-latest, macos-latest\]/)
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/)
  assert.match(workflow, /github\.event\.pull_request\.head\.sha/)
  assert.match(workflow, /9179a656e3b4236225cf098b00ccda932c55750d/)
  assert.match(workflow, /KUN_SETTINGS_SOURCE_ROOT: settings-ui-baseline/)
  assert.match(workflow, /KUN_SETTINGS_BASELINE_REPORT: dist\/settings-ui\/before\/report\.json/)
  assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact/)
  assert.match(workflow, /settings-ui-review-/)
  assert.match(workflow, /settings-ui-reports-/)
  const fixture = readFileSync(new URL('../src/renderer/src/components/SettingsUiSmokeFixture.tsx', import.meta.url), 'utf8')
  assert.match(fixture, /height: '100%'/)
  assert.doesNotMatch(fixture, /height: '100vh'/)
  const smoke = readFileSync(new URL('./smoke-settings-ui.mjs', import.meta.url), 'utf8')
  assert.match(smoke, /readOnly: true/)
  assert.match(smoke, /assert\.ok\(positionedDetail/)
  assert.match(smoke, /assert\.ok\(detail,/)
  assert.match(smoke, /assert\.ok\(detail\.fullyVisible/)
  assert.match(smoke, /\[data-gateway-connection-controls\]:visible/)
  assert.match(smoke, /assert\.equal\(detail\.controls\.length, 2/)
  assert.match(smoke, /detail\.controls\.every\(control => control\.fullyVisible\)/)
})

test('review artifact stays bounded, retains pairs and preserves complete gzip reports', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kun-settings-evidence-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const bytes = Buffer.alloc(1024 * 1024)
  for (const phase of ['before', 'after']) {
    await mkdir(join(source, phase), { recursive: true })
    for (let i = 0; i < 13; i++) await writeFile(join(source, phase,
      `${phase}-light-wide-125-category-${i}-landing.png`), bytes)
    await writeFile(join(source, phase, `${phase}-light-wide-150-subagents-3-subagent-settings-tab-profiles.png`), bytes)
    await writeFile(join(source, phase, `${phase}-light-small-200-providers-7-model-routes-settings-tab-monitoring.png`), bytes)
    await writeFile(join(source, phase, `${phase}-light-wide-125-general-landing-detail-general-switch.png`), bytes)
    await writeFile(join(source, phase, `${phase}-light-small-200-providers-7-model-routes-settings-tab-monitoring-detail-model-route-tabs.png`), bytes)
    await writeFile(join(source, phase, `${phase}-light-small-200-providers-6-provider-workspace-tab-routes-detail-gateway-connection-controls.png`), bytes)
    await writeFile(join(source, phase, 'report.json'), JSON.stringify({ phase, original: true }))
  }
  const result = spawnSync(process.execPath,
    [fileURLToPath(new URL('./prepare-settings-ui-evidence.mjs', import.meta.url))],
    { cwd: root, env: { ...process.env, KUN_SETTINGS_EVIDENCE: source }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(await readFile(join(root, 'dist/settings-ui-review/manifest.json'), 'utf8'))
  assert.ok(manifest.copiedBytes <= 24 * 1024 * 1024)
  assert.ok(manifest.omitted.length > 0)
  assert.ok(manifest.included.every(group => group.matchedBeforeAfter && group.files.length === 2))
  assert.ok(manifest.included.some(group => group.key.includes('subagent-settings-tab-profiles')))
  assert.ok(manifest.included.some(group => group.key.includes('model-routes-settings-tab-monitoring')))
  assert.ok(manifest.included.some(group => group.key.endsWith('-detail-general-switch.png')))
  assert.ok(manifest.included.some(group => group.key.endsWith('-detail-model-route-tabs.png')))
  assert.ok(manifest.included.some(group => group.key.endsWith('-detail-gateway-connection-controls.png')))
  const report = JSON.parse(gunzipSync(await readFile(join(root,
    'dist/settings-ui-reports/after/report.json.gz'))).toString())
  assert.deepEqual(report, { phase: 'after', original: true })
})

test('final polish fails for inherited overflow, clipping and small buttons too', () => {
  const layout = { key: 'light-small-200-subagents-profiles', ...measurement([
    control({ name: 'Toggle', tag: 'button', role: 'switch', reached: { height: 19.68 } }),
    control({ name: 'Add', inside: false })
  ]), scrollerOverflow: true }
  assert.equal(requiredPolishProblems([layout]).length, 3)
  assert.deepEqual(requiredPolishProblems([{ ...layout, scrollerOverflow: false,
    controls: [control({ name: 'Toggle', tag: 'button', role: 'switch', reached: { height: 26.24 } })]
  }]), [])
})
