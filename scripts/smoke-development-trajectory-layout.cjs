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
const WIDE = { width: 1_440, height: 900 }
const TABLE_BREAKPOINT = { width: 960, height: 820 }
const OVERLAY_BREAKPOINT = { width: 760, height: 820 }

async function main() {
  const repositoryRoot = resolve(join(__dirname, '..'))
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'trajectory-harness-smoke'))
  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  for (const [label, path] of [
    ['Electron executable', electronExecutable],
    ['Vite CLI', viteCli],
    ['renderer config', rendererConfig],
    ['built Main entry', mainEntry]
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-trajectory-layout-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'trajectory-layout-'))
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
  try {
    await Promise.all([
      mkdir(profile, { recursive: true }), mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }), mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }), mkdir(evidenceRoot, { recursive: true })
    ])
    const settings = {
      ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
      locale: 'en',
      theme: 'light',
      // Freeze authored CSS pixels for comparison with the Harness source.
      // Normal product font scaling continues to scale the whole Kun shell.
      uiFontScale: 1
    }
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
    rendererProcess = spawn(process.execPath, [viteCli, '--config', rendererConfig, '--logLevel', 'warn'], {
      cwd: repositoryRoot,
      env: environment,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
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
      cwd: repositoryRoot,
      env: environment,
      chromiumSandbox: true,
      timeout: timeoutMs
    })
    electronProcess = electronApplication.process()
    electronProcess.stdout?.on('data', (chunk) => { electronOutput = tail(electronOutput, chunk) })
    electronProcess.stderr?.on('data', (chunk) => { electronOutput = tail(electronOutput, chunk) })
    const page = await findWorkbenchWindow(electronApplication, timeoutMs)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_000)
    await page.evaluate(async () => {
      await import('/src/components/trajectory/TrajectoryHarnessSmokeFixture.tsx')
    })

    const captures = []
    captures.push(await capture({ electronApplication, page, evidenceRoot, scenario: 'unselected', theme: 'light', bounds: WIDE, name: 'initial-unselected' }))
    captures.push(await capture({ electronApplication, page, evidenceRoot, scenario: 'default', theme: 'light', bounds: WIDE, name: 'wide-light' }))
    captures.push(await capture({ electronApplication, page, evidenceRoot, scenario: 'default', theme: 'dark', bounds: WIDE, name: 'wide-dark' }))
    captures.push(await capture({ electronApplication, page, evidenceRoot, scenario: 'default', theme: 'light', bounds: TABLE_BREAKPOINT, name: 'table-620-breakpoint' }))
    captures.push(await capture({ electronApplication, page, evidenceRoot, scenario: 'default', theme: 'light', bounds: OVERLAY_BREAKPOINT, name: 'inspector-760-overlay' }))
    for (const scenario of ['empty', 'loading', 'running', 'failed', 'long']) {
      captures.push(await capture({ electronApplication, page, evidenceRoot, scenario, theme: 'light', bounds: WIDE, name: scenario }))
    }

    await capture({ electronApplication, page, evidenceRoot, scenario: 'unselected', theme: 'light', bounds: WIDE, name: 'interaction-unselected' })
    await page.locator('[data-trajectory-row-key="assistant:1"]').click()
    await page.locator('aside [data-trajectory-summary]').waitFor({ state: 'visible' })
    const rowClickOpenedInspector = await page.locator('aside').isVisible()

    await page.locator('[data-trajectory-row-key="user:1"]').click()
    await page.getByRole('tab', { name: 'Raw' }).click()
    const rawBlocks = page.locator('[data-trajectory-raw-block]')
    await rawBlocks.first().waitFor({ state: 'visible' })
    const rawBlockCount = await rawBlocks.count()
    const rawText = await page.locator('[data-testid="trajectory-raw-blocks"]').innerText()
    if (rawBlockCount !== 1 || !rawText.includes('Review the current implementation')) {
      throw new Error(`User Raw did not render its ordered content block: ${JSON.stringify({ rawBlockCount, rawText })}`)
    }
    if (/threadId|roundId|schemaVersion/.test(rawText)) {
      throw new Error(`User Raw leaked its trajectory envelope: ${rawText}`)
    }
    const rawEvidencePath = join(evidenceRoot, 'inspector-user-raw-light.png')
    await page.screenshot({ path: rawEvidencePath })

    await page.getByRole('tab', { name: 'Source' }).click()
    const sourceTree = page.getByRole('tree', { name: 'Message source' })
    await sourceTree.waitFor({ state: 'visible' })
    const sourceText = await sourceTree.innerText()
    if (!sourceText.includes('user') || /Review the current|threadId|workspace/.test(sourceText)) {
      throw new Error(`User Source did not isolate producer provenance: ${sourceText}`)
    }
    const sourceLightEvidencePath = join(evidenceRoot, 'inspector-user-source-light.png')
    await page.screenshot({ path: sourceLightEvidencePath })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await page.waitForTimeout(100)
    const sourceDarkEvidencePath = join(evidenceRoot, 'inspector-user-source-dark.png')
    await page.screenshot({ path: sourceDarkEvidencePath })
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })

    await page.locator('[data-trajectory-row-key="assistant:1"]').click()
    if (await page.getByRole('tab', { name: 'Source' }).count()) {
      throw new Error('Assistant exposed a Source tab without producer provenance')
    }
    await page.getByRole('tab', { name: 'Raw' }).click()
    await page.locator('[data-trajectory-raw-block]').first().waitFor({ state: 'visible' })
    await page.getByRole('button', { name: /Block.*tool-call/i }).click()
    await page.locator('[data-trajectory-row-key="tool:1"][data-selected="true"]').waitFor({ state: 'visible' })

    await capture({ electronApplication, page, evidenceRoot, scenario: 'long', theme: 'light', bounds: WIDE, name: 'interaction-scroll' })
    const scrollPane = page.locator('[data-trajectory-scroll]')
    await scrollPane.evaluate((element) => { element.scrollTop = 0 })
    const beforeScrollTop = await scrollPane.evaluate((element) => element.scrollTop)
    const scrollBox = await scrollPane.boundingBox()
    if (!scrollBox) throw new Error('Trajectory scroll pane has no pointer target')
    await page.mouse.move(scrollBox.x + scrollBox.width * 0.6, scrollBox.y + scrollBox.height * 0.5)
    await page.mouse.wheel(0, 480)
    await page.waitForTimeout(150)
    const afterScrollTop = await scrollPane.evaluate((element) => element.scrollTop)
    if (afterScrollTop <= beforeScrollTop) {
      throw new Error(`Trajectory wheel did not scroll the ledger: ${beforeScrollTop} -> ${afterScrollTop}`)
    }

    await capture({ electronApplication, page, evidenceRoot, scenario: 'default', theme: 'light', bounds: WIDE, name: 'interaction-base' })
    const search = page.getByRole('searchbox')
    await search.fill('run_tests')
    await page.waitForTimeout(120)
    const filteredRows = await page.locator('[data-trajectory-row-key]').count()
    if (filteredRows !== 1) throw new Error(`Local search rendered ${filteredRows} rows instead of 1`)
    await search.fill('')
    await page.getByRole('button', { name: 'Request #2' }).click()
    await page.locator('aside').waitFor({ state: 'visible' })
    const separator = page.getByRole('separator')
    const beforeWidth = (await page.locator('aside').boundingBox())?.width
    await separator.press('ArrowLeft')
    const afterWidth = (await page.locator('aside').boundingBox())?.width
    if (!beforeWidth || !afterWidth || afterWidth <= beforeWidth) {
      throw new Error(`Inspector keyboard resize failed: ${beforeWidth} -> ${afterWidth}`)
    }
    const timelineTrack = page.locator('[data-trajectory-timeline-track]')
    const timelineBox = await timelineTrack.boundingBox()
    if (!timelineBox) throw new Error('Trajectory timeline has no drag target')
    const rangeY = timelineBox.y + timelineBox.height - 2
    await page.mouse.move(timelineBox.x + timelineBox.width * 0.28, rangeY)
    await page.mouse.down()
    await page.mouse.move(timelineBox.x + timelineBox.width * 0.62, rangeY, { steps: 8 })
    await page.mouse.up()
    const rangeSelection = page.locator('[data-trajectory-timeline-selection]')
    await rangeSelection.waitFor({ state: 'visible' })
    const rangeVisual = await rangeSelection.evaluate((element) => {
      const style = getComputedStyle(element)
      const before = getComputedStyle(element, '::before')
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        edgeColor: before.backgroundColor
      }
    })
    const focusedOutRows = await page.locator('[data-timeline-focus="outside"]').count()
    if (focusedOutRows === 0 || rangeVisual.boxShadow === 'none' || transparent(rangeVisual.backgroundColor)) {
      throw new Error(`Trajectory range focus is not visibly projected: ${JSON.stringify({ focusedOutRows, rangeVisual })}`)
    }
    const rangeEvidencePath = join(evidenceRoot, 'interaction-range-selection.png')
    await page.screenshot({ path: rangeEvidencePath })
    result = {
      ok: true,
      evidenceRoot,
      captures,
      rowClickOpenedInspector,
      rawSourceInspector: {
        rawBlockCount,
        rawEvidencePath,
        sourceLightEvidencePath,
        sourceDarkEvidencePath
      },
      wheelScroll: { beforeScrollTop, afterScrollTop },
      rangeSelection: { focusedOutRows, evidencePath: rangeEvidencePath, ...rangeVisual },
      localSearchRows: filteredRows,
      inspectorResize: { beforeWidth, afterWidth }
    }
  } catch (error) {
    primaryError = new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}${diagnostics(rendererOutput, electronOutput)}`)
  } finally {
    const cleanupErrors = []
    if (electronApplication) await withTimeout(electronApplication.close(), 3_000, 'closing Electron').catch(() => undefined)
    if (electronProcess) await terminateProcessTree(electronProcess, process.platform, {
      timeoutMs: CLEANUP_TIMEOUT_MS, detached: process.platform !== 'win32'
    }).catch((error) => cleanupErrors.push(error))
    await withTimeout(stopIsolatedSharedRuntime(repositoryRoot, profile), CLEANUP_TIMEOUT_MS + 5_000, 'stopping Kun runtime').catch((error) => cleanupErrors.push(error))
    await withTimeout(stopIsolatedServiceManager(home, profile), CLEANUP_TIMEOUT_MS + 5_000, 'stopping Service Manager').catch((error) => cleanupErrors.push(error))
    if (rendererProcess) await terminateProcessTree(rendererProcess, process.platform, {
      timeoutMs: CLEANUP_TIMEOUT_MS, detached: process.platform !== 'win32'
    }).catch((error) => cleanupErrors.push(error))
    await Promise.all([temporaryRoot, workspaceRoot].map(async (path) => {
      await makeTreeWritable(path)
      await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    })).catch((error) => cleanupErrors.push(error))
    if (cleanupErrors.length) {
      const message = cleanupErrors.map((error) => error instanceof Error ? error.message : String(error)).join('\n')
      primaryError = new Error(`${primaryError?.message ?? 'Trajectory smoke cleanup failed'}\n${message}`)
    }
  }
  if (primaryError) throw primaryError
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
    document.documentElement.style.setProperty('--trajectory-composer-height', '0px')
    const fixture = await import('/src/components/trajectory/TrajectoryHarnessSmokeFixture.tsx')
    fixture.mountTrajectoryHarnessSmokeFixture(nextScenario)
  }, { nextScenario: scenario, nextTheme: theme })
  await page.locator('[data-testid="trajectory-view"]').waitFor({ state: 'visible' })
  await page.waitForTimeout(180)
  const snapshot = await layoutSnapshot(page)
  assertGeometry(snapshot, { name, scenario, bounds })
  const path = join(evidenceRoot, `${name}.png`)
  await page.screenshot({ path })
  return { name, path, ...snapshot }
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const value = element.getBoundingClientRect()
      return { x: value.x, y: value.y, width: value.width, height: value.height, bottom: value.bottom }
    }
    const style = (selector, property) => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).getPropertyValue(property).trim() : null
    }
    const visual = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const value = getComputedStyle(element)
      return {
        color: value.color,
        backgroundColor: value.backgroundColor,
        backgroundImage: value.backgroundImage,
        opacity: value.opacity
      }
    }
    const timelineVisual = (kind) => visual(`[data-testid="trajectory-timeline"] [data-trajectory-timeline-span][data-kind="${kind}"]`)
    const tagVisual = (kind) => visual(`[data-trajectory-kind-tag][data-kind="${kind}"]`)
    return {
      viewportWidth: innerWidth,
      appRegion: style('[data-testid="trajectory-view"]', '-webkit-app-region'),
      toolbar: rect('[role="toolbar"]'),
      timeline: rect('[data-testid="trajectory-timeline"]'),
      header: rect('thead tr'),
      firstRow: rect('tbody tr[data-trajectory-row-key]'),
      inspector: rect('aside'),
      inspectorPosition: style('aside', 'position'),
      inspectorHeader: rect('aside > div:nth-of-type(2)'),
      inspectorTabs: rect('[role="tablist"]'),
      eventColumnWidth: Number.parseFloat(style('col:first-child', 'width') || '0'),
      tablePanePaddingBottom: Number.parseFloat(style('[data-trajectory-scroll]', 'padding-bottom') || '0'),
      composer: rect('[data-testid="trajectory-smoke-composer"]'),
      composerVisibility: style('[data-testid="trajectory-smoke-composer"]', 'visibility'),
      composerPointerEvents: style('[data-testid="trajectory-smoke-composer"]', 'pointer-events'),
      semanticColors: {
        timeline: Object.fromEntries(['system', 'user', 'context', 'assistant', 'compacted', 'tool', 'subtool'].map((kind) => [kind, timelineVisual(kind)])),
        tags: Object.fromEntries(['system', 'user', 'context', 'assistant', 'compacted', 'tool', 'subtool'].map((kind) => [kind, tagVisual(kind)])),
        failedTimeline: visual('[data-testid="trajectory-timeline"] [data-trajectory-timeline-span][data-error="true"]')
      },
      mountedRows: document.querySelectorAll('tbody tr[data-trajectory-row-key]').length
    }
  })
}

function assertGeometry(value, context) {
  const exact = (actual, expected, label) => {
    if (actual === null || Math.abs(actual - expected) > 1) {
      throw new Error(`${context.name}: ${label} is ${actual}, expected ${expected}±1`)
    }
  }
  exact(value.toolbar?.height ?? null, 32, 'toolbar height')
  exact(value.timeline?.height ?? null, 50, 'timeline height')
  if (value.appRegion !== 'no-drag') {
    throw new Error(`${context.name}: trajectory inherited Electron drag hit-testing (${value.appRegion})`)
  }
  if (context.scenario !== 'empty' && context.scenario !== 'loading') {
    exact(value.header?.height ?? null, 30, 'table header height')
    exact(value.firstRow?.height ?? null, 30, 'table row height')
    if (context.scenario !== 'unselected') {
      exact(value.inspectorHeader?.height ?? null, 42, 'inspector header height')
      exact(value.inspectorTabs?.height ?? null, 34, 'inspector tabs height')
    }
    exact(value.tablePanePaddingBottom, 16, 'hidden composer clearance')
  }
  if (context.scenario === 'unselected' && value.inspector !== null) {
    throw new Error(`${context.name}: inspector opened before the user selected a record`)
  }
  if (value.composerVisibility !== 'hidden' || value.composerPointerEvents !== 'none') {
    throw new Error(`${context.name}: hidden Composer still participates in layout or pointer hit-testing`)
  }
  if (!['empty', 'loading', 'long'].includes(context.scenario)) assertSemanticColors(value, context)
  if (context.bounds.width === TABLE_BREAKPOINT.width && value.eventColumnWidth > 51) {
    throw new Error(`${context.name}: compact Event column is ${value.eventColumnWidth}px`)
  }
  if (context.bounds.width === OVERLAY_BREAKPOINT.width) {
    if (value.inspectorPosition !== 'absolute') throw new Error(`${context.name}: inspector is not an overlay`)
    if ((value.inspector?.width ?? 0) > 421) throw new Error(`${context.name}: overlay inspector is too wide`)
  }
  if (context.scenario === 'long' && value.mountedRows > 48) {
    throw new Error(`${context.name}: virtualization mounted ${value.mountedRows} rows`)
  }
}

function assertSemanticColors(value, context) {
  const timeline = value.semanticColors.timeline
  const tags = value.semanticColors.tags
  const timelinePaints = ['system', 'user', 'context', 'tool'].map((kind) => timeline[kind]?.backgroundColor)
  if (timelinePaints.some((paint) => !paint || transparent(paint)) || new Set(timelinePaints).size !== 4) {
    throw new Error(`${context.name}: timeline role colors are not distinct: ${JSON.stringify(timelinePaints)}`)
  }
  if (!timeline.assistant?.backgroundImage?.includes('linear-gradient')) {
    throw new Error(`${context.name}: Assistant timing is missing its TTFT/decoding gradient`)
  }
  const tagPaints = ['user', 'context', 'assistant', 'tool', 'subtool'].map((kind) => `${tags[kind]?.color}|${tags[kind]?.backgroundColor}`)
  if (tagPaints.some((paint) => paint.includes('undefined') || paint.includes('rgba(0, 0, 0, 0)')) || new Set(tagPaints).size !== 5) {
    throw new Error(`${context.name}: ledger tag colors are not distinct: ${JSON.stringify(tagPaints)}`)
  }
  if (context.scenario === 'failed') {
    const failed = value.semanticColors.failedTimeline?.backgroundColor
    if (!failed || transparent(failed) || failed === timeline.tool?.backgroundColor) {
      throw new Error(`${context.name}: failed timeline span did not override role color`)
    }
  }
}

function transparent(value) {
  return !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)'
}

function diagnostics(rendererOutput, electronOutput) {
  const messages = [rendererOutput.trim() && `Renderer output:\n${rendererOutput.trim()}`, electronOutput.trim() && `Electron output:\n${electronOutput.trim()}`].filter(Boolean)
  return messages.length ? `\n\n${messages.join('\n\n')}` : ''
}
function tail(existing, chunk) { return `${existing}${String(chunk)}`.slice(-64 * 1024) }
async function withTimeout(operation, timeoutMs, description) {
  let timeout
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out while ${description}`)), timeoutMs) })])
  } finally { if (timeout) clearTimeout(timeout) }
}
async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise) })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  if (!port) throw new Error('Could not allocate a trajectory smoke port')
  return port
}
async function waitForPortOpen(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Renderer exited before port ${port} opened`)
    if (await isPortOpen(port)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for renderer port ${port}`)
}
function isPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (open) => { if (settled) return; settled = true; socket.destroy(); resolvePromise(open) }
    socket.setTimeout(250, () => finish(false)); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.unref()
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
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

module.exports = { assertGeometry }
