import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer } from 'vite'

// Real native Electron production components with an offline host boundary.
// This does not install an external agent, log in, or send a model request.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const evidence = resolve(process.env.KUN_ENABLEMENT_EVIDENCE || 'dist/agent-enablement')
const temporary = await mkdtemp(join(tmpdir(), 'kun-agent-enablement-'))
await mkdir(evidence, { recursive: true })
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const report = { sourceRevision: git('rev-parse', 'HEAD'), nativePlatform: process.platform,
  sourceDiff: git('diff', '--name-only', 'HEAD', '--', 'src', 'kun', 'scripts', '.github/workflows'),
  fixture: 'Production SettingsView, persistence and composer picker; offline host readiness fixtures, no real authentication or quota validation',
  scaleMethod: 'Native Electron webContents.setZoomFactor; no CSS transform or DPR emulation',
  started: new Date().toISOString(), assertions: [], screenshots: [], screenshotDetails: [], measurements: [], viewports: [],
  pageErrors: [], blockedRequests: [], status: 'running' }
let electron, page, server
try {
  if (process.env.KUN_ENABLEMENT_EXPECTED_SHA) {
    assert.equal(report.sourceRevision, process.env.KUN_ENABLEMENT_EXPECTED_SHA, 'Run the published exact head')
    assert.equal(report.sourceDiff, '', 'Native evidence requires an unchanged published source tree')
  }
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `
const { app, BrowserWindow, session } = require('electron')
app.setPath('userData', ${JSON.stringify(join(temporary, 'user-data'))})
app.setPath('appData', ${JSON.stringify(temporary)})
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  const window = new BrowserWindow({ width: 1280, height: 1000, show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ executablePath: require('electron'), args: [main], env,
    chromiumSandbox: true, timeout: 90_000 })
  page = await electron.firstWindow()
  page.on('pageerror', error => report.pageErrors.push(error.stack || error.message))
  server = await createServer({ configFile: false, root, esbuild: { jsx: 'automatic' },
    cacheDir: join(temporary, 'vite'),
    optimizeDeps: { entries: [resolve(root, 'src/renderer/src/components/ade/AgentEnablementSmokeFixture.tsx')],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
        'react-i18next', 'i18next', 'zustand', 'yaml', 'lucide-react'], holdUntilCrawlEnd: true },
    resolve: { alias: { '@renderer': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared'),
      '@kun/extension-api': resolve(root, 'packages/extension-api/src/index.ts'),
      '@kun/provider-catalog': resolve(root, 'packages/provider-catalog/src/index.ts') } },
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'agent-enablement-fixture',
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith('/__agent_enablement')) return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__agent_enablement', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/renderer/src/components/ade/AgentEnablementSmokeFixture.tsx"></script></body></html>'))
        })
      }
    }] })
  await server.listen()
  const origin = new URL(server.resolvedUrls.local[0]).origin
  await page.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url === 'about:blank') return route.continue()
    report.blockedRequests.push(url)
    return route.abort('blockedbyclient')
  })
  await page.goto(`${origin}/__agent_enablement?platform=${process.platform}`, { timeout: 90_000 })
  await panel().waitFor({ timeout: 90_000 })
  await reset()
  assert.deepEqual(await menuIds(), ['kun'])
  report.assertions.push('Disabled external agents and retired Gemini are absent from the composer')
  await screenshot('disabled')
  await screenshotMenu('disabled-composer-menu')

  await page.evaluate(() => window.agentEnablementFixture.setOutcome('success'))
  await panel().locator('[data-agent-profile-model]').fill('fixture-model')
  await enable().click()
  await state('ready')
  assert.ok((await menuIds()).includes('pi'))
  assert.ok(!(await menuIds()).includes('deepseek-harness'))
  report.assertions.push('A successful explicit Pi check enables only the selected profile')
  await screenshot('pi-enabled')
  await screenshotMenu('pi-composer-menu')
  assert.equal((await snapshot()).enabledProfiles.length, 1)
  assert.equal((await snapshot()).defaults.pi.model, 'fixture-model')
  assert.ok((await snapshot()).calls.mutations > 0, 'Enablement reached the persisted settings host')
  await page.evaluate(() => window.agentEnablementFixture.close())
  await panel().waitFor({ state: 'detached' })
  await page.evaluate(() => window.agentEnablementFixture.reopen())
  await state('ready')
  report.assertions.push('Production SettingsView persists explicit opt-in across closing and reopening')
  await page.evaluate(() => window.agentEnablementFixture.restart())
  await state('needs-check')
  assert.deepEqual(await menuIds(), ['kun'])
  await panel().locator('[data-agent-recheck]').click()
  await state('ready')
  assert.ok((await menuIds()).includes('pi'))
  report.assertions.push('Runtime restart retains consent but excludes the profile until readiness is revalidated')
  await enable().click()
  await state('disabled')
  assert.deepEqual(await menuIds(), ['kun'])
  report.assertions.push('Disabling removes Pi from new composer selections immediately')

  await page.evaluate(() => window.agentEnablementFixture.setOutcome('failure'))
  await enable().click()
  await state('failed')
  await panel().getByRole('alert').waitFor()
  assert.deepEqual(await menuIds(), ['kun'])
  await screenshot('readiness-failed')
  report.assertions.push('A failed readiness check stays disabled and displays remediation')

  await reset()
  await page.evaluate(() => window.agentEnablementFixture.setOutcome('pending'))
  const beforeRepeated = await page.evaluate(() => window.agentEnablementFixture.snapshot().calls.tests)
  await enable().evaluate(button => { button.click(); button.click() })
  await state('checking')
  await page.waitForFunction(expected => window.agentEnablementFixture.snapshot().calls.tests === expected, beforeRepeated + 1)
  await screenshot('checking-cancellable')
  await panel().locator('[data-agent-enable-cancel]').click()
  await page.evaluate(() => window.agentEnablementFixture.resolvePending(true))
  await settled()
  await state('disabled')
  assert.equal((await snapshot()).enabledProfiles.length, 0)
  report.assertions.push('Repeated clicks create one check; cancel rejects a late successful response')

  await pendingCheck()
  await panel().locator('[data-agent-profile-model]').fill('different-model')
  await page.evaluate(() => window.agentEnablementFixture.resolvePending(true))
  await settled()
  assert.equal((await snapshot()).enabledProfiles.length, 0)
  await screenshot('edited-profile-stale-result')
  report.assertions.push('Editing the model invalidates an in-flight profile check')

  await reset()
  await pendingCheck()
  await panel().locator('[data-agent-profile-mode]').selectOption('kun-gateway')
  await page.evaluate(() => window.agentEnablementFixture.resolvePending(true))
  await settled()
  assert.equal((await snapshot()).enabledProfiles.length, 0)
  report.assertions.push('Switching credential mode cannot enable the old profile')

  await reset()
  await pendingCheck()
  await page.evaluate(() => { window.agentEnablementFixture.setNavigationBusy(true); window.agentEnablementFixture.close() })
  await state('disabled')
  await page.evaluate(() => window.agentEnablementFixture.resolvePending(true))
  await settled()
  assert.equal((await snapshot()).enabledProfiles.length, 0)
  await page.evaluate(() => window.agentEnablementFixture.setNavigationBusy(false))
  await panel().waitFor({ state: 'detached' })
  await settled()
  await page.evaluate(() => window.agentEnablementFixture.reopen())
  await state('disabled')
  assert.equal((await snapshot()).enabledProfiles.length, 0)
  report.assertions.push('Closing settings aborts the check and a late response cannot enable after reopening')

  await reset()
  await pendingCheck()
  await page.evaluate(() => window.agentEnablementFixture.selectAgent('deepseek-harness'))
  await page.locator('[data-agent-enablement="deepseek-harness"]').waitFor()
  await page.evaluate(() => window.agentEnablementFixture.resolvePending(true))
  await settled()
  assert.equal((await snapshot()).enabledProfiles.length, 0)
  report.assertions.push('Switching agents rejects a late response for the previous agent')
  await page.evaluate(() => window.agentEnablementFixture.setOutcome('success'))
  await enable().click()
  await state('ready')
  assert.deepEqual((await menuIds()).sort(), ['deepseek-harness', 'kun'])
  await page.locator('[data-agent-readiness-result]').waitFor()
  assert.match(await page.locator('[data-agent-readiness-result]').innerText(), /not verified|unverified|not tested/i)
  await screenshot('deepseek-enabled-auth-unverified')
  await screenshotMenu('deepseek-composer-menu')
  report.assertions.push('DeepSeek Preview becomes selectable while remote authentication and quota remain explicitly unverified')

  for (const language of ['en', 'zh']) for (const theme of ['light', 'dark']) {
    await page.evaluate(async ({ language, theme }) => {
      await window.agentEnablementFixture.language(language)
      window.agentEnablementFixture.theme(theme)
    }, { language, theme })
    for (const width of [900, 1280]) for (const zoom of [1, 1.5, 2]) {
      await electron.evaluate(({ BrowserWindow }, { width, zoom }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.setContentSize(width, 1000)
        window.webContents.setZoomFactor(zoom)
      }, { width, zoom })
      await settled()
      const native = await electron.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows()[0]
        const bounds = window.getBounds()
        const display = screen.getDisplayMatching(bounds)
        return { content: window.getContentBounds(), window: bounds,
          zoomFactor: window.webContents.getZoomFactor(), displayScaleFactor: display.scaleFactor,
          workArea: display.workArea }
      })
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth }))
      assert.equal(native.zoomFactor, zoom, 'The requested native zoom was applied')
      assert.ok(Math.abs(viewport.width - native.content.width / zoom) <= 1 &&
        Math.abs(viewport.height - native.content.height / zoom) <= 1,
      'Reported CSS viewport matches the actual native content size and zoom')
      assert.ok(viewport.scrollWidth <= viewport.width + 1, 'No horizontal page overflow at native zoom')
      const appearance = await assertTheme(theme)
      const layout = { language, theme, requestedContent: { width, height: 1000 }, native, viewport, zoom, appearance }
      report.viewports.push(layout)
      const controls = panel().locator('button,input,select')
      for (let index = 0; index < await controls.count(); index++) {
        const control = controls.nth(index)
        if (!await control.isVisible()) continue
        const measured = await measureControl(control)
        report.measurements.push({ language, theme, requestedWidth: width, zoom, ...measured })
      }
      // Native macOS can clamp the requested window height to the work area.
      // Name evidence with the measured viewport and scroll each real control,
      // not the oversized panel, so high-zoom captures show the tested action.
      const label = `layout-${language}-${theme}-requested${width}x1000-viewport${viewport.width}x${viewport.height}-zoom${zoom}`
      for (const [target, selector] of [['profile', '[data-agent-profile-mode]'], ['enable', '[data-agent-enable]']]) {
        const control = await measureControl(panel().locator(selector))
        await assertTheme(theme)
        await screenshot(`${label}-${target}`, { ...layout, target, selector, control })
      }
    }
  }
  report.assertions.push('English/Chinese light/dark narrow/wide controls remain named, reachable and unclipped at 100/150/200% native zoom')
  report.assertions.push('Every layout verifies the saved and rendered theme plus opaque computed backgrounds; captures name the actual CSS viewport and show the profile and enablement controls')
  assert.deepEqual(report.pageErrors, [], 'Production components render without exceptions')
  assert.deepEqual(report.blockedRequests, [], 'Offline fixture must not attempt external network requests')
  report.status = 'passed'
  console.log(`PASS: ${report.assertions.length} lifecycle assertions, ${report.screenshots.length} screenshots and ${report.measurements.length} control measurements`)
} catch (error) {
  report.status = 'failed'
  report.failure = error.stack || String(error)
  if (page && !page.isClosed()) {
    await screenshot('failure').catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  console.error(report.failure)
  process.exitCode = 1
} finally {
  report.finished = new Date().toISOString()
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await electron?.close().catch(() => undefined)
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
function panel() { return page.locator('[data-agent-enablement]') }
function enable() { return panel().locator('[data-agent-enable]') }
async function state(value) { await page.waitForFunction(value => document.querySelector('[data-agent-enablement]')?.getAttribute('data-agent-enablement-state') === value, value) }
async function snapshot() { return page.evaluate(() => window.agentEnablementFixture.snapshot()) }
async function settled() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function reset() { await page.evaluate(() => window.agentEnablementFixture.reset()); await state('disabled'); await settled() }
async function pendingCheck() {
  const previous = (await snapshot()).calls.tests
  await page.evaluate(() => window.agentEnablementFixture.setOutcome('pending'))
  await enable().click(); await state('checking')
  await page.waitForFunction(expected => window.agentEnablementFixture.snapshot().calls.tests === expected, previous + 1)
}
async function assertTheme(theme) {
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme)
  const appearance = await page.evaluate(async () => ({
    savedTheme: (await window.kunGui.getSettings()).theme,
    renderedTheme: document.documentElement.dataset.theme,
    backgrounds: ['main', '.ds-settings-surface'].map(selector => ({ selector,
      color: getComputedStyle(document.querySelector(selector)).backgroundColor }))
  }))
  assert.equal(appearance.savedTheme, theme, 'The host persisted the requested theme')
  assert.equal(appearance.renderedTheme, theme, 'SettingsView applied the requested theme')
  for (const background of appearance.backgrounds) {
    const channels = background.color.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/)
    assert.ok(channels, `A measurable RGB background is required: ${background.selector} ${background.color}`)
    assert.equal(Number(channels[4] ?? 1), 1, 'The measured background is opaque')
    const rgb = channels.slice(1, 4).map(Number)
    assert.ok(theme === 'dark' ? Math.max(...rgb) < 128 : Math.min(...rgb) > 192,
      `The ${theme} screenshot must have an actual ${theme} background: ${background.selector} ${background.color}`)
  }
  return appearance
}
async function measureControl(control) {
  await control.scrollIntoViewIfNeeded()
  await settled()
  const measured = await control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const centerX = rect.x + rect.width / 2, centerY = rect.y + rect.height / 2
    const points = [[centerX, centerY], [centerX, rect.top + 2], [centerX, rect.bottom - 2],
      [rect.left + 2, centerY], [rect.right - 2, centerY]]
    const hit = points.every(([x, y]) => {
      const target = document.elementFromPoint(x, y)
      return target === element || element.contains(target)
    })
    const label = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') ||
      element.labels?.[0]?.textContent || (element.tagName === 'BUTTON' ? element.textContent : '')
    return { label, width: rect.width, height: rect.height, left: rect.left, right: rect.right,
      top: rect.top, bottom: rect.bottom, viewport: { width: innerWidth, height: innerHeight }, hit }
  })
  assert.ok(measured.label?.trim(), 'Every visible form control has an accessible name')
  assert.ok(measured.width >= 24 && measured.height >= 24, 'Every control has a usable click target')
  assert.ok(measured.left >= -1 && measured.right <= measured.viewport.width + 1 &&
    measured.top >= -1 && measured.bottom <= measured.viewport.height + 1 && measured.hit,
  `Controls are fully reachable, in the viewport and hit-testable: ${JSON.stringify(measured)}`)
  return measured
}
async function screenshot(name, details) {
  await page.screenshot({ path: join(evidence, `${name}.png`) })
  report.screenshots.push(`${name}.png`)
  if (details) report.screenshotDetails.push({ file: `${name}.png`, ...details })
}
async function menuIds() {
  await page.locator('[data-agent-smoke-picker] button').first().click()
  await page.locator('[data-harness-picker-menu]').waitFor()
  const ids = await page.locator('[data-harness-picker-menu] [data-harness-id]').evaluateAll(elements => elements.map(element => element.dataset.harnessId))
  await page.keyboard.press('Escape')
  await page.locator('[data-harness-picker-menu]').waitFor({ state: 'detached' })
  return ids
}

async function screenshotMenu(name) {
  await page.locator('[data-agent-smoke-picker] button').first().click()
  await page.locator('[data-harness-picker-menu]').waitFor()
  await screenshot(name)
  await page.keyboard.press('Escape')
  await page.locator('[data-harness-picker-menu]').waitFor({ state: 'detached' })
}
