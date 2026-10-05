import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'
import { createServer, normalizePath } from 'vite'
import { paperEvidenceFixture } from './paper-evidence-ui-fixture.mjs'

// Native Electron, real production components, offline deterministic IPC fixture.
// Real disk persistence and Runtime policy have separate integration tests.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-paper-evidence-'))
const evidence = resolve(process.env.KUN_PAPER_EVIDENCE || 'dist/paper-evidence-smoke')
await mkdir(evidence, { recursive: true })
const fixtureId = normalizePath(join(repository, '__paper_evidence_fixture.tsx'))
const fixtureUrl = '/__paper_evidence_fixture.tsx'
const errors = [], externalRequests = [], checks = []
let server, application, page
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${fixtureUrl}"></script></body></html>`
try {
  server = await createServer({ configFile: false, root: repository,
    cacheDir: join(temporary, 'vite-cache'), esbuild: { jsx: 'automatic' },
    optimizeDeps: { entries: [] }, css: { postcss: repository },
    resolve: { alias: { '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared'), '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'), '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'paper-evidence-fixture', enforce: 'pre',
      resolveId(id) { if (id === fixtureUrl || id === fixtureId) return fixtureId },
      load(id) { if (id === fixtureId) return paperEvidenceFixture() },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__paper') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__paper', html))
      }) }
    }] })
  await server.listen()
  const origin = server.resolvedUrls.local[0]
  if (process.argv.includes('--serve')) {
    console.log(origin + '__paper')
    await new Promise(() => {})
  }
  const entry = join(temporary, 'main.cjs')
  await writeFile(entry, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});
app.whenReady().then(()=>{const win=new BrowserWindow({width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());`)
  application = await electron.launch({ executablePath: require('electron'), args: [entry], timeout: 90_000 })
  const context = application.context()
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || url.origin === new URL(origin).origin) return route.continue()
    externalRequests.push(url.href)
    return route.abort('blockedbyclient')
  })
  page = await application.firstWindow({ timeout: 90_000 })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  await page.goto(origin + '__paper', { timeout: 90_000 })
  await page.waitForFunction(() => window.paperFixture?.ready, undefined, { timeout: 90_000 })
  await page.evaluate(() => window.paperFixture.render({ view: 'reader' }))
  await page.getByRole('button', { name: 'Save as evidence', exact: true }).click()
  await page.getByTestId('paper-evidence-card').waitFor()
  assert.equal(await page.getByTestId('paper-evidence-card').count(), 1)
  assert.equal(await page.getByLabel('Semantic support · your decision').inputValue(), 'unverified')
  const original = await page.getByText('We did not improve recall on the held-out split.', { exact: true }).textContent()
  await page.getByLabel('Interpretation', { exact: true }).fill('Manual judgment: no recall improvement')
  await page.getByLabel('Conditions and limitations').fill('held-out split; fixed candidate pool')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('button', { name: 'Undo last saved edit' }).click()
  await page.waitForFunction(() => window.paperFixture.state().evidence[0].interpretation === '')
  await page.getByLabel('Interpretation', { exact: true }).fill('Manual judgment: no recall improvement')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  assert.equal(await page.getByText('We did not improve recall on the held-out split.', { exact: true }).textContent(), original)
  await screenshot('01-evidence-source-and-judgment')
  await page.evaluate(() => window.paperFixture.render({ stale: true }))
  await page.getByRole('button', { name: 'Inspect original source', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'PDF changed' }).waitFor()
  await screenshot('02-stale-source-blocked')
  checks.push('immutable source, manual edit/undo, stale anchor blocked')

  await page.evaluate(() => window.paperFixture.render({ view: 'matrix' }))
  await page.getByLabel('Matrix name', { exact: true }).fill('Code-search evidence')
  await page.getByRole('button', { name: /Create from selected papers/ }).click()
  await page.getByRole('table').waitFor()
  assert.equal(await page.getByRole('table').getByText('Not reported', { exact: true }).count(), 14)
  await page.getByRole('row').nth(1).getByRole('button').nth(2).click()
  await page.getByLabel('Not reported', { exact: true }).uncheck()
  await page.getByLabel('Reported value or observation').fill('Held-out code-search split')
  await page.getByRole('checkbox', { name: /We did not improve recall/ }).check()
  await page.getByLabel('Comparability', { exact: true }).selectOption('not-comparable')
  await page.getByLabel('Comparability reason').fill('Different held-out split and candidate pool')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.evaluate(() => window.paperFixture.render({ selected: [window.paperFixture.entries[2]] }))
  await page.getByRole('button', { name: /Append selected papers/ }).click()
  await page.getByRole('table').getByText('A new evaluation split', { exact: true }).waitFor()
  assert.equal(await page.getByRole('table').getByText('Held-out code-search split', { exact: true }).count(), 1)
  await screenshot('03-matrix-preserves-manual-evidence')
  await page.reload()
  await page.waitForFunction(() => window.paperFixture?.ready)
  await page.getByRole('table').getByText('Held-out code-search split', { exact: true }).waitFor()
  assert.equal(await page.getByRole('row').count(), 4)
  checks.push('unknown cells, evidence-linked edit, incompatible evaluation reason, incremental append and reopen')
  await page.evaluate(() => window.paperFixture.setTheme('dark'))
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(520, 850))
  await page.setViewportSize({ width: 520, height: 850 })
  await page.waitForFunction(() => window.innerWidth === 520)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'narrow viewport must contain horizontal scrolling within matrix')
  await screenshot('04-matrix-narrow-dark')
  await page.evaluate(() => window.paperFixture.render({ corrupt: true }))
  await page.getByRole('alert').filter({ hasText: 'corrupt' }).waitFor()
  await screenshot('05-corrupt-store-preserved')

  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 900))
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.waitForFunction(() => window.innerWidth === 1000)
  await page.evaluate(() => { window.paperFixture.setTheme('light'); window.paperFixture.render({ view: 'reading', partial: true, corrupt: false }) })
  await page.getByText('1 / 3 pages have extracted text', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Start bounded reading' }).isDisabled(), true)
  await page.getByLabel('Reading purpose', { exact: true }).selectOption('method-deep-read')
  await page.getByRole('radio', { name: /Selected model provider/ }).check()
  assert.equal(await page.getByRole('button', { name: 'Start bounded reading' }).isDisabled(), true)
  await screenshot('06-partial-text-deep-reading-blocked')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal(await page.evaluate(() => window.paperFixture.calls.model.length), 0)
  await page.evaluate(() => window.paperFixture.render({ view: 'reading', partial: false }))
  await page.getByText('3 / 3 pages have extracted text', { exact: true }).waitFor()
  await page.getByRole('radio', { name: /Selected model provider/ }).check()
  await screenshot('07-explicit-model-context-disclosure')
  await page.getByRole('button', { name: 'Start bounded reading' }).click()
  const calls = await page.evaluate(() => window.paperFixture.calls)
  assert.equal(calls.model.length, 1)
  assert.equal(calls.model[0][2].paperContext.maxModelRequests, 1)
  assert.equal(calls.model[0][2].paperContext.sources.length, 1)
  assert.equal(calls.model[0][2].paperContext.sources[0].sourceVersion, 'a'.repeat(64))
  checks.push('local-only no submit, cancel no request, partial deep read blocked, explicit scoped single request')
  assert.deepEqual(errors, [], 'production components must have no uncaught errors')
  assert.deepEqual(externalRequests, [], 'fixture must never contact an external service')
  console.log('PASS native Electron paper evidence:', checks.join('; '))
} catch (error) {
  if (page && !page.isClosed()) {
    await screenshot('failure').catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  throw error
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ platform: process.platform, checks, errors, externalRequests }, null, 2))
  await application?.close()
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
async function screenshot(name) { await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true }) }
