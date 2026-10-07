import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from '../tailwind.config.js'
import { inspectCjkFonts } from './memory-cjk-fonts.mjs'
import { chromium, _electron } from 'playwright-core'

// Production memory components/styles and real stores; isolated synthetic data only.
// Playwright bridges the renderer to Node services; this does not test the app ownership/preload stack.
// node scripts/smoke-memory-lifecycle.mjs --electron
// CHROME_PATH=/usr/bin/chromium node scripts/smoke-memory-lifecycle.mjs
// KUN_MEMORY_EVIDENCE=/tmp/kun-memory-evidence retains labelled screenshots/results.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'kun-memory-ui-'))
const evidence = resolve(process.env.KUN_MEMORY_EVIDENCE ?? join(temporary, 'evidence'))
const native = process.argv.includes('--electron')
const require = createRequire(import.meta.url)
await mkdir(evidence, { recursive: true })
let browser, electron, page, backend
const errors = [], results = []
let status = 'failed'
try {
  const backendPath = join(temporary, 'backend.cjs')
  await build({ entryPoints: [join(root, 'scripts/fixtures/memory-lifecycle-backend.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: backendPath })
  backend = await require(backendPath).createMemorySmokeBackend(join(temporary, 'data'))
  const metadata = await backend.bootstrap()
  const compiled = await build({ entryPoints: [join(root, 'scripts/fixtures/memory-lifecycle.tsx')], bundle: true,
    format: 'esm', platform: 'browser', jsx: 'automatic', write: false, outdir: temporary,
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    alias: { '@shared': join(root, 'src/shared') },
    plugins: [{ name: 'synthetic-memory-transport', setup(builder) {
      builder.onLoad({ filter: /agent\/registry\.ts$/ }, () => ({ contents: `export const getProvider = () => ({
        listMemories: async ({workspace}) => (await window.memoryFixture.api('/v1/memory?workspace='+encodeURIComponent(workspace))).memories,
        updateMemory: async (id,patch,access) => (await window.memoryFixture.api('/v1/memory/'+encodeURIComponent(id)+'?project='+encodeURIComponent(access.project), 'PATCH', patch)).memory
      });`, loader: 'js' }))
      builder.onLoad({ filter: /rooms\/useRoomEvents\.ts$/ }, () => ({ contents: `
        export const roomEventsLive = () => true;
        export const acknowledgeRoomAttention = () => {};
        export const useRoomAttentionCount = () => 0;
        export const useRoomEvents = () => ({});
        export function subscribeRoomEvents(listener) {
          const handler = () => listener({kind:'agent.memory.updated'});
          window.addEventListener('memory-fixture-change', handler);
          return () => window.removeEventListener('memory-fixture-change', handler);
        }`, loader: 'js' }))
    } }]
  })
  const javascript = compiled.outputFiles.find((file) => file.path.endsWith('.js')).text
  const rawCss = compiled.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
  const css = (await postcss([tailwindcss(tailwindConfig), autoprefixer]).process(rawCss, { from: join(root, 'src/renderer/src/index.css') })).css
  assert.ok(!css.includes('@tailwind'), 'production Tailwind must be compiled before screenshots')
  await writeFile(join(temporary, 'fixture.js'), javascript)
  const html = join(temporary, 'index.html')
  await writeFile(html, `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  ${css}
  /* Fixture framing only; all controls, tokens and reset rules above are production CSS. */
  html,body,#root{height:auto;min-height:100%;overflow:auto;-webkit-app-region:no-drag}
  .memory-fixture-shell{max-width:780px;margin:auto;padding:28px;background:var(--ds-bg-main)}
  .memory-fixture-header{padding:0 16px 14px}.memory-fixture-header h1{font-size:27px;font-weight:600;margin:12px 0}
  .memory-fixture-header small{font-size:11px;letter-spacing:.12em;color:var(--ds-text-muted)}
  .memory-fixture-header p{font-size:13px;color:var(--ds-text-muted);line-height:1.6}
  .memory-fixture-conversation{padding:16px}
  </style><div id="root"></div><script type="module" src="./fixture.js"></script></html>`)
  if (native) {
    const main = join(temporary, 'main.cjs')
    await writeFile(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1000,height:1050,show:true,webPreferences:{sandbox:true}});w.loadURL('about:blank')});app.on('window-all-closed',()=>app.quit());`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    electron = await _electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', ...(process.env.DISPLAY ? [] : ['--ozone-platform=headless', '--disable-gpu']), main], env, timeout: 30_000 })
    page = await electron.firstWindow()
  } else {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] })
    page = await browser.newPage({ viewport: { width: 1000, height: 1050 } })
  }
  page.on('pageerror', (error) => errors.push(error.message))
  await page.exposeFunction('__memoryFixtureTransport', (path, method, body) => backend.request(path, method, body))
  await page.goto('file://' + html)
  await page.getByRole('button', { name: 'Correct', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Overview', exact: true }).waitFor()
  const productionStyles = await page.evaluate(() => {
    const tab = getComputedStyle(document.querySelector('.memory-section-tabs button'))
    const chip = getComputedStyle(document.querySelector('[aria-label="Memories used for this reply"]'))
    return { tabTopBorder: tab.borderTopWidth, tabBottomBorder: tab.borderBottomWidth,
      chipFontSize: chip.fontSize, chipRadius: chip.borderRadius }
  })
  assert.deepEqual(productionStyles, { tabTopBorder: '0px', tabBottomBorder: '2px', chipFontSize: '11px', chipRadius: '6px' },
    'native controls must use production preflight, component CSS and compiled Tailwind utilities')
  await writeFile(join(evidence, 'styles-report.json'), JSON.stringify(productionStyles, null, 2))
  await screenshot('overview')
  await page.getByRole('button', { name: 'Correct', exact: true }).click()
  await page.getByRole('textbox', { name: 'Memory content' }).fill('Unsaved smoke edit')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Correct', exact: true }).click()
  assert.match(await page.getByRole('textbox', { name: 'Memory content' }).inputValue(), /repository test command/)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByText('Sources (1)', { exact: true }).click()
  await page.getByText('Version history', { exact: true }).click()
  await page.getByRole('button', { name: /Revision 2/ }).click()
  await screenshot('evidence-history')
  await page.getByRole('button', { name: 'Forget', exact: true }).click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByText('Advanced actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Permanently erase', exact: true }).click()
  await page.getByRole('textbox', { name: 'Memory ID confirmation' }).fill(metadata.memoryId)
  await screenshot('erase-confirmation')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Permanently erase', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Memory ID confirmation' }).inputValue(), '')
  assert.equal(await page.getByRole('button', { name: 'Erase permanently', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate(() => window.memoryFixture.calls.filter(call => call.method !== 'GET').length), 0)
  // Exercise an actual stale editor through the renderer transport, then recover explicitly.
  await page.getByRole('button', { name: 'Correct', exact: true }).click()
  await page.getByRole('textbox', { name: 'Memory content' }).fill('Stale fixture correction must not be stored')
  backend.concurrentEditOnNextSave()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'memory changed' }).waitFor()
  assert.equal((await backend.snapshot()).memory.content, metadata.originalContent)
  await screenshot('stale-editor-rejected')
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click()
  await page.getByRole('button', { name: 'Correct', exact: true }).waitFor()
  const corrected = 'Native fixture correction persisted through AgentMemoryService.'
  const beforeSaveCalls = (await backend.snapshot()).calls.length
  await page.getByRole('button', { name: 'Correct', exact: true }).click()
  await page.getByRole('textbox', { name: 'Memory content' }).fill(corrected)
  await page.getByRole('button', { name: 'Save', exact: true }).evaluate(button => { button.click(); button.click() })
  const correctedEntry = page.locator('[data-memory-id="' + metadata.memoryId + '"]')
  // Text matching can see the unsaved textarea value. The editor closes only
  // after the PATCH resolves; wait for that receipt before checking disk state.
  await correctedEntry.getByRole('button', { name: 'Correct', exact: true }).waitFor()
  await correctedEntry.getByText(corrected, { exact: true }).waitFor()
  const persisted = await backend.snapshot()
  assert.equal(persisted.memory.content, corrected)
  assert.equal(persisted.calls.slice(beforeSaveCalls).filter(call => call.method === 'PATCH').length, 1)
  await page.getByRole('button', { name: 'Disable', exact: true }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).waitFor()
  assert.ok((await backend.snapshot()).memory.disabledAt)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('button', { name: 'Disable', exact: true }).waitFor()
  assert.equal((await backend.snapshot()).memory.disabledAt, undefined)
  await page.getByText('Version history', { exact: true }).click()
  await page.getByRole('button', { name: /Revision 3 ·/ }).click()
  await page.getByRole('button', { name: 'Restore this version', exact: true }).click()
  await page.locator('[data-memory-id="' + metadata.memoryId + '"]').getByText(metadata.originalContent, { exact: true }).first().waitFor()
  assert.equal((await backend.snapshot()).memory.content, metadata.originalContent)
  await backend.reopen()
  await page.reload()
  await page.getByRole('button', { name: 'Correct', exact: true }).waitFor()
  assert.equal((await backend.snapshot()).memory.content, metadata.originalContent)
  await screenshot('persisted-reopen')
  await page.getByRole('button', { name: 'Memories used for this reply', exact: true }).click()
  await page.getByRole('dialog', { name: 'Memories used for this reply' }).waitFor()
  await page.getByText('Current memory record', { exact: false }).click()
  await screenshot('conversation-provenance')
  await page.getByRole('button', { name: 'Close memory details' }).click()
  await page.getByRole('button', { name: 'Pending review', exact: true }).click()
  await page.getByText('Proposed update', { exact: true }).waitFor()
  await screenshot('pending-review')
  await page.getByRole('button', { name: 'Keep current memory', exact: true }).click()
  await page.getByText('No memory changes need your decision.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await screenshot('history-tab')
  await page.getByText('Project Markdown / Git snapshot', { exact: true }).click()
  // An input with a native datalist has the implicit combobox role, not textbox.
  const projectPath = page.getByRole('combobox', { name: 'Exact project path', exact: true })
  assert.equal(await projectPath.evaluate(input => input.list?.id), 'project-knowledge-projects',
    'project path must retain its native labelled datalist semantics')
  await projectPath.fill(metadata.projectRoot)
  await page.getByRole('button', { name: 'Review preview', exact: true }).click()
  await page.getByText('Empty preview. Select at least one project record before saving.', { exact: true }).waitFor()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Review preview', exact: true }).click()
  await screenshot('project-export-preview')
  await page.getByRole('button', { name: 'Save approved snapshot…', exact: true }).click()
  await page.getByRole('button', { name: 'Save approved snapshot…', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => window.memoryFixture.language('zh'))
  await page.getByRole('button', { name: '历史', exact: true }).waitFor()
  await writeFile(join(evidence, 'cjk-fonts-wide.json'), JSON.stringify(await inspectCjkFonts(page), null, 2))
  await screenshot('chinese-layout')
  if (native) await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(420, 900))
  else await page.setViewportSize({ width: 420, height: 900 })
  await writeFile(join(evidence, 'cjk-fonts-narrow.json'), JSON.stringify(await inspectCjkFonts(page), null, 2))
  await screenshot('narrow-layout')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'memory UI must not overflow the narrow viewport')
  // Confirm erasure only after visual evidence, and only inside this synthetic temporary profile.
  await page.evaluate(() => window.memoryFixture.language('en'))
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  await page.getByRole('button', { name: 'Forget', exact: true }).click()
  await page.getByRole('button', { name: 'Forget this memory', exact: true }).click()
  await page.getByText('No memories yet. Stable information will appear after completed work.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('Advanced actions', { exact: true }).click()
  await page.getByRole('button', { name: 'Permanently erase', exact: true }).click()
  await page.getByRole('textbox', { name: 'Memory ID confirmation' }).fill(metadata.memoryId)
  await page.getByRole('button', { name: 'Erase permanently', exact: true }).click()
  await page.getByText('No memories yet. Stable information will appear after completed work.', { exact: true }).waitFor()
  const erasure = await backend.verifyErasure()
  assert.deepEqual(erasure, { fileExists: false, retainedHistory: false, replayRecreated: false,
    unrelatedProjectRetained: true, sourceConversationRetained: true, sourceMessageRetained: true })
  await writeFile(join(evidence, 'persistence-report.json'), JSON.stringify({ erasure, boundary: 'isolated component/store integration; app main/preload/owner stack is not exercised' }, null, 2))
  await screenshot('synthetic-erasure-verified')
  assert.deepEqual(errors, [])
  status = 'passed'
  results.push('production CSS/Tailwind; real AgentMemoryService/FileMemoryStore/SqliteRoomStore; edit/cancel/reopen, stale CAS rejection, persisted correction, disable/restore/rollback, pending decision, exact scope project preview, synthetic confirmed forget/erase and anti-replay')
  console.log(JSON.stringify({ engine: native ? 'native-electron' : 'chromium-renderer', results, evidence }, null, 2))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => undefined)
  errors.push(error.message)
  throw error
} finally {
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ status, engine: native ? 'native-electron' : 'chromium-renderer', results, errors }, null, 2))
  await electron?.close(); await browser?.close(); await backend?.close(); await rm(temporary, { recursive: true, force: true })
}
async function screenshot(name) {
  assert.deepEqual(await page.evaluate(() => window.memoryFixture.missingKeys), [],
    `all visible memory labels must resolve through the app locale resources before ${name}`)
  await page.screenshot({ path: join(evidence, `${native ? 'electron' : 'chromium'}-${name}.png`), fullPage: true })
}
