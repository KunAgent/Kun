import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'
import { createServer } from 'vite'
import { build } from 'esbuild'
import { assertWorkAssistantPalette } from './work-assistant-palette.mjs'

// Genuine sandboxed Electron; only preload/session/filesystem data is synthetic.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-work-assistant-'))
const evidence = resolve(process.env.KUN_WORK_ASSISTANT_EVIDENCE || 'dist/work-assistant-smoke')
const fixture = join(repository, 'scripts/fixtures/work-assistant-ui.tsx')
const compileOnly = process.argv.includes('--compile-only')
const errors = [], externalRequests = [], checks = [], paletteChecks = []
let server, application, page, status = 'failed'
await mkdir(evidence, { recursive: true })
const reportPath = join(evidence, compileOnly ? 'compile-report.json' : 'report.json')
const report = () => ({ status, platform: process.platform,
  scope: 'Production assistant, right-panel host, paper library/navigation in native Electron; offline synthetic IPC and session data',
  exclusions: ['Full application startup/preload ownership stack', 'Real filesystem persistence (unit/integration coverage)', 'Live model requests, paid calls and actual user data'],
  checks, errors, externalRequests, paletteChecks })
await writeFile(reportPath, JSON.stringify({ ...report(), status: 'starting' }, null, 2))
process.on('uncaughtExceptionMonitor', error => {
  errors.push(error.stack || String(error))
  writeFileSync(reportPath, JSON.stringify(report(), null, 2))
})
const alias = { '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared'),
  '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
  '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts') }
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><style>
/* Fixture framing only; actual controls and assistant styles are production. */
html,body,#root{height:100%;margin:0}.fixture-shell{height:100%;display:flex;flex-direction:column;background:var(--ds-bg-main);color:var(--ds-text)}
.fixture-evidence-label{display:block;padding:4px 12px;font:10px/1.5 system-ui;color:var(--ds-text-muted);border-bottom:1px solid var(--ds-border)}
.fixture-workbench{display:flex;flex:1;min-height:0;min-width:0}.fixture-sidebar{display:flex;flex-direction:column;width:238px;flex-shrink:0;border-right:1px solid var(--ds-border);padding:6px 8px;background:var(--ds-bg-sidebar);overflow:auto}
.fixture-main{display:flex;flex:1;min-width:0;min-height:0;overflow:hidden}@media(max-width:700px){.fixture-sidebar{display:none}}
</style><script type="module" src="/scripts/fixtures/work-assistant-ui.tsx"></script></body></html>`
try {
  if (compileOnly) {
    await build({ entryPoints: [fixture], bundle: true, platform: 'browser', format: 'esm', write: false,
      outdir: temporary, jsx: 'automatic', conditions: ['development'], alias, plugins: [{ name: 'vite-url-assets', setup(builder) {
        builder.onResolve({ filter: /\?url$/ }, async args => {
          const resolved = await builder.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind })
          return { path: resolved.path, namespace: 'vite-url' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'vite-url' }, async ({ path }) => ({ contents: await readFile(path), loader: 'file' }))
      } }], loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' } })
    checks.push('Fixture compiles; native UI assertions NOT run')
    status = 'compile-only'
  } else {
    server = await createServer({ configFile: false, root: repository, cacheDir: join(temporary, 'vite-cache'),
      esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: [fixture] }, css: { postcss: repository },
      resolve: { alias }, server: { host: '127.0.0.1', port: 0 },
      plugins: [{ name: 'work-assistant-native-smoke', configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__work-assistant') return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__work-assistant', html))
        })
      } }] })
    await server.listen()
    const origin = server.resolvedUrls.local[0]
    const entry = join(temporary, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(()=>{const win=new BrowserWindow({width:1440,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());`)
    application = await electron.launch({ executablePath: require('electron'), args: [entry], timeout: 90_000 })
    await application.context().route('**/*', route => {
      const url = new URL(route.request().url())
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === new URL(origin).origin) return route.continue()
      externalRequests.push(url.href)
      return route.abort('blockedbyclient')
    })
    page = await application.firstWindow({ timeout: 90_000 })
    page.on('pageerror', error => errors.push(error.stack || error.message))
    await page.goto(origin + '__work-assistant', { timeout: 90_000 })
    await page.waitForFunction(() => window.workAssistantFixture?.ready, undefined, { timeout: 90_000 })
    const snapshot = () => page.evaluate(() => window.workAssistantFixture.snapshot())
    const screenshot = async name => {
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled' })
    }
    const resize = async (width, height) => {
      await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height })
      await page.setViewportSize({ width, height })
    }
    const assertComposerWidth = async () => {
      const geometry = await page.getByTestId('work-assistant-panel').evaluate(panel => {
        const panelRect = panel.getBoundingClientRect()
        const shell = panel.querySelector('.ds-composer-shell').getBoundingClientRect()
        const footer = panel.querySelector('.write-assistant-footer').getBoundingClientRect()
        const cards = [...panel.querySelectorAll('.write-assistant-action-row')].map(card => card.getBoundingClientRect())
        return { panelWidth: panelRect.width, width: shell.width,
          centered: Math.abs(shell.x + shell.width / 2 - (panelRect.x + panelRect.width / 2)),
          cardsVisible: cards.every(card => card.bottom <= footer.top) }
      })
      assert.ok(geometry.width >= Math.min(750, geometry.panelWidth - 48), 'visible composer shell must retain useful width')
      assert.ok(geometry.centered <= 3, 'visible composer shell must remain centered')
      assert.ok(geometry.cardsVisible, 'home actions must fit above the composer at desktop height')
    }
    await page.getByTestId('work-assistant-panel').waitFor()
    assert.equal((await snapshot()).surface, 'assistant')
    assert.equal(await page.locator('[data-presentation="page"]').count(), 1)
    assert.equal(await page.locator('textarea:visible').count(), 1)
    const composer = page.locator('[data-testid="work-assistant-panel"] textarea').last()
    await composer.fill('Keep this draft while moving between the page and sidebar')
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => window.workAssistantFixture.setTheme(value), theme)
      await resize(1440, 900)
      const layout = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="work-assistant-panel"]')
        const actions = panel.querySelector('.write-assistant-actions')
        const composer = panel.querySelector('[data-floating-composer]')
        const panelRect = panel.getBoundingClientRect(), composerRect = composer.getBoundingClientRect()
        return { display: getComputedStyle(actions).display, gap: parseFloat(getComputedStyle(actions).gap),
          offset: Math.abs(composerRect.x + composerRect.width / 2 - (panelRect.x + panelRect.width / 2)) }
      })
      assert.equal(layout.display, 'grid')
      assert.ok(layout.gap >= 8)
      assert.ok(layout.offset <= 3, 'full-page composer must be centered')
      await assertComposerWidth()
      paletteChecks.push({ theme, view: 'home', ...await assertWorkAssistantPalette(page) })
      await screenshot(`assistant-home-${theme}`)
    }
    await page.evaluate(() => window.workAssistantFixture.setLanguage('zh'))
    await screenshot('assistant-home-zh-dark')
    await page.evaluate(() => window.workAssistantFixture.setTheme('light'))
    await screenshot('assistant-home-zh-light')
    await page.evaluate(() => window.workAssistantFixture.setTheme('dark'))
    await page.evaluate(() => window.workAssistantFixture.setLanguage('en'))
    await page.evaluate(() => window.workAssistantFixture.setSidebarCollapsed(true))
    const sidebarToggle = page.getByRole('button', { name: 'Expand sidebar', exact: true })
    await sidebarToggle.waitFor()
    const toggleBox = await sidebarToggle.boundingBox()
    const backBox = await page.getByRole('button', { name: 'Back to workspace (Alt+Left)', exact: true }).boundingBox()
    assert.ok(toggleBox && backBox && toggleBox.x + toggleBox.width <= backBox.x)
    await assertComposerWidth()
    await screenshot('assistant-collapsed-sidebar-dark')
    await sidebarToggle.click()
    checks.push('Collapsed-sidebar toggle and Back occupy separate normal-flow header controls')
    // Preserve exact DOM identity as well as thread, input and presentation.
    await composer.evaluate(element => { window.__originalComposer = element })
    await page.getByRole('button', { name: 'Continue in sidebar', exact: true }).click()
    await page.locator('[data-presentation="sidebar"]').waitFor()
    assert.equal((await snapshot()).thread, 'offline-work-session')
    assert.equal(await composer.inputValue(), 'Keep this draft while moving between the page and sidebar')
    assert.ok(await composer.evaluate(element => element === window.__originalComposer))
    await screenshot('assistant-docked-dark')
    await page.getByRole('button', { name: 'Open full conversation', exact: true }).click()
    await page.locator('[data-presentation="page"]').waitFor()
    assert.ok(await composer.evaluate(element => element === window.__originalComposer))
    checks.push('Full-page/sidebar round trip keeps one DOM composer, exact draft and active conversation; no session creation or send')
    await page.evaluate(() => window.workAssistantFixture.showConversation())
    await page.getByText(/Explanation plan/).first().waitFor()
    await screenshot('assistant-conversation-dark')
    await page.evaluate(() => window.workAssistantFixture.setBusy(true))
    await page.getByRole('button', { name: 'Continue in sidebar', exact: true }).click()
    await page.getByRole('button', { name: 'Open full conversation', exact: true }).click()
    assert.equal((await snapshot()).thread, 'offline-work-session')
    await page.evaluate(() => window.workAssistantFixture.setBusy(false))
    checks.push('Promotion and docking during synthetic running state preserve the active thread without a second run')
    await page.evaluate(() => window.workAssistantFixture.showLiteral())
    const assertLiteral = async () => {
      const panel = page.getByTestId('work-assistant-panel')
      assert.equal(await panel.locator('h1, img[src="https://fixture.invalid/pixel"], a[href="https://fixture.invalid/pixel"]').count(), 0)
      const blocks = (await snapshot()).blocks
      assert.equal(blocks[0].id, 'literal-policy-sentinel')
      assert.equal(blocks[0].renderMode, 'plain-text')
    }
    await assertLiteral()
    await page.getByRole('button', { name: 'Continue in sidebar', exact: true }).click()
    await assertLiteral()
    await page.getByRole('button', { name: 'Open full conversation', exact: true }).click()
    await assertLiteral()
    await screenshot('assistant-literal-policy-dark')
    checks.push('Canonical timeline preserves literal renderMode through docking; no heading/image/link activation or external fetch')
    await page.evaluate(() => window.workAssistantFixture.openLibrary())
    await page.getByRole('button', { name: 'Explain this view', exact: true }).click()
    await page.getByTestId('paper-batch-assistant').waitFor()
    assert.equal((await snapshot()).surface, 'assistant')
    assert.equal((await snapshot()).batch.items.length, 4)
    assert.ok(await page.getByTestId('paper-batch-start').isDisabled())
    const remove = page.getByRole('button', { name: /^Remove .* from batch$/ }).first()
    await remove.click()
    assert.equal((await snapshot()).batch.items.length, 3)
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => window.workAssistantFixture.setTheme(value), theme)
      await resize(1440, 1000)
      paletteChecks.push({ theme, view: 'batch', ...await assertWorkAssistantPalette(page, { batch: true }) })
      const batch = page.getByTestId('paper-batch-assistant')
      await batch.locator('[data-paper-batch-scroll]').evaluate(element => { element.scrollTop = 0 })
      await screenshot(`assistant-batch-${theme}`)
      await batch.getByLabel('Output destination', { exact: true }).scrollIntoViewIfNeeded()
      await screenshot(`assistant-batch-options-${theme}`)
      await batch.getByTestId('paper-batch-model').scrollIntoViewIfNeeded()
      await batch.getByRole('checkbox').scrollIntoViewIfNeeded()
      const startBox = await page.getByTestId('paper-batch-start').boundingBox()
      assert.ok(startBox && startBox.y >= 0 && startBox.y + startBox.height <= 1000)
      await screenshot(`assistant-batch-controls-${theme}`)
      await batch.getByRole('checkbox').check()
      assert.ok(await page.getByTestId('paper-batch-start').isEnabled())
      await batch.getByRole('checkbox').uncheck()
      assert.ok(await page.getByTestId('paper-batch-start').isDisabled())
    }
    await resize(520, 850)
    await page.getByTestId('paper-batch-assistant').getByRole('checkbox').scrollIntoViewIfNeeded()
    await screenshot('assistant-batch-narrow-dark')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    assert.equal(overflow, false)
    checks.push('Paper library selection opens a titled, removable batch; consent gates Start; narrow layout has no page overflow')
    await page.getByTestId('paper-batch-assistant').getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => window.workAssistantFixture.setLanguage('zh'))
    await resize(1440, 1000)
    await page.evaluate(() => window.workAssistantFixture.openLibrary())
    await page.getByTestId('paper-batch-visible').click()
    await page.getByTestId('paper-batch-assistant').getByRole('checkbox').scrollIntoViewIfNeeded()
    await screenshot('assistant-batch-zh-dark')
    assert.equal((await snapshot()).calls.model, 0)
    assert.equal((await snapshot()).calls.writes, 0)
    assert.equal(externalRequests.length, 0)
    assert.deepEqual(errors, [])
    checks.push('No external requests, live model calls, personal data or filesystem writes')
    status = 'passed'
  }
} catch (error) {
  errors.push(error.stack || String(error))
  if (page) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await writeFile(reportPath, JSON.stringify(report(), null, 2))
  await application?.close().catch(() => {})
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
