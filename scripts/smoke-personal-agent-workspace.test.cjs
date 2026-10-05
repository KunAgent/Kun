'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { startWorkspaceBrowserPage, assertNativeRestartConsent } = require('./smoke-personal-agent-workspace.cjs')

test('browser fixture serves one isolated loopback document without remote dependencies', async (t) => {
  const fixture = await startWorkspaceBrowserPage()
  t.after(() => fixture.close())
  const url = new URL(fixture.url)
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/workspace-browser')
  assert.deepEqual(fixture.snapshot(), { pageRequests: 0 })
  const response = await fetch(fixture.url)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'")
  const body = await response.text()
  assert.match(body, /Personal workspace browser evidence/)
  assert.doesNotMatch(body, /<script|<iframe|<form|https?:\/\/|src=/i)
  assert.equal((await fetch(new URL('/outside', fixture.url))).status, 404)
  assert.equal((await fetch(fixture.url, { method: 'POST' })).status, 404)
  assert.deepEqual(fixture.snapshot(), { pageRequests: 1 })
})

const { collectWorkspaceFailureDiagnostics, redactWorkspaceDiagnostics } = require('./smoke-personal-workspace-diagnostics.cjs')

test('failure diagnostics retain actual browser state and matching run tool failures without unrelated reasoning or secrets', async () => {
  const paths = [], browserReads = []
  const execution = { roomId: 'room-test', runId: 'run-test', threadId: 'thread-test', turnId: 'turn-test' }
  const page = {
    locator: () => ({ evaluateAll: async () => [{ state: 'live', ...execution }] }),
    evaluate: async (_operation, identity) => { browserReads.push(identity); return {
      actual: { lifecycle: 'mount-required', threadId: identity.threadId, turnId: identity.turnId,
        pendingActionConsent: { previewDataUrl: 'data:image/png;base64,AAAA' } },
      expectedTurn: { lifecycle: 'closed' }
    } }
  }
  const request = async (_page, path) => {
    paths.push(path)
    if (path.endsWith('/direct')) return { execution, requests: [{ ...execution }], apiKey: 'never-keep-this' }
    if (path.includes('/items?')) return { items: [
      { kind: 'tool_call', toolName: 'browser_use', arguments: { action: 'open', url: 'http://127.0.0.1:1234/workspace-browser' } },
      { kind: 'tool_result', toolName: 'browser_use', isError: true, output: { code: 'mount_required', error: 'supervision missing', accessToken: 'secret-token' } },
      { kind: 'reasoning', text: 'Do not include model reasoning' }
    ] }
    return { run: execution }
  }
  const result = await collectWorkspaceFailureDiagnostics({ page, request, roomId: 'room-test', execution,
    fixture: { snapshot: () => ({ real: false, mainCalls: 3 }) }, website: { snapshot: () => ({ pageRequests: 0 }) } })
  assert.equal(paths.length, 3, 'Read the exact Room and one deduplicated run only')
  assert(paths.every((path) => path.startsWith('/v1/rooms/room-test/')))
  assert.deepEqual(browserReads, [{ threadId: 'thread-test', turnId: 'turn-test' }])
  assert.equal(result.runs[0].browser.value.actual.lifecycle, 'mount-required')
  assert.equal(result.runs[0].toolItems.value.items[1].output.code, 'mount_required')
  assert.equal(result.runs[0].toolItems.value.items.length, 2)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /never-keep-this|secret-token|Do not include model reasoning|base64,AAAA/)
  assert.match(serialized, /\[redacted\]/)
})

test('diagnostic redaction remains bounded and removes credentials nested in errors and results', () => {
  const result = redactWorkspaceDiagnostics({ managerToken: 'hidden', output: { credentials: ['a'],
    error: 'Authorization: Bearer abc.def-ghi', text: '{"apiKey":"hidden-value","ok":true}',
    long: 'a'.repeat(17000) }, image: 'data:image/png;base64,secret' })
  assert.equal(result.managerToken, '[redacted]')
  assert.equal(result.output.credentials, '[redacted]')
  assert.doesNotMatch(JSON.stringify(result), /hidden-value|abc.def-ghi|base64,secret/)
  assert(result.output.long.length < 17000)
})

const { dragSidebar, sidebarGeometryIssues } = require('./smoke-personal-agent-workspace-sidebar.cjs')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const bounds = (x, y, width, height) => ({ x, y, width, height, right: x + width, bottom: y + height })
const layout = () => ({ viewport: { width: 1360, height: 860 }, panel: bounds(752, 40, 560, 820),
  header: bounds(752, 40, 560, 44), surface: bounds(752, 84, 560, 776), rail: bounds(1312, 40, 48, 820),
  composer: bounds(310, 700, 430, 140), controls: [{ label: 'Take control', clipped: false }],
  selectedTabs: ['Preview'], selectedHeaderTabs: [{ label: 'Preview', rect: bounds(760, 46, 130, 32),
    tablist: bounds(760, 46, 500, 32) }], panelContainsSurface: true, surfaceOverflow: false })

test('sidebar geometry detects clipping, overlapping composer and content outside the Code-compatible shell', () => {
  assert.deepEqual(sidebarGeometryIssues(layout(), { docked: true }), [])
  const broken = layout()
  broken.surface = bounds(752, 84, 620, 800)
  broken.surfaceOverflow = true
  broken.panelContainsSurface = false
  broken.composer = bounds(310, 700, 800, 140)
  broken.controls.push({ label: 'View source conversation', clipped: true })
  broken.selectedTabs.push('Files')
  assert.deepEqual(sidebarGeometryIssues(broken, { docked: true }), [
    'surface extends outside the viewport', 'Active content is outside the shared right panel',
    'Active content overflows horizontally', 'Docked panel covers the conversation composer',
    'Clipped control: View source conversation', 'Exactly one shared header tab must be selected'
  ])
})

test('sidebar geometry records a narrow Code reference issue without weakening strict private checks', () => {
  const narrow = layout()
  narrow.viewport.width = 760
  const issues = sidebarGeometryIssues(narrow)
  assert(issues.includes('panel extends outside the viewport'))
  assert(issues.includes('rail extends outside the viewport'))
  assert(!issues.includes('Docked panel covers the conversation composer'))
  const source = readFileSync(join(__dirname, 'smoke-personal-agent-workspace-sidebar.cjs'), 'utf8')
  assert.match(source, /if \(strict\) assert\.deepEqual\(issues, \[\]/)
  assert.match(source, /strict \? 'private-agent' : 'code-baseline'/)
  assert.match(source, /header\.height - baseline\.header\.height/)
  assert.match(source, /rail\.width - baseline\.rail\.width/)
})

test('sidebar smoke uses real pointer input in both directions and captures the changed dimensions', async () => {
  let width = 560, dragging = false, lastX = 0
  const events = []
  const page = { mouse: {
    move: async (x, y, options) => {
      events.push(['move', x, y, options?.steps])
      if (dragging) width -= x - lastX
      lastX = x
    },
    down: async () => { dragging = true; events.push(['down']) },
    up: async () => { dragging = false; events.push(['up']) }
  } }
  const panel = { boundingBox: async () => bounds(1312 - width, 40, width, 820) }
  const handle = { boundingBox: async () => bounds(1303 - width, 40, 9, 820) }
  const result = await dragSidebar({ page, panel, handle,
    poll: async (check) => assert(await check()), capture: async (name) => events.push(['capture', name, width]),
    name: 'test-pointer-resized' })
  assert.equal(result.before.width, 560)
  assert.equal(result.after.width, 480)
  assert.equal(result.restored.width, 560)
  assert.deepEqual(events.filter(([kind]) => kind !== 'move'), [
    ['down'], ['up'], ['capture', 'test-pointer-resized', 480], ['down'], ['up']
  ])
  assert.equal(events.filter((event) => event[3] === 8).length, 2)
})

test('sidebar smoke releases the pointer after a failed drag instead of leaving the native window stuck', async () => {
  const events = []
  let moves = 0
  const page = { mouse: {
    move: async () => { if (++moves === 2) throw new Error('native move failed') },
    down: async () => events.push('down'), up: async () => events.push('up')
  } }
  const locator = { boundingBox: async () => bounds(400, 40, 560, 800) }
  await assert.rejects(dragSidebar({ page, panel: locator, handle: locator, poll: async () => {}, capture: async () => {} }),
    /native move failed/)
  assert.deepEqual(events, ['down', 'up'])
})

test('native comparison captures actual Code components first and returns to the private runtime flow without faking UI', () => {
  const helper = readFileSync(join(__dirname, 'smoke-personal-agent-workspace-sidebar.cjs'), 'utf8')
  const smoke = readFileSync(join(__dirname, 'smoke-personal-agent-workspace.cjs'), 'utf8')
  assert(smoke.indexOf('await captureCodeSidebarBaseline(') < smoke.indexOf('await openPrivate()'))
  assert.match(helper, /createThread\(\{ workspaceRoot: root, forceNew: true \}\)/)
  assert.match(helper, /name: 'Files', exact: true/)
  assert.match(helper, /name: 'Preview', exact: true/)
  assert.match(helper, /await file\.click\(\)/)
  assert.match(helper, /Code reference screenshots must not invoke the model/)
  assert.match(helper, /getBoundingClientRect\(\)/)
  assert.match(helper, /getComputedStyle\(ancestor\)/)
  for (const surface of ['files', 'file-preview', 'browser-controls']) {
    for (const size of ['wide', 'narrow']) assert(helper.includes(`sidebar-code-${surface}-${size}`))
  }
  for (const name of ['sidebar-private-saved-files-narrow', 'workspace-06-saved-artifact-preview-narrow',
    'workspace-11-real-origin-consent-narrow', 'sidebar-private-live-browser-narrow']) assert(smoke.includes(name))
  assert.match(smoke, /sidebarComparison: sidebar\.snapshot\(\)/)
  assert.doesNotMatch(helper, /force:\s*true|dispatchEvent\(|setContent\(|addStyleTag\(|setViewportSize\(|\.click\([^\n]*position/)
})

const { nativeBrowserGeometryIssues } = require('./smoke-personal-agent-workspace-sidebar.cjs')
test('native WebContentsView geometry must track its renderer host and remain inside the real window', () => {
  const value = { host: bounds(500.25, 130, 250, 570), native: { bounds: bounds(500, 130, 250, 570),
    zoomFactor: 1, contentBounds: { width: 760, height: 760 } } }
  assert.deepEqual(nativeBrowserGeometryIssues(value), [])
  value.native.bounds.width = 280
  assert.deepEqual(nativeBrowserGeometryIssues(value), [
    'Native browser width differs from the renderer host', 'Native browser view is clipped by its window'
  ])
  assert.deepEqual(nativeBrowserGeometryIssues({ host: null, native: null }), [
    'Native browser view or visible renderer host is missing'
  ])
})

const { waitForPrivateRoomSurface } = require('./smoke-personal-agent-workspace.cjs')
test('Rooms readiness waits for the rendered private recipient and its scoped controls before opening the sidebar', async () => {
  const events = []
  const root = '[data-room-surface="rooms"][data-private-chat="true"][data-room-id="room-current"]'
  const makeLocator = (selector) => ({
    waitFor: async (options) => events.push({ selector, options }),
    locator: (child) => makeLocator(selector + ' ' + child)
  })
  const page = { locator: makeLocator }
  await waitForPrivateRoomSurface(page, 'room-current')
  assert.deepEqual(events, [root, root + ' .rooms-composer .rooms-rich-input',
    root + ' .rooms-workbench-rail [data-room-tool="browser"]'].map((selector) => ({
    selector, options: { state: 'visible', timeout: 15000 }
  })))
  const smoke = readFileSync(join(__dirname, 'smoke-personal-agent-workspace.cjs'), 'utf8')
  const switchRoute = smoke.indexOf('    await switchRooms()')
  const ready = smoke.indexOf('await waitForPrivateRoomSurface(page, entry.roomId)', switchRoute)
  const open = smoke.indexOf('await openBrowser()', ready)
  assert(switchRoute >= 0 && ready > switchRoute && open > ready)
  assert.doesNotMatch(smoke.slice(switchRoute, ready), /roomsRoomId === entry\.roomId/)
  const renderer = readFileSync(join(__dirname, '../src/renderer/src/components/rooms/RoomsWorkspaceView.tsx'), 'utf8')
  assert.match(renderer, /data-room-id=\{room\?\.id\}/)
})

test('Rooms readiness surfaces the bounded wait failure without clicking or retrying another recipient', async () => {
  let lookups = 0
  const page = { locator: () => {
    lookups++
    return { waitFor: async (options) => {
      assert.equal(options.timeout, 15000)
      throw new Error('Expected rendered room did not appear')
    } }
  } }
  await assert.rejects(waitForPrivateRoomSurface(page, 'room-pending'), /Expected rendered room did not appear/)
  assert.equal(lookups, 1)
})

test('pointer resize reverses the original input at 0.82 UI density, not the scaled visual distance', async () => {
  let cssWidth = 560, dragging = false, lastX = 0
  const scale = 0.82, deltas = []
  const page = { mouse: {
    move: async (x) => {
      if (dragging) { deltas.push(x - lastX); cssWidth -= x - lastX }
      lastX = x
    },
    down: async () => { dragging = true }, up: async () => { dragging = false }
  } }
  const panel = { boundingBox: async () => bounds(1320 - cssWidth * scale, 0, cssWidth * scale, 677) }
  const handle = { boundingBox: async () => bounds(1320 - (cssWidth + 9) * scale, 0, 9 * scale, 677) }
  const result = await dragSidebar({ page, panel, handle,
    poll: async (check) => assert(await check()), capture: async () => {}, name: 'scaled-pointer-resize' })
  assert(Math.abs(result.before.width - 459.2) < 0.01)
  assert(Math.abs(result.after.width - 393.6) < 0.01)
  assert(Math.abs(result.restored.width - result.before.width) <= 2)
  assert.deepEqual(deltas, [80, -80])
})

const { createSidebarEvidence } = require('./smoke-personal-agent-workspace-sidebar.cjs')
test('native resize records actual narrow viewport when macOS clamps requested height to its desktop', async () => {
  const records = [], requests = []
  const actual = { width: 760, height: 677 }
  const page = { evaluate: async (operation) => operation.toString().includes('requestAnimationFrame') ? undefined : actual }
  const sidebar = createSidebarEvidence({ page, capture: async () => {},
    poll: async (check) => assert(await check()), resize: async (...size) => requests.push(size),
    recordDiagnostic: async (name, value) => records.push({ name, value: structuredClone(value) }) })
  await sidebar.resizeTo(760, 780)
  assert.deepEqual(requests, [[760, 780]])
  assert.deepEqual(sidebar.snapshot().viewports, [{ requested: { width: 760, height: 780 }, actual }])
  assert.deepEqual(records.at(-1).value.viewports, sidebar.snapshot().viewports)
})

const { nativeViewportMatchesRequested } = require('./smoke-personal-agent-workspace-sidebar.cjs')
test('OS height allowance preserves actual narrow breakpoint, width and positive bounded viewport checks', () => {
  const requested = { width: 760, height: 780 }
  assert.equal(nativeViewportMatchesRequested(requested, { width: 760, height: 677 }), true)
  assert.equal(nativeViewportMatchesRequested(requested, { width: 744, height: 677 }), true)
  for (const actual of [{ width: 768, height: 677 }, { width: 760, height: 0 },
    { width: 760, height: 781 }, { width: 1360, height: 677 }, { width: 760, height: NaN }]) {
    assert.equal(nativeViewportMatchesRequested(requested, actual), false)
  }
})

const { waitForCodeFileContents, dismissCodeFileExplorer } = require('./smoke-personal-agent-workspace-sidebar.cjs')
test('Code preview readiness requires exact rendered content and no busy indicator, rather than matching its filename', async () => {
  const preview = '[data-workbench-right-panel] .ds-code-sidebar'
  const states = [{ content: null, busy: 1 }, { content: 'baseline.txt', busy: 0 },
    { content: 'baseline\n', busy: 1 }, { content: 'baseline\n', busy: 0 }]
  let current = states[0]
  const page = { locator: (selector) => {
    if (selector === preview + ':visible .ds-file-preview-code-html pre code:visible') return {
      count: async () => current.content === null ? 0 : 1,
      innerText: async () => current.content
    }
    assert.equal(selector, preview + ':visible')
    return { locator: (child) => {
      assert.equal(child, '.animate-spin:visible, [aria-busy="true"]:visible')
      return { count: async () => current.busy }
    } }
  } }
  await waitForCodeFileContents({ page, preview, expected: 'baseline', poll: async (check, timeout) => {
    assert.equal(timeout, 15000)
    for (const state of states) { current = state; assert.equal(await check(), state === states.at(-1)) }
  } })
  const helper = readFileSync(join(__dirname, 'smoke-personal-agent-workspace-sidebar.cjs'), 'utf8')
  assert.equal(helper.match(/await waitForCodeFileContents\(\{ page, poll, preview, expected: 'baseline' \}\)/g)?.length, 2)
  assert.doesNotMatch(helper, /innerText\(\)\)\.includes\('baseline'\)/)
  const body = readFileSync(join(__dirname, '../src/renderer/src/components/WorkspaceFilePreviewBody.tsx'), 'utf8')
  assert.match(body, /className="ds-file-preview-code-html"/)
  assert.match(body, /loading && !officeResult\?\.ok/)
})

test('Code preview dismisses the real explorer through its uncovered hit-tested backdrop before capture', async () => {
  const events = []
  const explorer = { count: async () => 1, boundingBox: async () => bounds(800, 40, 260, 620),
    waitFor: async (options) => events.push(['hidden', options]) }
  const backdrop = { count: async () => 1, boundingBox: async () => bounds(800, 40, 450, 620),
    evaluate: async (_operation, point) => { events.push(['hit-test', point]); return true } }
  const panel = { locator: (selector) => selector === '.ds-file-preview-explorer:visible' ? explorer : backdrop }
  const page = { mouse: { click: async (x, y) => events.push(['click', x, y]) } }
  await dismissCodeFileExplorer({ page, panel })
  assert.deepEqual(events, [['hit-test', { x: 1246, y: 350 }], ['click', 1246, 350],
    ['hidden', { state: 'hidden', timeout: 15000 }]])
  const helper = readFileSync(join(__dirname, 'smoke-personal-agent-workspace-sidebar.cjs'), 'utf8')
  for (const size of ['wide', 'narrow']) assert.match(helper, new RegExp(
    "await waitForCodeFileContents[^\\n]+\\n  await dismissCodeFileExplorer[^\\n]+\\n  await sidebar.codeCapture\\('sidebar-code-file-preview-" + size))
})

const { readSidebarGeometry } = require('./smoke-personal-agent-workspace-sidebar.cjs')
const { JSDOM } = require('jsdom')
test('measured selected Code-header tab must fit its strip; inactive and nested file tabs remain exempt', async (t) => {
  const dom = new JSDOM('<div id="panel"><div class="ds-code-right-tabs" id="header">' +
    '<div role="tablist" id="strip"><button role="tab" aria-selected="false" id="inactive">Preview</button>' +
    '<button role="tab" aria-selected="true" id="active">workspace-evidence.txt</button></div></div>' +
    '<div id="surface"><div role="tablist"><button role="tab" aria-selected="true" id="nested">Nested file</button></div></div>' +
    '</div><div id="rail"></div><div id="composer"></div>', { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  Object.assign(dom.window, { innerWidth: 1360, innerHeight: 860 })
  const place = (id, rect) => {
    dom.window.document.getElementById(id).getBoundingClientRect = () => ({ ...rect, left: rect.x, top: rect.y })
  }
  for (const [id, rect] of Object.entries({ panel: bounds(752, 40, 560, 820), header: bounds(752, 40, 560, 44),
    strip: bounds(760, 46, 200, 32), surface: bounds(752, 84, 560, 776), rail: bounds(1312, 40, 48, 820),
    composer: bounds(310, 700, 430, 140), active: bounds(966, 46, 180, 32),
    inactive: bounds(600, 46, 130, 32), nested: bounds(1500, 100, 180, 32) })) place(id, rect)
  const page = { evaluate: async (operation, args) => dom.window.eval('(' + operation.toString() + ')')(args) }
  const selectors = { panel: '#panel', rail: '#rail', surface: '#surface', composer: '#composer' }
  const clipped = await readSidebarGeometry(page, selectors)
  assert.deepEqual([...clipped.selectedTabs], ['workspace-evidence.txt'])
  assert.equal(clipped.selectedHeaderTabs[0].rect.x, 966)
  assert.equal(clipped.selectedHeaderTabs[0].tablist.right, 960)
  assert.deepEqual(sidebarGeometryIssues(clipped, { docked: true }), [
    'Selected header tab is clipped by its tablist: workspace-evidence.txt'
  ])
  place('active', bounds(760, 46, 180, 32))
  assert.deepEqual(sidebarGeometryIssues(await readSidebarGeometry(page, selectors), { docked: true }), [])
})

const { readRecoveryToolbarGeometry, recoveryToolbarGeometryIssues } = require('./smoke-personal-agent-workspace-sidebar.cjs')
test('measured recovery actions catch clipped model settings and horizontal overflow within the exact private room', async (t) => {
  const dom = new JSDOM('<div data-rooms-workspace data-private-chat="true" data-room-id="room-current" id="workspace">' +
    '<section id="container"><div class="direct-progress" id="progress"><div class="direct-failed" id="notice">' +
    '<span class="direct-failed-actions" id="toolbar"><button id="view">View Agent session</button>' +
    '<button id="retry">Retry request</button><button id="models">Model settings</button></span></div></div></section></div>',
  { runScripts: 'outside-only' })
  t.after(() => dom.window.close())
  Object.assign(dom.window, { innerWidth: 760, innerHeight: 677 })
  const place = (id, rect) => {
    const element = dom.window.document.getElementById(id)
    element.getBoundingClientRect = () => ({ ...rect, left: rect.x, top: rect.y })
    Object.defineProperties(element, { clientWidth: { value: rect.width, configurable: true },
      scrollWidth: { value: rect.width, configurable: true } })
  }
  for (const [id, rect] of Object.entries({ workspace: bounds(180, 0, 580, 677), container: bounds(180, 0, 380, 677),
    progress: bounds(180, 430, 380, 100), notice: bounds(192, 434, 356, 88), toolbar: bounds(210, 464, 325, 48),
    view: bounds(210, 464, 130, 24), retry: bounds(350, 464, 95, 24), models: bounds(454, 464, 105, 24) })) place(id, rect)
  const page = { locator: (selector) => {
    assert.equal(selector, '[data-rooms-workspace][data-private-chat="true"][data-room-id="room-current"]:visible .direct-progress')
    return { getByRole: (role, options) => {
      assert.equal(role, 'button'); assert.deepEqual(options, { name: 'Model settings', exact: true })
      return { waitFor: async (options) => assert.deepEqual(options, { state: 'visible', timeout: 15000 }) }
    }, evaluate: async (operation) => dom.window.eval('(' + operation.toString() + ')')(dom.window.document.getElementById('progress')) }
  } }
  const clipped = await readRecoveryToolbarGeometry(page, 'room-current')
  assert.equal(clipped.roomId, 'room-current')
  assert(recoveryToolbarGeometryIssues(clipped).includes('Recovery action outside notice: Model settings'))
  assert(recoveryToolbarGeometryIssues(clipped).includes('Recovery action outside toolbar: Model settings'))
  place('models', bounds(210, 490, 105, 22))
  assert.deepEqual(recoveryToolbarGeometryIssues(await readRecoveryToolbarGeometry(page, 'room-current')), [])
  Object.defineProperty(dom.window.document.getElementById('progress'), 'scrollWidth', { value: 450 })
  assert(recoveryToolbarGeometryIssues(await readRecoveryToolbarGeometry(page, 'room-current'))
    .includes('Recovery progress overflows horizontally'))
})

test('native smoke measures stopped and restart recovery controls wide and narrow without retrying the request', () => {
  const smoke = readFileSync(join(__dirname, 'smoke-personal-agent-workspace.cjs'), 'utf8')
  for (const name of ['workspace-16-stopped-browser-detached', 'workspace-16b-stopped-recovery-narrow',
    'workspace-18-restart-recovery-no-replay', 'workspace-18b-restart-recovery-narrow']) {
    assert(smoke.includes(`await sidebar.recoveryCapture('${name}', entry.roomId)`))
  }
  assert.match(smoke, /Inspecting recovery controls must not replay the request/)
  const helper = readFileSync(join(__dirname, 'smoke-personal-agent-workspace-sidebar.cjs'), 'utf8')
  const recovery = helper.slice(helper.indexOf('async function readRecoveryToolbarGeometry'), helper.indexOf('function nativeBrowserGeometryIssues'))
  assert.doesNotMatch(recovery, /\.click\(|dispatchEvent\(|force:/)
})

test('recovery action row wins span flex specificity and wraps labels within its container', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/src/components/rooms/rooms-direct.css'), 'utf8')
  const row = css.match(/\.direct-failed\s*>\s*\.direct-failed-actions\s*\{([^}]+)\}/)?.[1]
  assert(row, 'Action row must have greater specificity than .direct-failed > span')
  assert.match(row, /flex:\s*1 1 100%/)
  assert.match(row, /flex-wrap:\s*wrap/)
  assert.match(row, /min-width:\s*0/)
  assert.match(row, /max-width:\s*100%/)
  const buttons = css.match(/\.direct-failed-actions button\s*\{([^}]+)\}/)?.[1]
  assert.match(buttons, /white-space:\s*normal/)
  assert.match(buttons, /overflow-wrap:\s*anywhere/)
})

test('restart consent inspection retries only one transient read while the Electron owner is alive', async () => {
  let reads = 0
  const app = { process: () => ({ exitCode: null, signalCode: null }), evaluate: async () => {
    if (++reads === 1) throw new Error('Execution context was destroyed, most likely because of a navigation.')
    return 1
  } }
  await assertNativeRestartConsent(app)
  assert.equal(reads, 2)
})

test('restart consent inspection still fails missing/repeated consent, persistent context loss, and owner exit', async () => {
  for (const count of [0, 2, undefined]) {
    await assert.rejects(assertNativeRestartConsent({ evaluate: async () => count }), /confirmed exactly once/)
  }
  let reads = 0
  const contextError = new Error('Execution context was destroyed')
  const app = { process: () => ({ exitCode: null, signalCode: null }), evaluate: async () => { reads++; throw contextError } }
  await assert.rejects(assertNativeRestartConsent(app), /Execution context was destroyed/)
  assert.equal(reads, 2)
  for (const state of [{ exitCode: 0, signalCode: null }, { exitCode: null, signalCode: 'SIGTERM' }]) {
    reads = 0
    await assert.rejects(assertNativeRestartConsent({ ...app, process: () => state }), /Execution context was destroyed/)
    assert.equal(reads, 1)
  }
  reads = 0
  await assert.rejects(assertNativeRestartConsent({ ...app, evaluate: async () => { reads++; throw new Error('Other failure') } }), /Other failure/)
  assert.equal(reads, 1)
})

test('approval smoke asserts the personal default and deliberately changes it through protected UI', async () => {
  const { prepareWorkspaceApprovalMode } = require('./smoke-personal-agent-workspace.cjs')
  const actions = [], reads = []
  let mode = 'full-access'
  const control = (name) => ({ waitFor: async () => actions.push('wait:' + name),
    click: async () => { actions.push('click:' + name); if (name === 'Apply settings') mode = 'ask-for-approval' } })
  const picker = { locator: (selector) => control(selector), getByRole: (_role, { name }) => control(name) }
  const page = { locator: (selector) => selector === '.room-permission-picker' ? picker : control(selector) }
  const consent = { getByRole: (_role, { name }) => control(name), evaluate: async () => false }
  await prepareWorkspaceApprovalMode({ page, roomId: 'personal',
    application: { waitForEvent: async (name) => { actions.push('event:' + name); return consent } },
    request: async (_page, path) => { reads.push(path); return { mode } },
    poll: async (predicate) => assert(await predicate()), capture: async (name) => actions.push('capture:' + name) })
  assert(reads.every((path) => path === '/v1/rooms/personal/direct/permissions'))
  assert(actions.indexOf('event:window') < actions.indexOf('click:[role="menuitemradio"][data-permission-mode="ask-for-approval"]'))
  assert(actions.includes('click:Apply settings'))
  assert.equal(mode, 'ask-for-approval')
  assert(actions.includes('wait:[data-permission-mode="full-access"]'))
  assert(actions.includes('wait:[data-permission-mode="ask-for-approval"]'))
})
