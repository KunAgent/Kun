import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'
import { createServer } from 'vite'
import { build } from 'esbuild'

// Native Electron with production UI/actions/stores and a deterministic OFFLINE IPC fixture.
// This is not a full application smoke. Real filesystem/settings/IPC coverage runs separately.
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-paper-workspace-'))
const evidence = resolve(process.env.KUN_PAPER_WORKSPACE_EVIDENCE || 'dist/paper-workspace-smoke')
const fixture = join(repository, 'scripts/fixtures/paper-workspace-ui.tsx')
const profile = join(temporary, 'profile')
const compileOnly = process.argv.includes('--compile-only')
const errors = [], externalRequests = [], checks = []
let server, application, page, origin, status = 'failed'
const reportPath = join(evidence, compileOnly ? 'compile-report.json' : 'report.json')
const report = () => ({ status, platform: process.platform,
  scope: 'Production components/actions/stores in native Electron; OFFLINE fixture preload/settings/filesystem',
  exclusions: ['Full desktop app/preload ownership stack', 'Real filesystem and settings service (separate Vitest suites)', 'Live model or network calls'],
  checks, errors, externalRequests })
await mkdir(evidence, { recursive: true })
await writeFile(reportPath, JSON.stringify({ ...report(), status: 'starting' }, null, 2))
// Preserve exact launch failures even if Electron's launcher emits an unhandled rejection.
const recordUncaught = error => {
  errors.push(error.stack || error.message || String(error))
  writeFileSync(reportPath, JSON.stringify(report(), null, 2))
}
process.on('uncaughtExceptionMonitor', recordUncaught)
const alias = {
  '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared'),
  '@kun/provider-catalog': resolve(repository, 'packages/provider-catalog/src/index.ts'),
  '@kun/extension-api': resolve(repository, 'packages/extension-api/src/index.ts')
}
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><style>
/* Test framing only. All controls and component styles are production code. */
html,body,#root{height:100%;margin:0}.fixture-shell{height:100%;display:flex;flex-direction:column;background:var(--ds-bg-main);color:var(--ds-text-primary)}
.fixture-evidence-label{display:block;padding:5px 12px;font:10px/1.5 system-ui;color:var(--ds-text-muted);border-bottom:1px solid var(--ds-border)}
.fixture-workbench{display:flex;flex:1;min-height:0;min-width:0}.fixture-sidebar{display:flex;flex-direction:column;width:238px;flex-shrink:0;border-right:1px solid var(--ds-border);padding:12px 8px;background:var(--ds-bg-sidebar)}
.fixture-work-title{font:600 14px system-ui;padding:10px 12px}.fixture-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden}
@media(max-width:700px){.fixture-sidebar{display:none}}
</style><script type="module" src="/scripts/fixtures/paper-workspace-ui.tsx"></script></body></html>`
try {
  if (compileOnly) {
    await build({ entryPoints: [fixture], bundle: true, platform: 'browser', format: 'esm', write: false,
      outdir: temporary, jsx: 'automatic', alias, loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' } })
    status = 'compile-only'
    checks.push('Production component fixture compiles; native UI assertions were NOT run')
  } else {
    server = await createServer({ configFile: false, root: repository,
      cacheDir: join(temporary, 'vite-cache'), esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: [fixture] },
      css: { postcss: repository }, resolve: { alias }, server: { host: '127.0.0.1', port: 0 },
      plugins: [{ name: 'paper-workspace-smoke', configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/__paper-workspace') return next()
          response.setHeader('Content-Type', 'text/html')
          response.end(await vite.transformIndexHtml('/__paper-workspace', html))
        })
      } }] })
    await server.listen()
    origin = server.resolvedUrls.local[0]
    const entry = join(temporary, 'main.cjs')
    await writeFile(entry, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(profile)});
app.whenReady().then(()=>{const win=new BrowserWindow({width:1180,height:880,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});win.loadURL('about:blank')});
app.on('window-all-closed',()=>app.quit());`)
    await launch(entry)
    const roots = await page.evaluate(() => window.paperWorkspaceFixture.roots)
    assert.equal((await snapshot()).surface, 'docs')
    assert.equal((await snapshot()).activeFile, roots.docs + '/notes.md')
    await page.locator('[data-work-nav="library"]').click()
    await mounted(roots.default)
    assert.equal(await page.evaluate(() => window.paperWorkspaceFixture.calls.picker), 0, 'first entry must not require a folder picker')
    assert.deepEqual((await snapshot()).libraries, [roots.default])
    assert.equal((await snapshot()).settings.write.activeWorkspaceRoot, roots.docs)
    assert.equal((await snapshot()).settings.write.paperMode.workspaceInitialized, true)
    await page.getByTestId('paper-library-empty').waitFor()
    checks.push('First entry automatically opens a single default workspace through production startup/actions; no folder picker')
    await page.getByTestId('paper-empty-import').click()
    assert.equal((await snapshot()).importOpen, true)
    await page.evaluate(() => window.paperWorkspaceFixture.closeImport())
    await page.getByTestId('paper-empty-search').click()
    assert.equal((await snapshot()).view, 'discover:search')
    await page.getByTestId('paper-research-empty').locator('textarea').waitFor()
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => window.paperWorkspaceFixture.setTheme(t), theme)
      await resize(1440, 900)
      const history = page.locator('[data-paper-search=agent] > header').getByRole('button', { name: 'Search history', exact: true })
      if (await history.getAttribute('aria-pressed') !== 'true') await history.click()
      await screenshot('06-research-wide-' + theme)
      if (theme === 'dark') {
        await verifyResearchContrast()
        await page.getByTestId('paper-research-empty').locator('textarea').focus()
        await screenshot('08-research-composer-focus-dark')
        await page.locator('[data-paper-scope-trigger]').first().click()
        await page.locator('[data-paper-scope-menu]').waitFor()
        await screenshot('09-research-scope-popup-dark')
        await page.keyboard.press('Escape')
      }
      await resize(520, 820)
      await closeNarrowResearchRail()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'narrow research view must not overflow')
      await screenshot('07-research-narrow-' + theme)
    }
    await page.locator('[data-paper-research-example]').first().click()
    assert.ok((await page.getByTestId('paper-research-empty').locator('textarea').inputValue()).trim())
    checks.push('Actual research view, scope controls and FloatingComposer render in light/dark at wide/narrow widths; example fills composer without submission')
    await page.evaluate(() => window.paperWorkspaceFixture.openView('library'))
    checks.push('Empty state has working import and search entry points')
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => window.paperWorkspaceFixture.setTheme(t), theme)
      await resize(1180, 880)
      await screenshot('01-default-wide-' + theme)
      await resize(520, 820)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'narrow workspace must not overflow the viewport')
      await screenshot('02-default-narrow-' + theme)
    }
    await resize(1180, 880)
    await page.evaluate(() => window.paperWorkspaceFixture.setTheme('light'))
    await page.reload()
    await ready()
    await mounted(roots.default)
    assert.deepEqual((await snapshot()).libraries, [roots.default])
    await application.close()
    application = undefined
    await launch(entry)
    await mounted(roots.default)
    assert.deepEqual((await snapshot()).libraries, [roots.default])
    checks.push('Renderer reload and native Electron process restart reuse persisted fixture settings/layouts without duplicate workspaces')

    await page.evaluate(() => window.paperWorkspaceFixture.setPicker())
    const beforeCancel = await snapshot()
    await page.getByTestId('paper-workspace-add').click()
    await page.waitForFunction(() => window.paperWorkspaceFixture.calls.picker === 1 && document.querySelector('[data-testid=paper-workspace-add]')?.disabled === false)
    assert.equal((await snapshot()).root, beforeCancel.root)
    assert.deepEqual((await snapshot()).libraries, beforeCancel.libraries)
    assert.equal(await page.getByRole('alert').count(), 0)
    await page.evaluate(root => window.paperWorkspaceFixture.setPicker(root, 100), roots.custom)
    await page.getByTestId('paper-workspace-add').click()
    await mounted(roots.custom)
    assert.equal(await page.getByTestId('paper-workspace-select').inputValue(), roots.custom)
    assert.equal(await page.getByTestId('paper-workspace-switch').filter({ hasText: 'Library' }).getAttribute('aria-current'), 'true')
    assert.deepEqual(new Set((await snapshot()).libraries), new Set([roots.default, roots.custom]))
    await screenshot('03-custom-workspace-current')
    await resize(520, 820)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'long current path must fit narrow viewport')
    await screenshot('10-custom-long-path-narrow')
    await application.close()
    application = undefined
    await launch(entry)
    await mounted(roots.custom)
    assert.deepEqual(new Set((await snapshot()).libraries), new Set([roots.default, roots.custom]))
    checks.push('A pre-existing custom workspace remains active across process restart; long paths fit a narrow header')
    await page.evaluate(() => window.paperWorkspaceFixture.setSelection())
    await page.getByTestId('paper-workspace-select').selectOption(roots.default)
    await mounted(roots.default)
    assert.deepEqual((await snapshot()).selection, [])
    await page.locator(`[data-testid="paper-workspace-switch"][data-workspace-root="${roots.custom}"]`).click()
    await mounted(roots.custom)
    checks.push('Cancel is silent; adding selects a folder; header and sidebar switch real roots and clear old paper selection')

    await page.evaluate(root => window.paperWorkspaceFixture.setFault(root, 'Permission denied (offline fixture)'), roots.default)
    await page.getByTestId('paper-workspace-select').selectOption(roots.default)
    await page.getByRole('alert').filter({ hasText: 'Permission denied' }).waitFor()
    assert.equal((await snapshot()).root, roots.custom)
    assert.equal((await snapshot()).settings.write.paperMode.activeLibrary, roots.custom)
    await screenshot('04-failed-switch-preserves-current')
    await page.evaluate(root => window.paperWorkspaceFixture.setFault(root, null), roots.default)

    await page.evaluate(() => window.paperWorkspaceFixture.openNote())
    assert.equal((await snapshot()).activeFile, roots.custom + '/papers/shared/NOTES.md')
    await page.evaluate(() => window.paperWorkspaceFixture.makeDirty())
    const dialogs = []
    const rejectDialog = async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() }
    page.on('dialog', rejectDialog)
    const canceled = await page.evaluate(root => window.paperWorkspaceFixture.switch(root), roots.default)
    page.off('dialog', rejectDialog)
    assert.equal(canceled.ok, false)
    assert.equal((await snapshot()).root, roots.custom)
    assert.ok(dialogs.length > 0, 'dirty cancellation must exercise actual navigation confirmation')
    // Explicitly accept saving before leaving, then verify separate docs tabs restore.
    page.on('dialog', async dialog => { await dialog.accept() })
    assert.equal((await page.evaluate(() => window.paperWorkspaceFixture.exit())).ok, true)
    await page.getByTestId('fixture-documents').waitFor()
    assert.equal((await snapshot()).root, roots.docs)
    assert.equal((await snapshot()).activeFile, roots.docs + '/notes.md')
    assert.match((await snapshot()).documents[roots.docs + '/notes.md'], /Documents stay here/)
    assert.equal((await page.evaluate(() => window.paperWorkspaceFixture.enter())).ok, true)
    await mounted(roots.custom)
    assert.equal((await snapshot()).activeFile, roots.custom + '/papers/shared/NOTES.md')
    assert.deepEqual((await snapshot()).threadScopes[roots.docs], ['docs-thread'])
    assert.deepEqual((await snapshot()).threadScopes[roots.default], ['default-paper-thread'])
    assert.deepEqual((await snapshot()).threadScopes[roots.custom], ['custom-paper-thread'])
    checks.push('Rejected dirty navigation stays mounted; docs and paper roots/tabs/notes and real thread-registry bindings remain isolated')

    for (const code of ['missing-root', 'permission-denied']) {
      await page.evaluate(code => window.paperWorkspaceFixture.setEnsureFailure(code), code)
      await page.evaluate(() => window.paperWorkspaceFixture.reloadSettings())
      await page.getByTestId('paper-workspace-recovery').waitFor()
      assert.equal((await snapshot()).settings.write.paperMode.activeLibrary, roots.custom)
      assert.deepEqual(new Set((await snapshot()).libraries), new Set([roots.default, roots.custom]))
      await page.locator('[data-testid=paper-workspace-recovery] summary').click()
      await page.getByRole('alert').waitFor()
      await screenshot('05-recovery-' + code)
      await page.evaluate(() => window.paperWorkspaceFixture.setEnsureFailure(null))
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await mounted(roots.custom)
    }
    checks.push('Missing and permission startup failures show recoverable states without overwriting saved workspace selection')
    assert.equal(await page.evaluate(() => window.paperWorkspaceFixture.calls.runtime), 0)
    assert.deepEqual(errors, [], 'production components must have no uncaught errors')
    assert.deepEqual(externalRequests, [], 'offline smoke must not contact external services')
    status = 'passed'
  }
  console.log(status === 'passed' ? 'PASS native Electron paper workspace:' : 'COMPILE ONLY paper workspace:', checks.join('; '))
} catch (error) {
  errors.push(error.stack || error.message || String(error))
  if (page && !page.isClosed()) {
    await screenshot('failure').catch(() => undefined)
    await writeFile(join(evidence, 'failure.html'), await page.content()).catch(() => undefined)
  }
  throw error
} finally {
  await writeFile(reportPath, JSON.stringify(report(), null, 2))
  process.off('uncaughtExceptionMonitor', recordUncaught)
  await application?.close()
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
async function launch(entry) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const args = [...(process.platform === 'linux' ? ['--no-sandbox', ...(process.env.DISPLAY ? [] : ['--ozone-platform=headless', '--disable-gpu'])] : []), entry]
  application = await electron.launch({ executablePath: require('electron'), args, env, timeout: 90_000 })
  await application.context().route('**/*', route => {
    const url = new URL(route.request().url())
    if (['data:', 'blob:'].includes(url.protocol) || url.origin === new URL(origin).origin) return route.continue()
    externalRequests.push(url.href)
    return route.abort('blockedbyclient')
  })
  page = await application.firstWindow({ timeout: 90_000 })
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await resize(1180, 880)
  await page.goto(origin + '__paper-workspace', { timeout: 90_000 })
  await ready()
}
async function ready() { await page.waitForFunction(() => window.paperWorkspaceFixture?.ready, undefined, { timeout: 90_000 }) }
async function snapshot() { return page.evaluate(() => window.paperWorkspaceFixture.snapshot()) }
async function mounted(root) {
  await page.waitForFunction(root => {
    const state = window.paperWorkspaceFixture.snapshot()
    return state.root === root && state.surface === 'papers' && state.bootstrap.status === 'ready'
  }, root)
  await page.getByTestId('paper-workspace-header').waitFor()
}
async function resize(width, height) {
  await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height })
  await page.setViewportSize({ width, height })
  await page.waitForFunction(width => innerWidth === width, width)
}
async function screenshot(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true })
}

async function verifyResearchContrast() {
  const colors = await page.evaluate(() => {
    const surface = document.querySelector('[data-paper-search=agent]')
    const composer = surface.querySelector('.ds-composer-shell.ds-chat-composer')
    const textarea = composer.querySelector('textarea')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const rgb = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const luminance = color => rgb(color).map(value => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const background = getComputedStyle(composer).backgroundColor
    const ratio = color => {
      const a = luminance(color), b = luminance(background)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const text = getComputedStyle(textarea).color
    const placeholder = getComputedStyle(textarea, '::placeholder').color
    return { stage: getComputedStyle(surface).backgroundColor,
      rail: getComputedStyle(surface.querySelector('aside')).backgroundColor,
      composer: background, border: getComputedStyle(composer).borderColor,
      text, placeholder, textContrast: ratio(text), placeholderContrast: ratio(placeholder) }
  })
  assert.notEqual(colors.stage, colors.composer, 'dark composer must separate from the research stage')
  assert.notEqual(colors.stage, colors.rail, 'dark history rail must separate from the research stage')
  assert.ok(colors.textContrast >= 4.5, 'composer text must meet 4.5:1 contrast')
  assert.ok(colors.placeholderContrast >= 4.5, 'composer placeholder must meet 4.5:1 contrast')
  await writeFile(join(evidence, 'research-dark-colors.json'), JSON.stringify(colors, null, 2))
}

async function closeNarrowResearchRail() {
  // ResizeObserver commits after the native window resize, especially on Windows.
  // Wait for the real overlay and use its Close button instead of racing its Escape effect.
  const overlay = page.locator('[data-paper-search=agent] aside[data-overlay=true]')
  await overlay.waitFor({ state: 'visible' })
  await overlay.getByRole('button', { name: 'Close', exact: true }).click()
  await overlay.waitFor({ state: 'detached' })
}
