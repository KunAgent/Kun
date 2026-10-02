import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { beginSettingsPaintProbe, sampleSettingsPaintProbe, endSettingsPaintProbe } from './settings-ui-paint-probe-dom.mjs'

// Synthetic layout and jsdom test callback behavior only, never native pixels,
// compositor timing, CDP screenshots, or actual browser geometry.
function fixture(t, html = '') {
  const window = new JSDOM(`<!doctype html><html><body>
    <aside id="unrelated"><span>Elsewhere</span></aside>
    <div hidden><div role="tablist"><button role="tab" id="model-routes-settings-tab-retained">Retained</button></div></div>
    <main id="settings" style="overflow-x:hidden;overflow-y:auto">
      <section id="route-host"><div id="routes" role="tablist" aria-label="Model routing" style="overflow-x:auto;opacity:1;background-color:rgb(10, 20, 30)">
        <button id="model-routes-settings-tab-gateway" role="tab" aria-selected="true" style="color:rgb(1, 2, 3)"><span id="label">Gateway</span></button>
        <button id="model-routes-settings-tab-models" role="tab" aria-selected="false">Models</button>
      </div>${html}</section>
    </main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true }).window
  t.after(() => {
    window.__kunSettingsPaintProbe?.disconnect()
    window.close()
  })
  const boxes = new WeakMap()
  const makeRect = (x, y, width, height) => ({ x, y, left: x, top: y,
    right: x + width, bottom: y + height, width, height })
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return boxes.get(this) ?? makeRect(10, 20, 300, 32)
  }
  window.HTMLElement.prototype.getClientRects = function () {
    const box = this.getBoundingClientRect()
    return box.width && box.height ? [box] : []
  }
  window.HTMLElement.prototype.scrollIntoView = () => { throw new Error('Probe must not scroll') }
  window.HTMLElement.prototype.focus = () => { throw new Error('Probe must not focus') }
  const dimension = (element, values) => {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(element, key, { configurable: true, value })
    }
  }
  const document = window.document
  const settings = document.querySelector('#settings')
  dimension(settings, { clientWidth: 400, clientHeight: 200, scrollWidth: 640, scrollHeight: 1200 })
  boxes.set(settings, makeRect(0, 10, 400, 200))
  const tabstrip = document.querySelector('#routes')
  dimension(tabstrip, { clientWidth: 300, clientHeight: 32, scrollWidth: 480, scrollHeight: 32 })
  // eval in the target realm proves the exported functions survive serialization
  // without module imports, Node globals, or closure helpers.
  const serialize = callback => window.eval(`(${callback.toString()})`)
  const call = callback => options => JSON.parse(JSON.stringify(callback(options)))
  return { window, document, settings, tabstrip, boxes, makeRect, dimension,
    begin: call(serialize(beginSettingsPaintProbe)),
    sample: call(serialize(sampleSettingsPaintProbe)),
    end: call(serialize(endSettingsPaintProbe)),
    flush: () => new Promise(resolve => window.setTimeout(resolve, 0)) }
}

test('serialized callbacks passively capture the actual tabstrip and DOM identities', t => {
  const f = fixture(t)
  const html = f.document.documentElement.outerHTML
  const external = new f.window.MutationObserver(() => {})
  external.observe(f.document, { subtree: true, childList: true, attributes: true, characterData: true })
  t.after(() => external.disconnect())
  const initial = f.begin()
  assert.equal(initial.target.state, 'same')
  assert.equal(initial.tabstrip.id, 'routes')
  assert.equal(initial.tabstrip.role, 'tablist')
  assert.equal(initial.tabstrip.children.find(child => child.id?.includes('gateway')).nodeId,
    initial.tabstrip.tabs[0].nodeId)
  assert.equal(initial.tabstrip.tabs[0].selected, 'true')
  assert.equal(initial.tabstrip.tabs[1].selected, 'false')
  assert.equal(initial.tabstrip.tabs[0].color, 'rgb(1, 2, 3)')
  assert.equal(initial.tabstrip.backgroundColor, 'rgb(10, 20, 30)')
  assert.equal(initial.tabstrip.opacity, '1')
  assert.ok(initial.tabstrip.textNodes.some(node => node.text === 'Gateway'))
  assert.equal(initial.tabstrip.descendants.find(node => node.id === 'label').text, 'Gateway')
  assert.equal(initial.document.visibilityState, 'visible')
  assert.equal(initial.document.hidden, false)
  assert.equal(typeof initial.document.hasFocus, 'boolean')
  assert.ok(Number.isFinite(initial.sampledAt.performanceMs))
  assert.ok(Number.isFinite(initial.sampledAt.timeOriginMs))
  const next = f.sample({ label: 'before-native-capture' })
  assert.equal(next.label, 'before-native-capture')
  assert.equal(next.target.currentNodeId, initial.target.currentNodeId)
  assert.deepEqual(next.tabstrip.tabs.map(tab => tab.nodeId), initial.tabstrip.tabs.map(tab => tab.nodeId))
  assert.equal(next.mutations.document, 0)
  f.end()
  assert.equal(f.document.documentElement.outerHTML, html)
  assert.deepEqual(external.takeRecords(), [])
})

test('asynchronous text, child, and attribute mutations retain records and identity', async t => {
  const f = fixture(t)
  const initial = f.begin()
  const label = f.document.querySelector('#label')
  await Promise.resolve()
  label.firstChild.data = 'Gateway delayed'
  label.setAttribute('aria-hidden', 'true')
  const tab = f.tabstrip.querySelector('button')
  tab.setAttribute('aria-selected', 'false')
  const badge = f.document.createElement('span')
  badge.textContent = 'Pending'
  tab.append(badge)
  await f.flush()
  const snapshot = f.sample({ label: 'after-async-update' })
  assert.equal(snapshot.target.currentNodeId, initial.target.currentNodeId)
  assert.equal(snapshot.tabstrip.tabs[0].nodeId, initial.tabstrip.tabs[0].nodeId)
  assert.equal(snapshot.tabstrip.tabs[0].selected, 'false')
  assert.match(snapshot.tabstrip.tabs[0].text, /Gateway delayedPending/)
  assert.equal(snapshot.mutations.relevant, 4)
  assert.deepEqual(snapshot.mutations.byType, { characterData: 1, attributes: 2, childList: 1 })
  assert.equal(snapshot.mutations.byAttribute['aria-selected'], 1)
  const textEvent = snapshot.mutations.events.find(event => event.type === 'characterData')
  assert.equal(textEvent.oldValue, 'Gateway')
  assert.equal(textEvent.valueAtObservation, 'Gateway delayed')
  assert.equal(textEvent.target.nodeId, initial.tabstrip.textNodes.find(node => node.text === 'Gateway').nodeId)
  for (const event of snapshot.mutations.events) {
    assert.equal(event.source, 'observer-delivery')
    assert.ok(event.observedAt.performanceMs >= initial.started.performanceMs)
    assert.ok(event.observedAt.performanceMs <= snapshot.sampledAt.performanceMs)
    assert.ok(event.batchId > 0)
  }
  assert.match(snapshot.mutations.timestampMeaning, /no occurrence timestamp/)
})

test('pending records are drained synchronously without inventing intermediate attribute values', t => {
  const f = fixture(t)
  f.begin()
  const tab = f.tabstrip.querySelector('button')
  tab.setAttribute('aria-selected', 'false')
  tab.setAttribute('aria-selected', 'true')
  const snapshot = f.sample()
  assert.equal(snapshot.mutations.relevant, 2)
  assert.deepEqual(snapshot.mutations.events.map(event => event.oldValue), ['true', 'false'])
  assert.deepEqual(snapshot.mutations.events.map(event => event.valueAtObservation), ['true', 'true'])
  assert.ok(snapshot.mutations.events.every(event => event.source === 'take-records'))
  assert.equal(f.sample().mutations.relevant, 2)
})

test('ancestor style and horizontal scroll chains are captured while unrelated changes are filtered', async t => {
  const f = fixture(t)
  f.begin()
  f.settings.scrollTop = 415
  f.settings.scrollLeft = 17
  f.tabstrip.scrollLeft = 53
  assert.equal(f.sample().mutations.relevant, 0, 'scroll offsets are not DOM mutations')
  f.settings.style.opacity = '0.35'
  f.settings.style.overflowX = 'clip'
  f.document.querySelector('#unrelated span').textContent = 'Other update'
  f.document.querySelector('#unrelated').setAttribute('data-noise', 'unrelated')
  f.document.body.append(f.document.createElement('aside'))
  await f.flush()
  const snapshot = f.sample()
  assert.equal(snapshot.mutations.document, 5)
  assert.equal(snapshot.mutations.relevant, 2)
  assert.equal(snapshot.mutations.ignored, 3)
  assert.equal(snapshot.mutations.byAttribute.style, 2)
  const ancestor = snapshot.tabstrip.ancestorChain.find(node => node.id === 'settings')
  assert.equal(ancestor.opacity, '0.35')
  assert.deepEqual(ancestor.clipAxes, { x: true, y: true })
  assert.deepEqual(ancestor.clientBox, { left: 0, top: 10, right: 400, bottom: 210 })
  assert.ok(snapshot.tabstrip.ancestorClips.some(node => node.nodeId === ancestor.nodeId))
  assert.equal(snapshot.tabstrip.scrollChain[0].left, 53)
  assert.equal(snapshot.tabstrip.scrollChain.find(node => node.nodeId === ancestor.nodeId).left, 17)
  assert.equal(snapshot.tabstrip.scrollChain.find(node => node.nodeId === ancestor.nodeId).top, 415)
})

test('replacement with the same HTML IDs exposes different nodes and detached original contents', async t => {
  const f = fixture(t)
  const initial = f.begin()
  const replacement = f.tabstrip.cloneNode(true)
  f.tabstrip.replaceWith(replacement)
  replacement.querySelector('#label').textContent = 'Replacement'
  await f.flush()
  const replaced = f.sample()
  assert.equal(replaced.target.state, 'replaced')
  assert.equal(replaced.target.initialConnected, false)
  assert.equal(replaced.target.currentConnected, true)
  assert.equal(replaced.tabstrip.id, replaced.originalTabstrip.id)
  assert.notEqual(replaced.target.currentNodeId, initial.target.currentNodeId)
  assert.equal(replaced.originalTabstrip.nodeId, initial.tabstrip.nodeId)
  assert.equal(replaced.originalTabstrip.tabs[0].nodeId, initial.tabstrip.tabs[0].nodeId)
  assert.equal(replaced.originalTabstrip.connected, false)
  assert.match(replaced.tabstrip.tabs[0].text, /Replacement/)
  assert.match(replaced.originalTabstrip.tabs[0].text, /Gateway/)
  assert.equal(replaced.mutations.relevant, 2)
  const removal = replaced.mutations.events.find(event => event.removedCount > 0)
  assert.equal(removal.removedNodes[0].nodeId, initial.target.currentNodeId)
  assert.equal(removal.addedNodes[0].nodeId, replaced.target.currentNodeId)
  replacement.remove()
  const detached = f.sample()
  assert.equal(detached.target.state, 'detached')
  assert.equal(detached.tabstrip, null)
  assert.equal(detached.originalTabstrip.nodeId, initial.target.currentNodeId)
  assert.equal(detached.mutations.relevant, 3)
})

test('removing an entire containing subtree preserves target and ancestor mutation evidence', t => {
  const f = fixture(t)
  const initial = f.begin()
  f.settings.remove()
  const detached = f.sample()
  assert.equal(detached.target.state, 'detached')
  assert.equal(detached.target.initialConnected, false)
  assert.equal(detached.originalTabstrip.nodeId, initial.tabstrip.nodeId)
  assert.ok(detached.originalTabstrip.ancestorChain.some(node => node.id === 'settings'))
  assert.equal(detached.mutations.relevant, 1)
  assert.equal(detached.mutations.events[0].removedNodes[0].id, 'settings')
})

test('hidden, transparent, zero-rect tabs and changed document visibility remain diagnostic evidence', t => {
  const f = fixture(t)
  const initial = f.begin()
  const tab = f.tabstrip.querySelector('button')
  tab.hidden = true
  tab.style.visibility = 'hidden'
  tab.style.opacity = '0'
  f.boxes.set(tab, f.makeRect(0, 0, 0, 0))
  f.tabstrip.hidden = true
  Object.defineProperty(f.document, 'visibilityState', { configurable: true, value: 'hidden' })
  Object.defineProperty(f.document, 'hidden', { configurable: true, value: true })
  f.document.hasFocus = () => false
  const snapshot = f.sample()
  assert.equal(snapshot.target.currentNodeId, initial.target.currentNodeId)
  assert.equal(snapshot.tabstrip.hidden, true)
  assert.equal(snapshot.tabstrip.tabs[0].hidden, true)
  assert.equal(snapshot.tabstrip.tabs[0].visibility, 'hidden')
  assert.equal(snapshot.tabstrip.tabs[0].opacity, '0')
  assert.equal(snapshot.tabstrip.tabs[0].rect.width, 0)
  assert.deepEqual(snapshot.tabstrip.tabs[0].clientRects, [])
  assert.ok(snapshot.tabstrip.tabs[0].hiddenReasons.some(reason => reason.nodeId === snapshot.tabstrip.nodeId))
  assert.equal(snapshot.document.visibilityState, 'hidden')
  assert.equal(snapshot.document.hidden, true)
  assert.equal(snapshot.document.hasFocus, false)
})

test('log caps preserve total/type/attribute counts and bound strings and added node lists', t => {
  const f = fixture(t)
  f.begin({ maxEvents: 3 })
  const tab = f.tabstrip.querySelector('button')
  for (let index = 0; index < 25; index++) tab.setAttribute('data-count', String(index))
  const snapshot = f.sample()
  assert.equal(snapshot.mutations.document, 25)
  assert.equal(snapshot.mutations.relevant, 25)
  assert.equal(snapshot.mutations.dropped, 22)
  assert.equal(snapshot.mutations.byType.attributes, 25)
  assert.equal(snapshot.mutations.byAttribute['data-count'], 25)
  assert.equal(snapshot.mutations.events.length, 3)
  assert.deepEqual(snapshot.mutations.events.map(event => event.sequence), [1, 2, 3])
  f.begin({ maxEvents: 1 })
  const fragment = f.document.createDocumentFragment()
  for (let index = 0; index < 30; index++) {
    const span = f.document.createElement('span')
    span.textContent = 'x'.repeat(2000)
    fragment.append(span)
  }
  tab.append(fragment)
  const event = f.sample().mutations.events[0]
  assert.equal(event.addedCount, 30)
  assert.equal(event.addedNodes.length, 20)
  assert.equal(event.nodeListsTruncated, true)
  assert.equal(event.addedNodes[0].text.length, 1024)
  assert.ok(event.target.text.length <= 1024)
})

test('zero-log mode, restart, end cleanup, and absent targets have explicit behavior', async t => {
  const f = fixture(t)
  f.begin({ maxEvents: 0 })
  const firstProbe = f.window.__kunSettingsPaintProbe
  f.tabstrip.setAttribute('data-first', '1')
  const final = f.end({ label: 'last-frame' })
  assert.equal(final.label, 'last-frame')
  assert.equal(final.mutations.relevant, 1)
  assert.equal(final.mutations.dropped, 1)
  assert.equal(final.mutations.events.length, 0)
  assert.equal(f.window.__kunSettingsPaintProbe, undefined)
  f.tabstrip.setAttribute('data-after-end', '1')
  await f.flush()
  assert.equal(firstProbe.sample().mutations.relevant, 1)
  assert.equal(firstProbe.sample().stopped, true)
  assert.equal(f.end(), null)
  assert.throws(() => f.sample(), /has not been started/)
  f.begin()
  const oldProbe = f.window.__kunSettingsPaintProbe
  f.begin()
  f.tabstrip.setAttribute('data-new-probe', '1')
  await f.flush()
  assert.equal(oldProbe.sample().mutations.relevant, 0)
  assert.equal(oldProbe.sample().stopped, true)
  assert.equal(f.sample().mutations.relevant, 1)
  f.end()
  f.tabstrip.remove()
  const missing = f.begin()
  assert.equal(missing.target.state, 'missing')
  assert.equal(missing.tabstrip, null)
  f.settings.append(f.tabstrip)
  assert.equal(f.sample().target.state, 'appeared')
})
