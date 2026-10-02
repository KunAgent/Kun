'use strict'
const assert = require('node:assert/strict')
const { roomWorkbenchSnapshot } = require('./smoke-agent-chat-workbench.cjs')

const CODE = { panel: '[data-workbench-right-panel]', rail: '.ds-workbench-side-rail', composer: '.ds-composer-textarea' }
const PRIVATE = { panel: '[data-room-workbench-panel]', rail: '.rooms-workbench-rail', composer: '.rooms-composer' }

// Read actual native renderer layout. Tab strips and vertically scrollable lists
// may intentionally scroll; fixed toolbar controls must remain fully visible.
async function readSidebarGeometry(page, selectors) {
  return page.evaluate(({ panel: panelSelector, rail: railSelector, surface: surfaceSelector, composer: composerSelector }) => {
    const shown = (element) => {
      if (!element) return false
      const style = getComputedStyle(element), rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const find = (selector) => [...document.querySelectorAll(selector)].find(shown)
    const box = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom }
    }
    const panel = find(panelSelector), rail = find(railSelector), surface = find(surfaceSelector)
    if (!panel || !rail || !surface) throw new Error('Sidebar geometry needs a visible panel, rail and active content')
    const header = panel.querySelector('.ds-code-right-tabs')
    const controls = [...panel.querySelectorAll('button, input, select')].filter(shown).flatMap((control) => {
      if (Number(getComputedStyle(control).opacity) === 0 || control.closest('[role="tablist"]')) return []
      const rect = control.getBoundingClientRect()
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight
      for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect()
        if (/(auto|scroll)/.test(style.overflowY) && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) return []
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
          left = Math.max(left, bounds.left); right = Math.min(right, bounds.right)
        }
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
          top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom)
        }
      }
      return [{ label: control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent?.trim().slice(0, 120),
        rect: box(control), clipped: rect.left < left - 1 || rect.right > right + 1 || rect.top < top - 1 || rect.bottom > bottom + 1 }]
    })
    const activeTabs = [...panel.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(shown)
    return { viewport: { width: innerWidth, height: innerHeight }, panel: box(panel), rail: box(rail),
      header: box(header), surface: box(surface), composer: box(find(composerSelector)),
      surfaceOverflow: surface.scrollWidth > surface.clientWidth + 1, controls,
      selectedTabs: activeTabs.map((tab) => tab.getAttribute('aria-label') || tab.textContent?.trim()),
      panelContainsSurface: panel.contains(surface), panelPosition: getComputedStyle(panel).position }
  }, selectors)
}

function sidebarGeometryIssues(geometry, { docked = false } = {}) {
  const issues = []
  for (const name of ['panel', 'rail', 'header', 'surface']) {
    const rect = geometry[name]
    if (!rect || rect.width <= 0 || rect.height <= 0) { issues.push(name + ' is not rendered'); continue }
    if (rect.x < -1 || rect.right > geometry.viewport.width + 1 || rect.y < -1 || rect.bottom > geometry.viewport.height + 1) {
      issues.push(name + ' extends outside the viewport')
    }
  }
  if (!geometry.panelContainsSurface) issues.push('Active content is outside the shared right panel')
  if (geometry.surfaceOverflow) issues.push('Active content overflows horizontally')
  if (geometry.panel && geometry.rail && geometry.panel.right > geometry.rail.x + 1) issues.push('Panel overlaps the tool rail')
  if (docked && geometry.composer && geometry.panel && geometry.composer.right > geometry.panel.x + 1) {
    issues.push('Docked panel covers the conversation composer')
  }
  for (const control of geometry.controls) if (control.clipped) issues.push('Clipped control: ' + control.label)
  if (geometry.selectedTabs.length !== 1) issues.push('Exactly one shared header tab must be selected')
  return issues
}

function nativeBrowserGeometryIssues({ host, native }) {
  const issues = []
  if (!host || !native?.bounds) return ['Native browser view or visible renderer host is missing']
  for (const key of ['x', 'y', 'width', 'height']) {
    if (Math.abs(Math.round(host[key] * native.zoomFactor) - native.bounds[key]) > 1) {
      issues.push('Native browser ' + key + ' differs from the renderer host')
    }
  }
  if (native.bounds.width <= 0 || native.bounds.height <= 0 || native.bounds.x < 0 || native.bounds.y < 0 ||
    native.bounds.x + native.bounds.width > native.contentBounds.width + 1 ||
    native.bounds.y + native.bounds.height > native.contentBounds.height + 1) {
    issues.push('Native browser view is clipped by its window')
  }
  return issues
}

async function readNativeBrowserGeometry({ page, application, url }) {
  const host = await page.locator('[data-room-agent-browser]:visible [data-browser-use-variant] > .ds-sidebar-surface-body')
    .boundingBox()
  const native = await application.evaluate(({ BrowserWindow }, expectedUrl) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      const view = window.contentView.children.find((item) => item.webContents &&
        !item.webContents.isDestroyed() && item.webContents.getURL() === expectedUrl)
      if (view) return { bounds: view.getBounds(), contentBounds: window.getContentBounds(),
        zoomFactor: window.webContents.getZoomFactor(), webContentsId: view.webContents.id }
    }
    return null
  }, url)
  return { host, native }
}

async function dragSidebar({ page, panel, handle, poll, capture, name }) {
  const before = await panel.boundingBox(), grip = await handle.boundingBox()
  assert(before && grip, 'A real sidebar and resize handle must be visible')
  // Shrink first, so the test does not depend on how much free width the host has.
  const origin = { x: grip.x + grip.width / 2, y: grip.y + Math.min(grip.height / 2, 160) }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  try { await page.mouse.move(origin.x + 80, origin.y, { steps: 8 }) }
  finally { await page.mouse.up() }
  let after
  await poll(async () => {
    after = await panel.boundingBox()
    return after && before.width - after.width >= 24
  }, 5000, 'real pointer drag changes sidebar width')
  await capture(name)
  const moved = await handle.boundingBox()
  assert(moved)
  await page.mouse.move(moved.x + moved.width / 2, origin.y)
  await page.mouse.down()
  try { await page.mouse.move(moved.x + moved.width / 2 - (before.width - after.width), origin.y, { steps: 8 }) }
  finally { await page.mouse.up() }
  await poll(async () => Math.abs((await panel.boundingBox()).width - before.width) <= 2,
    5000, 'reverse pointer drag restores sidebar width')
  return { before, after, restored: await panel.boundingBox(), input: 'native Playwright mouse pointer drag' }
}

function createSidebarEvidence({ page, poll, capture, recordDiagnostic, resize }) {
  const captures = [], drags = []
  const record = async (name, selectors, strict) => {
    const geometry = await readSidebarGeometry(page, selectors)
    const issues = sidebarGeometryIssues(geometry, { docked: strict })
    await capture(name)
    captures.push({ name, mode: strict ? 'private-agent' : 'code-baseline', geometry, issues })
    await recordDiagnostic('sidebar-comparison-geometry', { captures, drags })
    if (strict) assert.deepEqual(issues, [], name + ': measured sidebar geometry')
    return geometry
  }
  const privateCapture = (name, surface) => record(name, { ...PRIVATE, surface }, true)
  const codeCapture = (name, surface) => record(name, { ...CODE, surface }, false)
  const pointerResize = async (mode, surface) => {
    const selectors = mode === 'code' ? CODE : PRIVATE
    const result = await dragSidebar({ page, poll, panel: page.locator(selectors.panel + ':visible'),
      handle: page.locator(mode === 'code'
        ? '[role="separator"]:has(+ [data-workbench-right-panel]):visible' : '[data-room-workbench-resize]:visible'),
      name: `sidebar-${mode}-pointer-resized`,
      capture: (name) => record(name, { ...selectors, surface }, mode !== 'code') })
    drags.push({ mode, ...result })
    await recordDiagnostic('sidebar-comparison-geometry', { captures, drags })
  }
  const resizeTo = async (width, height) => {
    await resize(width, height)
    await poll(async () => {
      const current = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      return Math.abs(current.width - width) <= 16 && current.height > height - 80 && current.height <= height
    }, 5000, 'native BrowserWindow reached requested dimensions')
    // Allow the real ResizeObserver/layout effects two frames before measuring.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  const assertSharedChrome = () => {
    const baseline = captures.find((item) => item.name === 'sidebar-code-files-wide')?.geometry
    assert(baseline, 'Capture the actual Code sidebar before comparing its chrome')
    for (const item of captures.filter((item) => item.mode === 'private-agent')) {
      assert(Math.abs(item.geometry.header.height - baseline.header.height) <= 1, item.name + ': Code tab header height')
      assert(Math.abs(item.geometry.rail.width - baseline.rail.width) <= 1, item.name + ': Code tool rail width')
    }
  }
  return { codeCapture, privateCapture, pointerResize, resizeTo, assertSharedChrome,
    snapshot: () => ({ captures, drags }) }
}

async function captureCodeSidebarBaseline({ page, workspaceRoot, fixture, poll, sidebar }) {
  assert.equal(fixture.snapshot().real, false, 'Code comparison uses only the disposable offline profile')
  const callsBefore = fixture.snapshot().mainCalls
  await poll(() => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    return useChatStore.getState().runtimeConnection === 'ready'
  }), 30000, 'Code runtime ready for sidebar baseline')
  const project = await page.evaluate(async (root) => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const id = await useChatStore.getState().createThread({ workspaceRoot: root, forceNew: true })
    if (!id) throw new Error('Could not create the isolated Code sidebar comparison task')
    await useChatStore.getState().renameThread(id, 'Code sidebar comparison')
    return { id }
  }, workspaceRoot)
  await page.locator('.ds-composer-textarea').waitFor()
  const originalScope = await roomWorkbenchSnapshot(page)
  assert.equal(originalScope.route, 'chat')
  assert.equal(originalScope.activeThreadId, project.id)
  assert.equal(originalScope.workspaceRoot, workspaceRoot)
  const rail = page.locator(CODE.rail + ':visible'), panel = page.locator(CODE.panel + ':visible')
  await rail.getByRole('button', { name: 'Files', exact: true }).click()
  const activePanel = CODE.panel + ' [role="tabpanel"]:not([hidden])'
  const file = panel.getByRole('button', { name: /^baseline\.txt/ }).first()
  await file.waitFor()
  await sidebar.codeCapture('sidebar-code-files-wide', activePanel)
  await sidebar.pointerResize('code', activePanel)
  await file.click()
  const preview = CODE.panel + ' .ds-code-sidebar'
  await poll(async () => (await page.locator(preview + ':visible').innerText()).includes('baseline'),
    15000, 'actual Code workspace file preview')
  await sidebar.codeCapture('sidebar-code-file-preview-wide', preview)
  await rail.getByRole('button', { name: 'Preview', exact: true }).click()
  const browser = CODE.panel + ' [data-preview-width]'
  await page.locator(browser + ':visible').waitFor()
  await sidebar.codeCapture('sidebar-code-browser-controls-wide', browser)
  await sidebar.resizeTo(760, 780)
  await sidebar.codeCapture('sidebar-code-browser-controls-narrow', browser)
  await panel.getByRole('tab', { name: 'Files', exact: true }).click()
  await sidebar.codeCapture('sidebar-code-files-narrow', activePanel)
  await file.click()
  await sidebar.codeCapture('sidebar-code-file-preview-narrow', preview)
  await sidebar.resizeTo(1360, 900)
  await panel.getByRole('button', { name: 'Collapse right sidebar', exact: true }).first().click()
  await panel.waitFor({ state: 'hidden' })
  assert.deepEqual(await roomWorkbenchSnapshot(page), originalScope)
  assert.equal(fixture.snapshot().mainCalls, callsBefore, 'Code reference screenshots must not invoke the model')
  return { projectThreadId: project.id, workspaceRoot, actualComponents: ['CodeRightPanelTabs', 'WorkbenchFileTreeSidePanel',
    'WorkspaceFilePreviewPanel', 'DevBrowserPanel'], browserNavigation: 'empty preview; no navigation or network request' }
}

module.exports = { captureCodeSidebarBaseline, createSidebarEvidence, dragSidebar, readSidebarGeometry, sidebarGeometryIssues,
  readNativeBrowserGeometry, nativeBrowserGeometryIssues }
