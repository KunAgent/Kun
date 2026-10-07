import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer, normalizePath } from 'vite'
import { agentDispatchUiFixture } from './agent-dispatch-ui-fixture.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const temp = await mkdtemp(join(root, 'node_modules/.kun-dispatch-smoke-'))
const evidence = resolve(process.env.KUN_DISPATCH_EVIDENCE || 'dist/agent-dispatch-smoke')
await mkdir(evidence, { recursive: true })
const fixtureId = normalizePath(join(root, '__agent_dispatch_fixture.tsx'))
const report = { platform: process.platform, fixture: 'Production AgentDispatchGroup and controls; offline HTTP boundary fixture, no real Agent execution',
  startedAt: new Date().toISOString(), status: 'running', assertions: [], screenshots: [], layouts: [], errors: [], externalRequests: [] }
let application, page, server
try {
  server = await createServer({ configFile: false, root, cacheDir: join(temp, 'vite-cache'),
    esbuild: { jsx: 'automatic' }, css: { postcss: root }, optimizeDeps: { entries: [] },
    resolve: { alias: { '@renderer': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared'),
      '@kun/provider-catalog': resolve(root, 'packages/provider-catalog/src/index.ts'),
      '@kun/extension-api': resolve(root, 'packages/extension-api/src/index.ts') } },
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'agent-dispatch-smoke', enforce: 'pre',
      resolveId(id) { if (id === '/__agent_dispatch_fixture.tsx' || id === fixtureId) return fixtureId },
      load(id) { if (id === fixtureId) return agentDispatchUiFixture() },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__agent_dispatch') return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__agent_dispatch',
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/__agent_dispatch_fixture.tsx"></script></body></html>'))
        })
      }
    }] })
  await server.listen()
  const origin = new URL(server.resolvedUrls.local[0]).origin
  const main = join(temp, 'main.cjs')
  await writeFile(main, `const { app, BrowserWindow, session } = require('electron');
app.setPath('userData', ${JSON.stringify(join(temp, 'user-data'))});
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({ width: 1000, height: 820, show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.loadURL('about:blank');
}); app.on('window-all-closed', () => app.quit());`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  application = await _electron.launch({ executablePath: require('electron'), args: [main], env, timeout: 90_000 })
  page = await application.firstWindow(); page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => report.errors.push(error.stack || error.message))
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url === 'about:blank') return route.continue()
    report.externalRequests.push(url); return route.abort('blockedbyclient')
  })
  await page.goto(origin + '/__agent_dispatch', { timeout: 90_000 })
  await card().waitFor({ timeout: 90_000 }); await settled()
  const id = await card().getAttribute('data-intent-id')
  assert.match(await controls().innerText(), /\b(?:[1-5]?\d|60)s\b/)
  await controls().locator('button').nth(1).click()
  await page.waitForFunction(() => window.dispatchFixture.snapshot().state === 'paused')
  assert.equal(await card().getAttribute('data-intent-id'), id)
  assert.equal(await page.locator('textarea').count(), 1)
  await page.locator('textarea').fill('Adjusted task with scoped acceptance checks.')
  await card().locator('input').fill('Adjusted task')
  await card().locator('button').first().click()
  await controls().locator('[role="status"]').waitFor()
  await page.waitForFunction(() => window.dispatchFixture.snapshot().state === 'countdown')
  await page.locator('textarea').waitFor({ state: 'detached' })
  assert.equal((await snapshot()).recommendation.task, 'Adjusted task with scoped acceptance checks.')
  assert.equal(await card().getAttribute('data-intent-id'), id)
  report.assertions.push('Adjust pauses on the host boundary before editing; save resets the 60-second window while preserving card identity')

  await page.evaluate(() => window.dispatchFixture.delay(200))
  const before = await page.evaluate(() => window.dispatchFixture.calls.length)
  await controls().locator('button').first().evaluate((button) => { button.click(); button.click() })
  await page.waitForFunction(() => window.dispatchFixture.snapshot().state === 'queued')
  assert.equal(await page.evaluate(() => window.dispatchFixture.calls.length), before + 1)
  await page.evaluate(() => { window.dispatchFixture.delay(0); window.dispatchFixture.state('running') })
  await controls().locator('[role="status"]').waitFor()
  assert.equal(await card().getAttribute('data-intent-id'), id)
  assert.ok(await card().locator('button').count() >= 2)
  await screenshot('running-with-process-link')
  await page.evaluate(() => window.dispatchFixture.state('completed'))
  await page.getByText('Focused checks passed. The parent Agent reviewed the result.').waitFor()
  assert.equal(await card().getAttribute('data-intent-id'), id)
  report.assertions.push('Repeated start clicks send one action; queued/running/result updates reuse the card and provide a process link')

  await page.evaluate(() => { window.dispatchFixture.scenario('reviewing'); window.dispatchFixture.deny() })
  await controls().locator('[role="alert"]').waitFor()
  assert.equal(await controls().locator('button').count(), 0)
  await screenshot('automatic-review-denied')
  report.assertions.push('A rejected automatic review displays its reason and does not become a waiting confirmation')
  await page.evaluate(() => window.dispatchFixture.scenario('pending_confirmation'))
  assert.equal(await controls().locator('button').count(), 3)
  await controls().locator('button').last().click()
  await page.waitForFunction(() => window.dispatchFixture.snapshot().state === 'cancelled')
  assert.equal(await controls().locator('button').count(), 0)
  report.assertions.push('Manual mode exposes confirmation and cancellation; a cancelled card has no execution control')

  for (const language of ['en', 'zh']) for (const theme of ['light', 'dark']) for (const width of [420, 1000]) for (const zoom of [1, 2]) {
    await page.evaluate(async ({ language, theme }) => {
      window.dispatchFixture.scenario('countdown'); window.dispatchFixture.theme(theme); await window.dispatchFixture.language(language)
    }, { language, theme })
    await application.evaluate(({ BrowserWindow }, { width, zoom }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(width, 820); window.webContents.setZoomFactor(zoom)
    }, { width, zoom })
    await settled()
    // A narrow zoomed card can require vertical scrolling. Capture its actual
    // actions after scrolling them into view, not a header-only screenshot.
    await controls().scrollIntoViewIfNeeded()
    await settled()
    const measurements = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll('[data-agent-dispatch-controls] button')].map((button) => {
        const bounds = button.getBoundingClientRect(); return { text: button.textContent, x: bounds.x, y: bounds.y,
          width: bounds.width, height: bounds.height, scrollWidth: button.scrollWidth, clientWidth: button.clientWidth }
      }) }))
    assert.ok(measurements.scrollWidth <= measurements.viewport.width + 1, 'No horizontal overflow')
    for (const control of measurements.controls) {
      assert.ok(control.x >= 0 && control.x + control.width <= measurements.viewport.width + 1, 'Controls remain in the narrow viewport')
      assert.ok(control.y >= 0 && control.y + control.height <= measurements.viewport.height + 1, 'Controls are visible after native scrolling')
      assert.ok(control.scrollWidth <= control.clientWidth + 1, 'Control labels remain unclipped')
    }
    report.layouts.push({ language, theme, requestedWidth: width, nativeZoom: zoom, ...measurements })
    await screenshot(`${language}-${theme}-requested${width}-zoom${zoom}-controls`)
  }
  report.assertions.push('English and Chinese long-name cards remain horizontally contained with reachable controls at narrow/wide native windows and 100/200% native Electron zoom')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, [])
  report.status = 'passed'; console.log(`PASS: ${report.assertions.length} assertions; ${report.layouts.length} layouts; ${report.screenshots.length} native captures`)
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1
  if (page && !page.isClosed()) await screenshot('failure').catch(() => undefined)
  console.error(report.failure)
} finally {
  report.finishedAt = new Date().toISOString(); await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await application?.close().catch(() => undefined); await server?.close(); await rm(temp, { recursive: true, force: true })
}
function card() { return page.locator('[data-agent-dispatch-card]') }
function controls() { return page.locator('[data-agent-dispatch-controls]') }
async function snapshot() { return page.evaluate(() => window.dispatchFixture.snapshot()) }
async function settled() { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))) }
async function screenshot(name) {
  const path = join(evidence, name + '.png')
  const png = await application.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  await writeFile(path, Buffer.from(png, 'base64')); report.screenshots.push(path)
}
