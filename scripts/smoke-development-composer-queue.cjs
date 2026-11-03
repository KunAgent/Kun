#!/usr/bin/env node

'use strict'

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const { makeTreeWritable } = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment,
  desktopSmokeSettings,
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  platformDesktopArguments,
  stopIsolatedServiceManager,
  stopIsolatedSharedRuntime,
  terminateProcessTree
} = require('./smoke-packaged-extension-desktop.cjs')
const { developmentRendererEnvironment } = require('./development-renderer-environment.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

const DEFAULT_TIMEOUT_MS = 120_000
const CLEANUP_TIMEOUT_MS = 15_000
const WIDE = { width: 1_280, height: 820 }
const NARROW = { width: 420, height: 760 }

async function main() {
  const repositoryRoot = resolve(join(__dirname, '..'))
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const evidenceRoot = resolve(
    argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'composer-queue-smoke')
  )
  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  for (const [label, path] of [
    ['Electron executable', electronExecutable], ['Vite CLI', viteCli],
    ['renderer config', rendererConfig], ['built Main entry', mainEntry]
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-composer-queue-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'composer-queue-'))
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  let rendererProcess
  let electronApplication
  let electronProcess
  let rendererOutput = ''
  let electronOutput = ''
  let primaryError
  let result
  const queueModel = await require('./smoke-composer-runtime-queue.cjs').startQueueSmokeModel()
  try {
    await Promise.all([
      mkdir(profile, { recursive: true }), mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }), mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }), mkdir(evidenceRoot, { recursive: true })
    ])
    const settings = {
      ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
      locale: 'en', theme: 'light', uiFontScale: 1
    }
    settings.agents.kun.baseUrl = queueModel.baseUrl
    const serializedSettings = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({
      platform: process.platform, home, appData, explicitUserData: userData
    }).map(async (directory) => {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'kun-settings.json'), serializedSettings)
    }))

    const environment = developmentRendererEnvironment(
      createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory }),
      { rendererPort, temporaryRoot }
    )
    environment.NODE_ENV = 'development'
    rendererProcess = spawn(
      process.execPath,
      [viteCli, '--config', rendererConfig, '--logLevel', 'warn'],
      {
        cwd: repositoryRoot, env: environment,
        detached: process.platform !== 'win32', windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    rendererProcess.stdout?.on('data', (chunk) => { rendererOutput = tail(rendererOutput, chunk) })
    rendererProcess.stderr?.on('data', (chunk) => { rendererOutput = tail(rendererOutput, chunk) })
    await waitForPortOpen(rendererPort, timeoutMs, rendererProcess)

    electronApplication = await _electron.launch({
      executablePath: electronExecutable,
      args: [
        `--user-data-dir=${userData}`, '--no-first-run', '--disable-background-networking',
        '--disable-component-update', '--disable-default-apps',
        ...platformDesktopArguments(process.platform), repositoryRoot
      ],
      cwd: repositoryRoot, env: environment, chromiumSandbox: true, timeout: timeoutMs
    })
    electronProcess = electronApplication.process()
    electronProcess.stdout?.on('data', (chunk) => { electronOutput = tail(electronOutput, chunk) })
    electronProcess.stderr?.on('data', (chunk) => { electronOutput = tail(electronOutput, chunk) })
    const page = await findWorkbenchWindow(electronApplication, timeoutMs)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_000)
    const bridge = await require('./smoke-composer-runtime-queue.cjs').assertRuntimeQueueBridge(page, workspaceRoot, queueModel)
    process.stdout.write(`Runtime queue bridge passed: ${JSON.stringify(bridge)}\n`)
    await page.evaluate(async () => {
      await import('/src/components/chat/FloatingComposerQueueDockSmokeFixture.tsx')
    })

    const captures = []
    captures.push(await capture({
      electronApplication, page, evidenceRoot, scenario: 'single', theme: 'light',
      bounds: WIDE, name: 'wide-single-light'
    }))
    await assertNoReorderHandles(page, 'single queue')
    await assertSingleAndEdit(page)

    captures.push(await capture({
      electronApplication, page, evidenceRoot, scenario: 'multi', theme: 'light',
      bounds: WIDE, name: 'wide-multi-light'
    }))
    const multiRows = await assertMultiRowsInline(page)
    const reorder = await assertExpandedMultiReordering(page, evidenceRoot)
    const busyReorder = await assertBusyPreventsReordering(page, evidenceRoot)

    captures.push(await capture({
      electronApplication, page, evidenceRoot, scenario: 'long', theme: 'dark',
      bounds: WIDE, name: 'wide-long-collapsed-dark'
    }))
    const disclosure = await assertLongDisclosure(page)
    const longGeometry = await geometry(page)
    assertGeometry(longGeometry, { scenario: 'long', expanded: true })
    await page.screenshot({ path: join(evidenceRoot, 'wide-long-expanded-dark.png') })

    captures.push(await capture({
      electronApplication, page, evidenceRoot, scenario: 'long', theme: 'light',
      bounds: NARROW, name: 'narrow-long-collapsed-light'
    }))
    await page.locator('[data-queued-message-header]').click()
    const narrowGeometry = await geometry(page)
    assertGeometry(narrowGeometry, { scenario: 'long', expanded: true, narrow: true })
    await page.screenshot({ path: join(evidenceRoot, 'narrow-long-expanded-light.png') })

    captures.push(await capture({
      electronApplication, page, evidenceRoot, scenario: 'paused', theme: 'light',
      bounds: WIDE, name: 'wide-paused-light'
    }))
    const paused = await assertPausedResume(page)
    await page.screenshot({ path: join(evidenceRoot, 'wide-paused-resumed-light.png') })

    captures.push(await capture({
      electronApplication, page, evidenceRoot, scenario: 'failed', theme: 'light',
      bounds: WIDE, name: 'wide-failed-light'
    }))
    const retry = page.locator('[data-queued-message-action="guide"]')
    if (await retry.isDisabled()) throw new Error('Failed queue Retry is disabled before interaction')
    await retry.click()
    await page.locator('[data-busy-message-id="queue-failed"]').waitFor({ state: 'visible' })
    const disabledActions = await page.locator('[data-queued-message-action]:disabled').count()
    const allActions = await page.locator('[data-queued-message-action]').count()
    if (disabledActions !== allActions || allActions < 2) {
      throw new Error(`Retry busy did not interlock actions: ${disabledActions}/${allActions}`)
    }
    await page.screenshot({ path: join(evidenceRoot, 'wide-failed-retry-busy-light.png') })
    await page.evaluate(async () => {
      const fixture = await import('/src/components/chat/FloatingComposerQueueDockSmokeFixture.tsx')
      fixture.settleComposerQueueSmokeRetry()
    })
    await page.locator('[data-queue-dock]').waitFor({ state: 'detached' })

    result = {
      ok: true,
      evidenceRoot,
      captures,
      multiRows,
      disclosure,
      paused,
      reorder,
      busyReorder,
      longGeometry,
      narrowGeometry,
      retryBusy: { disabledActions, allActions }
    }
  } catch (error) {
    primaryError = new Error(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}` +
      diagnostics(rendererOutput, electronOutput)
    )
  } finally {
    const cleanupErrors = []
    if (electronApplication) {
      await withTimeout(electronApplication.close(), 3_000, 'closing Electron').catch(() => undefined)
    }
    if (electronProcess) {
      await terminateProcessTree(electronProcess, process.platform, {
        timeoutMs: CLEANUP_TIMEOUT_MS, detached: process.platform !== 'win32'
      }).catch((error) => cleanupErrors.push(error))
    }
    await withTimeout(
      stopIsolatedSharedRuntime(repositoryRoot, profile),
      CLEANUP_TIMEOUT_MS + 5_000,
      'stopping Kun runtime'
    ).catch((error) => cleanupErrors.push(error))
    await withTimeout(
      stopIsolatedServiceManager(home, profile),
      CLEANUP_TIMEOUT_MS + 5_000,
      'stopping Service Manager'
    ).catch((error) => cleanupErrors.push(error))
    if (rendererProcess) {
      await terminateProcessTree(rendererProcess, process.platform, {
        timeoutMs: CLEANUP_TIMEOUT_MS, detached: process.platform !== 'win32'
      }).catch((error) => cleanupErrors.push(error))
    }
    await makeTreeWritable(temporaryRoot).catch(() => undefined)
    await Promise.all([temporaryRoot, workspaceRoot].map((path) => (
      rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    ))).catch((error) => cleanupErrors.push(error))
    if (cleanupErrors.length) {
      primaryError = new Error(
        `${primaryError?.message ?? 'Composer queue smoke cleanup failed'}\n` +
        cleanupErrors.map((error) => error instanceof Error ? error.message : String(error)).join('\n')
      )
    }
  }
  if (primaryError) { await queueModel.close(); throw primaryError }
  await queueModel.close()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function capture({ electronApplication, page, evidenceRoot, scenario, theme, bounds, name }) {
  await electronApplication.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    window?.setMinimumSize(320, 320)
    window?.setBounds({ x: 20, y: 20, ...size })
  }, bounds)
  await page.waitForTimeout(100)
  await page.evaluate(async ({ nextScenario, nextTheme }) => {
    document.documentElement.dataset.theme = nextTheme
    const fixture = await import('/src/components/chat/FloatingComposerQueueDockSmokeFixture.tsx')
    fixture.mountComposerQueueSmokeFixture(nextScenario)
  }, { nextScenario: scenario, nextTheme: theme })
  await page.locator('[data-floating-composer]').waitFor({ state: 'visible' })
  await page.locator('[data-queue-dock]').waitFor({ state: 'visible' })
  await page.waitForTimeout(160)
  const snapshot = await geometry(page)
  assertGeometry(snapshot, { scenario, expanded: scenario !== 'long' })
  const path = join(evidenceRoot, `${name}.png`)
  await page.screenshot({ path })
  return { name, path, ...snapshot }
}

async function assertSingleAndEdit(page) {
  if (await page.locator('[data-queued-message-header]').count()) {
    throw new Error('Single queued message rendered a disclosure header')
  }
  const row = page.locator('[data-queued-message-id="queue-single"]')
  await row.locator('[data-queued-message-action="edit"]').click()
  if (await page.locator('[data-queued-message-editor]').count() !== 0) {
    throw new Error('Restore-to-composer edit rendered an inline editor')
  }
  await page.locator('[data-queue-dock]').waitFor({ state: 'detached' })
  const textarea = page.locator('textarea.ds-composer-textarea')
  await textarea.waitFor()
  const restored = await textarea.inputValue()
  if (restored !== 'Continue with the queued implementation review') {
    throw new Error(`Restored composer text mismatch: ${JSON.stringify(restored)}`)
  }
  await textarea.fill('Edited queued implementation review')
  const edited = await textarea.inputValue()
  if (edited !== 'Edited queued implementation review') {
    throw new Error(`Composer edit did not stick: ${JSON.stringify(edited)}`)
  }
}

async function assertMultiRowsInline(page) {
  if (await page.locator('[data-queued-message-header]').count()) {
    throw new Error('A two-message queue rendered the "n more" disclosure')
  }
  const rowCount = await page.locator('[data-queued-message-id]').count()
  if (rowCount !== 2) throw new Error(`Two-message queue rendered ${rowCount} rows`)
  const caption = await page.locator('[data-queued-message-caption]').textContent()
  if (!caption?.includes('Drag to reorder')) {
    throw new Error(`Queue caption is missing the drag hint: ${JSON.stringify(caption)}`)
  }
  return { rowCount, caption }
}

async function assertLongDisclosure(page) {
  const header = page.locator('[data-queued-message-header]')
  if (await header.getAttribute('aria-expanded') !== 'false') {
    throw new Error('Long queue did not start folded')
  }
  const foldedRows = await page.locator('[data-queued-message-id]').count()
  if (foldedRows !== 3) throw new Error(`Folded long queue rendered ${foldedRows} rows`)
  await header.click()
  if (await header.getAttribute('aria-expanded') !== 'true') {
    throw new Error('Queue disclosure did not expand')
  }
  const rowCount = await page.locator('[data-queued-message-id]').count()
  if (rowCount !== 8) throw new Error(`Expanded long queue rendered ${rowCount} rows`)
  return { foldedRows, rowCount }
}

async function assertPausedResume(page) {
  const banner = page.locator('[data-queue-paused-banner]')
  await banner.waitFor({ state: 'visible' })
  if (await page.locator('[data-queued-message-caption]').count()) {
    throw new Error('Paused queue kept the regular caption')
  }
  const rowRetries = await page.locator('[data-queued-message-action="guide"]:visible').count()
  if (rowRetries !== 0) throw new Error(`Paused rows offered ${rowRetries} per-row retries`)
  const resume = page.locator('[data-queue-resume]')
  if (await resume.isDisabled()) throw new Error('Continue is disabled while no reply runs')
  await resume.click()
  await banner.waitFor({ state: 'detached' })
  await page.locator('[data-queued-message-caption]').waitFor({ state: 'visible' })
  return { rowRetries, resumed: true }
}

async function assertNoReorderHandles(page, label) {
  const count = await page.locator('[data-queued-message-drag-handle]').count()
  if (count !== 0) throw new Error(`${label} rendered ${count} reorder handles`)
}

async function assertExpandedMultiReordering(page, evidenceRoot) {
  const initial = await queuedMessageOrder(page)
  sameOrder(initial, ['queue-first', 'queue-second'], 'initial expanded queue')
  const handles = page.locator('[data-queued-message-drag-handle]')
  if (await handles.count() !== 2) throw new Error('Expanded multi queue did not render two handles')
  const handleBox = await handles.first().boundingBox()
  exact(handleBox?.width ?? null, 22, 'reorder handle width')
  exact(handleBox?.height ?? null, 22, 'reorder handle height')

  const source = page.locator('[data-queued-message-drag-id="queue-second"]')
  const target = page.locator('[data-queued-message-id="queue-first"]')
  let dragStrategy = 'locator.dragTo'
  try {
    await source.dragTo(target, {
      targetPosition: { x: 24, y: 3 },
      timeout: 5_000
    })
    await waitForQueuedMessageOrder(page, ['queue-second', 'queue-first'], 2_000)
  } catch {
    dragStrategy = 'synthetic DragEvent fallback'
    await dragBefore(page, 'queue-second', 'queue-first')
    await waitForQueuedMessageOrder(page, ['queue-second', 'queue-first'])
  }
  await page.screenshot({ path: join(evidenceRoot, 'wide-multi-drag-reordered-light.png') })

  const secondHandle = page.locator('[data-queued-message-drag-id="queue-second"]')
  await secondHandle.focus()
  await secondHandle.press('ArrowDown')
  await waitForQueuedMessageOrder(page, ['queue-first', 'queue-second'])
  await assertFocusedReorderHandle(page, 'queue-second', 'ArrowDown')
  await page.locator('[data-queued-message-drag-id="queue-second"]').press('ArrowUp')
  await waitForQueuedMessageOrder(page, ['queue-second', 'queue-first'])
  await assertFocusedReorderHandle(page, 'queue-second', 'ArrowUp')
  await page.screenshot({ path: join(evidenceRoot, 'wide-multi-keyboard-reordered-light.png') })

  const indicator = await exposeDropIndicator(page, 'queue-first', 'queue-second')
  exact(indicator.height, 2, 'drop indicator height')
  if (indicator.position !== 'before') {
    throw new Error(`Drop indicator position is ${indicator.position}, expected before`)
  }
  await page.screenshot({ path: join(evidenceRoot, 'wide-multi-drop-indicator-light.png') })
  await endSyntheticDrag(page, 'queue-first')
  sameOrder(await queuedMessageOrder(page), ['queue-second', 'queue-first'], 'indicator-only drag')

  return { dragStrategy, handle: handleBox, indicator }
}

async function assertBusyPreventsReordering(page, evidenceRoot) {
  const guide = page.locator('[data-queued-message-action="guide"]').first()
  await guide.click()
  await page.locator('[data-busy-message-id="queue-second"]').waitFor({ state: 'visible' })
  await assertNoReorderHandles(page, 'busy multi queue')
  const draggableRows = await page.locator('[data-queue-dock] [draggable="true"]').count()
  if (draggableRows !== 0) throw new Error(`Busy multi queue left ${draggableRows} draggable controls`)
  const order = await queuedMessageOrder(page)
  await page.keyboard.press('ArrowDown')
  sameOrder(await queuedMessageOrder(page), order, 'busy queue keyboard attempt')
  await page.screenshot({ path: join(evidenceRoot, 'wide-multi-reorder-busy-light.png') })
  await page.evaluate(async () => {
    const fixture = await import('/src/components/chat/FloatingComposerQueueDockSmokeFixture.tsx')
    fixture.settleComposerQueueSmokeRetry()
  })
  await page.locator('[data-busy-message-id]').waitFor({ state: 'detached' })
  return { order, draggableRows }
}

async function queuedMessageOrder(page) {
  return page.locator('[data-queued-message-id]').evaluateAll((rows) => (
    rows.map((row) => row.getAttribute('data-queued-message-id'))
  ))
}

async function waitForQueuedMessageOrder(page, expected, timeout = 5_000) {
  await page.waitForFunction((ids) => {
    const actual = [...document.querySelectorAll('[data-queued-message-id]')]
      .map((row) => row.getAttribute('data-queued-message-id'))
    const persisted = document.querySelector('[data-testid="composer-queue-smoke-stage"]')
      ?.getAttribute('data-queued-message-order')
    return actual.join(',') === ids.join(',') && persisted === ids.join(',')
  }, expected, { timeout })
}

async function assertFocusedReorderHandle(page, id, key) {
  await page.waitForFunction((expectedId) => (
    document.activeElement?.getAttribute('data-queued-message-drag-id') === expectedId
  ), id)
  const focused = await page.evaluate(() => (
    document.activeElement?.getAttribute('data-queued-message-drag-id') ?? null
  ))
  if (focused !== id) throw new Error(`${key} lost reorder focus: ${focused}`)
}

async function dragBefore(page, sourceId, targetId) {
  await beginSyntheticDrag(page, sourceId)
  await exposeDropTarget(page, targetId, 'before')
  await page.locator(`[data-queued-message-id="${targetId}"][data-drop-position="before"]`)
    .waitFor({ state: 'attached' })
  await page.evaluate(({ source, target }) => {
    const row = document.querySelector(`[data-queued-message-id="${target}"]`)
    const handle = document.querySelector(`[data-queued-message-drag-id="${source}"]`)
    const transfer = window.__kunQueueSmokeDataTransfer
    if (!row || !handle || !transfer) throw new Error('Synthetic drop target is missing')
    const bounds = row.getBoundingClientRect()
    row.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, clientY: bounds.top + 1, dataTransfer: transfer
    }))
    handle.dispatchEvent(new DragEvent('dragend', {
      bubbles: true, cancelable: true, dataTransfer: transfer
    }))
    delete window.__kunQueueSmokeDataTransfer
  }, { source: sourceId, target: targetId })
}

async function exposeDropIndicator(page, sourceId, targetId) {
  await beginSyntheticDrag(page, sourceId)
  await exposeDropTarget(page, targetId, 'before')
  const row = page.locator(`[data-queued-message-id="${targetId}"][data-drop-position="before"]`)
  await row.waitFor({ state: 'attached' })
  return row.evaluate((element) => {
    const indicator = getComputedStyle(element, '::before')
    return {
      height: Number.parseFloat(indicator.height || '0'),
      position: element.getAttribute('data-drop-position'),
      background: indicator.backgroundColor
    }
  })
}

async function beginSyntheticDrag(page, sourceId) {
  await page.evaluate((id) => {
    const handle = document.querySelector(`[data-queued-message-drag-id="${id}"]`)
    if (!handle) throw new Error(`Missing reorder handle ${id}`)
    const transfer = new DataTransfer()
    window.__kunQueueSmokeDataTransfer = transfer
    handle.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true, cancelable: true, dataTransfer: transfer
    }))
  }, sourceId)
  await page.locator(`[data-queued-message-id="${sourceId}"][data-queue-dragging="true"]`)
    .waitFor({ state: 'attached' })
}

async function exposeDropTarget(page, targetId, position) {
  await page.evaluate(({ id, side }) => {
    const row = document.querySelector(`[data-queued-message-id="${id}"]`)
    const transfer = window.__kunQueueSmokeDataTransfer
    if (!row || !transfer) throw new Error(`Missing synthetic drag target ${id}`)
    const bounds = row.getBoundingClientRect()
    row.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: side === 'before' ? bounds.top + 1 : bounds.bottom - 1,
      dataTransfer: transfer
    }))
  }, { id: targetId, side: position })
}

async function endSyntheticDrag(page, sourceId) {
  await page.evaluate((id) => {
    const handle = document.querySelector(`[data-queued-message-drag-id="${id}"]`)
    const transfer = window.__kunQueueSmokeDataTransfer
    handle?.dispatchEvent(new DragEvent('dragend', {
      bubbles: true, cancelable: true, dataTransfer: transfer
    }))
    delete window.__kunQueueSmokeDataTransfer
  }, sourceId)
  await page.locator('[data-queue-dragging="true"]').waitFor({ state: 'detached' })
}

function sameOrder(actual, expected, label) {
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(`${label} order is ${actual.join(',')}, expected ${expected.join(',')}`)
  }
}

async function geometry(page) {
  return page.evaluate(readQueueGeometry)
}

/* Runs in the page: where the queue sits inside the activity tray, and how
   the tray tucks behind the composer input slot. */
function readQueueGeometry() {
  const box = (element) => {
    if (!element) return null
    const value = element.getBoundingClientRect()
    return {
      x: value.x, y: value.y, width: value.width, height: value.height,
      right: value.right, bottom: value.bottom
    }
  }
  const css = (element) => {
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      maxHeight: style.maxHeight,
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderTopRightRadius: style.borderTopRightRadius,
      borderBottomLeftRadius: style.borderBottomLeftRadius,
      borderBottomRightRadius: style.borderBottomRightRadius
    }
  }
  const dock = document.querySelector('[data-queue-dock]')
  const composer = document.querySelector('[data-floating-composer]')
  const tray = document.querySelector('[data-composer-tray]')
  const list = document.querySelector('[data-queue-dock] ul')
  const firstAction = [...document.querySelectorAll('[data-queue-dock] [data-queued-message-action]')]
    .find((element) => element.getClientRects().length > 0) ?? null
  return {
    dock: box(dock), tray: box(tray), trayStyle: css(tray),
    traySlot: box(document.querySelector('[data-composer-tray-queue]')),
    inputSlot: box(document.querySelector('[data-composer-input-slot]')),
    composer: box(composer), shell: box(document.querySelector('.ds-composer-shell')),
    caption: box(document.querySelector('[data-queued-message-caption], [data-queue-paused-banner]')),
    header: box(document.querySelector('[data-queued-message-header]')),
    firstRow: box(document.querySelector('[data-queued-message-id]')),
    firstHandle: box(document.querySelector('[data-queued-message-drag-handle]')),
    firstAction: box(firstAction),
    rowCount: document.querySelectorAll('[data-queued-message-id]').length,
    list: box(list), listStyle: css(list),
    insideComposer: Boolean(dock && composer && composer.contains(dock)),
    insideTray: Boolean(dock && tray && tray.contains(dock)),
    bodyQueueCount: document.body.querySelectorAll('[data-queue-dock]').length
  }
}

function assertGeometry(value, { scenario, expanded, narrow = false }) {
  if (!value.insideComposer || !value.insideTray || value.bodyQueueCount !== 1) {
    throw new Error(`${scenario}: queue is outside the activity tray or duplicated: ${JSON.stringify(value)}`)
  }
  exact(value.caption?.height ?? null, scenario === 'paused' ? 36 : 30, `${scenario} caption height`)
  exact(value.firstRow?.height ?? null, 36, `${scenario} row height`)
  if (value.firstHandle) {
    exact(value.firstHandle.width, 22, `${scenario} reorder handle width`)
    exact(value.firstHandle.height, 22, `${scenario} reorder handle height`)
  }
  exact(value.firstAction?.height ?? null, 26, `${scenario} action height`)
  if (scenario === 'long') {
    exact(value.header?.height ?? null, 30, `${scenario} disclosure height`)
    if (!expanded) exact(value.rowCount, 3, `${scenario} folded rows`)
  } else if (value.header) {
    throw new Error(`${scenario}: a short queue rendered the "n more" disclosure`)
  }
  exact(number(value.trayStyle?.borderTopLeftRadius), 16, `${scenario} tray top radius`)
  exact(number(value.trayStyle?.borderTopRightRadius), 16, `${scenario} tray top radius`)
  exact(number(value.trayStyle?.borderBottomLeftRadius), 0, `${scenario} tray bottom radius`)
  exact(number(value.listStyle?.maxHeight), 180, `${scenario} list max-height`)
  // The tray is inset 12px from the input slot and tucks 16px behind it; the
  // queue is its last section, so it ends exactly at the input slot's edge.
  const leftInset = (value.tray?.x ?? 0) - (value.inputSlot?.x ?? 0)
  const rightInset = (value.inputSlot?.right ?? 0) - (value.tray?.right ?? 0)
  exact(leftInset, 12, `${scenario} left tray inset`)
  exact(rightInset, 12, `${scenario} right tray inset`)
  exact((value.inputSlot?.y ?? 0) - (value.tray?.bottom ?? 0), -16, `${scenario} tray tuck behind the input`)
  exact((value.inputSlot?.y ?? 0) - (value.traySlot?.bottom ?? 0), 0, `${scenario} queue/input join`)
  if (scenario === 'long' && expanded) {
    exact(value.list?.height ?? null, 180, 'long list height cap')
  }
  if (narrow && (value.tray?.x ?? 0) < 0) throw new Error('Narrow tray overflowed viewport')
}

function exact(actual, expected, label) {
  if (actual === null || Math.abs(actual - expected) > 1) {
    throw new Error(`${label} is ${actual}, expected ${expected}±1`)
  }
}
function number(value) { return Number.parseFloat(value || '0') }
function diagnostics(rendererOutput, electronOutput) {
  const messages = [
    rendererOutput.trim() && `Renderer output:\n${rendererOutput.trim()}`,
    electronOutput.trim() && `Electron output:\n${electronOutput.trim()}`
  ].filter(Boolean)
  return messages.length ? `\n\n${messages.join('\n\n')}` : ''
}
function tail(existing, chunk) { return `${existing}${String(chunk)}`.slice(-64 * 1024) }
async function withTimeout(operation, timeoutMs, description) {
  let timeout
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out while ${description}`)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise())
  })
  if (!port) throw new Error('Could not allocate a composer queue smoke port')
  return port
}
async function waitForPortOpen(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Renderer exited before port ${port} opened`)
    }
    if (await isPortOpen(port)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for renderer port ${port}`)
}
function isPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(open)
    }
    socket.setTimeout(250, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.unref()
  })
}
function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}
function positiveIntegerArgument(name, fallback) {
  const raw = argumentValue(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

module.exports = { assertGeometry, readQueueGeometry }
