import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { chromium } from 'playwright-core'
import tailwindConfig from '../tailwind.config.js'
import { smokeUrlAssets, writeSmokeAssets } from './smoke-url-assets.mjs'

// Actual component, renderer client, route and canonical store; synthetic model only.
// Not an Electron preload/Manager/full-app acceptance or a relation-quality evaluation.
// CHROME_PATH=<chrome executable> node scripts/smoke-memory-relations.mjs
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'kun-relation-smoke-'))
const evidence = resolve(process.env.KUN_MEMORY_EVIDENCE ?? join(root, 'output/playwright/memory-relations'))
const recordVideo = process.env.KUN_MEMORY_VIDEO === '1'
await mkdir(evidence, { recursive: true })
let browser, page
const errors = []
let status = 'failed'
try {
  const backendPath = join(temporary, 'backend.cjs')
  await build({ entryPoints: [join(root, 'scripts/fixtures/memory-relations-backend.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: backendPath })
  const backend = await createRequire(import.meta.url)(backendPath).createRelationSmokeBackend(join(temporary, 'data'))
  const compiled = await build({
    entryPoints: [join(root, 'scripts/fixtures/memory-relations.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'esm', jsx: 'automatic', outdir: temporary,
    alias: { '@shared': join(root, 'src/shared') },
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    plugins: [smokeUrlAssets()]
  })
  // Retain emitted URL assets next to the fixture for file:// loads.
  await writeSmokeAssets(compiled.outputFiles)
  const rawCss = compiled.outputFiles.find((file) => file.path.endsWith('.css')).text
  const css = (await postcss([tailwindcss(tailwindConfig), autoprefixer])
    .process(rawCss, { from: join(root, 'src/renderer/src/index.css') })).css
  assert.ok(!css.includes('@tailwind'))
  await writeFile(join(temporary, 'fixture.js'), compiled.outputFiles.find((file) => file.path.endsWith('.js')).text)
  const html = join(temporary, 'index.html')
  await writeFile(html, `<!doctype html><html lang="en"><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
    html,body,#root{min-height:100%;height:auto;overflow:auto;-webkit-app-region:no-drag}
    .relation-fixture{max-width:780px;margin:auto;padding:24px;background:var(--ds-bg-main)}
    </style><div id="root"></div><script type="module" src="./fixture.js"></script></html>`)
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
    headless: true, slowMo: recordVideo ? 150 : 0, args: ['--allow-file-access-from-files'] })
  page = await browser.newPage({ viewport: { width: 1000, height: 1000 },
    ...(recordVideo ? { recordVideo: { dir: evidence, size: { width: 1000, height: 1000 } } } : {}) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.exposeFunction('__relationTransport', backend.request)
  await page.exposeFunction('__relationSource', () => backend.source)
  await page.exposeFunction('__relationConfigure', backend.configureRelations)
  await page.goto(pathToFileURL(html).href)
  await page.getByRole('button', { name: 'Related memories', exact: true }).click()
  await page.getByText(/^No suggestions for this memory/).waitFor()
  assert.equal(backend.calls, 0, 'opening the panel must not call a provider')
  await page.getByRole('button', { name: 'Analyze with model', exact: true }).click()
  await page.getByRole('heading', { name: 'Contradicts', exact: true }).waitFor()
  assert.equal(backend.calls, 1)
  assert.equal(await page.locator('mark').count(), 4)
  await screenshot('pending-evidence')
  const contradiction = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Contradicts', exact: true }) })
  const confirmation = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Confirms', exact: true }) })
  await contradiction.getByRole('button', { name: 'Accept relation', exact: true }).click()
  await contradiction.getByText('Accepted', { exact: true }).waitFor()
  await confirmation.getByRole('button', { name: 'Reject relation', exact: true }).click()
  await confirmation.getByText('Rejected', { exact: true }).waitFor()
  await backend.reopen()
  await page.reload()
  await page.getByRole('button', { name: 'Related memories', exact: true }).click()
  await contradiction.getByText('Accepted', { exact: true }).waitFor()
  await confirmation.getByText('Rejected', { exact: true }).waitFor()
  assert.equal(backend.calls, 1)
  await screenshot('decisions-persisted')
  await page.getByLabel('Workspace path', { exact: true }).fill(
    process.platform === 'win32' ? 'C:\\synthetic\\memory-workspace' : '/synthetic/memory-workspace')
  await page.getByLabel('Query', { exact: true }).fill('project database PostgreSQL')
  await page.getByRole('button', { name: 'Preview context', exact: true }).click()
  await page.getByRole('heading', { name: 'Relation annotations', exact: true }).waitFor()
  await page.getByText(/^Automatic relation annotations are off/).waitFor()
  assert.equal((await backend.turnContext()).relationContext.annotations.length, 0)
  assert.equal(backend.calls, 1, 'preview must not call the model')
  await screenshot('preview-default-off')
  await page.getByRole('checkbox', { name: 'Include reviewed relations in chat' }).check()
  await page.getByText(/^Automatic relation annotations are enabled/).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Relation annotations', exact: true }).count(), 0, 'setting changes invalidate preview')
  await page.getByRole('button', { name: 'Preview context', exact: true }).click()
  await page.getByRole('heading', { name: 'Relation annotations', exact: true }).waitFor()
  const live = await backend.turnContext()
  assert.equal(live.relationContext.annotations.length, 1)
  assert.ok(live.referenceBlocks.join('\n').length <= 6000)
  await screenshot('preview-opt-in')
  await page.getByLabel('Query', { exact: true }).fill('unrelated penguin')
  assert.equal(await page.getByRole('heading', { name: 'Relation annotations', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Preview context', exact: true }).click()
  await page.getByText('No relevant active reference memories were selected.').waitFor()
  await page.getByLabel('Query', { exact: true }).fill('project database PostgreSQL')
  await page.getByLabel('Query', { exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.ok(await page.getByRole('button', { name: 'Preview context', exact: true })
    .evaluate((element) => element === document.activeElement), 'keyboard reaches the preview action')
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'Relation annotations', exact: true }).waitFor()
  await page.evaluate(() => window.relationFixture.language('zh'))
  await page.getByRole('button', { name: '刷新', exact: true }).waitFor()
  await screenshot('chinese-wide')
  await page.setViewportSize({ width: 420, height: 900 })
  await screenshot('chinese-narrow')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow')
  await page.evaluate(() => window.relationFixture.language('en'))
  await backend.editTarget()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await contradiction.getByText('Stale', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Preview context', exact: true }).click()
  await page.getByText('No eligible reviewed relation connects two selected memories.', { exact: true }).waitFor()
  assert.equal(await page.getByText('The project database uses PostgreSQL 16.', { exact: true }).count(), 0)
  assert.equal(await contradiction.getByRole('button', { name: 'Accept relation', exact: true }).count(), 0)
  assert.equal((await backend.turnContext()).relationContext.annotations.length, 0)
  await contradiction.getByRole('button', { name: 'Withdraw acceptance', exact: true }).click()
  assert.equal((await backend.snapshot()).relations.find((relation) => relation.suggestion.proposal.kind === 'contradicts').suggestion.status, 'rejected')
  await screenshot('stale-hidden')
  // Only the synthetic records created in this temporary directory may be erased.
  await backend.eraseTarget()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('heading', { name: 'Contradicts', exact: true }).waitFor({ state: 'detached' })
  assert.equal((await backend.snapshot()).relations.length, 1)
  const older = await backend.seedPagination()
  const relationPanel = page.locator('section').filter({ has: page.getByRole('button', { name: 'Related memories', exact: true }) })
  assert.equal((await older.projection()).annotations.length, 1)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('navigation', { name: 'Relation pages' }).waitFor()
  assert.equal(await relationPanel.getByRole('listitem').count(), 20)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Withdraw acceptance', exact: true }).waitFor()
  assert.equal(await relationPanel.getByRole('listitem').count(), 6)
  await screenshot('older-relation-page')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.getByRole('combobox', { name: 'Relation status' }).selectOption('accepted')
  await page.getByRole('button', { name: 'Withdraw acceptance', exact: true }).waitFor()
  assert.equal(await relationPanel.getByRole('listitem').count(), 1)
  await page.getByRole('button', { name: 'Withdraw acceptance', exact: true }).click()
  await page.getByText(/^No suggestions for this memory/).waitFor()
  assert.equal((await older.projection()).annotations.length, 0)
  assert.equal((await backend.snapshot()).relations.find((relation) => relation.suggestion.id === older.id).suggestion.status, 'rejected')
  await page.getByRole('combobox', { name: 'Relation status' }).selectOption('all')
  await page.getByRole('button', { name: 'Next', exact: true }).waitFor()
  assert.equal(backend.calls, 1, 'pagination, filtering and withdrawal never call the model')
  await screenshot('pagination-withdrawn')
  assert.deepEqual(errors, [])
  status = 'passed'
  console.log(JSON.stringify({ status, evidence, providerCalls: backend.calls,
    boundary: 'component/client/route/FileMemoryStore integration; synthetic provider; no Electron preload/Manager' }, null, 2))
} catch (error) {
  errors.push(error.message)
  if (page) await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => undefined)
  throw error
} finally {
  try {
    const video = page?.video()
    await page?.context().close()
    if (video) await video.saveAs(join(evidence, 'workflow.webm'))
  } catch (error) {
    status = 'failed'
    errors.push(error.message)
    console.error(error)
    process.exitCode = 1
  } finally {
    await writeFile(join(evidence, 'results.json'), JSON.stringify({ status, errors }, null, 2))
    await browser?.close()
    // mkdtemp owns this exact directory; never use a profile or workspace as a cleanup target.
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
async function screenshot(name) {
  assert.deepEqual(await page.evaluate(() => window.relationFixture.missingKeys), [])
  await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true })
  // Keep evidence states readable in the optional continuous demo recording.
  if (recordVideo) await page.waitForTimeout(1000)
}
