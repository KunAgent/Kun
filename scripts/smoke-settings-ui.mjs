import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { _electron } from 'playwright-core'
import { createServer, optimizeDeps } from 'vite'
import { geometryProblems, measureSettings, newGeometryProblems, worsenedTargetSizes, requiredPolishProblems } from './settings-ui-smoke-geometry.mjs'
import { annotateSettingsTabs } from './settings-ui-smoke-dom.mjs'

// Native offline renderer smoke; no app build, runtime, provider network or secrets.
// node scripts/smoke-settings-ui.mjs [--baseline] [--quick] [--serve]
// KUN_SETTINGS_SOURCE_ROOT selects a complete baseline checkout with the two
// fixture files copied in. Production TSX and CSS both come from that checkout.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const sourceRoot = resolve(process.env.KUN_SETTINGS_SOURCE_ROOT || repository)
const evidence = resolve(process.env.KUN_SETTINGS_EVIDENCE || 'dist/settings-ui-smoke')
// Tailwind resolves content globs relative to cwd. Use the selected source tree
// for its config and class discovery as well as Vite imports.
process.chdir(sourceRoot)
const phase = process.argv.includes('--baseline') ? 'before' : 'after'
const temporary = await mkdtemp(join(tmpdir(), 'kun-settings-smoke-'))
await mkdir(evidence, { recursive: true })
const report = { phase, sourceRoot, nativePlatform: process.platform,
  assertionScope: phase === 'before' ? 'Record baseline findings without requiring fixes'
    : process.env.KUN_SETTINGS_BASELINE_REPORT ? 'Reject new findings; preserve existing baseline findings'
      : 'Require zero geometry/accessibility findings',
  sourceRevision: revision(sourceRoot), started: new Date().toISOString(),
  sourceTrackedDiff: execFileSync('git', ['diff', '--stat', '--', 'src', 'packages', 'tailwind.config.js'],
    { cwd: sourceRoot, encoding: 'utf8' }).trim(),
  scaleMethod: 'Electron webContents.setZoomFactor; no CSS transform or DPR emulation',
  layouts: [], screenshots: [], pageErrors: [], blockedRequests: [], problems: [] }
// Playwright can raise a process-launch rejection outside the awaited call when
// Electron dies before its inspector connects. Preserve evidence without
// suppressing the exception or weakening the native sandbox.
process.on('uncaughtExceptionMonitor', error => {
  report.status = 'failed-before-completion'
  report.finished = new Date().toISOString()
  report.failure = error.stack || String(error)
  writeFileSync(join(evidence, 'failure.txt'), report.failure)
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(evidence, 'screenshots.json'), JSON.stringify(report.screenshots, null, 2))
})
let electron, page, server, cdp
const nativePlatform = process.platform === 'darwin' ? 'darwin' : 'win32'
try {
  server = await fixtureServer()
  const optimized = await optimizeDeps(server.config, true, true)
  report.preoptimizedDependencies = Object.keys(optimized.optimized)
  await server.listen()
  const url = `${server.resolvedUrls.local[0]}__settings?platform=${nativePlatform}`
  if (process.argv.includes('--serve')) {
    console.log(url)
    await new Promise(() => {})
  }
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `
const { app, BrowserWindow, session } = require('electron')
app.setPath('userData', ${JSON.stringify(join(temporary, 'user-data'))})
app.setPath('appData', ${JSON.stringify(temporary)})
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  const window = new BrowserWindow({ width: 1440, height: 1000, show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ executablePath: require('electron'), args: [main],
    env, chromiumSandbox: true, timeout: 90_000 })
  page = await electron.firstWindow()
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message))
  const origin = new URL(url).origin
  await page.route('**/*', async route => {
    const requested = route.request().url()
    if (requested.startsWith(origin + '/') || requested.startsWith('data:') || requested === 'about:blank') {
      return route.continue()
    }
    report.blockedRequests.push(requested)
    return route.abort('blockedbyclient')
  })
  await page.goto(url)
  await page.locator('[data-settings-category-view="general"]').waitFor({ timeout: 90_000 })
  cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  report.fixture = await page.evaluate(() => window.settingsFixture.coverage)
  report.nonSettingsScope = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-settings-smoke-external],[data-settings-smoke-external-switch] button')]
    const properties = ['height', 'width', 'padding', 'fontSize', 'fontWeight', 'lineHeight',
      'borderRadius', 'backgroundColor', 'color', 'borderWidth']
    const snapshot = () => buttons.map(button => ({
      control: Object.fromEntries(properties.map(key => [key, getComputedStyle(button)[key]])),
      track: getComputedStyle(button, '::before').content
    }))
    const enabled = snapshot()
    const sheets = [...document.querySelectorAll('style[data-vite-dev-id]')]
      .filter(element => /settings-(buttons|layout)\.css$/.test(element.dataset.viteDevId))
    for (const element of sheets) element.sheet.disabled = true
    const disabled = snapshot()
    for (const element of sheets) element.sheet.disabled = false
    return { enabled, disabled, checkedStyleSheets: sheets.map(element => element.dataset.viteDevId) }
  })
  assert.deepEqual(report.nonSettingsScope.enabled, report.nonSettingsScope.disabled,
    'Settings styles must not resize or restyle a non-settings sibling control')
  const categories = await page.locator('[data-settings-category]').evaluateAll(elements =>
    elements.map(element => element.getAttribute('data-settings-category')))
  report.categories = categories
  assert.equal(new Set(categories).size, nativePlatform === 'win32' ? 23 : 22,
    'Every destination, including fixture extension settings and Windows-only storage, must be present')
  const sizes = [{ name: 'wide', width: 1440, height: 1000 }, { name: 'small', width: 900, height: 720 }]
  const configurations = []
  for (const theme of ['light', 'dark']) for (const size of sizes) for (const zoom of [1.25, 1.5, 2]) {
    configurations.push({ theme, ...size, zoom })
  }
  for (const config of process.argv.includes('--quick') ? configurations.slice(0, 1) : configurations) {
    await resize(config)
    await page.evaluate(theme => window.settingsFixture.theme(theme), config.theme)
    for (const category of categories) {
      await openCategory(category)
      await inspectPanels(category, config)
    }
    await actionStates(config)
  }
  assert.deepEqual(report.pageErrors, [], 'The actual SettingsView must render without renderer exceptions')
  assert.deepEqual(report.blockedRequests, [], 'Fixture must not attempt external network requests')
  if (phase === 'after') {
    report.requiredPolishFindings = requiredPolishProblems(report.layouts)
    assert.deepEqual(report.requiredPolishFindings, [], 'No overflow, reached-control clipping or undersized buttons may remain')
    const baselinePath = process.env.KUN_SETTINGS_BASELINE_REPORT
    const baseline = baselinePath ? JSON.parse(await readFile(baselinePath, 'utf8')) : null
    if (baseline) {
      assert.equal(baseline.status, 'recorded', 'Comparison requires a fully rendered baseline')
      const regressions = [...newGeometryProblems(baseline.problems, report.problems),
        ...worsenedTargetSizes(baseline.layouts, report.layouts)]
      report.baselineComparison = { path: baselinePath, sourceRevision: baseline.sourceRevision,
        previousProblems: baseline.problems.length, regressions }
      assert.equal(report.baselineComparison.regressions.length, 0,
        `${report.baselineComparison.regressions.length} new geometry/accessibility problems; see report.json`)
    } else assert.equal(report.problems.length, 0,
      `${report.problems.length} settings geometry/accessibility problems; see report.json`)
  }
  report.status = phase === 'before' ? 'recorded' : 'passed'
  console.log(`${phase}: ${report.layouts.length} native layouts; ${report.screenshots.length} real screenshots; ${report.problems.length} measured problems`)
} catch (error) {
  report.status = 'failed'
  report.failure = error.stack || String(error)
  await writeFile(join(evidence, 'failure.txt'), report.failure)
  if (page && !page.isClosed()) {
    await captureNativeImage('failure.png').catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  console.error(report.failure)
  process.exitCode = 1
} finally {
  report.finished = new Date().toISOString()
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(join(evidence, 'screenshots.json'), JSON.stringify(report.screenshots, null, 2))
  await electron?.close().catch(() => undefined)
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}

function revision(root) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }
  catch { return 'unavailable' }
}
async function fixtureServer() {
  return createServer({ configFile: false, root: sourceRoot,
    esbuild: { jsx: 'automatic' }, cacheDir: join(temporary, 'vite'),
    optimizeDeps: { entries: [resolve(sourceRoot, 'src/renderer/src/components/SettingsUiSmokeFixture.tsx')],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
        'react-i18next', 'i18next', 'zustand', 'yaml', 'lucide-react'], holdUntilCrawlEnd: true },
    resolve: { alias: {
      '@renderer': resolve(sourceRoot, 'src/renderer/src'),
      '@shared': resolve(sourceRoot, 'src/shared'),
      '@kun/extension-api': resolve(sourceRoot, 'packages/extension-api/src/index.ts'),
      '@kun/provider-catalog': resolve(sourceRoot, 'packages/provider-catalog/src/index.ts')
    } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'actual-settings-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/__settings')) return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__settings', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/renderer/src/components/SettingsUiSmokeFixture.tsx"></script></body></html>'))
      })
    } }]
  })
}
async function resize(config) {
  const bounds = await electron.evaluate(({ BrowserWindow }, config) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(config.width, config.height)
    window.webContents.setZoomFactor(config.zoom)
    return window.getContentBounds()
  }, config)
  await page.waitForFunction(({ bounds, zoom }) => Math.abs(innerWidth - bounds.width / zoom) < 2
    && Math.abs(innerHeight - bounds.height / zoom) < 2, { bounds, zoom: config.zoom })
  await page.waitForTimeout(50)
}
async function settled() {
  await page.locator('[data-testid="settings-section-fallback"]').waitFor({ state: 'detached', timeout: 60_000 })
  await page.waitForTimeout(80)
  assert.ok(await page.locator('[data-settings-category-view]').count(), 'SettingsView must remain mounted')
}
async function openCategory(category) {
  const compact = page.locator('.ds-settings-compact-navigation select')
  if (await compact.isVisible()) await compact.selectOption(category)
  else await page.locator(`[data-settings-category="${category}"]`).click()
  await page.locator(`[data-settings-category-view="${category}"]`).waitFor()
  await settled()
}
async function capture(category, panel, config) {
  const actual = await measureSettings(page, cdp)
  const native = await electron.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { bounds: window.getBounds(), contentBounds: window.getContentBounds(),
      zoom: window.webContents.getZoomFactor() }
  })
  assert.equal(native.zoom, config.zoom)
  const problems = geometryProblems(actual)
  const key = `${config.theme}-${config.name}-${Math.round(config.zoom * 100)}-${category}-${panel}`
    .replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 200)
  const file = `${phase}-${key}.png`
  const pixels = await captureNativeImage(file)
  report.screenshots.push({ file, category, panel, ...config, native, pixels })
  report.layouts.push({ key, category, panel, ...config, native, ...actual, problems })
  for (const problem of problems) report.problems.push({ key, problem })
  // Preserve the actual obscured state for the measured Subagent Profiles
  // blocker. The normal image above deliberately shows the panel's top.
  const obscured = category === 'subagents' && panel.includes('tab-profiles')
    ? actual.controls.find(control => !control.disabled && control.inside && !control.hittable) : null
  if (obscured) {
    await page.locator(`[data-settings-smoke-control="${obscured.id}"]`).evaluate(element =>
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }))
    const file = `${phase}-${key}-obstruction.png`
    const pixels = await captureNativeImage(file)
    report.screenshots.push({ file, category, panel, ...config, native, pixels,
      diagnostic: 'Obscured Subagent Profiles control after ordinary centered scrolling',
      control: obscured.semanticKey, hitTarget: obscured.hitTarget })
  }
  // Keep partial evidence when a later native crash or timeout prevents finish.
  await writeFile(join(evidence, 'progress.json'), JSON.stringify({ layouts: report.layouts.length,
    last: key, problems: report.problems.length, pageErrors: report.pageErrors }, null, 2))
}
async function captureNativeImage(file) {
  const capture = await electron.evaluate(async ({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const contentBounds = window.getContentBounds()
    const displayScale = screen.getDisplayMatching(window.getBounds()).scaleFactor
    const image = await window.webContents.capturePage()
    return { png: image.toPNG().toString('base64'), contentBounds, displayScale,
      nativeImageSize: image.getSize(), zoom: window.webContents.getZoomFactor() }
  })
  const bytes = Buffer.from(capture.png, 'base64')
  const pixelSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  const expected = { width: Math.round(capture.contentBounds.width * capture.displayScale),
    height: Math.round(capture.contentBounds.height * capture.displayScale) }
  await writeFile(join(evidence, file), bytes)
  const { png: _png, ...metadata } = capture
  const result = { ...metadata, pixelSize, expected, method: 'webContents.capturePage().toPNG()' }
  report.nativeCaptures ??= []
  report.nativeCaptures.push({ file, ...result })
  assert.ok(Math.abs(pixelSize.width - expected.width) <= 1 && Math.abs(pixelSize.height - expected.height) <= 1,
    `Native PNG must contain all content pixels: ${JSON.stringify(result)}`)
  return result
}
async function inspectPanels(category, config) {
  const visitedTabs = new Set()
  let index = 0
  await capture(category, 'landing', config)
  while (true) {
    const summaries = page.locator('[data-settings-category-view] details:not([open]) > summary:visible')
    if (await summaries.count()) {
      const target = summaries.first(), text = await target.innerText()
      await target.click()
      await settled()
      await capture(category, `${++index}-disclosure-${text}`, config)
      assert.ok(index < 120, 'Disclosure discovery must terminate')
      continue
    }
    const tabs = await page.locator('[data-settings-category-view] [role="tab"]:visible')
      .evaluateAll(annotateSettingsTabs)
    for (const tab of tabs.filter(tab => tab.selected)) visitedTabs.add(tab.key)
    // Child tablists occur after their parent. Exhaust them before moving to
    // another parent so every discovered nested panel is actually rendered.
    const next = tabs.toReversed().find(tab => !visitedTabs.has(tab.key))
    if (next) {
      visitedTabs.add(next.key)
      const target = page.locator(`[data-settings-smoke-tab="${next.token}"]:visible`)
      await target.click()
      await settled()
      await capture(category, `${++index}-${next.id || next.name}`, config)
      assert.ok(index < 120, 'Tab discovery must terminate')
      continue
    }
    break
  }
  report.layouts.at(-1).discoveredTabs = [...visitedTabs]
}
async function actionStates(config) {
  await openCategory('terminal')
  const sshLabel = await page.evaluate(() => window.settingsFixture.label('sshAddServer', 'Add server'))
  await page.getByRole('button', { name: sshLabel, exact: true }).click()
  const sshDialog = page.getByRole('dialog')
  await sshDialog.waitFor()
  await capture('terminal', 'ssh-add-dialog', config)
  const sshBounds = await sshDialog.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const overlayCoversViewport = sshBounds && Math.abs(sshBounds.x) <= 1 && Math.abs(sshBounds.y) <= 1
    && Math.abs(sshBounds.width - viewport.width) <= 1
    && Math.abs(sshBounds.height - viewport.height) <= 1
  const modalLayout = report.layouts.at(-1)
  modalLayout.modal = { bounds: sshBounds, viewport, overlayCoversViewport }
  if (!overlayCoversViewport) {
    const problem = 'SSH modal overlay does not cover the viewport'
    modalLayout.problems.push(problem)
    report.problems.push({ key: modalLayout.key, problem })
  }
  const cancelLabel = await page.evaluate(() => window.settingsFixture.label('cancel', 'Cancel'))
  await sshDialog.getByRole('button', { name: cancelLabel, exact: true }).click()
  await openCategory('updates')
  const checkLabel = await page.evaluate(() => window.settingsFixture.label('guiUpdateCheck'))
  const check = page.getByRole('button', { name: checkLabel, exact: true })
  await page.evaluate(() => window.settingsFixture.host.setBusy('checkGuiUpdate', true))
  await check.click()
  await page.waitForFunction(() => !!document.querySelector('[data-settings-category-view="updates"] button:disabled'))
  await capture('updates', 'busy-disabled', config)
  await page.evaluate(() => window.settingsFixture.host.setBusy('checkGuiUpdate', false))
  await settled()
  await openCategory('uninstall')
  const labels = await page.evaluate(() => ['uninstallAction', 'uninstallConfirmCancel']
    .map(key => window.settingsFixture.label(key)))
  await page.getByRole('button', { name: labels[0], exact: true }).click()
  await page.getByRole('button', { name: labels[1], exact: true }).waitFor()
  await capture('uninstall', 'destructive-confirm-disabled', config)
  await page.getByRole('button', { name: labels[1], exact: true }).click()
  const destructive = await page.evaluate(() => window.settingsFixture.host.calls
    .filter(call => call.name === 'uninstall.perform'))
  assert.equal(destructive.length, 0, 'Destructive service must never be invoked')
}
