#!/usr/bin/env node
'use strict'

// Artifacts library smoke on an isolated profile: real Electron and Kun runtime,
// a seeded workspace with a design draft, a whiteboard, a generated image and a
// spreadsheet. Opens the sidebar entry, the grid and list views and each viewer.
//   npm run build && node scripts/smoke-development-artifacts.cjs [--keep-dirs]
// Screenshots and report.json land under dist/artifacts-smoke (or --evidence <dir>).

const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const XLSX = require('xlsx')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent, desktopUserDataCandidates,
  platformDesktopArguments, stopIsolatedServiceManager, stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

const diagnostics = {}
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function seedWorkspace(root) {
  const now = new Date().toISOString()
  const write = async (path, content) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await write('.kun-design/documents.json', JSON.stringify({
    version: 1,
    activeDocumentId: 'doc_footer',
    documents: [{ id: 'doc_footer', title: 'Footer update entry', order: 0, createdAt: now, updatedAt: now, activeArtifactId: 'screen_a' }]
  }))
  await write('.kun-design/doc_footer/screen_a/v1.html',
    '<!doctype html><html><body style="margin:0;font:24px sans-serif"><main style="padding:40px"><h1>Sidebar footer</h1><button>Update ready</button></main></body></html>')
  await write('.kun-design/doc_footer/screen_a/meta.json', JSON.stringify({
    id: 'screen_a', kind: 'html', title: 'New footer', relativePath: '.kun-design/doc_footer/screen_a/v1.html',
    createdAt: now, updatedAt: now, versions: [{ relativePath: '.kun-design/doc_footer/screen_a/v1.html', createdAt: now }]
  }))
  await write('.kun-whiteboards/index.json', JSON.stringify({
    version: 1,
    whiteboards: [{ id: 'wb_runtime', title: 'Runtime map', threadId: null, phase: 'blank', revision: 1, createdAt: now, updatedAt: now, engine: 'excalidraw' }]
  }))
  await write('.kun-whiteboards/wb_runtime/excalidraw.json', JSON.stringify({
    type: 'excalidraw', version: 2, source: 'kun',
    elements: [{
      id: 'box', type: 'rectangle', x: 0, y: 0, width: 240, height: 120, angle: 0, strokeColor: '#0f7a63', backgroundColor: '#e6f6f2',
      fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null,
      seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false
    }],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {}
  }))
  await write('reports/release-notes.pdf', minimalPdf('Kun release notes'))
  await write('.kun/images/mascot.png', Buffer.from(PNG_1PX, 'base64'))
  const sheet = XLSX.utils.aoa_to_sheet([['Agent', 'Usage source'], ['Kun', 'Runtime events'], ['Devin', 'Session database']])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Compare')
  await mkdir(join(root, 'reports'), { recursive: true })
  XLSX.writeFile(book, join(root, 'reports', 'agent-usage.xlsx'))
}

function minimalPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return body
}

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`)
}

async function runFlow({ page, capture, timeoutMs }) {
  const checks = []
  await page.locator('nav.sidebar-code-nav').getByText('Artifacts', { exact: true }).click()
  await page.locator('[data-artifacts-page]').waitFor({ timeout: timeoutMs })
  await poll(async () => (await page.locator('[data-artifact-card]').count()) === 5, timeoutMs, 'five seeded artifacts')
  diagnostics.cards = await page.locator('[data-artifact-card]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-artifact-card')))
  assert.deepEqual([...diagnostics.cards].sort(), ['board', 'design', 'doc', 'image', 'sheet'])
  await capture('artifacts-1-grid')
  checks.push('The sidebar entry opens the library and indexes the design draft, whiteboard, image and spreadsheet')

  await page.getByRole('tab', { name: /Spreadsheet/ }).click()
  assert.equal(await page.locator('[data-artifact-card]').count(), 1)
  await page.getByRole('tab', { name: /^All/ }).click()
  await page.getByRole('button', { name: 'List view' }).click()
  await poll(async () => (await page.locator('[data-artifact-row]').count()) === 5, timeoutMs, 'list rows')
  await capture('artifacts-2-list')
  await page.getByRole('button', { name: 'Grid view' }).click()
  checks.push('Type tabs filter and the list view shows the same items')

  await page.locator('[data-artifact-card="sheet"]').click()
  await page.locator('[data-artifact-stage="office"]').waitFor({ timeout: timeoutMs })
  await poll(async () => (await page.locator('[data-artifact-stage="office"]').innerText()).includes('Runtime events'), timeoutMs, 'spreadsheet cells')
  await capture('artifacts-3-sheet-viewer')
  checks.push('The spreadsheet opens in a viewer that renders its cells with the shared office preview')

  await page.getByRole('button', { name: 'Back to artifacts' }).click()
  await page.locator('[data-artifact-card="design"]').click()
  await page.locator('[data-artifact-stage="design"]').waitFor({ timeout: timeoutMs })
  await poll(async () => (await page.locator('[data-artifact-stage="design"] webview').count()) > 0, timeoutMs, 'design screen webview')
  await page.getByRole('button', { name: /New footer/ }).click()
  await poll(async () => (await page.locator('[data-artifact-viewer] aside').innerText()).includes('New footer'), timeoutMs, 'focus chip')
  await capture('artifacts-4-design-viewer')
  checks.push('The design viewer renders the draft\'s HTML screens and a selected screen becomes the revise focus')

  await page.getByRole('button', { name: 'Back to artifacts' }).click()
  await page.locator('[data-artifact-card="image"]').click()
  await page.locator('[data-artifact-stage="image"] img').waitFor({ timeout: timeoutMs })
  await capture('artifacts-5-image-viewer')
  await page.getByRole('button', { name: 'Back to artifacts' }).click()
  await page.locator('[data-artifact-card="board"]').click()
  await page.locator('[data-artifact-stage="board"] img').waitFor({ timeout: timeoutMs })
  await capture('artifacts-6-board-viewer')
  await page.getByRole('button', { name: 'Back to artifacts' }).click()
  await page.locator('[data-artifact-card="doc"]').click()
  await page.locator('[data-artifact-stage="pdf"]').waitFor({ timeout: timeoutMs })
  await poll(async () => (await page.locator('[data-artifact-stage="pdf"] canvas').count()) > 0, timeoutMs, 'rendered PDF page')
  await capture('artifacts-8-pdf-viewer')
  await page.getByRole('button', { name: 'Back to artifacts' }).click()
  checks.push('Image, whiteboard (rendered from its Excalidraw scene) and PDF viewers show real previews')

  await page.locator('[data-artifact-new="design"]').click()
  await poll(async () => (await page.locator('.ds-composer-textarea').inputValue()).startsWith('Design a page for'), timeoutMs, 'composer prefill')
  assert.equal(await page.locator('[data-artifacts-page]').count(), 0)
  await capture('artifacts-7-new-design')
  checks.push('A "New" tile returns to Code with a starter prompt in the composer, unsent')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'artifacts-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-artifacts-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await realpath(await mkdtemp(join(workspaceParent, 'artifacts-')))
  await seedWorkspace(workspaceRoot)
  const screenshots = []
  const pageErrors = []
  let application, electronProcess, page, result, primaryError, realProfile = profile, electronOutput = ''
  const capture = async (name) => {
    const path = join(evidenceRoot, `${name}.png`)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const png = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.isVisible())
      return window ? (await window.capturePage()).toPNG().toString('base64') : null
    }).catch(() => null)
    if (png) await writeFile(path, Buffer.from(png, 'base64'))
    else await page.screenshot({ path, animations: 'disabled' })
    screenshots.push(path)
  }
  try {
    await Promise.all([home, profile, userData, appData, localAppData, temporaryDirectory, evidenceRoot]
      .map((directory) => mkdir(directory, { recursive: true })))
    realProfile = await realpath(profile)
    const runtimePort = await availablePort()
    const environment = createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory })
    delete environment.ELECTRON_RENDERER_URL
    environment.NODE_ENV = 'development'
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale: 'en', initialSetupCompleted: true }
    settings.schedule = { internal: { port: await availablePort() } }
    const serialized = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({ platform: process.platform, home, appData, explicitUserData: userData })
      .map(async (directory) => {
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'kun-settings.json'), serialized)
      }))
    application = await _electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${userData}`, '--no-first-run', '--disable-background-networking',
        '--disable-component-update', ...platformDesktopArguments(process.platform), repositoryRoot],
      cwd: repositoryRoot, env: environment, chromiumSandbox: true, timeout: timeoutMs
    })
    electronProcess = application.process()
    for (const stream of [electronProcess.stdout, electronProcess.stderr]) {
      stream?.on('data', (chunk) => { electronOutput = `${electronOutput}${chunk}`.slice(-64 * 1024) })
    }
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.setBounds({ x: 20, y: 20, width: 1440, height: 920 })
    })
    page = await findWorkbenchWindow(application, timeoutMs)
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 })
    await page.locator('.ds-composer-textarea').waitFor({ timeout: timeoutMs })
    const assertions = await runFlow({ page, capture, timeoutMs })
    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    result = { ok: true, status: 'passed', completedAt: new Date().toISOString(), screenshots, assertions, diagnostics,
      ...(keepDirs ? { temporaryRoot, workspaceRoot } : {}) }
  } catch (error) {
    if (page) {
      await capture('failure').catch(() => undefined)
      await writeFile(join(evidenceRoot, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    }
    primaryError = new Error(`${error.stack ?? error}\nElectron:\n${electronOutput}`)
    result = { ok: false, status: 'failed', failure: primaryError.message, screenshots, pageErrors, diagnostics }
  } finally {
    if (application) await withTimeout(application.close(), 3_000, 'closing Electron').catch(() => undefined)
    if (electronProcess) await terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }).catch(() => undefined)
    await withTimeout(stopIsolatedSharedRuntime(repositoryRoot, realProfile), 20_000, 'runtime').catch(() => undefined)
    await withTimeout(stopIsolatedServiceManager(home, realProfile), 20_000, 'manager').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
    if (!keepDirs) {
      await Promise.all([temporaryRoot, workspaceRoot].map((path) =>
        rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined)))
    }
  }
  await writeFile(join(evidenceRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
