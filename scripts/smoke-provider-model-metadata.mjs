import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { createServer, optimizeDeps } from 'vite'

// Isolated offline production model editor; no Runtime, provider calls or credentials.
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const temporary = await mkdtemp(join(tmpdir(), 'kun-model-metadata-smoke-'))
await mkdir(join(root, 'out'), { recursive: true })
const fixtureDirectory = await mkdtemp(join(root, 'out', '.metadata-smoke-'))
const fixturePath = join(fixtureDirectory, 'fixture.tsx')
const output = resolve(process.env.KUN_METADATA_EVIDENCE || 'dist/provider-model-metadata-smoke')
await mkdir(output, { recursive: true })
let server, application, page
const report = { layouts: [], pageErrors: [], blockedRequests: [], assertions: [] }
const modelId = 'fixture-provider-model-with-a-very-long-name-and-account-specific-limits'
const fixture = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProviderModelsManager } from '/src/renderer/src/components/settings-section-provider-models.tsx'
import { withModelObservation, setModelMetadataOverride } from '/kun/src/services/model-metadata-resolver.ts'
import { metadataEvidence } from '/kun/src/contracts/model-metadata-evidence.ts'
import i18n from '/src/renderer/src/i18n.ts'
import '/src/renderer/src/index.css'
import '/src/renderer/src/styles/base-shell.css'
import '/src/renderer/src/styles/settings-chrome.css'
import '/src/renderer/src/styles/settings-buttons.css'
import '/src/renderer/src/styles/settings-layout.css'
import '/src/renderer/src/styles/settings-controls.css'
import '/src/renderer/src/styles/settings-pages.css'
const id = ${JSON.stringify(modelId)}
let profile = withModelObservation({ inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: true, evidence: metadataEvidence({}, 'adapter') }, {
  id: 'account-fixture-models', source: 'provider', match: 'exact', observedAt: '2026-10-08T00:00:00.000Z',
  values: { contextWindowTokens: 200000, maxInputTokens: 180000, maxOutputTokens: 32000, supportsToolCalling: false, supportsReasoning: true,
    reasoning: { supportedEfforts: ['high', 'max'], defaultEffort: 'max', requestProtocol: 'openai-responses', nativeEfforts: ['high', 'xhigh'], nativeDefaultEffort: 'xhigh', effortMapping: { high: 'high', max: 'xhigh' } } }
})
profile = withModelObservation(profile, { id: 'models.dev:other-provider', source: 'catalog', match: 'family', observedAt: '2026-10-07T00:00:00.000Z', values: { streaming: true, contextWindowTokens: 1000000 } })
profile = setModelMetadataOverride(setModelMetadataOverride(profile, 'contextWindowTokens', 256000), 'maxOutputTokens', 4096)
await i18n.changeLanguage('en')
function Fixture() {
 const [provider, setProvider] = useState({ id: 'fixture', name: 'Fixture', baseUrl: 'https://offline.invalid', apiKey: '', endpointFormat: 'responses', useProxy: false, models: [id], modelProfiles: { [id]: profile } })
 return <main className="ds-settings-view min-h-screen bg-ds-main p-4 text-ds-ink"><ProviderModelsManager provider={provider} t={(key, values) => i18n.t(key, { ns: 'settings', ...values })} selectControlClass="rounded border border-ds-border bg-ds-card px-2 py-1" onChange={next => { window.modelMetadataSaved = next; setProvider(next) }} /></main>
}
createRoot(document.getElementById('root')).render(<Fixture />)
`
try {
  await writeFile(fixturePath, fixture)
  server = await createServer({ configFile: false, root, cacheDir: join(temporary, 'vite'),
    esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: [fixturePath], include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-i18next', 'i18next', 'zod', 'lucide-react'] },
    resolve: { alias: { '@shared': resolve(root, 'src/shared'), '@renderer': resolve(root, 'src/renderer/src'),
      '@kun/provider-catalog': resolve(root, 'packages/provider-catalog/src/index.ts'), '@kun/extension-api': resolve(root, 'packages/extension-api/src/index.ts') } },
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'metadata-fixture', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url === '/__metadata') {
          res.setHeader('Content-Type', 'text/html')
          res.end(await vite.transformIndexHtml('/__metadata', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/' + fixturePath + '"></script></body></html>'))
        } else next()
      })
    } }] })
  await optimizeDeps(server.config, true, true)
  await server.listen()
  const url = `${server.resolvedUrls.local[0]}__metadata`
  const main = join(temporary, 'main.cjs')
  await writeFile(main, `const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary,'user-data'))});app.setPath('appData',${JSON.stringify(temporary)});app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_c,_p,cb)=>cb(false));const window=new BrowserWindow({width:1440,height:1000,show:true,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.loadURL('about:blank')});app.on('window-all-closed',()=>app.quit());`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  application = await _electron.launch({ executablePath: require('electron'), args: [main], env, chromiumSandbox: true, timeout: 90_000 })
  page = await application.firstWindow()
  page.on('pageerror', error => report.pageErrors.push(error.message))
  const origin = new URL(url).origin
  await page.route('**/*', route => {
    const target = route.request().url()
    if (target.startsWith(origin + '/') || target.startsWith('data:')) return route.continue()
    report.blockedRequests.push(target); return route.abort()
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.getByRole('button', { name: `Configure ${modelId}`, exact: true }).click({ timeout: 90_000 })
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Model capability sources and limits', { exact: true }).waitFor()
  for (const config of [{ width: 1440, height: 1000, zoom: 1 }, { width: 900, height: 720, zoom: 1.25 }, { width: 1440, height: 1000, zoom: 2 }]) {
    await application.evaluate(({ BrowserWindow }, config) => { const w=BrowserWindow.getAllWindows()[0];w.setContentSize(config.width,config.height);w.webContents.setZoomFactor(config.zoom) }, config)
    await page.waitForTimeout(100)
    await dialog.getByRole('row').filter({ has: page.getByRole('cell', { name: /^Total context tokens/ }) }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(50)
    const bounds = await dialog.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }))
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x+bounds.width <= viewport.width+1 && bounds.y+bounds.height <= viewport.height+1)
    assert.equal(viewport.overflow, false, 'The model editor must not overflow the viewport')
    const filename = `metadata-${config.width}-${config.zoom}.png`
    const png = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
    await writeFile(join(output,filename),Buffer.from(png,'base64'))
    report.layouts.push({ ...config, bounds, viewport, screenshot: filename })
  }
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  const outputRow = dialog.getByRole('row').filter({ has: page.getByRole('cell', { name: /^Maximum output tokens/ }) })
  await outputRow.getByRole('button', { name: 'Restore automatic' }).click()
  await dialog.getByRole('button', { name: 'Save model', exact: true }).click()
  const cleared = await page.evaluate(id => window.modelMetadataSaved.modelProfiles[id].metadata.overrides,modelId)
  assert.equal(cleared.maxOutputTokens,undefined);assert.equal(cleared.contextWindowTokens,256000)
  report.assertions.push('Restore automatic clears only the selected field')
  await page.getByRole('button',{name:`Configure ${modelId}`,exact:true}).click()
  const streamingRow = page.getByRole('dialog').getByRole('row').filter({has:page.getByRole('cell',{name:/^Streaming/})})
  await streamingRow.getByRole('button',{name:'Adopt suggestion'}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Save model',exact:true}).click()
  const adopted=await page.evaluate(id=>window.modelMetadataSaved.modelProfiles[id].metadata,modelId)
  assert.equal(adopted.overrides.streaming,true)
  assert.equal(adopted.overrideEvidence.streaming.sourceId,'models.dev:other-provider')
  report.assertions.push('Adopt suggestion preserves its source')
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.blockedRequests,[])
  report.status='passed'
  console.log(`Model metadata smoke passed: ${report.layouts.length} native layouts, ${report.assertions.length} editor interactions`)
} catch(error) {
  report.status='failed';report.failure=error.stack || String(error);console.error(report.failure);process.exitCode=1
  if(page&&!page.isClosed()) await page.screenshot({path:join(output,'failure.png'),timeout:10_000}).catch(()=>undefined)
} finally {
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2))
  await application?.close().catch(()=>undefined);await server?.close();await rm(temporary,{recursive:true,force:true});await rm(fixtureDirectory,{recursive:true,force:true})
}
