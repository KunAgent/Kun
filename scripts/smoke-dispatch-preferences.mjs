import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer } from 'vite'

// Real renderer components in an offline, isolated Electron window. No runtime or credentials.
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
const temporary = await mkdtemp(join(tmpdir(), 'kun-preferences-smoke-'))
const evidence = resolve(process.env.KUN_PREFERENCES_EVIDENCE || 'dist/dispatch-preferences-smoke')
await mkdir(evidence, { recursive: true })
let server, electron, page
const errors = []
try {
  server = await createServer({ configFile: false, root, cacheDir: join(temporary, 'vite'),
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-i18next', 'i18next', 'zustand', 'yaml', 'lucide-react'] },
    resolve: { alias: { '@renderer': join(root, 'src/renderer/src'), '@shared': join(root, 'src/shared'),
      '@kun/extension-api': join(root, 'packages/extension-api/src/index.ts'), '@kun/provider-catalog': join(root, 'packages/provider-catalog/src/index.ts') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'preference-smoke', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url !== '/__preferences') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end(await vite.transformIndexHtml('/__preferences', `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
import '/src/renderer/src/components/SettingsUiSmokeFixture.tsx';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DispatchPreferenceCard } from '/src/renderer/src/components/workers/DispatchPreferenceCard.tsx';
const card=document.createElement('div');card.id='preference-smoke-card';card.style.cssText='position:fixed;right:24px;bottom:24px;width:340px;background:var(--ds-bg-main);z-index:20';document.body.append(card);createRoot(card).render(createElement(DispatchPreferenceCard));
</script></body></html>`))
      })
    } }]
  })
  await server.listen()
  const url = `${server.resolvedUrls.local[0]}__preferences`
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `const {app,BrowserWindow,session}=require('electron');
app.setPath('userData',${JSON.stringify(join(temporary, 'user-data'))});
app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_c,_p,cb)=>cb(false));const w=new BrowserWindow({width:1280,height:900,show:true,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.loadURL('about:blank')});app.on('window-all-closed',()=>app.quit());`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  electron = await _electron.launch({ executablePath: require('electron'), args: [main], env, chromiumSandbox: true, timeout: 90000 })
  page = await electron.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  const origin = new URL(url).origin
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:')
    ? route.continue() : route.abort('blockedbyclient'))
  await page.goto(url, { timeout: 90000 })
  await page.locator('[data-dispatch-preference-card] button').click({ timeout: 90000 })
  const dialog = page.locator('[aria-modal="true"]')
  await dialog.locator('[data-preference-add]').click()
  await dialog.locator('[data-preference-rule] input').first().waitFor()
  await dialog.getByLabel('Applicable scenario').fill('Architecture review')
  await dialog.locator('[data-composer-harness-picker]').click()
  const menu = dialog.locator('[data-harness-picker-menu]')
  await menu.waitFor()
  assert(await menu.evaluate(el => el.contains(document.activeElement)), 'Agent menu should own keyboard focus')
  const options = menu.locator('button[data-harness-id]:not(:disabled)')
  assert(await options.count() > 0, 'Fixture must provide selectable Agents')
  const external = menu.locator('button[data-harness-id="codex"]:not(:disabled)')
  const choice = await external.count() ? external : options.first()
  const agentId = await choice.getAttribute('data-harness-id')
  await choice.click()
  await dialog.locator('[data-dispatch-preference-save]').click()
  await dialog.getByRole('status').filter({ hasText: 'Saved' }).waitFor()
  await page.screenshot({ path: join(evidence, 'preferences-dialog.png') })
  await dialog.getByRole('button', { name: 'Close collaboration preferences' }).click()
  await page.locator('[data-dispatch-preference-card] button').click()
  assert.equal(await dialog.getByLabel('Applicable scenario').inputValue(), 'Architecture review')
  assert.equal(await dialog.locator('[data-dispatch-route-picker]').getAttribute('data-dispatch-route-picker'), agentId)
  await dialog.getByRole('button', { name: 'Close collaboration preferences' }).click()
  // The settings entry reads the exact saved object, not a second UI-only copy.
  await page.locator('[data-settings-category="collaboration"]').click()
  const settings = page.locator('[data-dispatch-preference-setting]')
  await settings.getByLabel('Applicable scenario').waitFor()
  assert.equal(await settings.getByLabel('Applicable scenario').inputValue(), 'Architecture review')
  await settings.getByLabel('Applicable scenario').fill('Architecture and debugging')
  const save = page.locator('[data-settings-category-view="collaboration"]').getByRole('button', { name: /Save/i }).last()
  await save.click()
  await page.locator('[data-dispatch-preference-card] button').click()
  assert.equal(await dialog.getByLabel('Applicable scenario').inputValue(), 'Architecture and debugging')
  for (const width of [1280, 900]) {
    await electron.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
    assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Dialog must not overflow horizontally')
    await page.screenshot({ path: join(evidence, `preferences-${width}.png`) })
  }
  assert.deepEqual(errors, [])
  console.log('PASS: real Agent menu/focus, default-model save, reopen, shared Settings persistence, responsive geometry')
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  await writeFile(join(evidence, 'failure.txt'), String(error.stack || error))
  throw error
} finally {
  await electron?.close().catch(() => {})
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
