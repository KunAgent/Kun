import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer } from 'vite'

// Real production tool components in Electron. All host services, approvals and
// tool evidence are synthetic, with no agent or user profile involved.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(repository, 'node_modules/.kun-tool-presentation-'))
const evidence = resolve(process.env.KUN_TOOL_PRESENTATION_EVIDENCE || 'dist/tool-presentation')
let server, application, page, fatal
const checks = [], errors = [], externalRequests = []
const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body,#root{height:100%;margin:0}.tool-fixture{min-height:100%;background:var(--ds-bg-main);color:var(--ds-text-primary);font:14px/1.6 sans-serif}
.tool-fixture>header{padding:16px 24px;border-bottom:1px solid var(--ds-border)}nav{display:flex;flex-wrap:wrap;gap:12px}nav button{padding:3px 8px;border:1px solid var(--ds-border);border-radius:6px}
.tool-fixture-content{max-width:950px;margin:auto;padding:24px}.tool-fixture h1{font-size:18px;font-weight:600}
.tool-fixture-content[data-fixture-case=approval-long]{position:fixed;bottom:0;left:0;right:0}
</style></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/tool-presentation.tsx"></script></body></html>`
try {
  await mkdir(evidence, { recursive: true })
  server = await createServer({ configFile: false, root: repository, cacheDir: join(temporary, 'vite-cache'),
    esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: [] }, css: { postcss: repository },
    resolve: { alias: { '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared'),
      '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
      '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts') } },
    server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/*'] } },
    plugins: [{ name: 'tool-presentation-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__tool_presentation') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__tool_presentation', html))
      })
    } }]
  })
  await server.listen()
  const origin = new URL(server.resolvedUrls.local[0]).origin
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(()=>{const win=new BrowserWindow({width:1100,height:920,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});app.on('window-all-closed',()=>app.quit());`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  application = await _electron.launch({ executablePath: require('electron'), args: [main], env, timeout: 60_000 })
  page = await application.firstWindow({ timeout: 60_000 })
  page.setDefaultTimeout(15_000)
  page.on('pageerror', error => errors.push(error.stack || error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.context().route('**/*', route => {
    const url = route.request().url()
    if (new URL(url).origin === origin) return route.continue()
    externalRequests.push(url)
    return route.abort('blockedbyclient')
  })
  await page.goto(origin + '/__tool_presentation', { timeout: 60_000 })
  await page.waitForFunction(() => window.toolFixture?.ready, null, { timeout: 60_000 })
  const scenario = async (name) => {
    await page.evaluate(name => window.toolFixture.scenario(name), name)
    await page.locator(`[data-fixture-case="${name}"]`).waitFor()
  }
  const hasText = async (text) => {
    await page.waitForFunction(text => document.querySelector('.tool-fixture-content')?.innerText.includes(text), text)
    assert.ok((await page.locator('.tool-fixture-content').innerText()).includes(text), text)
  }
  await page.locator('[data-tool-line-numbers]').waitFor()
  assert.equal(await page.locator('[data-tool-line-numbers]').innerText(), '42\n43\n44')
  await page.waitForFunction(() => document.querySelectorAll('.ds-file-preview-code-html .line span[style]').length > 0)
  await hasText('const session = getSession()')
  await page.getByText('Input', { exact: true }).click()
  await hasText('"offset": 42')
  checks.push('read line numbers and independently expandable input')
  await page.screenshot({ path: join(evidence, 'read.png') })

  await scenario('search')
  await hasText('src/session.ts:18')
  await hasText('state.sessions.get(sessionId)')
  assert.equal((await page.evaluate(() => window.toolFixture.actions)).length, 0)
  await page.getByRole('link', { name: 'Session API reference' }).click()
  assert.deepEqual(await page.evaluate(() => window.toolFixture.actions.at(-1)), { type: 'external', url: 'https://example.invalid/api' })
  checks.push('file/search results and explicit external activation')

  await scenario('edit')
  assert.equal(await page.locator('[data-tool-diff]').count(), 2)
  await hasText('Updated two files while preserving the current session.')
  await page.getByRole('button', { name: 'Open full details' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const box = await dialog.boundingBox()
  assert.ok(box.width > 800 && box.height > 200, `usable details dialog: ${JSON.stringify(box)}`)
  await page.screenshot({ path: join(evidence, 'diff-dialog.png') })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  checks.push('multi-file diff, retained explanation and accessible wide viewer')

  await scenario('terminal')
  for (const text of ['$ npm test', '$ node watcher.js', '1 failed, 24 passed', 'SIGTERM', 'Validation completed', '1.5s']) await hasText(text)
  assert.equal(await page.locator('[data-tool-terminal]').count(), 2)
  checks.push('all terminal commands, output, exit, signal and real duration')
  await page.screenshot({ path: join(evidence, 'terminal.png') })

  await scenario('fetch'); await hasText('HTTP 200'); await hasText('No remote content is executed.')
  await scenario('mcp'); await hasText('documents / search')
  await page.getByText('Input', { exact: true }).click()
  await hasText('project notes'); await hasText('doc-1')
  checks.push('fetch status and named MCP input/output')

  await scenario('rich')
  await hasText('Retained resource text.')
  assert.equal(await page.locator('img[src^="data:image/png"]').count(), 1)
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0)
  assert.equal(await page.locator('audio').count(), 0, 'Audio must not load before explicit activation')
  await page.getByRole('button', { name: 'Preview audio' }).click()
  const audio = page.locator('audio')
  await audio.waitFor()
  assert.equal(await audio.getAttribute('preload'), 'none')
  assert.ok((await audio.getAttribute('src')).startsWith('data:audio/'))
  assert.equal(await audio.getAttribute('autoplay'), null)
  assert.ok(await page.getByRole('button', { name: 'Download attachment' }).count() > 0)
  assert.equal(await page.evaluate(() => window.__toolXss), 0)
  assert.deepEqual(externalRequests, [], 'Tool content must not load remote resources automatically')
  checks.push('bounded local image/resource preview with no automatic external requests')
  await page.screenshot({ path: join(evidence, 'resources.png') })

  await scenario('approval')
  await hasText('npm test')
  await hasText('Run this time'); await hasText('Trust this operation')
  // The approval card ignores clicks for its first 500 ms (arming).
  await page.waitForTimeout(600)
  await page.getByRole('option', { name: /Trust this operation/ }).click()
  assert.deepEqual(await page.evaluate(() => window.toolFixture.actions.at(-1)), {
    type: 'approval', id: 'approval-fixture', decision: 'allow', choice: { optionId: 'always' }
  })
  checks.push('approval evidence and exact provider choice')
  await page.screenshot({ path: join(evidence, 'approval.png') })

  await scenario('canceled')
  const canceled = page.locator('[data-tool-state="canceled"]')
  await canceled.waitFor()
  assert.equal(await canceled.locator('.text-orange-700').count(), 0)
  checks.push('canceled tools retain a neutral state')
  await page.evaluate(() => window.toolFixture.theme('dark'))
  await scenario('read')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(440, 820))
  await page.waitForFunction(() => innerWidth <= 440)
  assert.ok(await page.locator('.tool-fixture-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'narrow layout must not overflow')
  await page.screenshot({ path: join(evidence, 'narrow-dark.png') })
  checks.push('narrow dark layout remains contained')
  await scenario('approval-long')
  const approvalLayout = await page.locator('[data-composer-stack-item="approval"]').evaluate(element => {
    const panel = element.getBoundingClientRect(), footer = element.querySelector('footer').getBoundingClientRect()
    const body = element.querySelector('[data-approval-evidence-scroll]')
    return { height: panel.height, viewport: innerHeight, footerBottom: footer.bottom,
      bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight }
  })
  assert.ok(approvalLayout.height <= approvalLayout.viewport * 0.7 + 2)
  assert.ok(approvalLayout.footerBottom <= approvalLayout.viewport)
  assert.ok(approvalLayout.bodyScrollHeight > approvalLayout.bodyHeight, 'Long approval evidence must scroll independently')
  await page.getByRole('option', { name: /Review option 12/ }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'long-approval-narrow.png') })
  checks.push('long multi-file approvals keep all choices reachable in a narrow window')
  assert.deepEqual(errors, [])
} catch (error) {
  fatal = error.stack || String(error); process.exitCode = 1
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => undefined)
} finally {
  const report = { status: fatal ? 'failed' : 'passed', engine: 'native-electron', checks, errors, externalRequests, ...(fatal ? { fatal } : {}) }
  await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await application?.close().catch(() => undefined)
  await server?.close(); await rm(temporary, { recursive: true, force: true })
}
