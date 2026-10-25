import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer } from 'vite'

// Real Electron layout/scroll/reveal regression coverage with synthetic host
// data. No user profile, runtime, model account, or network service is used.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(repository, 'node_modules/.kun-chat-rendering-'))
const evidence = resolve(process.env.KUN_CHAT_RENDERING_EVIDENCE || 'dist/chat-rendering')
const metrics = [], errors = []
let server, application, page, fatal
const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<style>html,body,#root{height:100%;margin:0;overflow:hidden}
.fixture-shell{height:100%;display:flex;flex-direction:column;background:var(--ds-bg-main);color:var(--ds-text-primary)}
.fixture-shell>header{padding:12px 24px;flex:none;border-bottom:1px solid var(--ds-border);font:13px/1.5 sans-serif}
.fixture-stage{display:flex;flex:1;min-height:0;flex-direction:column}
[data-testid=reveal-output]{padding:24px;overflow:auto}
</style></head><body><div id="root"></div>
<script type="module" src="/scripts/fixtures/chat-rendering.tsx"></script></body></html>`

try {
  await mkdir(evidence, { recursive: true })
  server = await createServer({
    configFile: false, root: repository, cacheDir: join(temporary, 'vite-cache'),
    esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: [] }, css: { postcss: repository },
    resolve: { alias: {
      '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared'),
      '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
      '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts'),
      '@kun/extension-react': resolve(repository, 'packages/extension-react/src/index.ts')
    } },
    server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
    plugins: [{ name: 'chat-rendering-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__chat_rendering') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__chat_rendering', html))
      })
    } }]
  })
  await server.listen()
  const origin = new URL(server.resolvedUrls.local[0]).origin
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(()=>{const win=new BrowserWindow({width:1040,height:820,show:true,
webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  application = await _electron.launch({ executablePath: require('electron'), args: [main], env, timeout: 60_000 })
  page = await application.firstWindow({ timeout: 60_000 })
  page.on('pageerror', error => errors.push(error.stack || error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.context().route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'))
  page.setDefaultTimeout(15_000)
  await page.goto(origin + '/__chat_rendering', { timeout: 60_000 })
  await page.waitForFunction(() => window.chatRenderingFixture?.ready, null, { timeout: 120_000 })
  const scroll = page.locator('.fixture-stage .overflow-y-auto').first()
  const settle = () => page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150)))))
  const inspect = () => scroll.evaluate(element => ({
    top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight,
    rows: element.querySelectorAll('[data-timeline-virtual-row]').length,
    blocks: element.querySelectorAll('[data-timeline-block-id]').length,
    nodes: element.querySelectorAll('*').length
  }))
  await scroll.waitFor()
  await settle()
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  await settle()
  const initial = await inspect()
  assert.ok(initial.rows > 0 && initial.rows < 100, `500 records should mount bounded rows: ${JSON.stringify(initial)}`)
  assert.ok(initial.height > initial.viewport * 3, 'Virtualized content must retain its scroll extent')
  assert.ok(initial.height - initial.top - initial.viewport < 120, 'Initial long task must reach its latest content')
  metrics.push({ scenario: '500-record-tail', ...initial })
  await page.screenshot({ path: join(evidence, 'long-task-tail.png') })

  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight / 2 })
  await settle()
  const middle = await inspect()
  assert.ok(middle.rows > 0 && middle.rows < 100, 'Middle of long task must stay bounded and nonempty')
  await page.evaluate(() => window.chatRenderingFixture.append(20))
  await settle()
  const appended = await inspect()
  assert.ok(Math.abs(appended.top - middle.top) < 100, `Appending must preserve an upward-scrolled reader: ${middle.top} -> ${appended.top}`)
  metrics.push({ scenario: 'reading-while-appending', before: middle, after: appended })
  await page.screenshot({ path: join(evidence, 'long-task-reading.png') })

  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  await settle()
  await page.evaluate(() => window.chatRenderingFixture.append(20))
  await settle()
  const followed = await inspect()
  assert.ok(followed.height - followed.top - followed.viewport < 120, 'Following latest must survive appended virtual rows')
  metrics.push({ scenario: 'follow-latest', ...followed })
  await page.evaluate(() => window.chatRenderingFixture.load(500, 'chat-b'))
  await settle()
  assert.equal(await page.locator('[data-timeline-block-id^="chat-a-"]').count(), 0, 'Switching chats must never retain old chat content')
  await page.evaluate(() => window.chatRenderingFixture.load(540, 'chat-a'))
  await settle()
  assert.equal(await page.locator('[data-timeline-block-id^="chat-b-"]').count(), 0)

  // Keep the same mounted list when changing zoom, then verify coverage at
  // both the middle and tail. Scroll extent alone misses blank virtual rows.
  for (const scale of [0.82, 1, 1.2]) {
    await page.evaluate(scale => window.chatRenderingFixture.zoom(scale), scale)
    const viewport = page.getByTestId('zoom-viewport')
    await viewport.waitFor()
    await settle()
    for (const position of ['middle', 'tail']) {
      await viewport.evaluate((element, position) => {
        element.scrollTop = position === 'tail' ? element.scrollHeight : element.scrollHeight / 2
      }, position)
      await settle()
      const layout = await viewport.evaluate(element => {
        const list = element.querySelector('[data-timeline-virtual-list]')
        const rows = [...list.children]
        const bounds = element.getBoundingClientRect(), listBounds = list.getBoundingClientRect()
        const first = rows[0]?.getBoundingClientRect(), last = rows.at(-1)?.getBoundingClientRect()
        return {
          scale: Number.parseFloat(getComputedStyle(document.body).zoom),
          rows: rows.length, firstIndex: rows[0]?.dataset.index, lastIndex: rows.at(-1)?.dataset.index,
          startGap: first ? Math.max(0, first.top - Math.max(bounds.top, listBounds.top)) : Infinity,
          endGap: last ? Math.max(0, Math.min(bounds.bottom, listBounds.bottom) - last.bottom) : Infinity,
          statusGap: last ? element.querySelector('[data-testid="zoom-status"]').getBoundingClientRect().top - last.bottom : Infinity
        }
      })
      const context = `${scale} zoom ${position}: ${JSON.stringify(layout)}`
      assert.equal(layout.scale, scale, context)
      assert.ok(layout.rows > 0 && layout.rows < 80, `Virtual rows must stay bounded: ${context}`)
      assert.ok(layout.startGap < 2 && layout.endGap < 2, `Rows must cover the visible list: ${context}`)
      if (position === 'tail') {
        assert.equal(layout.lastIndex, '149', `The final record must be mounted: ${context}`)
        assert.ok(Math.abs(layout.statusGap) < 2, `No blank space before live status: ${context}`)
      }
      metrics.push({ scenario: `zoom-${position}`, ...layout })
      await page.screenshot({ path: join(evidence, `zoom-${scale}-${position}.png`) })
    }
  }
  await page.evaluate(() => window.chatRenderingFixture.zoom(1))

  await page.evaluate(() => window.chatRenderingFixture.text('Live start.'))
  await page.getByTestId('reveal-output').waitFor()
  const burst = 'Live start.' + 'Background result. '.repeat(600) + 'LATEST_RESULT'
  const started = Date.now()
  await page.evaluate(text => window.chatRenderingFixture.text(text), burst)
  await page.waitForFunction(() => document.querySelector('[data-testid="reveal-output"]')?.textContent?.includes('LATEST_RESULT'), null, { timeout: 2_000 })
  metrics.push({ scenario: 'large-live-burst', milliseconds: Date.now() - started, characters: burst.length })
  // Playwright forces a focused, visible page by default. Disable its CDP
  // emulation so this check observes the real Electron window visibility.
  const visibilitySession = await page.context().newCDPSession(page)
  await visibilitySession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
  // Other debugger sessions may still force document visibility. Record the
  // observed state; hidden-document scheduling is also covered by hook tests.
  const hiddenDocument = await page.evaluate(() => document.hidden)
  await page.evaluate(text => window.chatRenderingFixture.text(text + ' Hidden addition. '.repeat(20) + 'HIDDEN_RESULT'), burst)
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true)
  await page.waitForFunction(() => document.querySelector('[data-testid="reveal-output"]')?.textContent?.includes('HIDDEN_RESULT'), null, { timeout: 1_000 })
  metrics.push({ scenario: 'hide-update-show', hiddenDocument, passed: true })
  await page.evaluate(() => window.chatRenderingFixture.text('Final result.', false))
  await page.waitForFunction(() => document.querySelector('[data-testid="reveal-output"]')?.textContent === 'Final result.')
  assert.deepEqual(errors, [], 'Production components must not throw in the real renderer')
} catch (error) {
  fatal = error.stack || String(error)
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
  process.exitCode = 1
} finally {
  const report = { status: fatal ? 'failed' : 'passed', engine: 'native-electron', metrics, errors, ...(fatal ? { fatal } : {}) }
  await mkdir(evidence, { recursive: true })
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await application?.close().catch(() => undefined)
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
