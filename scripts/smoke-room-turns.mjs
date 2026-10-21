import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer } from 'vite'

// Native Electron check of the private-chat turn UI: the production timeline,
// message rows, work trail, result card and composer, fed offline run steps.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const evidence = resolve(process.env.KUN_ROOM_TURNS_EVIDENCE || 'dist/room-turns')
const temporary = await mkdtemp(join(tmpdir(), 'kun-room-turns-'))
await mkdir(evidence, { recursive: true })
let electron, page, server
const errors = []
try {
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `
const { app, BrowserWindow } = require('electron')
app.setPath('userData', ${JSON.stringify(join(temporary, 'user-data'))})
app.setPath('appData', ${JSON.stringify(temporary)})
app.commandLine.appendSwitch('force-device-scale-factor', '1.5')
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1100, height: 1000, show: true, webPreferences: { contextIsolation: true, sandbox: true } })
  window.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ executablePath: require('electron'), args: [main], env, chromiumSandbox: true, timeout: 90_000 })
  page = await electron.firstWindow()
  page.on('pageerror', (error) => { errors.push(error.stack || error.message) })
  // Scan the fixture up front: a dependency found mid-load re-optimizes and leaves two React copies.
  server = await createServer({ configFile: false, root, esbuild: { jsx: 'automatic' }, cacheDir: join(temporary, 'vite'),
    optimizeDeps: { entries: ['src/renderer/src/components/rooms/RoomTurnSmokeFixture.tsx'] },
    resolve: { dedupe: ['react', 'react-dom'],
      alias: { '@renderer': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') } },
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'room-turn-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/__room_turns')) return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__room_turns', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/renderer/src/components/rooms/RoomTurnSmokeFixture.tsx"></script></body></html>'))
      })
    } }] })
  await server.listen()
  await page.goto(`${server.resolvedUrls.local[0]}__room_turns`, { timeout: 90_000 })
  const chips = page.locator('.room-turn-trail-chip')
  await chips.first().waitFor({ timeout: 90_000 })
  await page.locator('.room-turn-result').waitFor()

  // One header per turn: the finished turn's three messages share one avatar row.
  const headers = await page.locator('.rooms-message-member:not(.rooms-message-continuation):not(.rooms-agent-activity)').count()
  assert.equal(headers, 2, 'each run gets one header')
  assert.match(await page.locator('.room-turn-clock').first().innerText(), /用时 4 分 13 秒/)
  assert.equal(await page.locator('.rooms-message-user .rooms-avatar').evaluateAll((items) =>
    items.filter((item) => getComputedStyle(item).display !== 'none').length), 0, 'own messages carry no avatar')

  // Finished segments start folded; the live one opens because a step failed and one runs.
  assert.equal(await chips.count(), 3)
  assert.deepEqual(await chips.evaluateAll((items) => items.map((item) => item.getAttribute('aria-expanded'))), ['false', 'false', 'true'])
  assert.match(await chips.nth(0).innerText(), /执行 3 条命令/)
  assert.match(await chips.nth(1).innerText(), /改动 1 个文件/)
  assert.match(await page.locator('.room-turn-decision').innerText(), /你允许了/)
  assert.equal(await page.locator('.room-turn-step.is-failed').count(), 1)
  assert.equal(await page.locator('.room-turn-step.is-running').count(), 1)
  await screenshot('light-collapsed')

  await chips.nth(0).click()
  assert.equal(await chips.nth(0).getAttribute('aria-expanded'), 'true')
  assert.equal(await page.locator('.room-turn-step').count(), 4 + 3)
  await page.locator('.rooms-timeline-scroll').evaluate((element) => { element.scrollTop = 0 })
  await page.waitForTimeout(100)
  await screenshot('light-finished-turn')

  // The result card counts work and opens the run.
  const result = page.locator('.room-turn-result')
  assert.match(await result.innerText(), /完成/)
  assert.deepEqual(await result.locator('dd').allInnerTexts(), ['6', '1', '1'])
  assert.match(await result.locator('.room-turn-result-files').innerText(), /清理清单\.md/)
  await result.getByRole('button').click()
  assert.deepEqual(await page.evaluate(() => window.roomTurnFixture.opened), ['run-clean'])

  // A responding private chat steers from the composer and stops with a labeled button.
  assert.equal(await page.locator('.rooms-composer-shortcuts').count(), 0)
  assert.match(await page.locator('.rooms-rich-input').getAttribute('data-placeholder') ?? await page.locator('.rooms-composer').innerText(), /并入当前回复/)
  assert.equal(await page.getByRole('button', { name: '停止当前响应', exact: true }).innerText(), '停止')
  await screenshot('light-expanded')

  await page.evaluate(() => window.roomTurnFixture.theme('dark'))
  await page.waitForTimeout(150)
  await screenshot('dark')
  await page.evaluate(() => window.roomTurnFixture.theme('light'))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(420, 900))
  await page.waitForFunction(() => innerWidth === 420)
  assert.ok(await page.locator('[data-rooms-workspace]').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'no horizontal overflow when narrow')
  await screenshot('narrow')
  assert.deepEqual(errors, [], 'no renderer errors')
  console.log('PASS: one header per turn, folded work trail, decision line, result card, steer placeholder and labeled stop')
} catch (error) {
  if (page && !page.isClosed()) {
    await screenshot('failure').catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  console.error(errors.join('\n'))
  throw error
} finally {
  await electron?.close(); await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
async function screenshot(name) { await page.screenshot({ path: join(evidence, `${name}.png`) }) }
