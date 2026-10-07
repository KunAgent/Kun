'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const source = (name) => readFileSync(join(__dirname, name), 'utf8')

test('Agent model smoke uses the proven private launcher and rejects real model mode before startup', () => {
  const launcher = source('smoke-development-direct-chat.cjs')
  assert.match(launcher, /require\('\.\/smoke-agent-model-controls\.cjs'\)/)
  assert.match(launcher, /--agent-models-only'\) \? exerciseAgentModelControls/)
  assert.match(launcher, /--agent-models-only'\) && process\.argv\.includes\('--real-model'\)/)
  assert(launcher.indexOf('Agent model controls evidence must stay offline') < launcher.indexOf('modelFixture = await startDirectModel'))
  assert.match(launcher, /withTimeout\(exercised, 180_000, 'exercising the offline Agent model controls'\)/)
  assert.match(launcher, /chromiumSandbox: true/)
  assert.doesNotMatch(source('smoke-development-rooms.cjs'), /--agent-models-only/)
})

test('Agent model scenario waits for exact private identity and captures the loaded directory before configuring', () => {
  const scenario = source('smoke-agent-model-controls.cjs')
  const opened = scenario.indexOf('await waitCodeConversation(page, poll, entry.roomId, initialAgent.name)')
  assert(scenario.indexOf('await openPrivate()') < opened)
  assert.match(scenario, /entry\.initialized && entry\.agentId && entry\.roomId/)
  assert.match(source('smoke-agent-chat-workbench.cjs'), /state\.route === 'agent-chat' && state\.conversationRoomId === roomId/)
  assert(opened < scenario.indexOf("await entryRow.getAttribute('aria-current') === 'page'"))
  assert(scenario.indexOf('await waitCodeConversation(page, poll, current.id, created.name)') < scenario.indexOf('await picker.selectOption'))
  assert.doesNotMatch(scenario, /switchRooms|rooms-im-sidebar|data-room-surface="rooms"/)
  const loaded = scenario.indexOf('await overviewRow.getByText(roleLabel, { exact: true }).waitFor()')
  const captured = scenario.indexOf("await capture('agent-models-manager-overview')")
  assert(loaded > 0 && captured > loaded && scenario.indexOf('await configure.click()') > captured)
  assert.match(scenario, /getByRole\('region', \{ name: 'Room details', exact: true \}\)/)
  assert.match(scenario, /newChat\.locator\('\.direct-start-group'\)/)
  assert.doesNotMatch(scenario, /getByRole\('heading'|force:\s*true|--real-model/)
})

const { assertPrimaryGroupGeometry } = require('./smoke-agent-model-controls.cjs')
const primaryGeometry = (bodyZoom = 1) => ({ bodyZoom, layoutHeight: 44, visible: true, clippedBy: [],
  rect: { left: 100, top: 200, right: 100 + 200 * bodyZoom, bottom: 200 + 44 * bodyZoom, width: 200 * bodyZoom, height: 44 * bodyZoom },
  viewport: { width: 1360, height: 900 }, background: 'rgb(91, 120, 255)', color: 'rgb(255, 255, 255)' })

for (const zoom of [.82, 1]) test(`primary group button preserves the 44 CSS px requirement at body zoom ${zoom}`, () => {
  const measured = primaryGeometry(zoom)
  assert.equal(assertPrimaryGroupGeometry(measured).normalizedHeight, 44)
  if (zoom < 1) assert(measured.rect.height < 44, 'Viewport pixels differ from the product layout requirement')
  measured.rect.height -= .04 * zoom
  assert.doesNotThrow(() => assertPrimaryGroupGeometry(measured), 'Subpixel layout rounding remains bounded')
})

test('primary group button rejects undersized layout and zoom-normalized height independently', () => {
  for (const zoom of [.82, 1]) {
    const smallLayout = primaryGeometry(zoom); smallLayout.layoutHeight = 43
    assert.throws(() => assertPrimaryGroupGeometry(smallLayout), /44 layout CSS px/)
    const smallVisual = primaryGeometry(zoom); smallVisual.rect.height = 43 * zoom
    assert.throws(() => assertPrimaryGroupGeometry(smallVisual), /Zoom-normalized/)
  }
})

test('primary group button rejects hidden, zero-sized, clipped and offscreen rendering', () => {
  const hidden = primaryGeometry(.82); hidden.visible = false
  assert.throws(() => assertPrimaryGroupGeometry(hidden), /visibly rendered/)
  const zero = primaryGeometry(); zero.rect.width = 0
  assert.throws(() => assertPrimaryGroupGeometry(zero), /positive dimensions/)
  const clipped = primaryGeometry(); clipped.clippedBy = ['DIALOG.rooms-init-dialog']
  assert.throws(() => assertPrimaryGroupGeometry(clipped), /clipped by its ancestors/)
  const offscreen = primaryGeometry(); offscreen.rect.right = offscreen.viewport.width + 10
  assert.throws(() => assertPrimaryGroupGeometry(offscreen), /inside the visual viewport/)
})

test('primary group button rejects transparent or indistinguishable foreground/background', () => {
  for (const background of ['transparent', 'rgba(0, 0, 0, 0)', 'rgb(0 0 0 / 0%)']) {
    assert.throws(() => assertPrimaryGroupGeometry({ ...primaryGeometry(), background }), /nontransparent/)
  }
  const same = primaryGeometry(); same.color = same.background
  assert.throws(() => assertPrimaryGroupGeometry(same), /foreground differs/)
  assert.throws(() => assertPrimaryGroupGeometry({ ...primaryGeometry(), color: 'transparent' }), /nontransparent/)
})

test('native primary-button screenshot and geometry are retained before validation', () => {
  const scenario = source('smoke-agent-model-controls.cjs')
  assert.match(scenario, /import\('\/src\/lib\/body-zoom\.ts'\)/)
  const captured = scenario.indexOf("await capture('agent-models-group-primary')")
  const diagnostic = scenario.indexOf("await recordDiagnostic?.('agent-models-group-primary-geometry', appearance)")
  const checked = scenario.indexOf('assertPrimaryGroupGeometry(appearance)')
  assert(captured > 0 && diagnostic > captured && checked > diagnostic)
  assert.match(scenario, /groupPrimaryGeometry: appearance/)
})
